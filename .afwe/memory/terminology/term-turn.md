---
id: term-turn
kind: terminology
title: "Turn"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - turn-protocol
  - core-lifecycle
created: 2026-10-31T14:27:00Z
---
# Turn

## Meaning
A discrete, atomic engineering lifecycle unit spanning exactly one prompt ("one prompt = one turn"). A turn progresses sequentially through three deterministic phases: Phase 0 (`afwe turn begin`) pre-planning briefing, Phase 1 (`afwe turn assume`) pre-code intent and claims declaration, and Phase 2 (`afwe turn commit`) post-verification gated commit via isolated Git plumbing trees with CAS verification.

## Not to be confused with
- **Intent**: An Intent is a living, persistent statement of architectural purpose and desire. A Turn is a single transactional execution step that implements or updates intents.
- **Git Commit**: A Git commit is a low-level VCS snapshot. An AFWE Turn produces an isolated tree commit tagged with an `AFWE-Turn:` trailer only after passing through the full architectural gate, intent alignment, and capability ratchets.
