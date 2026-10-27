---
id: exc-billing-test-bypass
kind: exception
title: "Exception: Local sandbox bypass for stripe webhook signature"
status: accepted
applies_to:
  - "Services/billing"
created: 2026-10-24T12:00:00Z
---

# Exception: Local sandbox bypass for stripe webhook signature

In NODE_ENV=development, webhook signature HMAC check may be skipped if STRIPE_MOCK=true.
