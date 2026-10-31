---
id: term-blueprint-view
kind: terminology
title: "Blueprint View"
status: accepted
applies_to:
  - studio
  - studio-maps
tags:
  - studio-view
  - visualization
  - blueprint
created: 2026-10-31T19:50:00Z
---
# Blueprint View

## Meaning
The primary structural graph visualizer in AFWE Studio (powered by `GraphView.tsx` and ReactFlow) rendering the Blueprint tree in balanced, tiered vertical strata. It features perimeter port distribution to eliminate edge overlap, switchable edge routing geometry (bezier, smoothstep, orthogonal), spacebar hand pan navigation, and progressive leaf disclosure.

## Not to be confused with
- **Blueprint (Concept)**: The Blueprint is the authoritative tree data structure in `.afwe/blueprint/`; the Blueprint View is the interactive graphical representation inside Studio.
- **Topology View**: Blueprint View highlights parent-child structural ownership; Topology View highlights inter-module import and caller dependencies.
