---
id: replica-read-policy
kind: constraint
title: Replica read policy
status: accepted
applies_to:
- data
files:
- src/data/replica.ts
tags:
- consistency
- database
origin: human
created: 2026-09-22
---

## Rule
Do not read from the replica for consistency-critical operations.

## Reason
Replication lag (see problem `replication-lag`) makes replica reads unacceptable for anything a
user just wrote.

## Exceptions
Realtime status widgets (`Realtime Status Worker`) may read from the replica: eventual consistency is fine there.
