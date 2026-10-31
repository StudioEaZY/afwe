---
id: term-dropped-capability
kind: terminology
title: "DROPPED_CAPABILITY"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - ratchet
  - gate-error
created: 2026-10-31T14:27:00Z
---
# DROPPED_CAPABILITY

## Meaning
A blocking commit gate error triggered when an intra-file public export or capability is deleted or privatized without an explicit removal or replacement declared in `turn assume` (`removes: [...]` or `action: remove / replace`).

## Not to be confused with
- **SEVERED_CAPABILITY**: DROPPED_CAPABILITY occurs when the public export itself disappears; SEVERED_CAPABILITY occurs when external callers are disconnected.
