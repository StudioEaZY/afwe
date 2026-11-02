---
id: term-human-floor
kind: terminology
title: Human Floor
status: accepted
applies_to:
- afwe-core
- afwe-cli
tags:
- authority
- governance
origin: human
created: 2026-10-31
---

# Human Floor

## Meaning

Non-delegable invariants and policy thresholds that cannot be auto-approved or bypassed by any delegated agent prompter, regardless of active delegation budgets.

## Human Floor Triggers (R8)

## Meaning
- Changes touching policy pins or root architecture governance.
- Large blast radius operations crossing multiple major subsystem boundaries.
- Remediations outside the narrow self-heal allowlist.
- Authority mode changes or lease delegation grants.

When a turn triggers a human floor, it is parked as `STAGED` with `requires_human: true`. The orchestrator agent skips the turn and continues its loop without stalling.
