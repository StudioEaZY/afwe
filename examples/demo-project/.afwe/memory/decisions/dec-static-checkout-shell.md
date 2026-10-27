---
id: dec-static-checkout-shell
kind: decision
title: "Adopt incremental static shell for checkout"
status: accepted
applies_to:
  - "Web"
  - "Web/views"
  - "Web/views/checkout"
created: 2026-08-19T10:00:00Z
---

# Adopt incremental static shell for checkout

Use incremental static regeneration for the checkout shell while keeping cart mutations on versioned Backend API routes.
