---
term: Stale Turn
domain: Lifecycle
canonical_status: approved
short_definition: An open, assumed, or ready turn whose last activity timestamp exceeds the configured staleness TTL without explicit pause.
---

# Stale Turn

## Definition
A **Stale Turn** is an AFWE turn in `open`, `assumed`, or `ready` status that has had zero mutating activity (commits, assumes, redos, or heartbeats) for longer than `policy.stale_turn_minutes` (default: 120 minutes). Paused turns are explicitly immune from staleness because they are deliberately suspended awaiting human input.

## Behavior and Governance
- **Deterministic Assessment**: Staleness is computed purely chronologically from `turn.last_activity` against UTC system time.
- **Action Queue Surfacing**: Stale turns appear in the Action Queue as a `STALE TURN` card (under GhostRedo) with an immediate `Reclaim` action.
- **Unblocking New Work**: Stale turns do not permanently wedge files or delegation. When a new turn claims a file held by a stale turn, the engine auto-reclaims the stale holder and proceeds.
