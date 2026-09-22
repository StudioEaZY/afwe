# afwe

> **Architecture-First Workspace Engine (AFWE)**

AFWE is a persistent, multi-level, two-way architecture engine for codebases. It sits between an LLM harness (Claude Code, Cursor, Codex, etc.) and your workspace, keeping blueprints, memory, guardrails, and implementation code aligned.

## Quick Start via npm / npx

You do not need to install Rust or compile from source to use AFWE.

### Run immediately with `npx`
```bash
# Initialize AFWE in your current project
npx afwe init --name "My Project" --agents-md

# Check project blueprint status
npx afwe status

# Run active guardrails / verification
npx afwe verify

# Open the embedded Studio UI in your browser (http://localhost:4242)
npx afwe studio
```

### Install globally with `npm`
```bash
npm install -g afwe

# Now available directly on your PATH:
afwe init --name "My Product"
afwe status
afwe verify
afwe studio
```

## Features

- **Blueprint**: Structural architecture tree (subsystems, modules, components) mapped directly to files and AST symbols.
- **Micro-context & Guardrails**: Passive guardrails feed context to AI coding agents; active guardrails verify changes against architecture constraints before merge.
- **Embedded Web Studio**: Zero-dependency embedded web interface launched directly via `afwe studio` on localhost:4242.
- **Tauri v2 Desktop App**: Fast desktop companion app.
- **Model Context Protocol (MCP)**: Native stdio MCP server for agent loops (`afwe mcp`).

## Links

- GitHub Repository: [https://github.com/StudioEaZY/afwe](https://github.com/StudioEaZY/afwe)
