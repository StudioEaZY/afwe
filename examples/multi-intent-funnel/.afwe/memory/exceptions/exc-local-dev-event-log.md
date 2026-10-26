---
id: exc-local-dev-event-log
kind: exception
title: "Exception: Console event logging permitted in development mode"
status: accepted
applies_to:
  - behavioral-event-sink
created: 2026-10-24T12:00:00Z
---

# Exception: Console event logging permitted in development mode

Event sink logs dispatched telemetry payloads to browser console if NODE_ENV !== 'production'.
