//! The turn ledger. One prompt = one turn. The deterministic protocol around the harness:
//!
//!   turn.begin  → briefing: scope, active pins, intents, memory, constraints, registered checks,
//!                 unresolved proposals (+ footer), contract steps. Captures a baseline.
//!   turn.assume → the harness decomposes the prompt into intents and claims *before* writing code.
//!                 Schema errors and pin conflicts are answered with REDO; nothing is half-registered.
//!   (the harness writes code)
//!   turn.commit → changes are attributed against the baseline; verify, pins, collateral loss,
//!                 claims and registered checks run; confidence is computed → COMMIT, STAGE (proposal),
//!                 READY (manual git mode) or REDO. A commit carries an `AFWE-Turn:` trailer.
//!
//! AFWE never calls a model here. Every decision is reproducible from the files on disk.

use crate::analyze::build_globset;
use crate::claims;
use crate::conflict;
use crate::contract::{self, TaskStart};
use crate::engine::{Engine, Snapshot};
use crate::gate::{self, ConfidenceInput, Decision, GateInput};
use crate::intent::{self, PinSpec};
use crate::mapping::NodeTable;
use crate::model::*;
use crate::sync::{sync, SyncOptions};
use crate::util::{hash_bytes, hash_str, now, slug, truncate};
use crate::vcs;
use crate::verify::{verify, VerifyOptions};
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

/// Directories whose changes are never attributed to a turn: derived state and the engine's own
/// records (the log and the turn ledger). They are always staged with a commit instead.
const ENGINE_OWNED: &[&str] = &[".afwe/index/", ".afwe/state/", ".afwe/turns/", ".afwe/log/"];

/// Staged with every AFWE commit (sources of truth that are not attributed per file).
const AFWE_SOURCE_DIRS: &[&str] = &[
    ".afwe/afwe.yaml",
    ".afwe/blueprint",
    ".afwe/memory",
    ".afwe/guardrails",
    ".afwe/intents",
    ".afwe/workflows",
    ".afwe/pins",
    ".afwe/checks",
    ".afwe/abstractions",
    ".afwe/contracts",
    ".afwe/turns",
    ".afwe/log",
    ".afwe/.gitignore",
    ".afwe/README.md",
];

pub struct BeginRequest {
    pub prompt: String,
    pub origin: String,
    pub agent: Option<String>,
    pub targets: Vec<String>,
    pub refines: Vec<String>,
    pub kind: String,
}

pub struct AssumeRequest {
    pub intents: Vec<TurnIntent>,
    pub assumptions: Vec<Assumption>,
    pub removes: Vec<String>,
    pub overrides: Vec<PinOverride>,
    pub origin: String,
}

#[derive(Default)]
pub struct CommitRequest {
    pub summary: Option<String>,
    pub footer_shown: bool,
    pub removes: Vec<String>,
    pub touched: Vec<String>,
    pub overrides: Vec<PinOverride>,
    pub origin: String,
    pub confirmed: bool,
}

// ───────────────────────────── shared helpers (also used by timeline/onboard) ─────────────────────────────

/// Prefix that turns code-root-relative paths into project-relative ones ("" when they are equal).
pub(crate) fn code_prefix(m: &Manifest) -> String {
    let r = m.project.root.trim_start_matches("./").trim_matches('/').to_string();
    if r.is_empty() || r == "." {
        String::new()
    } else {
        format!("{r}/")
    }
}

pub(crate) fn to_code_rel(prefix: &str, project_rel: &str) -> Option<String> {
    if prefix.is_empty() {
        Some(project_rel.to_string())
    } else {
        project_rel.strip_prefix(prefix).map(|s| s.to_string())
    }
}

/// project-relative path → content hash, for code files and `.afwe/` sources (not derived state).
pub(crate) fn tree_hashes(engine: &Engine, snap: &Snapshot) -> BTreeMap<String, String> {
    let prefix = code_prefix(&snap.manifest);
    let mut out = BTreeMap::new();
    for f in &snap.code.files {
        out.insert(format!("{prefix}{}", f.path), f.hash.clone());
    }
    for path in crate::store::walk_all(&engine.store.afwe_dir) {
        let rel = crate::store::rel_to(&engine.store.project_root, &path);
        if ENGINE_OWNED.iter().any(|d| rel.starts_with(d)) {
            continue;
        }
        if let Ok(b) = std::fs::read(&path) {
            out.insert(rel, hash_bytes(&b));
        }
    }
    out
}

pub(crate) fn changed_paths(base: &BTreeMap<String, String>, now: &BTreeMap<String, String>) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for (k, v) in now {
        if base.get(k) != Some(v) {
            out.insert(k.clone());
        }
    }
    for k in base.keys() {
        if !now.contains_key(k) {
            out.insert(k.clone());
        }
    }
    out
}

pub(crate) fn symbol_map(snap: &Snapshot) -> BTreeMap<String, String> {
    snap.code.files.iter().flat_map(|f| f.symbols.iter()).map(|s| (s.id.clone(), s.fingerprint.clone())).collect()
}

/// node → code-root-relative files that realise it (file claims and symbol claims).
pub(crate) fn implements_code(snap: &Snapshot) -> BTreeMap<String, Vec<String>> {
    let mut out: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for (file, claims) in &snap.mapping.files {
        for c in claims {
            out.entry(c.node.clone()).or_default().insert(file.clone());
        }
    }
    for (sym, node) in &snap.mapping.symbols {
        let file = sym.split("::").next().unwrap_or_default().to_string();
        if !file.is_empty() {
            out.entry(node.clone()).or_default().insert(file);
        }
    }
    out.into_iter().map(|(k, v)| (k, v.into_iter().collect())).collect()
}

/// node → project-relative files that realise it (what turns and restores are recorded in).
pub(crate) fn implements_map(snap: &Snapshot, prefix: &str) -> BTreeMap<String, Vec<String>> {
    implements_code(snap)
        .into_iter()
        .map(|(n, fs)| (n, fs.into_iter().map(|f| format!("{prefix}{f}")).collect()))
        .collect()
}

pub(crate) fn load(engine: &Engine, id: &str) -> Result<Turn> {
    engine.store.turn(id)?.ok_or_else(|| anyhow!("turn `{id}` not found (see `afwe turn list`)"))
}

/// Files the prompt or the targets name, resolved against the code model (exact path or glob).
fn expand_file(snap: &Snapshot, target: &str) -> Vec<String> {
    let t = target.trim_start_matches("./");
    if t.contains('*') {
        return match build_globset(&[t.to_string()]) {
            Ok(gs) => snap.code.files.iter().filter(|f| gs.is_match(&f.path)).map(|f| f.path.clone()).collect(),
            Err(_) => vec![],
        };
    }
    snap.code.files.iter().filter(|f| f.path == t).map(|f| f.path.clone()).collect()
}

fn suggest(table: &NodeTable, t: &str) -> Vec<String> {
    let q = t.to_lowercase();
    table
        .nodes
        .values()
        .filter(|n| n.name.to_lowercase().contains(&q) || n.id.contains(&q))
        .take(3)
        .map(|n| n.id.clone())
        .collect()
}

/// Whole-word containment (so a node named "UI" does not match inside "build").
fn contains_word(hay: &str, word: &str) -> bool {
    let bytes = hay.as_bytes();
    let mut start = 0;
    while let Some(pos) = hay[start..].find(word) {
        let i = start + pos;
        let j = i + word.len();
        let before_ok = i == 0 || !bytes[i - 1].is_ascii_alphanumeric();
        let after_ok = j >= bytes.len() || !bytes[j].is_ascii_alphanumeric();
        if before_ok && after_ok {
            return true;
        }
        start = i + hay[i..].chars().next().map(|c| c.len_utf8()).unwrap_or(1);
    }
    false
}

fn dedupe(v: Vec<String>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    v.into_iter().filter(|x| seen.insert(x.clone())).collect()
}

fn ancestors_inclusive(table: &NodeTable, nodes: &[String]) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for n in nodes {
        out.insert(n.clone());
        out.extend(table.ancestors(n));
    }
    out
}

fn protocol_assume_schema() -> Value {
    json!({
        "intents": [{
            "id": "slug",
            "action": intent::ACTIONS.join("|"),
            "targets": ["node ids or file paths"],
            "title": "optional",
            "statement": "optional: the merged statement of what is wanted"
        }],
        "assumptions": [{
            "id": "a1",
            "text": "what you assume",
            "claim": {
                "type": "forbid_pattern|require_pattern|forbid_import|symbol_exists|require_file",
                "pattern": "regex (pattern claims)",
                "files": ["globs the claim applies to"],
                "to_nodes": ["node ids (forbid_import)"],
                "symbol": "Name (symbol_exists)"
            }
        }],
        "removes": ["node ids removed on purpose"],
        "overrides": [{"pin": "pin id", "reason": "why this pin is deliberately changed"}]
    })
}

fn protocol_commit_schema() -> Value {
    json!({
        "summary": "one line: what changed and why",
        "footer_shown": "true once the AFWE notice about unresolved proposals is in your reply",
        "removes": ["node ids removed on purpose"],
        "touched": ["extra files you changed that AFWE cannot see"],
        "overrides": [{"pin": "pin id", "reason": "…"}]
    })
}

// ───────────────────────────── begin ─────────────────────────────

pub fn begin(engine: &Engine, req: BeginRequest) -> Result<Value> {
    if req.prompt.trim().is_empty() {
        return Err(anyhow!("turn.begin needs the prompt text (it is stored verbatim)"));
    }
    let snap = engine.snapshot(true)?;
    let table = &snap.table;
    let prefix = code_prefix(&snap.manifest);
    let root = engine.store.project_root.clone();
    let id = engine.store.next_turn_id()?;

    // ── scope: explicit targets, then the nodes and files the prompt names ──
    let mut nodes: Vec<String> = vec![];
    let mut files: Vec<String> = vec![];
    let mut unresolved: Vec<String> = vec![];
    for t in &req.targets {
        if let Some(n) = table.resolve(t) {
            nodes.push(n);
            continue;
        }
        let f = expand_file(&snap, t);
        if f.is_empty() {
            unresolved.push(t.clone());
        } else {
            files.extend(f);
        }
    }
    let lower = req.prompt.to_lowercase();
    for n in table.nodes.values() {
        let name = n.name.to_lowercase();
        if name.len() >= 4 && contains_word(&lower, &name) {
            nodes.push(n.id.clone());
        }
    }
    for f in &snap.code.files {
        if lower.contains(&f.path.to_lowercase()) {
            files.push(f.path.clone());
        }
    }
    let nodes = dedupe(nodes);
    let files = dedupe(files);
    let chain = ancestors_inclusive(table, &nodes);
    let implements = implements_code(&snap);
    let mut brief_files = files.clone();
    for n in &chain {
        if let Some(fs) = implements.get(n) {
            brief_files.extend(fs.iter().cloned());
        }
    }
    let brief_files: Vec<String> = dedupe(brief_files).into_iter().take(60).collect();

    // ── briefing ──
    let pins = engine.store.pins()?;
    let in_scope_pin = |p: &Pin| -> bool {
        p.attaches.is_empty()
            || p.attaches.global
            || p.attaches.nodes.iter().filter_map(|n| table.resolve(n)).any(|n| chain.contains(&n))
            || (!p.attaches.files.is_empty()
                && build_globset(&p.attaches.files).map(|g| brief_files.iter().any(|f| g.is_match(f))).unwrap_or(false))
    };
    let pin_json = |p: &Pin| json!({"id": p.id, "statement": p.statement, "kind": p.kind, "severity": p.severity, "intentional": p.intentional, "nodes": p.attaches.nodes});
    let active_pins: Vec<Value> = pins.iter().filter(|p| p.status == "active" && in_scope_pin(p)).map(pin_json).collect();
    let intentional: Vec<Value> = pins.iter().filter(|p| p.status == "active" && p.intentional && in_scope_pin(p)).map(pin_json).collect();
    let suggested: Vec<Value> = pins.iter().filter(|p| p.status == "proposed" && in_scope_pin(p)).map(pin_json).collect();

    let intents: Vec<Value> = engine
        .store
        .intents()?
        .into_iter()
        .filter(|i| i.status != "archived" && i.attaches.nodes.iter().any(|n| chain.contains(n)))
        .map(|i| json!({"id": i.id, "title": i.title, "statement": i.statement, "status": i.status}))
        .collect();

    let memory: Vec<Value> = snap
        .sources
        .memory
        .iter()
        .filter(|m| m.meta.status.as_deref() != Some("superseded"))
        .filter(|m| {
            m.meta.applies_to.iter().filter_map(|r| table.resolve(r)).any(|n| chain.contains(&n))
                || (!m.meta.files.is_empty()
                    && build_globset(&m.meta.files).map(|g| brief_files.iter().any(|f| g.is_match(f))).unwrap_or(false))
        })
        .map(|m| json!({"id": m.meta.id, "kind": m.meta.kind, "title": m.meta.title, "excerpt": truncate(&m.body.split_whitespace().collect::<Vec<_>>().join(" "), 240)}))
        .collect();

    let constraints: Vec<Value> = snap
        .sources
        .constraints
        .constraints
        .iter()
        .filter(|c| {
            let from = table.resolve(&c.from);
            let to_hit = c.to.iter().filter_map(|t| table.resolve(t)).any(|n| chain.contains(&n));
            from.map(|f| chain.contains(&f)).unwrap_or(false) || to_hit
        })
        .map(|c| json!({"id": c.id, "rule": c.rule, "from": c.from, "to": c.to, "description": c.description}))
        .collect();

    let guardrails: Vec<Value> = snap
        .sources
        .guardrails
        .iter()
        .filter(|g| g.mode == "passive")
        .filter(|g| g.scope.global || g.scope.nodes.iter().filter_map(|n| table.resolve(n)).any(|n| chain.contains(&n)))
        .map(|g| json!({"id": g.id, "statement": g.statement, "reason": g.reason}))
        .collect();

    let touch_nodes = chain.clone();
    let check_list: Vec<Value> = engine
        .store
        .checks()?
        .into_iter()
        .filter(|c| intent::relevant(c, table, &intent::Touch { nodes: &touch_nodes, files: &brief_files, symbols: &[] }))
        .map(|c| json!({"id": c.id, "title": c.title, "trust": c.trust, "authored_by": c.authored_by}))
        .collect();

    let proposals: Vec<Turn> = engine.store.turns()?.into_iter().filter(|t| t.status == "staged").collect();
    let unresolved_proposals: Vec<Value> = proposals
        .iter()
        .map(|t| {
            json!({
                "turn": t.id,
                "summary": t.summary.clone().unwrap_or_else(|| truncate(t.prompt.lines().next().unwrap_or("").trim(), 120)),
                "confidence": t.confidence,
                "files": t.touched.files,
                "reasons": t.gate.reasons,
            })
        })
        .collect();
    let footer = if proposals.is_empty() {
        None
    } else {
        let mut s = format!("⚠ AFWE Notice: you have {} uncommitted proposal(s) staged:\n", proposals.len());
        for p in &proposals {
            let summary = p.summary.clone().unwrap_or_else(|| truncate(p.prompt.lines().next().unwrap_or("").trim(), 90));
            s.push_str(&format!("   • {}: {} ({:.0}% confidence, touches {})\n", p.id, summary, p.confidence * 100.0, p.touched.files.join(", ")));
        }
        s.push_str("Reply \"accept <turn>\", \"revert <turn>\", or review them in the Studio.");
        Some(s)
    };

    // ── task (the Board shows its contract obligations) ──
    let contracts = engine.store.contracts()?;
    let kind = if contract::select_contract(&contracts, &req.kind).is_some() { req.kind.clone() } else { "code".into() };
    let title = truncate(req.prompt.lines().next().unwrap_or("").trim(), 90);
    let (task, _) = contract::task_start(
        engine,
        &contracts,
        TaskStart { title: format!("{id}: {title}"), kind: kind.clone(), files: brief_files.clone(), nodes: chain.iter().cloned().collect(), origin: req.origin.clone(), workflow: None },
    )?;
    let obligations: Vec<Value> = contract::select_contract(&contracts, &kind)
        .map(|c| c.steps.iter().map(|s| json!({"step": s.id, "action": s.action, "instruction": s.instruction})).collect())
        .unwrap_or_default();

    // ── record + baseline (captured after the log entry so the engine's own writes are not attributed) ──
    let turn = Turn {
        id: id.clone(),
        ts: now(),
        origin: req.origin.clone(),
        agent: req.agent.clone(),
        prompt: req.prompt.clone(),
        prompt_hash: hash_str(&req.prompt),
        task: Some(task.id.clone()),
        refines: req.refines.clone(),
        targets: req.targets.clone(),
        scope: TurnScope { nodes: nodes.clone(), files: files.iter().map(|f| format!("{prefix}{f}")).collect() },
        status: "open".into(),
        ..Default::default()
    };
    engine.store.save_turn(&turn)?;
    engine.log(&req.origin, "turn_begin", format!("{id} begun: {}", truncate(&title, 100)), Some(json!({"turn": id, "task": task.id, "nodes": nodes})))?;
    let baseline = Baseline {
        head: vcs::open(&snap.manifest.vcs.provider).head(&root),
        files: tree_hashes(engine, &snap),
        symbols: symbol_map(&snap),
        implements: implements_map(&snap, &prefix),
    };
    engine.store.save_baseline(&id, &baseline)?;

    Ok(json!({
        "turn": id,
        "status": "open",
        "task": task.id,
        "scope": {"nodes": nodes, "files": brief_files},
        "unresolved_targets": unresolved,
        "pins": active_pins,
        "intentional": intentional,
        "suggested_pins": suggested,
        "intents": intents,
        "memory": memory,
        "constraints": constraints,
        "guardrails": guardrails,
        "checks": check_list,
        "unresolved_proposals": unresolved_proposals,
        "footer": footer,
        "obligations": obligations,
        "protocol": {
            "next": "turn.assume (declare intents and claims before writing code), then write the code, then turn.commit",
            "footer_required": !proposals.is_empty(),
            "assume_schema": protocol_assume_schema(),
            "commit_schema": protocol_commit_schema(),
            "rules": [
                "Do not change anything a pin protects without an explicit override {pin, reason}.",
                "Do not remove a feature by accident: declare removals in `removes`.",
                "A REDO means nothing was committed: fix the reasons and call turn.commit again."
            ]
        }
    }))
}

// ───────────────────────────── assume ─────────────────────────────

pub fn assume(engine: &Engine, id: &str, req: AssumeRequest) -> Result<Value> {
    let mut turn = load(engine, id)?;
    if !matches!(turn.status.as_str(), "open" | "ready" | "staged") {
        return Err(anyhow!("turn {id} is {}; start a new turn for further work", turn.status));
    }
    let snap = engine.snapshot(false)?;
    let table = &snap.table;
    let mut errs: Vec<(String, String)> = vec![];

    let mut seen = BTreeSet::new();
    for it in &req.intents {
        if it.id.is_empty() || slug(&it.id) != it.id {
            errs.push(("SCHEMA_INVALID".into(), format!("intent id `{}` must be a lowercase slug", it.id)));
        }
        if !seen.insert(it.id.clone()) {
            errs.push(("DUPLICATE_ID".into(), format!("intent `{}` is declared twice", it.id)));
        }
        if !intent::ACTIONS.contains(&it.action.as_str()) {
            errs.push(("SCHEMA_INVALID".into(), format!("intent `{}`: action must be one of {}", it.id, intent::ACTIONS.join(", "))));
        }
        if it.action != "create" && it.targets.is_empty() {
            errs.push(("SCHEMA_INVALID".into(), format!("intent `{}`: `{}` needs targets (node ids or files)", it.id, it.action)));
        }
        for t in &it.targets {
            if table.resolve(t).is_none() && expand_file(&snap, t).is_empty() && it.action != "create" {
                let near = suggest(table, t);
                let hint = if near.is_empty() { String::new() } else { format!(" (did you mean {}?)", near.join(", ")) };
                errs.push(("UNKNOWN_TARGET".into(), format!("intent `{}`: `{t}` is neither a blueprint node nor a file{hint}", it.id)));
            }
        }
    }
    let mut aseen = BTreeSet::new();
    for a in &req.assumptions {
        if a.id.is_empty() || a.text.trim().is_empty() {
            errs.push(("SCHEMA_INVALID".into(), "every assumption needs an id and a text".into()));
            continue;
        }
        if !aseen.insert(a.id.clone()) {
            errs.push(("DUPLICATE_ID".into(), format!("assumption `{}` is declared twice", a.id)));
        }
        if let Some(c) = &a.claim {
            if let Err(m) = claims::validate(c, table) {
                errs.push(("BAD_CLAIM".into(), format!("assumption `{}`: {m}", a.id)));
            }
        }
    }
    for r in &req.removes {
        if table.resolve(r).is_none() {
            errs.push(("UNKNOWN_TARGET".into(), format!("removes: `{r}` is not a blueprint node")));
        }
    }

    // ── deterministic pin pre-check: destructive intents on pinned subtrees ──
    let mut overrides = turn.overrides.clone();
    overrides.extend(req.overrides.iter().cloned());
    let pins = engine.store.pins()?;
    let declared: Vec<String> = req
        .intents
        .iter()
        .filter(|i| intent::DESTRUCTIVE.contains(&i.action.as_str()))
        .flat_map(|i| i.targets.iter().filter_map(|t| table.resolve(t)))
        .collect();
    let mut notices = vec![];
    let mut needs = vec![];
    for c in conflict::pin_conflicts(&pins, table, &declared, &[], &[], &overrides) {
        if let Some(r) = &c.overridden {
            notices.push(format!("OVERRIDDEN pin {} ({}): {r}", c.pin, c.statement));
            continue;
        }
        match c.severity.as_str() {
            "block" => errs.push((
                "PIN_CONFLICT".into(),
                format!(
                    "pin {} ({}) protects {} — revise the intent, or record an explicit override {{\"pin\":\"{}\",\"reason\":\"…\"}}",
                    c.pin,
                    c.statement,
                    c.matched.join(", "),
                    c.pin
                ),
            )),
            "confirm" => needs.push(format!("pin {} ({}) must be confirmed at commit", c.pin, c.statement)),
            _ => notices.push(format!("pin {} (warn): {}", c.pin, c.statement)),
        }
    }
    if !errs.is_empty() {
        return Ok(json!({
            "status": "redo",
            "turn": id,
            "error_code": errs[0].0,
            "errors": errs.iter().map(|(c, m)| json!({"code": c, "message": m})).collect::<Vec<_>>(),
            "required_action": "revise the intents/assumptions and call turn.assume again; nothing was registered",
            "schema": protocol_assume_schema(),
        }));
    }

    // ── accepted: register ──
    turn.intents = req.intents.clone();
    turn.assumptions = req
        .assumptions
        .iter()
        .map(|a| Assumption { status: "proposed".into(), ..a.clone() })
        .collect();
    for r in &req.removes {
        if !turn.removes.contains(r) {
            turn.removes.push(r.clone());
        }
    }
    for o in &req.overrides {
        if !turn.overrides.iter().any(|x| x.pin == o.pin) {
            turn.overrides.push(o.clone());
        }
    }
    for i in &req.intents {
        for t in &i.targets {
            if let Some(n) = table.resolve(t) {
                if !turn.scope.nodes.contains(&n) {
                    turn.scope.nodes.push(n);
                }
            }
        }
    }
    let registered = intent::upsert_intents(engine, &turn, &req.intents, table)?;
    engine.store.save_turn(&turn)?;
    engine.log(
        &req.origin,
        "turn_assume",
        format!("{id}: {} intent(s), {} assumption(s) registered", req.intents.len(), req.assumptions.len()),
        Some(json!({"turn": id})),
    )?;
    Ok(json!({
        "status": "accepted",
        "turn": id,
        "intents": registered,
        "claims": turn.assumptions.iter().filter(|a| a.claim.is_some()).map(|a| a.id.clone()).collect::<Vec<_>>(),
        "notices": notices,
        "needs_confirmation": needs,
        "next": "write the code, then call turn.commit",
    }))
}

// ───────────────────────────── commit ─────────────────────────────

pub fn commit(engine: &Engine, id: &str, req: CommitRequest) -> Result<Value> {
    let mut turn = load(engine, id)?;
    if !matches!(turn.status.as_str(), "open" | "ready" | "staged") {
        return Err(anyhow!("turn {id} is already {}; nothing to commit", turn.status));
    }
    let m = engine.store.manifest()?;
    let vcs = vcs::open(&m.vcs.provider);
    let snap = engine.snapshot(true)?;
    let root = engine.store.project_root.clone();
    let table = &snap.table;
    let prefix = code_prefix(&snap.manifest);
    let base = engine.store.baseline(id)?;
    let now_hashes = tree_hashes(engine, &snap);

    let mut blocking: Vec<String> = vec![];
    let mut notices: Vec<String> = vec![];
    let mut confirm: Vec<String> = vec![];

    // ── 1. attribution: what changed since turn.begin, plus declared extras and folded proposals ──
    let mut attributed: BTreeSet<String> = match &base {
        Some(b) => changed_paths(&b.files, &now_hashes),
        None => {
            notices.push("NO_BASELINE: the turn was not begun with `turn.begin`; only declared files are attributed".into());
            BTreeSet::new()
        }
    };
    for t in &req.touched {
        let p = if now_hashes.contains_key(t) { t.clone() } else { format!("{prefix}{t}") };
        if base.is_none() || attributed.contains(&p) {
            attributed.insert(p);
        }
    }
    let intent_nodes: Vec<String> = turn.intents.iter().flat_map(|i| i.targets.iter().filter_map(|t| table.resolve(t))).collect();
    let mut scope_nodes: BTreeSet<String> = turn.scope.nodes.iter().cloned().collect();
    scope_nodes.extend(intent_nodes.iter().cloned());
    let staged_others: Vec<Turn> = engine.store.turns()?.into_iter().filter(|t| t.status == "staged" && t.id != turn.id).collect();
    let mut folded: Vec<Turn> = vec![];
    for s in staged_others.iter() {
        if s.scope.nodes.iter().any(|n| scope_nodes.contains(n)) {
            folded.push(s.clone());
        }
    }
    for s in &folded {
        attributed.extend(s.touched.files.iter().cloned());
    }
    let has_changes = !attributed.is_empty();

    if !has_changes {
        turn.gate = GateRecord { decision: "empty".into(), reasons: vec!["NO_CHANGES: nothing changed since turn.begin".into()] };
        engine.store.save_turn(&turn)?;
        return Ok(json!({"status": "empty", "turn": id, "reasons": turn.gate.reasons, "next": "write the code first, or abandon this turn"}));
    }

    let code_set: BTreeSet<String> = snap.code.files.iter().map(|f| f.path.clone()).collect();
    let code_rel: Vec<String> = attributed
        .iter()
        .filter_map(|p| to_code_rel(&prefix, p))
        .filter(|p| code_set.contains(p))
        .collect();

    // ── 2. what was touched: symbols, nodes ──
    let cur_syms = symbol_map(&snap);
    let mut changed_symbols: Vec<String> = vec![];
    if let Some(b) = &base {
        let files: BTreeSet<&str> = code_rel.iter().map(|s| s.as_str()).collect();
        for (sid, fp) in &cur_syms {
            let file = sid.split("::").next().unwrap_or_default();
            if files.contains(file) && b.symbols.get(sid) != Some(fp) {
                changed_symbols.push(sid.clone());
            }
        }
        for sid in b.symbols.keys() {
            let file = sid.split("::").next().unwrap_or_default();
            if files.contains(file) && !cur_syms.contains_key(sid) {
                changed_symbols.push(sid.clone());
            }
        }
    }
    let mut touched_nodes: BTreeSet<String> = BTreeSet::new();
    for f in &code_rel {
        touched_nodes.extend(snap.mapping.nodes_of(f));
    }
    for s in &changed_symbols {
        if let Some(n) = snap.mapping.symbols.get(s) {
            touched_nodes.insert(n.clone());
        }
    }
    if let Some(b) = &base {
        for (n, files) in &b.implements {
            if files.iter().any(|f| attributed.contains(f)) {
                touched_nodes.insert(n.clone());
            }
        }
    }
    let touched_list: Vec<String> = touched_nodes.iter().cloned().collect();

    // ── 3. collateral loss: a feature that lost its whole realisation without being declared ──
    let after_map = implements_map(&snap, &prefix);
    let before_set: BTreeSet<String> = base.as_ref().map(|b| b.implements.keys().cloned().collect()).unwrap_or_default();
    let after_set: BTreeSet<String> = after_map.keys().cloned().collect();
    let mut removes = turn.removes.clone();
    removes.extend(req.removes.iter().cloned());
    removes.sort();
    removes.dedup();
    for n in conflict::collateral_loss(&before_set, &after_set, &removes, table) {
        blocking.push(format!("COLLATERAL_LOSS: {n} lost its implementation without being declared removed — restore it, or declare it with `removes`"));
    }
    if let Some(b) = &base {
        for p in conflict::partial_loss(&b.implements, &after_map, &touched_list) {
            notices.push(format!("PARTIAL_LOSS: {p}"));
        }
    }

    // ── 4. checks ──
    let mut results: Vec<CheckResult> = vec![];
    if !code_rel.is_empty() {
        let report = verify(&snap, &root, &VerifyOptions { changed: code_rel.clone(), run_commands: true, include_drift: false });
        for i in report.issues.iter().filter(|i| i.severity == "error") {
            blocking.push(format!("VERIFY_FAILED: {} — {}", i.id, i.message));
        }
        for i in report.issues.iter().filter(|i| i.severity == "warn") {
            notices.push(format!("WARN {}: {}", i.id, i.message));
        }
        results.push(CheckResult {
            id: "afwe-verify".into(),
            title: "constraints and active guardrails".into(),
            trust: CheckTrust::Deterministic,
            authored_by: "afwe".into(),
            passed: report.ok,
            message: if report.ok { None } else { Some(format!("{} error(s)", report.errors)) },
            blocking: true,
        });
        if let Some(cmd) = &m.vcs.test_command {
            let (ok, msg) = intent::run_command(cmd, &root, &code_rel, 600);
            if !ok {
                blocking.push(format!("PROJECT_TESTS_FAILED: `{cmd}` — {}", msg.clone().unwrap_or_default()));
            }
            results.push(CheckResult { id: "project-tests".into(), title: cmd.clone(), trust: CheckTrust::Deterministic, authored_by: "human".into(), passed: ok, message: msg, blocking: true });
        }
    }

    // ── 5. pins ──
    let mut overrides = turn.overrides.clone();
    overrides.extend(req.overrides.iter().cloned());
    if req.confirmed {
        for p in pins_active_confirm(engine)? {
            overrides.push(PinOverride { pin: p, reason: format!("confirmed by {}", req.origin) });
        }
    }
    let mut touch_all: Vec<String> = touched_list.clone();
    touch_all.extend(
        turn.intents
            .iter()
            .filter(|i| intent::DESTRUCTIVE.contains(&i.action.as_str()))
            .flat_map(|i| i.targets.iter().filter_map(|t| table.resolve(t))),
    );
    let pins = engine.store.pins()?;
    let mut warn_conflicts = 0usize;
    for c in conflict::pin_conflicts(&pins, table, &touch_all, &code_rel, &changed_symbols, &overrides) {
        if let Some(r) = &c.overridden {
            notices.push(format!("OVERRIDDEN pin {} ({}): {r}", c.pin, c.statement));
            continue;
        }
        match c.severity.as_str() {
            "block" => blocking.push(format!("PIN_CONFLICT: pin {} ({}) protects {} — revert the change, or record an explicit override", c.pin, c.statement, c.matched.join(", "))),
            "confirm" => confirm.push(format!("pin {} ({}) touched by {}", c.pin, c.statement, c.matched.join(", "))),
            _ => {
                warn_conflicts += 1;
                notices.push(format!("PIN_WARN {}: {}", c.pin, c.statement));
            }
        }
    }

    // ── 6. assumption claims ──
    for a in turn.assumptions.iter_mut() {
        let Some(cl) = &a.claim else { continue };
        let (passed, msg) = match claims::evaluate(cl, &snap, &root, &code_rel) {
            Ok(None) => (true, None),
            Ok(Some(w)) => (false, Some(w)),
            Err(e) => (false, Some(format!("{e:#}"))),
        };
        if !passed {
            a.status = "failed".into();
            blocking.push(format!("CLAIM_FAILED: {} — {}", a.id, msg.clone().unwrap_or_default()));
        }
        results.push(CheckResult { id: format!("claim:{}", a.id), title: a.text.clone(), trust: CheckTrust::Deterministic, authored_by: "agent".into(), passed, message: msg, blocking: true });
    }

    // ── 7. registered checks (the gate's registry): every relevant one must pass ──
    let touch_set = ancestors_inclusive(table, &touched_list);
    for c in engine.store.checks()? {
        if intent::relevant(&c, table, &intent::Touch { nodes: &touch_set, files: &code_rel, symbols: &changed_symbols }) {
            let r = intent::run_check(&c, &snap, &root, &code_rel);
            if !r.passed {
                if r.blocking {
                    blocking.push(format!("CHECK_FAILED: {} ({:?}, by {}) — {}", r.id, r.trust, r.authored_by, r.message.clone().unwrap_or_default()));
                } else {
                    notices.push(format!("REVIEW {} ({:?}): {}", r.id, r.trust, r.message.clone().unwrap_or_default()));
                }
            }
            results.push(r);
        }
    }

    // ── 8. footer obligation and restore conflicts ──
    // Every pending proposal must be disclosed, including ones this commit folds in: implicit
    // acceptance is reported to the user, never silent.
    let pending: Vec<&Turn> = staged_others.iter().collect();
    if !pending.is_empty() && !req.footer_shown {
        blocking.push(format!(
            "FOOTER_REQUIRED: {} proposal(s) are staged; put the AFWE notice from turn.begin in your reply and call turn.commit with footer_shown=true",
            pending.len()
        ));
    }
    if turn.restore.as_ref().map(|r| r.conflicts > 0).unwrap_or(false) {
        for p in &attributed {
            if std::fs::read_to_string(root.join(p)).map(|s| s.contains("<<<<<<< ")).unwrap_or(false) {
                blocking.push(format!("RESTORE_CONFLICT: resolve the conflict markers in {p}, then commit again"));
            }
        }
    }

    // ── 9. confidence and gate ──
    // Mapping is judged on real code only: a README or a JSON fixture does not lower confidence.
    const NON_CODE: &[&str] = &["other", "json", "yaml", "toml", "markdown", "shell"];
    let code_only: Vec<&String> = code_rel
        .iter()
        .filter(|p| snap.code.files.iter().any(|f| &f.path == *p && !NON_CODE.contains(&f.language.as_str())))
        .collect();
    let touched_code = code_only.len();
    let mapped_code = code_only.iter().filter(|f| !snap.mapping.nodes_of(f.as_str()).is_empty()).count();
    let intents_resolved = turn
        .intents
        .iter()
        .filter(|i| {
            (i.action == "create" && i.targets.is_empty())
                || (!i.targets.is_empty() && i.targets.iter().all(|t| table.resolve(t).is_some() || !expand_file(&snap, t).is_empty() || i.action == "create"))
        })
        .count();
    let strength = gate::strength_of(&results);
    let (confidence, parts) = gate::confidence(&ConfidenceInput {
        touched_code,
        mapped_code,
        strength,
        intents_declared: turn.intents.len(),
        intents_resolved,
        warn_conflicts,
    });
    let outcome = gate::decide(&GateInput {
        blocking: blocking.clone(),
        confirm: confirm.clone(),
        notices: notices.clone(),
        checks: &results,
        confidence,
        min_confidence: m.policy.auto_reconcile_min,
        has_changes,
        auto_commit: m.vcs.auto_commit,
        confirmed: req.confirmed,
    });
    let mut reasons = outcome.reasons.clone();
    let vcs_active = vcs.is_repo(&root) && m.vcs.provider != "none";
    if outcome.decision == Decision::Commit && !vcs_active {
        reasons.push("NO_VCS: recorded in .afwe/turns without a commit (no git repository here)".into());
    }

    // ── 10. record the outcome on the turn ──
    turn.touched = TurnTouched { nodes: touched_list.clone(), files: attributed.iter().cloned().collect(), symbols: changed_symbols.clone() };
    turn.implements = after_map.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    turn.checks = results.clone();
    turn.strength = strength;
    turn.confidence = confidence;
    turn.confidence_parts = parts.clone();
    turn.footer_shown = req.footer_shown;
    turn.removes = removes.clone();
    turn.overrides = overrides.iter().filter(|o| !o.reason.starts_with("confirmed by")).cloned().collect();
    if let Some(s) = req.summary.clone() {
        turn.summary = Some(s);
    }
    if turn.summary.is_none() {
        turn.summary = Some(truncate(turn.prompt.lines().next().unwrap_or("").trim(), 100));
    }
    let summary = turn.summary.clone().unwrap_or_default();
    turn.gate = GateRecord { decision: outcome.decision.as_str().into(), reasons: reasons.clone() };

    if outcome.decision == Decision::Redo {
        turn.status = "open".into();
        engine.store.save_turn(&turn)?;
        engine.log(&req.origin, "turn_redo", format!("{id} REDO: {} blocking issue(s)", blocking.len()), Some(json!({"turn": id, "blocking": blocking})))?;
        return Ok(json!({
            "status": "redo",
            "turn": id,
            "strength": strength,
            "confidence": confidence,
            "confidence_parts": parts,
            "failures": blocking,
            "notices": notices,
            "checks": results,
            "required_action": "fix the failures above, then call turn.commit again. Nothing was committed.",
        }));
    }

    if matches!(outcome.decision, Decision::Stage | Decision::Ready) {
        let stage = outcome.decision == Decision::Stage;
        turn.status = if stage { "staged".into() } else { "ready".into() };
        engine.store.save_turn(&turn)?;
        if stage {
            let mut board = engine.store.board()?;
            contract::upsert_system_item(
                &mut board,
                "turn",
                id,
                &format!("Proposal {id} ({:.0}%): {summary}", confidence * 100.0),
                Some("accept (turn.confirm) or revert (turn.revert) — staged, not committed".into()),
            );
            engine.store.save_board(&board)?;
        }
        let kind = if stage { "turn_stage" } else { "turn_ready" };
        engine.log(&req.origin, kind, format!("{id} {}: {summary} ({:.0}%)", turn.status, confidence * 100.0), Some(json!({"turn": id, "reasons": reasons})))?;
        return Ok(json!({
            "status": turn.status,
            "turn": id,
            "strength": strength,
            "confidence": confidence,
            "confidence_parts": parts,
            "checks": results,
            "reasons": reasons,
            "files": turn.touched.files,
            "next": if stage {
                "not committed: confirm with turn.confirm, or revert with turn.revert. Include the footer in your reply until resolved."
            } else {
                "engineer manual mode: commit with git; keep the `AFWE-Turn:` trailer from this record"
            },
        }));
    }

    // ── 11. commit: settle the record, run the registry's generators, then write git ──
    turn.status = "committed".into();
    turn.committed_at = Some(now());
    for a in turn.assumptions.iter_mut() {
        if a.status == "proposed" {
            a.status = "confirmed".into();
        }
    }
    for s in &folded {
        let mut s2 = engine.store.turn(&s.id)?.unwrap_or_else(|| s.clone());
        s2.status = "folded".into();
        s2.folded_into = Some(id.to_string());
        engine.store.save_turn(&s2)?;
        turn.folded.push(s.id.clone());
    }
    let made_checks = intent::checkgen(engine, &turn)?;
    if let Some((kind, sev)) = intent::detect_pin_phrase(&turn.prompt) {
        let nodes: Vec<String> = if touched_list.is_empty() { turn.scope.nodes.clone() } else { touched_list.clone() };
        if !nodes.is_empty() {
            let pin = intent::propose_pin(
                engine,
                PinSpec {
                    statement: format!("{} (from {id}): {}", if kind == "intentional" { "Intentional" } else { "Keep" }, truncate(turn.prompt.lines().next().unwrap_or("").trim(), 160)),
                    kind: kind.into(),
                    severity: sev.into(),
                    attaches: Attachment { nodes, ..Default::default() },
                    reason: Some("keep-phrase in the prompt".into()),
                    origin: "afwe:detect".into(),
                    created_from: Some(id.to_string()),
                    intentional: kind == "intentional",
                },
            )?;
            turn.pin_proposals.push(pin.id);
        }
    }
    engine.store.save_turn(&turn)?;
    if let Some(t) = turn.task.clone() {
        for step in ["afwe_verify", "afwe_update", "afwe_sync", "afwe_log"] {
            let _ = contract::mark_step(engine, Some(&t), step);
        }
        let _ = contract::task_done(engine, Some(&t), Some(&summary), &req.origin);
    }
    let (sync_report, _) = sync(engine, &SyncOptions { dry_run: false, origin: req.origin.clone() })?;

    // git: scoped commit with the trailer. A failed commit leaves the turn `ready`, never half-committed.
    let trailer = format!("AFWE-Turn: {id}");
    let mut commit_info = Value::Null;
    if vcs_active {
        let mut paths: Vec<String> = attributed.iter().cloned().collect();
        paths.extend(AFWE_SOURCE_DIRS.iter().map(|s| s.to_string()));
        let subject = truncate(&summary, 72);
        let msg = format!("{subject}\n\n{trailer}\nAFWE-Strength: {}\nAFWE-Confidence: {:.2}", strength_name(strength), confidence);
        match vcs.commit_paths(&root, &paths, &msg) {
            Ok(Some(sha)) => {
                commit_info = json!({"sha": sha, "trailer": trailer});
            }
            Ok(None) => reasons.push("NOTHING_TO_COMMIT: attributed files already match HEAD".into()),
            Err(e) => {
                turn.status = "ready".into();
                turn.gate.reasons.push(format!("GIT_COMMIT_FAILED: {e:#}"));
                engine.store.save_turn(&turn)?;
                return Ok(json!({"status": "ready", "turn": id, "error": format!("{e:#}"), "next": "fix git (see error), then commit with the trailer `AFWE-Turn: {id}`"}));
            }
        }
    }

    let mut board = engine.store.board()?;
    for it in board.items.iter_mut().filter(|i| i.kind == "turn" && i.status == "open" && (i.reference.as_deref() == Some(id) || folded.iter().any(|f| Some(f.id.as_str()) == i.reference.as_deref()))) {
        it.status = "done".into();
        it.resolved = Some(now());
    }
    engine.store.save_board(&board)?;
    engine.log(
        &req.origin,
        "turn_commit",
        format!("{id} committed: {summary} [{} {:.0}%]", strength_name(strength), confidence * 100.0),
        Some(json!({"turn": id, "commit": commit_info, "folded": turn.folded, "checkgen": made_checks})),
    )?;

    let badge = format!("✔ AFWE Turn {id} {} [Confidence: {:.0}% · Strength: {}]", if vcs_active { "committed" } else { "recorded" }, confidence * 100.0, strength_name(strength));
    Ok(json!({
        "status": "committed",
        "turn": id,
        "summary": summary,
        "commit": commit_info,
        "strength": strength,
        "confidence": confidence,
        "confidence_parts": parts,
        "checks": results,
        "notices": notices,
        "reasons": reasons,
        "folded": turn.folded,
        "implicitly_accepted": folded.iter().map(|f| json!({"turn": f.id, "why": "this turn works on the same nodes; proposals are accepted implicitly and reported here"})).collect::<Vec<_>>(),
        "checkgen": made_checks,
        "pin_proposals": turn.pin_proposals,
        "sync": {"files": sync_report.files, "applied": sync_report.applied.len(), "proposed": sync_report.proposed.len()},
        "badge": badge,
    }))
}

fn pins_active_confirm(engine: &Engine) -> Result<Vec<String>> {
    Ok(engine.store.pins()?.into_iter().filter(|p| p.status == "active" && p.severity == "confirm").map(|p| p.id).collect())
}

pub fn strength_name(t: CheckTrust) -> &'static str {
    match t {
        CheckTrust::Deterministic => "deterministic",
        CheckTrust::Generated => "generated",
        CheckTrust::LlmJudged => "llm_judged",
        CheckTrust::Unverified => "UNVERIFIED",
    }
}

// ───────────────────────────── confirm / revert ─────────────────────────────

pub fn confirm(engine: &Engine, id: &str, origin: &str) -> Result<Value> {
    let t = load(engine, id)?;
    if t.status != "staged" {
        return Err(anyhow!("turn {id} is {}; only staged proposals are confirmed", t.status));
    }
    commit(engine, id, CommitRequest { footer_shown: true, origin: origin.to_string(), confirmed: true, ..Default::default() })
}

/// Undo what a turn did, as far as that is safe: files that were clean at turn.begin go back to HEAD,
/// files the turn created are removed. Anything the user had already changed before the turn began
/// cannot be reverted mechanically, so it becomes a Board item for the harness to reconcile.
pub fn revert(engine: &Engine, id: &str, origin: &str) -> Result<Value> {
    let mut t = load(engine, id)?;
    if !matches!(t.status.as_str(), "open" | "staged" | "ready") {
        return Err(anyhow!("turn {id} is {}; only open, staged or ready turns can be reverted", t.status));
    }
    let m = engine.store.manifest()?;
    let vcs = vcs::open(&m.vcs.provider);
    let root = engine.store.project_root.clone();
    let snap = engine.snapshot(true)?;
    let base = engine.store.baseline(id)?;
    let changed: Vec<String> = match &base {
        Some(b) => changed_paths(&b.files, &tree_hashes(engine, &snap)).into_iter().collect(),
        None => t.touched.files.clone(),
    };
    let (mut restored, mut deleted, mut manual) = (vec![], vec![], vec![]);
    for f in &changed {
        let head = vcs.show(&root, "HEAD", f);
        let base_hash = base.as_ref().and_then(|b| b.files.get(f).cloned());
        match (head, base_hash) {
            (Some(c), Some(bh)) if hash_bytes(c.as_bytes()) == bh => {
                std::fs::write(root.join(f), c)?;
                restored.push(f.clone());
            }
            (None, None) => {
                if root.join(f).exists() {
                    std::fs::remove_file(root.join(f))?;
                }
                deleted.push(f.clone());
            }
            _ => manual.push(f.clone()),
        }
    }
    let mut board = engine.store.board()?;
    for it in board.items.iter_mut().filter(|i| i.kind == "turn" && i.status == "open" && i.reference.as_deref() == Some(id)) {
        it.status = "dismissed".into();
        it.resolved = Some(now());
    }
    if !manual.is_empty() {
        contract::upsert_system_item(
            &mut board,
            "revert",
            &format!("{id}:manual"),
            &format!("Manual revert needed for {id}: {}", manual.join(", ")),
            Some("these files had user edits before the turn began; reconcile them with a new turn".into()),
        );
    }
    engine.store.save_board(&board)?;
    t.status = "reverted".into();
    engine.store.save_turn(&t)?;
    engine.log(origin, "turn_revert", format!("{id} reverted: {} restored, {} removed, {} need a manual revert", restored.len(), deleted.len(), manual.len()), Some(json!({"turn": id})))?;
    Ok(json!({"status": "reverted", "turn": id, "restored": restored, "removed": deleted, "manual": manual}))
}

pub fn get(engine: &Engine, id: &str) -> Result<Turn> {
    load(engine, id)
}

pub fn list(engine: &Engine) -> Result<Vec<Turn>> {
    engine.store.turns()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whole_word_matching() {
        assert!(contains_word("update the ui now", "ui"));
        assert!(!contains_word("build the thing", "ui"));
        assert!(contains_word("payments: charge", "payments"));
    }

    #[test]
    fn changed_paths_sees_add_modify_delete() {
        let base = BTreeMap::from([("a".to_string(), "1".to_string()), ("b".to_string(), "2".to_string())]);
        let now = BTreeMap::from([("a".to_string(), "1".to_string()), ("b".to_string(), "9".to_string()), ("c".to_string(), "3".to_string())]);
        let ch: Vec<String> = changed_paths(&base, &now).into_iter().collect();
        assert_eq!(ch, vec!["b".to_string(), "c".to_string()]);
        let gone: Vec<String> = changed_paths(&now, &base).into_iter().collect();
        assert!(gone.contains(&"c".to_string()));
    }

    #[test]
    fn code_prefix_and_relative_paths() {
        let mut m = Manifest { format: "afwe/2".into(), project: ProjectMeta { name: "x".into(), description: None, root: ".".into() }, analyzer: AnalyzerConfig::default(), policy: Policy::default(), provenance: ProvenanceConfig::default(), vcs: VcsConfig::default(), profile: None };
        assert_eq!(code_prefix(&m), "");
        m.project.root = "app/".into();
        assert_eq!(code_prefix(&m), "app/");
        assert_eq!(to_code_rel("app/", "app/src/a.ts"), Some("src/a.ts".into()));
        assert_eq!(to_code_rel("app/", "other/a.ts"), None);
    }
}

/// `afwe gate` — the whole-project gate used by CI and humans: constraints and guardrails over the
/// full project, every active registered check, and the project test command. Appends one log line.
pub fn gate_now(engine: &Engine, origin: &str) -> Result<Value> {
    let snap = engine.snapshot(true)?;
    let code_root = engine.store.code_root(&snap.manifest);
    let report = verify(&snap, &code_root, &VerifyOptions { changed: vec![], run_commands: true, include_drift: false });
    let all: Vec<String> = snap.code.files.iter().map(|f| f.path.clone()).collect();
    let mut failures: Vec<String> = report.issues.iter().filter(|i| i.severity == "error").map(|i| format!("{} — {}", i.id, i.message)).collect();
    let mut results = vec![];
    for c in engine.store.checks()?.into_iter().filter(|c| c.status == "active") {
        let r = intent::run_check(&c, &snap, &code_root, &all);
        if !r.passed && r.blocking {
            failures.push(format!("{} — {}", r.id, r.message.clone().unwrap_or_default()));
        }
        results.push(r);
    }
    if let Some(cmd) = &snap.manifest.vcs.test_command {
        let (ok, msg) = intent::run_command(cmd, &code_root, &all, 600);
        if !ok {
            failures.push(format!("project tests `{cmd}` — {}", msg.unwrap_or_default()));
        }
    }
    let ok = failures.is_empty();
    engine.log(origin, "gate", format!("gate {}: {} failure(s)", if ok { "passed" } else { "failed" }, failures.len()), None)?;
    Ok(json!({
        "ok": ok,
        "failures": failures,
        "verify": {"errors": report.errors, "warnings": report.warnings},
        "checks": results,
    }))
}
