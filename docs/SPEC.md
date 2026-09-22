# `.afwe/` format specification (afwe/1)

The folder is the product. Everything in this document is readable and writable by humans, by any
agent with a file tool, and by the reference engine. Any other engine that honours this document is a
valid AFWE implementation.

```
.afwe/
├── afwe.yaml                     manifest
├── blueprint/
│   ├── blueprint.yaml            node tree + implementation mapping
│   ├── relations.yaml            declared / inferred relationships
│   └── constraints.yaml          structural rules
├── memory/
│   ├── decisions/*.md            knowledge, one markdown file per entry, YAML front matter = scope
│   ├── constraints/*.md
│   ├── exceptions/*.md
│   ├── terminology/*.md
│   └── problems/*.md
├── guardrails/
│   ├── passive/*.yaml            context insertion
│   └── active/*.yaml             checks
├── workflows/*.yaml              node-based workflows (desired behaviour, frozen in time)
├── abstractions/*.yaml           lenses (custom views)
├── contracts/*.yaml              what AFWE needs from the harness
├── index/                        DERIVED — retrieval index (nodes ⇄ files ⇄ symbols ⇄ memory)
├── state/                        DERIVED — drift.json, proposals.json, board.json, sync.json
├── log/changes.jsonl             append-only change log
├── README.md                     short orientation for humans & agents
└── .gitignore                    ignores index/code.json (big, reproducible)
```

Sources of truth are the YAML/markdown files. `index/` and `state/` are reproducible from sources + code
(`afwe sync`), except `state/board.json` and `state/proposals.json`, which hold human-facing bookkeeping and
should be committed.

---

## 1. `afwe.yaml` — manifest

```yaml
format: afwe/1
project:
  name: Demo Product
  description: Tiny multi-language app used to demonstrate AFWE
  root: .                      # code root, relative to the directory that contains .afwe/
analyzer:
  include: []                  # globs; empty = everything under root
  ignore: [".afwe/**", "node_modules/**", "target/**", "dist/**", "build/**", ".git/**", "**/*.min.js", "**/*.lock"]
  max_file_size_kb: 512
  languages: []                # restrict to language ids; empty = all known
policy:
  auto_reconcile_min: 0.7      # ≥ → apply + log
  soft_reconcile_min: 0.5      # ≥ (and no contradiction) → apply + log with uncertain: true + Board item
  create_proposals: true       # < soft → state/proposals.json
  fail_on_violation: true      # verify exits non-zero on constraint / active guardrail errors
provenance:
  retain_prompts: true         # keep the original prompt as a `prompt` node in workflows
```

## 2. References and identity

A **node reference** is any of: node `id` (`payments`), dotted path (`Demo Product.Payments`), or a unique
name (`Payments`). Engines must resolve all three; ids are stable, paths are for humans.

A **file reference** is a path relative to `project.root`, forward slashes, no leading `./`. Globs use
gitignore/globset syntax (`src/auth/**`).

A **symbol reference** is `path::Name` or `path::Outer.Inner` (`src/auth/session.ts::SessionStore.get`).
The engine additionally records for every symbol:

* `structural` – the AST path (`class SessionStore > method get`), independent of position;
* `fingerprint` – blake3 of the normalised symbol body (whitespace-insensitive).

Identity = path + symbol + structural + fingerprint. **Never line numbers.** A symbol whose file changed
but whose fingerprint or structural path still matches is treated as the same symbol (rename / move
detection with confidence).

Origins are `human`, `human:<name>`, `llm:<model>` (e.g. `llm:claude-code`) or `human:sync` for engine
actions triggered by a person.

## 3. Blueprint

### 3.1 `blueprint/blueprint.yaml`

```yaml
nodes:
- id: demo-product
  name: Demo Product
  kind: product                 # product | subsystem | module | component | service | library | boundary | data | ui | …
  purpose: Root of the architecture.          # "why does it exist" — shown to agents
  description: optional longer text
  status: active                # active | planned | deprecated
  origin: human
  tags: []
  children:
  - id: payments
    name: Payments
    kind: subsystem
    purpose: Charging users. Must stay UI-free so it can run in workers.
    implements:
      files: ["src/payments/**"]                  # files or globs
      symbols: ["src/billing/legacy.ts::charge"]  # symbol refs mapped individually
    status: active
    origin: human
```

Rules: ids unique across the tree; a file resolves to the **deepest, most specific** node whose mapping
matches (explicit path > glob; explicit symbol mapping wins over its file); files matching nothing are
**unmapped** drift. A node with children and no mapping is implemented through its children.

### 3.2 `blueprint/relations.yaml`

```yaml
relations:
- from: payments
  to: identity
  kind: depends_on              # depends_on | uses | emits | consumes | extends | …
  status: declared              # declared (human/agent) | inferred (added by sync from code evidence)
  rationale: Charges are per user
  confidence: 0.9               # only for inferred
  origin: human
```

Code edges (imports between files mapped to different nodes) are compared with declared relations:
undeclared edges are drift (`undeclared_relation`), declared relations without evidence are
`unsupported_relation` (info).

### 3.3 `blueprint/constraints.yaml`

```yaml
constraints:
- id: payments-no-ui
  rule: must_not_depend         # must_not_depend | may_depend_only
  from: payments
  to: [ui]                      # for must_not_depend
  except: []                    # must_not_depend: exempt targets · may_depend_only: the allow-list
  severity: error               # error | warn
  rationale: Payments runs headless in workers.
  memory: [payments-boundary]   # memory entries that explain the rule
```

Constraints apply to the whole subtree of `from` and match targets by subtree as well.

## 4. Memory

One markdown file per entry, path `memory/<kind>s/<id>.md`, YAML front matter:

```markdown
---
id: lighthouse-exception
kind: decision                  # decision | constraint | exception | terminology | problem
title: Dashboard skips the Lighthouse budget
status: accepted                # proposed | accepted | superseded | resolved | open
applies_to: [dashboard]         # node refs (inherited by descendants)
files: ["src/dashboard/**"]     # globs (optional)
symbols: []                     # symbol refs (optional)
tags: [performance]
origin: human
created: 2026-09-22
supersedes: null
enforces: []                    # constraint ids this entry explains
workflow: null                  # workflow id this knowledge came out of
---

## Decision
...
## Reason
...
## Trade-off
...
```

Scope resolution for a file `f`: entries whose `files` match `f`, or whose `symbols` are in `f`, or whose
`applies_to` contains the node of `f` **or any ancestor**, or with an empty scope (project-wide). The index
(`index/memory.json`) precomputes this. Bodies are free markdown; the engine never parses them.

## 5. Guardrails

```yaml
# guardrails/passive/no-websockets-in-dashboard.yaml
id: no-websockets-in-dashboard
mode: passive
statement: Do not use WebSockets in Dashboard widgets.
reason: Widgets must work behind restrictive proxies.
scope: { nodes: [dashboard] }                  # nodes | relations ("a->b") | lenses | files | tags | global
exceptions: ["Realtime widgets may use WebSockets"]
exception_scope: { nodes: [realtime-status-worker] }
memory: [realtime-exception]
```

```yaml
# guardrails/active/payments-boundary.yaml
id: payments-boundary
mode: active
statement: Payments stays headless and quiet.
scope: { nodes: [payments] }
checks:
- { type: forbid_import, to_nodes: [ui], message: Payments must not import UI code }
- { type: forbid_pattern, pattern: 'console\.log', files: ["src/payments/**"], severity: error }
- { type: require_pattern, pattern: 'export function charge', files: ["src/payments/stripe.ts"] }
- { type: require_file, path: src/payments/README.md, severity: warn }
- { type: command, run: "npm run lint --silent -- {files}", when: files_changed_in_scope }
```

Passive guardrails are rendered into context whenever the scope matches. Active checks run in
`afwe verify`; `command` runs with `{files}` substituted and a non-zero exit is an error. Guardrails attach
to nodes/relations/groups/regions, never accidentally to single files.

## 6. Workflows (`workflows/<id>.yaml`)

```yaml
id: add-tagging
title: Add tagging to the workspace
status: implemented             # draft | in_progress | implemented | archived
origin: human
targets: [workspace-tagging, workspace-search]
nodes:
- id: prompt-1
  kind: prompt                  # prompt | intent | design | step | component | decision | question | output | note
  title: Original prompt
  text: I want tags on library items …
  origin: human
  status: captured
  position: { x: 0, y: 0 }
- id: comp-1
  kind: component
  title: Tag model + normaliser
  origin: llm:claude-code
  status: done
  maps_to: { nodes: [workspace-tagging], files: ["src/workspace/tagging/Tags.ts"], symbols: [], memory: [] }
edges:
- { from: prompt-1, to: intent-1, kind: then }      # then | refines | depends | produces | answers
created: 2026-09-22T16:14:00Z
updated: 2026-09-22T16:14:00Z
task: task-1a2b3c               # optional Board task
```

Workflows are frozen in time: they are not re-derived from code. `maps_to` records where each design element
landed; `afwe workflow promote` creates *planned* blueprint nodes for `component` nodes.

## 7. Lenses (`abstractions/<id>.yaml`)

```yaml
id: workspace-blueprint
name: Workspace Blueprint
description: The workspace as the team talks about it.
groups:
- name: Library
  nodes: [workspace-library]
- name: Preview
  nodes: [workspace-preview, canvas-renderer]
- name: Tagging
  nodes: [workspace-tagging]
  workflows: [add-tagging]
  groups: []                    # nested groups allowed
hide: []                        # node refs hidden in this view
origin: human
```

A lens is resolved into a tree of virtual groups containing blueprint subtrees. It never changes the
blueprint or the code.

## 8. Contracts (`contracts/<id>.yaml`)

```yaml
id: default
name: Default coding contract
task_kinds: [code, bugfix, refactor, chore, test]
steps:
- { id: context,  phase: before, action: afwe_context,  instruction: "Ask AFWE for context …" }
- { id: implement, phase: during, action: harness,      instruction: "Implement the change …" }
- { id: verify,   phase: after,  action: afwe_verify,   instruction: "Run afwe verify …" }
- { id: update,   phase: after,  action: afwe_update,   instruction: "Record decisions / mapping …" }
- { id: sync,     phase: after,  action: afwe_sync,     instruction: "Run afwe sync" }
- { id: log,      phase: after,  action: afwe_log,      instruction: "Log completion" }
```

`action` values: `afwe_context`, `afwe_workflow`, `afwe_blueprint`, `afwe_verify`, `afwe_update`,
`afwe_sync`, `afwe_log`, `harness` (the harness's own work, not tracked). Contracts are selected by task
kind (`afwe contract show --kind feature`).

## 9. Derived state

* `index/index.json` — summary; `nodes.json` (node → files, symbols, memory, guardrails), `files.json`
  (file → node, language, symbols, imports), `symbols.json`, `memory.json`, `code.json` (raw analysis, git-ignored).
* `state/drift.json` — last findings: `{id, kind, severity, confidence, summary, evidence[], change?, nodes[], files[]}`.
  Kinds: `unmapped_file`, `missing_file`, `missing_symbol`, `undeclared_relation`, `unsupported_relation`,
  `constraint_violation`, `empty_node`, `stale_memory`, `broken_reference`.
* `state/proposals.json` — findings under the soft threshold, `status: pending | accepted | reverted`.
* `state/board.json` — `tasks[]` and `items[]` (`contract_step`, `proposal`, `uncertain`, `drift`, `sync`).
* `state/sync.json` — last sync time, code fingerprint, `.afwe` fingerprint (used for the "out of sync" warning).
* `log/changes.jsonl` — one JSON object per line:
  `{"ts","origin","kind","summary","confidence"?,"uncertain"?,"task"?,"details"?}`.

## 10. Confidence policy (normative)

For each drift finding with a proposed `change`:

* `confidence ≥ policy.auto_reconcile_min` → apply, log.
* `policy.soft_reconcile_min ≤ confidence < auto` → apply **only if** no existing declaration contradicts
  it (e.g. the file is not explicitly mapped elsewhere, no constraint forbids the relation); log with
  `uncertain: true`; create an `uncertain` Board item. Uncertainty markers are never auto-resolved by a later
  sync — they stay open until a human dismisses them (`afwe board dismiss <id>`, op `board.dismiss`).
* otherwise → create/refresh a proposal; never apply.

Engines must never fabricate agreement: a constraint violation is reported, not "fixed" by removing the
constraint; an unmapped file is proposed to the best-fitting node, not silently attached to the root.

## 11. Compatibility

`format: afwe/1`. Unknown keys must be preserved by engines that rewrite files. New node kinds, memory
kinds, check types and workflow node kinds may be introduced without a format bump; consumers should treat
unknown values as opaque strings.
