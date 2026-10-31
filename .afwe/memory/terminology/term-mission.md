---
id: term-mission
kind: terminology
title: "Mission"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - multi-agent
  - coordination
created: 2026-10-31T14:27:00Z
---
# Mission

## Meaning
A goal-oriented coordination structure stored in `.afwe/missions/*.yaml` that orchestrates multiple autonomous agents across isolated Git worktrees. Missions break complex epics into discrete turn obligations, managing concurrency leases, shared node boundaries, and merge gates.

## Not to be confused with
- **Turn**: A Turn is executed by a single agent for a single prompt; a Mission coordinates multiple agents and turns toward a composite outcome.
