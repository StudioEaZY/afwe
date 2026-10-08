//! Living intents, pins (human-locked decisions under a budget), the check registry and checkgen,
//! the default app that turns confirmed assumptions into standing checks.

use crate::analyze::build_globset;
use crate::claims;
use crate::engine::{Engine, Snapshot};
use crate::mapping::NodeTable;
use crate::model::*;
use crate::util::{now, short_id, slug, truncate};
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

pub const ACTIONS: &[&str] = &["create", "update", "refine", "remove", "rename", "move", "replace", "keep"];
/// Actions that change or remove something a pin may protect.
pub const DESTRUCTIVE: &[&str] = &["remove", "rename", "move", "replace"];

// ───────────────────────────── intents ─────────────────────────────

/// Create or refine intents declared by a turn. Statements are *derived* views: every change is
/// appended to `history`, and each intent remembers the turns (raw prompts) it came from.
pub fn upsert_intents(engine: &Engine, turn: &Turn, decls: &[TurnIntent], table: &NodeTable) -> Result<Vec<String>> {
    let all = engine.store.intents()?;
    let mut ids = vec![];
    for d in decls {
        let existing = engine.store.intent(&d.id)?;
        let nodes: Vec<String> = d.targets.iter().filter_map(|t| table.resolve(t)).collect();
        let files: Vec<String> = d.targets.iter().filter(|t| table.resolve(t).is_none()).cloned().collect();
        let mut intent = existing.clone().unwrap_or_else(|| Intent {
            id: d.id.clone(),
            title: d.id.clone(),
            statement: None,
            status: "active".into(),
            origin: Some(turn.origin.clone()),
            attaches: Attachment::default(),
            parents: vec![],
            from_turns: vec![],
            history: vec![],
            pins: vec![],
            graph: None,
            created: Some(now()),
            updated: None,
            task: turn.task.clone(),
        });
        if let Some(t) = &d.title {
            intent.title = t.clone();
        }
        let statement = d
            .statement
            .clone()
            .or_else(|| intent.statement.clone())
            .unwrap_or_else(|| truncate(turn.prompt.trim(), 400));
        if intent.statement.as_deref() != Some(statement.as_str()) {
            intent.history.push(IntentRevision { turn: turn.id.clone(), ts: now(), statement: statement.clone() });
            intent.statement = Some(statement);
        }
        for n in nodes {
            if !intent.attaches.nodes.contains(&n) {
                intent.attaches.nodes.push(n);
            }
        }
        for f in files {
            if !intent.attaches.files.contains(&f) {
                intent.attaches.files.push(f);
            }
        }
        if !intent.from_turns.contains(&turn.id) {
            intent.from_turns.push(turn.id.clone());
        }
        for r in &turn.refines {
            for other in all.iter().filter(|o| o.id != intent.id && o.from_turns.contains(r)) {
                if !intent.parents.contains(&other.id) {
                    intent.parents.push(other.id.clone());
                }
            }
        }
        intent.status = if d.action == "remove" {
            "archived".into()
        } else if intent.status == "archived" {
            "active".into()
        } else {
            intent.status.clone()
        };
        intent.updated = Some(now());
        engine.store.save_intent(&intent)?;
        ids.push(intent.id.clone());
    }
    Ok(ids)
}

// ───────────────────────────── pins & budget ─────────────────────────────

/// Codebase-derived pin limit: grows with the blueprint (≈ 2 + 1.5·√nodes), clamped to [3, 60].
pub fn auto_pin_limit(nodes: usize) -> usize {
    ((2.0 + 1.5 * (nodes as f64).sqrt()).round() as usize).clamp(3, 60)
}

/// The manual slider scales the automatic limit: 1 relaxed (×0.5) … 3 balanced (×1) … 5 strict (×2).
pub fn slider_multiplier(slider: u8) -> f64 {
    match slider.clamp(1, 5) {
        1 => 0.5,
        2 => 0.75,
        3 => 1.0,
        4 => 1.5,
        _ => 2.0,
    }
}

pub fn pin_budget(nodes: usize, slider: u8, active: usize) -> Value {
    let auto = auto_pin_limit(nodes);
    let mult = slider_multiplier(slider);
    let limit = ((auto as f64) * mult).round().max(1.0) as usize;
    json!({
        "blueprint_nodes": nodes,
        "auto_limit": auto,
        "slider": slider.clamp(1, 5),
        "multiplier": mult,
        "limit": limit,
        "active": active,
        "remaining": limit.saturating_sub(active),
    })
}

pub fn budget(engine: &Engine) -> Result<Value> {
    let m = engine.store.manifest()?;
    let nodes = NodeTable::from_blueprint(&engine.store.blueprint()?).nodes.len();
    let active = engine.store.pins()?.iter().filter(|p| p.status == "active").count();
    Ok(pin_budget(nodes, m.policy.pins.slider, active))
}

/// Keep-phrases that turn a prompt into a pin *proposal* (never an active pin by itself).
/// Returns (kind, severity).
pub fn detect_pin_phrase(prompt: &str) -> Option<(&'static str, &'static str)> {
    let p = prompt.to_lowercase();
    if ["intentional", "on purpose", "not a bug", "by design"].iter().any(|k| p.contains(k)) {
        return Some(("intentional", "block"));
    }
    if ["keep it like that", "keep it this way", "leave it as is", "don't change", "do not change", "must stay"]
        .iter()
        .any(|k| p.contains(k))
    {
        return Some(("decision", "confirm"));
    }
    None
}

pub struct PinSpec {
    pub statement: String,
    pub kind: String,
    pub severity: String,
    pub attaches: Attachment,
    pub reason: Option<String>,
    pub origin: String,
    pub created_from: Option<String>,
    pub intentional: bool,
}

/// Human-originated pins are active at once (budget permitting); anything else is a proposal
/// that a human accepts.
pub fn propose_pin(engine: &Engine, s: PinSpec) -> Result<Pin> {
    let statement = s.statement.trim().to_string();
    if statement.is_empty() {
        return Err(anyhow!("a pin needs a statement"));
    }
    let human = s.origin.starts_with("human");
    let mut pin = Pin {
        id: short_id("pin"),
        statement,
        kind: s.kind,
        attaches: s.attaches,
        severity: s.severity,
        status: "proposed".into(),
        origin: s.origin.clone(),
        created: now(),
        created_from: s.created_from,
        reason: s.reason,
        retired: None,
        intentional: s.intentional,
    };
    engine.store.save_pin(&pin)?;
    if human {
        pin = accept_pin(engine, &pin.id, &s.origin)?;
    }
    engine.log(&s.origin, "pin_propose", format!("Pin {} ({}): {}", pin.id, pin.status, truncate(&pin.statement, 120)), None)?;
    Ok(pin)
}

pub fn accept_pin(engine: &Engine, id: &str, origin: &str) -> Result<Pin> {
    let mut pin = engine.store.pin(id)?.ok_or_else(|| anyhow!("pin `{id}` not found"))?;
    if pin.status == "active" {
        return Ok(pin);
    }
    if pin.status == "retired" {
        return Err(anyhow!("pin `{id}` is retired"));
    }
    let b = budget(engine)?;
    let (active, limit) = (b["active"].as_u64().unwrap_or(0), b["limit"].as_u64().unwrap_or(1));
    if active >= limit {
        return Err(anyhow!(
            "pin budget reached ({active}/{limit} active). Retire a pin, or raise the pin slider (`afwe pin budget --slider N`)"
        ));
    }
    pin.status = "active".into();
    engine.store.save_pin(&pin)?;
    engine.log(origin, "pin_accept", format!("Pin {id} is active: {}", truncate(&pin.statement, 120)), None)?;
    Ok(pin)
}

pub fn retire_pin(engine: &Engine, id: &str, reason: Option<String>, origin: &str) -> Result<Pin> {
    let mut pin = engine.store.pin(id)?.ok_or_else(|| anyhow!("pin `{id}` not found"))?;
    pin.status = "retired".into();
    pin.retired = Some(now());
    if reason.is_some() {
        pin.reason = reason;
    }
    engine.store.save_pin(&pin)?;
    engine.log(origin, "pin_retire", format!("Pin {id} retired"), None)?;
    Ok(pin)
}

pub fn set_slider(engine: &Engine, slider: u8, origin: &str) -> Result<Value> {
    let mut m = engine.store.manifest()?;
    m.policy.pins.slider = slider.clamp(1, 5);
    engine.store.save_manifest(&m)?;
    engine.log(origin, "pin_budget", format!("Pin slider set to {}", m.policy.pins.slider), None)?;
    budget(engine)
}

// ───────────────────────────── checks (the registry) ─────────────────────────────

pub fn add_check(engine: &Engine, mut c: CheckSpec, origin: &str) -> Result<CheckSpec> {
    if c.command.is_none() && c.claim.is_none() {
        return Err(anyhow!("a check needs a `command` (shell, exit 0 = pass) or a `claim`"));
    }
    if c.trust == CheckTrust::Unverified {
        return Err(anyhow!("a check's trust must be deterministic, generated or llm_judged"));
    }
    if let Some(cl) = &c.claim {
        let table = NodeTable::from_blueprint(&engine.store.blueprint()?);
        claims::validate(cl, &table).map_err(|e| anyhow!(e))?;
    }
    c.id = if c.id.is_empty() { short_id("check") } else { slug(&c.id) };
    c.status = "active".into();
    c.created = Some(now());
    c.origin = Some(origin.to_string());
    engine.store.save_check(&c)?;
    engine.log(origin, "check_add", format!("Check {} registered ({:?}, by {})", c.id, c.trust, c.authored_by), None)?;
    Ok(c)
}

pub fn remove_check(engine: &Engine, id: &str, origin: &str) -> Result<()> {
    engine.store.remove_check_file(id)?;
    engine.log(origin, "check_remove", format!("Check {id} removed from the gate"), None)
}

/// What a turn touched, expressed the way checks are attached.
pub struct Touch<'a> {
    /// touched nodes plus their ancestors
    pub nodes: &'a BTreeSet<String>,
    /// code-root-relative changed files
    pub files: &'a [String],
    pub symbols: &'a [String],
}

pub fn relevant(c: &CheckSpec, table: &NodeTable, touch: &Touch) -> bool {
    if c.status != "active" {
        return false;
    }
    if c.attaches.is_empty() || c.attaches.global {
        return true;
    }
    let by_node = c.attaches.nodes.iter().filter_map(|n| table.resolve(n)).any(|n| touch.nodes.contains(&n));
    let by_file = !c.attaches.files.is_empty()
        && build_globset(&c.attaches.files).map(|g| touch.files.iter().any(|f| g.is_match(f))).unwrap_or(false);
    let by_symbol = c.attaches.symbols.iter().any(|s| touch.symbols.contains(s));
    by_node || by_file || by_symbol
}

/// Runs a shell check with a time limit. The changed files are exported as AFWE_CHANGED_FILES.
/// A check that times out keeps running in the background; it is reported as failed.
pub fn run_command(cmd: &str, root: &Path, changed: &[String], timeout_s: u64) -> (bool, Option<String>) {
    let (tx, rx) = mpsc::channel();
    let (cmd, root, env) = (cmd.to_string(), root.to_path_buf(), changed.join("\n"));
    std::thread::spawn(move || {
        let out = std::process::Command::new("sh").arg("-c").arg(&cmd).current_dir(&root).env("AFWE_CHANGED_FILES", env).output();
        let _ = tx.send(out);
    });
    match rx.recv_timeout(Duration::from_secs(timeout_s)) {
        Ok(Ok(o)) => {
            let mut text = String::from_utf8_lossy(&o.stdout).into_owned();
            text.push_str(&String::from_utf8_lossy(&o.stderr));
            if o.status.success() {
                (true, None)
            } else {
                let tail: Vec<&str> = text.lines().rev().take(12).collect();
                let tail: Vec<&str> = tail.into_iter().rev().collect();
                (false, Some(format!("exit {}: {}", o.status.code().unwrap_or(-1), tail.join(" | "))))
            }
        }
        Ok(Err(e)) => (false, Some(format!("could not run: {e}"))),
        Err(_) => (false, Some(format!("timed out after {timeout_s}s"))),
    }
}

pub fn run_check(c: &CheckSpec, snap: &Snapshot, root: &Path, scope: &[String]) -> CheckResult {
    let blocking = matches!(c.trust, CheckTrust::Deterministic | CheckTrust::Generated);
    let (passed, message) = if let Some(cl) = &c.claim {
        match claims::evaluate(cl, snap, root, scope) {
            Ok(None) => (true, None),
            Ok(Some(why)) => (false, Some(why)),
            Err(e) => (false, Some(format!("claim could not be evaluated: {e:#}"))),
        }
    } else if let Some(cmd) = &c.command {
        run_command(cmd, root, scope, c.timeout_s.unwrap_or(120))
    } else {
        (false, Some("check has neither command nor claim".into()))
    };
    CheckResult { id: c.id.clone(), title: c.title.clone(), trust: c.trust, authored_by: c.authored_by.clone(), passed, message, blocking }
}

/// checkgen (default app): every *confirmed* assumption claim becomes a standing deterministic check
/// authored by `checkgen`, so later prompts are verified against it without anyone writing a test.
pub fn checkgen(engine: &Engine, turn: &Turn) -> Result<Vec<String>> {
    if !engine.store.manifest()?.policy.checkgen {
        return Ok(vec![]);
    }
    let mut made = vec![];
    for a in turn.assumptions.iter().filter(|a| a.status == "confirmed") {
        let Some(claim) = &a.claim else { continue };
        let id = slug(&format!("{}-{}", turn.id, a.id));
        if engine.store.check(&id)?.is_some() {
            continue;
        }
        let spec = CheckSpec {
            id: id.clone(),
            title: a.text.clone(),
            trust: CheckTrust::Deterministic,
            authored_by: "checkgen".into(),
            attaches: Attachment { nodes: claim.to_nodes.clone(), files: claim.files.clone(), ..Default::default() },
            command: None,
            claim: Some(claim.clone()),
            timeout_s: None,
            status: "active".into(),
            origin: Some("afwe:checkgen".into()),
            created: Some(now()),
            created_from: Some(turn.id.clone()),
        };
        engine.store.save_check(&spec)?;
        made.push(id);
    }
    Ok(made)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn budget_grows_with_codebase_and_follows_slider() {
        assert_eq!(auto_pin_limit(0), 3);
        assert!(auto_pin_limit(100) > auto_pin_limit(16));
        assert_eq!(auto_pin_limit(10_000), 60);
        let b = pin_budget(16, 3, 0);
        assert_eq!(b["auto_limit"], 8);
        assert_eq!(b["limit"], 8);
        let strict = pin_budget(16, 5, 0);
        assert_eq!(strict["limit"], 16);
        let relaxed = pin_budget(16, 1, 0);
        assert_eq!(relaxed["limit"], 4);
    }

    #[test]
    fn keep_phrases_propose_pins() {
        assert_eq!(detect_pin_phrase("no, keep it like that"), Some(("decision", "confirm")));
        assert_eq!(detect_pin_phrase("this is intentional, fix the rest"), Some(("intentional", "block")));
        assert_eq!(detect_pin_phrase("make the button blue"), None);
    }
}
