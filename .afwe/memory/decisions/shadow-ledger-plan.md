---
id: shadow-ledger-plan
kind: decision
title: Shadow Ledger Plan (v3)
status: proposed
applies_to:
- afwe-core
files:
- crates/afwe-core/src/rollback.rs
- crates/afwe-core/src/store.rs
- crates/afwe-core/src/vcs/git.rs
tags:
- ledger
- rewind
- rollback
- plan
origin: llm:deepseek-flash
created: 2026-11-02
---

# Shadow Ledger Plan (v3)

**Status:** proposed. Supersedes the v3 draft circulated in chat; this file is the source of truth.
**Unit of authority:** the repository, not the clone. Many worktrees and many agents in one repo are
supported. Clones consume a pushed ledger, with an explicit fork rule (§10).
**Already landed:** the P0 reconcile rework (`rollback.rs`, commit `04c7637`) and the test repair
(`37122be`). This plan does not re-open them.

## 0. Scope

In scope: making engine-owned history survive any working-tree mutation, without harness cooperation.
Harnesses never call AFWE and expose no hooks; every mechanism here runs at AFWE's own entry points.

Out of P1: snapshots, restore-forward, the presence watcher, queue UI, cross-clone merge. P1 is the
ledger plus the lifecycle. Nothing in P1 may depend on a harness, a daemon, or user discipline.

## 1. What is wrong today

1. Engine state is split across two lifetimes. `.afwe/.gitignore` ignores `index/` and `state/`, so
   turn records and the log are tracked (and rolled back by a file restore) while baselines are not.
2. `reconcile()` treated a content mismatch as proof of an undo.
3. The reaction was destructive: `remove_check_file`, memory flagged `unconfirmed_rollback`.
4. Detection was HEAD-only, with a 50-commit and a 15-turn window.
5. Two hashing worlds: raw bytes in `tree_hashes` (`turn.rs:142`), filtered blobs in
   `hash-object -w --path` (`vcs/git.rs:167`).

Root cause: the working tree was both AFWE's record and its evidence.

## 2. Principles

- The working tree is a projection AFWE observes, never a record it trusts.
- Recording is not deciding. Restoring files is a decision.
- Never block: no pending proposal holds up a turn, a commit, or a loop.
- Never destroy on a classification.
- Observe through one hashing world per phase, on both sides of every comparison.
- Harness-agnostic. Git is the storage engine, not a new VCS.

## 3. Ledger schema

`refs/afwe/ledger/<project_id>`, a commit chain written with plumbing and a compare-and-swap
`update-ref`, retried on CAS failure.

`project_id` is a stable lowercase hex id stored in the manifest and generated at init. Never the
display name: names may contain spaces, `..`, `~`, trailing dots, or case-colliding letters, and ref
names are files on Windows and macOS. `outbox.rs` has the same latent bug with
`refs/afwe/outbox/<project>` and is fixed in P1.

Ledger commit message: `afwe-ledger: <seq> <kind>`. Tree layout:

```
meta.json                    {version, project_id, seq, created}
turns/<turn_id>.json         compacted turn record
events/<seq>-<kind>.json     append-only event
state/expected.json          {paths: {path: blake3}, updated_at, turn}
state/path-index/<sha>.json  path -> [[blob, snap_id], ...] capped at K
baselines/<turn_id>.json     existing baseline JSON in P1
```

`meta.json` carries `ledger_version: 1`. A reader that sees a newer version refuses and reports; it
never downgrades, never partially interprets.

Event kinds in P1: `turn_recorded`, `turn_committed_manual`, `rewind_confirmed`, `rewind_possible`,
`rewind_healed`, `repair`, `commit_rewritten`, `forked`, `superseded`.

## 4. Manual mode: `ready` turns are first-class

In engineer mode `turn commit` ends `ready` and the human commits with git. In this repository that
is **81 of 82 turns**; zero are `committed`, and `post_hashes` is absent from them. P0's reconcile
iterates `committed` only, so it is currently inert here and its sha path is never exercised.

P1 therefore:

- Records `turn_recorded` for every turn regardless of final status.
- On reconcile, a `ready` turn whose trailer or `commit_sha` is reachable gets a
  `turn_committed_manual` event. The projection (`.afwe/turns/<id>.yaml`) is rewritten to
  `committed`, with `commit_sha` and `committed_at`. The turn record is a projection; the ledger is
  the record.
- Rewind detection covers `ready` turns with a recorded commit. A `ready` turn with no commit yet is
  ordinary in-progress work, not a rewind.
- `post_hashes` is populated from `touched` on promotion, so the advisory check stops being dark.

Without this section the plan protects nothing in the profile this repo actually runs.

## 5. Record size and compaction

Measured today: `.afwe/turns` is 16 MB over 90 files; `t0074.yaml` is 347 KB and 6,226 lines, of which
`touched` is 260 KB and `implements` 73 KB. `turn-<hash>.yaml` is byte-identical to `<alias>.yaml`.
A ledger that ingests these verbatim pays double, forever, in a chain that cannot be compacted.

P1:

- One file per turn. Locate the writer that emits `turn-<hash>.yaml` and drop the duplicate.
- `touched` stores only paths whose hash changed versus the previous turn, plus a
  `since: <turn_id>` marker. Every 20th turn stores a full map, so a lost delta is recoverable.
- Ledger events reference record blobs by path inside the ledger tree; they never embed records.
- Acceptance: a no-change turn adds < 2 KB to the ledger.

## 6. Expected tree `E` for P1

`E` is the ledger's record of what the working tree should look like. In P1 it is the existing
`touched` path → blake3 map, not a git tree. Reasons: it already exists per turn, it is the same
hashing world as `tree_hashes`, and a git-tree world would drag CRLF, LFS and nested-repo handling
into P1 for no P1 benefit.

`E` advances only at these four events, each written in the same ledger commit as the event:

1. `turn begin` → `E := C`, after any receipt for that moment.
2. `turn end` / commit → `E := C`.
3. `afwe repair` → `E := C` after regeneration.
4. A rewind proposal is accepted → `E := C`.

Nothing else moves `E`. A difference at any entry point is drift; drift is recorded once, then `E`
adopts `C` so it is not re-reported. Without this rule every ordinary turn looks like drift forever.

## 7. Snapshots (P2 only)

- `refs/afwe/snapshots/<project_id>/<snap_id>`, parentless commits, one ref each, so pruning is
  `update-ref -d` then `git prune --expire=now` (or `gc --prune=now`). Verified: a plain `gc` leaves
  the commit reachable because `gc.pruneExpire` defaults to two weeks.
- Lineage order lives in the ledger, not in parent pointers.
- Taken at turn begin and turn end. Cheap: `update-index --refresh` first, `write-tree` only if the
  index is dirty; reuse the previous commit when the tree is unchanged.
- Private index under the per-worktree git dir. Ledger and locks resolve through
  `--path-format=absolute --git-common-dir`, never `--git-path`.
- One normalization path: private index, `add -A`, `write-tree`, with `-c core.safecrlf=false`
  (verified: `safecrlf=true` with `text=auto` and mixed endings fails `add`).
- The snapshot tree is **not** the HEAD tree. Snapshots exclude `ENGINE_OWNED`, LFS paths, files over
  `snapshot.max_file_mb`, and nested repositories (`add -A` stages mode-160000 gitlinks otherwise).
  Comparisons are snapshot-to-snapshot only.
- Restore uses checkout semantics; mixed line endings may not return byte for byte.

## 8. Detection and classification

At each entry point compute `C`, the current map excluding `ENGINE_OWNED`, and compare with `E`.

1. `C == E`: nothing happened.
2. Otherwise diff. Per changed path: claimed by an open turn → forward progress; found in that
   path's history index → rewound; found nowhere → new content.
3. Combine. All changed paths rewound to one snapshot and `C == tree(S)` → `REWOUND`. A mix →
   `COMPOUND`. A path counts as rewound in a compound verdict only if at least two paths agree or a
   whole file returns to a recorded blob; a single coincidental match is "matches older content".
   New content outside any claim → `UNATTRIBUTED`.
4. Turns undone come from lineage order, not tree lookup: two turns can share a tree. Several
   matches → most recent, receipt marked ambiguous.
5. HEAD movement: `commit_sha` first (exists, reachable from a ref), then `AFWE-Turn-Hash` trailers
   across all refs. Present here / present on another ref only / unreachable. An `--amend` orphans
   the sha; the trailer finds the new commit and a `commit_rewritten` event caches it.
6. No-op turns are normal. A fully reverted turn and a no-op turn are identical without an
   intermediate snapshot, so a commit is never refused for this.
7. Engine-owned rewinds are healed, not receipted: `ENGINE_OWNED` is excluded from `C`, so a rollback
   of `.afwe/turns/` shows only as projection divergence. `repair` heals it and emits `rewind_healed`.
8. "Conversation probably rewound" is a heuristic AFWE cannot observe; it is a hint on a Ghost redo
   item, never a state.

Never block: a rewind writes a **Rewind Receipt** (from, to, ordered turns undone, rewound paths,
exact / ambiguous / compound). AFWE continues and a commit takes what is on disk. The next
`turn.begin` briefing carries receipts since the agent's last turn; in a hands-free loop that is the
prompter. Proposals (restore forward, revert commit with `AFWE-Rewind-Of: <turn_hash>`, accept) wait
without blocking and re-derive if the tree changes. Humans see one aggregated advisory item per
receipt, never one per file, and it is not a new queue state.

## 9. Reconcile, repair, engine-owned boundary

- The ledger is append-only; "undone" is a derived view. Turn records are projections.
- Nothing is deleted. Checks from a rewound turn go `dormant`; memory flags become events; both
  reverse when the turn is restored forward.
- `afwe repair` regenerates `ENGINE_OWNED` only (`turn.rs:36`: `.afwe/index/`, `state/`, `turns/`,
  `log/`) and never touches blueprint, memory, pins or guardrails.
- Comparisons exclude `ENGINE_OWNED`, so repair does not look like an external edit, and `E` moves in
  the same ledger commit.
- Product files under `.afwe/` are classified like code; a rewind of a memory or pin file is a rewind.

## 10. Transport, clones, forks

- Default `clone`/`fetch` carry branches and tags only. `refs/afwe/ledger/*` travels with
  `push --mirror` or an explicit refspec.
- Ship `afwe ledger push` and `afwe ledger fetch` together with
  `+refs/afwe/ledger/*:refs/afwe/ledger/*`. Snapshot refs are local only; never pushed.
- Fork rule: authority is per repository. If a fetch finds a tip that is neither ancestor nor
  descendant, write `forked`, keep both tips visible, never merge, never rewrite, never pick silently.
- Bootstrap: no local ledger and none on the remote → genesis from the tracked projection marked
  `provenance: imported`. A real ledger arriving later supersedes it (`superseded`); otherwise the
  first clone to bootstrap forks permanently.
- CI fetches the ledger refs explicitly.

## 11. Failure behaviour

| Condition | Behaviour |
|---|---|
| Ledger ref unreadable or corrupt | Refuse writes, report, keep the projection untouched. Never rebuild over it silently. |
| `ledger_version` newer than the binary | Refuse; read-only mode; tell the user to upgrade. |
| CAS collision (another worktree wrote) | Re-read tip, re-apply the event, retry up to 3 times, then report a lease-free conflict. |
| Interrupted write between `commit-tree` and `update-ref` | Dangling commit, reclaimed by `gc`. The ref still points at the last good event. |
| `repair` interrupted | Projection may be partial; the next `repair` is idempotent and re-derives from the ledger. |
| `gc` during a snapshot | Snapshot ref is written last; a pruned intermediate is a missing snapshot, reported `unavailable`. |
| Disk full mid-write | Abort before `update-ref`; no partial ledger event is visible. |
| Git unavailable | No verdict, no mutation. Never a mass undo. |

## 12. Phases and acceptance

- **P0 (landed).** `commit_sha` first, all refs, no windows, dormant instead of delete, advisory
  baseline. Commit `04c7637`.
- **P1.** Ledger refs, schema version, `project_id`, manual-mode promotion, compaction, `E` from
  `touched`, `afwe repair`, `ledger push`/`fetch`, fork rule, bootstrap. Exit: a repo with 80+ `ready`
  turns gets a populated ledger; `repair` reproduces `.afwe/turns` byte for byte; no harness names.
- **P2.** Parentless snapshots, per-path index, classification, receipts in the briefing,
  non-blocking proposals, baselines tree-based. Exit: a T3-style file revert is classified `REWOUND`
  with the right turns, and `turn commit` still succeeds.
- **P3.** Proposal UI, presence notification, retention and pruning, transport polish.

Acceptance matrix (level: `unit`, `git-fixture`, `manual`):

| # | Check | Level |
|---|---|---|
| 1 | Branch switch does not mark turns undone | git-fixture (`turn_flow`) |
| 2 | `--amend`/rebase/squash found by sha then trailer | git-fixture |
| 3 | Unreachable commit annotated, nothing deleted | unit + git-fixture |
| 4 | Restore to an older snapshot → `REWOUND`, correct turns, lineage order | git-fixture |
| 5 | Duplicate tree hashes → most recent, receipt ambiguous | unit |
| 6 | Rewind then edits → `COMPOUND`; single blob match not a rewind | unit |
| 7 | No-op turn commits `Empty`; wiped turn commits with a receipt | git-fixture |
| 8 | Receipt in next briefing; no proposal blocks a call | git-fixture |
| 9 | `text=auto`/`eol=crlf`/`autocrlf` produce the same classification; never compare to HEAD | unit |
| 10 | `safecrlf=true` + mixed endings does not fail a snapshot | unit |
| 11 | LFS, oversized, nested repos, `ENGINE_OWNED` excluded and reported | unit |
| 12 | `update-ref -d` + `prune --expire=now` reclaims; plain `gc` does not | git-fixture |
| 13 | `E` advances only at the four events | unit |
| 14 | `repair` produces no external-edit classification, touches no product file | git-fixture |
| 15 | Memory/pin rewind detected; `.afwe/turns` rollback → `rewind_healed` | git-fixture |
| 16 | `clean -fdx`/`stash -u`/`reset --hard` leave the ledger intact | git-fixture |
| 17 | Ref names valid for spaces, `..`, `~`, trailing dots, case collisions | unit |
| 18 | Linked worktrees share a ledger, separate snapshot indexes | git-fixture |
| 19 | Concurrent writers retry CAS, corrupt nothing | git-fixture (`concurrency_production`) |
| 20 | Bootstrap `imported`; later ledger `superseded`; divergence `forked` | git-fixture |
| 21 | Snapshot refs never pushed; `ledger push` sends ledger only | git-fixture |
| 22 | No-change begin snapshot under budget; thousands of refs fast after `pack-refs` | manual |
| 23 | No harness-specific names in reconcile code | unit (grep) |

## 13. Known limits

- A same-user process can edit `.git`. This protects against accidents and harness operations, not an
  adversary. CI against the pushed ledger is the real check.
- Ignored files are invisible to detection.
- Per-path evidence expires with retention; whole-map comparison does not.
- Snapshots live in the repository until pruned, are visible to ref-listing tools, and `push --mirror`
  would carry the ledger refs.
- AFWE cannot tell who rewound, which is why restoring is a proposal.
- Clones never receive snapshots; restore-forward is unavailable outside the recording repo.

## 14. Decisions (proposed)

| # | Decision | Recommendation |
|---|---|---|
| 1 | Rewind surfacing | One aggregated advisory item per receipt |
| 2 | Authority | Repository-level; clones consume; forks reported, never merged |
| 3 | Retention K | 20, revisited after metrics |
| 4 | Bootstrap | Allowed as `imported`, disposable on first real fetch |
| 5 | LFS paths | Excluded, named in the receipt |
| 6 | Manual mode | `ready` turns first-class; promotion is an event plus a projection rewrite |
| 7 | Record size | Compaction before the ledger ships |
| 8 | `E` in P1 | The existing `touched` map, not a git tree |
