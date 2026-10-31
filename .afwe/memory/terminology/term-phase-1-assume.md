---
id: term-phase-1-assume
kind: terminology
title: "Phase 1 (Pre-Code Declaration)"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - turn-protocol
  - intent-declaration
created: 2026-10-31T14:27:00Z
---
# Phase 1 (Pre-Code Declaration)

## Meaning
The pre-code declaration phase invoked via `afwe turn assume <turn> --file <json> [--token <tok>]`. Before any code is generated or edited, the agent explicitly registers its architectural intents, file claims, and pre-generation AST assertions (`forbid_import`, `forbid_symbol`, `export_exists`, `symbol_signature`, `pattern`, `command`). Intentional removals must be declared in `removes` to satisfy the strict "Rust for project intent" compiler model.

## Not to be confused with
- **Phase 2 (turn commit)**: Assume declares expectations before writing code; commit verifies compliance and writes Git trees after code is complete.
