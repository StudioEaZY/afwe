---
id: con-workspace-billing-boundary
kind: constraint
title: "Decoupling workspace from billing"
status: accepted
applies_to:
  - "Core"
  - "Services/billing"
created: 2026-10-24T12:00:00Z
---

# Decoupling workspace from billing

Workspace library code must never import Stripe or checkout controllers. Feature gating happens in the HTTP server layer.
