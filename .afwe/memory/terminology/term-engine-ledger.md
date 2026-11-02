---
id: term-engine-ledger
kind: terminology
title: Engine Ledger
status: accepted
applies_to:
- afwe-core
tags:
- ledger
- rewind
- transport
origin: llm:deepseek-flash
created: 2026-11-02
---

# Engine Ledger

## Meaning
The authoritative, append-only record of engine state stored as a commit chain at
`refs/afwe/ledger/<project_id>`. Every commit carries the previous tree forward and adds one event.
The `.afwe/` folder is a projection: `afwe repair` regenerates the engine-owned parts of it from the
ledger instead of treating disk as the record.

The P1 tree is `meta.json`, `turns/<alias>.json`, `events/<seq>-<kind>.json`,
`state/expected.json` and `baselines/<alias>.json`. `meta.json` carries `ledger_version: 1`; a reader
that sees a newer version refuses and asks the user to upgrade rather than partially interpreting it.

## Behavior
- `project_id` is a stable lowercase hex id stored in `afwe.yaml`; it is never derived from the
  display name, because ref names are files on Windows and macOS.
- Writes use a compare-and-swap `update-ref`, retried three times on collision.
- A turn record stores the full `touched` and `implements` maps every 20th event and a delta
  otherwise, so a no-change turn stays under 2 KB.
- `afwe ledger push` and `afwe ledger fetch` move only the ledger ref; branches, tags and snapshots
  never travel with it.

## Not to be confused with
- **Change log** (`.afwe/log/changes.jsonl`): a human-readable audit trail, not the record of state.
- **Drift Ledger** (`.afwe/state/drift_ledger.json`): tolerated architectural drift, unrelated.
- **Git history**: the ledger is stored in git, but it is a separate ref and never becomes a branch.
