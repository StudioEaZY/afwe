---
id: term-dead-on-arrival
kind: terminology
title: "DEAD_ON_ARRIVAL"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - ratchet
  - gate-error
created: 2026-10-31T14:27:00Z
---
# DEAD_ON_ARRIVAL

## Meaning
A blocking commit gate error triggered when a newly introduced exported function or capability is born with 0 callers and no tests exercising it, without an explicit intent declaration.

## Not to be confused with
- **DROPPED_CAPABILITY**: DROPPED_CAPABILITY is an export that was deleted; DEAD_ON_ARRIVAL is a new export that was created but left orphaned and unused.
