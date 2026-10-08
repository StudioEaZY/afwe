---
id: exclusions-engine-scoping-plan
kind: decision
title: Exclusions Engine Scoping Plan
status: accepted
applies_to:
- exclusions-engine
tags:
- scoping
- ignore
- drift
origin: human
created: 2026-10-08
---

AFWE will provide native afwe ignore add/remove/list commands and engine ops with retroactive cleanup. Upon ignore add, the glob is added to analyzer.ignore in afwe.yaml, matching files are auto-unmapped from blueprint.yaml, and an AST sync pass purges index/code.json and clears stale proposals without foreign sidecars.