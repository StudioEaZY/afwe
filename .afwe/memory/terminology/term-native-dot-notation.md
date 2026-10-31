---
id: term-native-dot-notation
kind: terminology
title: "Native Dot Notation"
status: accepted
applies_to:
  - afwe-core
  - studio
  - afwe-cli
tags:
  - syntax
  - node-addressing
created: 2026-10-31T19:50:00Z
---
# Native Dot Notation

## Meaning
The canonical hierarchical address syntax (e.g., `afwe.Core.Analyze` or `project.Billing.Checkout`) used natively across AFWE Studio maps, CLI arguments, and engine queries. It mirrors namespace notation in modern languages, replacing fragile filesystem slash paths (`afwe/core/analyze`) with stable architectural node identities.

## Not to be confused with
- **File System Paths**: File system paths (`src/billing/checkout.ts`) locate files on disk; Native Dot Notation addresses abstract Blueprint nodes regardless of file moves.
