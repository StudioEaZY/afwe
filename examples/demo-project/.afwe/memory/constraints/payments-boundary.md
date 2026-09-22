---
id: payments-boundary
kind: constraint
title: 'Payments boundary: no UI dependencies'
status: accepted
applies_to:
- payments
tags:
- boundary
origin: human
created: 2026-09-22
---

## Rule
Nothing under `src/payments/` may import UI code. Payments runs headless in workers.

## Reason
Importing a component drags the renderer and DOM assumptions into a worker bundle.

## Enforced by
Structural constraint `payments-no-ui` (see `blueprint/constraints.yaml`) and the active guardrail `payments-boundary`.
