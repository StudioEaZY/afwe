---
id: term-sub-turn
kind: terminology
title: "Sub-Turn"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - turn-protocol
  - sub-turn
  - remediation
created: 2026-10-31T19:50:00Z
---
# Sub-Turn

## Meaning
A granular, child execution unit operating underneath a parent turn (formatted as `<parent_turn>.<n>`, e.g., `t0046.1`). Sub-turns are used for atomic remediation actions such as Narrow Self-Heal file restorations (`afwe heal restore`), staged sub-steps within an autonomous multi-agent Mission, or isolated micro-commits that maintain cryptographic linkage to the parent turn without re-running full briefing packs.

## Not to be confused with
- **Turn**: A top-level Turn spans an entire developer prompt; a Sub-Turn is a child transaction executing a mechanical remediation or sub-task of that turn.
- **Git Commit**: While a sub-turn produces a Git tree object, it is tagged as a subordinate turn step in the AFWE audit ledger.
