//! Parentless working-tree snapshots under `refs/afwe/snapshots/<project_id>/<snap_id>`.
//!
//! A snapshot is a commit with no parents, so pruning is `update-ref -d` plus a prune and the
//! lineage lives in the ledger rather than in parent pointers. Snapshots are local only: the
//! transport moves the ledger ref, never the snapshot refs.
//!
//! The tree is built through a private per-worktree index, never the user's index. Engine-owned
//! state, nested repositories, LFS paths and oversized files are excluded and reported.

use crate::engine::Engine;
use crate::ledger;
use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::Command;

pub const REF_PREFIX: &str = "refs/afwe/snapshots/";

const DEFAULT_MAX_FILE_MB: u64 = 50;

/// Paths that are projections of engine state, never snapshot content.
const EXCLUDED_DIRS: &[&str] = &[
    ".afwe/index/",
    ".afwe/state/",
    ".afwe/turns/",
    ".afwe/log/",
    ".afwe/backups/",
];

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SnapshotMeta {
    pub id: String,
    pub commit: String,
    pub tree: String,
    pub project_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn: Option<String>,
    /// begin | end | manual
    pub phase: String,
    pub created: String,
    pub files: usize,
    pub reused: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub excluded: Vec<String>,
}

fn git(root: &Path, args: &[&str]) -> Result<std::process::Output> {
    Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .with_context(|| format!("run git {}", args.join(" ")))
}

fn git_ok(root: &Path, args: &[&str]) -> Result<String> {
    let out = git(root, args)?;
    if !out.status.success() {
        return Err(anyhow!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn git_env(root: &Path, args: &[&str], envs: &[(&str, &str)]) -> Result<std::process::Output> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(root).args(args);
    for (key, value) in envs {
        cmd.env(key, value);
    }
    cmd.output()
        .with_context(|| format!("run git {}", args.join(" ")))
}

fn git_ok_env(root: &Path, args: &[&str], envs: &[(&str, &str)]) -> Result<String> {
    let out = git_env(root, args, envs)?;
    if !out.status.success() {
        return Err(anyhow!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn git_stdin_env(
    root: &Path,
    args: &[&str],
    envs: &[(&str, &str)],
    input: &str,
) -> Result<std::process::Output> {
    use std::io::Write;
    use std::process::Stdio;

    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(root).args(args);
    for (key, value) in envs {
        cmd.env(key, value);
    }
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .with_context(|| format!("spawn git {}", args.join(" ")))?;
    child
        .stdin
        .as_mut()
        .ok_or_else(|| anyhow!("git stdin unavailable"))?
        .write_all(input.as_bytes())?;
    Ok(child.wait_with_output()?)
}

fn git_ok_stdin_env(
    root: &Path,
    args: &[&str],
    envs: &[(&str, &str)],
    input: &str,
) -> Result<String> {
    let out = git_stdin_env(root, args, envs, input)?;
    if !out.status.success() {
        return Err(anyhow!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn common_dir(root: &Path) -> Result<PathBuf> {
    let out = git_ok(root, &["rev-parse", "--path-format=absolute", "--git-common-dir"])?;
    let path = PathBuf::from(out.trim());
    Ok(if path.is_absolute() { path } else { root.join(path) })
}

fn private_index(root: &Path) -> Result<PathBuf> {
    let common = common_dir(root)?;
    let dir = common.join("afwe").join("snapshots");
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("create snapshot index dir {}", dir.display()))?;
    let canonical = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let worktree = &blake3::hash(canonical.to_string_lossy().as_bytes()).to_hex()[..10];
    Ok(dir.join(format!("index-{worktree}")))
}

fn is_excluded_path(path: &str) -> bool {
    EXCLUDED_DIRS.iter().any(|dir| path.starts_with(dir))
}

/// Directories that contain their own `.git`, up to a shallow depth. `git add -A` would stage
/// them as mode-160000 gitlinks; the snapshot must not record another repository.
fn nested_repos(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    fn walk(root: &Path, dir: &Path, depth: usize, out: &mut Vec<String>) {
        if depth > 4 {
            return;
        }
        let Ok(listing) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in listing.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else { continue };
            if !file_type.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if matches!(
                name.as_str(),
                ".git" | "node_modules" | "target" | "dist" | "build" | ".afwe" | ".build-gnu" | ".build"
            ) {
                continue;
            }
            if path.join(".git").exists() {
                out.push(crate::store::rel_to(root, &path));
                continue;
            }
            walk(root, &path, depth + 1, out);
        }
    }
    walk(root, root, 0, &mut out);
    out.sort();
    out
}

/// `filter=lfs` patterns from `.gitattributes` files, relative to the repository root.
fn lfs_patterns(root: &Path) -> Vec<String> {
    fn collect(root: &Path, dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
        if depth > 4 {
            return;
        }
        let Ok(listing) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in listing.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else { continue };
            if file_type.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if matches!(
                    name.as_str(),
                    ".git" | "node_modules" | "target" | "dist" | "build" | ".afwe" | ".build-gnu" | ".build"
                ) {
                    continue;
                }
                collect(root, &path, depth + 1, out);
            } else if entry.file_name().to_string_lossy() == ".gitattributes" {
                out.push(path);
            }
        }
    }

    let mut files = Vec::new();
    collect(root, root, 0, &mut files);
    let mut patterns = Vec::new();
    for attrs in files {
        let Ok(text) = std::fs::read_to_string(&attrs) else { continue };
        let base = attrs.parent().unwrap_or(root);
        let prefix = crate::store::rel_to(root, base);
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') || !line.contains("filter=lfs") {
                continue;
            }
            let Some(pattern) = line.split_whitespace().next() else { continue };
            let pattern = pattern.trim_start_matches('/');
            let full = if prefix == "." || prefix.is_empty() {
                pattern.to_string()
            } else {
                format!("{prefix}/{pattern}")
            };
            patterns.push(full);
        }
    }
    patterns
}

fn lfs_match(patterns: &[String], path: &str) -> bool {
    for pattern in patterns {
        if let Ok(glob) = globset::GlobBuilder::new(pattern).literal_separator(false).build() {
            let matcher = glob.compile_matcher();
            if matcher.is_match(path) || matcher.is_match(path.rsplit('/').next().unwrap_or(path)) {
                return true;
            }
        }
    }
    false
}

fn max_file_bytes() -> u64 {
    DEFAULT_MAX_FILE_MB * 1024 * 1024
}

fn file_mode(path: &Path) -> &'static str {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if std::fs::metadata(path)
            .map(|meta| meta.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
        {
            return "100755";
        }
    }
    let _ = path;
    "100644"
}

/// Build the private index directly from the tracked + untracked-not-ignored file set. This keeps
/// exact control over exclusions without `git add` failing on an ignored engine directory or a
/// nested repository with no commit.
fn build_index(
    root: &Path,
    envs: &[(&str, &str)],
    max_bytes: u64,
    lfs: &[String],
    nested: &[String],
    excluded: &mut Vec<String>,
    hashes: &mut BTreeMap<String, String>,
) -> Result<usize> {
    let listing = git_ok_env(root, &["ls-files", "-co", "--exclude-standard", "-z"], envs)?;
    let mut paths: Vec<String> = Vec::new();
    for raw in listing.split('\0') {
        let path = raw.trim();
        if path.is_empty() {
            continue;
        }
        if is_excluded_path(path) {
            excluded.push(format!("engine-owned:{path}"));
            continue;
        }
        if nested
            .iter()
            .any(|repo| path == repo || path.starts_with(&format!("{repo}/")))
        {
            continue;
        }
        if lfs_match(lfs, path) {
            excluded.push(format!("lfs:{path}"));
            continue;
        }
        let abs = root.join(path);
        let Ok(meta) = std::fs::symlink_metadata(&abs) else { continue };
        if meta.file_type().is_symlink() {
            excluded.push(format!("symlink:{path}"));
            continue;
        }
        if !meta.is_file() {
            continue;
        }
        if meta.len() > max_bytes {
            excluded.push(format!("oversized:{path}"));
            continue;
        }
        if let Ok(bytes) = std::fs::read(&abs) {
            hashes.insert(path.to_string(), crate::util::hash_bytes(&bytes));
        }
        paths.push(path.to_string());
    }
    if paths.is_empty() {
        return Ok(0);
    }

    let mut input = paths.join("\n");
    input.push('\n');
    let hashes = git_ok_stdin_env(root, &["hash-object", "-w", "--stdin-paths"], envs, &input)?;
    let hashes: Vec<&str> = hashes.lines().filter(|line| !line.trim().is_empty()).collect();
    if hashes.len() != paths.len() {
        return Err(anyhow!(
            "hash-object returned {} hashes for {} paths",
            hashes.len(),
            paths.len()
        ));
    }

    let mut info = String::new();
    for (path, sha) in paths.iter().zip(hashes.iter()) {
        info.push_str(file_mode(&root.join(path)));
        info.push(' ');
        info.push_str(sha.trim());
        info.push('\t');
        info.push_str(path);
        info.push('\0');
    }
    git_ok_stdin_env(root, &["update-index", "--add", "-z", "--index-info"], envs, &info)?;
    Ok(paths.len())
}

/// Build a snapshot of the current working tree. Best effort callers treat failure as advisory.
pub fn create(engine: &Engine, phase: &str, turn: Option<&str>) -> Result<SnapshotMeta> {
    create_with_limit(engine, phase, turn, max_file_bytes())
}

fn create_with_limit(
    engine: &Engine,
    phase: &str,
    turn: Option<&str>,
    max_bytes: u64,
) -> Result<SnapshotMeta> {
    let root = engine.store.project_root.as_path();
    if !root.join(".git").exists() {
        return Err(anyhow!("snapshots need a git repository at {}", root.display()));
    }
    let project = ledger::project_id(engine)?;
    let index = private_index(root)?;
    let index_str = index.to_string_lossy().to_string();
    let envs = [("GIT_INDEX_FILE", index_str.as_str())];

    git_ok_env(root, &["read-tree", "--empty"], &envs)?;
    let nested = nested_repos(root);
    let lfs = lfs_patterns(root);
    let mut excluded: Vec<String> = nested.iter().map(|repo| format!("nested:{repo}")).collect();
    let mut hashes: BTreeMap<String, String> = BTreeMap::new();
    build_index(root, &envs, max_bytes, &lfs, &nested, &mut excluded, &mut hashes)?;

    let tree = git_ok_env(root, &["write-tree"], &envs)?.trim().to_string();
    if tree.is_empty() {
        return Err(anyhow!("git write-tree returned an empty tree"));
    }

    let created = crate::util::now();
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let id = format!(
        "snap-{}",
        &blake3::hash(format!("{tree}:{phase}:{turn:?}:{nonce}").as_bytes()).to_hex()[..12]
    );
    let files = usize::try_from(
        git_ok(root, &["ls-tree", "-r", "--name-only", &tree])?
            .lines()
            .filter(|line| !line.trim().is_empty())
            .count(),
    )
    .unwrap_or(0);

    let mut meta = SnapshotMeta {
        id: id.clone(),
        commit: String::new(),
        tree: tree.clone(),
        project_id: project.clone(),
        turn: turn.map(str::to_string),
        phase: phase.to_string(),
        created,
        files,
        reused: false,
        excluded,
    };
    excluded_dedup(&mut meta.excluded);
    meta.excluded = compact_exclusions(meta.excluded);

    let message = format!(
        "afwe-snapshot: {} {} {}\n\n{}",
        meta.id,
        phase,
        turn.unwrap_or("-"),
        serde_json::to_string(&meta)?
    );
    let commit = git_ok(root, &["commit-tree", &tree, "-m", &message])?
        .trim()
        .to_string();
    meta.commit = commit.clone();
    let refname = format!("{REF_PREFIX}{project}/{}", meta.id);
    git_ok(root, &["update-ref", &refname, &commit])?;
    let _ = engine
        .store
        .write_json(&format!("state/snapshots/{}.json", meta.id), &meta);
    let _ = engine
        .store
        .write_json(&format!("state/snapshots/{}.hashes.json", meta.id), &hashes);
    let _ = ledger::append(engine, "snapshot_taken", json!(meta));
    Ok(meta)
}

/// Path -> blake3 map for a snapshot. Snapshots recorded before hashes were stored return empty.
pub fn hashes(engine: &Engine, meta: &SnapshotMeta) -> BTreeMap<String, String> {
    engine
        .store
        .read_json::<BTreeMap<String, String>>(&format!("state/snapshots/{}.hashes.json", meta.id))
        .ok()
        .flatten()
        .unwrap_or_default()
}

fn excluded_dedup(items: &mut Vec<String>) {
    let mut seen = BTreeSet::new();
    items.retain(|item| seen.insert(item.clone()));
    items.sort();
}

/// Engine-owned state is hundreds of paths; the receipt needs the fact and the count, not a list.
fn compact_exclusions(items: Vec<String>) -> Vec<String> {
    let mut engine_owned = 0usize;
    let mut symlinks = 0usize;
    let mut out: Vec<String> = Vec::new();
    for item in items {
        if item.starts_with("engine-owned:") {
            engine_owned += 1;
        } else if item.starts_with("symlink:") {
            symlinks += 1;
        } else {
            out.push(item);
        }
    }
    if engine_owned > 0 {
        out.push(format!("engine-owned:{engine_owned} files"));
    }
    if symlinks > 0 {
        out.push(format!("symlink:{symlinks} files"));
    }
    out.sort();
    out
}

fn parse_meta_from_commit(root: &Path, id: &str, commit: &str) -> SnapshotMeta {
    let body = git_ok(root, &["show", "-s", "--format=%B", commit]).unwrap_or_default();
    if let Some(json_line) = body.lines().find(|line| line.trim_start().starts_with('{')) {
        if let Ok(meta) = serde_json::from_str::<SnapshotMeta>(json_line.trim()) {
            return meta;
        }
    }
    SnapshotMeta {
        id: id.to_string(),
        commit: commit.to_string(),
        created: git_ok(root, &["show", "-s", "--format=%cI", commit])
            .unwrap_or_default()
            .trim()
            .to_string(),
        ..Default::default()
    }
}

/// Snapshots for this project, newest first.
pub fn list(engine: &Engine) -> Result<Vec<SnapshotMeta>> {
    let root = engine.store.project_root.as_path();
    let manifest = engine.store.manifest()?;
    let Some(project) = manifest.project.id.filter(|id| !id.is_empty()) else {
        return Ok(vec![]);
    };
    let prefix = format!("{REF_PREFIX}{project}/");
    let out = match git(root, &["for-each-ref", "--format=%(refname)", &prefix]) {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout).into_owned(),
        _ => return Ok(vec![]),
    };
    let mut snaps = Vec::new();
    for refname in out.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let id = refname.rsplit('/').next().unwrap_or("").to_string();
        if let Some(meta) = engine
            .store
            .read_json::<SnapshotMeta>(&format!("state/snapshots/{id}.json"))
            .ok()
            .flatten()
        {
            snaps.push(meta);
            continue;
        }
        let Ok(commit) = git_ok(root, &["rev-parse", refname]) else { continue };
        snaps.push(parse_meta_from_commit(root, &id, commit.trim()));
    }
    snaps.sort_by(|a, b| b.created.cmp(&a.created).then_with(|| b.id.cmp(&a.id)));
    Ok(snaps)
}

pub fn show(engine: &Engine, id: &str) -> Result<Option<Value>> {
    let snaps = list(engine)?;
    Ok(snaps
        .into_iter()
        .find(|snap| snap.id == id || snap.id.starts_with(id))
        .map(|snap| json!(snap)))
}

/// Prune snapshots according to retention limit `keep_k`, deleting older refs and running safe ref packing.
/// Snapshots referenced by active rewind receipts are preserved to prevent evidence loss.
pub fn prune(engine: &Engine, keep_k: usize) -> Result<Value> {
    let root = engine.store.project_root.as_path();
    let manifest = engine.store.manifest()?;
    let Some(project) = manifest.project.id.filter(|id| !id.is_empty()) else {
        return Ok(json!({ "pruned": 0, "remaining": 0 }));
    };
    let all = list(engine)?;
    if all.len() <= keep_k {
        return Ok(json!({
            "pruned": 0,
            "remaining": all.len(),
            "retained": all.iter().map(|s| s.id.clone()).collect::<Vec<_>>()
        }));
    }

    // Protect snapshots referenced by active rewind receipts
    let active_receipts = crate::rewind::receipts(engine).unwrap_or_default();
    let protected_ids: std::collections::BTreeSet<String> = active_receipts
        .iter()
        .flat_map(|r| {
            let mut ids = Vec::new();
            if let Some(s) = &r.to_snapshot {
                ids.push(s.clone());
            }
            for p in &r.paths {
                if let Some(s) = &p.matched_snapshot {
                    ids.push(s.clone());
                }
            }
            ids
        })
        .collect();

    let to_prune = &all[keep_k..];
    let mut pruned_ids = Vec::new();
    for snap in to_prune {
        if protected_ids.contains(&snap.id) {
            continue;
        }
        let refname = format!("{REF_PREFIX}{project}/{}", snap.id);
        let _ = git_ok(root, &["update-ref", "-d", &refname]);
        let _ = engine.store.remove(&format!("state/snapshots/{}.json", snap.id));
        let _ = engine.store.remove(&format!("state/snapshots/{}.hashes.json", snap.id));
        pruned_ids.push(snap.id.clone());
    }

    // Git ref packing to reclaim deleted ref files, followed by safe auto gc
    let _ = git(root, &["pack-refs", "--all", "--prune"]);
    let _ = git(root, &["gc", "--auto"]);

    let _ = ledger::append(
        engine,
        "snapshots_pruned",
        json!({
            "pruned_count": pruned_ids.len(),
            "pruned_ids": pruned_ids,
            "keep_k": keep_k,
        }),
    );

    let remaining = all.len().saturating_sub(pruned_ids.len());
    Ok(json!({
        "pruned": pruned_ids.len(),
        "pruned_ids": pruned_ids,
        "remaining": remaining,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init::{init, InitOptions};

    fn repo(name: &str) -> (PathBuf, Engine) {
        let dir = std::env::temp_dir().join(format!("afwe-snap-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let status = Command::new("git").arg("-C").arg(&dir).args(["init", "-q"]).status().unwrap();
        assert!(status.success());
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("src/a.rs"), "pub fn a() {}\n").unwrap();
        std::fs::create_dir_all(dir.join(".afwe/turns")).unwrap();
        std::fs::write(dir.join(".afwe/turns/t0001.yaml"), "id: t0001\n").unwrap();
        let store = init(
            &dir,
            InitOptions { name: Some(name.into()), description: None, root: None, force: true },
        )
        .unwrap();
        (dir, Engine { store })
    }

    fn git_out(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
        assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).into_owned()
    }

    #[test]
    fn snapshot_is_parentless_and_excludes_engine_and_nested_content() {
        let (dir, engine) = repo("exclude");
        std::fs::create_dir_all(dir.join("nested")).unwrap();
        let status = Command::new("git").arg("-C").arg(dir.join("nested")).args(["init", "-q"]).status().unwrap();
        assert!(status.success());
        std::fs::write(dir.join("nested/file.txt"), "nested\n").unwrap();
        std::fs::write(dir.join("big.bin"), vec![0u8; 2 * 1024 * 1024]).unwrap();
        std::fs::write(dir.join(".gitattributes"), "*.psd filter=lfs diff=lfs merge=lfs -text\n").unwrap();
        std::fs::write(dir.join("icon.psd"), "lfs\n").unwrap();

        let meta = create_with_limit(&engine, "begin", Some("t0001"), 1024 * 1024).unwrap();
        assert_eq!(meta.phase, "begin");
        assert_eq!(meta.turn.as_deref(), Some("t0001"));
        assert!(meta.excluded.iter().any(|item| item.starts_with("nested:")), "{:?}", meta.excluded);
        assert!(meta.excluded.iter().any(|item| item.starts_with("oversized:")), "{:?}", meta.excluded);
        assert!(meta.excluded.iter().any(|item| item.starts_with("lfs:")), "{:?}", meta.excluded);

        let names = git_out(&dir, &["ls-tree", "-r", "--name-only", &meta.tree]);
        assert!(names.contains("src/a.rs"), "{names}");
        assert!(!names.contains(".afwe/turns/t0001.yaml"), "{names}");
        assert!(!names.contains("nested/file.txt"), "{names}");
        assert!(!names.contains("big.bin"), "{names}");
        assert!(!names.contains("icon.psd"), "{names}");

        let parents = git_out(&dir, &["rev-list", "--parents", "-n", "1", &meta.commit]);
        assert_eq!(parents.split_whitespace().count(), 1, "snapshot commit must have no parent");

        let listed = list(&engine).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, meta.id);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn snapshot_list_is_empty_without_a_repository_ledger_id() {
        let dir = std::env::temp_dir().join(format!("afwe-snap-empty-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let store = init(
            &dir,
            InitOptions { name: Some("empty".into()), description: None, root: None, force: true },
        )
        .unwrap();
        let engine = Engine { store };
        assert!(list(&engine).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
