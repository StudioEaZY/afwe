---
id: term-turn-abandon
kind: terminology
title: "Turn Abandon"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - turn-protocol
  - recovery
created: 2026-10-31T14:27:00Z
---
# Turn Abandon

## Meaning
A turn cancellation command (`afwe turn abandon <turn>`) that discards an open uncommitted turn, immediately releasing all file claims, locks, and temporary token reservations without altering the Git tree.

## Not to be confused with
- **Turn Redo**: Abandon terminates the turn completely; Redo resets the workspace but preserves the open turn session.
