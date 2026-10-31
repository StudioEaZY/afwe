---
id: term-claim
kind: terminology
title: "Claim"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - claims
  - pre-generation
created: 2026-10-31T14:27:00Z
---
# Claim

## Meaning
A pre-generation assertion declared during Phase 1 (`afwe turn assume`) before code is written. Claims include:
- `forbid_import`: prevents illegal cross-node imports.
- `forbid_symbol`: disallows blacklisted symbols or deprecated constructs.
- `export_exists`: guarantees expected public functions or types remain exposed.
- `symbol_signature`: verifies parameter and return types match contract specifications.
- `pattern`: applies regex checks with automatic comment blanking.
- `command`: executes a shell test command.
- File Claims: locks specific files to avoid concurrent edit collisions.

## Not to be confused with
- **Intent**: Intent states what behavior is desired; a Claim states concrete structural boundaries that code must satisfy.
