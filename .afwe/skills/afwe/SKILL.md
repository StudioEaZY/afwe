---
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

3. **After Editing (Verification & Mandatory Documentation, Skill & MCP Sync)**:
   - Run verification via `afwe verify --changed <files>` (or MCP `afwe_verify`).
   - **Post-Turn Synchronization Obligation**: Whenever code structure, public APIs, rules, or behavior change:
     - Update documentation (`README.md`, `.afwe/docs/`, root `docs/`).
     - Update skill instructions (`.afwe/skills/afwe/SKILL.md`) with generalized examples.
     - Update MCP tool specs and handlers (`mcp.rs`, `api.rs`) whenever tool capabilities expand.
     - Persist non-obvious design choices via `afwe memory add --kind decision ...` (or `afwe_memory_add`).
   - Commit the turn via `afwe turn commit <turn> --summary "..."` (or MCP `afwe_turn_commit`).
   - If proposals are pending, include the AFWE reminder footer in your reply.
