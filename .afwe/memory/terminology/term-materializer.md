---
id: term-materializer
kind: terminology
title: "Materializer"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - materializer
  - tripwire
created: 2026-10-31T14:27:00Z
---
# Materializer

## Meaning
The engine component invoked via `afwe materialize` (or MCP `afwe_materialize`) that renders AFWE tripwires into native workspace files (`.git/hooks/pre-commit`, `.github/workflows/afwe-gate.yml`, native test suites, `AGENTS.md` markers, and `.afwe/checks/manifest.blake3`). It offers preview-first application (`--dry-run` by default) and rollback capabilities.

## Not to be confused with
- **afwe init**: `init` scaffolds `.afwe/`; `materialize` projects active tripwire enforcement into external files outside `.afwe/`.
