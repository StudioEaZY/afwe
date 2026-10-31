---
id: term-docs-drift
kind: terminology
title: "DOCS_DRIFT"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - ratchet
  - documentation
  - gate-error
created: 2026-10-31T14:27:00Z
---
# DOCS_DRIFT

## Meaning
A commit gate error triggered when markdown documentation files (`README.md`, `docs/*.md`, `.afwe/docs/*.md`) contain broken links to code files, outdated symbol paths, or deleted source files.

## Not to be confused with
- **Drift**: Blueprint drift is code-to-blueprint divergence; DOCS_DRIFT is documentation-to-code divergence.
