---
id: term-spatial-drag-clamping
kind: terminology
title: "Spatial Drag Clamping"
status: accepted
applies_to:
  - studio
  - studio-maps
tags:
  - studio-physics
  - interaction
created: 2026-10-31T19:50:00Z
---
# Spatial Drag Clamping

## Meaning
A bounding box and physics constraint mechanism in Studio Constellation and Topology maps that clamps manual node dragging within bounded spatial regions. It prevents developers from accidentally flinging nodes into infinite virtual coordinates or breaking parent cluster gravity.

## Not to be confused with
- **Auto-Layout**: Auto-layout computes resting node coordinates automatically; Spatial Drag Clamping bounds human interactive dragging within reasonable limits.
