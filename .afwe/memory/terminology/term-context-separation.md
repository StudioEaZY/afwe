---
id: term-context-separation
kind: terminology
title: "Context Codename Separation"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - architecture-philosophy
  - repository-rules
created: 2026-10-31T14:27:00Z
---
# Context Codename Separation

## Meaning
The strict architectural separation governing AFWE development between two distinct contexts:
1. **AFWE-Core**: This engine repository, its Rust crates (`afwe-core`, `afwe-cli`), binaries, MCP server, Studio, and master documentation in `docs/` and `crates/`.
2. **AFWE-Client**: Consumer codebases initialized with `afwe init` or `afwe onboard`, whose scaffolds and templates live inside `.afwe/`. Client docs and generator templates must always reference `.afwe/docs/TUTORIAL.md`, never root `docs/`.

## Not to be confused with
- **Client/Server Networking**: This is not a network protocol; it is an architectural contract distinguishing engine authoring from client consumer scaffolding.
