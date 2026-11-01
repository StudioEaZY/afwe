---
term: Drift Verdict
domain: Governance
canonical_status: approved
short_definition: An explicit three-way human governance decision (Adopt, Reject, or Tolerate) rendered on detected structural code-blueprint drift.
---

# Drift Verdict

## Definition
A **Drift Verdict** is an explicit tri-state governance action required whenever code deviates structurally from declared architectural blueprints without an automated mechanical rename match ($\ge 90\%$).

## The 3 Verdict Pathways
1. **Adopt**: Accepts the code mutation into the architectural blueprint. Optionally flags the change for fine-tuning (`tune: true`), generating a tracking card in the governance board.
2. **Reject**: Declines the drift. Either restores the exact pre-drift baseline bytes (`Restore`) or spawns an isolated remediation turn (`Steer` / `Rewrite`) with batch queue support.
3. **Tolerate**: Acknowledges the divergence without mutating the blueprint or failing gates, recording the drift into the Drift Ledger for a configurable grace window (default 7 days, up to 14 days) before surfacing as Amber for review.
