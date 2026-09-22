---
id: renderer-strategy
kind: decision
title: 'Renderer strategy: one CanvasRenderer, reused'
status: accepted
applies_to:
- canvas-renderer
- workspace-preview
tags:
- rendering
- reuse
origin: human
created: 2026-09-22
---

## Decision
`CanvasRenderer` is the single frame-based renderer. Workspace previews reuse it rather than
owning a lighter renderer.

## Reason
Two renderers drifted apart in a previous prototype (3 apps inside the same app). One renderer,
one set of bugs.

## Trade-off
Previews carry a little unused interactivity code.
