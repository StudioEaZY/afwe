---
id: term-blueprint
kind: terminology
title: "Blueprint"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - blueprint
  - architecture-tree
created: 2026-10-31T14:27:00Z
---
# Blueprint

## Meaning
The deterministic hierarchical architecture tree defining the product's structure, declared across `afwe.yaml` and `.afwe/blueprint/` (`blueprint.yaml`, `relations.yaml`, `constraints.yaml`). It maps code files and symbols to architectural nodes, defines permitted relationships, and sets boundaries.

## Not to be confused with
- **Index**: The index is derived AST metadata generated from code files; the Blueprint is the authoritative structural reality that code is measured against.
