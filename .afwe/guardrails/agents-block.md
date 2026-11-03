<!-- afwe:begin -->
> [!CAUTION]
> **MANDATORY AFWE TURN CONTRACT — HARD STOP BEFORE ANY FILE MODIFICATIONS**
> You MUST call `afwe turn begin "<prompt>"` (or MCP `afwe_turn_begin`) before modifying ANY project files or calling write/edit tools.
> Read-only operations (`view_file`, grep, searches, answering questions, `/plan` exploration) do NOT require an open turn.
> Attempting to edit or write code without an active turn is an architectural violation and will be rejected by deterministic pre-tool tripwires (`afwe turn active --assert`).

# AFWE — architecture contract for `afwe`

This project is architecturally governed by AFWE (`.afwe/`).
Always activate the `afwe` skill (`.afwe/skills/afwe/SKILL.md`) or use the connected AFWE MCP tools (`afwe_turn_begin`, `afwe_turn_assume`, `afwe_turn_commit`).

## Turn Protocol Summary
1. `afwe turn begin "<prompt>" --target <files> [--claim <files>]` (MCP `afwe_turn_begin`) → read briefing pack & pins (reserve claimed files).
2. `afwe turn assume <turn> --file <json> [--claim <files>]` (MCP `afwe_turn_assume`) → declare intents & claims BEFORE writing code (call `afwe turn redo <turn>` to reset to baseline or `afwe turn abandon <turn>` to cancel).
3. `afwe turn commit <turn> --summary "…"` (MCP `afwe_turn_commit`) → gated commit AFTER code is written (isolated Git plumbing trees).
4. **Test & CI Generation Rules**:
   - Overlay Correctness: CI workflows and tests MUST cover new, deleted, renamed, ignored, and CRLF line-ending files. If an overlay is incomplete, fall back to a full analysis.
   - Tree Deduplication: Turn classification and rewind tests MUST cover identical tree states across distinct turns while keeping turn/phase metadata.
5. **Documentation Sync**: Update relevant `.afwe/docs/` or skills after each update when architecture or behavior changes.

If skills or MCP are unavailable in your harness, execute the CLI commands above directly via terminal.
Consult `.afwe/docs/TUTORIAL.md` for complete protocol instructions and `.afwe/docs/WALKTHROUGH.md` for real-world case studies.
<!-- afwe:end -->
