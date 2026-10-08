//! Contracts: scoped instructions that tell the harness what AFWE needs it to do when
//! work crosses an AFWE boundary. The Board tracks contract obligations per task.

use crate::engine::Engine;
use crate::model::*;
use crate::util::{now, short_id};
use anyhow::{anyhow, Result};

pub fn default_contracts() -> Vec<Contract> {
    let step = |id: &str, phase: &str, action: &str, instruction: &str, optional: bool| ContractStep { id: id.into(), phase: phase.into(), action: action.into(), instruction: instruction.into(), optional };
    vec![
        Contract {
            id: "default".into(),
            name: "Default coding contract".into(),
            description: Some("For normal coding tasks: implement → verify against the blueprint → update .afwe memory if needed → log completion.".into()),
            task_kinds: vec!["code".into(), "bugfix".into(), "refactor".into(), "chore".into(), "test".into()],
            steps: vec![
                step("context", "before", "afwe_context", "Before touching a file, ask AFWE for the relevant context (`afwe context <file>` / tool `afwe_context`) and respect the decisions, exceptions and guardrails it returns.", false),
                step("implement", "during", "harness", "Implement the requested change. Reuse existing nodes/libraries shown in the context before creating new ones.", false),
                step("verify", "after", "afwe_verify", "Run `afwe verify --changed <files>` (tool `afwe_verify`). Fix constraint violations and failed active guardrails; do not silence them.", false),
                step("update", "after", "afwe_update", "If you made a decision, hit an exception, or changed structure: record it (`afwe memory add …`, `afwe blueprint map …`). Keep the blueprint and the code as two views of the same thing.", false),
                step("sync", "after", "afwe_sync", "Run `afwe sync` so mapping/index/drift are current (auto‑reconciles confident changes, proposes uncertain ones).", false),
                step("log", "after", "afwe_log", "Log completion with what changed and why (`afwe task done <task> --message …`).", false),
            ],
        },
        Contract {
            id: "architecture".into(),
            name: "Architecture / workflow contract".into(),
            description: Some("For features, subsystems and architectural changes: intent → node-based workflow → blueprint changes → implementation → verify → update → log.".into()),
            task_kinds: vec!["architecture".into(), "feature".into(), "workflow".into(), "design".into()],
            steps: vec![
                step("intent", "before", "afwe_workflow", "Capture the intent as a node-based workflow (`afwe workflow new …` / tool `afwe_workflow_upsert`). Paste the original prompt verbatim as a `prompt` node (provenance) and break the design into nodes; do not assume beyond the prompt.", false),
                step("context", "before", "afwe_context", "Ask AFWE for context on the nodes/files the workflow touches; check whether an existing node already does the job before inventing a new one.", false),
                step("blueprint", "before", "afwe_blueprint", "Reflect the desired structure in the blueprint first (`afwe blueprint add/move/relate/constrain`). Blueprint = structural reality, workflow = desired behaviour.", false),
                step("implement", "during", "harness", "Implement beneath the blueprint. Map new files/symbols to their nodes as you go.", false),
                step("verify", "after", "afwe_verify", "Verify against the blueprint (`afwe verify`). Every workflow component node should map to real nodes/files.", false),
                step("update", "after", "afwe_update", "Persist the resulting knowledge as memory (decisions, constraints, terminology) – not the conversation. Mark workflow nodes done and set `maps_to`.", false),
                step("sync", "after", "afwe_sync", "Run `afwe sync`.", false),
                step("log", "after", "afwe_log", "Log completion.", false),
            ],
        },
    ]
}

pub fn select_contract(contracts: &[Contract], task_kind: &str) -> Option<Contract> {
    contracts
        .iter()
        .find(|c| c.task_kinds.iter().any(|k| k == task_kind))
        .or_else(|| contracts.iter().find(|c| c.id == "default"))
        .or_else(|| contracts.first())
        .cloned()
}

pub const AFWE_SKILL_MD: &str = r#"---
name: afwe
description: Architecture-First Workspace Engine skill. Enforces turn protocol (begin -> assume -> commit), micro-context retrieval, verification gates, architectural integrity, and documentation sync for coding agents.
---

# AFWE Skill Instructions

This project uses AFWE to deterministically govern architecture and prevent agent regressions.
When interacting with this codebase:

1. **Before Touching Code**:
   - Call `afwe turn begin "<prompt>" --target <files>` (or MCP tool `afwe_turn_begin`).
   - Read the briefing: inspect in-scope architectural nodes, locked pins, memory, and proposals.
   - Call `afwe turn assume <turn> --file <json>` (or MCP tool `afwe_turn_assume`) to declare your intents and pre-generation claims.
   - If REDO is returned, revise assumptions according to the schema before proceeding.

2. **While Editing**:
   - Retrieve micro-context via `afwe context <files>` (or MCP `afwe_context`).
   - Obey active pins; never delete pinned behavior without an explicit override.

3. **After Editing (Verification & Mandatory Documentation Sync)**:
   - Run verification via `afwe verify --changed <files>` (or MCP `afwe_verify`).
   - **Post-Turn Documentation Obligation**: Whenever code structure, public APIs, rules, or behavior change, update the relevant documentation (`README.md`, `.afwe/skills/afwe/SKILL.md`, `.afwe/docs/`, or record a decision via `afwe_memory_add`). Keep documentation synchronized with implementation on every turn.
   - Commit the turn via `afwe turn commit <turn> --summary "..."` (or MCP `afwe_turn_commit`).
   - If proposals are pending, include the AFWE reminder footer in your reply.
"#;

pub fn render_agents_block(project: &str, _contracts: &[Contract]) -> String {
    let mut s = String::new();
    s.push_str("<!-- afwe:begin -->\n");
    s.push_str(&format!("# AFWE — architecture contract for `{project}`\n\n"));
    s.push_str("This project is architecturally governed by AFWE (`.afwe/`).\n");
    s.push_str("Always activate the `afwe` skill (`.afwe/skills/afwe/SKILL.md`) or use the connected AFWE MCP tools (`afwe_turn_begin`, `afwe_turn_assume`, `afwe_turn_commit`).\n\n");
    s.push_str("## Turn Protocol Summary\n");
    s.push_str("1. `afwe turn begin \"<prompt>\" --target <files>` (MCP `afwe_turn_begin`) → read briefing pack & pins.\n");
    s.push_str("2. `afwe turn assume <turn> --file <json>` (MCP `afwe_turn_assume`) → declare intents & claims BEFORE writing code.\n");
    s.push_str("3. `afwe turn commit <turn> --summary \"…\"` (MCP `afwe_turn_commit`) → gated commit AFTER code is written.\n");
    s.push_str("4. **Documentation Sync**: Update relevant docs/skills after each update when architecture or behavior changes.\n\n");
    s.push_str("If skills or MCP are unavailable in your harness, execute the CLI commands above directly via terminal.\n");
    s.push_str("Consult `.afwe/docs/TUTORIAL.md` (or `docs/TUTORIAL.md`) for complete protocol instructions and `docs/WALKTHROUGH.md` for real-world case studies.\n");
    s.push_str("<!-- afwe:end -->\n");
    s
}

// ───────────────────────────── tasks & board ─────────────────────────────

pub struct TaskStart {
    pub title: String,
    pub kind: String,
    pub files: Vec<String>,
    pub nodes: Vec<String>,
    pub origin: String,
    pub workflow: Option<String>,
}

pub fn task_start(engine: &Engine, contracts: &[Contract], t: TaskStart) -> Result<(Task, Vec<BoardItem>)> {
    let contract = select_contract(contracts, &t.kind).ok_or_else(|| anyhow!("no contracts defined"))?;
    let mut board = engine.store.board()?;
    let id = short_id("task");
    let task = Task { id: id.clone(), title: t.title.clone(), kind: t.kind.clone(), contract: contract.id.clone(), status: "open".into(), files: t.files, nodes: t.nodes, origin: Some(t.origin.clone()), workflow: t.workflow, created: now(), completed: None };
    let mut items = vec![];
    for st in &contract.steps {
        if st.action == "harness" {
            continue;
        }
        items.push(BoardItem { id: format!("{id}:{}", st.id), kind: "contract_step".into(), title: format!("{} — {}", st.action, t.title), status: "open".into(), task: Some(id.clone()), action: Some(st.action.clone()), detail: Some(st.instruction.clone()), reference: Some(contract.id.clone()), created: now(), resolved: None });
    }
    board.tasks.push(task.clone());
    board.items.extend(items.clone());
    engine.store.save_board(&board)?;
    engine.log(&t.origin, "task_start", format!("Task started: {} [{}] under contract {}", t.title, t.kind, contract.id), Some(serde_json::json!({"task": id})))?;
    Ok((task, items))
}

/// Mark a contract step done for a task (or for the most recent open task when `task` is None).
pub fn mark_step(engine: &Engine, task: Option<&str>, action: &str) -> Result<Vec<String>> {
    let mut board = engine.store.board()?;
    let task_id = match task {
        Some(t) => Some(t.to_string()),
        None => board.tasks.iter().rev().find(|t| t.status == "open").map(|t| t.id.clone()),
    };
    let mut done = vec![];
    if let Some(tid) = task_id {
        for it in board.items.iter_mut() {
            if it.task.as_deref() == Some(&tid) && it.action.as_deref() == Some(action) && it.status == "open" {
                it.status = "done".into();
                it.resolved = Some(now());
                done.push(it.id.clone());
            }
        }
        if !done.is_empty() {
            engine.store.save_board(&board)?;
        }
    }
    Ok(done)
}

pub fn task_done(engine: &Engine, task: Option<&str>, message: Option<&str>, origin: &str) -> Result<TaskDone> {
    let mut board = engine.store.board()?;
    let idx = match task {
        Some(t) => board.tasks.iter().position(|x| x.id == t || x.title == t),
        None => board.tasks.iter().rposition(|t| t.status == "open"),
    }
    .ok_or_else(|| anyhow!("no open task found"))?;
    board.tasks[idx].status = "done".into();
    board.tasks[idx].completed = Some(now());
    let tid = board.tasks[idx].id.clone();
    let mut unfulfilled = vec![];
    for it in board.items.iter_mut() {
        if it.task.as_deref() == Some(&tid) && it.status == "open" {
            if it.action.as_deref() == Some("afwe_log") {
                it.status = "done".into();
            } else {
                it.status = "skipped".into();
                unfulfilled.push(it.action.clone().unwrap_or_default());
            }
            it.resolved = Some(now());
        }
    }
    let t = board.tasks[idx].clone();
    engine.store.save_board(&board)?;
    engine.log(origin, "task_done", format!("Task completed: {}{}{}", t.title, message.map(|m| format!(" — {m}")).unwrap_or_default(), if unfulfilled.is_empty() { String::new() } else { format!(" (unfulfilled contract steps: {})", unfulfilled.join(", ")) }), Some(serde_json::json!({"task": tid, "unfulfilled_steps": unfulfilled})))?;
    Ok(TaskDone { task: t, unfulfilled })
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TaskDone {
    pub task: Task,
    pub unfulfilled: Vec<String>,
}

/// Add or refresh a system board item (drift / proposal / sync / uncertain) keyed by `reference`.
pub fn upsert_system_item(board: &mut Board, kind: &str, reference: &str, title: &str, detail: Option<String>) {
    if let Some(it) = board.items.iter_mut().find(|i| i.kind == kind && i.reference.as_deref() == Some(reference)) {
        if it.status != "open" {
            it.status = "open".into();
            it.resolved = None;
        }
        it.title = title.to_string();
        it.detail = detail;
        return;
    }
    board.items.push(BoardItem { id: short_id("item"), kind: kind.into(), title: title.into(), status: "open".into(), task: None, action: None, detail, reference: Some(reference.into()), created: now(), resolved: None });
}

pub fn resolve_system_items(board: &mut Board, kind: &str, keep: &[String]) {
    for it in board.items.iter_mut() {
        if it.kind == kind && it.status == "open" && !it.reference.as_ref().map(|r| keep.contains(r)).unwrap_or(false) {
            it.status = "done".into();
            it.resolved = Some(now());
        }
    }
}
