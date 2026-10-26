---
id: con-idempotency-key-mandatory
kind: constraint
title: "Mandatory idempotency keys on payment operations"
status: accepted
applies_to:
  - billing-checkout
  - stripe-gateway
created: 2026-10-24T12:00:00Z
---

# Mandatory idempotency keys on payment operations

Double billing prevention requires an idempotency key hashed from client UUID and payload hash.
