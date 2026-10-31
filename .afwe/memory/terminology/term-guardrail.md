---
id: term-guardrail
kind: terminology
title: "Guardrail"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - guardrails
  - verification
created: 2026-10-31T14:27:00Z
---
# Guardrail

## Meaning
An architectural constraint divided into two complementary forms:
1. **Passive Guardrail**: Targeted contextual instructions injected into the agent's micro-context (`afwe context <files>`) before editing begins.
2. **Active Guardrail**: Concrete test, AST inspection, or claim enforced by `afwe verify` and the commit gate.

## Not to be confused with
- **Pin**: Guardrails can be generated, calibrated, and updated by AFWE tools; Pins are locked by humans under a strict budget.
- **Check**: A Check is the concrete executable assertion registered in the gate registry implementing an active guardrail or assumption claim.
