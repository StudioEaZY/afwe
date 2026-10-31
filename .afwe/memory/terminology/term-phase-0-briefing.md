---
id: term-phase-0-briefing
kind: terminology
title: "Phase 0 (Briefing & Pins)"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - turn-protocol
  - briefing
created: 2026-10-31T14:27:00Z
---
# Phase 0 (Briefing & Pins)

## Meaning
The initial pre-planning phase of a turn initiated via `afwe turn begin "<prompt>" --target <files> [--claim <files>]`. It stores the prompt verbatim, generates a deterministic briefing pack including active pins, guardrails, memory, active intents, and probing guides, issues a bearer security token, and acquires upfront file claims to prevent multi-agent contention.

## Not to be confused with
- **Phase 1 (turn assume)**: Phase 0 is read-only research and briefing before planning; Phase 1 is intent and claim declaration after planning is complete.
