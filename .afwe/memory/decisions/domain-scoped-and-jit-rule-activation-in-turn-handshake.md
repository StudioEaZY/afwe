---
id: domain-scoped-and-jit-rule-activation-in-turn-handshake
kind: decision
title: Domain-Scoped and JIT Rule Activation in Turn Handshake
status: accepted
tags:
- planned
- turn-handshake
- briefing
- micro-context
origin: human
created: 2026-10-27
---

Planned architectural design for resolving global-vs-domain rule activation during fwe turn begin. Instead of unconditional global injection or brittle keyword filtering, rules with broad codebase scope (e.g. design system conventions like Lucide icons) attach to domain nodes in the Code Knowledge Graph (e.g. 
odes: [ui]) or file globs. The briefing pack selectively injects them when target files/ancestor chains match the domain, with JIT fallback via fwe context and remediation payloads at commit time.