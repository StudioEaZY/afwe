---
id: term-rewind-receipt
kind: terminology
title: Rewind Receipt
status: accepted
applies_to:
- afwe-core
tags:
- rewind
- ledger
origin: llm:deepseek-flash
created: 2026-11-02
---

# Rewind Receipt

## Meaning
The append-only record AFWE writes when it detects that the working tree moved back to a state it has
already seen. `turn.begin` compares the ledger's expected tree `E` with the current tree `C`, matches
the changed paths against per-snapshot path hashes, and writes one aggregated receipt with a verdict
(`REWOUND`, `COMPOUND` or `UNATTRIBUTED`), the matched snapshot, the touched paths and the turns
possibly undone. A receipt is advisory: AFWE continues, never blocks a turn, and never restores files
automatically.

## Behavior
- Identical changed-path/content sets are receipted once (state hash dedupe), capped at 20 in
  `state/rewind.json`, and appended to the ledger as `rewind_confirmed` (exact) or `rewind_possible`.
- `E` advances to the full current tree at turn begin, ready and commit, so a `sync` that rewrites
  `.afwe` sources cannot look like a rewind on the next begin.
- The next `turn.begin` briefing carries `rewind_receipts` and a one-line `rewind_notice`.

## Not to be confused with
- **Revert commit**: an `AFWE-Rewind-Of` commit is a proposal to represent the rewind in history.
- **Rollback**: an explicit human undo, which changes status on purpose.

