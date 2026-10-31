---
id: term-explore-mode
kind: terminology
title: "Explore Mode"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - explore-mode
  - prototyping
created: 2026-10-31T14:27:00Z
---
# Explore Mode

## Meaning
A temporary mode activated via `afwe unlock --reason "..."` that downgrades blocking active checks and capability ratchets into non-blocking warnings during active exploratory refactoring or rapid prototyping. The harness must re-arm the gate before release via `afwe lock`, which triggers full architecture verification.

## Not to be confused with
- **Bypassing the Gate**: Explore Mode does not disable detection; it downgrades errors to warnings temporarily while recording the explicit reason in the log.
