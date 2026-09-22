# Harness integration

AFWE sits *between* the harness and the IDE. It never runs the agent loop; it is called by it. Two doors:

* **MCP** — `afwe mcp` (stdio, JSON-RPC 2.0). Best for Claude Code, Codex, Cursor, Windsurf, Zed, …
* **CLI** — `afwe …` with `--json`. Best for hooks, CI and shell-only agents.

Both go through the same engine ops, so anything you can do in one you can do in the other
(`afwe call ops` lists them).

## 1. MCP

### Claude Code

```bash
# project-scoped (writes .mcp.json in the repo — commit it so everyone gets it)
claude mcp add --scope project afwe -- afwe mcp --origin-name claude-code
```

or by hand in `.mcp.json`:

```json
{
  "mcpServers": {
    "afwe": {
      "command": "afwe",
      "args": ["mcp", "--origin-name", "claude-code"],
      "env": {}
    }
  }
}
```

`afwe mcp` discovers `.afwe/` upwards from its working directory (Claude Code starts servers in the
project root). Pass `-C /path/to/project` to be explicit.

### Codex CLI (`~/.codex/config.toml`)

```toml
[mcp_servers.afwe]
command = "afwe"
args = ["mcp", "--origin-name", "codex"]
```

### Cursor (`.cursor/mcp.json`) / Windsurf / others

```json
{ "mcpServers": { "afwe": { "command": "afwe", "args": ["mcp", "--origin-name", "cursor"] } } }
```

### Tools exposed

| tool | op | purpose |
| --- | --- | --- |
| `afwe_status` | `status` | sync state, sizes, open items |
| `afwe_context` | `context` | **passive guardrail** — micro-context for files / symbol / node (+ contract) |
| `afwe_verify` | `verify` | **active guardrail** — constraints, checks, drift for changed files; `ok=false` ⇒ fix |
| `afwe_sync` | `sync` | analyse, reconcile by confidence, propose the rest |
| `afwe_drift` | `drift` | findings with confidence, nothing applied |
| `afwe_search` | `search` | nodes, memory, guardrails, workflows, files, symbols |
| `afwe_blueprint_get` | `blueprint.get` | tree or one node in full |
| `afwe_blueprint_edit` | `blueprint.edit` | `add / move / update / remove / map / unmap / relate / unrelate / constrain / unconstrain` |
| `afwe_memory_add` / `afwe_memory_find` / `afwe_memory_update` | `memory.*` | knowledge with scope |
| `afwe_guardrail_add` | `guardrail.add` | passive or active guardrail |
| `afwe_workflow_list` / `afwe_workflow_get` / `afwe_workflow_upsert` / `afwe_workflow_promote` | `workflow.*` | node-based workflows |
| `afwe_lens_get` | `lens.get` | resolve a custom abstraction |
| `afwe_contract` | `contract.get` | contract for a task kind |
| `afwe_task_start` / `afwe_task_done` / `afwe_board` | `task.*`, `board.get` | Board obligations |
| `afwe_proposals` / `afwe_proposal_resolve` | `proposals.*` | accept / revert / review impact |
| `afwe_log` | `log.add` | append a note |

Resources: `afwe://readme`, `afwe://blueprint`, `afwe://relations`, `afwe://constraints`,
`afwe://contract`, `afwe://memory/<id>`.

Every mutation made through MCP is logged with origin `llm:<client name>` (from `initialize.clientInfo`)
unless `--origin-name` overrides it, so the change log and workflow nodes always say who did what.

### A typical agent session (what the contract asks for)

```
afwe_task_start   {title: "Make widget titles editable", files: ["src/dashboard/Widget.tsx"]}
afwe_context      {files: ["src/dashboard/Widget.tsx"]}         → node Dashboard, decision "lighthouse-exception",
                                                                  guardrail "no WebSockets in Dashboard (except realtime widgets)"
… edit code …
afwe_verify       {files: ["src/dashboard/Widget.tsx"]}          → ok: true
afwe_memory_add   {kind: "decision", title: "Widget titles are inline-editable", applies_to: ["dashboard"], body: "…"}
afwe_sync         {}
afwe_task_done    {message: "Inline editing of widget titles; no new deps."}
```

## 2. CLI + hooks

### Claude Code hooks (`.claude/settings.json`)

Passive guardrail on every edit, active guardrail after every edit:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [{ "type": "command", "command": "jq -r '.tool_input.file_path' | xargs -r afwe context --kind code" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [{ "type": "command", "command": "jq -r '.tool_input.file_path' | xargs -r afwe verify --no-drift --changed" }]
      }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "afwe sync --json > /dev/null; afwe board" }] }
    ]
  }
}
```

`afwe verify` exits `1` on errors, which makes the hook surface the violation to the agent as an error it
has to deal with — that is the "use errors to force the agent's behaviour" part of active guardrails.

### Git hooks / CI

```bash
# .git/hooks/pre-commit
changed=$(git diff --cached --name-only --diff-filter=ACMR)
[ -n "$changed" ] && afwe verify --no-commands --changed $changed
```

```yaml
# CI
- run: afwe sync --check            # exit 1 if blueprint and code are out of sync
- run: afwe verify                  # exit 1 on constraint / active guardrail errors
```

### AGENTS.md / CLAUDE.md

```bash
afwe contract render --write AGENTS.md     # inserts/updates the <!-- afwe:begin --> … <!-- afwe:end --> block
afwe init --agents-md                      # same, at init time (also CLAUDE.md if present)
```

## 3. Origins and provenance

* CLI default origin is `human`; pass `--origin llm:my-agent` when a script acts on behalf of a model.
* MCP default is `llm:<clientInfo.name>`.
* Workflow nodes, blueprint nodes, memory entries and log lines all carry `origin`. Prompts are kept
  verbatim as `prompt` workflow nodes while `provenance.retain_prompts` is `true`.

## 4. Studio while agents work

`afwe studio` serves the UI at `http://localhost:4242` and reads `.afwe/` on every call, so what an agent
changes over MCP shows up on the next refresh/sync; the top bar turns amber ("out of sync") whenever code
or `.afwe/` changed since the last `afwe sync`. The desktop app (`apps/studio/src-tauri`) behaves the same
without a port.

## 5. Raw access

```bash
afwe call context '{"files":["src/payments/checkout.ts"]}'
afwe call blueprint.edit '{"op":"constrain","from":"payments","rule":"must_not_depend","to":["ui"],"rationale":"headless"}' --origin llm:script
curl -s -X POST localhost:4242/api/call -H 'content-type: application/json' -d '{"op":"status"}'
```
