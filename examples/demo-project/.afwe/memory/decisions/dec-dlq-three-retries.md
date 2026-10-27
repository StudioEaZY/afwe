---
id: dec-dlq-three-retries
kind: decision
title: "Dead-letter queue after 3 failed deliveries"
status: accepted
applies_to:
  - "Backend/events/handlers"
  - "Infrastructure/queues"
created: 2026-08-14T10:00:00Z
---

# Dead-letter queue after 3 failed deliveries

Event handlers must be idempotent and route poison messages to the DLQ after 3 delivery attempts.
