---
id: term-contention
kind: terminology
title: "Contention"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - multi-agent
  - concurrency
created: 2026-10-31T14:27:00Z
---
# Contention

## Meaning
A concurrency conflict state returned when an agent attempts to begin a turn or acquire claims/leases on files or blueprint nodes already held by another active agent session. When contention occurs, the agent must defer, release overlapping claims, or coordinate via mission boundaries rather than overwriting concurrently.

## Not to be confused with
- **Merge Conflict**: Git merge conflict occurs after text has diverged; Contention is preemptively prevented before code generation starts.
