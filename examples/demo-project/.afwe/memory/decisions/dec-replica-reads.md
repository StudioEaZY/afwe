---
id: dec-replica-reads
kind: decision
title: "Eventual consistency for status widgets"
status: accepted
applies_to:
  - realtime-status-worker
created: 2026-10-24T12:00:00Z
---

# Eventual consistency for status widgets

Realtime status worker queries read replicas. Occasional 500ms staleness is accepted to isolate primary DB load.
