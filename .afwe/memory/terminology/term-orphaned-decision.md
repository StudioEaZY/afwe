---
id: term-orphaned-decision
kind: terminology
title: "ORPHANED_DECISION"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - ratchet
  - memory
  - gate-error
created: 2026-10-31T14:27:00Z
---
# ORPHANED_DECISION

## Meaning
A commit gate error triggered when an architectural decision record in `.afwe/memory/decisions/` is anchored to files or symbols that have been deleted or moved without updating or superseding the decision.

## Not to be confused with
- **ORPHANED_PIN**: ORPHANED_DECISION applies to ADR memory; ORPHANED_PIN applies to human-locked pins in `.afwe/pins/`.
