---
term: Turn Reclaim
domain: Concurrency & Lifecycle
canonical_status: approved
short_definition: Deterministic engine-level recovery of file reservations held by an orphaned or stale turn, transitioning it to abandoned with structured provenance.
---

# Turn Reclaim

## Definition
**Turn Reclaim** is the atomic operation by which the AFWE engine reclaims file claims and locks from an idle stale turn without requiring LLM generation, harness crash-hooks, or prompt replay.

## Mechanics
- **Trigger**: Occurs either automatically when a new `turn.begin` or `turn.assume` conflicts with a stale turn holding the claimed file, or manually via `afwe turn reclaim <turn>` / Action Queue `Reclaim` action.
- **State Transition**: The stale turn's status changes from `open`/`assumed`/`ready` to `abandoned`.
- **Structured Reclaim Record**: A `reclaim: { by, at, reason }` record is stamped on the turn file.
- **Ledger & Presence**: Records `turn_stale_reclaimed` in the append-only ledger and emits a `turn_end.stale` presence event.
- **Working Tree Preservation**: Uncommitted code changes are not automatically reverted or committed; the next agent or human can cleanly continue or inspect dirty files.
