---
id: term-the-folder-is-the-product
kind: terminology
title: "The Folder is the Product"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - architecture-philosophy
  - persistent-model
created: 2026-10-31T14:27:00Z
---
# The Folder is the Product

## Meaning
The core tenet of AFWE stating that `.afwe/` itself is the persistent, tool-agnostic structural model of the project. The engine that reads and writes it (CLI, MCP, Studio) is completely replaceable; the folder, its yaml files, markdown memory, and git history remain the durable single source of architectural truth.

## Not to be confused with
- **Ephemeral Cache or Lockfile**: `.afwe/` (excluding gitignored `index/` and `state/`) is committed to version control and represents the living architecture of the codebase.
