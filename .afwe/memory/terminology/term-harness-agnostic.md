---
id: term-harness-agnostic
term: Harness-Agnostic Architecture
kind: terminology
status: accepted
context: core-and-client
---

# Harness-Agnostic Architecture

The architectural invariant that AFWE core, verification, and tripwires operate identically regardless of which AI coding agent or human is executing changes (e.g. Claude Code, Cursor, Windsurf, Aider, OpenCode, custom MCP agents, or human developers).

## Principles
1. **Zero Vendor Lock-in**: AFWE core contains no proprietary harness SDKs or vendor-specific execution branches.
2. **Layered Hook Fallback**: Tool hooks (`agent-hooks.json`, `claude-hooks.json`) provide low-latency feedback; native Git pre-commit hooks (`.afwe/guardrails/pre-commit`) and the CI gate (`afwe-gate`) act as deterministic fallbacks for any environment lacking tool hooks.
3. **Open Standards**: Interoperates via standard JSON-RPC, standard CLI interfaces, and Git porcelain/plumbing.
