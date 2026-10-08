//! Pluggable version control. Git is the provider that ships; the trait is the seam for others
//! (Jujutsu, Sapling, Pijul, …). AFWE only needs seven things from a VCS: head, commit of an
//! explicit set of paths, file content at a revision, the commit log with trailers, diffs, parent,
//! and a 3-way merge of file contents. Nothing else leaks into the `.afwe/` folder.

pub mod git;

use anyhow::{anyhow, Result};
use std::path::Path;

#[derive(Debug, Clone, serde::Serialize)]
pub struct CommitInfo {
    pub sha: String,
    pub ts: String,
    pub subject: String,
    /// `Key: value` trailers found in the commit message (e.g. `AFWE-Turn: t0042`).
    pub trailers: Vec<(String, String)>,
}

impl CommitInfo {
    pub fn trailer(&self, key: &str) -> Option<&str> {
        self.trailers.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
    }
}

pub trait VcsProvider {
    fn name(&self) -> &'static str;
    /// Is `root` inside a repository this provider manages?
    fn is_repo(&self, root: &Path) -> bool;
    fn init(&self, root: &Path) -> Result<()>;
    fn head(&self, root: &Path) -> Option<String>;
    /// Stage exactly `paths` (project-relative files or directories) and commit only them, so
    /// anything else the user has staged or edited stays where it is. `None` = nothing to commit.
    fn commit_paths(&self, root: &Path, paths: &[String], message: &str) -> Result<Option<String>>;
    /// File content at a revision (`None` if it does not exist there).
    fn show(&self, root: &Path, rev: &str, path: &str) -> Option<String>;
    /// Commits, newest first.
    fn log(&self, root: &Path) -> Result<Vec<CommitInfo>>;
    /// Patch of a commit, optionally restricted to paths.
    fn diff(&self, root: &Path, rev: &str, paths: &[String]) -> Result<String>;
    /// Working-tree changes against HEAD, optionally restricted to paths.
    fn diff_worktree(&self, root: &Path, paths: &[String]) -> Result<String>;
    /// `--stat` summary of a commit.
    fn stat(&self, root: &Path, rev: &str) -> Result<String>;
    fn parent(&self, root: &Path, rev: &str) -> Option<String>;
    /// 3-way merge of file contents: (merged text, number of conflict regions).
    fn merge3(&self, ours: &str, base: &str, theirs: &str) -> Result<(String, usize)>;
}

/// Provider for projects without version control: turns are recorded, not committed.
pub struct NoVcs;

impl VcsProvider for NoVcs {
    fn name(&self) -> &'static str {
        "none"
    }
    fn is_repo(&self, _root: &Path) -> bool {
        false
    }
    fn init(&self, _root: &Path) -> Result<()> {
        Err(anyhow!("no version control provider configured (vcs.provider = none)"))
    }
    fn head(&self, _root: &Path) -> Option<String> {
        None
    }
    fn commit_paths(&self, _root: &Path, _paths: &[String], _message: &str) -> Result<Option<String>> {
        Ok(None)
    }
    fn show(&self, _root: &Path, _rev: &str, _path: &str) -> Option<String> {
        None
    }
    fn log(&self, _root: &Path) -> Result<Vec<CommitInfo>> {
        Ok(vec![])
    }
    fn diff(&self, _root: &Path, _rev: &str, _paths: &[String]) -> Result<String> {
        Err(anyhow!("no version control: nothing to diff"))
    }
    fn diff_worktree(&self, _root: &Path, _paths: &[String]) -> Result<String> {
        Err(anyhow!("no version control: nothing to diff"))
    }
    fn stat(&self, _root: &Path, _rev: &str) -> Result<String> {
        Ok(String::new())
    }
    fn parent(&self, _root: &Path, _rev: &str) -> Option<String> {
        None
    }
    fn merge3(&self, _ours: &str, _base: &str, _theirs: &str) -> Result<(String, usize)> {
        Err(anyhow!("3-way merge needs a version control provider (git)"))
    }
}

/// Provider named in `afwe.yaml` (`vcs.provider`).
pub fn open(provider: &str) -> Box<dyn VcsProvider> {
    match provider {
        "git" => Box::new(git::GitProvider),
        _ => Box::new(NoVcs),
    }
}
