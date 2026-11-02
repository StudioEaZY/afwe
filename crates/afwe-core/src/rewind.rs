//! Rewind classification: compare the current tree with the ledger's expected tree and classify a
//! difference using the local snapshot history.
//!
//! P2 policy: a classification never blocks a turn, never restores a file, and never deletes. It
//! writes one aggregated receipt and the next `turn.begin` briefing carries it.

use crate::engine::Engine;
use crate::{ledger, snapshots};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub const STATE_PATH: &str = "state/rewind.json";
const MAX_RECEIPTS: usize = 20;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PathChange {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matched_snapshot: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matched_turn: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matched_phase: Option<String>,
    #[serde(default)]
    pub ambiguous: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RewindReceipt {
    pub id: String,
    pub detected_at: String,
    /// REWOUND | COMPOUND | UNATTRIBUTED
    pub verdict: String,
    pub exact: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_turn: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_snapshot: Option<String>,
    pub paths: Vec<PathChange>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub turns_undone: Vec<String>,
    pub note: String,
    pub state_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ReceiptState {
    #[serde(default = "one")]
    version: u32,
    #[serde(default)]
    last_state: String,
    #[serde(default)]
    receipts: Vec<RewindReceipt>,
}

fn one() -> u32 {
    1
}

#[derive(Debug, Clone)]
struct Hit {
    snapshot: snapshots::SnapshotMeta,
}

fn label(turn: &crate::model::Turn) -> String {
    turn.alias
        .clone()
        .filter(|alias| !alias.is_empty())
        .unwrap_or_else(|| turn.id.clone())
}

fn state(engine: &Engine) -> ReceiptState {
    engine
        .store
        .read_json::<ReceiptState>(STATE_PATH)
        .ok()
        .flatten()
        .unwrap_or_default()
}

/// Receipts already recorded, newest first.
pub fn receipts(engine: &Engine) -> Result<Vec<RewindReceipt>> {
    Ok(state(engine).receipts)
}

pub fn format_notice(receipt: &RewindReceipt) -> String {
    let paths = receipt
        .paths
        .iter()
        .take(4)
        .map(|path| path.path.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    let more = receipt.paths.len().saturating_sub(4);
    format!(
        "{} rewind receipt: {} path(s) changed ({}{}); {} turn(s) possibly undone{}",
        receipt.verdict,
        receipt.paths.len(),
        paths,
        if more > 0 { format!(", +{more}") } else { String::new() },
        receipt.turns_undone.len(),
        receipt
            .to_snapshot
            .as_deref()
            .map(|snap| format!(", matched {snap}"))
            .unwrap_or_default()
    )
}

/// Classify the current tree against the ledger's expected tree. `None` means "nothing changed" or
/// "this exact difference was already receipted".
pub fn classify(engine: &Engine) -> Result<Option<RewindReceipt>> {
    let Some(expected) = ledger::expected(engine)? else {
        return Ok(None);
    };
    let root = engine.store.project_root.as_path();
    let mut current: BTreeMap<String, String> = BTreeMap::new();
    for path in expected.paths.keys() {
        if let Ok(bytes) = std::fs::read(root.join(path)) {
            current.insert(path.clone(), crate::util::hash_bytes(&bytes));
        }
    }
    let changed: Vec<String> = expected
        .paths
        .iter()
        .filter(|(path, hash)| current.get(*path) != Some(*hash))
        .map(|(path, _)| path.clone())
        .collect();
    if changed.is_empty() {
        return Ok(None);
    }

    let mut state_hash_input = String::new();
    for path in &changed {
        state_hash_input.push_str(path);
        state_hash_input.push('\0');
        state_hash_input.push_str(current.get(path).map(String::as_str).unwrap_or("-"));
        state_hash_input.push('\n');
    }
    let state_hash = crate::util::hash_bytes(state_hash_input.as_bytes());

    let previous = state(engine);
    if previous.last_state == state_hash {
        return Ok(None);
    }

    let snaps = snapshots::list(engine)?;
    let mut hits: BTreeMap<String, Vec<Hit>> = BTreeMap::new();
    for snap in &snaps {
        let hashes = snapshots::hashes(engine, snap);
        for path in &changed {
            let Some(current_hash) = current.get(path) else { continue };
            if hashes.get(path) == Some(current_hash) {
                hits.entry(path.clone()).or_default().push(Hit {
                    snapshot: snap.clone(),
                });
            }
        }
    }

    let mut path_changes: Vec<PathChange> = Vec::new();
    let mut matched_groups: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for path in &changed {
        let matches = hits.get(path);
        let chosen = matches.and_then(|list| list.first());
        let mut change = PathChange {
            path: path.clone(),
            expected: expected.paths.get(path).cloned(),
            current: current.get(path).cloned(),
            matched_snapshot: chosen.map(|hit| hit.snapshot.id.clone()),
            matched_turn: chosen.and_then(|hit| hit.snapshot.turn.clone()),
            matched_phase: chosen.map(|hit| hit.snapshot.phase.clone()),
            ambiguous: matches.map(|list| list.len() > 1).unwrap_or(false),
        };
        if let Some(hit) = chosen {
            matched_groups
                .entry(hit.snapshot.id.clone())
                .or_default()
                .push(path.clone());
            change.ambiguous = matches.map(|list| list.len() > 1).unwrap_or(false);
        }
        path_changes.push(change);
    }

    let matched_count = path_changes
        .iter()
        .filter(|change| change.matched_snapshot.is_some())
        .count();
    let distinct: Vec<&String> = matched_groups.keys().collect();
    let verdict = if changed.is_empty() {
        return Ok(None);
    } else if matched_count == changed.len() && distinct.len() == 1 {
        "REWOUND"
    } else if matched_count == 0 {
        "UNATTRIBUTED"
    } else {
        "COMPOUND"
    };

    let to_snapshot = if distinct.len() == 1 {
        distinct.first().map(|id| (*id).clone())
    } else {
        None
    };
    let snapshot_hashes = to_snapshot
        .as_deref()
        .and_then(|id| snaps.iter().find(|snap| snap.id == id))
        .map(|snap| snapshots::hashes(engine, snap))
        .unwrap_or_default();
    let exact = verdict == "REWOUND"
        && expected
            .paths
            .iter()
            .all(|(path, hash)| snapshot_hashes.get(path) == Some(hash))
        && expected
            .paths
            .iter()
            .all(|(path, _)| current.get(path) == snapshot_hashes.get(path));

    let mut turns_undone: Vec<String> = Vec::new();
    if let Some(snapshot) = to_snapshot
        .as_deref()
        .and_then(|id| snaps.iter().find(|snap| snap.id == id))
    {
        let ordered = ledger::turns(engine)?;
        if let Some(start) = snapshot
            .turn
            .as_deref()
            .and_then(|turn| ordered.iter().position(|candidate| label(candidate) == turn))
        {
            let from = if snapshot.phase == "begin" { start } else { start + 1 };
            turns_undone = ordered.iter().skip(from).map(label).collect();
        }
    }

    let id = format!("rw-{}", &state_hash[..12.min(state_hash.len())]);
    let note = match verdict {
        "REWOUND" if exact => "the current tree exactly matches an earlier snapshot".to_string(),
        "REWOUND" => "the changed paths match an earlier snapshot".to_string(),
        "COMPOUND" => "some changed paths match older content and others are new".to_string(),
        _ => "changed content matches no recorded snapshot; this is new or unattributed work".to_string(),
    };
    let receipt = RewindReceipt {
        id,
        detected_at: crate::util::now(),
        verdict: verdict.to_string(),
        exact,
        from_turn: expected.turn.clone(),
        to_snapshot,
        paths: path_changes,
        turns_undone,
        note,
        state_hash: state_hash.clone(),
    };

    let mut next = previous;
    next.version = 1;
    next.last_state = state_hash;
    next.receipts.insert(0, receipt.clone());
    next.receipts.truncate(MAX_RECEIPTS);
    let _ = engine.store.write_json(STATE_PATH, &next);
    let kind = if receipt.exact {
        "rewind_confirmed"
    } else {
        "rewind_possible"
    };
    let _ = ledger::append(engine, kind, json!(receipt));
    Ok(Some(receipt))
}

/// Human/JSON summary for `afwe rewind list`.
pub fn list(engine: &Engine) -> Result<Value> {
    let receipts = receipts(engine)?;
    Ok(json!({
        "count": receipts.len(),
        "receipts": receipts,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init::{init, InitOptions};
    use crate::model::Turn;
    use std::process::Command;

    fn repo(name: &str) -> (std::path::PathBuf, Engine) {
        let dir = std::env::temp_dir().join(format!("afwe-rewind-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("src/a.txt"), "one\n").unwrap();
        let status = Command::new("git").arg("-C").arg(&dir).args(["init", "-q"]).status().unwrap();
        assert!(status.success());
        let store = init(
            &dir,
            InitOptions { name: Some(name.into()), description: None, root: None, force: true },
        )
        .unwrap();
        (dir, Engine { store })
    }

    fn expected(engine: &Engine, turn: &str, path: &str, body: &str) {
        let mut hashes = BTreeMap::new();
        hashes.insert(path.to_string(), crate::util::hash_bytes(body.as_bytes()));
        let turn = Turn {
            id: turn.into(),
            alias: Some(turn.into()),
            turn_hash: format!("turn-{turn}"),
            prompt: "test".into(),
            status: "committed".into(),
            ts: crate::util::now(),
            post_hashes: hashes.clone(),
            ..Default::default()
        };
        ledger::record_turn(engine, &turn, "turn_committed", Some(&hashes), true).unwrap();
    }

    #[test]
    fn a_file_revert_is_rewound_to_the_begin_snapshot() {
        let (dir, engine) = repo("rewound");
        let _s1 = snapshots::create(&engine, "begin", Some("t0001")).unwrap();
        std::fs::write(dir.join("src/a.txt"), "two\n").unwrap();
        let _s2 = snapshots::create(&engine, "end", Some("t0001")).unwrap();
        expected(&engine, "t0001", "src/a.txt", "two\n");

        std::fs::write(dir.join("src/a.txt"), "one\n").unwrap();
        let receipt = classify(&engine).unwrap().expect("a rewind must be classified");
        assert_eq!(receipt.verdict, "REWOUND", "{receipt:?}");
        assert_eq!(receipt.turns_undone, vec!["t0001".to_string()]);
        assert!(receipt.to_snapshot.is_some());
        assert!(receipt.paths[0].matched_snapshot.is_some());

        assert!(classify(&engine).unwrap().is_none(), "the same difference is receipted once");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn new_content_is_unattributed_not_a_rewind() {
        let (dir, engine) = repo("new");
        let _ = snapshots::create(&engine, "begin", Some("t0001")).unwrap();
        std::fs::write(dir.join("src/a.txt"), "two\n").unwrap();
        let _ = snapshots::create(&engine, "end", Some("t0001")).unwrap();
        expected(&engine, "t0001", "src/a.txt", "two\n");

        std::fs::write(dir.join("src/a.txt"), "three\n").unwrap();
        let receipt = classify(&engine).unwrap().expect("a difference must be receipted");
        assert_eq!(receipt.verdict, "UNATTRIBUTED", "{receipt:?}");
        assert!(receipt.turns_undone.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn mixed_old_and_new_content_is_compound() {
        let (dir, engine) = repo("compound");
        std::fs::write(dir.join("src/b.txt"), "one\n").unwrap();
        let _ = snapshots::create(&engine, "begin", Some("t0001")).unwrap();
        std::fs::write(dir.join("src/a.txt"), "two\n").unwrap();
        std::fs::write(dir.join("src/b.txt"), "two\n").unwrap();
        let _ = snapshots::create(&engine, "end", Some("t0001")).unwrap();
        let mut hashes = BTreeMap::new();
        hashes.insert("src/a.txt".into(), crate::util::hash_bytes(b"two\n"));
        hashes.insert("src/b.txt".into(), crate::util::hash_bytes(b"two\n"));
        let turn = Turn {
            id: "t0001".into(),
            alias: Some("t0001".into()),
            turn_hash: "turn-t0001".into(),
            prompt: "test".into(),
            status: "committed".into(),
            ts: crate::util::now(),
            post_hashes: hashes.clone(),
            ..Default::default()
        };
        ledger::record_turn(&engine, &turn, "turn_committed", Some(&hashes), true).unwrap();

        std::fs::write(dir.join("src/a.txt"), "one\n").unwrap();
        std::fs::write(dir.join("src/b.txt"), "three\n").unwrap();
        let receipt = classify(&engine).unwrap().expect("a difference must be receipted");
        assert_eq!(receipt.verdict, "COMPOUND", "{receipt:?}");
        assert_eq!(receipt.paths.len(), 2);
        assert_eq!(
            receipt.paths.iter().filter(|path| path.matched_snapshot.is_some()).count(),
            1,
            "{receipt:?}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
