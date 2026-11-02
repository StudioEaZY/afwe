---
id: term-dormant-check
kind: terminology
title: Dormant Check
status: accepted
applies_to:
- afwe-core
tags:
- checks
- rewind
origin: llm:deepseek-flash
created: 2026-11-02
---

# Dormant Check

## Meaning
A check whose originating turn was undone outside AFWE. It stays on disk and is excluded from the
active enforcement set (`status: dormant`) instead of being deleted, and it revives if the turn is
restored forward. Dormancy is a reversible annotation, not a deletion.

## Not to be confused with
- **Retired check**: a deliberate human retirement, not a reaction to a rewind.
- **Superseded check**: one replaced by a newer check for the same target.
