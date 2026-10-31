---
id: term-batched-verification
term: Batched Verification (Debounced Verification)
kind: terminology
status: accepted
context: core-and-client
---

# Batched Verification (Debounced Verification)

The deterministic queueing mechanism that eliminates the multi-edit tax when an agent performs rapid consecutive file modifications within a single prompt.

## Mechanism
- Intermediate tool edits invoke `afwe verify --debounce <ms>`.
- If consecutive edits arrive within the debounce window, AFWE registers the touched files into `.afwe/state/verify_debounce.json` and immediately exits successfully (`status: "debounced"` in <5ms).
- When quiescence occurs, or when `afwe verify --flush`, `turn.commit`, or `afwe gate` runs, consolidated AST analysis and rule verification execute across all accumulated files in a single pass.
