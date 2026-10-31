---
id: term-baseline
kind: terminology
title: "Ratchet Baseline"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - ratchet
  - baseline
created: 2026-10-31T14:27:00Z
---
# Ratchet Baseline

## Meaning
A snapshot mechanism (`afwe baseline snapshot`) used when onboarding legacy codebases to grandfather pre-existing violations, uncalled exports, or circular imports without failing the gate. The gate prevents any *new* regressions from being introduced beyond the recorded baseline.

## Not to be confused with
- **Ratchet**: The ratchet is the monotonic enforcement rule; the baseline is the grandfathered zero-point snapshot.
