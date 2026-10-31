---
id: term-turn-redo
kind: terminology
title: "Turn Redo"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - turn-protocol
  - recovery
created: 2026-10-31T14:27:00Z
---
# Turn Redo

## Meaning
A safety command (`afwe turn redo <turn>`) that cleanly reverts uncommitted workspace edits back to the turn's begin baseline (backed up in `.afwe/backups/<turn_hash>/`), while keeping the turn open and retaining locks for rework.

## Not to be confused with
- **Turn Abandon**: Redo keeps the turn open to try again; Abandon cancels the turn and releases all file claims and locks.
- **Turn Undo / Revert**: Undo/revert operates on already-committed turns; Redo operates on the current open uncommitted turn.
