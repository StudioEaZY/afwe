# .afwe/ — Architecture-First Workspace Engine (format afwe/3)

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
- `turns/tNNNN.yaml` — the projection of one prompt per turn, its gate outcome and what it touched.
- `workflows/`, `abstractions/`, `contracts/` — node graphs (legacy), lenses, contract steps.

The authoritative record is the **engine ledger** at `refs/afwe/ledger/<project_id>`; `.afwe/turns/` is
a projection that `afwe repair` regenerates from it. Snapshots are local parentless commits under
`refs/afwe/snapshots/<project_id>/`, and rewind receipts are advisory records in `state/rewind.json`.

## Derived (rebuildable, never committed)

- `index/`, `state/`, `backups/` and `log/` — code model, index, drift, board, proposals, baselines,
  snapshot hashes, rewind receipts, local repair backups and the local audit log. `afwe sync`
  rebuilds the derived graph; `afwe repair` regenerates `turns/` from the ledger.

## The turn protocol

`afwe turn begin "<prompt>"` → briefing · `afwe turn assume <turn> --file <json>` → intents and claims ·
`afwe turn commit <turn>` → gate, then commit (`AFWE-Turn:` trailer), stage, or REDO.

`turn begin` deterministically starts the Studio daemon (port 4242) and the presence watcher; a
rewind receipt, if any, is carried in the briefing as `rewind_receipts` / `rewind_notice`.

History and recovery: `afwe timeline`, `afwe timeline losses`, `afwe timeline restore <feature>`,
`afwe ledger show|repair|push|fetch`, `afwe snapshot list|take`, `afwe rewind list|check`.

Read `.afwe/docs/SPEC.md` for formats, `.afwe/docs/TUTORIAL.md` for the developer guide, and `.afwe/docs/UBIQUITOUS_LANGUAGE.md` for domain terminology.
