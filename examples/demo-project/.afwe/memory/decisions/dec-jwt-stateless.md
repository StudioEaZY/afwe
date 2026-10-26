---
id: dec-jwt-stateless
kind: decision
title: "Stateless JWT access tokens"
status: accepted
applies_to:
  - jwt-signer
  - session-token
created: 2026-10-24T12:00:00Z
---

# Stateless JWT access tokens

Access tokens are signed statelessly with 15-minute expiration; sessions table only stores refresh tokens.
