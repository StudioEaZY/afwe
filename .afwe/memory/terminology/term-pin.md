---
id: term-pin
kind: terminology
title: "Pin"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - pins
  - governance
created: 2026-10-31T14:27:00Z
---
# Pin

## Meaning
A human-locked architectural decision or intentional bug stored in `.afwe/pins/*.yaml`. Pins represent immutable boundaries that automated agents and refactorings are strictly forbidden from breaking or deleting without an explicit override `{pin, reason}`. Pins are capped under a codebase-scaled budget to prevent architectural ossification.

## Not to be confused with
- **Guardrail**: Guardrails are automated passive contexts or active checks; Pins are human-locked authoritative invariants that cannot be altered without human override.
- **Decision (Memory)**: An ADR in memory documents reasoning; a Pin actively blocks the gate from passing if violated.
