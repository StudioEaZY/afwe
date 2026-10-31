---
id: term-git-plumbing-tree
kind: terminology
title: Private Git Plumbing Tree
tags: [terminology, git, isolation, storage, safety]
date: 2026-10-31
---

# Private Git Plumbing Tree

### Definition
An isolated, content-addressed Git object tree constructed directly using low-level Git plumbing commands (`git write-tree`, `git commit-tree`, `git update-ref`) without modifying the developer's active working tree or index.

### Why it Matters
Autonomous agent mutations must be verified, diffed, and staged in hermetic isolation before touching the developer's dirty workspace. By writing directly to private plumbing trees, AFWE can calculate exact CAS diffs, run verification checks, and stage proposals with zero interference with uncommitted human changes.

### Example in Practice
During `afwe turn commit`, the engine builds a tree object representing the staged turn changes and records it under `.afwe/refs/turns/<turn-id>`, keeping the developer's working directory untouched until an explicit merge or checkout is requested.
