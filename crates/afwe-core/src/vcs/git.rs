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
    let out = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .context("could not run `git` (is it installed and on PATH?)")?;
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
