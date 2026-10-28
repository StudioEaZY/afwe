//! Contracts: scoped instructions that tell the harness what AFWE needs it to do when
//! work crosses an AFWE boundary. The Board tracks contract obligations per task.

use crate::model::*;
use crate::util::{now, short_id};

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
AFWE combines Code Knowledge Graphing, Intent Memory, and Structural Tripwires into a single deterministic gate.

When interacting with this codebase:

1. **Phase 0: Pre-Planning & Research (Before Planning)**:
   - Call `afwe turn begin "<prompt>" --target <files> [--claim <files>] [--parent <turn>]` (or MCP tool `afwe_turn_begin`) **immediately upon receiving the prompt**, before researching or authoring a plan (`/plan`).
   - In parallel multi-agent sessions, declare file claims upfront with `--claim <files>` to prevent lost-update races.
   - Read the briefing pack: inspect in-scope architectural nodes, locked pins, active guardrails, probing guides (`[GUIDE - ADVISORY]`), and ambiguity questions. Note your assigned `turn_hash` and bearer `token`.
   - If `CONTENTION` is returned, another agent holds that file. Do not edit conflicting files concurrently in the same directory.

2. **Phase 1: Pre-Code Declaration (After Plan Approval)**:
   - Call `afwe turn assume <turn> --file <json> [--token <tok>] [--claim <files>]` (or MCP tool `afwe_turn_assume`) to declare your intents and pre-generation claims BEFORE writing any code.
     Supported claims include:
     - `forbid_import`: forbid cross-module imports (e.g. `to_nodes: ["ui"]`).
     - `forbid_symbol`: forbid disallowed AST symbols (e.g. `symbol: "danger_fn"`).
     - `export_exists`: ensure public symbol remains exposed (e.g. `symbol: "init"`).
     - `symbol_signature`: ensure symbol signature contains expected tokens.
     - `pattern`: regex AST/file pattern check (with automatic comment blanking).
     - `command`: shell verification command.
   - If refactoring or replacing existing capabilities, declare explicit removals in `removes` or intents with `action: remove` / `replace` (following Rust's strict compiler philosophy: unforgiving by default with explicit declarations).
   - If REDO is returned, call `afwe turn redo <turn> [--token <tok>]` to safely reset working tree changes back to baseline (backed up in `.afwe/backups/<turn_hash>/`).
   - If abandoning an open attempt, call `afwe turn abandon <turn> [--token <tok>]` to release all file claims immediately.

3. **Phase 2: While Editing**:
   - Retrieve micro-context via `afwe context <files>` (or MCP `afwe_context`).
   - Obey active pins and active guardrails; never delete pinned behavior without an explicit override (`{pin, reason}`).
   - Answer pending questions or review probing guides (`afwe question list`, `afwe guide list`).

4. **Phase 3: Post-Editing (Verification & Mandatory Synchronization)**:
   - Run verification via `afwe verify --changed <files>` (or MCP `afwe_verify`).
   - In prototype spikes, explore mode can be temporarily activated via `afwe unlock --reason "..."` and re-armed via `afwe lock`.
   - **Post-Turn Synchronization Obligation**: Whenever code structure, public APIs, rules, or behavior change:
     - Update documentation (`README.md`, `.afwe/docs/`, root `docs/`).
     - Update skill instructions (`.afwe/skills/afwe/SKILL.md`) with generalized examples.
     - Update MCP tool specs and handlers (`mcp.rs`, `api.rs`) whenever tool capabilities expand.
     - Persist non-obvious design choices via `afwe memory add --kind decision ...` (or `afwe_memory_add`).
   - Commit the turn via `afwe turn commit <turn> --summary "..." [--token <tok>]` (or MCP `afwe_turn_commit`).
     Commits are isolated via Git plumbing trees with CAS verification and OS advisory commit locks (`flock`/`LockFileEx`), preventing dirty workspace leakage.
     The commit gate deterministically enforces capability and governance ratchets:
     - `DROPPED_CAPABILITY`: intra-file export dropped without declared remove/replace intent.
     - `SEVERED_CAPABILITY`: cross-module caller severance dropping inbound references from >0 to 0.
     - `DEAD_ON_ARRIVAL`: new uncalled exported function born with 0 callers without test or intent declaration.
     - `ORPHANED_DECISION` / `ORPHANED_PIN`: anchored architectural memory or pin lost its target code.
     - `DOCS_DRIFT`: markdown documentation links pointing to missing code files.
     Remember: "Rust for project intent" — you can break things on purpose by declaring them in `turn assume`, but you can never break them by accident.
   - Inspect stats and gate telemetry with `afwe stats`.
"#;

pub fn render_agents_block(project: &str, _contracts: &[Contract]) -> String {
    let mut s = String::new();
    s.push_str("<!-- afwe:begin -->\n");
    s.push_str(&format!("# AFWE — architecture contract for `{project}`\n\n"));
    s.push_str("This project is architecturally governed by AFWE (`.afwe/`).\n");
    s.push_str("Always activate the `afwe` skill (`.afwe/skills/afwe/SKILL.md`) or use the connected AFWE MCP tools (`afwe_turn_begin`, `afwe_turn_assume`, `afwe_turn_commit`).\n\n");
    s.push_str("## Turn Protocol Summary\n");
    s.push_str("1. `afwe turn begin \"<prompt>\" --target <files> [--claim <files>]` (MCP `afwe_turn_begin`) → read briefing pack & pins (reserve claimed files).\n");
    s.push_str("2. `afwe turn assume <turn> --file <json> [--claim <files>]` (MCP `afwe_turn_assume`) → declare intents & claims BEFORE writing code (call `afwe turn redo <turn>` to reset to baseline or `afwe turn abandon <turn>` to cancel).\n");
    s.push_str("3. `afwe turn commit <turn> --summary \"…\"` (MCP `afwe_turn_commit`) → gated commit AFTER code is written (isolated Git plumbing trees).\n");
    s.push_str("4. **Documentation Sync**: Update relevant `.afwe/docs/` or skills after each update when architecture or behavior changes.\n\n");
    s.push_str("If skills or MCP are unavailable in your harness, execute the CLI commands above directly via terminal.\n");
    s.push_str("Consult `.afwe/docs/TUTORIAL.md` for complete protocol instructions and `.afwe/docs/WALKTHROUGH.md` for real-world case studies.\n");
    s.push_str("<!-- afwe:end -->\n");
    s
}

// ───────────────────────────── tasks & board ─────────────────────────────

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
