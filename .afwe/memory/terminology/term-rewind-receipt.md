---
id: term-rewind-receipt
kind: terminology
title: Rewind Receipt
status: accepted
applies_to:
- afwe-core
tags:
- rewind
- ledger
origin: llm:deepseek-flash
created: 2026-11-02
---

# Rewind Receipt

## Meaning
The append-only record AFWE writes when it detects that the working tree moved back to a state it has
already seen. It carries the from and to states, the ordered turns undone, the rewound paths, and
whether the match was exact, ambiguous or compound. A receipt is written and AFWE continues: it never
blocks a turn and never restores files automatically.

## Not to be confused with
- **Revert commit**: an `AFWE-Rewind-Of` commit is a proposal to represent the rewind in history.
- **Rollback**: an explicit human undo, which changes status on purpose.
