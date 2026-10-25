---
name: afwe
description: Architecture-First Workspace Engine skill. Enforces turn protocol (begin -> assume -> commit), micro-context retrieval, verification gates, architectural integrity, and documentation sync for coding agents.
---

# AFWE Skill Instructions

This project uses AFWE to deterministically govern architecture and prevent agent regressions.
AFWE combines Code Knowledge Graphing, Intent Memory, and Structural Tripwires into a single deterministic gate.

When interacting with this codebase:

1. **Before Touching Code**:
   - Call `afwe turn begin "<prompt>" --target <files>` (or MCP tool `afwe_turn_begin`).
   - Read the briefing: inspect in-scope architectural nodes, locked pins, active guardrails, probing guides (`[GUIDE - ADVISORY]`), and ambiguity questions.
   - Call `afwe turn assume <turn> --file <json>` (or MCP tool `afwe_turn_assume`) to declare your intents and pre-generation claims.
     Supported claims include:
     - `forbid_import`: forbid cross-module imports (e.g. `to_nodes: ["ui"]`).
     - `forbid_symbol`: forbid disallowed AST symbols (e.g. `symbol: "danger_fn"`).
     - `export_exists`: ensure public symbol remains exposed (e.g. `symbol: "init"`).
     - `symbol_signature`: ensure symbol signature contains expected tokens.
     - `pattern`: regex AST/file pattern check (with automatic comment blanking).
     - `command`: shell verification command.
   - If REDO is returned, revise assumptions according to the schema before proceeding.

2. **While Editing**:
   - Retrieve micro-context via `afwe context <files>` (or MCP `afwe_context`).
   - Obey active pins and active guardrails; never delete pinned behavior without an explicit override.
   - Answer pending questions or review probing guides (`afwe question list`, `afwe guide list`).

3. **After Editing (Verification & Mandatory Synchronization)**:
   - Run verification via `afwe verify --changed <files>` (or MCP `afwe_verify`).
   - In prototype spikes, explore mode can be temporarily activated via `afwe unlock --reason "..."` and re-armed via `afwe lock`.
   - **Post-Turn Synchronization Obligation**: Whenever code structure, public APIs, rules, or behavior change:
     - Update documentation (`README.md`, `.afwe/docs/`, root `docs/`).
     - Update skill instructions (`.afwe/skills/afwe/SKILL.md`) with generalized examples.
     - Update MCP tool specs and handlers (`mcp.rs`, `api.rs`) whenever tool capabilities expand.
     - Persist non-obvious design choices via `afwe memory add --kind decision ...` (or `afwe_memory_add`).
   - Commit the turn via `afwe turn commit <turn> --summary "..."` (or MCP `afwe_turn_commit`).
   - Inspect stats and gate telemetry with `afwe stats`.
