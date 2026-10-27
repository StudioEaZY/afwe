// apps/studio/src/components/TopologyMap.tsx
import React, { useMemo, useRef, useState, useEffect } from "react";
import {
  Layers,
  ArrowDown,
  AlertTriangle,
  Lock,
  Plus,
  Minus,
  RotateCcw,
} from "lucide-react";
import { useStore } from "../store";
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
  const { tiers, pos, activeEdges } = useMemo(() => {
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
      const y = -195 + ti * 130;
      const count = list.length;
      list.forEach((n, idx) => {
        const x = (idx - (count - 1) / 2) * 240;
        nodePos[n.key] = { x, y, tier: ti, node: n };
      });
    });

    const edges = domainEdges.filter((e) => {
      if (!nodePos[e.a] || !nodePos[e.b]) return false;
      return e.birth <= effectiveT && (e.death === null || e.death > effectiveT);
    });

    return { tiers: tierBuckets, pos: nodePos, activeEdges: edges };
  }, [root, domainEdges, effectiveT]);

  // Non-passive wheel zoom listener
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => ({
        ...z,
        k: Math.max(0.6, Math.min(2.6, z.k * (e.deltaY < 0 ? 1.12 : 0.89))),
      }));
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
    const ent: SelectedEntity = {
      id: `${e.a}->${e.b}`,
      key: `${e.a}->${e.b}`,
      kind: "edge",
      label: `${shortLabel(e.a)} → ${shortLabel(e.b)}`,
      path: `${e.a} → ${e.b}`,
      status: e.bad ? "violation" : "mapped",
      edgeData: e,
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

  const selectedNode =
    selectedEntity && selectedEntity.kind !== "edge"
      ? selectedEntity.node || findNodeById(root, selectedEntity.key || selectedEntity.id)
      : null;

  return (
    <div
      ref={stageRef}
      className="stage-soft"
      style={{
        flex: 1,
        minHeight: compact ? 340 : 460,
        userSelect: "none",
      }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button,.zctl,.ex")) return;
        setDragStart({ x: e.clientX, y: e.clientY, zx: zoom.x, zy: zoom.y });
      }}
      onPointerMove={(e) => {
        if (!dragStart) return;
        setZoom((z) => ({
          ...z,
          x: dragStart.zx + (e.clientX - dragStart.x),
          y: dragStart.zy + (e.clientY - dragStart.y),
        }));
      }}
      onPointerUp={() => setDragStart(null)}
    >
      {/* Top Overlay Context Banner & Selection Bar (#stageTop) */}
      {!compact && (
        <div className="stage-top">
          <div className="ctx-banner">
            <span>
              Layered architecture · Top-to-bottom flow · Red upward arrows = forbidden
              dependencies
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
        viewBox="-360 -295 720 590"
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
            const y = -195 + ti * 130;
            return (
              <g key={`tier-${ti}`}>
                <rect
                  x={-320}
                  y={y - 44}
                  width={640}
                  height={88}
                  rx={16}
                  className="tier-box"
                />
                <text
                  x={-304}
                  y={y - 26}
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
              const p1 = pos[e.a];
              const p2 = pos[e.b];
              if (!p1 || !p2) return null;

              const up = p1.y > p2.y;
              const y1 = p1.y + (up ? -26 : 26);
              const y2 = p2.y + (up ? 26 : -26);
              const cx = (p1.x + p2.x) * 0.5 + (e.bad ? 90 : 0);
              const cy = (y1 + y2) * 0.5;
              const dPath = `M${p1.x},${y1} Q${cx},${cy} ${p2.x},${y2}`;

              const isHoveredEdge = hoveredEdgeIdx === idx;
              const isConnectedToHover =
                hoveredKey !== null && (e.a === hoveredKey || e.b === hoveredKey);
              const dimmed =
                hoveredKey !== null && !isConnectedToHover && !e.bad;

              return (
                <path
                  key={`${e.a}->${e.b}-${idx}`}
                  d={dPath}
                  className={`edge ${e.bad ? "bad" : ""} ${
                    isHoveredEdge || isConnectedToHover ? "hi" : ""
                  }`}
                  markerEnd={e.bad ? "url(#arr-top-bad)" : "url(#arr-top)"}
                  style={dimmed ? { opacity: 0.14 } : undefined}
                  onMouseMove={(ev) => {
                    setHoveredEdgeIdx(idx);
                    updateTipPos(
                      ev,
                      <div>
                        <b className="serif">
                          {e.a} → {e.b}
                        </b>
                        <div className="tm">
                          Architectural dependency: <b>{e.a}</b> depends on <b>{e.b}</b>
                        </div>
                        {e.bad && (
                          <div style={{ color: "var(--red)", fontWeight: 600 }}>
                            Rule violation: upward dependency against layered architecture
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
              );
            })}
          </g>

          {/* Tier Domain Cards */}
          {Object.entries(pos).map(([k, p]) => {
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

            const subNames = (n.children || [])
              .slice(0, 3)
              .map((c) => c.label)
              .join(" · ");

            return (
              <g
                key={k}
                className="ex"
                transform={`translate(${p.x},${p.y + 6})`}
                style={dimmed ? { opacity: 0.25 } : undefined}
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
                      {flags.viol > 0 && (
                        <div style={{ color: "var(--red)", fontWeight: 600 }}>
                          Rule violation ({flags.viol})
                        </div>
                      )}
                      <div className="tm">
                        Click to inspect · double-click to open in Radial
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
                  handleOpenInRadial(n.id);
                }}
              >
                <rect
                  x={-92}
                  y={-26}
                  width={184}
                  height={52}
                  rx={14}
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

                {/* Left Domain Icon */}
                <g transform="translate(-76, -12) scale(0.75)">
                  <SvgDomainIcon iconKey={n.icon} stroke="var(--ink)" strokeWidth={1.7} />
                </g>

                {/* Status Dot */}
                <circle cx={-52} cy={-6} r={3.5} fill={dotColorFor(st)} />

                {/* Primary Domain Name & File Count */}
                <text x={-42} y={-2} fontSize="13" fontWeight="600" fill="var(--ink)">
                  {n.label}
                </text>
                <text x={80} y={-2} textAnchor="end" fontSize="10.5" fill="var(--mute)">
                  {n.fileCount}f
                </text>

                {/* Submodules Preview Line */}
                <text x={-74} y={15} fontSize="10" fill="var(--mute)">
                  {subNames}
                </text>

                {/* Pin Badge */}
                {n.hasPin && (
                  <g transform="translate(82, -22)">
                    <circle r={7} fill="var(--panel)" stroke="var(--ink)" strokeWidth="1.1" />
                    <SvgMiniLock stroke="var(--ink)" />
                  </g>
                )}

                {/* Violation Badge */}
                {n.hasViolation && (
                  <g transform="translate(-82, -22)">
                    <SvgMiniAlertTriangle stroke="#fff" fill="var(--red)" />
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* 4 Corner Instructional Callouts (100% Lucide Icons) */}
      {!compact && (
        <>
          <div className="call c-tl">
            <div className="ic">
              <Layers size={16} />
            </div>
            <div>
              <b>4 Architectural Tiers</b>
              Presentation at top down to Foundation at bottom.
            </div>
          </div>

          <div className="call c-tr">
            <div className="ic">
              <ArrowDown size={16} />
            </div>
            <div>
              <b>Downward Flow</b>
              Upper tiers may depend on lower tiers, never the reverse.
            </div>
          </div>

          <div className="call c-bl">
            <div className="ic">
              <Lock size={16} />
            </div>
            <div>
              <b>Click Card or Line</b>
              Inspect domain submodules or jump to Constellation.
            </div>
          </div>

          <div className="call c-br">
            <div className="ic" style={{ color: "var(--red)" }}>
              <AlertTriangle size={16} />
            </div>
            <div>
              <b>Upward Red Curve = Violation</b>
              Data → Web violates the downward dependency rule.
            </div>
          </div>
        </>
      )}

      {/* Zoom Controls (Lucide Icons) */}
      <div className="zctl">
        <button
          type="button"
          title="Zoom in"
          onClick={() => setZoom((z) => ({ ...z, k: Math.min(2.6, z.k * 1.18) }))}
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          title="Zoom out"
          onClick={() => setZoom((z) => ({ ...z, k: Math.max(0.6, z.k / 1.18) }))}
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          title="Reset view"
          onClick={() => setZoom({ k: 1, x: 0, y: 0 })}
        >
          <RotateCcw size={13} />
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
