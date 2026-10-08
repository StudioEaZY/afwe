# Real-World Case Study: The Multi-Intent Funnel Overhaul

This walkthrough shows a real-world case study of how AFWE handles complex, multi-intent prompts without an internal LLM in the core engine.

---

## 1. The Scenario & The Stress-Test Prompt

A developer feeds a broad, highly subjective design and copy critique into their AI coding agent for an onboarding funnel spanning 6 slides:

> *"These are new ideas I was playing with for the funnel to improve it both visually and information-wise... Slide 5 is overloaded. The 50% rate, 6-month pause, payment steps and refund rules all sit on one screen. I'd give protection and refunds their own slide. Slide 1 and 2 overlap. Slide 4 shows both tracks to everyone, so show only theirs. Drop the fake urgency ticking clock. On Slide 6: remove the mini pricing table and make the ending warm and relational instead of sales-funnel-ish..."*

### The Problem With Standard AI Agents
A naive harness tries to edit 6 React components simultaneously:
1. It accidentally leaves the `"50% off"` pricing table on Slide 6 while rewriting Slide 5.
2. It misses removing the `ticking-clock` component from nested sub-views.
3. It breaks the Lemon Squeezy payment contract by deleting critical checkout state.

---

## 2. How AFWE Intercepts and Gated the Turn

AFWE solved this during **Turn `t0001`** on the `examples/multi-intent-funnel` project:

### Step 1: Pre-Flight Briefing (`turn.begin`)
```bash
afwe turn begin "Restructure funnel flow and copy" --target examples/multi-intent-funnel/**
```
AFWE inspects the blueprint and returns:
- Scope: `[funnel-presentation, pricing-model]`
- Active Pin: `pin-lemon-squeezy` (Payment interface invariant)
- Active Guardrails: `forbid_import payments -> ui`

### Step 2: Decomposition & Pre-Generation Claims (`turn.assume`)
Before touching a single file, the harness must decompose the prompt into intents and tree-sitter verifiable claims:

```json
{
  "intents": [
    {
      "id": "funnel-flow",
      "action": "update",
      "targets": ["Slide5.tsx", "Slide6.tsx"],
      "statement": "Separate commercial terms from relationship closure"
    },
    {
      "id": "urgency-removal",
      "action": "update",
      "targets": ["Slide4.tsx"],
      "statement": "Remove fake urgency timer"
    }
  ],
  "assumptions": [
    {
      "id": "a1",
      "text": "Slide 6 contains no pricing table",
      "claim": {
        "type": "forbid_pattern",
        "pattern": "50% off",
        "files": ["examples/multi-intent-funnel/Slide6.tsx"]
      }
    },
    {
      "id": "a2",
      "text": "Urgency timer removed from funnel",
      "claim": {
        "type": "forbid_pattern",
        "pattern": "ticking-clock",
        "files": ["examples/multi-intent-funnel/**"]
      }
    }
  ]
}
```

### Step 3: Gated Verification & REDO Loop (`turn.commit`)
The agent refactors the components. It calls `turn.commit`:

```bash
afwe turn commit t0001 --summary "Restructure funnel flow and remove urgency clock"
```

AFWE's gate runs:
1. **Tree-sitter Pattern Verification**: Scans `Slide6.tsx` for `"50% off"`.
2. **Global Funnel AST Scan**: Scans all funnel components for `"ticking-clock"`.
3. **Structural Import Gate**: Verifies no forbidden cross-subsystem imports were introduced.
4. **Pin Conflict Gate**: Confirms Lemon Squeezy contract remains untouched.

If any check fails, AFWE triggers **REDO**:
```text
REDO — t0001 NOT committed
  ✖ Gate check failed: Slide6.tsx still matches forbidden pattern '50% off'
  → Code NOT committed to git.
```
The agent receives the exact error, removes the offending component, and calls `turn.commit` again.
Once passing, AFWE commits the turn atomically with trailer `AFWE-Turn: t0001`.

---

## 3. Key Takeaway

By forcing claims **before** code generation, AFWE turns messy, qualitative human prompts into **deterministic pre-commit tests**, guaranteeing architectural integrity without requiring an LLM inside the engine kernel.
