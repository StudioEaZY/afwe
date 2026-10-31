---
id: term-turn-receipt
kind: terminology
title: "Turn Receipt"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - turn-protocol
  - provenance
created: 2026-10-31T14:27:00Z
---
# Turn Receipt

## Meaning
The immutable record produced upon turn commit, saved in `.afwe/turns/tNNNN.yaml`. It contains the original prompt verbatim, origin, timing, gate evaluation, intent updates, files modified, checks executed, capability ratchets checked, and Git commit hash.

## Not to be confused with
- **Intent**: The turn receipt is an immutable audit receipt of a single execution; intents are living state documents that evolve over time.
