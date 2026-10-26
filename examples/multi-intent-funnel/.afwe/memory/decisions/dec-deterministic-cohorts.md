---
id: dec-deterministic-cohorts
kind: decision
title: "Deterministic A/B cohort assignment"
status: accepted
applies_to:
  - ab-cohort-router
created: 2026-10-24T12:00:00Z
---

# Deterministic A/B cohort assignment

We use Murmur3 / polynomial string hashing over random Math.random() so cohort allocation survives across server and client boundaries.
