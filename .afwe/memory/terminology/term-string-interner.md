---
id: term-string-interner
kind: terminology
title: String Interner
tags: [terminology, performance, memory, engine]
date: 2026-10-31
---

# String Interner

### Definition
A core data structure that stores only a single copy of each unique string slice, mapping strings to compact 32-bit integer identifiers (`Symbol` or `StringId`).

### Why it Matters
Identifier names, file paths, and AST symbol names are repeated thousands of times across blueprints, claim trees, and telemetry traces. String interning reduces memory footprints by upwards of 80% and converts expensive string equality checks into instant $O(1)$ integer comparisons.

### Example in Practice
When AFWE checks node contention across 20 concurrent turns, matching node identifiers like `"crates/afwe-core/src/api.rs"` executes as a single integer comparison between two interned symbols, rather than comparing byte sequences.
