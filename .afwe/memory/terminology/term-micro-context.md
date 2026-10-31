---
id: term-micro-context
kind: terminology
title: "Micro-Context"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - context
  - passive-guardrails
created: 2026-10-31T14:27:00Z
---
# Micro-Context

## Meaning
The targeted, highly scoped architectural context retrieved via `afwe context <files>` (or MCP tool `afwe_context`). Before an agent touches a file, micro-context delivers only the nodes, purpose statements, decisions, exceptions, constraints, ubiquitous terminology, and active guardrails that directly apply to those specific files.

## Not to be confused with
- **Whole-Repository Prompting**: Micro-context specifically avoids dumping the entire codebase or full architecture into the LLM context, keeping token usage low and focus razor-sharp.
