---
id: term-intent
kind: terminology
title: "Intent"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - intents
  - architecture
created: 2026-10-31T14:27:00Z
---
# Intent

## Meaning
A living, persistent statement of architectural purpose and desired behavior stored in `.afwe/intents/*.yaml`. Derived and merged from verbatim user prompts over time, intents capture what the codebase is intended to do, its historical evolution, and its implementation mappings.

## Not to be confused with
- **Turn**: A Turn is a single transaction that fulfills or updates one or more intents.
- **Workflow**: In AFWE ReBorn, legacy workflow graphs have graduated into unified living intents.
