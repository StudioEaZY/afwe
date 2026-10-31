---
id: term-bearer-token
kind: terminology
title: Bearer Token
tags: [terminology, security, authentication, protocol]
date: 2026-10-31
---

# Bearer Token

### Definition
An ephemeral, cryptographically random secret token generated at `afwe turn begin` and scoped to the active Turn lifecycle.

### Why it Matters
The Bearer Token ensures that only the authorized agent or process that initiated a Turn can assume intents, renew leases, or commit changes for that Turn. It guards against unauthorized writes, cross-subagent interference, and hijacked mutation workflows in multi-agent environments.

### Example in Practice
When an agent starts a Turn via `afwe turn begin "Refactor auth"`, AFWE issues a bearer token embedded in the briefing pack JSON response. Subsequent calls to `afwe turn assume` and `afwe turn commit` validate this token before granting state modifications.
