<!-- afwe:begin -->
# AFWE — architecture contract for `afwe`

This project is architecturally governed by AFWE (`.afwe/`).
Always activate the `afwe` skill (`.afwe/skills/afwe/SKILL.md`) or use the connected AFWE MCP tools (`afwe_turn_begin`, `afwe_turn_assume`, `afwe_turn_commit`).

## Turn Protocol Summary
1. `afwe turn begin "<prompt>" --target <files>` (MCP `afwe_turn_begin`) → read briefing pack & pins.
2. `afwe turn assume <turn> --file <json>` (MCP `afwe_turn_assume`) → declare intents & claims BEFORE writing code.
3. `afwe turn commit <turn> --summary "…"` (MCP `afwe_turn_commit`) → gated commit AFTER code is written.
4. **Documentation Sync**: Update relevant docs/skills after each update when architecture or behavior changes.

If skills or MCP are unavailable in your harness, execute the CLI commands above directly via terminal.
Consult `.afwe/docs/TUTORIAL.md` (or `docs/TUTORIAL.md`) for complete protocol instructions and `docs/WALKTHROUGH.md` for real-world case studies.
<!-- afwe:end -->
