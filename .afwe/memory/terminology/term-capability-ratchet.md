---
id: term-capability-ratchet
kind: terminology
title: "Capability Ratchet"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - ratchet
  - verification
  - gate
created: 2026-10-31T14:27:00Z
---
# Capability Ratchet

## Meaning
A monotonic architectural safety mechanism enforced during `afwe turn commit`. It guarantees that codebase capabilities, public API exports, caller references, decisions, and documentation references can only advance or remain stable—never unintentionally degrade. Intentionally breaking a capability requires an explicit declaration in `turn assume`.

## Not to be confused with
- **Unit Testing**: Unit tests check functional runtime correctness; Capability Ratchets check static architectural reachability, export continuity, and reference graphs.
