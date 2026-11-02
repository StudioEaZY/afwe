---
id: term-expected-tree
kind: terminology
title: Expected Tree
status: accepted
applies_to:
- afwe-core
tags:
- rewind
- ledger
origin: llm:deepseek-flash
created: 2026-11-02
---

# Expected Tree (E)

## Meaning
The path to content-hash map the ledger expects the working tree to have. `E` advances only at four
events: turn begin, turn end or commit, `afwe repair`, and acceptance of a rewind proposal. Any
difference between `E` and the current tree is drift, recorded once and then adopted so it is not
re-reported.

## Not to be confused with
- **Turn baseline**: the pre-commit hashes of a single turn, used for the advisory rewind check.
- **Snapshot**: recorded file bytes kept for restore, which arrives in P2.
