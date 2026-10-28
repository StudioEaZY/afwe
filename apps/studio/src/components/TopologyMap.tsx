// apps/studio/src/components/TopologyMap.tsx
import React, { useMemo, useRef, useState, useEffect } from "react";
import {
  Layers,
  ArrowDown,
  AlertTriangle,
  Lock,
  Shield,
  Plus,
  Minus,
  Maximize2,
  Move,
  Hand,
} from "lucide-react";
import { useStore } from "../store";
import { api } from "../api";
import {
  buildHierarchyTree,
  buildDirectedEdges,
  findNodeById,
  computeNodeFlags,
  stateDescription,
  shortLabel,
  HierarchyNode,
  DirectedEdge,
  SelectedEntity,
  NodeState,
} from "../lib/hierarchy";
import { SvgDomainIcon, SvgMiniLock, SvgMiniAlertTriangle } from "../lib/lucideSvgPaths";
import {
  computeFocalZoom,
  computeStepZoom,
  computeAdaptiveLabel,
  computeBadgeInverseScale,
  useSpacebarPan,
} from "../lib/semanticZoomEngine";

export interface TopologyDiffMode {
  addedNodes?: Set<string>;
  modifiedNodes?: Set<string>;
  removedNodes?: Set<string>;
  violatedNodes?: Set<string>;
  addedEdges?: Set<string>;
  removedEdges?: Set<string>;
}

export interface TopologyMapProps {
  compact?: boolean;
  snapshotScene?: any | null;
  diffMode?: TopologyDiffMode | null;
  timelineT?: number;
  onSelectEntity?: (entity: SelectedEntity) => void;
  onDrillDown?: (nodeId: string) => void;
  onOpenConstellation?: (nodeKey: string) => void;
}

export interface CapabilityBridge {
  sourceFiles: string[];
  targetFiles: string[];
  entrypoints: string[];
  violationDetail?: string;
}

export function getEdgeCapabilityBridge(
  graph: any,
  sourceDomain: string,
  targetDomain: string,
  isViolating: boolean
): CapabilityBridge {
  const srcNorm = sourceDomain.toLowerCase();
  const tgtNorm = targetDomain.toLowerCase();

  const matchingCodeEdges = (graph?.code_edges || []).filter((ce: any) => {
    const fromMatches = ce.from?.toLowerCase().includes(srcNorm);
    const toMatches = ce.to?.toLowerCase().includes(tgtNorm);
    return fromMatches && toMatches;
  });

  const entrypoints: string[] = [];
  const sourceFiles: string[] = [];
  const targetFiles: string[] = [];
  let violationDetail: string | undefined;

  for (const ce of matchingCodeEdges) {
    if (ce.violation && !violationDetail) {
      violationDetail = ce.violation;
    }
    if (ce.from && !sourceFiles.includes(ce.from)) sourceFiles.push(ce.from);
    if (ce.to && !targetFiles.includes(ce.to)) targetFiles.push(ce.to);
  }

  const allFiles = graph?.files || [];
  for (const f of allFiles) {
    const fNode = (f.node || f.path || "").toLowerCase();
    if (fNode.includes(srcNorm)) {
      for (const imp of f.imports || []) {
        if (imp.toLowerCase().includes(tgtNorm)) {
          if (!sourceFiles.includes(f.path)) sourceFiles.push(f.path);
          if (!targetFiles.includes(imp)) targetFiles.push(imp);
          const cleanSrc = f.path.split("/").slice(-2).join("/");
          const cleanImp = imp.split("/").slice(-2).join("/");
          entrypoints.push(`${cleanSrc} → ${cleanImp}`);
        }
      }
    }
  }

  return { sourceFiles, targetFiles, entrypoints, violationDetail };
}

const TIER_NAMES = [
  "Tier 1 · Presentation Layer",
  "Tier 2 · Application & Services",
  "Tier 3 · Domain & Data",
  "Tier 4 · Foundation & Platform",
];

function fillFor(state: NodeState): string {
  if (state === "mapped") return "var(--mapped)";
  if (state === "inferred") return "var(--inferred)";
  if (state === "legacy") return "var(--legacy)";
  return "url(#hatch-topology)";
}

function dotColorFor(state: NodeState): string {
  if (state === "mapped") return "var(--accent)";
  if (state === "inferred") return "var(--amber)";
  return "var(--mute)";
}

export const TopologyMap: React.FC<TopologyMapProps> = ({
  compact = false,
  snapshotScene = null,
  diffMode = null,
  timelineT,
  onSelectEntity,
  onDrillDown,
  onOpenConstellation,
}) => {
  const {
    graph,
    overviewTimelineT,
    filterMode,
    selectedEntity,
    selectEntity,
    openConsequenceModal,
    scheduleQuarantineAction,
    notify,
    drillDown,
    setActiveLens,
    openConstellationFor,
  } = useStore();

  const stageRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<{ k: number; x: number; y: number }>({ k: 1, x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{ x: number; y: number; zx: number; zy: number } | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [hoveredEdgeIdx, setHoveredEdgeIdx] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; html: React.ReactNode } | null>(null);

  const [isHandToolActive, setIsHandToolActive] = useState(false);
  const [edgeRouting, setEdgeRouting] = useState<"curved" | "stepped" | "direct">("curved");
  const { isPanMode, cursorStyle, setIsDraggingCanvas } = useSpacebarPan(isHandToolActive);

  // Drag-and-drop node offsets state
  const [customOffsets, setCustomOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const dragNodeStartRef = useRef<{ clientX: number; clientY: number; initX: number; initY: number } | null>(null);

  const effectiveT = timelineT ?? overviewTimelineT ?? 1;

  const effectiveGraph = useMemo(() => {
    if (!snapshotScene) return graph;
    return {
      ...graph,
      nodes: snapshotScene.nodes || graph?.nodes || [],
      code_edges: snapshotScene.edges || graph?.code_edges || [],
    };
  }, [snapshotScene, graph]);

  const root = useMemo(() => buildHierarchyTree(effectiveGraph), [effectiveGraph]);
  const { domainEdges } = useMemo(
    () => buildDirectedEdges(effectiveGraph, root),
    [effectiveGraph, root]
  );

  // Group top-level domains into 4 architectural tiers
  const { tiers, basePos, activeEdges } = useMemo(() => {
    const tierBuckets: HierarchyNode[][] = [[], [], [], []];
    const aliveDomains = (root.children || []).filter((d) => (d.birth || 0) <= effectiveT);

    aliveDomains.forEach((d, idx) => {
      const t =
        typeof d.tier === "number" && d.tier >= 0 && d.tier <= 3
          ? d.tier
          : idx % 4;
      tierBuckets[t].push(d);
    });

    const nodePos: Record<string, { x: number; y: number; tier: number; node: HierarchyNode }> = {};
    tierBuckets.forEach((list, ti) => {
      const y = -195 + ti * 140;
      const count = list.length;
      list.forEach((n, idx) => {
        const x = (idx - (count - 1) / 2) * 280;
        nodePos[n.key] = { x, y, tier: ti, node: n };
      });
    });

    const edges = domainEdges.filter((e) => {
      if (!nodePos[e.a] || !nodePos[e.b]) return false;
      return e.birth <= effectiveT && (e.death === null || e.death > effectiveT);
    });

    return { tiers: tierBuckets, basePos: nodePos, activeEdges: edges };
  }, [root, domainEdges, effectiveT]);

  // Compute live positions with custom drag offsets
  const livePos = useMemo(() => {
    const res: Record<string, { x: number; y: number; tier: number; node: HierarchyNode }> = {};
    for (const [k, p] of Object.entries(basePos)) {
      const off = customOffsets[k] || { x: 0, y: 0 };
      res[k] = { ...p, x: p.x + off.x, y: p.y + off.y };
    }
    return res;
  }, [basePos, customOffsets]);

  // Group active edges by source and target to distribute attachment ports across card width
  const edgePortOffsets = useMemo(() => {
    const outgoingCounts: Record<string, number> = {};
    const incomingCounts: Record<string, number> = {};
    activeEdges.forEach((e) => {
      outgoingCounts[e.a] = (outgoingCounts[e.a] || 0) + 1;
      incomingCounts[e.b] = (incomingCounts[e.b] || 0) + 1;
    });

    const outgoingIdx: Record<string, number> = {};
    const incomingIdx: Record<string, number> = {};

    return activeEdges.map((e) => {
      const outTotal = outgoingCounts[e.a] || 1;
      const inTotal = incomingCounts[e.b] || 1;
      const outI = outgoingIdx[e.a] || 0;
      outgoingIdx[e.a] = outI + 1;
      const inI = incomingIdx[e.b] || 0;
      incomingIdx[e.b] = inI + 1;

      // Distribute ports generously across +/- 80px of the card width (224px card)
      const outOffset = outTotal > 1 ? -80 + (outI / (outTotal - 1)) * 160 : (outI - (outTotal - 1) * 0.5) * 28;
      const inOffset = inTotal > 1 ? -80 + (inI / (inTotal - 1)) * 160 : (inI - (inTotal - 1) * 0.5) * 28;

      return { outOffset, inOffset };
    });
  }, [activeEdges]);

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

  const passFilter = (n: HierarchyNode): boolean => {
    if (filterMode === "all") return true;
    if (filterMode === "uncharted" || filterMode === "unmapped") return n.state === "unmapped";
    if (filterMode === "issues") return n.hasViolation;
    if (filterMode === "proposals") return n.hasProposal;
    return n.state === filterMode;
  };

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

  const handleSelectNode = (n: HierarchyNode) => {
    const ent: SelectedEntity = {
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
    };
    if (onSelectEntity) onSelectEntity(ent);
    else selectEntity(ent);
  };

  const handleSelectEdge = (e: DirectedEdge) => {
    const isViolating = Boolean(e.bad);
    const bridge = getEdgeCapabilityBridge(graph, e.a, e.b, isViolating);
    const ent: SelectedEntity = {
      id: `${e.a}->${e.b}`,
      key: `${e.a}->${e.b}`,
      kind: "edge",
      label: `${shortLabel(e.a)} → ${shortLabel(e.b)}`,
      path: `${e.a} → ${e.b}`,
      status: e.bad ? "violation" : "mapped",
      purpose: e.bad
        ? `Rule violation: ${bridge.violationDetail || "forbidden upward dependency"}`
        : `Architectural dependency (${bridge.entrypoints.length || e.count || 1} calls)`,
      description:
        bridge.entrypoints.length > 0 ? bridge.entrypoints.slice(0, 5).join(", ") : undefined,
      edgeData: { ...e, bridge },
    };
    if (onSelectEntity) onSelectEntity(ent);
    else selectEntity(ent);
  };

  const handleOpenInRadial = (nodeId: string) => {
    if (onDrillDown) {
      onDrillDown(nodeId);
    } else {
      setActiveLens("radial");
      drillDown(nodeId);
    }
  };

  const handleOpenConstellation = (nodeKey: string) => {
    if (onOpenConstellation) {
      onOpenConstellation(nodeKey);
    } else {
      openConstellationFor(nodeKey);
    }
  };

  // Node Drag Handlers
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
    // Spatial clamping: limit vertical movement so nodes stay within their architectural tier row (+/- 45px)
    const rawY = (start.initY || 0) + dy;
    const clampedY = Math.max(-45, Math.min(45, rawY));
    setCustomOffsets((prev) => ({
      ...prev,
      [draggingKey]: {
        x: (start.initX || 0) + dx,
        y: clampedY,
      },
    }));
  };

  const handleNodePointerUp = (ev: React.PointerEvent) => {
    if (draggingKey) {
      // Check if dropped onto another node while holding Shift or moving over a target
      const dropTargetEl = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".ex");
      const dropTargetKey = dropTargetEl?.getAttribute("data-node-key");

      if (dropTargetKey && dropTargetKey !== draggingKey && (ev.shiftKey || ev.altKey)) {
        const srcNode = findNodeById(root, draggingKey);
        const targetNode = findNodeById(root, dropTargetKey);
        if (srcNode && targetNode) {
          openConsequenceModal({
            title: "Reparent Architectural Blueprint Node",
            statement: `Move node "${srcNode.label}" under "${targetNode.label}"? This is a structural edit of .afwe/blueprint.yaml.`,
            isCascading: true,
            impact: [
              `Node path will change to: ${targetNode.path}/${srcNode.id}`,
              `Descendant modules will be re-nested under ${targetNode.label}.`,
              `Changes will be staged in the 10-second quarantine grace period with full undo support.`,
            ],
            confirmLabel: "Reparent Node",
            onConfirm: () => {
              scheduleQuarantineAction({
                id: `move-node-${srcNode.id}-under-${targetNode.id}`,
                label: `Move ${srcNode.label} under ${targetNode.label}`,
                description: `Reparenting blueprint node ${srcNode.id}`,
                isCascading: true,
                execute: async () => {
                  await api.bp.move(srcNode.id, targetNode.id);
                  notify(`Reparented ${srcNode.label} under ${targetNode.label}`);
                },
              });
            },
            onCancel: () => {},
          });
        }
      }

      setDraggingKey(null);
      dragNodeStartRef.current = null;
      try {
        (ev.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId);
      } catch {}
    }
  };

  const selectedNode =
    selectedEntity && selectedEntity.kind !== "edge"
      ? selectedEntity.node || findNodeById(root, selectedEntity.key || selectedEntity.id)
      : null;

  const badgeScale = computeBadgeInverseScale(zoom.k);
  const hasUpwardViolations = activeEdges.some((e) => e.bad || (livePos[e.a]?.tier || 0) > (livePos[e.b]?.tier || 0));

  return (
    <div
      ref={stageRef}
      className={`stage-soft ${isPanMode ? "pan-active" : ""} ${dragStart ? "pan-dragging" : ""}`}
      style={{
        flex: 1,
        minHeight: compact ? 340 : 460,
        userSelect: "none",
        position: "relative",
        cursor: cursorStyle || (dragStart ? "grabbing" : "default"),
      }}
      onPointerDown={(e) => {
        if (!isPanMode && (e.target as HTMLElement).closest("button,.zctl")) return;
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
      {!compact && (
        <div className="stage-top">
          <div className="ctx-banner">
            <span>
              Layered architecture · Top-to-bottom flow · Drag any card to reposition
            </span>
          </div>

          {selectedNode && (
            <div className="sel-bar">
              <span className="sel-path">
                Selected: <b>{selectedNode.breadcrumbLabels.join(" › ")}</b>
              </span>
              <button
                type="button"
                className="btn-soft primary"
                onClick={() => handleOpenInRadial(selectedNode.id)}
              >
                Open map
              </button>
              <button
                type="button"
                className="btn-soft"
                onClick={() => handleOpenConstellation(selectedNode.key)}
              >
                Constellation
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main Topology SVG */}
      <svg
        viewBox="-400 -295 800 590"
        aria-label="Architectural topology map"
        style={{
          width: "100%",
          height: "100%",
          maxHeight: compact ? 420 : 610,
          display: "block",
          margin: "0 auto",
        }}
      >
        <defs>
          <pattern
            id="hatch-topology"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" fill="var(--unm)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--hatch)" strokeWidth="1.5" />
          </pattern>
          <marker
            id="arr-top"
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
            id="arr-top-bad"
            viewBox="0 0 10 10"
            refX="7"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,1 L9,5 L0,9 z" fill="var(--red)" />
          </marker>
        </defs>

        <g transform={`translate(${zoom.x},${zoom.y}) scale(${zoom.k})`}>
          {/* 4 Architectural Tier Bands */}
          {tiers.map((_, ti) => {
            const y = -195 + ti * 140;
            return (
              <g key={`tier-${ti}`}>
                <rect
                  x={-380}
                  y={y - 50}
                  width={760}
                  height={100}
                  rx={16}
                  className="tier-box"
                />
                <text
                  x={-362}
                  y={y - 32}
                  fontSize="10"
                  letterSpacing=".08em"
                  fill="var(--mute)"
                >
                  {TIER_NAMES[ti].toUpperCase()}
                </text>
              </g>
            );
          })}

          {/* Directed Edges Between Tiers */}
          <g>
            {activeEdges.map((e, idx) => {
              const p1 = livePos[e.a];
              const p2 = livePos[e.b];
              if (!p1 || !p2) return null;

              const { outOffset = 0, inOffset = 0 } = edgePortOffsets[idx] || {};
              const startX = p1.x + outOffset;
              const targetX = p2.x + inOffset;
              const up = p1.y > p2.y;
              const isViolating = Boolean(e.bad || p1.tier > p2.tier);
              const startY = p1.y + (up ? -30 : 30);
              const targetY = p2.y + (up ? 30 : -30);

              let dPath: string;
              if (isViolating && up) {
                // Route upward rule violations cleanly around intermediate tiers via the lateral gutter
                const isRight = (startX + targetX) >= 0;
                // Add unique offset per violation index so multiple violations don't share the exact gutter path
                const gutterX = (isRight ? 360 : -360) + (outOffset * 0.4);
                if (edgeRouting === "direct") {
                  dPath = `M${startX},${startY} L${gutterX},${(startY + targetY) * 0.5} L${targetX},${targetY}`;
                } else if (edgeRouting === "stepped") {
                  dPath = `M${startX},${startY} H${gutterX} V${targetY} H${targetX}`;
                } else {
                  dPath = `M${startX},${startY} C${gutterX},${startY} ${gutterX},${targetY} ${targetX},${targetY}`;
                }
              } else if (isViolating) {
                const midY = (startY + targetY) * 0.5;
                const bowX = startX + (startX >= 0 ? 45 : -45) + outOffset * 0.3;
                if (edgeRouting === "direct") {
                  dPath = `M${startX},${startY} L${targetX},${targetY}`;
                } else if (edgeRouting === "stepped") {
                  dPath = `M${startX},${startY} V${midY} H${targetX} V${targetY}`;
                } else {
                  dPath = `M${startX},${startY} C${bowX},${midY} ${targetX},${midY} ${targetX},${targetY}`;
                }
              } else {
                const midY = (startY + targetY) * 0.5;
                if (edgeRouting === "direct") {
                  dPath = `M${startX},${startY} L${targetX},${targetY}`;
                } else if (edgeRouting === "stepped") {
                  dPath = `M${startX},${startY} V${midY} H${targetX} V${targetY}`;
                } else {
                  dPath = `M${startX},${startY} C${startX},${midY} ${targetX},${midY} ${targetX},${targetY}`;
                }
              }

              const isHoveredEdge = hoveredEdgeIdx === idx;
              const isConnectedToHover =
                hoveredKey !== null && (e.a === hoveredKey || e.b === hoveredKey);
              const dimmed =
                hoveredKey !== null && !isConnectedToHover && !isViolating;

              return (
                <g key={`${e.a}->${e.b}-${idx}`}>
                  {/* Invisible Generous Hitbox Path (14px clickable threshold) */}
                  <path
                    d={dPath}
                    className="edge-hitbox"
                    strokeWidth={14}
                    style={{ pointerEvents: isPanMode ? "none" : "stroke" }}
                    onMouseMove={(ev) => {
                      setHoveredEdgeIdx(idx);
                      const bridge = getEdgeCapabilityBridge(graph, e.a, e.b, isViolating);
                      updateTipPos(
                        ev,
                        <div style={{ maxWidth: 360 }}>
                          <b className="serif" style={{ fontSize: "14px" }}>
                            {e.a} → {e.b}
                          </b>
                          <div className="tm" style={{ marginTop: "3px" }}>
                            Architectural dependency: <b>{e.a}</b> depends on <b>{e.b}</b>
                          </div>
                          {isViolating && (
                            <div
                              style={{
                                color: "var(--red)",
                                fontWeight: 600,
                                marginTop: "6px",
                                background: "var(--redbg)",
                                padding: "4px 8px",
                                borderRadius: "4px",
                                fontSize: "12px",
                              }}
                            >
                              ⚠️ Upward Tier Violation
                              {bridge.violationDetail ? `: ${bridge.violationDetail}` : " (inverted layer rule)"}
                            </div>
                          )}
                          {(bridge.entrypoints.length > 0 || bridge.sourceFiles.length > 0) && (
                            <div
                              style={{
                                marginTop: "8px",
                                borderTop: "1px solid var(--line)",
                                paddingTop: "6px",
                                fontSize: "11px",
                              }}
                            >
                              <div
                                style={{
                                  color: "var(--mute)",
                                  fontWeight: 600,
                                  textTransform: "uppercase",
                                  fontSize: "9.5px",
                                  letterSpacing: "0.5px",
                                }}
                              >
                                Concrete Call Bridges:
                              </div>
                              {bridge.entrypoints.slice(0, 3).map((ep, i) => (
                                <div
                                  key={i}
                                  style={{
                                    fontFamily: "var(--font-mono, monospace)",
                                    color: isViolating ? "var(--red)" : "var(--ink)",
                                    marginTop: "2px",
                                  }}
                                >
                                  • {ep}
                                </div>
                              ))}
                              {bridge.entrypoints.length === 0 && bridge.sourceFiles[0] && (
                                <div
                                  style={{
                                    fontFamily: "var(--font-mono, monospace)",
                                    color: isViolating ? "var(--red)" : "var(--ink)",
                                    marginTop: "2px",
                                  }}
                                >
                                  • {bridge.sourceFiles[0]?.split("/").slice(-2).join("/")} →{" "}
                                  {bridge.targetFiles[0]?.split("/").slice(-2).join("/") || e.b}
                                </div>
                              )}
                            </div>
                          )}
                          <div className="tm" style={{ marginTop: "6px", opacity: 0.75, fontSize: "10.5px" }}>
                            Click line to inspect details in side panel
                          </div>
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
                  {/* Rendered Visible Edge */}
                  <path
                    d={dPath}
                    className={`edge ${isViolating ? "bad" : ""} ${
                      isHoveredEdge || isConnectedToHover ? "hi" : ""
                    }`}
                    markerEnd={isViolating ? "url(#arr-top-bad)" : "url(#arr-top)"}
                    style={{
                      pointerEvents: "none",
                      opacity: dimmed ? 0.14 : undefined,
                    }}
                  />
                </g>
              );
            })}
          </g>

          {/* Tier Domain Cards with Drag Support */}
          {Object.entries(livePos).map(([k, p]) => {
            const n = p.node;
            const st = n.state;
            const flags = computeNodeFlags(n);
            const isSelected = selectedNode?.key === n.key;

            const isDiffAdded =
              diffMode?.addedNodes?.has(n.id) || diffMode?.addedNodes?.has(n.key);
            const isDiffModified =
              diffMode?.modifiedNodes?.has(n.id) || diffMode?.modifiedNodes?.has(n.key);
            const isDiffViolated =
              diffMode?.violatedNodes?.has(n.id) || diffMode?.violatedNodes?.has(n.key);

            const pass = passFilter(n);
            const isConnectedToHover =
              !hoveredKey ||
              hoveredKey === k ||
              activeEdges.some(
                (e) => (e.a === hoveredKey && e.b === k) || (e.b === hoveredKey && e.a === k)
              );
            const dimmed = !pass || (hoveredKey !== null && !isConnectedToHover);

            // Google Maps Semantic LOD: hide submodules if zoomed out
            const showSubnames = zoom.k >= 0.88;
            const rawSubNames = (n.children || []).slice(0, 3).map((c) => c.label).join(" · ");
            const subNames = rawSubNames.length > 24 ? `${rawSubNames.slice(0, 22)}…` : rawSubNames;

            return (
              <g
                key={k}
                className="ex"
                data-node-key={k}
                transform={`translate(${p.x},${p.y + 6})`}
                style={{
                  opacity: dimmed ? 0.25 : 1,
                  cursor: isPanMode ? (dragStart ? "grabbing" : "grab") : draggingKey === k ? "grabbing" : "grab",
                  pointerEvents: isPanMode ? "none" : undefined,
                }}
                onPointerDown={(ev) => handleNodePointerDown(ev, k)}
                onPointerMove={handleNodePointerMove}
                onPointerUp={handleNodePointerUp}
                onPointerCancel={handleNodePointerUp}
                onMouseMove={(ev) => {
                  setHoveredKey(k);
                  updateTipPos(
                    ev,
                    <div>
                      <b className="serif">{n.label}</b>
                      <div className="tm">{TIER_NAMES[p.tier]}</div>
                      <div>
                        <b>Domain</b> · {st} · {n.fileCount} files
                      </div>
                      <div className="tm">{stateDescription(st, n)}</div>
                      {flags.pin > 0 && (
                        <div style={{ color: "var(--accent)", fontWeight: 600 }}>
                          Pinned check active ({flags.pin})
                        </div>
                      )}
                      {(flags.viol > 0 || n.hasViolation) && (
                        <div style={{ color: "var(--red)", fontWeight: 600 }}>
                          Rule violation ({Math.max(flags.viol, n.violationCount || 1)})
                        </div>
                      )}
                      <div className="tm">
                        Click to inspect · Drag to reposition · double-click for Constellation
                      </div>
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
                  handleOpenConstellation(n.key);
                }}
              >
                <rect
                  x={-112}
                  y={-29}
                  width={224}
                  height={58}
                  rx={12}
                  fill={fillFor(st)}
                  stroke={
                    n.hasViolation || isDiffViolated
                      ? "var(--red)"
                      : isDiffAdded
                      ? "var(--accent)"
                      : isDiffModified
                      ? "var(--amber)"
                      : isSelected
                      ? "var(--ink)"
                      : "var(--line)"
                  }
                  strokeWidth={
                    n.hasViolation || isDiffViolated || isDiffAdded || isDiffModified || isSelected
                      ? 1.9
                      : 1.2
                  }
                  strokeDasharray={st === "inferred" ? "4 2.5" : undefined}
                />

                {/* Left Avatar Icon Container Badge with Integrated Status Dot */}
                <g transform="translate(-98, -16)">
                  <rect
                    x={0}
                    y={0}
                    width={32}
                    height={32}
                    rx={7}
                    fill="var(--panel)"
                    stroke="var(--line)"
                    strokeWidth={1}
                  />
                  <g transform="translate(4, 4) scale(0.68)">
                    <SvgDomainIcon iconKey={n.icon} stroke="var(--ink)" strokeWidth={1.8} />
                  </g>
                  <circle
                    cx={28}
                    cy={4}
                    r={3.2}
                    fill={dotColorFor(st)}
                    stroke="var(--panel)"
                    strokeWidth={1.2}
                  />
                </g>

                {/* Primary Domain Name */}
                <text
                  x={-56}
                  y={-4}
                  className="t-start"
                  textAnchor="start"
                  fontSize="13.5"
                  fontWeight="600"
                  fill="var(--ink)"
                  dominantBaseline="central"
                >
                  {n.label}
                </text>

                {/* File Count Soft Pill on Right */}
                <g transform="translate(62, -11)">
                  <rect
                    x={0}
                    y={0}
                    width={38}
                    height={22}
                    rx={6}
                    fill="var(--side)"
                    stroke="var(--line)"
                    strokeWidth={0.8}
                  />
                  <text
                    x={19}
                    y={11}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize="10.5"
                    fontWeight="600"
                    fill="var(--mute)"
                  >
                    {n.fileCount}f
                  </text>
                </g>

                {/* Submodules Preview Line (Hidden at low zoom for Google Maps LOD) */}
                {showSubnames && (
                  <text
                    x={-56}
                    y={13}
                    className="t-start sub-t"
                    textAnchor="start"
                    fontSize="9.5"
                    fill="var(--mute)"
                    dominantBaseline="central"
                  >
                    {subNames}
                  </text>
                )}

                {/* Pin Badge */}
                {n.hasPin && (
                  <g transform={`translate(100, -25) scale(${badgeScale})`}>
                    <circle r={7} fill="var(--panel)" stroke="var(--ink)" strokeWidth="1.1" />
                    <SvgMiniLock stroke="var(--ink)" />
                  </g>
                )}

                {/* Violation Badge */}
                {n.hasViolation && (
                  <g transform={`translate(-100, -25) scale(${badgeScale})`}>
                    <SvgMiniAlertTriangle stroke="#fff" fill="var(--red)" />
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Arrow Legend & Routing Controls in Bottom Bar */}
      {!compact && (
        <div
          style={{
            position: "absolute",
            bottom: "12px",
            left: "16px",
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: "10px",
            padding: "5px 12px",
            display: "flex",
            alignItems: "center",
            gap: "14px",
            fontSize: "11px",
            color: "var(--mute)",
            boxShadow: "0 2px 8px var(--shadow)",
            flexWrap: "wrap",
            zIndex: 10,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 16, height: 2, background: "var(--mute)", display: "inline-block" }} />
            Downward dependency
          </span>
          {hasUpwardViolations && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--red)" }}>
              <span style={{ width: 16, height: 2, background: "var(--red)", borderTop: "1px dashed var(--red)", display: "inline-block" }} />
              Forbidden upward violation
            </span>
          )}

          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Shield size={12} color="var(--accent)" />
            <span>Pinned</span>
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Lock size={11} color="var(--ink)" />
            <span>Leased</span>
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--red)" }}>
            <AlertTriangle size={12} color="var(--red)" />
            <span>Violation</span>
          </span>

          <div style={{ marginLeft: 8, display: "inline-flex", alignItems: "center", gap: 4, fontSize: "11px" }}>
            <span style={{ color: "var(--mute)" }}>Routing:</span>
            {(["curved", "stepped", "direct"] as const).map((mode) => (
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
                {mode === "curved" ? "Curved" : mode === "stepped" ? "Stepped" : "Direct"}
              </button>
            ))}
          </div>
        </div>
      )}

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
