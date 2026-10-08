<!-- afwe:begin -->
# AFWE — architecture contract for `afwe`

This project keeps a persistent, structural model of itself in `.afwe/` (blueprint, memory, guardrails, workflows).
You do not need to read those files directly: ask AFWE.

- `afwe context <file...>` (MCP: `afwe_context`) → only the decisions/exceptions/constraints/guardrails that apply to what you are touching.
- `afwe verify --changed <file...>` (MCP: `afwe_verify`) → checks your change against the blueprint; exit code 1 means you must fix it, not silence it.
- `afwe sync` (MCP: `afwe_sync`) → re-analyses the code, reconciles confident changes, proposes uncertain ones.
- `afwe memory add <kind> …` (MCP: `afwe_memory_add`) → record a decision/exception/constraint/term/problem with scope.
- `afwe workflow …` (MCP: `afwe_workflow_upsert`) → capture intent as a node-based workflow before designing features.
- `afwe task start …` / `afwe task done …` → the Board tracks contract obligations for the task.

## Turn protocol (every prompt)
1. `afwe turn begin "<prompt>" --target <nodes|files>` (MCP `afwe_turn_begin`): read the briefing; obey the pins and intentional markers; show the footer if proposals are pending.
2. `afwe turn assume <turn> --file <json>` (MCP `afwe_turn_assume`) BEFORE writing code: declare intents and claims. REDO = fix and assume again.
3. `afwe turn commit <turn> --summary "…"` (MCP `afwe_turn_commit`) AFTER writing code. REDO = nothing committed: fix and commit again.
Declare removals in `removes`; never edit around a pin, ask for an override with a reason.

The blueprint is not documentation to understand; it is the structural reality of this project. Verify your work against it.
If the code and the blueprint disagree, say so (or let `afwe sync` propose) — never silently reinterpret the architecture.
Consult `docs/TUTORIAL.md` for complete protocol instructions and `docs/WALKTHROUGH.md` for real-world case studies.

## Contract `architecture` — Architecture / workflow contract (tasks: architecture, feature, workflow, design)
1. **before** — Capture the intent as a node-based workflow (`afwe workflow new …` / tool `afwe_workflow_upsert`). Paste the original prompt verbatim as a `prompt` node (provenance) and break the design into nodes; do not assume beyond the prompt.
2. **before** — Ask AFWE for context on the nodes/files the workflow touches; check whether an existing node already does the job before inventing a new one.
3. **before** — Reflect the desired structure in the blueprint first (`afwe blueprint add/move/relate/constrain`). Blueprint = structural reality, workflow = desired behaviour.
4. **during** — Implement beneath the blueprint. Map new files/symbols to their nodes as you go.
5. **after** — Verify against the blueprint (`afwe verify`). Every workflow component node should map to real nodes/files.
6. **after** — Persist the resulting knowledge as memory (decisions, constraints, terminology) – not the conversation. Mark workflow nodes done and set `maps_to`.
7. **after** — Run `afwe sync`.
8. **after** — Log completion.

## Contract `default` — Default coding contract (tasks: code, bugfix, refactor, chore, test)
1. **before** — Before touching a file, ask AFWE for the relevant context (`afwe context <file>` / tool `afwe_context`) and respect the decisions, exceptions and guardrails it returns.
2. **during** — Implement the requested change. Reuse existing nodes/libraries shown in the context before creating new ones.
3. **after** — Run `afwe verify --changed <files>` (tool `afwe_verify`). Fix constraint violations and failed active guardrails; do not silence them.
4. **after** — If you made a decision, hit an exception, or changed structure: record it (`afwe memory add …`, `afwe blueprint map …`). Keep the blueprint and the code as two views of the same thing.
5. **after** — Run `afwe sync` so mapping/index/drift are current (auto‑reconciles confident changes, proposes uncertain ones).
6. **after** — Log completion with what changed and why (`afwe task done <task> --message …`).

<!-- afwe:end -->

