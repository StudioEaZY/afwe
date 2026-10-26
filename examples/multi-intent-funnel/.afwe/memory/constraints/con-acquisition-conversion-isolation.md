---
id: con-acquisition-conversion-isolation
kind: constraint
title: "Decouple acquisition slides from checkout"
status: accepted
applies_to:
  - acquisition-stage
  - conversion-stage
created: 2026-10-24T12:00:00Z
---

# Decouple acquisition slides from checkout

Acquisition slides (Slide1, Slide2) must never import payment gateways or charge functions to preserve sub-second initial bundle load.
