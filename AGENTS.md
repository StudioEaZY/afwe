<!-- afwe:begin -->
# AFWE-Core — Architecture Contract for Developing AFWE

This repository is **AFWE-Core** (the engine, CLI, crates, MCP tools, and Studio).
It is dogfooded and architecturally governed by its own `.afwe/` harness.
Always activate the `afwe` skill (`.afwe/skills/afwe/SKILL.md`) or use the connected AFWE MCP tools (`afwe_turn_begin`, `afwe_turn_assume`, `afwe_turn_commit`).

## Context Codename Separation
- **`AFWE-Core`** (this repo): Developing the Rust crates, CLI binaries, MCP server, Studio, and master documentation in `docs/` and `crates/`.
- **`AFWE-Client`** (consumer projects): The scaffolds, templates, and files generated into `.afwe/` when end users run `afwe init` or `afwe onboard`. Always ensure generator templates and contracts reference `.afwe/docs/TUTORIAL.md`, never root `docs/`.

## Mandatory Turn Protocol & Rules
1. `afwe turn begin "<prompt>" --target <files>` (MCP `afwe_turn_begin`) → read briefing pack & pins.
2. `afwe turn assume <turn> --file <json>` (MCP `afwe_turn_assume`) → declare intents & claims BEFORE writing code.
3. `afwe turn commit <turn> --summary "…"` (MCP `afwe_turn_commit`) → gated commit AFTER code is written.
4. **Post-Turn Documentation, Skills & MCP Synchronization**:
   - Whenever an update changes AFWE behavior, CLI flags, schema, or capabilities:
     - **MCP Tools**: Update the MCP tool definitions in `crates/afwe-cli/src/mcp.rs` and engine specs in `crates/afwe-core/src/api.rs` if tool schemas or capabilities expanded.
     - **Skills**: Update `.afwe/skills/afwe/SKILL.md` (and the embedded `AFWE_SKILL_MD` in `contract.rs`) with generalized instructions and clear examples.
     - **Documentation**: Update root documentation in `docs/` AND the embedded scaffolding in `crates/afwe-core/src/init.rs` (`TUTORIAL.md`, `WALKTHROUGH.md`, `SPEC.md`) so both Core and Client stay in sync.
     - **Memory**: Record non-obvious architectural decisions via `afwe memory add --kind decision ...`.

If skills or MCP are unavailable in your harness, execute the CLI commands above directly via terminal.
Consult `docs/TUTORIAL.md` (or `.afwe/docs/TUTORIAL.md`) for complete protocol instructions and `docs/WALKTHROUGH.md` for real-world case studies.
<!-- afwe:end -->
