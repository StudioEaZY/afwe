//! Append-only engine ledger under `refs/afwe/ledger/<project_id>`.
//!
//! The ledger is the authoritative record of engine state. `.afwe/` is a projection that
//! `afwe repair` regenerates from it. Each commit adds exactly one event file, so a commit
//! never rewrites history and the tree stays tiny. History is the parent chain.
//!
//! Schema version 1. A reader that meets a newer version refuses rather than guessing.

use crate::engine::Engine;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

pub const LEDGER_VERSION: u32 = 1;

pub const REF_PREFIX: &str = "refs/afwe/ledger/";

fn default_version() -> u32 {
    LEDGER_VERSION
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerEvent {
    #[serde(default = "default_version")]
    pub version: u32,
    pub seq: u64,
    pub kind: String,
    pub ts: String,
    pub project_id: String,
    #[serde(default)]
    pub payload: Value,
}

/// Stable lowercase hex id for this project. Generated once and stored in the manifest, so every
/// clone and worktree derives the same ref name. Never derived from the display name.
pub fn project_id(engine: &Engine) -> Result<String> {
    if let Some(id) = read_project_id(engine)? {
        return Ok(id);
    }
    let mut manifest = engine.store.manifest()?;
    let seed = format!("{}:{}", manifest.project.name, engine.store.project_root.to_string_lossy());
    let id = format!("p{}", &blake3::hash(seed.as_bytes()).to_hex()[..16]);
    manifest.project.id = Some(id.clone());
    engine.store.save_manifest(&manifest)?;
    Ok(id)
}

fn read_project_id(engine: &Engine) -> Result<Option<String>> {
    let manifest = engine.store.manifest()?;
    Ok(manifest
        .project
        .id
        .as_deref()
        .filter(|id| !id.is_empty())
        .map(str::to_string))
}

fn ref_name(project_id: &str) -> String {
    format!("{REF_PREFIX}{project_id}")
}

fn git_capture(root: &Path, args: &[&str], stdin: Option<&str>) -> Result<String> {
    git_capture_env(root, args, &[], stdin)
}

fn git_capture_env(root: &Path, args: &[&str], envs: &[(&str, &str)], stdin: Option<&str>) -> Result<String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(root).args(args);
    for (key, value) in envs {
        cmd.env(key, value);
    }
    match stdin {
        Some(body) => {
            cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
            let mut child = cmd.spawn()?;
            child
                .stdin
                .as_mut()
                .ok_or_else(|| anyhow!("git stdin unavailable"))?
                .write_all(body.as_bytes())?;
            let out = child.wait_with_output()?;
            if !out.status.success() {
                return Err(anyhow!("git {} failed: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim()));
            }
            Ok(String::from_utf8_lossy(&out.stdout).into_owned())
        }
        None => {
            let out = cmd.output()?;
            if !out.status.success() {
                return Err(anyhow!("git {} failed: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim()));
            }
            Ok(String::from_utf8_lossy(&out.stdout).into_owned())
        }
    }
}

fn tip(root: &Path, refname: &str) -> Option<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["rev-parse", "--verify", "--quiet", refname])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let sha = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if sha.is_empty() {
        None
    } else {
        Some(sha)
    }
}

fn sanitize(kind: &str) -> String {
    kind.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect()
}

/// Build a tree containing the given (path, blob) entries. `mktree` only handles one level, so this
/// goes through a throwaway index like the commit path does.
fn build_tree(root: &Path, entries: &[(&str, &str)]) -> Result<String> {
    let nonce = format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );
    let idx = std::env::temp_dir().join(format!("afwe-ledger-index-{nonce}"));
    let idx_str = idx.to_string_lossy().to_string();
    let envs = [("GIT_INDEX_FILE", idx_str.as_str())];

    let result = (|| -> Result<String> {
        git_capture_env(root, &["read-tree", "--empty"], &envs, None)?;
        for (path, blob) in entries {
            let cacheinfo = format!("100644,{blob},{path}");
            git_capture_env(root, &["update-index", "--add", "--cacheinfo", &cacheinfo], &envs, None)?;
        }
        Ok(git_capture_env(root, &["write-tree"], &envs, None)?.trim().to_string())
    })();

    let _ = std::fs::remove_file(&idx);
    result
}

/// Append one event, retrying on a compare-and-swap collision with another writer.
pub fn append(engine: &Engine, kind: &str, payload: Value) -> Result<LedgerEvent> {
    let root = engine.store.project_root.as_path();
    if !root.join(".git").exists() {
        return Err(anyhow!("ledger needs a git repository at {}", root.display()));
    }
    let project = project_id(engine)?;
    let refname = ref_name(&project);

    for _attempt in 0..3 {
        let parent = tip(root, &refname);
        let seq = match &parent {
            Some(sha) => git_capture(root, &["rev-list", "--count", sha], None)?
                .trim()
                .parse::<u64>()
                .unwrap_or(0)
                + 1,
            None => 1,
        };

        let event = LedgerEvent {
            version: LEDGER_VERSION,
            seq,
            kind: kind.to_string(),
            ts: crate::util::now(),
            project_id: project.clone(),
            payload: payload.clone(),
        };
        let event_json = serde_json::to_string_pretty(&event)?;
        let event_blob = git_capture(root, &["hash-object", "-w", "--stdin"], Some(&event_json))?
            .trim()
            .to_string();

        let meta = json!({"version": LEDGER_VERSION, "project_id": project, "seq": seq});
        let meta_blob = git_capture(root, &["hash-object", "-w", "--stdin"], Some(&meta.to_string()))?
            .trim()
            .to_string();

        let path = format!("events/{:06}-{}.json", seq, sanitize(kind));
        let tree = build_tree(root, &[(path.as_str(), event_blob.as_str()), ("meta.json", meta_blob.as_str())])?;

        let message = format!("afwe-ledger: {seq} {kind}");
        let mut commit_args = vec!["commit-tree", tree.as_str(), "-m", message.as_str()];
        if let Some(parent_sha) = &parent {
            commit_args.push("-p");
            commit_args.push(parent_sha.as_str());
        }
        let commit = git_capture(root, &commit_args, None)?.trim().to_string();

        let mut update = vec!["update-ref", refname.as_str(), commit.as_str()];
        update.push(parent.as_deref().unwrap_or(""));
        if git_capture(root, &update, None).is_ok() {
            return Ok(event);
        }
    }

    Err(anyhow!("ledger CAS failed after 3 attempts; another writer keeps moving {}", refname))
}

/// All events, oldest first. Empty when no ledger exists yet.
pub fn events(engine: &Engine) -> Result<Vec<LedgerEvent>> {
    let root = engine.store.project_root.as_path();
    let Some(project) = read_project_id(engine)? else {
        return Ok(vec![]);
    };
    let refname = ref_name(&project);
    let Some(tip_sha) = tip(root, &refname) else {
        return Ok(vec![]);
    };

    let commits = git_capture(root, &["rev-list", tip_sha.as_str()], None)?;
    let mut out = Vec::new();
    for sha in commits.lines().rev() {
        let listing = git_capture(root, &["ls-tree", "-r", "--name-only", sha], None)?;
        let Some(path) = listing.lines().find(|line| line.starts_with("events/")) else {
            continue;
        };
        let blob = git_capture(root, &["show", &format!("{sha}:{path}")], None)?;
        let event: LedgerEvent = serde_json::from_str(&blob)?;
        if event.version > LEDGER_VERSION {
            return Err(anyhow!(
                "ledger schema version {} is newer than this binary ({}); upgrade AFWE instead of reading it partially",
                event.version,
                LEDGER_VERSION
            ));
        }
        out.push(event);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init::{init, InitOptions};

    fn repo(name: &str, with_git: bool) -> (std::path::PathBuf, Engine) {
        let dir = std::env::temp_dir().join(format!("afwe-ledger-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        if with_git {
            Command::new("git").arg("-C").arg(&dir).args(["init", "-q"]).status().unwrap();
        }
        let store = init(
            &dir,
            InitOptions { name: Some(name.into()), description: None, root: None, force: true },
        )
        .unwrap();
        (dir, Engine { store })
    }

    #[test]
    fn appends_and_reads_events_in_order() {
        let (dir, engine) = repo("append", true);
        let first = append(&engine, "turn_recorded", json!({"turn": "t0001"})).unwrap();
        let second = append(&engine, "rewind_confirmed", json!({"turn": "t0002"})).unwrap();

        assert_eq!(first.seq, 1);
        assert_eq!(second.seq, 2);

        let events = events(&engine).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].kind, "turn_recorded");
        assert_eq!(events[1].kind, "rewind_confirmed");
        assert_eq!(events[0].project_id, events[1].project_id);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn project_id_is_stable_and_persisted() {
        let (dir, engine) = repo("pid", true);
        let first = project_id(&engine).unwrap();
        let second = project_id(&engine).unwrap();
        assert_eq!(first, second);
        assert!(first.starts_with('p') && first.len() > 8);
        assert_eq!(engine.store.manifest().unwrap().project.id.as_deref(), Some(first.as_str()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn append_without_git_is_an_error_not_a_silent_write() {
        let (dir, engine) = repo("nogit", false);
        assert!(append(&engine, "turn_recorded", json!({})).is_err());
        assert!(events(&engine).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_newer_schema_is_refused() {
        assert_eq!(LEDGER_VERSION, 1);
        let event: LedgerEvent =
            serde_json::from_str(r#"{"version":2,"seq":1,"kind":"x","ts":"t","project_id":"p"}"#).unwrap();
        assert!(event.version > LEDGER_VERSION);
    }
}
