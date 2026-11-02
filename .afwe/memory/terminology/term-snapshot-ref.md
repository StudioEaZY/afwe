---
id: term-snapshot-ref
kind: terminology
title: Snapshot Ref
status: accepted
applies_to:
- afwe-core
tags:
- snapshot
- rewind
- ledger
origin: llm:deepseek-flash
created: 2026-11-02
---

# Snapshot Ref

## Meaning
A local, parentless git commit under `refs/afwe/snapshots/<project_id>/<snap_id>` that records the
working tree at turn begin and turn end. Parentless means pruning is one `update-ref -d` followed by
a prune, and lineage lives in the engine ledger rather than in parent pointers. Snapshot refs never
travel with `afwe ledger push` or a normal `git fetch`/`git push`.

## Behavior
- The tree is built through a private per-worktree index under `<git-common-dir>/afwe/snapshots/`,
  never the user's index.
- Excluded and reported: engine-owned state (`.afwe/index`, `state`, `turns`, `log`, `backups`),
  nested repositories, LFS paths, symlinks and files over the size limit.
- `afwe snapshot take`, `afwe snapshot list` and `afwe snapshot show` expose the refs; turn begin
  and turn end take one best effort.

## Not to be confused with
- **Engine ledger**: the authoritative record of turns and expected state; snapshots are local
  evidence for restore-forward and classification.
- **Ratchet baseline** (`afwe baseline snapshot`): grandfathering pre-existing violations.
- **Analysis snapshot** (`Engine::snapshot`): the in-memory code graph, unrelated to git commits.
