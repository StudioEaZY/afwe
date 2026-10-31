<!-- afwe:begin -->
# AFWE-Core — Architecture Contract for Developing AFWE

This repository is **AFWE-Core** (the engine, CLI, crates, MCP tools, and Studio).
It is dogfooded and architecturally governed by its own `.afwe/` harness.
Always activate the `afwe` skill (`.afwe/skills/afwe/SKILL.md`) or use the connected AFWE MCP tools (`afwe_turn_begin`, `afwe_turn_assume`, `afwe_turn_commit`).

## Ubiquitous Language & Terminology Mandate
The canonical domain dictionary lives at [`docs/UBIQUITOUS_LANGUAGE.md`](docs/UBIQUITOUS_LANGUAGE.md) (and human-readable [`docs/UBIQUITOUS_LANGUAGE.html`](docs/UBIQUITOUS_LANGUAGE.html) / client copy [`.afwe/docs/UBIQUITOUS_LANGUAGE.md`](.afwe/docs/UBIQUITOUS_LANGUAGE.md)).
- **Pre-Planning Reading Mandate**: Before planning (`/plan`) or making architectural choices, read `docs/UBIQUITOUS_LANGUAGE.md` and active terms in `.afwe/memory/terminology/` to ensure thoughts, plans, intents, and code adhere strictly to canonical domain language (e.g. Turn, Pin, Claim, Capability Ratchet, Intent, Drift, Tripwire).
- **Auto-Update Synchronization Mandate**: Whenever introducing any new architectural primitive, renaming an existing concept, or modifying domain semantics:
  1. Record or update the term in `.afwe/memory/terminology/term-<name>.md`.
  2. Run `afwe memory sync-terms` (or `node scripts/sync-ubiquitous-language.js`) to recompile the Markdown and interactive HTML dictionaries.
  3. Ensure `AGENTS.md`, `.afwe/skills/afwe/SKILL.md`, and master documentation are kept strictly aligned.

## Context Codename Separation
- **`AFWE-Core`** (this repo): Developing the Rust crates, CLI binaries, MCP server, Studio, and master documentation in `docs/` and `crates/`.
- **`AFWE-Client`** (consumer projects): The scaffolds, templates, and files generated into `.afwe/` when end users run `afwe init` or `afwe onboard`. Always ensure generator templates and contracts reference `.afwe/docs/TUTORIAL.md`, never root `docs/`.

## Mandatory Turn Protocol & Rules
1. `afwe turn begin "<prompt>" --target <files> [--claim <files>]` (MCP `afwe_turn_begin`) → Phase 0 pre-planning briefing pack & pins (claims reserved upfront). Read `docs/UBIQUITOUS_LANGUAGE.md` for in-scope domain terms.
2. `afwe turn assume <turn> --file <json> [--claim <files>]` (MCP `afwe_turn_assume`) → Phase 1 declare intents & claims BEFORE writing code (call `afwe turn redo <turn>` to reset to baseline or `afwe turn abandon <turn>` to release claims). Explicitly declare removals in `removes` to satisfy the "Rust for project intent" compiler model.
3. `afwe turn commit <turn> --summary "…"` (MCP `afwe_turn_commit`) → Phase 2 gated commit AFTER code is written and verified (isolated Git plumbing trees with CAS verification).
4. **Post-Turn Documentation, Skills & MCP Synchronization**:
   - Whenever an update changes AFWE behavior, CLI flags, schema, or capabilities:
     - **Ubiquitous Language**: Add or update term files in `.afwe/memory/terminology/`, update `docs/UBIQUITOUS_LANGUAGE.md` (and `.afwe/docs/UBIQUITOUS_LANGUAGE.md`), and run `afwe memory sync-terms` to auto-update Markdown and HTML formats.
     - **MCP Tools**: Update the MCP tool definitions in `crates/afwe-cli/src/mcp.rs` and engine specs in `crates/afwe-core/src/api.rs` if tool schemas or capabilities expanded.
     - **Skills**: Update `.afwe/skills/afwe/SKILL.md` (and the embedded `AFWE_SKILL_MD` in `contract.rs`) with generalized instructions and clear examples.
     - **Documentation**: Update root documentation in `docs/` AND the embedded scaffolding in `crates/afwe-core/src/init.rs` (`TUTORIAL.md`, `WALKTHROUGH.md`, `SPEC.md`, `UBIQUITOUS_LANGUAGE.md`) so both Core and Client stay in sync.
     - **Memory**: Record non-obvious architectural decisions via `afwe memory add --kind decision ...`.

If skills or MCP are unavailable in your harness, execute the CLI commands above directly via terminal.
Consult `docs/TUTORIAL.md` (or `.afwe/docs/TUTORIAL.md`) for complete protocol instructions, `docs/UBIQUITOUS_LANGUAGE.md` for domain terminology, and `docs/WALKTHROUGH.md` for real-world case studies.
<!-- afwe:end -->
