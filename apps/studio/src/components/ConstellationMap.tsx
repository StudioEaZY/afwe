import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowLeftRight,
  Lock,
  Shield,
  Plus,
  Minus,
  Maximize2,
  Hand,
} from "lucide-react";
import {
  HierarchyNode,
  DirectedEdge,
  SelectedEntity,
  findNodeById,
  getDomainNode,
  computeNodeFlags,
  stateDescription,
  shortLabel,
  NodeState,
} from "../lib/hierarchy";
import { SvgDomainIcon, SvgMiniLock, SvgMiniAlertTriangle, SvgMiniMutual } from "../lib/lucideSvgPaths";
import { FilterMode, ConstellationScope } from "../store";
import {
  computeFocalZoom,
  computeStepZoom,
  computeAdaptiveLabel,
  computeBadgeInverseScale,
  useSpacebarPan,
} from "../lib/semanticZoomEngine";

interface Props {
  root: HierarchyNode;
  anchorKey: string | null;
  domainEdges: DirectedEdge[];
  nodeEdges: DirectedEdge[];
  scope: ConstellationScope;
  forceParentFallback: boolean;
  timelineT: number;
  compareT: number;
  neighborhoodExpanded: boolean;
  filterMode: FilterMode;
  selectedEntity: SelectedEntity | null;
  onSelectEntity: (entity: SelectedEntity | null) => void;
  onSetAnchor: (nodeKey: string) => void;
  onSetForceParentFallback: (b: boolean) => void;
  onOpenInRadial: (nodeId: string) => void;
}

const DIRECT_CAP = 6;

function fillFor(state: NodeState): string {
  if (state === "mapped") return "var(--mapped)";
  if (state === "inferred") return "var(--inferred)";
  if (state === "legacy") return "var(--legacy)";
  return "url(#hatch-constellation)";
}

function dotColorFor(state: NodeState): string {
  if (state === "mapped") return "var(--accent)";
  if (state === "inferred") return "var(--amber)";
  return "var(--mute)";
}

export const ConstellationMap: React.FC<Props> = ({
  root,
  anchorKey,
  domainEdges,
  nodeEdges,
  scope,
  forceParentFallback,
  timelineT,
  compareT,
  neighborhoodExpanded,
  filterMode,
  selectedEntity,
  onSelectEntity,
  onSetAnchor,
  onSetForceParentFallback,
  onOpenInRadial,
}) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<{ k: number; x: number; y: number }>({ k: 1, x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{ x: number; y: number; zx: number; zy: number } | null>(null);

  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [hoveredEdgeIdx, setHoveredEdgeIdx] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; html: React.ReactNode } | null>(null);

  const [isHandToolActive, setIsHandToolActive] = useState(false);
  const [edgeRouting, setEdgeRouting] = useState<"curved" | "direct">("curved");
  const { isPanMode, cursorStyle, setIsDraggingCanvas } = useSpacebarPan(isHandToolActive);

  // Drag-and-drop node offsets state
  const [customOffsets, setCustomOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const dragNodeStartRef = useRef<{ clientX: number; clientY: number; initX: number; initY: number } | null>(null);
  const posRef = useRef<Record<string, any>>({});

  const handleNodePointerDown = (ev: React.PointerEvent, key: string) => {
    if (isPanMode) return;
    ev.stopPropagation();
    setDraggingKey(key);
    dragNodeStartRef.current = {
      clientX: ev.clientX,
      clientY: ev.clientY,
      initX: customOffsets[key]?.x || 0,
      initY: customOffsets[key]?.y || 0,
    };
    try {
      (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    } catch (_) {}
  };

  const handleNodePointerMove = (ev: React.PointerEvent) => {
    if (!draggingKey || !dragNodeStartRef.current) return;
    const start = dragNodeStartRef.current;
    if (!start) return;
    const dx = (ev.clientX - start.clientX) / zoom.k;
    const dy = (ev.clientY - start.clientY) / zoom.k;

    // Spatial clamping: dependencies cannot cross into consumer hemisphere and vice versa
    const basePos = posRef.current[draggingKey];
    let clampedDx = dx;
    if (basePos) {
      if (basePos.side === "dep") {
        // dep nodes stay on left: basePos.x + (start.initX + clampedDx) <= -36
        const maxOffset = -36 - basePos.x;
        clampedDx = Math.min(dx, maxOffset - (start.initX || 0));
      } else if (basePos.side === "con") {
        // con nodes stay on right: basePos.x + (start.initX + clampedDx) >= 36
        const minOffset = 36 - basePos.x;
        clampedDx = Math.max(dx, minOffset - (start.initX || 0));
      }
    }

    setCustomOffsets((prev) => ({
      ...prev,
      [draggingKey]: {
        x: (start.initX || 0) + clampedDx,
        y: (start.initY || 0) + dy,
      },
    }));
  };

  const handleNodePointerUp = (ev: React.PointerEvent) => {
    if (draggingKey) {
      setDraggingKey(null);
      dragNodeStartRef.current = null;
      try {
        (ev.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId);
      } catch {}
    }
  };

  // Progressive disclosure state per effective anchor
  const [expAnchor, setExpAnchor] = useState<string>("");
  const [depHops, setDepHops] = useState<number>(1);
  const [conHops, setConHops] = useState<number>(1);
  const [showAllDirectDep, setShowAllDirectDep] = useState<boolean>(false);
  const [showAllDirectCon, setShowAllDirectCon] = useState<boolean>(false);
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(new Set());

  // Sync toolbar neighborhoodExpanded toggle
  useEffect(() => {
    const h = neighborhoodExpanded ? 2 : 1;
    setDepHops(h);
    setConHops(h);
  }, [neighborhoodExpanded]);

  // 1. Resolve Constellation Context (Domain vs Node vs Honest Parent-Level Fallback)
  const ctx = useMemo(() => {
    const requested =
      findNodeById(root, anchorKey) ||
      findNodeById(root, "Backend/events/models") ||
      root.children[0] ||
      root;
    const isDomain = requested.depth <= 1;
    const hasDirect = isDomain
      ? true
      : nodeEdges.some((e) => e.a === requested.key || e.b === requested.key);
    const isFallback = !isDomain && (!hasDirect || forceParentFallback);

    if (isDomain || isFallback) {
      const dom = getDomainNode(root, requested);
      return {
        requestedNode: requested,
        effectiveNode: dom,
        isFallback,
        hasDirect,
        granularity: (isDomain ? "domain" : "parent-fallback") as "domain" | "parent-fallback" | "node",
        edgeSet: domainEdges,
      };
    }

    return {
      requestedNode: requested,
      effectiveNode: requested,
      isFallback: false,
      hasDirect: true,
      granularity: "node" as const,
      edgeSet: nodeEdges,
    };
  }, [root, anchorKey, domainEdges, nodeEdges, forceParentFallback]);

  const { requestedNode, effectiveNode, isFallback, granularity, edgeSet } = ctx;
  const effKey = effectiveNode.key;

  // Reset progressive disclosure state when effective anchor changes
  useEffect(() => {
    if (expAnchor !== effKey) {
      setExpAnchor(effKey);
      const h = neighborhoodExpanded ? 2 : 1;
      setDepHops(h);
      setConHops(h);
      setShowAllDirectDep(false);
      setShowAllDirectCon(false);
      setExpandedBranches(new Set());
    }
  }, [effKey, expAnchor, neighborhoodExpanded]);

  // Helper to check if an edge is active at time t
  const edgeActiveAt = (e: DirectedEdge, t: number): boolean => {
    const nA = findNodeById(root, e.a);
    const nB = findNodeById(root, e.b);
    if (!nA || !nB) return false;
    if ((nA.birth || 0) > t || (nB.birth || 0) > t) return false;
    return e.birth <= t && (e.death === null || e.death > t);
  };

  // Active edges for current timeline / two-moment comparison
  const activeEdges = useMemo(() => {
    const two = scope === "two";
    return edgeSet.filter((e) =>
      two ? edgeActiveAt(e, timelineT) || edgeActiveAt(e, compareT) : edgeActiveAt(e, timelineT)
    );
  }, [edgeSet, scope, timelineT, compareT, root]);

  // 2. Directional 3-Hop BFS (Dependencies = outgoing from effKey; Consumers = incoming to effKey)
  const bfsResult = useMemo(() => {
    const depHop = new Map<string, number>();
    const conHop = new Map<string, number>();

    let depFront = [effKey];
    let conFront = [effKey];

    for (let h = 1; h <= 3; h++) {
      const nextDep: string[] = [];
      for (const cur of depFront) {
        for (const e of activeEdges) {
          if (e.a === cur && e.b !== effKey && !depHop.has(e.b)) {
            depHop.set(e.b, h);
            nextDep.push(e.b);
          }
        }
      }
      depFront = nextDep;

      const nextCon: string[] = [];
      for (const cur of conFront) {
        for (const e of activeEdges) {
          if (e.b === cur && e.a !== effKey && !conHop.has(e.a)) {
            conHop.set(e.a, h);
            nextCon.push(e.a);
          }
        }
      }
      conFront = nextCon;
    }

    const depNodes: { key: string; hop: number }[] = [];
    const conNodes: { key: string; hop: number }[] = [];
    const bidiNodes: { key: string; hop: number; dH: number; cH: number }[] = [];

    const allReached = new Set<string>([...depHop.keys(), ...conHop.keys()]);
    for (const k of allReached) {
      const dH = depHop.get(k);
      const cH = conHop.get(k);
      if (dH !== undefined && cH !== undefined) {
        bidiNodes.push({ key: k, hop: Math.min(dH, cH), dH, cH });
      } else if (dH !== undefined) {
        depNodes.push({ key: k, hop: dH });
      } else if (cH !== undefined) {
        conNodes.push({ key: k, hop: cH });
      }
    }

    depNodes.sort((a, b) => a.hop - b.hop);
    conNodes.sort((a, b) => a.hop - b.hop);
    bidiNodes.sort((a, b) => a.hop - b.hop);

    const directDepCount =
      depNodes.filter((x) => x.hop === 1).length + bidiNodes.filter((x) => x.dH === 1).length;
    const directConCount =
      conNodes.filter((x) => x.hop === 1).length + bidiNodes.filter((x) => x.cH === 1).length;

    return { depHop, conHop, depNodes, conNodes, bidiNodes, directDepCount, directConCount };
  }, [effKey, activeEdges]);

  const { depHop, conHop, depNodes, conNodes, bidiNodes, directDepCount, directConCount } = bfsResult;

  // Check if a hop-2 node is expanded via a hop-1 branch button
  const isExpandedViaBranch = (nodeKey: string, isDep: boolean): boolean => {
    for (const brKey of expandedBranches) {
      for (const e of activeEdges) {
        if (isDep && e.a === brKey && e.b === nodeKey) return true;
        if (!isDep && e.b === brKey && e.a === nodeKey) return true;
      }
    }
    return false;
  };

  // 3. Progressive Disclosure Filtering & Placement
  const layout = useMemo(() => {
    const filterSide = (
      list: { key: string; hop: number }[],
      maxHop: number,
      showAllDirect: boolean,
      isDep: boolean
    ) => {
      const direct = list.filter((x) => x.hop === 1);
      const visDirect = showAllDirect ? direct : direct.slice(0, DIRECT_CAP);
      const hiddenDirectCount = Math.max(0, direct.length - visDirect.length);
      const indirect = list.filter((x) => x.hop > 1);
      const visIndirect = indirect.filter((x) => x.hop <= maxHop || isExpandedViaBranch(x.key, isDep));
      const hiddenIndirectCount = Math.max(0, indirect.length - visIndirect.length);
      return {
        vis: [...visDirect, ...visIndirect],
        hiddenDirectCount,
        hiddenIndirectCount,
        totalDirect: direct.length,
        totalIndirect: indirect.length,
      };
    };

    const depFiltered = filterSide(depNodes, depHops, showAllDirectDep, true);
    const conFiltered = filterSide(conNodes, conHops, showAllDirectCon, false);
    const visBidi = bidiNodes.filter(
      (x) =>
        x.hop === 1 ||
        x.hop <= Math.max(depHops, conHops) ||
        isExpandedViaBranch(x.key, true) ||
        isExpandedViaBranch(x.key, false)
    );

    const pos: Record<
      string,
      {
        x: number;
        y: number;
        a: number;
        r: number;
        hop: number;
        side: "dep" | "con" | "bidi" | "center";
        isSub: boolean;
        node: HierarchyNode;
      }
    > = {
      [effKey]: {
        x: 0,
        y: 0,
        a: 0,
        r: 0,
        hop: 0,
        side: "center",
        isSub: effectiveNode.depth > 1,
        node: effectiveNode,
      },
    };

    const R1 = 198;
    const R2 = 282;

    const placeGroup = (items: { key: string; hop: number }[], isLeft: boolean) => {
      const byHop: Record<number, { key: string; hop: number }[]> = {
        1: items.filter((x) => x.hop === 1),
        2: items.filter((x) => x.hop > 1),
      };
      for (const hStr of ["1", "2"]) {
        const h = Number(hStr);
        const grp = byHop[h];
        const count = grp.length;
        if (!count) continue;
        const r = h === 1 ? R1 : R2;
        const aStart = isLeft ? -0.76 * Math.PI : 0.24 * Math.PI;
        const aEnd = isLeft ? -0.24 * Math.PI : 0.76 * Math.PI;
        grp.forEach((item, idx) => {
          const t = count === 1 ? 0.5 : idx / (count - 1);
          const a = aStart + (aEnd - aStart) * t;
          const n = findNodeById(root, item.key);
          if (!n) return;
          pos[item.key] = {
            x: Math.sin(a) * r,
            y: -Math.cos(a) * r,
            a,
            r,
            hop: item.hop,
            side: isLeft ? "dep" : "con",
            isSub: n.depth > 1,
            node: n,
          };
        });
      }
    };

    placeGroup(depFiltered.vis, true);
    placeGroup(conFiltered.vis, false);

    visBidi.forEach((item, idx) => {
      const n = findNodeById(root, item.key);
      if (!n) return;
      const r = 185 + idx * 52;
      const a = Math.PI;
      const xOff = (idx % 2 === 0 ? 1 : -1) * (idx > 0 ? 68 : 0);
      pos[item.key] = {
        x: xOff,
        y: -Math.cos(a) * r,
        a,
        r,
        hop: item.hop,
        side: "bidi",
        isSub: n.depth > 1,
        node: n,
      };
    });

    const hasHop2 =
      depFiltered.vis.some((x) => x.hop > 1) ||
      conFiltered.vis.some((x) => x.hop > 1) ||
      visBidi.some((x) => x.hop > 1);

    return { pos, depFiltered, conFiltered, visBidi, hasHop2, R1, R2 };
  }, [
    depNodes,
    conNodes,
    bidiNodes,
    depHops,
    conHops,
    showAllDirectDep,
    showAllDirectCon,
    expandedBranches,
    effKey,
    effectiveNode,
    root,
    activeEdges,
  ]);

  const { pos, depFiltered, conFiltered, hasHop2, R1, R2 } = layout;
  posRef.current = pos;

  const livePos = useMemo(() => {
    const res: typeof pos = {};
    for (const [k, p] of Object.entries(pos)) {
      const off = customOffsets[k] || { x: 0, y: 0 };
      res[k] = { ...p, x: p.x + off.x, y: p.y + off.y };
    }
    return res;
  }, [pos, customOffsets]);

  // Compute visible edges (both endpoints in livePos, and relevant to anchor/hop1->hop2/violation)
  const visibleEdges = useMemo(() => {
    const two = scope === "two";
    return activeEdges.filter((e) => {
      if (!livePos[e.a] || !livePos[e.b]) return false;
      const involvesAnchor = e.a === effKey || e.b === effKey;
      const hopBridge =
        (livePos[e.a].hop === 1 && livePos[e.b].hop > 1) || (livePos[e.b].hop === 1 && livePos[e.a].hop > 1);
      if (!involvesAnchor && !hopBridge && !e.bad) return false;
      return two
        ? edgeActiveAt(e, timelineT) || edgeActiveAt(e, compareT)
        : edgeActiveAt(e, timelineT);
    });
  }, [activeEdges, livePos, effKey, scope, timelineT, compareT]);

  // Group pairs of connected nodes to bow parallel / mutual arcs apart cleanly
  const edgePairOffsets = useMemo(() => {
    const pairCounts: Record<string, number> = {};
    visibleEdges.forEach((e) => {
      const pairKey = [e.a, e.b].sort().join("::");
      pairCounts[pairKey] = (pairCounts[pairKey] || 0) + 1;
    });
    const pairIdx: Record<string, number> = {};
    return visibleEdges.map((e) => {
      const pairKey = [e.a, e.b].sort().join("::");
      const total = pairCounts[pairKey] || 1;
      const idx = pairIdx[pairKey] || 0;
      pairIdx[pairKey] = idx + 1;
      const offset = total > 1 ? (idx - (total - 1) * 0.5) * 22 : 0;
      return { total, idx, offset };
    });
  }, [visibleEdges]);

  // Check if filter mode matches a node
  const passFilter = (n: HierarchyNode): boolean => {
    if (filterMode === "all") return true;
    if (filterMode === "uncharted" || filterMode === "unmapped") return n.state === "unmapped";
    if (filterMode === "issues") return n.hasViolation;
    if (filterMode === "proposals") return n.hasProposal;
    return n.state === filterMode;
  };

  // Google Maps mouse-anchored focal zoom listener
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      setZoom((z) => computeFocalZoom(z, e.deltaY, e.clientX, e.clientY, rect));
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  // Tooltip position updater
  const updateTipPos = (ev: React.MouseEvent, content: React.ReactNode) => {
    const w = 270;
    const h = 150;
    const x =
      ev.clientX + 16 + w > window.innerWidth ? ev.clientX - w - 12 : ev.clientX + 16;
    const y = Math.max(8, Math.min(ev.clientY + 16, window.innerHeight - h - 8));
    setTip({
      x,
      y,
      html: content,
    });
  };

  // Select node helper
  const handleSelectNode = (n: HierarchyNode) => {
    onSelectEntity({
      id: n.id,
      key: n.key,
      kind: n.kind,
      label: n.label,
      path: n.path,
      status: n.hasViolation
        ? "violation"
        : n.hasPin
        ? "pinned"
        : n.state === "unmapped"
        ? "uncharted"
        : "mapped",
      state: n.state,
      fileCount: n.fileCount,
      mappedCount: n.mappedCount,
      node: n,
      raw: n.raw,
    });
  };

  // Select edge helper
  const handleSelectEdge = (e: DirectedEdge) => {
    onSelectEntity({
      id: `${e.a}->${e.b}`,
      key: `${e.a}->${e.b}`,
      kind: "edge",
      label: `${shortLabel(e.a)} → ${shortLabel(e.b)}`,
      path: `${e.a} → ${e.b}`,
      status: e.bad ? "violation" : "mapped",
      edgeData: e,
    });
  };

  // Toggle hop-1 branch button
  const toggleBranch = (nodeKey: string, ev: React.MouseEvent) => {
    ev.stopPropagation();
    const next = new Set(expandedBranches);
    if (next.has(nodeKey)) next.delete(nodeKey);
    else next.add(nodeKey);
    setExpandedBranches(next);
  };

  const selectedNode =
    selectedEntity && selectedEntity.kind !== "edge"
      ? selectedEntity.node || findNodeById(root, selectedEntity.key || selectedEntity.id)
      : null;

  const anchorDomain = getDomainNode(root, effectiveNode);

  const badgeScale = computeBadgeInverseScale(zoom.k);

  return (
    <div
      ref={stageRef}
      className={`stage-soft ${isPanMode ? "pan-active" : ""} ${dragStart ? "pan-dragging" : ""}`}
      style={{
        flex: 1,
        minHeight: 460,
        userSelect: "none",
        cursor: cursorStyle || (dragStart ? "grabbing" : "default"),
      }}
      onPointerDown={(e) => {
        if (!isPanMode && (e.target as HTMLElement).closest("button,.zctl,.exp-pill,.br-btn")) return;
        setDragStart({ x: e.clientX, y: e.clientY, zx: zoom.x, zy: zoom.y });
        setIsDraggingCanvas(true);
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch (_) {}
      }}
      onPointerMove={(e) => {
        if (!dragStart) return;
        setZoom((z) => ({
          ...z,
          x: dragStart.zx + (e.clientX - dragStart.x),
          y: dragStart.zy + (e.clientY - dragStart.y),
        }));
      }}
      onPointerUp={(e) => {
        setDragStart(null);
        setIsDraggingCanvas(false);
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch (_) {}
      }}
      onPointerCancel={() => {
        setDragStart(null);
        setIsDraggingCanvas(false);
      }}
    >
      {/* Top Overlay Context Banner & Selection Bar (#stageTop) */}
      <div className="stage-top">
        {isFallback ? (
          <div className="ctx-banner fallback">
            <AlertTriangle size={14} style={{ flexShrink: 0 }} />
            <span>
              No node-level dependency data for{" "}
              <b>{requestedNode.breadcrumbLabels.join(" › ")}</b> — showing parent module{" "}
              <b>{effectiveNode.label}</b> instead.
            </span>
            {forceParentFallback && ctx.hasDirect && (
              <button
                type="button"
                className="btn-soft"
                style={{ padding: "2px 8px", fontSize: 11, marginLeft: 4 }}
                onClick={() => onSetForceParentFallback(false)}
              >
                Show actual node links
              </button>
            )}
          </div>
        ) : (
          <div className="ctx-banner">
            {granularity === "node" ? (
              <span>
                Showing actual direct relationships for{" "}
                <b>{effectiveNode.breadcrumbLabels.join(" › ")}</b> ({directDepCount} dependencies,{" "}
                {directConCount} consumers)
              </span>
            ) : (
              <span>
                Showing domain-level relationships for <b>{effectiveNode.label}</b> (
                {directDepCount} dependencies, {directConCount} consumers)
              </span>
            )}
          </div>
        )}

        {selectedNode && (
          <div className="sel-bar">
            <span className="sel-path">
              Selected: <b>{selectedNode.breadcrumbLabels.join(" › ")}</b>
            </span>
            {selectedNode.key !== requestedNode.key && (
              <button
                type="button"
                className="btn-soft primary"
                onClick={() => onSetAnchor(selectedNode.key)}
              >
                Centre here
              </button>
            )}
            <button
              type="button"
              className="btn-soft"
              onClick={() => onOpenInRadial(selectedNode.id)}
            >
              Open map in Atlas
            </button>
          </div>
        )}
      </div>

      {/* Main Constellation SVG */}
      <svg
        viewBox="-360 -295 720 590"
        aria-label="Constellation dependency map"
        style={{ width: "100%", height: "100%", maxHeight: 610, display: "block", margin: "0 auto" }}
      >
        <defs>
          <pattern
            id="hatch-constellation"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" fill="var(--unm)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--hatch)" strokeWidth="1.5" />
          </pattern>
          <marker
            id="arr"
            viewBox="0 0 10 10"
            refX="7"
            refY="5"
            markerWidth="5.5"
            markerHeight="5.5"
            orient="auto-start-reverse"
          >
            <path d="M0,1.5 L8,5 L0,8.5 z" fill="var(--mute)" />
          </marker>
          <marker
            id="arr-bad"
            viewBox="0 0 10 10"
            refX="7"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,1 L9,5 L0,9 z" fill="var(--red)" />
          </marker>
          <marker
            id="arr-add"
            viewBox="0 0 10 10"
            refX="7"
            refY="5"
            markerWidth="5.5"
            markerHeight="5.5"
            orient="auto-start-reverse"
          >
            <path d="M0,1.5 L8,5 L0,8.5 z" fill="var(--accent)" />
          </marker>
          <marker
            id="arr-bidi"
            viewBox="0 0 10 10"
            refX="7"
            refY="5"
            markerWidth="5.5"
            markerHeight="5.5"
            orient="auto-start-reverse"
          >
            <path d="M0,1.5 L8,5 L0,8.5 z" fill="var(--amber)" />
          </marker>
        </defs>

        <g transform={`translate(${zoom.x},${zoom.y}) scale(${zoom.k})`}>
          {/* Directional Hemisphere Guides */}
          <text
            x="-195"
            y="-264"
            textAnchor="middle"
            fontSize="11"
            fontWeight="600"
            fill="var(--mute)"
          >
            ‹ Dependencies: What does {effectiveNode.label} use? ({directDepCount} direct)
          </text>
          <text
            x="195"
            y="-264"
            textAnchor="middle"
            fontSize="11"
            fontWeight="600"
            fill="var(--mute)"
          >
            Consumers ›: Who uses {effectiveNode.label}? ({directConCount} direct)
          </text>
          <line
            x1="0"
            y1="-245"
            x2="0"
            y2="245"
            stroke="var(--line)"
            strokeDasharray="4 6"
          />

          {/* Hop Orbit Rings */}
          <circle
            r={R1}
            fill="none"
            stroke="var(--line)"
            strokeDasharray="3 6"
          />
          {hasHop2 && (
            <>
              <circle
                r={R2}
                fill="none"
                stroke="var(--line)"
                strokeDasharray="2 8"
                opacity="0.7"
              />
              <text
                x="0"
                y={-R2 - 4}
                textAnchor="middle"
                fontSize="9"
                fill="var(--mute)"
                letterSpacing=".08em"
              >
                2 HOPS OUT
              </text>
            </>
          )}

          {/* Directed Edges */}
          <g>
            {visibleEdges.map((e, idx) => {
              const p1 = livePos[e.a];
              const p2 = livePos[e.b];
              if (!p1 || !p2) return null;

              const two = scope === "two";
              const inB = edgeActiveAt(e, timelineT);
              const inA = two ? edgeActiveAt(e, compareT) : true;
              const isMutual = p1.side === "bidi" || p2.side === "bidi";
              const involvesAnchor = e.a === effKey || e.b === effKey;

              const dx = p2.x - p1.x;
              const dy = p2.y - p1.y;
              const dist = Math.hypot(dx, dy) || 1;
              const ux = dx / dist;
              const uy = dy / dist;

              const startR = e.a === effKey ? 66 : p1.isSub ? 52 : 42;
              const endR = e.b === effKey ? 68 : p2.isSub ? 56 : 46;
              const x1 = p1.x + ux * startR;
              const y1 = p1.y + uy * startR;
              const x2 = p2.x - ux * endR;
              const y2 = p2.y - uy * endR;

              const pairOffset = edgePairOffsets[idx]?.offset || 0;
              const baseBow = involvesAnchor ? 14 : 24;
              const bow = baseBow + pairOffset;
              const mx = (x1 + x2) * 0.5 - uy * bow;
              const my = (y1 + y2) * 0.5 + ux * bow;
              const dPath =
                edgeRouting === "direct"
                  ? `M${x1.toFixed(1)},${y1.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)}`
                  : `M${x1.toFixed(1)},${y1.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(
                      1
                    )} ${x2.toFixed(1)},${y2.toFixed(1)}`;

              let cls = "edge";
              let marker = "url(#arr)";
              if (e.bad) {
                cls += " bad";
                marker = "url(#arr-bad)";
              } else if (isMutual && involvesAnchor) {
                cls += " bidi-e";
                marker = "url(#arr-bidi)";
              } else if (two && inB && !inA) {
                cls += " add";
                marker = "url(#arr-add)";
              } else if (two && !inB && inA) {
                cls += " del";
              } else if (scope === "node" && !involvesAnchor) {
                cls += " gh";
              }

              // Highlight when hovering node or edge
              const isHoveredEdge = hoveredEdgeIdx === idx;
              const isConnectedToHoveredNode =
                hoveredKey !== null && (e.a === hoveredKey || e.b === hoveredKey);
              const isDimmedByHover =
                hoveredKey !== null && !isConnectedToHoveredNode && !e.bad;

              if (isHoveredEdge || isConnectedToHoveredNode) {
                cls += " hi";
              }

              return (
                <g key={`${e.a}->${e.b}-${idx}`}>
                  {/* Invisible Generous Hitbox (14px clickable threshold) */}
                  <path
                    d={dPath}
                    className="edge-hitbox"
                    strokeWidth={14}
                    style={{ pointerEvents: isPanMode ? "none" : "stroke" }}
                    onMouseMove={(ev) => {
                      setHoveredEdgeIdx(idx);
                      updateTipPos(
                        ev,
                        <div>
                          <b className="serif">
                            {shortLabel(e.a)} → {shortLabel(e.b)}
                          </b>
                          <div className="tm">
                            {granularity === "node"
                              ? "Node-level dependency"
                              : "Domain-level dependency"}
                            : <b>{e.a}</b> depends on <b>{e.b}</b>
                          </div>
                          {isMutual && involvesAnchor && (
                            <div style={{ color: "var(--amber)", fontWeight: 600 }}>
                              Mutual dependency (depends on &amp; used by {effectiveNode.label})
                            </div>
                          )}
                          {e.bad && (
                            <div style={{ color: "var(--red)", fontWeight: 600 }}>
                              Rule violation: forbidden direction ({e.a} must not depend on {e.b})
                            </div>
                          )}
                          {two && inB && !inA && (
                            <div style={{ color: "var(--accent)" }}>
                              Added after {Math.round(compareT * 100)}%
                            </div>
                          )}
                          {two && !inB && inA && (
                            <div style={{ color: "var(--amber)" }}>
                              Removed before {Math.round(timelineT * 100)}%
                            </div>
                          )}
                          <div className="tm">Click line to inspect details</div>
                        </div>
                      );
                    }}
                    onMouseLeave={() => {
                      setHoveredEdgeIdx(null);
                      setTip(null);
                    }}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      handleSelectEdge(e);
                    }}
                  />
                  {/* Visible Rendered Edge */}
                  <path
                    d={dPath}
                    className={cls}
                    markerEnd={marker}
                    style={{
                      pointerEvents: "none",
                      opacity: isDimmedByHover ? 0.14 : undefined,
                    }}
                  />
                </g>
              );
            })}
          </g>

          {/* Perimeter Nodes */}
          {Object.entries(livePos).map(([k, p]) => {
            if (k === effKey) return null;
            const n = p.node;
            const st = n.state;
            const hasBadEdge = visibleEdges.some((e) => e.bad && (e.a === k || e.b === k));
            const flags = computeNodeFlags(n);

            // Dimming logic
            const pass = passFilter(n);
            const isConnectedToHover =
              !hoveredKey ||
              hoveredKey === k ||
              visibleEdges.some(
                (e) => (e.a === hoveredKey && e.b === k) || (e.b === hoveredKey && e.a === k)
              );
            const dimmed = !pass || (hoveredKey !== null && !isConnectedToHover);

            // Check if this hop-1 node has 2nd-hop neighbors for outer +N branch badge
            const isDepSide = p.side === "dep";
            const branchChildren =
              p.hop === 1
                ? activeEdges.filter((e) =>
                    isDepSide
                      ? e.a === k && depHop.get(e.b) === 2
                      : e.b === k && conHop.get(e.a) === 2
                  )
                : [];
            const isBranchOpen = expandedBranches.has(k);

            const pillW = p.isSub ? 142 : 116;
            const pillH = p.isSub ? 38 : 32;
            const halfW = pillW / 2;
            const halfH = pillH / 2;

            return (
              <g
                key={k}
                className={`ex hop-${p.hop} ${p.side === "bidi" ? "bidi" : ""}`}
                transform={`translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`}
                style={{
                  opacity: dimmed ? 0.22 : 1,
                  cursor: isPanMode ? (dragStart ? "grabbing" : "grab") : draggingKey === k ? "grabbing" : "grab",
                  pointerEvents: isPanMode ? "none" : undefined,
                }}
                onPointerDown={(ev) => handleNodePointerDown(ev, k)}
                onPointerMove={handleNodePointerMove}
                onPointerUp={handleNodePointerUp}
                onPointerCancel={handleNodePointerUp}
                onMouseMove={(ev) => {
                  setHoveredKey(k);
                  const roleLabel =
                    p.side === "bidi"
                      ? `Mutual dependency with ${effectiveNode.label}`
                      : p.side === "dep"
                      ? p.hop === 1
                        ? `Direct dependency of ${effectiveNode.label}`
                        : `Indirect dependency (${p.hop} hops)`
                      : p.hop === 1
                      ? `Direct consumer of ${effectiveNode.label}`
                      : `Indirect consumer (${p.hop} hops)`;

                  updateTipPos(
                    ev,
                    <div>
                      <b className="serif">{n.label}</b>
                      <div className="tm">{n.breadcrumbLabels.join(" › ")}</div>
                      <div>
                        <b>{roleLabel}</b> · {st} · {n.fileCount} files
                      </div>
                      <div className="tm">{stateDescription(st, n)}</div>
                      {flags.pin > 0 && (
                        <div style={{ color: "var(--accent)", fontWeight: 600 }}>
                          Pinned check active ({flags.pin})
                        </div>
                      )}
                      {flags.viol > 0 && (
                        <div style={{ color: "var(--red)", fontWeight: 600 }}>
                          Rule violation ({flags.viol})
                        </div>
                      )}
                      <div className="tm">Click to inspect · double-click to centre here</div>
                    </div>
                  );
                }}
                onMouseLeave={() => {
                  setHoveredKey(null);
                  setTip(null);
                }}
                onClick={(ev) => {
                  ev.stopPropagation();
                  handleSelectNode(n);
                }}
                onDoubleClick={(ev) => {
                  ev.stopPropagation();
                  onSetAnchor(n.key);
                  handleSelectNode(n);
                }}
              >
                <rect
                  x={-halfW}
                  y={-halfH}
                  width={pillW}
                  height={pillH}
                  rx={halfH}
                  fill={fillFor(st)}
                  stroke={
                    n.hasViolation || hasBadEdge
                      ? "var(--red)"
                      : selectedNode?.key === n.key
                      ? "var(--ink)"
                      : "var(--line)"
                  }
                  strokeWidth={
                    n.hasViolation || hasBadEdge || selectedNode?.key === n.key ? 1.8 : 1
                  }
                  strokeDasharray={st === "inferred" ? "3 2" : undefined}
                />

                {(() => {
                  const labelLayout = computeAdaptiveLabel(
                    n.label,
                    p.isSub ? n.breadcrumbLabels.slice(0, -1).join(" › ") : undefined,
                    pillW - 32,
                    zoom.k,
                    n.hasViolation || n.hasPin
                  );

                  return p.isSub ? (
                    <>
                      <circle cx={-halfW + 16} cy={-4} r={4} fill={dotColorFor(st)} />
                      <text
                        x={4}
                        y={-2}
                        textAnchor="middle"
                        fontSize={labelLayout.fontSize}
                        fontWeight="600"
                        fill="var(--ink)"
                      >
                        {labelLayout.displayText}
                      </text>
                      {labelLayout.showSubtext && (
                        <text x={4} y={11} textAnchor="middle" className="sub-t" fontSize={labelLayout.subFontSize}>
                          {labelLayout.displaySubtext}
                        </text>
                      )}
                    </>
                  ) : (
                    <>
                      <circle cx={-halfW + 16} cy={0} r={4} fill={dotColorFor(st)} />
                      <text
                        x={4}
                        y={4}
                        textAnchor="middle"
                        fontSize={labelLayout.fontSize}
                        fontWeight="500"
                        fill="var(--ink)"
                      >
                        {labelLayout.displayText}
                      </text>
                    </>
                  );
                })()}

                {/* Mutual Dependency Badge */}
                {p.side === "bidi" && (
                  <g transform={`translate(0, ${-halfH - 6})`}>
                    <rect
                      x={-34}
                      y={-8}
                      width={68}
                      height={14}
                      rx={7}
                      fill="var(--amberbg)"
                      stroke="var(--amber)"
                      strokeWidth="1"
                    />
                    <g transform="translate(-20, -1)">
                      <SvgMiniMutual stroke="var(--amber)" />
                    </g>
                    <text
                      x={6}
                      y={2}
                      textAnchor="middle"
                      fontSize="8.5"
                      fontWeight="600"
                      fill="var(--amber)"
                    >
                      mutual
                    </text>
                  </g>
                )}

                {/* 2-Hops Out Badge */}
                {p.hop > 1 && p.side !== "bidi" && (
                  <g transform={`translate(0, ${-halfH - 6})`}>
                    <rect
                      x={-22}
                      y={-8}
                      width={44}
                      height={13}
                      rx={6.5}
                      fill="var(--side)"
                      stroke="var(--line)"
                    />
                    <text x={0} y={1.5} textAnchor="middle" fontSize="8.5" fill="var(--mute)">
                      2 hops
                    </text>
                  </g>
                )}

                {/* Pin Badge (Lucide Lock) */}
                {n.hasPin && (
                  <g transform={`translate(${halfW - 10}, ${-halfH + 2}) scale(${badgeScale})`}>
                    <circle r={7} fill="var(--panel)" stroke="var(--ink)" strokeWidth="1.1" />
                    <SvgMiniLock stroke="var(--ink)" />
                  </g>
                )}

                {/* Violation Badge (Lucide AlertTriangle) */}
                {n.hasViolation && (
                  <g transform={`translate(${-halfW + 10}, ${-halfH + 2}) scale(${badgeScale})`}>
                    <SvgMiniAlertTriangle stroke="#fff" fill="var(--red)" />
                  </g>
                )}

                {/* Per-node Hop-1 Outer Branch Expand Button (+N / −) */}
                {p.hop === 1 && branchChildren.length > 0 && (
                  <g
                    className="br-btn"
                    transform={`translate(${isDepSide ? -halfW - 14 : halfW + 14}, 0)`}
                    onClick={(ev) => toggleBranch(k, ev)}
                  >
                    <circle r={11} />
                    <text y={3.5} textAnchor="middle">
                      {isBranchOpen ? "−" : `+${branchChildren.length}`}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Bottom Progressive Disclosure Pills (.exp-pill) */}
          {(depFiltered.hiddenDirectCount > 0 ||
            depFiltered.hiddenIndirectCount > 0 ||
            depHops > 1) && (
            <g
              className="exp-pill"
              transform="translate(-195, 246)"
              onClick={(ev) => {
                ev.stopPropagation();
                if (depFiltered.hiddenDirectCount > 0) {
                  setShowAllDirectDep(true);
                } else if (depFiltered.hiddenIndirectCount > 0) {
                  setDepHops(2);
                } else {
                  setDepHops(1);
                  setShowAllDirectDep(false);
                }
              }}
            >
              <rect x={-92} y={-13} width={184} height={26} rx={13} />
              <text y={4} textAnchor="middle">
                {depFiltered.hiddenDirectCount > 0
                  ? `+ Show ${depFiltered.hiddenDirectCount} more direct`
                  : depFiltered.hiddenIndirectCount > 0
                  ? `+ Expand dependencies (+${depFiltered.hiddenIndirectCount})`
                  : "− Collapse to direct"}
              </text>
            </g>
          )}

          {(conFiltered.hiddenDirectCount > 0 ||
            conFiltered.hiddenIndirectCount > 0 ||
            conHops > 1) && (
            <g
              className="exp-pill"
              transform="translate(195, 246)"
              onClick={(ev) => {
                ev.stopPropagation();
                if (conFiltered.hiddenDirectCount > 0) {
                  setShowAllDirectCon(true);
                } else if (conFiltered.hiddenIndirectCount > 0) {
                  setConHops(2);
                } else {
                  setConHops(1);
                  setShowAllDirectCon(false);
                }
              }}
            >
              <rect x={-92} y={-13} width={184} height={26} rx={13} />
              <text y={4} textAnchor="middle">
                {conFiltered.hiddenDirectCount > 0
                  ? `+ Show ${conFiltered.hiddenDirectCount} more direct`
                  : conFiltered.hiddenIndirectCount > 0
                  ? `+ Expand consumers (+${conFiltered.hiddenIndirectCount})`
                  : "− Collapse to direct"}
              </text>
            </g>
          )}

          {/* Center Anchor Hub (r=64 dark disc + perched parent pill) */}
          <g
            style={{ cursor: "pointer", pointerEvents: isPanMode ? "none" : undefined }}
            onClick={(ev) => {
              ev.stopPropagation();
              handleSelectNode(requestedNode);
            }}
          >
            <circle
              r={64}
              fill="var(--ink)"
              stroke={effectiveNode.hasViolation || requestedNode.hasViolation ? "var(--red)" : "var(--panel)"}
              strokeWidth={effectiveNode.hasViolation || requestedNode.hasViolation ? 4.5 : 4}
              style={{ filter: "drop-shadow(0 8px 18px var(--shadow))" }}
            />

            {(effectiveNode.hasViolation || requestedNode.hasViolation) && (
              <g transform="translate(42, -42) scale(1.15)">
                <SvgMiniAlertTriangle stroke="#fff" fill="var(--red)" />
              </g>
            )}

            {/* Perched Parent Context Pill above center disc when viewing a subnode */}
            {effectiveNode.depth > 1 && (
              <g
                transform="translate(0, -76)"
                onClick={(ev) => {
                  ev.stopPropagation();
                  const parentKey = effectiveNode.key.split(".").slice(0, -1).join(".");
                  if (parentKey) onSetAnchor(parentKey);
                }}
              >
                <rect
                  x={-68}
                  y={-11}
                  width={136}
                  height={20}
                  rx={10}
                  fill="var(--panel)"
                  stroke="var(--line)"
                />
                <text
                  y={3}
                  textAnchor="middle"
                  fontSize="9.5"
                  fill="var(--mute)"
                  fontWeight="600"
                >
                  {effectiveNode.breadcrumbLabels.slice(0, -1).join(" › ")}
                </text>
              </g>
            )}

            {/* Center Domain Lucide Icon */}
            <g transform="translate(0, -28) scale(0.85) translate(-12, -12)">
              <SvgDomainIcon iconKey={anchorDomain.icon} stroke="var(--bg)" strokeWidth={1.8} />
            </g>

            {/* Primary Anchor Label */}
            <text
              y={-2}
              textAnchor="middle"
              fontSize="14"
              fontWeight="600"
              fill="var(--bg)"
              className="serif"
            >
              {effectiveNode.label}
            </text>

            {/* File Count & State */}
            <text
              y={15}
              textAnchor="middle"
              fontSize="10.5"
              fill="var(--bg)"
              opacity={0.78}
            >
              {effectiveNode.fileCount} files · {effectiveNode.state}
            </text>

            {/* Honest Link Granularity Badge */}
            <text
              y={31}
              textAnchor="middle"
              fontSize="9.5"
              fill={isFallback ? "#E7A33A" : "var(--mapped)"}
            >
              {isFallback
                ? "Parent-level fallback"
                : granularity === "node"
                ? "Actual direct links"
                : "Domain-level links"}
            </text>
          </g>
        </g>
      </svg>

      {/* Legend & Routing Controls in Bottom Card */}
      <div
        style={{
          position: "absolute",
          bottom: "12px",
          left: "16px",
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "6px",
          padding: "5px 12px",
          display: "inline-flex",
          alignItems: "center",
          gap: "12px",
          fontSize: "11px",
          color: "var(--mute)",
          boxShadow: "0 2px 8px var(--shadow)",
          flexWrap: "wrap",
          zIndex: 10,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <ArrowLeft size={12} color="var(--accent)" />
          <span>Dependencies (Left)</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <ArrowRight size={12} color="var(--ink)" />
          <span>Consumers (Right)</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <ArrowLeftRight size={12} color="var(--amber)" />
          <span>Mutual</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--red)" }}>
          <AlertTriangle size={12} color="var(--red)" />
          <span>Violation</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Lock size={11} color="var(--ink)" />
          <span>Leased</span>
        </span>

        <div style={{ marginLeft: 6, display: "inline-flex", alignItems: "center", gap: 4, fontSize: "11px" }}>
          <span style={{ color: "var(--mute)" }}>Routing:</span>
          {(["curved", "direct"] as const).map((mode) => (
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
              {mode === "curved" ? "Curved Arcs" : "Direct Vectors"}
            </button>
          ))}
        </div>
      </div>

      {/* Zoom Controls (Lucide Icons) */}
      <div className="zctl">
        <button
          type="button"
          className={isHandToolActive ? "active" : ""}
          title="Hand tool (Hold Spacebar to pan)"
          style={{
            background: isHandToolActive ? "var(--ink)" : undefined,
            color: isHandToolActive ? "var(--panel)" : undefined,
          }}
          onClick={() => setIsHandToolActive(!isHandToolActive)}
        >
          <Hand size={13} />
        </button>
        <button
          type="button"
          title="Zoom in"
          onClick={() => {
            const rect = stageRef.current?.getBoundingClientRect() || { width: 720, height: 540, left: 0, top: 0 };
            setZoom((z) => computeStepZoom(z, "in", rect));
          }}
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          title="Zoom out"
          onClick={() => {
            const rect = stageRef.current?.getBoundingClientRect() || { width: 720, height: 540, left: 0, top: 0 };
            setZoom((z) => computeStepZoom(z, "out", rect));
          }}
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          title="Fit view to frame (Reset zoom & layout)"
          onClick={() => {
            setZoom({ k: 1, x: 0, y: 0 });
            setCustomOffsets({});
          }}
        >
          <Maximize2 size={13} />
        </button>
      </div>

      {/* Floating Tooltip */}
      {tip && (
        <div className="tip on" style={{ left: tip.x, top: tip.y }}>
          {tip.html}
        </div>
      )}
    </div>
  );
};
