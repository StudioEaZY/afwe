---
term: Drift Ledger
domain: Storage & State
canonical_status: approved
short_definition: The persistent state file tracking tolerated architectural drifts, expiration deadlines, and governance verdicts.
---

# Drift Ledger

## Definition
The **Drift Ledger** is a versioned state repository located at `.afwe/state/drift_ledger.json` that stores all tolerated drift occurrences along with their entry timestamps, target paths, rationale, and expiration deadlines.

## Behavior
- **Toleration Window**: Governed by `policy.drift_tolerate_days` (default 7 days, configurable up to 14 days in `afwe.yaml`).
- **Amber Re-surfacing**: Once the toleration deadline elapses, the engine elevates the drift from silent tracking to an Amber warning in the Action Queue (`ToleratedDriftExpired`), prompting the developer to either formalize adoption, trigger a steering turn, or extend toleration.
- **Batch Processing**: Supports bulk operations (`batch.tolerate_drift`, `batch.adopt_drift`) for high-velocity refactorings.
