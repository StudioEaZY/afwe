---
id: term-ledger-fork
kind: terminology
title: Ledger Fork
status: accepted
applies_to:
- afwe-core
tags:
- ledger
- transport
- fork
origin: llm:deepseek-flash
created: 2026-11-02
---

# Ledger Fork

## Meaning
The recorded condition where a fetched ledger tip is neither an ancestor nor a descendant of the
local tip. Authority is per repository, so AFWE writes a `forked` event carrying both tips, keeps the
incoming ref visible, and never merges, rewrites, or silently chooses one chain.

## Behavior
- A fast-forward is not a fork: it adopts the incoming tip and reports `relation: behind`.
- Divergence reports `relation: diverged` and leaves the local chain authoritative for this clone.
- Bootstrap is separate: a repository with no ledger imports its tracked turn projection once,
  marked `provenance: imported`, and a later real ledger supersedes it.

## Not to be confused with
- **Git fork**: a copy of a repository, which says nothing about ledger authority.
- **Branch divergence**: branches are not ledger refs and never enter this decision.
