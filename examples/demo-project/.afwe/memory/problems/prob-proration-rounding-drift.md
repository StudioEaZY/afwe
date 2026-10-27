---
id: prob-proration-rounding-drift
kind: problem
title: "Sub-cent rounding discrepancies across multiple mid-month seat changes"
status: accepted
applies_to:
  - "Services/billing"
created: 2026-10-24T12:00:00Z
---

# Sub-cent rounding discrepancies across multiple mid-month seat changes

Repeated seat addition and removal in the same hour can drift by +/- 1 cent due to integer floor arithmetic.
