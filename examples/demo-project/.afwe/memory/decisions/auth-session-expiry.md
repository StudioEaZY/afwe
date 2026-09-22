---
id: auth-session-expiry
kind: decision
title: Session expiry is 30 minutes, server-side
status: accepted
applies_to:
- sessions
symbols:
- src/auth/session.ts::SESSION_TTL_MS
tags:
- auth
- security
origin: human
created: 2026-09-22
---

## Decision
Sessions expire 30 minutes after creation (`SESSION_TTL_MS`), enforced server-side; there is no sliding window.

## Reason
Compliance requirement from the payments provider; sliding sessions were rejected in review.

## Trade-off
Users get logged out mid-task after 30 minutes. Accepted.
