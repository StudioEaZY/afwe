# demo-project

A deliberately small multi-language codebase (TypeScript, TSX, Python) with a populated `.afwe/`.
It ships in an interesting state on purpose:

* **one constraint violation** — `src/payments/checkout.ts` imports `../ui/Button` although
  `payments-no-ui` says Payments must not depend on UI (also caught by the active guardrail
  `payments-boundary`, together with a forbidden `console.log`);
* **one pending proposal (30 %)** — `src/notifications/mailer.ts` has no blueprint home;
* **one uncertain reconciliation (62 %)** — `src/auth/auth.ts` was auto-mapped to *Sessions* and flagged;
* **one open task** started by `llm:claude-code` with contract obligations on the Board;
* a **lens** (`workspace-blueprint`) that shows the workspace as Library / Search / Preview / Tagging;
* a **workflow** (`add-tagging`) with the original prompt kept as provenance and nodes mapped to code;
* 8 memory entries (decisions, constraints, exceptions, terminology, a problem) and 4 guardrails.

```bash
afwe status
afwe context src/dashboard/Widget.tsx        # decisions + exceptions + guardrails that apply
afwe verify                                  # exit 1: constraint violation + active guardrail
afwe drift                                   # findings with confidence + what sync would do
afwe proposals                               # accept / revert / review the mailer.ts proposal
afwe board                                   # open contract obligations + system items
afwe lens show workspace-blueprint
afwe workflow show add-tagging
afwe studio                                  # http://localhost:4242
```

Try breaking things: move `src/payments/stripe.ts` somewhere else and run `afwe sync` (rename detection),
delete the `../ui/Button` import and run `afwe verify` (the violation disappears), or add a file under
`src/dashboard/` and watch it get mapped with high confidence because all its siblings belong to Dashboard.
