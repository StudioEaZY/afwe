# AFWE v2 — what changed, why, and what to confirm

This is the record of the **v2 engine** built from `implementation_plan_arena.md`, with the refinements
decided during implementation. Where the plan and a refinement disagree, the refinement is what shipped.

## 1. The model in one paragraph

Every prompt is a **turn**. AFWE never calls a model; the harness does, and AFWE wraps it in three
deterministic calls: `turn begin` (briefing), `turn assume` (declare intents and claims before code),
`turn commit` (attribute, gate, commit). Raw prompts are append-only; **intents** are the merged, rewritable
view of what is wanted; **pins** are the only human-locked part; **checks** are what the gate must pass.
Committed turns are git commits with an `AFWE-Turn: tNNNN` trailer, so history is indexed by intent and
recoverable with `timeline`/`restore`.

## 2. Plan items → implementation

| Plan item | Where | Status |
|---|---|---|
| Turn ledger, multi-intent decomposition, claims | `crates/afwe-core/src/turn.rs`, `intent.rs`, `claims.rs` | done, tested |
| Pre-flight briefing, REDO loop (schema, pins) | `turn.rs` (`begin`, `assume`) | done, tested |
| Pluggable VCS (trait), git, trailers | `vcs/mod.rs`, `vcs/git.rs` | done (git); `NoVcs` for projects without git |
| Intent-indexed timeline, losses, restore | `timeline.rs` | done, tested (restore = 3-way merge) |
| Gate with trust levels | `gate.rs`, `turn.rs` (`commit`), `intent.rs` (checks) | done, tested |
| Staged proposals, footer, implicit acceptance | `turn.rs`, `gate.rs` | done, tested |
| Onboarding (CLI + detect + profiles + CI + AGENTS.md) | `onboard.rs`, CLI `onboard` | done (CLI); Studio modal see §5 |
| Dual profiles (normie / engineer) | `onboard.rs` (presets only) | done |
| checkgen (default app) | `intent.rs::checkgen` | done, tested (confirmed claims → standing checks) |
| Harness integration (MCP tools) | `api.rs` (`tool_specs`) | done: 49 MCP tools, 25 of them new |
| Architectural Directions & Futures Engine | `model.rs`, `verify.rs`, `drift.rs`, `context.rs`, `turn.rs` | done, tested (`status: planned` nodes, `phase: planned` non-blocking constraints, briefing context) |
| First-Class Project & Demo Scoping (`afwe ignore`) | `exclusions-engine` node in blueprint | planned / future (retroactive unmapping & sync purge) |
| 4D Timeline Snapshot Provider | `timeline-snapshot` node in blueprint | planned / future (deterministic temporal snapshot reconstruction) |
| Studio timeline / pins / onboarding | `apps/studio` | see §5 |
| 50-prompt benchmark | — | not built; see §6 |

## 3. Refinements to the plan (and why)

1. **Scoped commits only.** The plan's `git add .` would sweep unrelated user edits into a turn. A turn stages
   exactly what it changed, plus the `.afwe/` source directories; the commit is `git commit -- <files>`.
2. **Attribution by content hash.** `turn begin` captures a baseline of file hashes (code and `.afwe/` sources).
   Attribution = what changed since then. This works with or without git, and a user's pre-existing dirty
   edits are not attributed to the turn.
3. **No commit SHA inside the record.** A commit cannot contain its own SHA. The link is the trailer; SHAs are
   read from `git log`. Records are therefore never rewritten after committing.
4. **Restore uses a real 3-way merge with the right base.** The plan used an empty base, which conflicts
   everywhere. The base is the *state where the feature was gone* (the turn that removed it); ours = current,
   theirs = last good version. Restoring is then exactly undoing the removal, and any later edits by a
   person are merged on top of it. (I first tried "the commit before introduction": it keeps the deletion
   when the feature's files predate AFWE. The test suite caught this.)
5. **Registered checks must pass; there is no "block_on_generated: false".** The discussion settled that
   which checks exist is up to the user, but whether a registered check must pass is not. A check can be
   removed, and that is logged. `llm_judged` results never block alone and lower the strength shown.
6. **Collateral loss is detected at commit.** A feature (node) that loses its whole realisation without being
   declared in `removes` makes the turn REDO. The plan only had this in the timeline.
7. **Implicit acceptance is narrow and disclosed.** A staged proposal is folded into a later commit only when
   that turn works on the same nodes, never for pins, and always reported (`implicitly_accepted`). The footer
   obligation applies to every pending proposal, folded or not, so the user is always told.
8. **Confidence is shown as parts, and strength is the weakest check that ran.** No checks → `UNVERIFIED`,
   never "deterministic". Confidence = mapping × verification × clarity × pins, each shown. Only real code
   counts toward mapping (a README or fixture does not lower confidence).
9. **Pin budget = codebase size × manual slider.** Automatic limit ≈ 2 + 1.5·√(blueprint nodes), clamped to
   [3, 60]; the slider (1 relaxed … 3 balanced … 5 strict) scales it ×0.5 … ×2. Over-budget pins cannot be
   accepted. Human-originated pins are active at once; agent-originated pins are proposals a human accepts.
10. **Onboarding presets, not forks.** `normie` and `engineer` only set policy values (slider, auto-commit,
    checkgen). The engine is the same. `git init` is explicit (`afwe onboard`), never silent in `afwe init`.
    The CI template reads the install command from the repository variable `AFWE_INSTALL_COMMAND`; the plan's
    install URL (`github.com/StudioEaZY/afwe`) does not exist and was not used.
11. **Workflows are intents with a graph.** `intents/` holds intents; a graph (the former workflow nodes)
    is optional. Legacy `workflows/*.yaml` are still read, and `afwe migrate` moves them (format `afwe/2`).
12. **Every turn is a task.** `turn begin` opens a Task under the default contract, so the Board shows the
    obligations; commit ticks the after-steps.
13. **Plugin surface v0.** Apps extend AFWE through **checks**: a shell command (exit 0 = pass), a trust level,
    attachments, and `AFWE_CHANGED_FILES` in its environment. No in-process plugins. This keeps apps in any
    language, which fits "the folder is the product".
14. **Engine-owned records are never attributed.** `index/`, `state/`, `turns/` and `log/` are excluded from
    attribution and always staged with a commit, so the engine's own writes cannot make a turn look dirty.

## 4. Acceptance — what was run

- `cargo test`: 26 unit tests (20 new: gate decisions and confidence, pin conflicts and collateral loss, pin
  budget and keep-phrases, attribution paths, onboarding helpers; 6 from v1), 4 end-to-end (v1 behaviour
  unchanged), **3 turn-protocol tests against real git**
  (`crates/afwe-core/tests/turn_flow.rs`): the full lifecycle; schema refusal with nothing half-registered;
  a project without version control.
- **Demo findings are unchanged.** `afwe verify` on the demo produces byte-identical output with the v1
  binary and the v2 binary (both `--no-commands` and full). The plan asked for "exactly 1 constraint violation
  and 1 active guardrail"; the demo's guardrail `payments-boundary` has two checks, so the expected output is
  the constraint plus those two guardrail findings, as before.
- `scripts/demo.sh` runs in full: a read-only tour, then a throw-away git copy with a committed turn (with a
  claim that becomes a standing check), a REDO, a fix, and the timeline.
- MCP `tools/list` exposes 49 tools.

## 5. Studio

The Studio gained the Timeline view, the Pins and Intents panel, and the onboarding wizard (see the
Studio section of the README for what is wired). The Tauri shell is unchanged and, as before, not built in
this sandbox.

## 6. Not built / Planned in Architecture
 
- **First-Class Project & Demo Scoping (`exclusions-engine`).** Registered as `status: planned` in blueprint. Adds `afwe ignore add/remove/list`, retroactive blueprint unmapping, and sync purging without foreign sidecars.
- **4D Temporal Scrubbing (`timeline-snapshot`).** Registered as `status: planned` in blueprint. Data exists (`implements` per turn); engine will expose `timeline.snapshot` for temporal graph playback in Studio.
- **50-prompt benchmark (plan phase 8).** It needs a scripted harness and a fixed set of prompts to be
  meaningful. The design is in §8 of the discussion notes; `turn_flow.rs` covers the mechanisms.
- **Adversarial pair / LLM-judged checks.** The trust level and the gate rule exist; no runner ships.
- **Hooks for specific harnesses** (e.g. Claude Code settings). The AGENTS.md / CLAUDE.md contract block is
  written; hook installation needs each harness's current format and was not verified here.
- **Tauri build.** Unchanged from v1: needs webkit2gtk and cannot be built in this sandbox.

## 7. Decisions to confirm

1. Pin slider labels and the budget formula (§3.9) — tune once real projects show how many pins they accumulate.
2. `normie` auto-commits passing turns: confirm you want AFWE committing by default, not just staging.
3. Implicit acceptance (§3.7): confirm the node-overlap rule is the right trigger.
4. Unverified turns (no checks ran) still commit at 75% confidence, shown as UNVERIFIED. The alternative is to
   stage them; that would push new projects into proposals until they register checks.
5. Claims are evaluated over their own globs project-wide, so a claim that is already false blocks turns that
   touch its scope. That is intended (it surfaces the contradiction) but may feel strict on legacy code.
6. Checks and guardrail commands are shell commands stored in the repository (`.afwe/checks/`,
   `.afwe/guardrails/`). Running `afwe gate` in CI runs whatever they say. Review changes to them the way you
   review changes to CI configuration.
7. Manual-commit mode (`engineer`): a `ready` turn that you commit with plain git is shown as committed once the
   trailer exists in history. Nothing else in the record changes.
