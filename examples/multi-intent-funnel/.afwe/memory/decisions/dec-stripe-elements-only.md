---
id: dec-stripe-elements-only
kind: decision
title: "Zero raw credit card field handling"
status: accepted
applies_to:
  - stripe-checkout
created: 2026-10-24T12:00:00Z
---

# Zero raw credit card field handling

To maintain PCI SAQ A eligibility, card fields never touch our application bundle; Stripe Elements iframe handles input.
