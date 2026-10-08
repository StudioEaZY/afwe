//! The timeline: an intent-indexed history. Nothing here is stored separately: commits are read from
//! git (`AFWE-Turn:` trailers) and turn records from `.afwe/turns/`. It is rebuildable at any time.

use crate::engine::Engine;
use crate::mapping::NodeTable;
use crate::model::*;
use crate::turn;
use crate::util::{slug, truncate};
use crate::vcs::{self, CommitInfo};
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

fn commits_by_turn(engine: &Engine) -> Result<BTreeMap<String, CommitInfo>> {
    let m = engine.store.manifest()?;
    let vcs = vcs::open(&m.vcs.provider);
    let mut out = BTreeMap::new();
    if !vcs.is_repo(&engine.store.project_root) {
        return Ok(out);
    }
    for c in vcs.log(&engine.store.project_root)? {
        if let Some(t) = c.trailer("AFWE-Turn").map(|s| s.to_string()) {
            out.entry(t).or_insert(c);
        }
    }
    Ok(out)
}

fn short(sha: &str) -> String {
    sha.chars().take(7).collect()
}

fn first_line(s: &str) -> String {
    truncate(s.lines().next().unwrap_or("").trim(), 160)
}

/// A `ready` turn that an engineer committed with plain git is committed: the trailer is the proof.
fn effective_status(t: &Turn, c: Option<&CommitInfo>) -> String {
    if c.is_some() && t.status == "ready" {
        "committed".into()
    } else {
        t.status.clone()
    }
}

fn entry(t: &Turn, c: Option<&CommitInfo>) -> Value {
    json!({
        "turn": t.id,
        "status": effective_status(t, c),
        "sha": c.map(|c| short(&c.sha)),
        "ts": t.ts,
        "origin": t.origin,
        "prompt": first_line(&t.prompt),
        "summary": t.summary,
        "strength": turn::strength_name(t.strength),
        "confidence": t.confidence,
        "files": t.touched.files,
        "nodes": t.touched.nodes,
        "intents": t.intents.iter().map(|i| i.id.clone()).collect::<Vec<_>>(),
        "gate": t.gate.decision,
        "reasons": t.gate.reasons,
        "folded_into": t.folded_into,
        "restore": t.restore.as_ref().map(|r| r.feature.clone()),
    })
}

pub fn list(engine: &Engine, limit: usize) -> Result<Value> {
    let commits = commits_by_turn(engine)?;
    let turns = engine.store.turns()?;
    let mut entries: Vec<Value> = turns.iter().rev().map(|t| entry(t, commits.get(&t.id))).collect();
    for (tid, c) in &commits {
        if !turns.iter().any(|t| &t.id == tid) {
            entries.push(json!({"turn": tid, "status": "committed", "sha": short(&c.sha), "ts": c.ts, "prompt": c.subject, "record": false}));
        }
    }
    let vcs_name = vcs::open(&engine.store.manifest()?.vcs.provider).name();
    let total = entries.len();
    entries.truncate(if limit == 0 { total } else { limit });
    Ok(json!({"vcs": vcs_name, "count": total, "turns": entries}))
}

pub fn get(engine: &Engine, id: &str) -> Result<Value> {
    let t = turn::get(engine, id)?;
    let commits = commits_by_turn(engine)?;
    let c = commits.get(id);
    let root = engine.store.project_root.clone();
    let vcs = vcs::open(&engine.store.manifest()?.vcs.provider);
    let stat = match c {
        Some(c) => vcs.stat(&root, &c.sha).unwrap_or_default(),
        None => String::new(),
    };
    Ok(json!({
        "turn": t,
        "commit": c.map(|c| json!({"sha": c.sha, "subject": c.subject, "ts": c.ts})),
        "stat": stat,
    }))
}

pub fn diff(engine: &Engine, id: &str, file: Option<String>) -> Result<Value> {
    let t = turn::get(engine, id)?;
    let paths: Vec<String> = match file {
        Some(f) => vec![f],
        None => t.touched.files.clone(),
    };
    let commits = commits_by_turn(engine)?;
    let root = engine.store.project_root.clone();
    let vcs = vcs::open(&engine.store.manifest()?.vcs.provider);
    let (committed, mut text) = match commits.get(id) {
        Some(c) => (true, vcs.diff(&root, &c.sha, &paths)?),
        None => (false, vcs.diff_worktree(&root, &paths)?),
    };
    if !committed {
        // files a staged turn created are untracked, so `git diff` cannot show them: show them as additions
        for p in &paths {
            let on_disk = root.join(p);
            if on_disk.is_file() && vcs.show(&root, "HEAD", p).is_none() {
                if let Ok(body) = std::fs::read_to_string(&on_disk) {
                    text.push_str(&format!("\n+++ new file: {p}\n"));
                    for line in body.lines().take(400) {
                        text.push_str(&format!("+{line}\n"));
                    }
                }
            }
        }
    }
    Ok(json!({"turn": id, "committed": committed, "patch": truncate(&text, 200_000)}))
}

pub fn search(engine: &Engine, q: &str) -> Result<Value> {
    let ql = q.to_lowercase();
    let turns: Vec<Value> = engine
        .store
        .turns()?
        .into_iter()
        .filter(|t| {
            t.prompt.to_lowercase().contains(&ql)
                || t.summary.as_deref().unwrap_or("").to_lowercase().contains(&ql)
                || t.intents.iter().any(|i| i.id.contains(&ql) || i.statement.as_deref().unwrap_or("").to_lowercase().contains(&ql))
                || t.touched.nodes.iter().any(|n| n.contains(&ql))
        })
        .map(|t| entry(&t, None))
        .collect();
    let intents: Vec<Value> = engine
        .store
        .intents()?
        .into_iter()
        .filter(|i| i.id.contains(&ql) || i.statement.as_deref().unwrap_or("").to_lowercase().contains(&ql) || i.title.to_lowercase().contains(&ql))
        .map(|i| json!({"id": i.id, "title": i.title, "statement": i.statement, "status": i.status, "from_turns": i.from_turns}))
        .collect();
    Ok(json!({"query": q, "turns": turns, "intents": intents}))
}

/// Features that had a realisation at some committed turn and lost it later. A loss is "on purpose"
/// when the turn that caused it declared the node (or an ancestor) removed.
pub fn losses(engine: &Engine) -> Result<Value> {
    let table = NodeTable::from_blueprint(&engine.store.blueprint()?);
    let commits = commits_by_turn(engine)?;
    let committed: Vec<Turn> = engine
        .store
        .turns()?
        .into_iter()
        .filter(|t| t.status == "committed" || (t.status == "ready" && commits.contains_key(&t.id)))
        .collect();
    let mut events: BTreeMap<String, Value> = BTreeMap::new();
    let mut prev: BTreeSet<String> = BTreeSet::new();
    let mut history = vec![];
    for t in &committed {
        let now: BTreeSet<String> = t.implements.keys().cloned().collect();
        for n in prev.iter().filter(|n| !now.contains(*n)) {
            let on_purpose = t.removes.iter().any(|r| {
                let rid = table.resolve(r).unwrap_or_else(|| r.clone());
                rid == *n || table.is_ancestor_or_same(&rid, n)
            });
            let ev = json!({
                "node": n,
                "name": table.get(n).map(|x| x.name.clone()),
                "lost_in": t.id,
                "on_purpose": on_purpose,
                "prompt": first_line(&t.prompt),
            });
            history.push(ev.clone());
            events.insert(n.clone(), ev);
        }
        prev = now;
    }
    let missing: Vec<Value> = events.iter().filter(|(n, _)| !prev.contains(*n)).map(|(_, e)| e.clone()).collect();
    Ok(json!({
        "currently_missing": missing,
        "history": history,
        "note": "computed from committed turns; uncommitted work is not included",
    }))
}

fn resolve_feature(engine: &Engine, table: &NodeTable, feature: &str) -> Result<String> {
    if let Some(n) = table.resolve(feature) {
        return Ok(n);
    }
    if let Some(i) = engine.store.intent(feature)? {
        if let Some(n) = i.attaches.nodes.first() {
            return Ok(n.clone());
        }
    }
    Err(anyhow!("`{feature}` is neither a blueprint node nor an intent attached to a node"))
}

/// Restore a feature that disappeared: take the last committed version that realised it, 3-way merge
/// it onto the current files (base = the commit before the feature was introduced), and — with
/// `apply` — open a turn for it. The restore is then gated like any other change at turn.commit.
pub fn restore(engine: &Engine, feature: &str, apply: bool, origin: &str) -> Result<Value> {
    let snap = engine.snapshot(true)?;
    let table = &snap.table;
    let prefix = turn::code_prefix(&snap.manifest);
    let root = engine.store.project_root.clone();
    let node = resolve_feature(engine, table, feature)?;
    if turn::implements_map(&snap, &prefix).contains_key(&node) {
        return Ok(json!({"status": "present", "node": node, "message": "the feature is realised now; nothing to restore"}));
    }
    let vcs = vcs::open(&snap.manifest.vcs.provider);
    let commits = commits_by_turn(engine)?;
    let mut committed: Vec<(Turn, CommitInfo)> = engine
        .store
        .turns()?
        .into_iter()
        .filter(|t| t.status == "committed" || (t.status == "ready" && commits.contains_key(&t.id)))
        .filter_map(|t| commits.get(&t.id).cloned().map(|c| (t, c)))
        .collect();
    committed.sort_by(|a, b| a.0.id.cmp(&b.0.id));
    let realised = |t: &Turn| t.implements.get(&node).map(|f| !f.is_empty()).unwrap_or(false);
    let good_idx = committed
        .iter()
        .rposition(|(t, _)| realised(t))
        .ok_or_else(|| anyhow!("no committed turn ever realised `{node}`; nothing to restore from"))?;
    let intro_idx = committed.iter().position(|(t, _)| realised(t)).unwrap_or(good_idx);
    let lost = committed.get(good_idx + 1).map(|(t, _)| t.id.clone()).unwrap_or_else(|| "uncommitted".into());
    let good_t = committed[good_idx].0.clone();
    let good_c = committed[good_idx].1.clone();
    let intro_id = committed[intro_idx].0.id.clone();
    // The base is the state *where the feature was gone* (the turn that lost it, or HEAD when the loss
    // is still uncommitted). Restoring = undoing that removal: ours (current) vs base (gone) vs theirs
    // (last good). If nobody touched the files since the loss, the merge is exactly the good version.
    let lost_sha: Option<String> = committed.get(good_idx + 1).map(|(_, c)| c.sha.clone());

    let mut plan = vec![];
    let mut merged_out: Vec<(String, String)> = vec![];
    let mut total_conflicts = 0usize;
    for f in good_t.implements.get(&node).cloned().unwrap_or_default() {
        let Some(theirs) = vcs.show(&root, &good_c.sha, &f) else { continue };
        let base = match &lost_sha {
            Some(sha) => vcs.show(&root, sha, &f).unwrap_or_default(),
            None => vcs.show(&root, "HEAD", &f).unwrap_or_default(),
        };
        let ours = std::fs::read_to_string(root.join(&f)).unwrap_or_default();
        let (merged, conflicts) = vcs.merge3(&ours, &base, &theirs)?;
        total_conflicts += conflicts;
        plan.push(json!({"path": f, "conflicts": conflicts, "lines": merged.lines().count()}));
        merged_out.push((f, merged));
    }
    if merged_out.is_empty() {
        return Err(anyhow!("nothing to restore: no file that realised `{node}` at {} can be read", good_t.id));
    }
    if !apply {
        return Ok(json!({
            "status": "plan",
            "feature": node,
            "from_turn": good_t.id,
            "introduced_in": intro_id,
            "lost_turn": lost,
            "files": plan,
            "conflicts": total_conflicts,
            "next": "run `afwe timeline restore <feature> --apply` to open a restore turn, then turn.commit",
        }));
    }
    let begun = turn::begin(
        engine,
        turn::BeginRequest {
            prompt: format!("Restore `{node}` as it was at {} (lost at {lost})", good_t.id),
            origin: origin.to_string(),
            agent: None,
            targets: merged_out.iter().map(|(f, _)| f.clone()).collect(),
            refines: vec![good_t.id.clone()],
            kind: "code".into(),
        },
    )?;
    let tid = begun["turn"].as_str().unwrap_or_default().to_string();
    for (f, content) in &merged_out {
        let p = root.join(f);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&p, content)?;
    }
    let mut t = turn::get(engine, &tid)?;
    t.restore = Some(RestoreRecord { feature: node.clone(), from_turn: good_t.id.clone(), lost_turn: lost.clone(), conflicts: total_conflicts });
    t.intents.push(TurnIntent {
        id: slug(&format!("restore-{node}")),
        action: "update".into(),
        targets: vec![node.clone()],
        title: Some(format!("Restore {node}")),
        statement: None,
    });
    engine.store.save_turn(&t)?;
    engine.log(origin, "restore", format!("Restore of `{node}` from {} opened as {tid}", good_t.id), Some(json!({"turn": tid, "conflicts": total_conflicts})))?;
    Ok(json!({
        "status": "applied",
        "turn": tid,
        "feature": node,
        "from_turn": good_t.id,
        "lost_turn": lost,
        "files": plan,
        "conflicts": total_conflicts,
        "next": if total_conflicts > 0 {
            "resolve the conflict markers in the restored files, then turn.commit"
        } else {
            "turn.commit runs the gate (verify, pins, registered checks) before anything is committed"
        },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_sha_and_first_line() {
        assert_eq!(short("0123456789abcdef"), "0123456");
        assert_eq!(first_line("hello\nworld"), "hello");
    }
}
