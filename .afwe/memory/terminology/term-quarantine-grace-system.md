---
id: term-quarantine-grace-system
kind: terminology
title: Quarantine Grace System
tags: [terminology, safety, rollback, recovery]
date: 2026-10-31
---

# Quarantine Grace System

### Definition
A two-tier safety mechanism that holds unverified or speculative agent mutations in an isolated quarantine state before permanent application or destruction, providing a configurable grace window for inspection and rollback.

### Why it Matters
Autonomous agent loops occasionally generate malformed, dead-on-arrival, or hallucinated outputs. The Quarantine Grace System ensures that accidental or destructive changes do not immediately overwrite working tree state or corrupt the project history, offering non-destructive recovery.

### Example in Practice
When an agent attempts to abandon or overwrite a modified file during a contentious turn, the engine places the replaced bytes into `.afwe/quarantine/<timestamp>/` rather than discarding them immediately, retaining a safety grace buffer.
