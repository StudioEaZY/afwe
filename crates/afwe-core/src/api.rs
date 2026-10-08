//! The single JSON surface of the engine. CLI, MCP server, HTTP studio host and the
//! Tauri shell all call `call(engine, op, params)`. Ops are stable names; params are JSON.

use crate::context::{build_context, ContextQuery};
use crate::contract::{self, TaskStart};
use crate::drift;
use crate::intent::{self, PinSpec};
use crate::onboard;
use crate::timeline;
use crate::turn;
use crate::engine::{Engine, Snapshot};
use crate::lens::resolve_lens;
use crate::model::*;
use crate::ops;
use crate::sync::{sync, SyncOptions};
use crate::verify::{verify, VerifyOptions};
use anyhow::{anyhow, Result};
use serde_json::{json, Value};

fn s(p: &Value, k: &str) -> Option<String> {
    p.get(k).and_then(|v| v.as_str()).map(|s| s.to_string()).filter(|s| !s.is_empty())
}
fn req(p: &Value, k: &str) -> Result<String> {
    s(p, k).ok_or_else(|| anyhow!("missing parameter `{k}`"))
}
fn b(p: &Value, k: &str, d: bool) -> bool {
    p.get(k).and_then(|v| v.as_bool()).unwrap_or(d)
}
fn list(p: &Value, k: &str) -> Vec<String> {
    match p.get(k) {
        Some(Value::Array(a)) => a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect(),
        Some(Value::String(st)) => st.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect(),
        _ => vec![],
    }
}
fn origin(p: &Value, default: &str) -> String {
    s(p, "origin").unwrap_or_else(|| default.to_string())
}
fn j<T: serde::Serialize>(v: T) -> Result<Value> {
    Ok(serde_json::to_value(v)?)
}
fn parse_vec<T: serde::de::DeserializeOwned>(p: &Value, k: &str) -> Result<Vec<T>> {
    match p.get(k) {
        Some(v) if !v.is_null() => Ok(serde_json::from_value(v.clone()).map_err(|e| anyhow!("`{k}`: {e}"))?),
        _ => Ok(vec![]),
    }
}

/// Snapshot that is guaranteed to know about `files` (re‑analyses when the cache is stale).
fn snapshot_for(engine: &Engine, files: &[String], refresh: bool) -> Result<Snapshot> {
    let snap = engine.snapshot(refresh)?;
    if refresh || snap.fresh {
        return Ok(snap);
    }
    let root = engine.store.code_root(&snap.manifest);
    let missing = files.iter().any(|f| !snap.index.files.contains_key(f.trim_start_matches("./")) && root.join(f).is_file());
    if missing {
        return engine.snapshot(true);
    }
    Ok(snap)
}

/// Entry point: dispatch + contract bookkeeping (mutating ops tick the matching Board step
/// of the most recent open task, so the harness does not have to report them separately).
pub fn call(engine: &Engine, op: &str, params: Value, default_origin: &str) -> Result<Value> {
    let task = params.get("task").and_then(|v| v.as_str()).map(|s| s.to_string());
    let result = dispatch(engine, op, params, default_origin)?;
    let step = match op {
        o if o.starts_with("memory.add") || o.starts_with("memory.update") || o.starts_with("guardrail.add") => Some("afwe_update"),
        o if o.starts_with("blueprint.") && o != "blueprint.get" => Some("afwe_blueprint"),
        o if o.starts_with("workflow.") && !matches!(o, "workflow.get" | "workflow.list") => Some("afwe_workflow"),
        _ => None,
    };
    if let Some(step) = step {
        let _ = contract::mark_step(engine, task.as_deref(), step);
        if step == "afwe_blueprint" || step == "afwe_workflow" {
            let _ = contract::mark_step(engine, task.as_deref(), "afwe_update");
        }
    }
    Ok(result)
}

fn dispatch(engine: &Engine, op: &str, params: Value, default_origin: &str) -> Result<Value> {
    let p = if params.is_null() { json!({}) } else { params };
    match op {
        // ───────── read ─────────
        "status" => status(engine),
        "graph" => graph(engine, &p),
        "context" => {
            let mut q: ContextQuery = serde_json::from_value(p.clone()).unwrap_or_default();
            if q.files.is_empty() {
                q.files = list(&p, "files");
                if let Some(f) = s(&p, "file") {
                    q.files.push(f);
                }
            }
            let snap = snapshot_for(engine, &q.files, b(&p, "refresh", false))?;
            let sync = engine.store.sync_state()?.last_sync.map(|t| format!("last sync {t}")).unwrap_or("never synced (run `afwe sync`)".into());
            let bundle = build_context(&snap, q, &sync);
            if b(&p, "mark_step", true) {
                let _ = contract::mark_step(engine, s(&p, "task").as_deref(), "afwe_context");
            }
            j(bundle)
        }
        "verify" => {
            let mut files = list(&p, "files");
            files.extend(list(&p, "changed"));
            let snap = snapshot_for(engine, &files, b(&p, "refresh", true))?;
            let root = engine.store.code_root(&snap.manifest);
            let report = verify(&snap, &root, &VerifyOptions { changed: files, run_commands: b(&p, "run_commands", true), include_drift: b(&p, "include_drift", true) });
            if report.ok {
                let _ = contract::mark_step(engine, s(&p, "task").as_deref(), "afwe_verify");
            }
            engine.log(&origin(&p, default_origin), "verify", format!("verify: {} ({} errors, {} warnings)", if report.ok { "ok" } else { "failed" }, report.errors, report.warnings), None)?;
            j(report)
        }
        "sync" => {
            let (report, _) = sync(engine, &SyncOptions { dry_run: b(&p, "dry_run", false), origin: origin(&p, default_origin) })?;
            if !b(&p, "dry_run", false) {
                let _ = contract::mark_step(engine, s(&p, "task").as_deref(), "afwe_sync");
            }
            j(report)
        }
        "drift" => {
            let files = list(&p, "files");
            let snap = snapshot_for(engine, &files, b(&p, "refresh", true))?;
            let findings = drift::detect(&snap, if files.is_empty() { None } else { Some(&files) });
            let policy = &snap.manifest.policy;
            let bucket = |f: &Finding| if f.change.is_none() { "info" } else if f.confidence >= policy.auto_reconcile_min { "auto" } else if f.confidence >= policy.soft_reconcile_min { "soft" } else { "proposal" };
            let items: Vec<Value> = findings.iter().map(|f| json!({"finding": f, "bucket": bucket(f), "describe": f.change.as_ref().map(|c| crate::verify::describe_change(c, &snap.table))})).collect();
            Ok(json!({"count": findings.len(), "findings": items, "policy": policy}))
        }
        "search" => search(engine, &req(&p, "q")?),
        "file.read" => {
            let m = engine.store.manifest()?;
            let path = req(&p, "path")?;
            if path.contains("..") {
                return Err(anyhow!("invalid path"));
            }
            let abs = engine.store.code_root(&m).join(&path);
            let text = std::fs::read_to_string(&abs)?;
            Ok(json!({"path": path, "content": crate::util::truncate(&text, 60_000)}))
        }

        // ───────── blueprint ─────────
        "blueprint.get" => {
            let snap = engine.snapshot(false)?;
            match s(&p, "node") {
                Some(n) => node_detail(&snap, &n),
                None => j(&snap.sources.blueprint),
            }
        }
        "blueprint.add" => j(ops::add_node(engine, ops::AddNode { name: req(&p, "name")?, parent: s(&p, "parent"), kind: s(&p, "kind"), purpose: s(&p, "purpose"), description: s(&p, "description"), files: list(&p, "files"), symbols: list(&p, "symbols"), status: s(&p, "status"), id: s(&p, "id"), tags: list(&p, "tags") }, &origin(&p, default_origin))?),
        "blueprint.move" => {
            ops::move_node(engine, &req(&p, "node")?, s(&p, "parent").as_deref(), &origin(&p, default_origin))?;
            Ok(json!({"ok": true}))
        }
        "blueprint.update" => j(ops::update_node(engine, &req(&p, "node")?, p.get("patch").unwrap_or(&p), &origin(&p, default_origin))?),
        "blueprint.remove" => j(ops::remove_node_op(engine, &req(&p, "node")?, &origin(&p, default_origin))?),
        "blueprint.map" => j(ops::map_node(engine, &req(&p, "node")?, &list(&p, "files"), &list(&p, "symbols"), false, &origin(&p, default_origin))?),
        "blueprint.unmap" => j(ops::map_node(engine, &req(&p, "node")?, &list(&p, "files"), &list(&p, "symbols"), true, &origin(&p, default_origin))?),
        "blueprint.relate" => j(ops::relate(engine, &req(&p, "from")?, &req(&p, "to")?, &s(&p, "kind").unwrap_or("depends_on".into()), s(&p, "rationale"), false, &origin(&p, default_origin))?),
        "blueprint.unrelate" => j(ops::relate(engine, &req(&p, "from")?, &req(&p, "to")?, "depends_on", None, true, &origin(&p, default_origin))?),
        "blueprint.constrain" => j(ops::constrain(engine, ops::Constrain { id: s(&p, "id"), rule: s(&p, "rule").unwrap_or("must_not_depend".into()), from: req(&p, "from")?, to: list(&p, "to"), except: { let mut e = list(&p, "except"); e.extend(list(&p, "allowed")); e }, description: s(&p, "description"), rationale: s(&p, "rationale"), severity: s(&p, "severity"), phase: s(&p, "phase") }, &origin(&p, default_origin))?),
        "blueprint.unconstrain" => {
            ops::remove_constraint(engine, &req(&p, "id")?, &origin(&p, default_origin))?;
            Ok(json!({"ok": true}))
        }
        "blueprint.edit" => {
            // umbrella for MCP: {op: add|move|update|remove|map|unmap|relate|unrelate|constrain|unconstrain, ...}
            let sub = req(&p, "op")?;
            dispatch(engine, &format!("blueprint.{sub}"), p.clone(), default_origin)
        }

        // ───────── memory ─────────
        "memory.list" | "memory.find" => {
            let snap = engine.snapshot(false)?;
            let kind = s(&p, "kind").map(|k| crate::store::singular(&k));
            let node = s(&p, "node").and_then(|n| snap.table.resolve(&n));
            let tag = s(&p, "tag");
            let q = s(&p, "q").or(s(&p, "query")).map(|x| x.to_lowercase());
            let file = s(&p, "file");
            let chain: Vec<String> = node.as_ref().map(|n| { let mut c = vec![n.clone()]; c.extend(snap.table.ancestors(n)); c }).unwrap_or_default();
            let items: Vec<Value> = snap.sources.memory.iter().filter(|m| {
                kind.as_ref().map(|k| &m.meta.kind == k).unwrap_or(true)
                    && node.as_ref().map(|_| m.meta.applies_to.iter().filter_map(|r| snap.table.resolve(r)).any(|id| chain.contains(&id))).unwrap_or(true)
                    && tag.as_ref().map(|t| m.meta.tags.contains(t)).unwrap_or(true)
                    && q.as_ref().map(|q| m.meta.title.to_lowercase().contains(q) || m.body.to_lowercase().contains(q) || m.meta.id.contains(q)).unwrap_or(true)
                    && file.as_ref().map(|f| m.meta.files.iter().any(|g| crate::analyze::build_globset(&[g.clone()]).map(|gs| gs.is_match(f)).unwrap_or(false) || g == f)).unwrap_or(true)
            }).map(|m| json!({"id": m.meta.id, "kind": m.meta.kind, "title": m.meta.title, "status": m.meta.status, "applies_to": m.meta.applies_to, "files": m.meta.files, "symbols": m.meta.symbols, "tags": m.meta.tags, "path": format!(".afwe/{}", m.path), "created": m.meta.created, "origin": m.meta.origin, "excerpt": crate::util::truncate(m.body.trim(), 240)})).collect();
            Ok(json!({"count": items.len(), "memory": items}))
        }
        "memory.get" => {
            let id = req(&p, "id")?;
            let m = engine.store.memory()?.into_iter().find(|m| m.meta.id == id).ok_or_else(|| anyhow!("memory `{id}` not found"))?;
            j(m)
        }
        "memory.add" => j(ops::memory_add(engine, ops::MemoryAdd { kind: req(&p, "kind")?, title: req(&p, "title")?, body: s(&p, "body").unwrap_or_default(), id: s(&p, "id"), applies_to: { let mut a = list(&p, "applies_to"); a.extend(list(&p, "nodes")); a }, files: list(&p, "files"), symbols: list(&p, "symbols"), tags: list(&p, "tags"), status: s(&p, "status"), supersedes: s(&p, "supersedes"), enforces: list(&p, "enforces"), workflow: s(&p, "workflow") }, &origin(&p, default_origin))?),
        "memory.update" => j(ops::memory_update(engine, &req(&p, "id")?, p.get("patch").unwrap_or(&p), &origin(&p, default_origin))?),
        "memory.remove" => {
            ops::memory_remove(engine, &req(&p, "id")?, &origin(&p, default_origin))?;
            Ok(json!({"ok": true}))
        }

        // ───────── guardrails ─────────
        "guardrail.list" => j(engine.store.guardrails()?),
        "guardrail.add" => {
            let g: Guardrail = serde_json::from_value(p.get("guardrail").cloned().unwrap_or(p.clone()))?;
            j(ops::guardrail_add(engine, g, &origin(&p, default_origin))?)
        }
        "guardrail.remove" => {
            ops::guardrail_remove(engine, &req(&p, "id")?, &origin(&p, default_origin))?;
            Ok(json!({"ok": true}))
        }

        // ───────── workflows ─────────
        "workflow.list" => {
            let ws = engine.store.workflows()?;
            Ok(json!(ws.iter().map(|w| json!({"id": w.id, "title": w.title, "status": w.status, "origin": w.origin, "nodes": w.nodes.len(), "edges": w.edges.len(), "targets": w.targets, "updated": w.updated, "task": w.task})).collect::<Vec<_>>()))
        }
        "workflow.get" => j(engine.store.workflow(&req(&p, "id")?)?),
        "workflow.new" => j(ops::workflow_new(engine, &req(&p, "title")?, s(&p, "id"), s(&p, "description"), s(&p, "prompt"), list(&p, "targets"), s(&p, "task"), &origin(&p, default_origin))?),
        "workflow.add_node" => {
            let (w, n) = ops::workflow_add_node(engine, ops::WfAddNode { workflow: req(&p, "workflow")?, kind: s(&p, "kind").unwrap_or("step".into()), title: req(&p, "title")?, text: s(&p, "text"), after: s(&p, "after"), edge_kind: s(&p, "edge_kind"), id: s(&p, "id"), position: p.get("position").and_then(|v| serde_json::from_value(v.clone()).ok()) }, &origin(&p, default_origin))?;
            Ok(json!({"workflow": w, "node": n}))
        }
        "workflow.link" => j(ops::workflow_link(engine, &req(&p, "workflow")?, &req(&p, "from")?, &req(&p, "to")?, &s(&p, "kind").unwrap_or("then".into()), b(&p, "remove", false), &origin(&p, default_origin))?),
        "workflow.set" => j(ops::workflow_set(engine, &req(&p, "workflow")?, s(&p, "node").as_deref(), p.get("patch").unwrap_or(&p), &origin(&p, default_origin))?),
        "workflow.upsert" => {
            let w: Workflow = serde_json::from_value(p.get("workflow").cloned().ok_or_else(|| anyhow!("missing `workflow`"))?)?;
            j(ops::workflow_upsert(engine, w, &origin(&p, default_origin))?)
        }
        "workflow.remove" => {
            ops::workflow_remove(engine, &req(&p, "id")?, &origin(&p, default_origin))?;
            Ok(json!({"ok": true}))
        }
        "workflow.promote" => j(ops::workflow_promote(engine, &req(&p, "id")?, s(&p, "parent").as_deref(), &origin(&p, default_origin))?),

        // ───────── lenses ─────────
        "lens.list" => j(engine.store.lenses()?),
        "lens.get" => {
            let snap = engine.snapshot(false)?;
            let id = req(&p, "id")?;
            let l = snap.sources.lenses.iter().find(|l| l.id == id || l.name == id).ok_or_else(|| anyhow!("lens `{id}` not found"))?;
            Ok(json!({"lens": l, "view": resolve_lens(l, &snap.table, &snap.sources.workflows)}))
        }
        "lens.save" => {
            let l: Lens = serde_json::from_value(p.get("lens").cloned().unwrap_or(p.clone()))?;
            j(ops::lens_save(engine, l, &origin(&p, default_origin))?)
        }
        "lens.remove" => {
            ops::lens_remove(engine, &req(&p, "id")?, &origin(&p, default_origin))?;
            Ok(json!({"ok": true}))
        }

        // ───────── contracts / tasks / board ─────────
        "contract.list" => j(engine.store.contracts()?),
        "contract.get" => {
            let cs = engine.store.contracts()?;
            j(contract::select_contract(&cs, &s(&p, "task_kind").unwrap_or("code".into())))
        }
        "contract.render" => {
            let m = engine.store.manifest()?;
            let cs = engine.store.contracts()?;
            Ok(json!({"markdown": contract::render_agents_block(&m.project.name, &cs)}))
        }
        "task.start" => {
            let cs = engine.store.contracts()?;
            let (task, items) = contract::task_start(engine, &cs, TaskStart { title: req(&p, "title")?, kind: s(&p, "kind").unwrap_or("code".into()), files: list(&p, "files"), nodes: list(&p, "nodes"), origin: origin(&p, default_origin), workflow: s(&p, "workflow") })?;
            let c = contract::select_contract(&cs, &task.kind);
            Ok(json!({"task": task, "obligations": items, "contract": c}))
        }
        "task.done" => j(contract::task_done(engine, s(&p, "task").as_deref(), s(&p, "message").as_deref(), &origin(&p, default_origin))?),
        "task.step" => j(contract::mark_step(engine, s(&p, "task").as_deref(), &req(&p, "action")?)?),
        "board.get" => {
            let board = engine.store.board()?;
            let open = board.items.iter().filter(|i| i.status == "open").count();
            Ok(json!({"open": open, "tasks": board.tasks, "items": board.items}))
        }
        "board.dismiss" => {
            let mut board = engine.store.board()?;
            let id = req(&p, "id")?;
            let it = board.items.iter_mut().find(|i| i.id == id).ok_or_else(|| anyhow!("board item not found"))?;
            it.status = "dismissed".into();
            it.resolved = Some(crate::util::now());
            engine.store.save_board(&board)?;
            Ok(json!({"ok": true}))
        }

        // ───────── proposals ─────────
        "proposals.list" => {
            let pr = engine.store.proposals()?;
            let all = b(&p, "all", false);
            Ok(json!(pr.proposals.iter().filter(|x| all || x.status == "pending").collect::<Vec<_>>()))
        }
        "proposal.resolve" => {
            let snap = engine.snapshot(false)?;
            drift::resolve_proposal(engine, &snap, &req(&p, "id")?, &s(&p, "action").unwrap_or("review".into()), &origin(&p, default_origin))
        }

        // ───────── log ─────────
        "log.get" => j(engine.store.log(p.get("tail").and_then(|v| v.as_u64()).unwrap_or(50) as usize)?),
        "log.add" => {
            let e = LogEntry { ts: crate::util::now(), origin: origin(&p, default_origin), kind: s(&p, "kind").unwrap_or("note".into()), summary: req(&p, "message")?, confidence: None, uncertain: false, task: s(&p, "task"), details: p.get("details").cloned() };
            engine.log_entry(e.clone())?;
            if s(&p, "kind").as_deref() == Some("complete") || b(&p, "complete", false) {
                let _ = contract::mark_step(engine, s(&p, "task").as_deref(), "afwe_log");
            }
            j(e)
        }
        "bootstrap" => {
            let bp = crate::init::bootstrap(engine, p.get("depth").and_then(|v| v.as_u64()).unwrap_or(2) as usize, b(&p, "apply", false))?;
            j(bp)
        }
        // ───────── v2: turns (the protocol: begin → assume → commit) ─────────
        "turn.begin" => turn::begin(engine, turn::BeginRequest { prompt: req(&p, "prompt")?, origin: origin(&p, default_origin), agent: s(&p, "agent"), targets: list(&p, "targets"), refines: list(&p, "refines"), kind: s(&p, "kind").unwrap_or("code".into()) }),
        "turn.assume" => turn::assume(engine, &req(&p, "turn")?, turn::AssumeRequest { intents: parse_vec(&p, "intents")?, assumptions: parse_vec(&p, "assumptions")?, removes: list(&p, "removes"), overrides: parse_vec(&p, "overrides")?, origin: origin(&p, default_origin) }),
        "turn.commit" => turn::commit(engine, &req(&p, "turn")?, turn::CommitRequest { summary: s(&p, "summary"), footer_shown: b(&p, "footer_shown", false), removes: list(&p, "removes"), touched: list(&p, "touched"), overrides: parse_vec(&p, "overrides")?, origin: origin(&p, default_origin), confirmed: b(&p, "confirmed", false) }),
        "turn.confirm" => turn::confirm(engine, &req(&p, "turn")?, &origin(&p, default_origin)),
        "turn.revert" => turn::revert(engine, &req(&p, "turn")?, &origin(&p, default_origin)),
        "turn.get" => j(turn::get(engine, &req(&p, "turn")?)?),
        "turn.list" => j(turn::list(engine)?),
        "gate" => turn::gate_now(engine, &origin(&p, default_origin)),

        // ───────── v2: intents ─────────
        "intent.list" => j(engine.store.intents()?),
        "intent.get" => {
            let id = req(&p, "id")?;
            j(engine.store.intent(&id)?.ok_or_else(|| anyhow!("intent `{id}` not found"))?)
        }

        // ───────── v2: pins ─────────
        "pin.list" => {
            let status = s(&p, "status");
            let pins: Vec<Pin> = engine.store.pins()?.into_iter().filter(|x| status.as_ref().map(|st| &x.status == st).unwrap_or(true)).collect();
            j(pins)
        }
        "pin.get" => {
            let id = req(&p, "id")?;
            j(engine.store.pin(&id)?.ok_or_else(|| anyhow!("pin `{id}` not found"))?)
        }
        "pin.propose" => j(intent::propose_pin(engine, PinSpec {
            statement: req(&p, "statement")?,
            kind: s(&p, "kind").unwrap_or("decision".into()),
            severity: s(&p, "severity").unwrap_or("confirm".into()),
            attaches: Attachment { nodes: list(&p, "nodes"), files: list(&p, "files"), symbols: list(&p, "symbols"), global: b(&p, "global", false) },
            reason: s(&p, "reason"),
            origin: origin(&p, default_origin),
            created_from: s(&p, "turn"),
            intentional: b(&p, "intentional", false),
        })?),
        "pin.accept" => j(intent::accept_pin(engine, &req(&p, "id")?, &origin(&p, default_origin))?),
        "pin.retire" => j(intent::retire_pin(engine, &req(&p, "id")?, s(&p, "reason"), &origin(&p, default_origin))?),
        "pin.budget" => match p.get("slider").and_then(|v| v.as_u64()) {
            Some(sl) => j(intent::set_slider(engine, sl as u8, &origin(&p, default_origin))?),
            None => j(intent::budget(engine)?),
        },

        // ───────── v2: checks (the gate's registry) ─────────
        "check.list" => j(engine.store.checks()?),
        "check.add" => {
            let c: CheckSpec = serde_json::from_value(p.get("check").cloned().unwrap_or(p.clone()))?;
            j(intent::add_check(engine, c, &origin(&p, default_origin))?)
        }
        "check.remove" => {
            intent::remove_check(engine, &req(&p, "id")?, &origin(&p, default_origin))?;
            Ok(json!({"ok": true}))
        }

        // ───────── v2: timeline ─────────
        "timeline.list" => timeline::list(engine, p.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize),
        "timeline.get" => timeline::get(engine, &req(&p, "turn")?),
        "timeline.diff" => timeline::diff(engine, &req(&p, "turn")?, s(&p, "file")),
        "timeline.search" => timeline::search(engine, &req(&p, "q")?),
        "timeline.losses" => timeline::losses(engine),
        "timeline.restore" => timeline::restore(engine, &req(&p, "feature")?, b(&p, "apply", false), &origin(&p, default_origin)),

        // ───────── v2: onboarding & migration ─────────
        "onboard.detect" => onboard::detect(&engine.store.project_root),
        "onboard.apply" => onboard::apply(
            &engine.store.project_root,
            onboard::ApplyOptions {
                profile: s(&p, "profile").unwrap_or("normie".into()),
                init_git: b(&p, "init_git", true),
                baseline_commit: b(&p, "baseline_commit", true),
                ci: b(&p, "ci", true),
                agents_md: b(&p, "agents_md", true),
                test_command: s(&p, "test_command"),
            },
        ),
        "migrate" => {
            let moved = engine.store.migrate_workflows()?;
            let mut m = engine.store.manifest()?;
            m.format = crate::model::FORMAT_VERSION.into();
            engine.store.save_manifest(&m)?;
            engine.log(&origin(&p, default_origin), "migrate", format!("Migrated to {} ({moved} workflow(s) moved to intents/)", crate::model::FORMAT_VERSION), None)?;
            Ok(json!({"format": crate::model::FORMAT_VERSION, "workflows_moved": moved}))
        }

        "ops" => Ok(json!(OPS)),
        other => Err(anyhow!("unknown op `{other}` (see `ops`)")),
    }
}

pub const OPS: &[&str] = &[
    "status", "graph", "context", "verify", "sync", "drift", "search", "file.read",
    "blueprint.get", "blueprint.add", "blueprint.move", "blueprint.update", "blueprint.remove", "blueprint.map", "blueprint.unmap", "blueprint.relate", "blueprint.unrelate", "blueprint.constrain", "blueprint.unconstrain", "blueprint.edit",
    "memory.list", "memory.get", "memory.add", "memory.update", "memory.remove",
    "guardrail.list", "guardrail.add", "guardrail.remove",
    "workflow.list", "workflow.get", "workflow.new", "workflow.add_node", "workflow.link", "workflow.set", "workflow.upsert", "workflow.remove", "workflow.promote",
    "lens.list", "lens.get", "lens.save", "lens.remove",
    "contract.list", "contract.get", "contract.render", "task.start", "task.done", "task.step", "board.get", "board.dismiss",
    "proposals.list", "proposal.resolve", "log.get", "log.add", "bootstrap", "ops",
    "turn.begin", "turn.assume", "turn.commit", "turn.confirm", "turn.revert", "turn.get", "turn.list", "gate",
    "intent.list", "intent.get", "pin.list", "pin.get", "pin.propose", "pin.accept", "pin.retire", "pin.budget",
    "check.list", "check.add", "check.remove", "timeline.list", "timeline.get", "timeline.diff", "timeline.search", "timeline.losses", "timeline.restore",
    "onboard.detect", "onboard.apply", "migrate",
];

fn status(engine: &Engine) -> Result<Value> {
    let snap = engine.snapshot(false)?;
    let st = engine.store.sync_state()?;
    let board = engine.store.board()?;
    let proposals = engine.store.proposals()?;
    let code_files = snap.code.files.iter().filter(|f| !matches!(f.language.as_str(), "other" | "json" | "yaml" | "toml" | "markdown" | "shell")).count();
    let mapped = snap.code.files.iter().filter(|f| snap.mapping.primary(&f.path).is_some()).count();
    let unmapped_code = snap.code.files.iter().filter(|f| snap.mapping.primary(&f.path).is_none() && !matches!(f.language.as_str(), "other" | "json" | "yaml" | "toml" | "markdown" | "shell")).count();
    let mut kinds = std::collections::BTreeMap::new();
    for m in &snap.sources.memory {
        *kinds.entry(m.meta.kind.clone()).or_insert(0usize) += 1;
    }
    let sync_status = if st.last_sync.is_none() { "never_synced" } else if st.code_fingerprint != snap.code.fingerprint || st.afwe_fingerprint != engine.store.afwe_fingerprint() { "stale" } else { "in_sync" };
    Ok(json!({
        "project": snap.manifest.project,
        "engine": crate::ENGINE_VERSION,
        "format": snap.manifest.format,
        "sync": {"status": sync_status, "last_sync": st.last_sync, "cached_code_model": !snap.fresh},
        "blueprint": {"nodes": snap.table.nodes.len(), "relations": snap.sources.relations.relations.len(), "constraints": snap.sources.constraints.constraints.len()},
        "code": {"files": snap.code.files.len(), "code_files": code_files, "mapped_files": mapped, "unmapped_code_files": unmapped_code, "symbols": snap.index.symbols.len(), "languages": snap.code.languages},
        "memory": {"total": snap.sources.memory.len(), "by_kind": kinds},
        "guardrails": {"passive": snap.sources.guardrails.iter().filter(|g| g.mode == "passive").count(), "active": snap.sources.guardrails.iter().filter(|g| g.mode == "active").count()},
        "workflows": snap.sources.workflows.len(),
        "lenses": snap.sources.lenses.len(),
        "board": {"open": board.items.iter().filter(|i| i.status == "open").count(), "open_tasks": board.tasks.iter().filter(|t| t.status == "open").count()},
        "proposals": proposals.proposals.iter().filter(|p| p.status == "pending").count(),
        "policy": snap.manifest.policy,
    }))
}

fn node_detail(snap: &Snapshot, reference: &str) -> Result<Value> {
    let id = snap.table.resolve_or_err(reference)?;
    let n = &snap.table.nodes[&id];
    let idx = &snap.index.nodes[&id];
    let memory: Vec<Value> = snap.sources.memory.iter().filter(|m| m.meta.applies_to.iter().filter_map(|r| snap.table.resolve(r)).any(|x| x == id)).map(|m| json!({"id": m.meta.id, "kind": m.meta.kind, "title": m.meta.title, "status": m.meta.status})).collect();
    let inherited: Vec<Value> = snap.table.ancestors(&id).iter().flat_map(|a| snap.sources.memory.iter().filter(move |m| m.meta.applies_to.iter().filter_map(|r| snap.table.resolve(r)).any(|x| &x == a)).map(move |m| json!({"id": m.meta.id, "kind": m.meta.kind, "title": m.meta.title, "from": snap.table.path_of(a)}))).collect();
    let guardrails: Vec<Value> = idx.guardrails.iter().filter_map(|g| snap.sources.guardrails.iter().find(|x| &x.id == g)).map(|g| json!({"id": g.id, "mode": g.mode, "statement": g.statement, "exceptions": g.exceptions})).collect();
    let deps_out: Vec<Value> = snap.sources.relations.relations.iter().filter(|r| snap.table.resolve(&r.from).as_deref() == Some(&id)).map(|r| json!({"to": r.to, "to_path": snap.table.resolve(&r.to).map(|t| snap.table.path_of(&t)), "kind": r.kind, "status": r.status, "rationale": r.rationale})).collect();
    let deps_in: Vec<Value> = snap.sources.relations.relations.iter().filter(|r| snap.table.resolve(&r.to).as_deref() == Some(&id)).map(|r| json!({"from": r.from, "from_path": snap.table.resolve(&r.from).map(|t| snap.table.path_of(&t)), "kind": r.kind, "status": r.status, "rationale": r.rationale})).collect();
    let edges_out: Vec<Value> = snap.index.node_edges.get(&id).map(|m| m.iter().map(|(t, c)| json!({"to": t, "to_path": snap.table.path_of(t), "count": c})).collect()).unwrap_or_default();
    let edges_in: Vec<Value> = snap.index.node_edges.iter().filter_map(|(a, m)| m.get(&id).map(|c| json!({"from": a, "from_path": snap.table.path_of(a), "count": c}))).collect();
    let constraints: Vec<&Constraint> = snap.sources.constraints.constraints.iter().filter(|c| { let chain = { let mut v = vec![id.clone()]; v.extend(snap.table.ancestors(&id)); v }; std::iter::once(&c.from).chain(c.to.iter()).chain(c.except.iter()).filter_map(|r| snap.table.resolve(r)).any(|x| chain.contains(&x)) }).collect();
    let symbols: Vec<Value> = idx.files.iter().filter_map(|f| snap.index.files.get(f)).flat_map(|f| f.symbols.iter()).filter_map(|sid| snap.index.symbols.get(sid)).take(200).map(|sym| json!({"id": sym.id, "kind": sym.kind, "qualified": sym.qualified, "file": sym.file, "exported": sym.exported})).collect();
    let workflows: Vec<Value> = snap.sources.workflows.iter().filter(|w| w.targets.iter().filter_map(|t| snap.table.resolve(t)).any(|t| t == id) || w.nodes.iter().any(|n| n.maps_to.as_ref().map(|m| m.nodes.iter().filter_map(|r| snap.table.resolve(r)).any(|r| r == id)).unwrap_or(false))).map(|w| json!({"id": w.id, "title": w.title, "status": w.status})).collect();
    Ok(json!({
        "id": n.id, "name": n.name, "kind": n.kind, "path": n.path, "depth": n.depth, "parent": n.parent,
        "purpose": n.purpose, "description": n.description, "status": n.status, "tags": n.tags,
        "children": n.children.iter().map(|c| json!({"id": c, "name": snap.table.nodes[c].name, "kind": snap.table.nodes[c].kind})).collect::<Vec<_>>(),
        "implements": n.implements, "files": idx.files, "symbols": symbols,
        "memory": memory, "inherited_memory": inherited, "guardrails": guardrails,
        "relations": {"out": deps_out, "in": deps_in}, "code_edges": {"out": edges_out, "in": edges_in},
        "constraints": constraints, "workflows": workflows,
        "origin": crate::mapping::find_node(&snap.sources.blueprint.nodes, &id).and_then(|x| x.origin.clone()),
    }))
}

/// Everything the Studio needs to draw the architecture graph in one call.
fn graph(engine: &Engine, p: &Value) -> Result<Value> {
    let snap = engine.snapshot(b(p, "refresh", false))?;
    let st = engine.store.sync_state()?;
    let sync_status = if st.last_sync.is_none() { "never_synced" } else if st.code_fingerprint != snap.code.fingerprint || st.afwe_fingerprint != engine.store.afwe_fingerprint() { "stale" } else { "in_sync" };
    let nodes: Vec<Value> = snap.table.ids().iter().map(|id| {
        let n = &snap.table.nodes[id];
        let idx = &snap.index.nodes[id];
        json!({
            "id": n.id, "name": n.name, "kind": n.kind, "path": n.path, "parent": n.parent, "depth": n.depth,
            "purpose": n.purpose, "description": n.description, "status": n.status, "tags": n.tags,
            "children": n.children, "files": idx.files.len(), "file_list": idx.files, "symbols": idx.files.iter().filter_map(|f| snap.index.files.get(f)).map(|f| f.symbols.len()).sum::<usize>(),
            "memory": idx.memory, "guardrails": idx.guardrails, "implements": n.implements,
            "origin": crate::mapping::find_node(&snap.sources.blueprint.nodes, id).and_then(|x| x.origin.clone()),
        })
    }).collect();
    let relations: Vec<Value> = snap.sources.relations.relations.iter().filter_map(|r| {
        let f = snap.table.resolve(&r.from)?;
        let t = snap.table.resolve(&r.to)?;
        let ev = snap.index.node_edges.get(&f).and_then(|m| m.get(&t)).copied().unwrap_or(0);
        Some(json!({"from": f, "to": t, "kind": r.kind, "status": r.status, "rationale": r.rationale, "evidence": ev, "confidence": r.confidence, "origin": r.origin}))
    }).collect();
    let mut code_edges = vec![];
    for (a, m) in &snap.index.node_edges {
        for (bnode, c) in m {
            let declared = snap.sources.relations.relations.iter().any(|r| snap.table.resolve(&r.from).as_deref() == Some(a) && snap.table.resolve(&r.to).as_deref() == Some(bnode));
            let violation = drift::violates_constraint(&snap, a, bnode).map(|c| c.id.clone());
            code_edges.push(json!({"from": a, "to": bnode, "count": c, "declared": declared, "violation": violation}));
        }
    }
    let proposals = engine.store.proposals()?;
    let board = engine.store.board()?;
    let lenses: Vec<Value> = snap.sources.lenses.iter().map(|l| json!({"id": l.id, "name": l.name, "description": l.description, "view": resolve_lens(l, &snap.table, &snap.sources.workflows)})).collect();
    let unmapped: Vec<&String> = snap.code.files.iter().filter(|f| snap.mapping.primary(&f.path).is_none() && !matches!(f.language.as_str(), "other" | "json" | "yaml" | "toml" | "markdown" | "shell")).map(|f| &f.path).collect();
    Ok(json!({
        "project": snap.manifest.project,
        "sync": {"status": sync_status, "last_sync": st.last_sync},
        "nodes": nodes, "relations": relations, "code_edges": code_edges,
        "constraints": snap.sources.constraints.constraints,
        "memory": snap.index.memory,
        "guardrails": snap.sources.guardrails,
        "workflows": snap.sources.workflows.iter().map(|w| json!({"id": w.id, "title": w.title, "status": w.status, "nodes": w.nodes.len(), "targets": w.targets})).collect::<Vec<_>>(),
        "lenses": lenses,
        "proposals": proposals.proposals.iter().filter(|p| p.status == "pending").collect::<Vec<_>>(),
        "board_open": board.items.iter().filter(|i| i.status == "open").count(),
        "files": snap.index.files.iter().map(|(k, v)| json!({"path": k, "language": v.language, "node": v.node, "symbols": v.symbols.len(), "imports": v.imports})).collect::<Vec<_>>(),
        "unmapped": unmapped,
        "policy": snap.manifest.policy,
    }))
}

fn search(engine: &Engine, q: &str) -> Result<Value> {
    let snap = engine.snapshot(false)?;
    let ql = q.to_lowercase();
    let mut hits: Vec<Value> = vec![];
    for id in snap.table.ids() {
        let n = &snap.table.nodes[id];
        if n.name.to_lowercase().contains(&ql) || n.id.contains(&ql) || n.path.to_lowercase().contains(&ql) || n.purpose.as_deref().map(|p| p.to_lowercase().contains(&ql)).unwrap_or(false) {
            hits.push(json!({"type": "node", "id": n.id, "title": n.path, "detail": n.purpose}));
        }
    }
    for m in &snap.sources.memory {
        if m.meta.title.to_lowercase().contains(&ql) || m.meta.id.contains(&ql) || m.body.to_lowercase().contains(&ql) || m.meta.tags.iter().any(|t| t.contains(&ql)) {
            hits.push(json!({"type": "memory", "id": m.meta.id, "title": m.meta.title, "detail": m.meta.kind}));
        }
    }
    for g in &snap.sources.guardrails {
        if g.statement.to_lowercase().contains(&ql) || g.id.contains(&ql) {
            hits.push(json!({"type": "guardrail", "id": g.id, "title": g.statement, "detail": g.mode}));
        }
    }
    for w in &snap.sources.workflows {
        if w.title.to_lowercase().contains(&ql) || w.id.contains(&ql) || w.nodes.iter().any(|n| n.title.to_lowercase().contains(&ql)) {
            hits.push(json!({"type": "workflow", "id": w.id, "title": w.title, "detail": w.status}));
        }
    }
    let mut count = 0;
    for (path, f) in &snap.index.files {
        if path.to_lowercase().contains(&ql) {
            hits.push(json!({"type": "file", "id": path, "title": path, "detail": f.node}));
            count += 1;
            if count > 40 {
                break;
            }
        }
    }
    count = 0;
    for (id, sym) in &snap.index.symbols {
        if sym.qualified.to_lowercase().contains(&ql) {
            hits.push(json!({"type": "symbol", "id": id, "title": sym.qualified, "detail": format!("{} in {}", sym.kind, sym.file)}));
            count += 1;
            if count > 40 {
                break;
            }
        }
    }
    Ok(json!({"q": q, "hits": hits}))
}

// ───────────────────────────── MCP tool catalogue ─────────────────────────────

pub struct ToolSpec {
    pub name: &'static str,
    pub op: &'static str,
    pub description: &'static str,
    pub schema: Value,
}

fn obj(props: Value, required: &[&str]) -> Value {
    json!({"type": "object", "properties": props, "required": required})
}

pub fn tool_specs() -> Vec<ToolSpec> {
    let strs = json!({"type": "array", "items": {"type": "string"}});
    vec![
        ToolSpec { name: "afwe_status", op: "status", description: "Project summary: sync status, blueprint size, mapped/unmapped files, memory counts, open board items, pending proposals.", schema: obj(json!({}), &[]) },
        ToolSpec { name: "afwe_context", op: "context", description: "PASSIVE GUARDRAIL. Call before editing. Given files (and/or a symbol or node) returns only the architectural context that applies: blueprint node + purpose, decisions, exceptions, constraints, terminology, guardrails, structural rules, relationships and the contract to follow. Returns markdown plus structured JSON.", schema: obj(json!({"files": strs, "symbol": {"type": "string"}, "node": {"type": "string"}, "task": {"type": "string"}, "task_kind": {"type": "string", "description": "code|bugfix|refactor|architecture|feature|workflow"}, "full": {"type": "boolean"}}), &[]) },
        ToolSpec { name: "afwe_verify", op: "verify", description: "ACTIVE GUARDRAIL. Verify changed files against the blueprint: structural constraints, active guardrail checks (forbidden imports/patterns, commands) and drift. ok=false means fix it, do not silence it.", schema: obj(json!({"files": strs, "run_commands": {"type": "boolean"}, "include_drift": {"type": "boolean"}, "task": {"type": "string"}}), &[]) },
        ToolSpec { name: "afwe_sync", op: "sync", description: "Re-analyse the codebase, rebuild the index, detect blueprint/code disagreement and reconcile by confidence (>=70% auto, 50-70% auto+uncertain marker, <50% proposal). Run after implementation.", schema: obj(json!({"dry_run": {"type": "boolean"}, "task": {"type": "string"}}), &[]) },
        ToolSpec { name: "afwe_drift", op: "drift", description: "List disagreements between blueprint and code with confidence and the change AFWE would make, without applying anything.", schema: obj(json!({"files": strs}), &[]) },
        ToolSpec { name: "afwe_search", op: "search", description: "Search nodes, memory, guardrails, workflows, files and symbols.", schema: obj(json!({"q": {"type": "string"}}), &["q"]) },
        ToolSpec { name: "afwe_blueprint_get", op: "blueprint.get", description: "Read the blueprint tree, or one node in full (purpose, files, symbols, memory, guardrails, relations, constraints, workflows).", schema: obj(json!({"node": {"type": "string"}}), &[]) },
        ToolSpec { name: "afwe_blueprint_edit", op: "blueprint.edit", description: "Structural edit. op=add {name,parent?,kind?,purpose?,files?,symbols?,status?} | move {node,parent?} | update {node,patch} | remove {node} | map/unmap {node,files?,symbols?} | relate {from,to,kind?,rationale?} | unrelate {from,to} | constrain {from,rule:must_not_depend|may_depend_only,to?,allowed?,rationale?} | unconstrain {id}.", schema: obj(json!({"op": {"type": "string"}, "name": {"type": "string"}, "node": {"type": "string"}, "parent": {"type": "string"}, "kind": {"type": "string"}, "purpose": {"type": "string"}, "description": {"type": "string"}, "files": strs, "symbols": strs, "status": {"type": "string"}, "from": {"type": "string"}, "to": strs, "allowed": strs, "rationale": {"type": "string"}, "rule": {"type": "string"}, "id": {"type": "string"}, "patch": {"type": "object"}}), &["op"]) },
        ToolSpec { name: "afwe_memory_add", op: "memory.add", description: "Record project knowledge with scope: kind=decision|constraint|exception|terminology|problem. applies_to = blueprint nodes; files = globs; symbols = file::Symbol. Body is markdown (Decision / Reason / Trade-off).", schema: obj(json!({"kind": {"type": "string"}, "title": {"type": "string"}, "body": {"type": "string"}, "applies_to": strs, "files": strs, "symbols": strs, "tags": strs, "status": {"type": "string"}, "supersedes": {"type": "string"}, "workflow": {"type": "string"}}), &["kind", "title"]) },
        ToolSpec { name: "afwe_memory_find", op: "memory.list", description: "Find memory entries by kind, node, tag, file or free text.", schema: obj(json!({"kind": {"type": "string"}, "node": {"type": "string"}, "tag": {"type": "string"}, "file": {"type": "string"}, "q": {"type": "string"}}), &[]) },
        ToolSpec { name: "afwe_memory_update", op: "memory.update", description: "Update a memory entry (title, body, status, applies_to, files, symbols, tags).", schema: obj(json!({"id": {"type": "string"}, "patch": {"type": "object"}}), &["id", "patch"]) },
        ToolSpec { name: "afwe_guardrail_add", op: "guardrail.add", description: "Add a guardrail. passive = statement + scope (+ exceptions) injected as context; active = checks [{type: command|forbid_import|forbid_pattern|require_pattern|require_file, ...}] enforced by afwe_verify.", schema: obj(json!({"guardrail": {"type": "object"}}), &["guardrail"]) },
        ToolSpec { name: "afwe_workflow_get", op: "workflow.get", description: "Read a node-based workflow (intent → design → steps → components with mapping/provenance).", schema: obj(json!({"id": {"type": "string"}}), &["id"]) },
        ToolSpec { name: "afwe_workflow_list", op: "workflow.list", description: "List node-based workflows.", schema: obj(json!({}), &[]) },
        ToolSpec { name: "afwe_workflow_upsert", op: "workflow.upsert", description: "Create or replace a node-based workflow. Put the user's prompt verbatim in a `prompt` node (provenance), then intent/design/step/component/decision/question nodes and edges (then|refines|depends|produces). Set origin to your model name.", schema: obj(json!({"workflow": {"type": "object", "description": "{id?, title, description?, status?, targets?, nodes:[{id,kind,title,text?,status?,maps_to?}], edges:[{from,to,kind?}]}"}}), &["workflow"]) },
        ToolSpec { name: "afwe_workflow_promote", op: "workflow.promote", description: "Turn a workflow's component nodes into planned blueprint nodes under a parent.", schema: obj(json!({"id": {"type": "string"}, "parent": {"type": "string"}}), &["id"]) },
        ToolSpec { name: "afwe_lens_get", op: "lens.get", description: "Resolve a custom abstraction (lens) into a view tree.", schema: obj(json!({"id": {"type": "string"}}), &["id"]) },
        ToolSpec { name: "afwe_contract", op: "contract.get", description: "The contract (ordered obligations) for a task kind: code|bugfix|refactor|architecture|feature|workflow.", schema: obj(json!({"task_kind": {"type": "string"}}), &[]) },
        ToolSpec { name: "afwe_task_start", op: "task.start", description: "Open a task on the Board; creates contract obligations that later tool calls tick off.", schema: obj(json!({"title": {"type": "string"}, "kind": {"type": "string"}, "files": strs, "nodes": strs, "workflow": {"type": "string"}}), &["title"]) },
        ToolSpec { name: "afwe_task_done", op: "task.done", description: "Log completion of a task (message = what changed and why). Reports unfulfilled obligations.", schema: obj(json!({"task": {"type": "string"}, "message": {"type": "string"}}), &[]) },
        ToolSpec { name: "afwe_board", op: "board.get", description: "Board/Tasks: open contract obligations, pending proposals, uncertain reconciliations, stale references.", schema: obj(json!({}), &[]) },
        ToolSpec { name: "afwe_proposals", op: "proposals.list", description: "Pending architecture proposals (<50% confidence changes AFWE will not apply on its own).", schema: obj(json!({}), &[]) },
        ToolSpec { name: "afwe_proposal_resolve", op: "proposal.resolve", description: "accept | revert | review a proposal (review = impact on memory, guardrails, constraints, files).", schema: obj(json!({"id": {"type": "string"}, "action": {"type": "string"}}), &["id", "action"]) },
        ToolSpec { name: "afwe_log", op: "log.add", description: "Append a note to the change log (kind: note|complete|decision).", schema: obj(json!({"message": {"type": "string"}, "kind": {"type": "string"}, "task": {"type": "string"}}), &["message"]) },
        ToolSpec { name: "afwe_turn_begin", op: "turn.begin", description: "START every prompt here. Stores the prompt verbatim as a turn and returns the briefing: scope, active pins (do not change what they protect), intentional markers, intents, memory, constraints, registered checks, unresolved proposals and the footer you must show. Then call afwe_turn_assume.", schema: obj(json!({"prompt": {"type": "string"}, "targets": strs, "refines": strs, "kind": {"type": "string"}, "agent": {"type": "string"}}), &["prompt"]) },
        ToolSpec { name: "afwe_turn_assume", op: "turn.assume", description: "BEFORE writing code: declare intents (action + targets) and assumption claims (regex/import/symbol checks). Returns REDO with error codes when the schema is wrong or a pin would be broken; then revise and call again. Pin overrides need a reason.", schema: obj(json!({"turn": {"type": "string"}, "intents": {"type": "array"}, "assumptions": {"type": "array"}, "removes": strs, "overrides": {"type": "array"}}), &["turn"]) },
        ToolSpec { name: "afwe_turn_commit", op: "turn.commit", description: "AFTER writing code: AFWE attributes the changes, runs verify, pins, collateral-loss detection, claims and registered checks, then commits (with an AFWE-Turn trailer), stages a proposal, or returns REDO with the failures. Nothing is committed on REDO. Set footer_shown=true once the proposal notice is in your reply.", schema: obj(json!({"turn": {"type": "string"}, "summary": {"type": "string"}, "footer_shown": {"type": "boolean"}, "removes": strs, "touched": strs, "overrides": {"type": "array"}}), &["turn"]) },
        ToolSpec { name: "afwe_turn_confirm", op: "turn.confirm", description: "Human confirmation of a staged proposal: commits it through the gate.", schema: obj(json!({"turn": {"type": "string"}}), &["turn"]) },
        ToolSpec { name: "afwe_turn_revert", op: "turn.revert", description: "Undo a turn as far as that is safe (files clean at turn.begin go back to HEAD; the rest becomes a Board item).", schema: obj(json!({"turn": {"type": "string"}}), &["turn"]) },
        ToolSpec { name: "afwe_turn_get", op: "turn.get", description: "Read one turn: prompt, intents, assumptions, checks, strength, confidence and gate reasons.", schema: obj(json!({"turn": {"type": "string"}}), &["turn"]) },
        ToolSpec { name: "afwe_turn_list", op: "turn.list", description: "List all turns (ledger).", schema: obj(json!({}), &[]) },
        ToolSpec { name: "afwe_intent_list", op: "intent.list", description: "Living intents: merged statements derived from the raw prompts, with history and the turns they came from.", schema: obj(json!({}), &[]) },
        ToolSpec { name: "afwe_pin_list", op: "pin.list", description: "Pins: human-locked decisions and intentional bug markers. Filter by status (active|proposed|retired).", schema: obj(json!({"status": {"type": "string"}}), &[]) },
        ToolSpec { name: "afwe_pin_propose", op: "pin.propose", description: "Propose a pin (decision to keep, or an intentional bug). Agent proposals stay proposed until a human accepts them.", schema: obj(json!({"statement": {"type": "string"}, "kind": {"type": "string"}, "severity": {"type": "string"}, "nodes": strs, "files": strs, "reason": {"type": "string"}, "intentional": {"type": "boolean"}}), &["statement"]) },
        ToolSpec { name: "afwe_pin_accept", op: "pin.accept", description: "Human accepts a proposed pin (subject to the pin budget).", schema: obj(json!({"id": {"type": "string"}}), &["id"]) },
        ToolSpec { name: "afwe_pin_retire", op: "pin.retire", description: "Retire a pin with a reason.", schema: obj(json!({"id": {"type": "string"}, "reason": {"type": "string"}}), &["id"]) },
        ToolSpec { name: "afwe_pin_budget", op: "pin.budget", description: "Pin budget: derived from the codebase size, scaled by the manual slider (1 relaxed … 5 strict). Pass slider to change it.", schema: obj(json!({"slider": {"type": "integer"}}), &[]) },
        ToolSpec { name: "afwe_check_list", op: "check.list", description: "The gate's registry of checks (deterministic, generated, llm_judged) and who authored them.", schema: obj(json!({}), &[]) },
        ToolSpec { name: "afwe_check_add", op: "check.add", description: "Register a check the gate must pass: a shell command (exit 0 = pass) or a claim, with trust and attachments.", schema: obj(json!({"check": {"type": "object"}}), &["check"]) },
        ToolSpec { name: "afwe_check_remove", op: "check.remove", description: "Remove a check from the gate (logged).", schema: obj(json!({"id": {"type": "string"}}), &["id"]) },
        ToolSpec { name: "afwe_gate", op: "gate", description: "Whole-project gate (CI): constraints, guardrails, registered checks and the project test command.", schema: obj(json!({}), &[]) },
        ToolSpec { name: "afwe_timeline_list", op: "timeline.list", description: "Intent-indexed history: committed turns with strength, confidence and status.", schema: obj(json!({"limit": {"type": "integer"}}), &[]) },
        ToolSpec { name: "afwe_timeline_get", op: "timeline.get", description: "One turn with its commit and diff stat.", schema: obj(json!({"turn": {"type": "string"}}), &["turn"]) },
        ToolSpec { name: "afwe_timeline_diff", op: "timeline.diff", description: "Patch of a turn (committed or staged).", schema: obj(json!({"turn": {"type": "string"}, "file": {"type": "string"}}), &["turn"]) },
        ToolSpec { name: "afwe_timeline_search", op: "timeline.search", description: "Search history by prompt, summary, intent or node.", schema: obj(json!({"q": {"type": "string"}}), &["q"]) },
        ToolSpec { name: "afwe_timeline_losses", op: "timeline.losses", description: "Features that were realised and disappeared, and whether that was on purpose.", schema: obj(json!({}), &[]) },
        ToolSpec { name: "afwe_timeline_restore", op: "timeline.restore", description: "Restore a vanished feature: 3-way merge of its last good version. apply=true opens a restore turn that is gated at commit.", schema: obj(json!({"feature": {"type": "string"}, "apply": {"type": "boolean"}}), &["feature"]) },
        ToolSpec { name: "afwe_onboard_detect", op: "onboard.detect", description: "Detect stacks, git state, configuration and the suggested test command, without changing anything.", schema: obj(json!({}), &[]) },
        ToolSpec { name: "afwe_onboard_apply", op: "onboard.apply", description: "Configure the project with a profile (normie | engineer): policy presets, git init, CI gate, AGENTS.md block.", schema: obj(json!({"profile": {"type": "string"}, "init_git": {"type": "boolean"}, "ci": {"type": "boolean"}, "agents_md": {"type": "boolean"}, "test_command": {"type": "string"}}), &["profile"]) },
    ]
}
