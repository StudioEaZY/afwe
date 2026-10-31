---
id: term-check
kind: terminology
title: "Check"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - checks
  - gate
created: 2026-10-31T14:27:00Z
---
# Check

## Meaning
An executable verification item registered in `.afwe/checks/*.yaml` evaluated during `afwe verify` and `afwe turn commit`. Checks possess trust ratings, explicit authorship (human, generator, agent), and deterministic pass/fail semantics.

## Not to be confused with
- **Claim**: A Claim is an assertion declared during `turn assume`; once registered or graduated, it becomes an enforced Check in the registry.
