---
id: dec-strict-fk-billing
kind: decision
title: "Strict foreign-key enforcement on billing tables"
status: accepted
applies_to:
  - "Data/schema"
  - "Services/billing"
created: 2026-05-15T10:00:00Z
---

# Strict foreign-key enforcement on billing tables

All ledger and subscription tables in Data/schema enforce cascading foreign-key constraints.
