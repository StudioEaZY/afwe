import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  useReactFlow,
  Node,
  Edge,
  NodeProps,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Hand } from "lucide-react";
import { useStore, kindIcon } from "../store";
import { api, Graph } from "../api";
import { buildHierarchyTree, findNodeById } from "../lib/hierarchy";
import { useSpacebarPan } from "../lib/semanticZoomEngine";

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

const NODE_W = 224;
const NODE_H = 74;
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

  // Group roots into balanced architectural tiers rather than one infinite horizontal line at y=0.
  // Tier 0: Presentation (Web, Mobile, Client, UI, Frontend)
  // Tier 1: Application / Services (Backend, Services, API, Workers, Jobs)
  // Tier 2: Domain / Core (Core, Domain, Models, Business)
  // Tier 3: Foundation / Data / Platform (Data, Shared, Infrastructure, DB, Storage, Lib)
  const tierOfRoot = (id: string): number => {
    const name = (model.nodes.get(id)?.name || id).toLowerCase();
    const tags = ((model.nodes.get(id)?.data?.tags as string[]) || []).map((t) => t.toLowerCase());
    for (const t of tags) {
      if (t.includes("tier:0") || t.includes("tier:presentation")) return 0;
      if (t.includes("tier:1") || t.includes("tier:app") || t.includes("tier:service")) return 1;
      if (t.includes("tier:2") || t.includes("tier:core") || t.includes("tier:domain")) return 2;
      if (t.includes("tier:3") || t.includes("tier:data") || t.includes("tier:foundation")) return 3;
    }
    if (/web|mobile|client|ui|frontend|app|presentation/i.test(name)) return 0;
    if (/service|api|worker|job|gateway/i.test(name)) return 1;
    if (/core|domain|model|entity|business/i.test(name)) return 2;
    if (/backend/i.test(name)) return 1;
    if (/data|shared|infra|db|storage|platform|foundation|common|util/i.test(name)) return 3;
    return 1;
  };

  const rootsByTier: Map<number, string[]> = new Map();
  for (const r of model.roots) {
    const t = tierOfRoot(r);
    if (!rootsByTier.has(t)) rootsByTier.set(t, []);
    rootsByTier.get(t)!.push(r);
  }

  // Sort present tiers in logical top-down architectural order
  const activeTiers = Array.from(rootsByTier.keys()).sort((a, b) => a - b);
  let curY = 0;
  for (const tierIdx of activeTiers) {
    const tierRoots = rootsByTier.get(tierIdx)!;
    let curX = 0;
    let maxHInTier = 0;
    for (const r of tierRoots) {
      place(r, curX, curY);
      const g = geom(r);
      curX += g.w + GAP_X * 2;
      if (g.h > maxHInTier) maxHInTier = g.h;
    }
    curY += maxHInTier + GAP_Y * 1.5;
  }

  return { pos, stacked, nested };
}

// ───────── custom node ─────────

function BlueprintNodeView({ data, selected }: NodeProps) {
  const d = data as any;
  const v: VNode = d.v;
  const { scene } = useStore();
  if (v.file) {
    return (
      <div
        className={`fnode ${selected ? "sel" : ""} ${d.unmapped ? "unmapped" : ""} ${d.nested ? "nested" : ""}`}
        title={v.data.path || ""}
        style={{
          background: "var(--panel)",
          border: selected ? "1px solid var(--accent)" : "1px solid var(--line)",
          borderRadius: "6px",
          color: "var(--ink)",
          fontFamily: "var(--font-mono, monospace)",
          padding: "4px 8px",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "11px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        }}
      >
        <Handle type="target" position={Position.Top} id="top" />
        <Handle type="target" position={Position.Left} id="left" />
        <span className="fname" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {v.name}
        </span>
      </div>
    );
  }
  const n = v.data;
  const sceneNode = scene?.nodes.find((sn) => sn.id === n.id || sn.dot_path.endsWith(n.id));
  const delta = sceneNode?.components.delta;
  const gov = sceneNode?.components.governance;
  const lease = sceneNode?.components.lease;

  return (
    <div
      className={`bnode ${selected ? "sel" : ""} ${v.virtual ? "virtual" : ""} ${d.violation ? "violation" : ""} ${n.status && n.status !== "active" ? n.status : ""} ${delta ? `delta-${delta.status}` : ""}`}
      style={{
        background: "var(--panel)",
        border: selected ? "2px solid var(--accent)" : d.violation ? "2px solid var(--red)" : "1px solid var(--line)",
        borderRadius: "10px",
        padding: "8px 12px",
        color: "var(--ink)",
        fontFamily: "'IBM Plex Sans', sans-serif",
        boxShadow: selected ? "0 4px 16px rgba(0,0,0,0.12)" : "0 2px 8px rgba(0,0,0,0.06)",
      }}
    >
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <div className="bhead" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", overflow: "hidden" }}>
          <span className="bicon" style={{ display: "inline-flex", color: "var(--accent)" }}>{kindIcon(v.kind)}</span>
          <span className="bname" style={{ fontWeight: 600, fontSize: "13px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={sceneNode?.dot_path || n.path || n.name}>
            {v.name}
          </span>
        </div>
        {v.hasChildren && (
          <span
            className={`bchev ${d.expanded ? "open" : ""}`}
            style={{ cursor: "pointer", padding: "2px 6px", borderRadius: "4px", background: "var(--bg)", fontSize: "11px", fontWeight: "bold" }}
            onClick={(e) => { e.stopPropagation(); d.toggle(); }}
          >
            {d.expanded ? "▾" : "▸"}
          </span>
        )}
      </div>
      <div className="bmeta" style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "6px", fontSize: "11px", color: "var(--mute)" }}>
        <span className="kind" style={{ textTransform: "uppercase", fontSize: "9.5px", letterSpacing: "0.5px" }}>{v.kind}</span>
        {!v.virtual && <span title="files">{n.files} f</span>}
        {!v.virtual && n.memory?.length > 0 && <span title="memory entries">{n.memory.length} m</span>}
        {gov && gov.pins_count > 0 && (
          <span className="slot-badge pin" title={gov.pin_ids.join(", ")}>
            ⛨ {gov.pins_count}
          </span>
        )}
        {lease && lease.is_locked && (
          <span className="slot-badge lease" title={`Leased by ${lease.agent}`}>
            🔒
          </span>
        )}
        {delta && delta.status !== "unchanged" && (
          <span className={`slot-badge delta ${delta.status}`}>
            {delta.status === "added" ? "+" : delta.status === "modified" ? "Δ" : delta.status === "plannedfuture" ? "◌" : "×"}
          </span>
        )}
        {n.status && n.status !== "active" && <span className="st">{n.status}</span>}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { bp: BlueprintNodeView };

// ───────── graph ─────────

function GraphViewInner() {
  const {
    graph,
    expanded,
    toggle,
    select,
    selected,
    selectEntity,
    selectFile,
    showImpl,
    lens,
    run,
    notify,
  } = useStore();
  const rf = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [edgeMode, setEdgeMode] = useState<"declared" | "all">("all");
  const [edgeRouting, setEdgeRouting] = useState<"smoothstep" | "default" | "straight">("smoothstep");
  const [isHandToolActive, setIsHandToolActive] = useState(false);
  const { isPanMode, cursorStyle } = useSpacebarPan(isHandToolActive);

  const model = useMemo(
    () => (graph ? buildModel(graph, lens, expanded, showImpl) : null),
    [graph, lens, expanded, showImpl]
  );

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
      es.push({
        id: key,
        source: a,
        target: b,
        targetHandle: "top",
        type: edgeRouting,
        className: r.status === "inferred" ? "e-inferred" : "e-declared",
        label: r.kind === "depends_on" ? undefined : r.kind,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: { rationale: r.rationale },
      });
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
          es.push({
            id: key,
            source: a,
            target: b,
            targetHandle: "top",
            type: edgeRouting,
            className: "e-violation",
            label: `✗ ${ce.violation}`,
            markerEnd: { type: MarkerType.ArrowClosed },
            animated: true,
          });
        }
        continue;
      }
      if (edgeMode === "all" && !ce.declared && !seen.has(`r:${a}->${b}`)) {
        const key = `u:${a}->${b}`;
        if (!seen.has(key)) {
          seen.add(key);
          es.push({
            id: key,
            source: a,
            target: b,
            targetHandle: "top",
            type: edgeRouting,
            className: "e-undeclared",
            label: `${ce.count}× undeclared`,
            markerEnd: { type: MarkerType.ArrowClosed },
          });
        }
      }
    }
    const ns: Node[] = [...model.nodes.values()].map((v) => ({
      id: v.id,
      type: "bp",
      position: pos.get(v.id)!,
      data: { v, expanded: expanded.has(v.id), toggle: () => toggle(v.id), violation: violations.has(v.id), unmapped: v.file && v.data.path && unmapped.has(v.data.path), nested: nested.has(v.id) },
      draggable: !isPanMode && !v.virtual && !v.file,
      selected: v.id === selected,
      style: v.file ? { width: FILE_W, height: FILE_H } : { width: NODE_W, height: NODE_H },
    }));
    setNodes(ns);
    setEdges(es);
    setTimeout(() => rf.fitView({ padding: 0.12, duration: 300 }), 30);
  }, [graph, model, edgeMode, edgeRouting, isPanMode]);

  useEffect(() => {
    setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === selected })));
  }, [selected]);

  useEffect(() => {
    const fit = () => rf.fitView({ padding: 0.2, duration: 300 });
    window.addEventListener("afwe:fit", fit);
    return () => window.removeEventListener("afwe:fit", fit);
  }, []);

  const onNodeClick = useCallback(
    (_: any, n: Node) => {
      const v: VNode = (n.data as any).v;
      if (v.file) {
        select(v.data.node);
        if (v.data.path) selectFile(v.data.path);
      } else if (!v.virtual) {
        select(v.id);
        if (graph) {
          const rootH = buildHierarchyTree(graph);
          const hNode = findNodeById(rootH, v.id);
          if (hNode) {
            selectEntity({
              id: hNode.id,
              key: hNode.key,
              kind: hNode.kind,
              label: hNode.label,
              path: hNode.path,
              status: hNode.hasViolation ? "violation" : "mapped",
              state: hNode.state,
              fileCount: hNode.fileCount,
              node: hNode,
            });
          }
        }
      } else toggle(v.id);
    },
    [graph, select, selectFile, selectEntity, toggle]
  );

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
  const isDark = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "dark";

  return (
    <section className="canvas" style={{ width: "100%", height: "100%", minHeight: 620, position: "relative", cursor: cursorStyle }}>
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
        panOnDrag={isPanMode ? true : [1, 2]}
        selectionOnDrag={false}
        panOnScroll={true}
        zoomOnScroll={true}
        nodesDraggable={!isPanMode}
        onPaneClick={() => {
          selectFile(null);
          select(null);
          selectEntity(null);
        }}
        fitView
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={!isPanMode}
        elevateNodesOnSelect
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color={isDark ? "#3A3832" : "#D4CEBE"} />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => ((n.data as any).v?.file ? "var(--line)" : (n.data as any).violation ? "var(--red)" : "var(--panel)")}
          maskColor="rgba(0,0,0,0.4)"
        />
      </ReactFlow>
      <div className="legend" style={{ position: "absolute", bottom: 12, left: 16, zIndex: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => setIsHandToolActive(!isHandToolActive)}
          title="Hand tool (Hold Spacebar to pan)"
          style={{
            background: isHandToolActive ? "var(--ink)" : "var(--panel)",
            color: isHandToolActive ? "var(--panel)" : "var(--ink)",
            border: "1px solid var(--line)",
            borderRadius: "6px",
            padding: "3px 8px",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            fontSize: "11px",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          <Hand size={12} />
          <span>Hand</span>
        </button>

        <span className="l declared">declared</span>
        <span className="l inferred">inferred</span>
        <span className="l undeclared">undeclared (code only)</span>
        <span className="l violation">violation</span>
        <label style={{ marginLeft: 4, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={edgeMode === "all"} onChange={(e) => setEdgeMode(e.target.checked ? "all" : "declared")} /> show code-only
        </label>

        <div style={{ marginLeft: 8, display: "inline-flex", alignItems: "center", gap: 4, fontSize: "11px" }}>
          <span style={{ color: "var(--mute)" }}>Routing:</span>
          {(["smoothstep", "default", "straight"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setEdgeRouting(mode)}
              style={{
                background: edgeRouting === mode ? "var(--ink)" : "var(--panel)",
                color: edgeRouting === mode ? "var(--panel)" : "var(--mute)",
                border: "1px solid var(--line)",
                borderRadius: "4px",
                padding: "2px 6px",
                fontSize: "10.5px",
                cursor: "pointer",
              }}
            >
              {mode === "smoothstep" ? "Stepped" : mode === "default" ? "Bezier" : "Direct"}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

export function GraphView() {
  return (
    <ReactFlowProvider>
      <GraphViewInner />
    </ReactFlowProvider>
  );
}
