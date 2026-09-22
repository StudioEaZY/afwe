---
id: lighthouse-exception
kind: decision
title: Lighthouse exception for Dashboard
status: accepted
applies_to:
- dashboard
- canvas-renderer
files:
- src/dashboard/**
- src/canvas/CanvasRenderer.tsx
symbols:
- src/canvas/CanvasRenderer.tsx::CanvasRenderer.render
tags:
- performance
- intentional-exception
origin: human
created: 2026-09-22
---

## Decision
Do not optimize Lighthouse score for this subsystem.

## Reason
Interactive rendering is intentionally prioritized. The dashboard is a live canvas; users
judge it by frame latency, not by first-contentful-paint.

## Trade-off
Lower Lighthouse performance score on /dashboard.

## Status
Accepted architectural exception. This does **not** mean Lighthouse is irrelevant forever —
it means there is a known decision explaining why this implementation behaves this way.
