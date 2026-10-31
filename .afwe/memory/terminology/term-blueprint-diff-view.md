---
id: term-blueprint-diff-view
kind: terminology
title: "Blueprint Diff View"
status: accepted
applies_to:
  - studio
  - studio-timeline
tags:
  - studio-view
  - blueprint
  - diff
created: 2026-10-31T19:50:00Z
---
# Blueprint Diff View

## Meaning
A dedicated architectural visualizer in Studio Timeline (`TimelinePage.tsx`) that renders the structural delta between two turns or branches. It color-codes added nodes/relations (green), modified boundaries (amber), and removed entities (red), complementing textual source code diffs with structural architecture diffs.

## Not to be confused with
- **Code Diff Viewer**: Code Diff Viewer inspects textual line modifications in files; Blueprint Diff View inspects structural graph modifications in the architecture tree.
