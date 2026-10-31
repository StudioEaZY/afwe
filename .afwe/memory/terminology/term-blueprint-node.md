---
id: term-blueprint-node
kind: terminology
title: "Blueprint Node"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - blueprint
  - topology
created: 2026-10-31T14:27:00Z
---
# Blueprint Node

## Meaning
An architectural entity within the Blueprint tree representing a product, subsystem, module, or component. Each node has an ID, human-readable name, purpose statement, implementation mapping (file globs and symbols), status (`active`, `planned`, `deprecated`, `uncharted`), and architectural boundaries.

## Not to be confused with
- **File / Directory**: A node is a logical concept. While it maps to files, multiple files can form one module node, or a single file can contain multiple component symbols.
