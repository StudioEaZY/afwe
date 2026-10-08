# .afwe/ — Architecture-First Workspace Engine (format afwe/2)

This folder is the product: a persistent, structural model of the project that a harness reads and writes.
The engine that reads and writes it is replaceable.

## Sources of truth (commit these)

- `afwe.yaml` — manifest: policy (confidence thresholds, pin slider, checkgen), vcs (provider, auto-commit, test command), profile.
- `blueprint/` — structural reality: nodes (with implementation mapping), relations, constraints.
- `memory/<kind>/*.md` — decisions, constraints, exceptions, terminology, problems. Scoped by applies_to / files / symbols.
- `guardrails/passive|active/*.yaml` — context to inject (passive) and checks to enforce (active).
- `intents/*.yaml` — living intents: the merged statement of what is wanted, with its history and its raw prompts.
- `pins/*.yaml` — human-locked decisions and intentional bugs. The only part a human must lock.
- `checks/*.yaml` — what the gate must pass: shell commands or claims, with trust and authorship.
- `turns/tNNNN.yaml` — the ledger: one prompt per turn, its gate outcome and what it touched.
- `workflows/`, `abstractions/`, `contracts/` — node graphs (legacy), lenses, contract steps.
- `log/changes.jsonl` — append-only change log.

## Derived (rebuildable, never committed)

- `index/` and `state/` — code model, index, drift, board, proposals, baselines. `afwe sync` rebuilds them.

## The turn protocol

`afwe turn begin "<prompt>"` → briefing · `afwe turn assume <turn> --file <json>` → intents and claims ·
`afwe turn commit <turn>` → gate, then commit (`AFWE-Turn:` trailer), stage, or REDO.
History: `afwe timeline`, `afwe timeline losses`, `afwe timeline restore <feature>`.

Read `docs/SPEC.md` for the formats and `docs/CONTRACTS.md` for the obligations of a harness.
