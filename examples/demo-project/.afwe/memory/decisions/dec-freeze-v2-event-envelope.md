---
id: dec-freeze-v2-event-envelope
kind: decision
title: "Freeze v2 event envelope schema"
status: accepted
applies_to:
  - "Backend/events/models"
  - "Backend/events"
  - "Backend/events/schema"
created: 2026-08-11T10:00:00Z
---

# Freeze v2 event envelope schema

All domain events published across Backend and Services must wrap payloads in the frozen v2 event envelope.
