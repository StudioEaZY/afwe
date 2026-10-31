---
term: Narrow Self-Heal
kind: concept
status: canonical
context: core-and-client
---

# Narrow Self-Heal

A strictly bounded, recorded sub-turn remediation mechanism where AFWE executes mechanical corrective actions without authoring new source code.

## Section 0 Scope Boundary
- **Restores of Dropped Files**: Restoring an unchanged file from recorded baseline bytes is allowlisted because no foreign bytes are introduced (derivability check passes).
- **Sub-Turn Audit Trail**: Executed as a recorded child turn `<parent_turn>.1` with CAS validation and an explicit undo recipe.
- **Out of Scope**: Severed capabilities (missing wiring), semantic merges of modified files, and autonomous source generation are strictly forbidden inside `afwe-core`.
