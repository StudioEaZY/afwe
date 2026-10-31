---
id: term-probing-guide
kind: terminology
title: "Probing Guide"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - confidence-bands
  - advisory
created: 2026-10-31T14:27:00Z
---
# Probing Guide

## Meaning
An advisory architectural hint emitted in Phase 0 briefings with 85%–90% confidence (`[GUIDE - ADVISORY]`). Probing guides steer the agent toward emerging architectural patterns without hard-blocking execution. When repeatedly adhered to, probing guides graduate into active deterministic checks via `afwe guide graduate`.

## Not to be confused with
- **Active Check**: Active checks block the commit gate; Probing Guides are non-blocking advisory steering.
- **Ambiguity Question**: Questions have <85% confidence and require human decision; Probing Guides have 85%–90% confidence and steer agents automatically.
