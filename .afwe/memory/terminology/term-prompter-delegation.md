---
term: Prompter Delegation
kind: concept
status: canonical
context: core-and-client
---

# Prompter Delegation

A time-bounded, permission-bounded grant from a human prompter to an orchestrator agent (`authority.delegate`), distinct from node concurrency leases (`lease.rs`).

## Key Properties
- **Deterministic Default**: The system starts and defaults to `human_only`.
- **Standalone Request**: Promotion/delegation can only be granted before work begins, by a human, as a standalone request with no other payload (R1-R3).
- **Idle Window Invariant (R4)**: Prompter delegation is forbidden while any turn is actively `open` (ready turns in the Ready drawer do not block).
- **Hard Ceilings (R5)**: Maximum TTL of 12 hours (default 4h), max auto-approvals of 50 (default 20), max self-heals of 10 (default 5).
- **Fail-Closed Fallback (R6)**: Any rejected attempt to loosen authority immediately revokes any active delegation and restores `human_only`.
- **Instant Revocation (R7)**: May be revoked at any time from any interface via `afwe authority revoke`.
