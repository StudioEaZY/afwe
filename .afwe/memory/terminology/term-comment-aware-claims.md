---
id: term-comment-aware-claims
kind: terminology
title: Comment-Aware Claims
tags: [terminology, claims, ast, verification]
date: 2026-10-31
---

# Comment-Aware Claims

### Definition
A parsing strategy that blanks out, ignores, or differentiates code comments and docstrings when evaluating AST function boundaries, symbol claims, and diff contentions.

### Why it Matters
Naive regex or raw string search can falsely match commented-out code, references in documentation, or license headers as active symbols. Comment-aware claim extraction ensures that agents only claim and lock genuine semantic AST nodes, preventing false contention and allowing concurrent documentation updates without lock collisions.

### Example in Practice
If Agent A holds a claim on function `pub fn execute_turn()`, and Agent B modifies an architectural docstring referencing `execute_turn()` in another file, Comment-Aware Claims recognizes the mention as inert prose rather than a declaration lock violation.
