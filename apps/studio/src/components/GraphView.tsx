import { useCallback, useEffect, useMemo, useState } from "react";
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, MarkerType, useReactFlow, Node, Edge, NodeProps, useNodesState, useEdgesState, BackgroundVariant } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useStore, kindIcon } from "../store";
import { api, Graph } from "../api";

// ───────── model: what is visible right now (main blueprint or a lens) ─────────

interface VNode {
  id: string;
  name: string;
  kind: string;
  virtual: boolean; // lens group
  file: boolean; // implementation node
  bp?: string; // blueprint id (for real nodes)
  children: string[];
  depth: number;
  hasChildren: boolean;
  data: any;
}

const NODE_W = 210;
const NODE_H = 66;
const FILE_W = 190;
const FILE_H = 34;
const GAP_X = 26;
const GAP_Y = 96;

function buildModel(graph: Graph, lensId: string | null, expanded: Set<string>, showImpl: boolean): { nodes: Map<string, VNode>; roots: string[] } {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const nodes = new Map<string, VNode>();
  const addBp = (id: string, depth: number): string | null => {
    const n = byId.get(id);
    if (!n) return null;
    const open = expanded.has(id);
    const v: VNode = { id, name: n.name, kind: n.kind, virtual: false, file: false, bp: id, children: [], depth, hasChildren: n.children.length > 0, data: n };
    nodes.set(id, v);
    if (open) {
      for (const c of n.children) {
        const cid = addBp(c, depth + 1);
        if (cid) v.children.push(cid);
      }
    }
    if (showImpl) {
      // implementation view: every visible node lists the files that implement it
      const files = n.file_list.slice(0, 8);
      for (const f of files) {
        const fid = `file:${id}:${f}`;
        nodes.set(fid, { id: fid, name: f.split("/").slice(-2).join("/"), kind: "file", virtual: false, file: true, children: [], depth: depth + 1, hasChildren: false, data: { path: f, node: id } });
        v.children.push(fid);
      }
      if (n.file_list.length > 8) {
        const fid = `file:${id}:more`;
        nodes.set(fid, { id: fid, name: `+${n.file_list.length - 8} more files`, kind: "file", virtual: false, file: true, children: [], depth: depth + 1, hasChildren: false, data: { path: null, node: id } });
        v.children.push(fid);
      }
    }
    return id;
  };
  const roots: string[] = [];
  const lens = lensId ? graph.lenses.find((l) => l.id === lensId) : null;
  if (lens) {
    const addGroup = (g: any, depth: number): string => {
      const v: VNode = { id: g.id, name: g.name, kind: "group", virtual: true, file: false, children: [], depth, hasChildren: true, data: g };
      nodes.set(g.id, v);
      for (const c of g.children || []) {
        if (c.virtual) v.children.push(addGroup(c, depth + 1));
        else {
          const id = addBp(c.id, depth + 1);
          if (id) v.children.push(id);
        }
      }
      return g.id;
    };
    for (const g of lens.view.groups || []) roots.push(addGroup(g, 0));
  } else {
    for (const n of graph.nodes.filter((n) => !n.parent)) {
      const id = addBp(n.id, 0);
      if (id) roots.push(id);
    }
  }
  return { nodes, roots };
}

/**
 * Compact top-down tree layout.
 * Children that have visible child *nodes* ("branches") are placed in a row beneath the parent, centred under it.
 * Leaf children (no children, or only implementation files) are stacked in one column to the right of the
 * branches, org-chart style; their files are listed indented underneath them. Wide subsystems stay readable and
 * "Show Implementation" does not explode the width.
 */
interface Geom { w: number; h: number; selfDx: number; colDx: number; childDy: number; branches: string[]; leaves: string[] }
const STACK_INDENT = 34;
const STACK_GAP = 10;
const LEAF_GAP_Y = 44;
const FILE_INDENT = 26;

function layout(model: { nodes: Map<string, VNode>; roots: string[] }): { pos: Map<string, { x: number; y: number }>; stacked: Set<string>; nested: Set<string> } {
  const pos = new Map<string, { x: number; y: number }>();
  const stacked = new Set<string>();
  const nested = new Set<string>();
  const size = (n: VNode) => (n.file ? { w: FILE_W, h: FILE_H } : { w: NODE_W, h: NODE_H });
  const filesOf = (id: string) => model.nodes.get(id)!.children.filter((c) => model.nodes.get(c)!.file);
  const isLeafish = (id: string) => model.nodes.get(id)!.children.every((c) => model.nodes.get(c)!.file);
  // height / width of one entry in a leaf column (node + its indented files)
  const entry = (id: string) => {
    const n = model.nodes.get(id)!;
    const sz = size(n);
    const files = n.file ? [] : filesOf(id);
    return { h: sz.h + files.length * (FILE_H + STACK_GAP), w: Math.max(sz.w, files.length ? FILE_INDENT + FILE_W : 0), files };
  };
  const memo = new Map<string, Geom>();
  const geom = (id: string): Geom => {
    if (memo.has(id)) return memo.get(id)!;
    const n = model.nodes.get(id)!;
    const self = size(n);
    const branches = n.children.filter((c) => !isLeafish(c));
    const leaves = n.children.filter((c) => isLeafish(c));
    let g: Geom;
    if (n.children.length === 0) {
      g = { w: self.w + GAP_X, h: self.h, selfDx: GAP_X / 2, colDx: 0, childDy: 0, branches, leaves };
    } else {
      const branchesW = branches.reduce((s, c) => s + geom(c).w, 0);
      const branchesH = branches.length ? Math.max(...branches.map((c) => geom(c).h)) : 0;
      const selfDx = branches.length ? Math.max(branchesW / 2, self.w / 2 + GAP_X / 2) - self.w / 2 : GAP_X / 2;
      const selfCenter = selfDx + self.w / 2;
      let w = Math.max(branchesW, selfDx + self.w + GAP_X);
      let colDx = 0;
      let colH = 0;
      if (leaves.length) {
        const leafW = Math.max(...leaves.map((c) => entry(c).w));
        colDx = Math.max(branchesW + STACK_INDENT, selfCenter + 18);
        colH = leaves.reduce((s, c) => s + entry(c).h + STACK_GAP, 0) - STACK_GAP;
        w = Math.max(w, colDx + leafW + GAP_X);
      }
      const childDy = self.h + (branches.length ? GAP_Y : LEAF_GAP_Y);
      g = { w, h: childDy + Math.max(branchesH, colH), selfDx, colDx, childDy, branches, leaves };
    }
    memo.set(id, g);
    return g;
  };
  const place = (id: string, x0: number, y0: number) => {
    const g = geom(id);
    pos.set(id, { x: x0 + g.selfDx, y: y0 });
    let cx = x0;
    for (const c of g.branches) {
      place(c, cx, y0 + g.childDy);
      cx += geom(c).w;
    }
    let cy = y0 + g.childDy;
    for (const c of g.leaves) {
      pos.set(c, { x: x0 + g.colDx, y: cy });
      stacked.add(c);
      const e = entry(c);
      let fy = cy + size(model.nodes.get(c)!).h + STACK_GAP;
      for (const f of e.files) {
        pos.set(f, { x: x0 + g.colDx + FILE_INDENT, y: fy });
        nested.add(f);
        fy += FILE_H + STACK_GAP;
      }
      cy += e.h + STACK_GAP;
    }
  };
  let x = 0;
  for (const r of model.roots) {
    place(r, x, 0);
    x += geom(r).w + GAP_X * 2;
  }
  return { pos, stacked, nested };
}

// ───────── custom node ─────────

function BlueprintNodeView({ data, selected }: NodeProps) {
  const d = data as any;
  const v: VNode = d.v;
  if (v.file) {
    return (
      <div className={`fnode ${selected ? "sel" : ""} ${d.unmapped ? "unmapped" : ""} ${d.nested ? "nested" : ""}`} title={v.data.path || ""}>
        <Handle type="target" position={Position.Top} id="top" />
        <Handle type="target" position={Position.Left} id="left" />
        <span className="fname">{v.name}</span>
      </div>
    );
  }
  const n = v.data;
  return (
    <div className={`bnode ${selected ? "sel" : ""} ${v.virtual ? "virtual" : ""} ${d.violation ? "violation" : ""} ${n.status && n.status !== "active" ? n.status : ""}`}>
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <div className="bhead">
        <span className="bicon">{kindIcon(v.kind)}</span>
        <span className="bname" title={n.path || n.name}>
          {v.name}
        </span>
        {v.hasChildren && (
          <span className={`bchev ${d.expanded ? "open" : ""}`} onClick={(e) => { e.stopPropagation(); d.toggle(); }}>
            ▸
          </span>
        )}
      </div>
      <div className="bmeta">
        <span className="kind">{v.kind}</span>
        {!v.virtual && <span title="files">{n.files} f</span>}
        {!v.virtual && n.memory?.length > 0 && <span title="memory entries">{n.memory.length} m</span>}
        {!v.virtual && n.guardrails?.length > 0 && <span title="guardrails">{n.guardrails.length} g</span>}
        {n.status && n.status !== "active" && <span className="st">{n.status}</span>}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { bp: BlueprintNodeView };

// ───────── graph ─────────

export function GraphView() {
  const { graph, expanded, toggle, select, selected, selectFile, showImpl, lens, run, notify } = useStore();
  const rf = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [edgeMode, setEdgeMode] = useState<"declared" | "all">("all");

  const model = useMemo(() => (graph ? buildModel(graph, lens, expanded, showImpl) : null), [graph, lens, expanded, showImpl]);

  useEffect(() => {
    if (!graph || !model) return;
    const { pos, stacked, nested } = layout(model);
    const visible = new Set(model.nodes.keys());
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const toVisible = (id: string): string | null => {
      let cur: string | null = id;
      while (cur) {
        if (visible.has(cur) && !model.nodes.get(cur)!.file) return cur;
        cur = byId.get(cur)?.parent ?? null;
      }
      return null;
    };
    const violations = new Set<string>();
    const unmapped = new Set(graph.unmapped);
    const es: Edge[] = [];
    const seen = new Set<string>();
    // containment
    for (const v of model.nodes.values()) {
      for (const c of v.children) {
        if (nested.has(c)) continue; // files listed under their node: indentation shows containment
        es.push({ id: `c:${v.id}->${c}`, source: v.id, target: c, targetHandle: stacked.has(c) ? "left" : "top", type: "smoothstep", pathOptions: { borderRadius: 8 }, className: "e-contain", selectable: false } as Edge);
      }
    }
    // declared relations, rolled up to visible nodes
    for (const r of graph.relations) {
      const a = toVisible(r.from);
      const b = toVisible(r.to);
      if (!a || !b || a === b) continue;
      const key = `r:${a}->${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      es.push({ id: key, source: a, target: b, targetHandle: "top", type: "default", className: r.status === "inferred" ? "e-inferred" : "e-declared", label: r.kind === "depends_on" ? undefined : r.kind, markerEnd: { type: MarkerType.ArrowClosed }, data: { rationale: r.rationale } });
    }
    // code edges: undeclared + violations
    for (const ce of graph.code_edges) {
      const a = toVisible(ce.from);
      const b = toVisible(ce.to);
      if (!a || !b || a === b) continue;
      if (ce.violation) {
        violations.add(a);
        violations.add(b);
        const key = `v:${a}->${b}`;
        if (!seen.has(key)) {
          seen.add(key);
          es.push({ id: key, source: a, target: b, targetHandle: "top", className: "e-violation", label: `✗ ${ce.violation}`, markerEnd: { type: MarkerType.ArrowClosed }, animated: true });
        }
        continue;
      }
      if (edgeMode === "all" && !ce.declared && !seen.has(`r:${a}->${b}`)) {
        const key = `u:${a}->${b}`;
        if (!seen.has(key)) {
          seen.add(key);
          es.push({ id: key, source: a, target: b, targetHandle: "top", className: "e-undeclared", label: `${ce.count}× undeclared`, markerEnd: { type: MarkerType.ArrowClosed } });
        }
      }
    }
    const ns: Node[] = [...model.nodes.values()].map((v) => ({
      id: v.id,
      type: "bp",
      position: pos.get(v.id)!,
      data: { v, expanded: expanded.has(v.id), toggle: () => toggle(v.id), violation: violations.has(v.id), unmapped: v.file && v.data.path && unmapped.has(v.data.path), nested: nested.has(v.id) },
      draggable: !v.virtual && !v.file,
      selected: v.id === selected,
      style: v.file ? { width: FILE_W, height: FILE_H } : { width: NODE_W, height: NODE_H },
    }));
    setNodes(ns);
    setEdges(es);
    setTimeout(() => rf.fitView({ padding: 0.12, duration: 300 }), 30);
  }, [graph, model, edgeMode]);

  useEffect(() => {
    setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === selected })));
  }, [selected]);

  useEffect(() => {
    const fit = () => rf.fitView({ padding: 0.2, duration: 300 });
    window.addEventListener("afwe:fit", fit);
    return () => window.removeEventListener("afwe:fit", fit);
  }, []);

  const onNodeClick = useCallback((_: any, n: Node) => {
    const v: VNode = (n.data as any).v;
    if (v.file) {
      select(v.data.node);
      if (v.data.path) selectFile(v.data.path);
    } else if (!v.virtual) select(v.id);
    else toggle(v.id);
  }, []);

  const onNodeDoubleClick = useCallback((_: any, n: Node) => {
    const v: VNode = (n.data as any).v;
    if (!v.file) toggle(v.id);
  }, []);

  // Drag & drop = structural edit: drop a node onto another node to move it there.
  const onNodeDragStop = useCallback(
    async (_: any, n: Node) => {
      const v: VNode = (n.data as any).v;
      if (v.file || v.virtual || !graph) return;
      const hits = rf.getIntersectingNodes(n).filter((h) => {
        const hv: VNode = (h.data as any).v;
        return !hv.file && !hv.virtual && hv.id !== v.id;
      });
      const target = hits[0];
      const relayout = () => useStore.getState().refresh();
      if (!target) return relayout();
      const tv: VNode = (target.data as any).v;
      const src = graph.nodes.find((x) => x.id === v.id)!;
      if (src.parent === tv.id) return relayout();
      // refuse moving under own descendant
      let cur: string | null = tv.id;
      while (cur) {
        if (cur === v.id) {
          notify("Cannot move a node under its own descendant");
          return relayout();
        }
        cur = graph.nodes.find((x) => x.id === cur)?.parent ?? null;
      }
      if (confirm(`Move "${src.path}" under "${tv.data.path}"?\n\nThis is a structural edit of the blueprint (logged).`)) {
        await run("Moving node", () => api.bp.move(v.id, tv.id));
        notify(`Moved ${src.name} → ${tv.name}`);
      } else relayout();
    },
    [graph]
  );

  // Connect two nodes = declare a relationship
  const onConnect = useCallback(
    async (c: any) => {
      if (!graph) return;
      const a = model?.nodes.get(c.source);
      const b = model?.nodes.get(c.target);
      if (!a || !b || a.file || b.file || a.virtual || b.virtual) return;
      const why = prompt(`Declare "${a.name}" depends_on "${b.name}". Why? (optional)`);
      if (why === null) return;
      await run("Declaring relation", () => api.bp.relate(a.id, b.id, "depends_on", why || undefined));
    },
    [graph, model]
  );

  if (!graph) return null;
  return (
    <section className="canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onPaneClick={() => selectFile(null)}
        fitView
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
        nodesConnectable
        elevateNodesOnSelect
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#2a2f3a" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor={(n) => ((n.data as any).v?.file ? "#3a3f4b" : (n.data as any).violation ? "#c0392b" : "#4b5563")} maskColor="rgba(10,12,16,0.7)" />
      </ReactFlow>
      <div className="legend">
        <span className="l declared">declared</span>
        <span className="l inferred">inferred</span>
        <span className="l undeclared">undeclared (code only)</span>
        <span className="l violation">violation</span>
        <label>
          <input type="checkbox" checked={edgeMode === "all"} onChange={(e) => setEdgeMode(e.target.checked ? "all" : "declared")} /> show code-only edges
        </label>
      </div>
    </section>
  );
}
