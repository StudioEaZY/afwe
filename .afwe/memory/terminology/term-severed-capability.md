---
id: term-severed-capability
kind: terminology
title: "SEVERED_CAPABILITY"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - ratchet
  - gate-error
created: 2026-10-31T14:27:00Z
---
# SEVERED_CAPABILITY

## Meaning
A blocking commit gate error triggered when cross-module caller severance drops inbound references to an exported function or struct from >0 to 0, turning previously consumed functionality into dead code without declared intent.

## Not to be confused with
- **DEAD_ON_ARRIVAL**: SEVERED_CAPABILITY affects previously used code that lost its callers; DEAD_ON_ARRIVAL affects newly introduced code that was never called.
