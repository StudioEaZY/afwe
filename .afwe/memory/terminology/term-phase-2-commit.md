---
id: term-phase-2-commit
kind: terminology
title: "Phase 2 (Gated Commit)"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - turn-protocol
  - verification
  - gate
created: 2026-10-31T14:27:00Z
---
# Phase 2 (Gated Commit)

## Meaning
The final gated commit phase invoked via `afwe turn commit <turn> --summary "..." [--token <tok>]`. AFWE isolates working changes via Git plumbing trees with Content-Addressable Storage (CAS) verification and advisory OS commit locks, executing the gate against active pins, claims, and capability ratchets before recording the turn in `.afwe/turns/` and emitting an `AFWE-Turn:` trailer.

## Not to be confused with
- **git commit -m**: Standard git commit operates without architectural validation; AFWE turn commit acts as a compiler gate enforcing capability preservation and intent adherence.
