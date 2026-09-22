# AFWE Studio — desktop shell (Tauri v2)

This directory is a **separate Cargo workspace** from the engine (`../../../Cargo.toml`) so the core
engine and CLI never depend on desktop toolchains.

```bash
# prerequisites: Rust, Node 18+, Tauri v2 system deps (https://v2.tauri.app/start/prerequisites/)
cd apps/studio
npm install
npm run tauri dev            # dev: Vite on :5173 + native window
npm run tauri build          # produces platform bundles under src-tauri/target/release/bundle
```

Open a project with `afwe-studio /path/to/project`, `AFWE_PROJECT=/path/to/project`, or the **open…** button.

The frontend calls exactly one command, `call(op, params, origin)`, which is the same JSON surface the
CLI (`afwe call`), the MCP server and the web host (`afwe studio`, `POST /api/call`) use.
