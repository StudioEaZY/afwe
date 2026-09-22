// One API for both shells:
//  - inside Tauri v2  → invoke("call", { op, params }) handled by src-tauri (same Rust engine)
//  - in a browser     → POST /api/call served by `afwe studio`
// Ops are the engine's stable op names (see crates/afwe-core/src/api.rs).

export type Json = any;

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export const isTauri = () => typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

let tauriInvoke: null | ((cmd: string, args?: Record<string, unknown>) => Promise<any>) = null;

async function getInvoke() {
  if (tauriInvoke) return tauriInvoke;
  const mod = await import("@tauri-apps/api/core");
  tauriInvoke = mod.invoke;
  return tauriInvoke;
}

export async function call(op: string, params: Json = {}, origin = "human"): Promise<Json> {
  if (isTauri()) {
    const invoke = await getInvoke();
    return invoke("call", { op, params, origin });
  }
  const res = await fetch("/api/call", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ op, params, origin }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error || "engine error");
  return body.result;
}

/** Tauri-only: pick another project folder. In the browser the project is fixed by `afwe studio`. */
export async function openProjectDialog(): Promise<string | null> {
  if (!isTauri()) return null;
  const invoke = await getInvoke();
  return invoke("open_project_dialog");
}

export async function currentProject(): Promise<string | null> {
  if (!isTauri()) return null;
  const invoke = await getInvoke();
  return invoke("current_project");
}

// ── typed helpers used by the UI ──

export interface GraphNode {
  id: string;
  name: string;
  kind: string;
  path: string;
  parent: string | null;
  depth: number;
  purpose?: string | null;
  description?: string | null;
  status?: string | null;
  tags: string[];
  children: string[];
  files: number;
  file_list: string[];
  symbols: number;
  memory: string[];
  guardrails: string[];
  implements: { files?: string[]; symbols?: string[] };
  origin?: string | null;
}

export interface GraphRelation {
  from: string;
  to: string;
  kind: string;
  status: string;
  rationale?: string | null;
  evidence: number;
  confidence?: number | null;
  origin?: string | null;
}

export interface CodeEdge {
  from: string;
  to: string;
  count: number;
  declared: boolean;
  violation?: string | null;
}

export interface Graph {
  project: { name: string; description?: string | null; root: string };
  sync: { status: string; last_sync?: string | null };
  nodes: GraphNode[];
  relations: GraphRelation[];
  code_edges: CodeEdge[];
  constraints: any[];
  memory: Record<string, any>;
  guardrails: any[];
  workflows: { id: string; title: string; status: string; nodes: number; targets: string[] }[];
  lenses: { id: string; name: string; description?: string | null; view: any }[];
  proposals: any[];
  board_open: number;
  files: { path: string; language: string; node: string | null; symbols: number; imports: string[] }[];
  unmapped: string[];
  policy: { auto_reconcile_min: number; soft_reconcile_min: number };
}

export const api = {
  graph: (): Promise<Graph> => call("graph"),
  status: () => call("status"),
  node: (node: string) => call("blueprint.get", { node }),
  context: (params: Json) => call("context", { ...params, mark_step: false }),
  verify: (files: string[] = []) => call("verify", { files }),
  sync: (dry_run = false) => call("sync", { dry_run }),
  drift: () => call("drift"),
  search: (q: string) => call("search", { q }),
  fileRead: (path: string) => call("file.read", { path }),
  bp: {
    add: (p: Json) => call("blueprint.add", p),
    move: (node: string, parent: string | null) => call("blueprint.move", { node, parent }),
    update: (node: string, patch: Json) => call("blueprint.update", { node, patch }),
    remove: (node: string) => call("blueprint.remove", { node }),
    map: (node: string, files: string[], symbols: string[] = []) => call("blueprint.map", { node, files, symbols }),
    unmap: (node: string, files: string[], symbols: string[] = []) => call("blueprint.unmap", { node, files, symbols }),
    relate: (from: string, to: string, kind = "depends_on", rationale?: string) => call("blueprint.relate", { from, to, kind, rationale }),
    unrelate: (from: string, to: string) => call("blueprint.unrelate", { from, to }),
    constrain: (p: Json) => call("blueprint.constrain", p),
    unconstrain: (id: string) => call("blueprint.unconstrain", { id }),
  },
  memory: {
    list: (p: Json = {}) => call("memory.list", p),
    get: (id: string) => call("memory.get", { id }),
    add: (p: Json) => call("memory.add", p),
    update: (id: string, patch: Json) => call("memory.update", { id, patch }),
    remove: (id: string) => call("memory.remove", { id }),
  },
  guardrail: {
    list: () => call("guardrail.list"),
    add: (guardrail: Json) => call("guardrail.add", { guardrail }),
    remove: (id: string) => call("guardrail.remove", { id }),
  },
  workflow: {
    list: () => call("workflow.list"),
    get: (id: string) => call("workflow.get", { id }),
    new: (p: Json) => call("workflow.new", p),
    upsert: (workflow: Json) => call("workflow.upsert", { workflow }),
    set: (workflow: string, node: string | null, patch: Json) => call("workflow.set", { workflow, node, patch }),
    remove: (id: string) => call("workflow.remove", { id }),
    promote: (id: string, parent?: string) => call("workflow.promote", { id, parent }),
  },
  lens: {
    save: (lens: Json) => call("lens.save", { lens }),
    remove: (id: string) => call("lens.remove", { id }),
  },
  board: () => call("board.get"),
  boardDismiss: (id: string) => call("board.dismiss", { id }),
  contracts: () => call("contract.list"),
  contractRender: () => call("contract.render"),
  task: {
    start: (p: Json) => call("task.start", p),
    done: (task: string, message?: string) => call("task.done", { task, message }),
  },
  proposals: () => call("proposals.list"),
  proposal: (id: string, action: "accept" | "revert" | "review") => call("proposal.resolve", { id, action }),
  log: (tail = 50) => call("log.get", { tail }),
};
