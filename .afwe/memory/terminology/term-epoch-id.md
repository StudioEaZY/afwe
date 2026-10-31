---
id: term-epoch-id
kind: terminology
title: Epoch ID
tags: [terminology, lifecycle, orchestration, concurrency]
date: 2026-10-31
---

# Epoch ID

### Definition
A monotonically incrementing or timestamped logical grouping identifier that clusters related Turns, sub-turns, and missions within a shared high-level objective.

### Why it Matters
When multiple agents or automated pipelines run in parallel across decoupled branches or worktrees, the Epoch ID enables collective rollbacks, cross-turn synchronization points, and coherent telemetry collation across all active worker instances.

### Example in Practice
An autonomous testing campaign might spin up four subagents across an Epoch tagged `epoch-20261031-1900`. If one subagent discovers an invariant breach, the orchestrator uses the Epoch ID to cancel or quarantine all active sub-turns associated with that mission cluster.
