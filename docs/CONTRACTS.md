# Contracts

A contract is a scoped instruction set that tells the harness **what AFWE needs** around a task. AFWE does
not own the agent loop: it declares obligations, observes which ones were met through its own tools, and
shows the rest on the Board. Contracts live in `.afwe/contracts/*.yaml` and are selected by *task kind*.

## The two default contracts

### `default` — coding contract (`code`, `bugfix`, `refactor`, `chore`, `test`)

| # | phase | action | what the harness does |
| --- | --- | --- | --- |
| 1 | before | `afwe_context` | `afwe context <files>` / tool `afwe_context` — get the decisions, exceptions, constraints and guardrails that apply to what is about to be touched |
| 2 | during | `harness` | implement (the harness's own business; not tracked) |
| 3 | after | `afwe_verify` | `afwe verify --changed <files>` — fix violations, do not silence them |
| 4 | after | `afwe_update` | if a decision was made / an exception hit / structure changed: `afwe memory add …`, `afwe blueprint map|add|relate …` |
| 5 | after | `afwe_sync` | `afwe sync` — mapping, index and drift are current |
| 6 | after | `afwe_log` | `afwe task done <task> --message "what changed and why"` |

### `architecture` — architecture / workflow contract (`architecture`, `feature`, `workflow`, `design`)

| # | phase | action | what the harness does |
| --- | --- | --- | --- |
| 1 | before | `afwe_workflow` | capture intent as a **node-based workflow** (`afwe workflow new … --prompt "<verbatim>"` / `afwe_workflow_upsert`); the prompt becomes a `prompt` node (provenance) |
| 2 | before | `afwe_context` | context for the nodes/files the workflow touches; check whether an existing node already does the job |
| 3 | before | `afwe_blueprint` | reflect the desired structure in the blueprint first (`add`, `move`, `relate`, `constrain`, or `afwe workflow promote`) |
| 4 | during | `harness` | implement beneath the blueprint, mapping new files/symbols as you go |
| 5 | after | `afwe_verify` | verify; every workflow `component` node should map to real nodes/files |
| 6 | after | `afwe_update` | persist the knowledge that came out of it as memory; mark workflow nodes `done`, set `maps_to` |
| 7 | after | `afwe_sync` | sync |
| 8 | after | `afwe_log` | log completion |

## How obligations are tracked

```
afwe task start "Make widget titles editable" --files src/dashboard/Widget.tsx   # or afwe_task_start
→ task-4b8d30 with one Board item per non-harness step

afwe context src/dashboard/Widget.tsx          ✓ afwe_context
afwe verify --changed src/dashboard/Widget.tsx ✓ afwe_verify (only when ok)
afwe memory add decision "…"                   ✓ afwe_update      (any memory/guardrail/blueprint/workflow op)
afwe sync                                      ✓ afwe_sync
afwe task done task-4b8d30 --message "…"       ✓ afwe_log — reports unfulfilled obligations
```

Ops tick the matching step of the task given with `--task` / `task` param, or of the most recent open task.
`afwe board` / the Studio Board show every open obligation, plus system items (proposals, uncertain
reconciliations, stale references). System items that need a human glance are cleared with
`afwe board dismiss <item-id>` (Studio: *dismiss*); proposals are cleared by `afwe proposals accept|revert|review <id>`.

## Putting the contract in front of the agent

* `afwe init --agents-md` or `afwe contract render >> AGENTS.md` writes a block between
  `<!-- afwe:begin -->` and `<!-- afwe:end -->` explaining the tools and listing the contracts. Claude Code
  reads `CLAUDE.md`, Codex/Cursor/others read `AGENTS.md`.
* Over MCP the contract is also returned inside every `afwe_context` result (`contract` field and the
  markdown), so an agent that only calls `afwe_context` still sees what it owes.
* `afwe contract show --kind feature --json` returns the contract as JSON.

## Writing your own contract

```yaml
# .afwe/contracts/data-migration.yaml
id: data-migration
name: Data migration contract
description: Schema changes must be reviewed against the Data subsystem's decisions.
task_kinds: [migration]
steps:
- { id: context,  phase: before, action: afwe_context,  instruction: "afwe context --node Data; read every decision tagged `schema`." }
- { id: workflow, phase: before, action: afwe_workflow, instruction: "Write the migration plan as a workflow (steps + rollback)." }
- { id: implement, phase: during, action: harness,      instruction: "Implement forward and rollback migrations." }
- { id: verify,   phase: after,  action: afwe_verify,   instruction: "afwe verify --changed <files> (the `migrations-tested` active guardrail runs the migration test suite)." }
- { id: update,   phase: after,  action: afwe_update,   instruction: "Record the schema decision with `enforces` pointing at the relevant constraint." }
- { id: sync,     phase: after,  action: afwe_sync,     instruction: "afwe sync" }
- { id: log,      phase: after,  action: afwe_log,      instruction: "afwe task done …" }
```

Then `afwe task start "Split users table" --kind migration`.

Contracts are deliberately small. Anything the harness must *know* belongs in memory/guardrails (so it is
scoped and retrievable); anything the harness must *do around* a change belongs in a contract.


---

## The default contract is now the turn protocol (v2)

The default coding contract is executed by AFWE itself, in three calls:

1. **begin** — `afwe turn begin "<prompt>" --target <nodes|files>` (MCP `afwe_turn_begin`). Read the briefing. Obey the
   pins, respect the intentional markers, and show the footer if proposals are pending.
2. **assume** — before writing code, declare the intents (`action` + `targets`) and the claims you rely on
   (`afwe turn assume <turn> --file <json>`). A REDO means the schema or a pin was wrong: fix it and assume again.
3. **commit** — after writing code, `afwe turn commit <turn> --summary "…"`. A REDO means nothing was committed:
   fix the listed failures and commit again. A STAGE means the change waits for a human (`turn confirm` / `turn revert`).

Declare removals in `removes`. A feature that disappears without a declaration is refused as collateral loss. Do not
edit around a pin: ask for an override with a reason, and let a human decide.
