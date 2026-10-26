---
id: con-activation-headless-events
kind: constraint
title: "Activation slide telemetry abstraction"
status: accepted
applies_to:
  - activation-stage
  - telemetry-stage
created: 2026-10-24T12:00:00Z
---

# Activation slide telemetry abstraction

Activation step widgets must emit events via domain dispatchers and never access low-level sink instances directly.
