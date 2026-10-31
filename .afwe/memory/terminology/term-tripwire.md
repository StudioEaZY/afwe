---
id: term-tripwire
kind: terminology
title: "Tripwire"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - tripwire
  - materializer
created: 2026-10-31T14:27:00Z
---
# Tripwire

## Meaning
A deterministic, preview-first defensive layer materialized directly into developer and CI harnesses (git hooks, GitHub Actions CI gates, native unit test harnesses, AGENTS.md blocks, and BLAKE3 manifests). Tripwires intercept architectural regressions outside of AFWE commands.

## Not to be confused with
- **Passive Guardrail**: Passive guardrails advise the agent during context loading; Tripwires hard-block git commits, pushes, and CI builds if invariants fail.
