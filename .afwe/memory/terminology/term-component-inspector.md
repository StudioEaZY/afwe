---
id: term-component-inspector
kind: terminology
title: "Component Inspector"
status: accepted
applies_to:
  - studio
  - studio-inspector
tags:
  - studio-panel
  - inspector
created: 2026-10-31T19:50:00Z
---
# Component Inspector

## Meaning
The contextual metadata panel in AFWE Studio (`ComponentInspector.tsx` and `NodeInspector.tsx`) activated upon selecting any node or relation. It renders live purpose statements, implementation file/symbol mappings, caller counts, attached active guardrails, ADR decisions, bookmarks, and structural edit controls (`move`, `relate`, `constrain`).

## Not to be confused with
- **Micro-Context**: Micro-context is the formatted markdown context delivered to coding agents before editing; the Component Inspector is the visual GUI interface for developers in Studio.
