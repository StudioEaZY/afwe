---
id: replication-lag
kind: problem
title: Replication lag on status reads
status: open
applies_to:
- data
- realtime-status-worker
tags:
- database
origin: human
created: 2026-09-22
---

## Problem
Replica lags the primary by up to 2s under load.

## Impact
Any read-after-write from the replica can show stale data.

## Ideas
Route consistency-critical reads to the primary (done via `replica-read-policy`); consider read-your-writes tokens.
