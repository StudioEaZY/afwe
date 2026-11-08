---
term: Heartbeat
domain: Lifecycle
canonical_status: approved
short_definition: An explicit touch operation that refreshes a turn's last_activity timestamp during long-running silent operations to prevent stale reclaim.
---

# Heartbeat

## Definition
A **Heartbeat** is an operation (`turn.heartbeat` / `afwe turn heartbeat <turn>`) that touches `turn.last_activity = now()` on an active turn without altering claims or writing code.

## Usage
- **Long Silent Operations**: When an agent executes time-consuming commands (e.g. lengthy builds, extensive test suites, or multi-step analysis) without mutating AFWE turn state, it sends a heartbeat to communicate ongoing progress and reset the staleness TTL counter.
