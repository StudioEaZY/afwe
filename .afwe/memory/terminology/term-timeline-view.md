---
id: term-timeline-view
kind: terminology
title: "Timeline View"
status: accepted
applies_to:
  - studio
  - studio-timeline
tags:
  - studio-view
  - timeline
  - ledger
created: 2026-10-31T19:50:00Z
---
# Timeline View

## Meaning
The chronological turn and intent auditing interface in AFWE Studio (`TimelinePage.tsx`). It visualizes turn history by intent, displays git commit receipts, tracks intent drift over time, provides side-by-side diff viewers (Code, Blueprint, Claims), and offers 3-way historical feature restoration (`afwe timeline restore`).

## Not to be confused with
- **Action Queue**: Timeline View audits past historical executed turns; Action Queue displays live, pending operational tasks and proposals.
- **Git Log**: Standard git log only shows commits; Timeline View shows turns, prompt provenance, gate evaluations, and intent mutations.
