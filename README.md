# AFWE — Architecture-First Workspace Engine

> **The folder is the product.** `.afwe/` is a persistent, multi-level, two-way model of a codebase that
> sits between an LLM harness (Claude Code, Codex, Cursor, …) and the IDE. Rust + tree-sitter + Tauri is
> just the machine that reads and writes it — the engine is replaceable, the format is the artifact.

```
harness (agent loop)  ──MCP / CLI──▶  afwe engine  ◀──reads/writes──▶  .afwe/  ◀──renders/edits──  Studio (Tauri / web)
        │                                  │
        └──────── edits code ──────────────┴──── tree-sitter analysis ────▶  your source tree
```

AFWE is **not** a harness: it never owns the agent loop. It tells the harness what it needs (contracts),
answers "what applies to what I am touching?" (passive guardrails), refuses what breaks the architecture
(active guardrails), and keeps the blueprint and the code honest with each other (drift + confidence policy).

![Studio](docs/screenshots/blueprint.png)

## What lives in `.afwe/`

| Path | What it is | Who writes it |
| --- | --- | --- |
| `afwe.yaml` | manifest: project, analyzer config, confidence policy, provenance policy | human / init |
| `blueprint/blueprint.yaml` | **Blueprint** — deterministic structural reality: tree of nodes, purpose, implementation mapping (files / globs / symbols) | human, agents, sync |
| `blueprint/relations.yaml` | declared relationships (`depends_on`, `uses`, …) with rationale, status `declared` / `inferred` | human, agents, sync |
| `blueprint/constraints.yaml` | structural rules: `must_not_depend`, `may_depend_only` ("Payments may depend on Identity but must not depend on UI") | human, agents |
| `memory/{decisions,constraints,exceptions,terminology,problems}/*.md` | **Memory** — knowledge as markdown with YAML scope (`applies_to` nodes, `files` globs, `symbols`, `tags`) | human, agents |
| `guardrails/passive/*.yaml` | statements + scope + exceptions that get inserted as micro-context | human, agents |
| `guardrails/active/*.yaml` | checks (`forbid_import`, `forbid_pattern`, `require_pattern`, `require_file`, `command`) enforced by `afwe verify` | human, agents |
| `workflows/*.yaml` | **Node-based workflows** — desired structure/behaviour, frozen in time, `origin: human / llm:<name>`, prompt kept as provenance | human, agents |
| `abstractions/*.yaml` | **Lenses** — regroup / re-root the blueprint view, zero codebase impact, may include workflows | human, agents |
| `contracts/*.yaml` | scoped instructions that tell the harness what AFWE needs (`default` coding contract, `architecture` contract) | human |
| `index/` | derived retrieval index (nodes ⇄ files ⇄ symbols ⇄ memory); `code.json` is git-ignored | engine |
| `state/` | drift findings, proposals, board (tasks + obligations), sync fingerprints | engine |
| `log/changes.jsonl` | append-only change log with origin and confidence | engine |

**Memory files = knowledge. Index = location/retrieval. Code = implementation.**
Identity is *file path + symbol identity + structural (AST) path + content fingerprint* — never line numbers,
so renames and moves are recognised instead of breaking references.

## Installation & Quick Start

AFWE is a standalone native binary that comes with the embedded web studio. Choose the method that best fits your stack:

### Method 1: Instant GitHub One-Liner (No Node, No Rust required)

**Linux & macOS:**
```bash
curl -fsSL https://raw.githubusercontent.com/StudioEaZY/afwe/main/scripts/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/StudioEaZY/afwe/main/scripts/install.ps1 | iex
```
*This downloads the latest native binary directly from GitHub Releases into `~/.afwe/bin/` and adds it to your PATH.*

---

### Method 2: Node.js / JavaScript / TypeScript projects (`npx` / `npm`)

Works on any Node.js project (Next.js, Vite, Nest, Remix, etc.) without compiling anything:
```bash
# Run on demand:
npx afwe init --name "My Product" --agents-md
npx afwe status
npx afwe studio

# Or install globally:
npm install -g afwe
afwe status
```

---

### Method 3: Direct Download from GitHub Releases

Download the pre-compiled binary for your system directly from [GitHub Releases](https://github.com/StudioEaZY/afwe/releases):
- **Windows (x64)**: `afwe-x86_64-pc-windows-msvc.exe`
- **Linux (x64)**: `afwe-x86_64-unknown-linux-gnu`
- **macOS (Apple Silicon)**: `afwe-aarch64-apple-darwin`
- **macOS (Intel)**: `afwe-x86_64-apple-darwin`

Rename the binary to `afwe` (or `afwe.exe`), make it executable (`chmod +x afwe`), and place it anywhere in your `PATH`.

---

### Method 4: Rust / Low-Level Developers (`cargo`)

If you work in Rust, C++, Go, or systems programming:

```bash
# Install directly from the GitHub repository:
cargo install --git https://github.com/StudioEaZY/afwe crates/afwe-cli

# Or if you already have the repository cloned:
cargo install --path crates/afwe-cli
```

---

### Basic Usage Flow
```bash
cd your-project
afwe init --name "My Product" --agents-md      # empty .afwe/ (+ contract block in AGENTS.md / CLAUDE.md)
afwe blueprint add Payments --kind subsystem --purpose "Charging users" --files 'src/payments/**'
afwe blueprint add Identity --purpose "The User model everyone shares" --files 'src/identity/**'
afwe blueprint relate Payments Identity --why "charges are per user"
afwe blueprint constrain Payments --must-not-depend UI --why "runs headless in workers"
afwe memory add decision "Sessions expire after 24h" --applies-to Authentication --tags auth
afwe sync                        # analyse code, build index, reconcile drift by confidence
afwe context src/payments/checkout.ts   # what an agent gets before touching that file
afwe verify --changed src/payments/checkout.ts   # exit 1 on violations
afwe studio                      # Studio in the browser (http://localhost:4242)
afwe mcp                         # MCP server on stdio for your harness
```

For an already-populated example: `cd examples/demo-project && afwe status` (see its README).

## The pieces

### Blueprint (structural reality)
Tree of nodes (`product → subsystem → module → component …`) with *purpose* ("why does it exist"),
implementation mapping and relations. Every file/symbol in the codebase resolves to exactly one node
(or shows up as **unmapped** drift). Edit it from the CLI, from an agent, or by dragging nodes in the Studio.

### Node-based workflows (desired behaviour)
Opal/ComfyUI-style graphs: `prompt → intent → design → step → component`, arbitrary depth, many in parallel,
each node with `origin`, `status`, `maps_to` (where it landed). The original prompt is kept verbatim as a
`prompt` node (`provenance.retain_prompts: true`) — the persisted thing is structured knowledge, not the chat.
`afwe workflow promote` turns component nodes into *planned* blueprint nodes.

### Lenses (custom abstractions)
"Show me the workspace as Library / Search / Preview / Tagging" — a lens regroups existing nodes under
virtual groups (and can attach workflows). Nothing in the code or blueprint changes.

### Memory + index
Five kinds of knowledge, each a markdown file with scope metadata. The index answers
"which decisions apply to `src/dashboard/Widget.tsx`?" without the agent reading everything.
Memory can be scoped to nodes, file globs, symbols, tags or the whole project, and can say what it
`enforces` (a constraint) or `supersedes`.

### Guardrails
Orthogonal to the tree: attach to nodes, relations, lenses, tags or file regions.
* **passive** — inserted into `afwe context` as micro-context (statement, reason, exceptions and *where the
  exceptions apply*, e.g. "no WebSockets in Dashboard — except realtime widgets").
* **active** — `afwe verify` runs them and fails: forbidden imports between nodes, forbidden/required
  patterns, required files, arbitrary commands (`npm test -- {files}`) when files in scope change.

### Contracts, Board, Tasks
`contracts/default.yaml`: *context → implement → verify → update memory/architecture → sync → log*.
`contracts/architecture.yaml`: *intent → node workflow → blueprint → implement → verify → update → sync → log*.
`afwe task start` opens a task on the Board with one obligation per step; the engine ticks them off as the
agent calls `afwe_context`, `afwe_verify`, `afwe_memory_add`, `afwe_sync`, `afwe_task_done` …
`afwe contract render` prints the block for `AGENTS.md` / `CLAUDE.md`.

### Drift and the confidence policy
`afwe sync` re-analyses the code and compares it with the blueprint. It **detects disagreement and never
invents agreement**:

| confidence | behaviour |
| --- | --- |
| ≥ 70 % | auto-reconcile + log |
| 50 – 70 % | auto-reconcile if nothing contradicts it, log with an *uncertainty marker* (Board item that stays until you `afwe board dismiss <id>` it) |
| < 50 % | **proposal** — `[Accept] [Revert] [Review impact]` in the Studio / `afwe proposals` |

Graph and files are two views of the same data; the Studio, `afwe status` and `afwe context` all warn
when they are out of sync.

## Studio

`afwe studio` (web, embedded in the binary) or the Tauri v2 desktop app in `apps/studio/src-tauri`.
Same React frontend, same engine, one API call (`call(op, params, origin)`).

* top bar — project · **Blueprint / Workflows / Board·Tasks / Memory** · sync state · drift · search (⌘K)
* left — architecture tree (main blueprint or a lens)
* centre — architecture graph: containment, declared / inferred / undeclared (code-only) / **violating** edges,
  drag a node onto another to move it, connect two nodes to declare a relation, double-click to expand
* right — context panel: *What is this · Why does it exist · What contains it · What depends on it ·
  What implements it · What constraints apply · What decisions apply · Guardrails*, plus an **Agent view**
  showing exactly the micro-context an agent would receive
* bottom — Zoom · Expand · Collapse · Show Implementation · Verify · Sync

| | |
| --- | --- |
| ![context](docs/screenshots/context-payments.png) | ![implementation](docs/screenshots/implementation.png) |
| ![workflows](docs/screenshots/workflows.png) | ![board](docs/screenshots/board.png) |

## Harness integration

* **MCP** (recommended): `afwe mcp` exposes `afwe_context`, `afwe_verify`, `afwe_sync`, `afwe_blueprint_edit`,
  `afwe_memory_add`, `afwe_workflow_upsert`, `afwe_task_start`, … — see [docs/INTEGRATION.md](docs/INTEGRATION.md)
  for Claude Code / Codex / Cursor configuration and hook examples.
* **CLI**: every op is also `afwe <command>` or raw `afwe call <op> '<json>'`; `--json` everywhere;
  `--origin llm:<name>` records who changed what.

## Languages

tree-sitter grammars for TypeScript / TSX / JavaScript / Python / Rust / Go / Java (symbols, imports,
structural identity, exports). Other languages (C, C++, C#, Ruby, PHP, Kotlin, …) are still indexed at file
level with regex import detection, so mapping, drift and guardrails work everywhere; adding a grammar is a
one-line `LangSpec` in `crates/afwe-core/src/analyze/langs.rs`.

## Repository layout

```
crates/afwe-core     engine: schema, store, analysis, mapping, index, context, verify, drift, sync, ops, api
crates/afwe-cli      `afwe` binary: CLI, MCP server (stdio), web Studio host (embeds apps/studio/web-dist)
apps/studio          React + React Flow Studio (Vite) · src-tauri = Tauri v2 desktop shell (own workspace)
examples/demo-project  a populated .afwe/ with deliberate drift, a violation, a lens and a workflow
docs/                SPEC.md (format) · ARCHITECTURE.md (engine) · CONTRACTS.md · INTEGRATION.md · screenshots/
scripts/             build.sh (frontend + release binary) · dev.sh (Vite + engine API) · demo.sh (CLI tour)
```

## Tests

```bash
cargo test            # analyzer/mapping unit tests + end-to-end tests in crates/afwe-core/tests/end_to_end.rs
```

The end-to-end tests build a throw-away project in a temp directory and exercise the whole loop through the
same `api::call` surface the CLI, MCP server and Studio use: blueprint → sync → context → verify (violation +
guardrail), the confidence policy (0.9 auto-map vs 0.3 proposal), rename detection without line numbers, and
contract obligations / lenses / workflows.

## Status

MVP of everything described above. Deliberately out of scope for now: optimising the onboarding of large
existing codebases (`afwe bootstrap` proposes a first blueprint from the directory structure, nothing more),
a visual Excalidraw-style explanation layer, and multi-user sync. Licence: MIT.
