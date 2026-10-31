---
term: Action Queue
kind: concept
status: canonical
context: core-and-client
---

# Action Queue

The deterministic, read-only 6-state governance view over turns, leases, and repository state, providing both humans and delegated orchestrators an actionable view of pending items without polling.

## The Six Canonical States
1. **STAGED**: Proposals parked awaiting confirmation or human-floor review.
2. **GHOST REDO**: Turns left in REDO state when work ceased without clean reset.
3. **READY**: Evaluated turns where checks passed, sitting in the Ready drawer for git commit.
4. **ADVISORY DRIFT**: Non-blocking architectural violations and documentation drift.
5. **STALE NODE LEASES**: Concurrency node leases whose leaseholder heartbeats have lapsed.
6. **UNATTRIBUTED**: Working-tree modifications or commits lacking AFWE turn attribution.

## Interfaces
- **Studio Web / Tauri**: Real-time visual cards with state filters and batch action bars.
- **Terminal Surface**: Live ANSI dashboard via `afwe watch`.
- **MCP Tooling**: Headless programmatic inspection and resolution via `afwe_queue_get`, `afwe_queue_act`, and `afwe_batch_act`.
