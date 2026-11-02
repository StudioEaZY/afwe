---
name: afwe
description: Architecture-First Workspace Engine skill. Enforces turn protocol (begin -> assume -> commit), micro-context retrieval, verification gates, architectural integrity, and documentation sync for coding agents.
---

# AFWE Skill Instructions

This project uses AFWE to deterministically govern architecture and prevent agent regressions.
AFWE combines Code Knowledge Graphing, Intent Memory, and Structural Tripwires into a single deterministic gate.

When interacting with this codebase:

1. **Phase 0: Pre-Planning & Research (Before Planning)**:
   - Call `afwe turn begin "<prompt>" --target <files> [--claim <files>] [--parent <turn>]` (or MCP tool `afwe_turn_begin`) **immediately upon receiving the prompt**, before researching or authoring a plan (`/plan`).
   - Read `docs/UBIQUITOUS_LANGUAGE.md` (or `.afwe/docs/UBIQUITOUS_LANGUAGE.md`) and `.afwe/memory/terminology/` to ensure plans, intents, and code adhere strictly to canonical domain terms.
   - In parallel multi-agent sessions, declare file claims upfront with `--claim <files>` to prevent lost-update races.
   - Read the briefing pack: inspect in-scope architectural nodes, locked pins, active guardrails, probing guides (`[GUIDE - ADVISORY]`), and ambiguity questions. Note your assigned `turn_hash` and bearer `token`.
   - If `CONTENTION` is returned, another agent holds that file. Do not edit conflicting files concurrently in the same directory.

2. **Phase 1: Pre-Code Declaration (After Plan Approval)**:
   - Call `afwe turn assume <turn> --file <json> [--token <tok>] [--claim <files>]` (or MCP tool `afwe_turn_assume`) to declare your intents and pre-generation claims BEFORE writing any code.
     Supported claims include:
     - `forbid_import`: forbid cross-module imports (e.g. `to_nodes: ["ui"]`).
     - `forbid_symbol`: forbid disallowed AST symbols (e.g. `symbol: "danger_fn"`).
     - `export_exists`: ensure public symbol remains exposed (e.g. `symbol: "init"`).
     - `symbol_signature`: ensure symbol signature contains expected tokens.
     - `pattern`: regex AST/file pattern check (with automatic comment blanking).
     - `command`: shell verification command.
   - If refactoring or replacing existing capabilities, declare explicit removals in `removes` or intents with `action: remove` / `replace` (following Rust's strict compiler philosophy: unforgiving by default with explicit declarations).
   - If REDO is returned, call `afwe turn redo <turn> [--token <tok>]` to safely reset working tree changes back to baseline (backed up in `.afwe/backups/<turn_hash>/`).
   - If abandoning an open attempt, call `afwe turn abandon <turn> [--token <tok>]` to release all file claims immediately.

3. **Phase 2: While Editing**:
   - Retrieve micro-context via `afwe context <files>` (or MCP `afwe_context`).
   - Obey active pins and active guardrails; never delete pinned behavior without an explicit override (`{pin, reason}`).
   - Answer pending questions or review probing guides (`afwe question list`, `afwe guide list`).
   - **Fast-Path Edit Verification**: When using tool hooks that fire on every edit, run `afwe verify --no-commands` to get immediate fail-fast architectural feedback in < 20ms without paying the test-suite execution tax.
   - **Mid-Turn Pause & Zero-Token Reactive Wait**: When hitting branching decisions or requiring human confirmation mid-turn, call `afwe turn pause <turn> --reason "..." [--options ...]` (or MCP tool `afwe_turn_pause`). This suspends execution at 0 tokens in a reactive loop until the human replies via Windows desktop toast buttons, Studio Action Bar, or `afwe turn resume <turn> --reply "..."`.

4. **Phase 3: Post-Editing (Verification & Mandatory Synchronization)**:
   - Run verification via `afwe verify --changed <files>` (or MCP `afwe_verify`).
   - In prototype spikes, explore mode can be temporarily activated via `afwe unlock --reason "..."` and re-armed via `afwe lock`.
   - **Drift 3-Way Governance**: Structural code changes require an explicit tri-state verdict via `afwe drift verdict <file> --verdict adopt|reject|tolerate` (or MCP `afwe_drift_verdict`):
     - `adopt`: accepts code into the blueprint (with optional `--tune` flag creating a fine-tuning Board card).
     - `reject`: rejects the drift with either `restore` (reverts disk baseline) or `steer` (spawns a brand new standalone remediation turn).
     - `tolerate`: records the drift into `.afwe/state/drift_ledger.json` for a configurable 7–14 day window before surfacing as Amber.
   - **Post-Turn Synchronization Obligation**: Whenever code structure, public APIs, rules, or behavior change:
     - Update documentation (`README.md`, `.afwe/docs/`, root `docs/`).
     - Update Ubiquitous Language: add or update terms in `.afwe/memory/terminology/`, update `docs/UBIQUITOUS_LANGUAGE.md` (and `.afwe/docs/UBIQUITOUS_LANGUAGE.md`), and run `afwe memory sync-terms` (or `node scripts/sync-ubiquitous-language.js`).
     - Update skill instructions (`.afwe/skills/afwe/SKILL.md`) with generalized examples.
     - Update MCP tool specs and handlers (`mcp.rs`, `api.rs`) whenever tool capabilities expand.
     - Persist non-obvious design choices via `afwe memory add --kind decision ...` (or `afwe_memory_add`).
   - **Harness-Agnostic Tripwires & CI Gate**: Generate multi-agent hooks via `afwe materialize --apply --agent-hooks` and production CI workflow (`afwe-gate.yml`) with configurable runner label (`manifest.ci.runs_on`), fixed check name `afwe-gate`, and prebuilt release binary caching.
   - Commit the turn via `afwe turn commit <turn> --summary "..." [--token <tok>]` (or MCP `afwe_turn_commit`).
     Commits are isolated via Git plumbing trees with CAS verification and OS advisory commit locks (`flock`/`LockFileEx`), preventing dirty workspace leakage.
     The commit gate deterministically enforces capability and governance ratchets:
     - `DROPPED_CAPABILITY`: intra-file export dropped without declared remove/replace intent.
     - `SEVERED_CAPABILITY`: cross-module caller severance dropping inbound references from >0 to 0.
     - `DEAD_ON_ARRIVAL`: new uncalled exported function born with 0 callers without test or intent declaration.
     - `ORPHANED_DECISION` / `ORPHANED_PIN`: anchored architectural memory or pin lost its target code.
     - `DOCS_DRIFT`: markdown documentation links pointing to missing code files.
     Remember: "Rust for project intent" — you can break things on purpose by declaring them in `turn assume`, but you can never break them by accident.
   - Inspect stats and gate telemetry with `afwe stats`.
   - **Engine Ledger & Recovery**: Inspect the append-only ledger with `afwe ledger show` (project id, ref, tip, schema, event/turn counts). In a repository that predates the ledger, run `afwe ledger bootstrap` once; it imports the tracked turns as `provenance: imported`. Run `afwe repair` (or `afwe ledger repair`) after an external rollback of `.afwe/`: it regenerates `.afwe/turns` from the ledger and moves duplicate or stale files to `.afwe/backups/`, never deleting them. Move the ledger between clones with `afwe ledger push [remote]` and `afwe ledger fetch [remote]`; a divergence is recorded as `forked` and both tips are kept, never merged.
   - **Snapshots**: `afwe snapshot list` / `afwe snapshot show <id>` reads local parentless snapshots under `refs/afwe/snapshots/<project_id>/`; `afwe snapshot take` takes one now. Turn begin and end take them automatically. They are local only: never pushed with the ledger, and they exclude engine-owned state, nested repositories, LFS paths, symlinks and oversized files.
   - **Rewind Receipts**: `turn.begin` compares the current tree with the ledger expected tree and classifies a difference as `REWOUND`, `COMPOUND` or `UNATTRIBUTED` using snapshot history. Read `rewind_receipts` / `rewind_notice` in the briefing, or run `afwe rewind list` / `afwe rewind check`. A receipt is advisory: it never restores a file, never blocks a turn, and never refuses a commit.
   - **Test & CI Generation Mandate**: When authoring tests or CI automation:
     - Overlay Correctness: Test suites and CI workflows MUST cover all file lifecycle variants: newly created files, deleted files, renamed files, gitignore patterns, and CRLF line endings. If overlay analysis is incomplete, fall back to a one-time full analysis and record the fallback.
     - Tree Deduplication: Snapshot and rewind tests MUST cover identical trees across consecutive turns while preserving distinct turn and phase metadata.
   - **Turn-start side effects**: every supported `turn begin` (CLI, raw `afwe call turn.begin`, MCP) starts the Studio daemon (dynamically allocating an open port in 4242..4260) and the user-space presence watcher deterministically. No deep OS autostart service or registry manipulation is used; if the watcher is killed, AFWE automatically restarts it on the next turn. Set `AFWE_NO_AUTOSTART=1` for CI/headless runs.

5. **Prompter Authority & Agentic Loops (Autonomous Workflows)**:
   - **Default Mode (`human_only`)**: System starts in deterministic `human_only`. Direct human presence is required for all gate overrides, mode changes, and baseline resets.
   - **Delegation Grants (`prompter_delegated`)**: A human prompter can delegate the prompter role to one orchestrator agent for a bounded run (`afwe authority delegate --holder <agent> --ttl 4h --budget 30 --door mcp` or MCP `afwe_authority_delegate`).
   - **Idle Window Invariant (R4)**: Delegation grants are rejected if any turn is actively `open` (`ready` turns waiting in drawer do not block).
   - **Fail-Closed Fallback (R6)**: Any rejected attempt to alter authority instantly revokes active delegation and restores `human_only`.
   - **Human Floor (R8)**: Invariant policy pins and high blast radius turns are never auto-approvable. They park as `STAGED` with `requires_human: true`, allowing the agent loop to continue without stalling.
   - **6-State Action Queue**: View and resolve pending work via `afwe queue list` / `afwe queue act` / `afwe queue batch` (MCP `afwe_queue_get`, `afwe_queue_act`, `afwe_batch_act`), the Studio surface, or the live terminal monitor (`afwe watch`).
   - **Narrow Self-Heal**: Mechanical restores of undeclared file drops run as sub-turns `<parent>.1` via `afwe heal restore` (MCP `afwe_heal_restore`).
   - **Attribution & CI Verification**: Validate git commit trailers via `afwe gate --ci`. Attribute manual developer commits via `afwe attribute <commit>`.
   - **Revoke**: Prompter delegation can be revoked instantly at any time via `afwe authority revoke` (MCP `afwe_authority_revoke`).
   - **Human Presence & Watcher**: The headless presence watcher (`afwe presence run`) runs in user space, tracks events across registered projects, applies user notification routing (`presence.toml`), and enforces `floor_only` biometric presence proof (Windows Hello / Touch ID) for high-blast-radius actions. For remote sandboxes without inbound access, the Git Channel (`refs/afwe/outbox/` and `refs/afwe/inbox/`) provides zero-relay two-way notification and steering.
