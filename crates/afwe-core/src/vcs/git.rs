//! Git provider: drives the `git` CLI. Commits are always path-scoped (`git commit -- <paths>`),
//! so unrelated staged work is never swept into a turn.

use super::{CommitInfo, VcsProvider};
use anyhow::{anyhow, Context, Result};
use regex::Regex;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

pub struct GitProvider;

fn run(root: &Path, args: &[String]) -> Result<(bool, String, String)> {
    run_with_env(root, args, &[])
}

fn run_with_env(root: &Path, args: &[String], envs: &[(&str, &str)]) -> Result<(bool, String, String)> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(root).args(args);
    for (k, v) in envs {
        cmd.env(k, v);
    }
    let out = cmd.output().context("could not run `git` (is it installed and on PATH?)")?;
    Ok((
        out.status.success(),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    ))
}

fn args(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

/// Only supply an identity when the repository (or global config) has none; never override the user's.
fn identity(root: &Path) -> Vec<String> {
    let has = run(root, &args(&["config", "user.email"])).map(|(ok, out, _)| ok && !out.trim().is_empty()).unwrap_or(false);
    if has {
        vec![]
    } else {
        args(&["-c", "user.name=AFWE", "-c", "user.email=afwe@localhost"])
    }
}

fn expand_paths(root: &Path, paths: &[String]) -> Vec<String> {
    let mut out = vec![];
    for p in paths {
        let abs = root.join(p);
        if abs.is_file() {
            out.push(p.replace('\\', "/"));
        } else if abs.is_dir() {
            let walker = ignore::WalkBuilder::new(&abs)
                .hidden(false)
                .git_ignore(false)
                .build();
            for entry in walker.flatten() {
                if entry.path().is_file() {
                    if let Ok(rel) = entry.path().strip_prefix(root) {
                        out.push(rel.to_string_lossy().replace('\\', "/"));
                    }
                }
            }
        } else if !abs.exists() {
            out.push(p.replace('\\', "/"));
        }
    }
    out.sort();
    out.dedup();
    out
}

impl VcsProvider for GitProvider {
    fn name(&self) -> &'static str {
        "git"
    }

    fn is_repo(&self, root: &Path) -> bool {
        run(root, &args(&["rev-parse", "--is-inside-work-tree"]))
            .map(|(ok, out, _)| ok && out.trim() == "true")
            .unwrap_or(false)
    }

    fn init(&self, root: &Path) -> Result<()> {
        let (ok, _, err) = run(root, &args(&["init", "-q"]))?;
        if !ok {
            return Err(anyhow!("git init failed: {}", err.trim()));
        }
        Ok(())
    }

    fn head(&self, root: &Path) -> Option<String> {
        run(root, &args(&["rev-parse", "-q", "--verify", "HEAD"]))
            .ok()
            .filter(|(ok, _, _)| *ok)
            .map(|(_, out, _)| out.trim().to_string())
    }

    fn commit_paths(&self, root: &Path, paths: &[String], message: &str) -> Result<Option<String>> {
        // 1. stage what exists (adds, modifications) and what was removed (tracked deletions).
        //    Unknown paths are expected here (e.g. an optional directory) and are ignored.
        for p in paths {
            let mut a = args(&["add", "-A", "--"]);
            a.push(p.clone());
            let _ = run(root, &a);
        }
        // 2. the files actually staged under these paths. Empty directories drop out here, which
        //    matters: `git commit -- <empty dir>` is an error.
        let mut d = args(&["diff", "--cached", "--name-only", "-z", "--"]);
        d.extend(paths.iter().cloned());
        let (_, out, _) = run(root, &d)?;
        let files: Vec<String> = out.split('\0').filter(|s| !s.is_empty()).map(|s| s.to_string()).collect();
        if files.is_empty() {
            return Ok(None);
        }
        // 3. commit exactly those files; anything else the user has staged stays staged
        let mut cmd = identity(root);
        cmd.extend(args(&["commit", "-q", "-m"]));
        cmd.push(message.to_string());
        cmd.push("--".into());
        cmd.extend(files);
        let (ok, _, err) = run(root, &cmd)?;
        if !ok {
            return Err(anyhow!("git commit failed: {}", err.trim()));
        }
        Ok(self.head(root))
    }

    fn blob_hash(&self, root: &Path, rev: &str, path: &str) -> Option<String> {
        let spec = format!("{rev}:{path}");
        run(root, &args(&["rev-parse", "-q", "--verify", &spec]))
            .ok()
            .filter(|(ok, _, _)| *ok)
            .map(|(_, out, _)| out.trim().to_string())
    }

    fn commit_isolated(
        &self,
        root: &Path,
        paths: &[String],
        message: &str,
        expected_head: Option<&str>,
    ) -> Result<Option<String>> {
        let current_head = self.head(root);
        if let Some(exp) = expected_head {
            if current_head.as_deref() != Some(exp) {
                return Err(anyhow!("HEAD moved: expected {exp}, found {:?}", current_head));
            }
        }
        let Some(head_sha) = current_head else {
            return self.commit_paths(root, paths, message);
        };

        let (ok, branch_out, _) = run(root, &args(&["symbolic-ref", "-q", "HEAD"]))?;
        let branch_ref = if ok && !branch_out.trim().is_empty() {
            branch_out.trim().to_string()
        } else {
            "HEAD".to_string()
        };

        let expanded = expand_paths(root, paths);
        let mut updates: Vec<(String, Option<(String, String)>)> = vec![];
        for p in &expanded {
            let abs = root.join(p);
            if abs.exists() && abs.is_file() {
                let clean_path = abs.to_string_lossy().replace('\\', "/");
                let clean_path = clean_path.strip_prefix("//?/").unwrap_or(&clean_path);
                let (h_ok, blob_sha, h_err) = run(root, &args(&["hash-object", "-w", "--path", p, clean_path]))?;
                if !h_ok {
                    return Err(anyhow!("git hash-object failed for {p}: {}", h_err.trim()));
                }
                let blob_sha = blob_sha.trim().to_string();
                #[cfg(unix)]
                let mode = {
                    use std::os::unix::fs::PermissionsExt;
                    let perm = std::fs::metadata(&abs).map(|m| m.permissions().mode()).unwrap_or(0o644);
                    if perm & 0o111 != 0 { "100755" } else { "100644" }
                };
                #[cfg(not(unix))]
                let mode = "100644";
                updates.push((p.clone(), Some((mode.to_string(), blob_sha))));
            } else if !abs.exists() {
                updates.push((p.clone(), None));
            }
        }

        if updates.is_empty() {
            return Ok(None);
        }

        let idx_nonce = blake3::hash(format!("{message}{}", std::process::id()).as_bytes()).to_hex()[..12].to_string();
        let tmp_idx = std::env::temp_dir().join(format!("afwe-index-{idx_nonce}"));
        let tmp_idx_str = tmp_idx.to_string_lossy().to_string();
        let idx_env = [("GIT_INDEX_FILE", tmp_idx_str.as_str())];

        let (rt_ok, _, rt_err) = run_with_env(root, &args(&["read-tree", &head_sha]), &idx_env)?;
        if !rt_ok {
            let _ = std::fs::remove_file(&tmp_idx);
            return Err(anyhow!("git read-tree failed: {}", rt_err.trim()));
        }

        for (p, entry) in updates {
            match entry {
                Some((mode, sha)) => {
                    let cacheinfo = format!("{mode},{sha},{p}");
                    let (ui_ok, _, ui_err) = run_with_env(root, &args(&["update-index", "--add", "--cacheinfo", &cacheinfo]), &idx_env)?;
                    if !ui_ok {
                        let _ = std::fs::remove_file(&tmp_idx);
                        return Err(anyhow!("git update-index cacheinfo failed for {p}: {}", ui_err.trim()));
                    }
                }
                None => {
                    let (ui_ok, _, _) = run_with_env(root, &args(&["update-index", "--force-remove", "--", &p]), &idx_env)?;
                    let _ = ui_ok;
                }
            }
        }

        let (wt_ok, tree_sha_out, wt_err) = run_with_env(root, &args(&["write-tree"]), &idx_env)?;
        let _ = std::fs::remove_file(&tmp_idx);
        if !wt_ok {
            return Err(anyhow!("git write-tree failed: {}", wt_err.trim()));
        }
        let tree_sha = tree_sha_out.trim().to_string();

        let (_, head_tree, _) = run(root, &args(&["rev-parse", &format!("{head_sha}^{{tree}}")]))?;
        if tree_sha == head_tree.trim() {
            return Ok(None);
        }

        let mut ct_args = identity(root);
        ct_args.extend(args(&["commit-tree", &tree_sha, "-p", &head_sha, "-m", message]));
        let (ct_ok, new_commit, ct_err) = run(root, &ct_args)?;
        if !ct_ok {
            return Err(anyhow!("git commit-tree failed: {}", ct_err.trim()));
        }
        let new_commit_sha = new_commit.trim().to_string();

        if branch_ref != "HEAD" {
            let (ur_ok, _, ur_err) = run(root, &args(&["update-ref", &branch_ref, &new_commit_sha, &head_sha]))?;
            if !ur_ok {
                return Err(anyhow!("git update-ref CAS failed: HEAD moved concurrently: {}", ur_err.trim()));
            }
        } else {
            let (ur_ok, _, ur_err) = run(root, &args(&["update-ref", "HEAD", &new_commit_sha]))?;
            if !ur_ok {
                return Err(anyhow!("git update-ref HEAD failed: {}", ur_err.trim()));
            }
        }

        Ok(Some(new_commit_sha))
    }

    fn show(&self, root: &Path, rev: &str, path: &str) -> Option<String> {
        let spec = format!("{rev}:{path}");
        run(root, &args(&["show", &spec])).ok().filter(|(ok, _, _)| *ok).map(|(_, out, _)| out)
    }

    fn log(&self, root: &Path) -> Result<Vec<CommitInfo>> {
        let (ok, out, err) = run(root, &args(&["log", "--format=%H%x1f%cI%x1f%B%x1e"]))?;
        if !ok {
            // no commits yet is not an error for the timeline
            if err.contains("does not have any commits") || err.contains("bad default revision") {
                return Ok(vec![]);
            }
            return Err(anyhow!("git log failed: {}", err.trim()));
        }
        let trailer = Regex::new(r"^([A-Za-z][A-Za-z0-9-]*): (.+)$").unwrap();
        let mut commits = vec![];
        for rec in out.split('\u{1e}') {
            let rec = rec.trim_matches('\n');
            if rec.is_empty() {
                continue;
            }
            let mut parts = rec.splitn(3, '\u{1f}');
            let sha = parts.next().unwrap_or_default().trim().to_string();
            let ts = parts.next().unwrap_or_default().trim().to_string();
            let body = parts.next().unwrap_or_default();
            let subject = body.lines().next().unwrap_or_default().to_string();
            let trailers = body
                .lines()
                .filter_map(|l| trailer.captures(l.trim_end()).map(|c| (c[1].to_string(), c[2].trim().to_string())))
                .collect();
            commits.push(CommitInfo { sha, ts, subject, trailers });
        }
        Ok(commits)
    }

    fn diff(&self, root: &Path, rev: &str, paths: &[String]) -> Result<String> {
        let mut a = args(&["show", "--format=", rev]);
        if !paths.is_empty() {
            a.push("--".into());
            a.extend(paths.iter().cloned());
        }
        let (ok, out, err) = run(root, &a)?;
        if !ok {
            return Err(anyhow!("git show failed: {}", err.trim()));
        }
        Ok(out)
    }

    fn diff_worktree(&self, root: &Path, paths: &[String]) -> Result<String> {
        let mut a = args(&["diff", "HEAD"]);
        if !paths.is_empty() {
            a.push("--".into());
            a.extend(paths.iter().cloned());
        }
        let (ok, out, err) = run(root, &a)?;
        if !ok {
            return Err(anyhow!("git diff failed: {}", err.trim()));
        }
        Ok(out)
    }

    fn stat(&self, root: &Path, rev: &str) -> Result<String> {
        let (_, out, _) = run(root, &args(&["show", "--stat", "--format=", rev]))?;
        Ok(out.trim().to_string())
    }

    fn parent(&self, root: &Path, rev: &str) -> Option<String> {
        let spec = format!("{rev}^");
        run(root, &args(&["rev-parse", "-q", "--verify", &spec]))
            .ok()
            .filter(|(ok, _, _)| *ok)
            .map(|(_, out, _)| out.trim().to_string())
    }

    fn merge3(&self, ours: &str, base: &str, theirs: &str) -> Result<(String, usize)> {
        static N: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir();
        let tag = format!("afwe-merge-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed));
        let (o, b, t) = (dir.join(format!("{tag}-ours")), dir.join(format!("{tag}-base")), dir.join(format!("{tag}-theirs")));
        std::fs::write(&o, ours)?;
        std::fs::write(&b, base)?;
        std::fs::write(&t, theirs)?;
        let out = Command::new("git")
            .args(["merge-file", "-p"])
            .arg(&o)
            .arg(&b)
            .arg(&t)
            .output()
            .context("could not run `git merge-file`");
        for p in [&o, &b, &t] {
            let _ = std::fs::remove_file(p);
        }
        let out = out?;
        // exit status = number of conflict regions; anything >127 is an error, not a count
        match out.status.code() {
            Some(c) if (0..=127).contains(&c) => Ok((String::from_utf8_lossy(&out.stdout).into_owned(), c as usize)),
            _ => Err(anyhow!("git merge-file failed: {}", String::from_utf8_lossy(&out.stderr).trim())),
        }
    }
}

impl GitProvider {
    pub fn worktree_add(root: &Path, path: &Path, branch: &str) -> Result<()> {
        let (ok, _, err) = run(root, &args(&["worktree", "add", "-b", branch, path.to_str().unwrap_or("")]))?;
        if !ok {
            return Err(anyhow!("git worktree add failed: {}", err.trim()));
        }
        Ok(())
    }

    pub fn worktree_remove(root: &Path, path: &Path) -> Result<()> {
        let (ok, _, err) = run(root, &args(&["worktree", "remove", "--force", path.to_str().unwrap_or("")]))?;
        if !ok {
            return Err(anyhow!("git worktree remove failed: {}", err.trim()));
        }
        Ok(())
    }

    pub fn merge_branch(root: &Path, branch: &str) -> Result<bool> {
        let (ok, _, err) = run(root, &args(&["merge", "--no-ff", "-m", &format!("Merge branch '{branch}'"), branch]))?;
        if !ok {
            return Err(anyhow!("git merge failed: {}", err.trim()));
        }
        Ok(true)
    }
}
