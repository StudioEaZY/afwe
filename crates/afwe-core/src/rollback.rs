//! External undo detection and rollback reconciliation.
//!
//! Reconciles AFWE ledger state when git commits or file edits are reverted
//! out-of-band (e.g. IDE Ctrl+Z, `git reset --hard`, or a harness "revert files").
//!
//! P0 policy: a classification never destroys anything.
//!
//! * A **confirmed** rewind (the turn's commit is reachable from no ref) marks the turn
//!   `undone_externally` and puts its generated checks to sleep. Memory is untouched.
//! * A **possible** rewind (files match the pre-commit baseline) is reported only.
//! * A git failure produces no verdict at all, never a mass undo.

use crate::engine::Engine;
use crate::model::*;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RewindVerdict {
    /// The commit is gone from every ref. The turn was undone outside AFWE.
    Confirmed,
    /// Files match the pre-commit baseline. Reported, never acted on.
    Possible,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RollbackEvent {
    pub turn_id: String,
    pub reason: String,
    pub verdict: RewindVerdict,
    /// Checks put to sleep. Always 0 for `Possible`.
    pub dormant_checks: usize,
}

/// What the commit graph says about a turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CommitVerdict {
    /// The recorded commit is reachable from some local ref.
    Present,
    /// The recorded commit is gone, but a trailer still names the turn: an amend, rebase or
    /// squash rewrote it, or it lives on another ref.
    Rewritten,
    /// No ref holds it and no trailer names it.
    Undone,
    /// Git could not answer. Never treated as an undo.
    Unknown,
}

fn git(root: &Path, args: &[&str]) -> Option<String> {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Every commit reachable from any local ref. No fixed window, no HEAD-only scan, so a branch
/// switch or a rebase no longer hides a turn.
fn reachable_commits(root: &Path) -> Option<BTreeSet<String>> {
    let text = git(root, &["rev-list", "--all"])?;
    Some(
        text.lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_string)
            .collect(),
    )
}

/// Turn identities found in `AFWE-Turn:` / `AFWE-Turn-Hash:` trailers across every local ref.
/// Built once per pass, and only when a recorded commit sha cannot answer on its own.
fn trailer_index(root: &Path) -> Option<BTreeSet<String>> {
    let text = git(root, &["log", "--all", "--format=%B"])?;
    let mut found = BTreeSet::new();
    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("AFWE-Turn:") {
            let value = rest.trim();
            found.insert(value.to_string());
            if let Some(alias) = value.split_whitespace().next() {
                found.insert(alias.to_string());
            }
        } else if let Some(rest) = line.strip_prefix("AFWE-Turn-Hash:") {
            found.insert(rest.trim().to_string());
        }
    }
    Some(found)
}

/// Decide purely from the two indexes, so the policy is testable without a repository.
fn commit_verdict(
    turn: &Turn,
    reachable: Option<&BTreeSet<String>>,
    trailers: Option<&BTreeSet<String>>,
) -> CommitVerdict {
    let sha = turn.commit_sha.as_deref().filter(|s| !s.is_empty());
    if let (Some(sha), Some(set)) = (sha, reachable) {
        if set.contains(sha) {
            return CommitVerdict::Present;
        }
    }

    // Without a sha and without recorded file state there is nothing to test against.
    if sha.is_none() && turn.post_hashes.is_empty() {
        return CommitVerdict::Unknown;
    }

    let Some(index) = trailers else {
        return CommitVerdict::Unknown;
    };
    let named = index.contains(&turn.id)
        || turn
            .alias
            .as_deref()
            .map(|alias| index.contains(alias))
            .unwrap_or(false)
        || (!turn.turn_hash.is_empty() && index.contains(&turn.turn_hash));
    if named {
        CommitVerdict::Rewritten
    } else {
        CommitVerdict::Undone
    }
}

fn undone_reason(turn: &Turn) -> String {
    match turn.commit_sha.as_deref().filter(|s| !s.is_empty()) {
        Some(sha) => {
            format!("commit {sha} is unreachable from every ref and no trailer names the turn")
        }
        None => "no reachable commit and no trailer names the turn".to_string(),
    }
}

/// Put a rewound turn's generated checks to sleep. Nothing is deleted, so restoring the turn
/// can revive them.
fn put_checks_to_sleep(engine: &Engine, turn_id: &str) -> Result<usize> {
    let mut dormant = 0;
    for mut check in engine.store.checks()? {
        if check.created_from.as_deref() == Some(turn_id) && check.status == "active" {
            check.status = "dormant".into();
            engine.store.save_check(&check)?;
            dormant += 1;
        }
    }
    Ok(dormant)
}

/// Advisory only: do the files still look like the state the turn started from?
fn baseline_mismatch(engine: &Engine, turn: &Turn) -> Option<String> {
    if turn.post_hashes.is_empty() {
        return None;
    }
    let baseline = engine.store.baseline(&turn.id).ok().flatten()?;
    let root = &engine.store.project_root;
    let (mut matches_pre, mut matches_post) = (0usize, 0usize);

    for (file, post_hash) in &turn.post_hashes {
        let Ok(bytes) = std::fs::read(root.join(file)) else {
            continue;
        };
        let current = crate::util::hash_bytes(&bytes);
        if &current == post_hash {
            matches_post += 1;
        } else if baseline.files.get(file) == Some(&current) {
            matches_pre += 1;
        }
    }

    if matches_pre > 0 && matches_post == 0 {
        Some(format!(
            "{matches_pre} file(s) match the pre-commit baseline instead of the committed state; possible file rewind, nothing was changed"
        ))
    } else {
        None
    }
}

/// A `ready` turn adopted into the ledger because a manual git commit carries its trailer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Promotion {
    pub turn_id: String,
    pub commit_sha: String,
}

/// Turn identity -> newest commit that carries it, across every local ref.
fn commit_index(root: &Path) -> Option<BTreeMap<String, String>> {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["log", "--all", "--format=%H%x1f%B%x1e"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut index: BTreeMap<String, String> = BTreeMap::new();
    for record in text.split('\x1e') {
        let mut fields = record.splitn(2, '\x1f');
        let sha = fields.next().unwrap_or("").trim();
        let body = fields.next().unwrap_or("");
        if sha.is_empty() {
            continue;
        }
        for line in body.lines() {
            let line = line.trim();
            if let Some(rest) = line.strip_prefix("AFWE-Turn:") {
                let value = rest.trim();
                index.entry(value.to_string()).or_insert_with(|| sha.to_string());
                if let Some(alias) = value.split_whitespace().next() {
                    index.entry(alias.to_string()).or_insert_with(|| sha.to_string());
                }
            } else if let Some(rest) = line.strip_prefix("AFWE-Turn-Hash:") {
                index.entry(rest.trim().to_string()).or_insert_with(|| sha.to_string());
            }
        }
    }
    Some(index)
}

/// Engineer mode ends `turn commit` at `ready` and the human commits with git. Adopt those turns
/// once a commit carrying their trailer exists, so rewind detection can see them. Idempotent: a
/// turn with a recorded commit, or with no matching trailer, is left alone.
pub fn promote_manual_commits(engine: &Engine) -> Result<Vec<Promotion>> {
    let root = engine.store.project_root.as_path();
    if !root.join(".git").exists() {
        return Ok(vec![]);
    }

    let candidates: Vec<Turn> = engine
        .store
        .turns()?
        .into_iter()
        .filter(|t| t.status == "ready")
        .filter(|t| t.commit_sha.as_deref().map(str::is_empty).unwrap_or(true))
        .collect();
    if candidates.is_empty() {
        return Ok(vec![]);
    }

    let Some(index) = commit_index(root) else {
        return Ok(vec![]);
    };

    let mut promoted = Vec::new();
    let mut seen = BTreeSet::new();
    for mut turn in candidates {
        // save_turn currently writes a record under both its turn_hash and its alias, so turns()
        // returns the same turn twice. Promotion must run once per turn.
        if !seen.insert(turn.id.clone()) {
            continue;
        }
        let sha = index
            .get(&turn.id)
            .or_else(|| turn.alias.as_deref().and_then(|alias| index.get(alias)))
            .or_else(|| {
                if turn.turn_hash.is_empty() {
                    None
                } else {
                    index.get(&turn.turn_hash)
                }
            })
            .cloned();
        let Some(sha) = sha else {
            continue;
        };

        let label = turn.alias.clone().unwrap_or_else(|| turn.id.clone());
        turn.status = "committed".into();
        turn.commit_sha = Some(sha.clone());
        turn.committed_at = Some(crate::util::now());
        engine.store.save_turn(&turn)?;

        let _ = crate::ledger::append(
            engine,
            "turn_committed_manual",
            json!({
                "turn": label,
                "turn_hash": &turn.turn_hash,
                "commit_sha": &sha,
            }),
        );
        engine.log(
            "afwe:reconcile",
            "turn_committed_manual",
            format!("{label} was committed with git; adopted into the ledger at {sha}"),
            Some(json!({"turn": label, "commit_sha": sha})),
        )?;

        promoted.push(Promotion { turn_id: label, commit_sha: sha });
    }

    Ok(promoted)
}

pub fn reconcile(engine: &Engine) -> Result<Vec<RollbackEvent>> {
    let turns = engine.store.turns()?;
    let committed: Vec<&Turn> = turns.iter().filter(|t| t.status == "committed").collect();

    if committed.is_empty() {
        return Ok(vec![]);
    }

    let root = engine.store.project_root.as_path();
    let vcs_active = root.join(".git").exists();
    let reachable = if vcs_active {
        reachable_commits(root)
    } else {
        None
    };

    // Built at most once per pass, and only for turns a sha cannot answer for.
    let mut trailers: Option<Option<BTreeSet<String>>> = None;
    let mut events = Vec::new();

    for turn in committed {
        let verdict = if vcs_active {
            let answered_by_sha = match (reachable.as_ref(), turn.commit_sha.as_deref()) {
                (Some(set), Some(sha)) if !sha.is_empty() => set.contains(sha),
                _ => false,
            };
            if !answered_by_sha && trailers.is_none() {
                trailers = Some(trailer_index(root));
            }
            let index = trailers.as_ref().and_then(|entry| entry.as_ref());
            commit_verdict(turn, reachable.as_ref(), index)
        } else {
            CommitVerdict::Unknown
        };

        if verdict == CommitVerdict::Undone {
            let reason = undone_reason(turn);
            let dormant = put_checks_to_sleep(engine, &turn.id)?;

            let mut updated = turn.clone();
            updated.status = "undone_externally".into();
            engine.store.save_turn(&updated)?;

            engine.log(
                "afwe:reconcile",
                "turn_rewound",
                format!(
                    "{} was reverted outside AFWE; {dormant} check(s) marked dormant ({reason})",
                    turn.id
                ),
                Some(json!({
                    "turn": turn.id,
                    "verdict": "confirmed",
                    "reason": reason,
                    "dormant_checks": dormant,
                })),
            )?;

            events.push(RollbackEvent {
                turn_id: turn.id.clone(),
                reason,
                verdict: RewindVerdict::Confirmed,
                dormant_checks: dormant,
            });
        } else if verdict == CommitVerdict::Rewritten {
            engine.log(
                "afwe:reconcile",
                "turn_commit_rewritten",
                format!(
                    "{} is not at its recorded commit any more, but a trailer still names it; nothing was changed",
                    turn.id
                ),
                Some(json!({"turn": turn.id, "commit_sha": turn.commit_sha})),
            )?;
        }

        // Advisory only: never mutates and never gates. Keeps file-level rewinds visible
        // until tree snapshots land in P2.
        if verdict != CommitVerdict::Undone {
            if let Some(reason) = baseline_mismatch(engine, turn) {
                engine.log(
                    "afwe:reconcile",
                    "turn_possible_rewind",
                    format!("{}: {reason}", turn.id),
                    Some(json!({"turn": turn.id, "verdict": "possible"})),
                )?;
                events.push(RollbackEvent {
                    turn_id: turn.id.clone(),
                    reason,
                    verdict: RewindVerdict::Possible,
                    dormant_checks: 0,
                });
            }
        }
    }

    Ok(events)
}

pub fn undo_turn(engine: &Engine, turn_id: &str, origin: &str) -> Result<Value> {
    let mut turn = engine.store.turn(turn_id)?.ok_or_else(|| anyhow!("turn `{turn_id}` not found"))?;
    if turn.status != "committed" {
        return Err(anyhow!("can only undo committed turns; `{turn_id}` has status `{}`", turn.status));
    }

    let root = &engine.store.project_root;

    // Revert git commit if git is active
    if root.join(".git").exists() {
        let _ = std::process::Command::new("git")
            .arg("-C")
            .arg(root)
            .args(["revert", "--no-edit", "-m", "1", "HEAD"])
            .output();
    }

    turn.status = "reverted".into();

    // Prune checks
    let checks = engine.store.checks()?;
    let mut pruned_checks = 0;
    for c in &checks {
        if c.created_from.as_deref() == Some(turn_id) {
            let _ = engine.store.remove_check_file(&c.id);
            pruned_checks += 1;
        }
    }

    engine.store.save_turn(&turn)?;
    engine.log(
        origin,
        "turn_undo",
        format!("{turn_id} explicitly undone via afwe turn undo"),
        Some(json!({"turn": turn_id, "pruned_checks": pruned_checks})),
    )?;

    Ok(json!({
        "turn": turn_id,
        "status": "reverted",
        "pruned_checks": pruned_checks,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init::{init, InitOptions};

    fn set(items: &[&str]) -> BTreeSet<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    fn turn_with(sha: Option<&str>, turn_hash: &str, post: &[(&str, &str)]) -> Turn {
        let mut turn = Turn {
            id: "t0100".into(),
            status: "committed".into(),
            prompt: "test".into(),
            ..Default::default()
        };
        turn.commit_sha = sha.map(str::to_string);
        turn.turn_hash = turn_hash.into();
        for (file, hash) in post {
            turn.post_hashes.insert((*file).to_string(), (*hash).to_string());
        }
        turn
    }

    #[test]
    fn reachable_commit_is_present() {
        let turn = turn_with(Some("aaa"), "turn-x", &[]);
        let reachable = set(&["aaa", "bbb"]);
        assert_eq!(commit_verdict(&turn, Some(&reachable), None), CommitVerdict::Present);
    }

    #[test]
    fn rewritten_commit_is_found_by_trailer() {
        let turn = turn_with(Some("aaa"), "turn-x", &[("src/lib.rs", "h1")]);
        let reachable = set(&["ccc"]);
        let trailers = set(&["AFWE-Turn: t0100", "t0100"]);
        assert_eq!(
            commit_verdict(&turn, Some(&reachable), Some(&trailers)),
            CommitVerdict::Rewritten
        );
    }

    #[test]
    fn missing_commit_and_missing_trailer_is_undone() {
        let turn = turn_with(Some("aaa"), "turn-x", &[("src/lib.rs", "h1")]);
        let reachable = set(&["ccc"]);
        let trailers = set(&["t9999"]);
        assert_eq!(
            commit_verdict(&turn, Some(&reachable), Some(&trailers)),
            CommitVerdict::Undone
        );
    }

    #[test]
    fn git_failure_is_unknown_not_undone() {
        let turn = turn_with(Some("aaa"), "turn-x", &[("src/lib.rs", "h1")]);
        assert_eq!(commit_verdict(&turn, None, None), CommitVerdict::Unknown);
    }

    #[test]
    fn turn_without_sha_or_state_is_unknown() {
        let turn = turn_with(None, "turn-x", &[]);
        assert_eq!(commit_verdict(&turn, Some(&set(&[])), None), CommitVerdict::Unknown);
    }

    #[test]
    fn reconcile_outside_git_touches_nothing() {
        let dir = std::env::temp_dir().join(format!("afwe-reconcile-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let store = init(
            &dir,
            InitOptions { name: Some("reconcile-test".into()), description: None, root: None, force: true },
        )
        .unwrap();
        let engine = Engine { store };

        let mut turn = turn_with(Some("deadbeef"), "turn-x", &[("src/lib.rs", "h1")]);
        turn.id = "t0101".into();
        engine.store.save_turn(&turn).unwrap();

        let events = reconcile(&engine).unwrap();
        assert!(events.is_empty(), "no git means no verdict");
        assert_eq!(engine.store.turn("t0101").unwrap().unwrap().status, "committed");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_undo_prunes_generated_checks() {
        let dir = std::env::temp_dir().join(format!("afwe-undo-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let store = init(&dir, InitOptions { name: Some("undo-test".into()), description: None, root: None, force: true }).unwrap();
        let engine = Engine { store };

        // Save a turn with a generated check
        let turn = Turn {
            id: "t0099".into(),
            status: "committed".into(),
            prompt: "add check".into(),
            ..Default::default()
        };
        engine.store.save_turn(&turn).unwrap();

        let check = CheckSpec {
            id: "c-test".into(),
            title: "test check".into(),
            trust: CheckTrust::Generated,
            authored_by: "agent".into(),
            attaches: Attachment::default(),
            command: Some("exit 0".into()),
            claim: None,
            timeout_s: None,
            status: "active".into(),
            origin: None,
            created: None,
            created_from: Some("t0099".into()),
            superseded_by: None,
            provenance: None,
        };
        engine.store.save_check(&check).unwrap();
        assert_eq!(engine.store.checks().unwrap().len(), 1);

        // Undo turn
        let res = undo_turn(&engine, "t0099", "human").unwrap();
        assert_eq!(res["status"], "reverted");
        assert_eq!(res["pruned_checks"], 1);
        assert_eq!(engine.store.checks().unwrap().len(), 0);

        let _ = std::fs::remove_dir_all(&dir);
    }

    fn git_in(dir: &std::path::Path, args: &[&str]) {
        let status = std::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .status()
            .unwrap();
        assert!(status.success(), "git {args:?} failed");
    }

    fn ready_repo(name: &str, message: &str) -> (std::path::PathBuf, Engine) {
        let dir = std::env::temp_dir().join(format!("afwe-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        git_in(&dir, &["init", "-q"]);
        std::fs::write(dir.join("a.txt"), "x").unwrap();
        git_in(&dir, &["add", "a.txt"]);
        git_in(
            &dir,
            &["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", message],
        );
        let store = init(
            &dir,
            InitOptions { name: Some(name.into()), description: None, root: None, force: true },
        )
        .unwrap();
        (dir, Engine { store })
    }

    #[test]
    fn promotes_a_ready_turn_when_git_carries_its_trailer() {
        let (dir, engine) = ready_repo("promote", "manual commit\n\nAFWE-Turn: t0102");
        let mut turn = turn_with(None, "turn-p", &[]);
        turn.id = "t0102".into();
        turn.alias = Some("t0102".into());
        turn.status = "ready".into();
        engine.store.save_turn(&turn).unwrap();

        let promoted = promote_manual_commits(&engine).unwrap();
        assert_eq!(promoted.len(), 1, "{promoted:?}");
        assert_eq!(promoted[0].turn_id, "t0102");

        let stored = engine.store.turn("t0102").unwrap().unwrap();
        assert_eq!(stored.status, "committed");
        assert!(stored.commit_sha.is_some());
        assert!(stored.committed_at.is_some());

        assert!(
            promote_manual_commits(&engine).unwrap().is_empty(),
            "a second pass must promote nothing"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ready_turn_without_a_trailer_stays_ready() {
        let (dir, engine) = ready_repo("nopromote", "manual commit with no trailer");
        let mut turn = turn_with(None, "turn-q", &[]);
        turn.id = "t0103".into();
        turn.alias = Some("t0103".into());
        turn.status = "ready".into();
        engine.store.save_turn(&turn).unwrap();

        assert!(promote_manual_commits(&engine).unwrap().is_empty());
        assert_eq!(engine.store.turn("t0103").unwrap().unwrap().status, "ready");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
