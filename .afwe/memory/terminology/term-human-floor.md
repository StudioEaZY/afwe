---
term: Human Floor
kind: concept
status: canonical
context: core-and-client
---

# Human Floor

Non-delegable invariants and policy thresholds that cannot be auto-approved or bypassed by any delegated agent prompter, regardless of active delegation budgets.

## Human Floor Triggers (R8)
- Changes touching policy pins or root architecture governance.
- Large blast radius operations crossing multiple major subsystem boundaries.
- Remediations outside the narrow self-heal allowlist.
- Authority mode changes or lease delegation grants.

When a turn triggers a human floor, it is parked as `STAGED` with `requires_human: true`. The orchestrator agent skips the turn and continues its loop without stalling.
