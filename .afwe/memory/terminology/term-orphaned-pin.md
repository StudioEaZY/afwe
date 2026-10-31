---
id: term-orphaned-pin
kind: terminology
title: "ORPHANED_PIN"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - ratchet
  - pins
  - gate-error
created: 2026-10-31T14:27:00Z
---
# ORPHANED_PIN

## Meaning
A commit gate error triggered when a human-locked pin in `.afwe/pins/` targets architectural nodes, files, or symbols that no longer exist in the working tree. Pins require explicit human override or retirement.

## Not to be confused with
- **ORPHANED_DECISION**: ORPHANED_PIN involves human-locked invariant pins; ORPHANED_DECISION involves persistent ADR memory records.
