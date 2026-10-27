---
id: con-secret-entropy
kind: constraint
title: "32-byte secret entropy requirement"
status: accepted
applies_to:
  - "Backend/auth"
created: 2026-10-24T12:00:00Z
---

# 32-byte secret entropy requirement

Cryptographic operations reject any secret with fewer than 32 characters or low entropy.
