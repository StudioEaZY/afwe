---
id: term-lease
kind: terminology
title: "Concurrency Lease"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - multi-agent
  - concurrency
created: 2026-10-31T14:27:00Z
---
# Concurrency Lease

## Meaning
A mutual exclusion mechanism (`afwe lease acquire <node>`) that grants temporary exclusive write permissions on specific Blueprint nodes and their mapped files to an agent or worktree, preventing concurrent agents from generating conflicting changes.

## Not to be confused with
- **File Claim**: A File Claim operates at the individual file path level during a turn; a Concurrency Lease operates at the architectural node level across multiple worktrees and missions.
