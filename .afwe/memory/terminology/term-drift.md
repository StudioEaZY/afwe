---
id: term-drift
kind: terminology
title: "Drift"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - drift
  - reconciliation
created: 2026-10-31T14:27:00Z
---
# Drift

## Meaning
Any disagreement between the physical codebase (analyzed files, AST imports, symbol definitions) and the Blueprint tree. Detected via `afwe drift` or during `afwe sync`. Disagreements are triaged by confidence:
- Confidence >= 90%: auto-reconciled.
- Confidence 50%–90%: presented as soft changes.
- Confidence < 50% or structural changes: staged as proposals awaiting human confirmation.

## Not to be confused with
- **Constraint Violation**: A constraint violation is an active rule failure (e.g., forbidden import); Drift is an unmapped or shifted structural divergence between code and blueprint.
