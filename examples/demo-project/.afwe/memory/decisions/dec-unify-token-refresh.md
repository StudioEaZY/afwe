---
id: dec-unify-token-refresh
kind: decision
title: "Unify token refresh in Shared/auth"
status: accepted
applies_to:
  - "Mobile"
  - "Backend/auth"
created: 2026-07-04T10:00:00Z
---

# Unify token refresh in Shared/auth

Mobile and Web clients share a single exponential-backoff token refresh state machine.
