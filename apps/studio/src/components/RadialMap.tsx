import React, { useState, useMemo, useRef } from "react";
import {
  Grid,
  Box,
  Lock,
  AlertTriangle,
  Plus,
  Minus,
  RotateCcw,
} from "lucide-react";
import {
  HierarchyNode,
  SelectedEntity,
  NodeState,
  findNodeById,
  computeNodeFlags,
  stateDescription,
  hashStr,
  seededRand,
} from "../lib/hierarchy";
import { SvgDomainIcon, SvgMiniLock, SvgMiniAlertTriangle } from "../lib/lucideSvgPaths";
import { FilterMode } from "../store";

interface Props {
  root: HierarchyNode;
  focusNode: HierarchyNode;
  depth: number;
  growth: boolean;
  denseL4: boolean;
  timelineT: number;
  selectedEntity: SelectedEntity | null;
  filterMode: FilterMode;
  onSelectEntity: (entity: SelectedEntity | null) => void;
  onDrillDown: (nodeId: string) => void;
  onDrillUp: () => void;
  onOpenConstellation: (nodeKey: string) => void;
}

interface PartitionNode {
  node: HierarchyNode;
  ringIndex: number; // 1..depth
  a0: number;
  a1: number;
  children: PartitionNode[];
}

const R0 = 68;
const RMAX = 256;
const GAP = 0.012;

function arcPath(r0: number, r1: number, a0: number, a1: number): string {
  const pad = Math.min(GAP, (a1 - a0) * 0.18);
  const s = a0 + pad * 0.5;
  const e = a1 - pad * 0.5;
  if (e - s <= 0.001) return "";
  const lg = e - s > Math.PI ? 1 : 0;
  const x0 = Math.sin(s) * r0;
  const y0 = -Math.cos(s) * r0;
  const x1 = Math.sin(e) * r0;
  const y1 = -Math.cos(e) * r0;
  const x2 = Math.sin(e) * r1;
  const y2 = -Math.cos(e) * r1;
  const x3 = Math.sin(s) * r1;
  const y3 = -Math.cos(s) * r1;
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r0},${r0} 0 ${lg} 1 ${x1.toFixed(2)},${y1.toFixed(
    2
  )} L${x2.toFixed(2)},${y2.toFixed(2)} A${r1},${r1} 0 ${lg} 0 ${x3.toFixed(2)},${y3.toFixed(2)} Z`;
}

function fillFor(state: NodeState): string {
  if (state === "mapped") return "var(--mapped)";
  if (state === "inferred") return "var(--inferred)";
  if (state === "legacy") return "var(--legacy)";
  return "url(#hatch-radial)";
}

function isLineageMatch(candidateKey: string, targetKey: string): boolean {
  return (
    candidateKey === targetKey ||
    candidateKey.startsWith(targetKey + "/") ||
    targetKey.startsWith(candidateKey + "/")
  );
}

export const RadialMap: React.FC<Props> = ({
  root,
  focusNode,
  depth,
  growth,
  denseL4,
  timelineT,
  selectedEntity,
  filterMode,
  onSelectEntity,
  onDrillDown,
  onDrillUp,
  onOpenConstellation,
}) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<{ k: number; x: number; y: number }>({ k: 1, x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{ x: number; y: number; zx: number; zy: number } | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; html: React.ReactNode } | null>(null);

  // Build partition layout up to `depth` rings
  const { levels, ringStep, mappedPct, totalFiles } = useMemo(() => {
    const growScale = growth ? 0.62 + 0.38 * timelineT : 1;
    const step = ((RMAX - R0) / depth) * growScale;

    // Optional Layer 4 synthetic sub-slices when denseL4 is toggled and a Layer 3 leaf has no children
    const getChildrenForPartition = (n: HierarchyNode, currentRing: number): HierarchyNode[] => {
      const alive = (n.children || []).filter((c) => (c.birth || 0) <= timelineT);
      if (alive.length > 0) return alive;
      if (denseL4 && currentRing === 3 && n.fileCount >= 4) {
        const subNames = ["core", "handlers", "types"];
        const r = seededRand(hashStr(n.key + ":l4"));
        const count = 2 + Math.floor(r() * 2);
        return subNames.slice(0, count).map((sub, idx) => {
          const fc = Math.max(2, Math.round(n.fileCount / count));
          const key = `${n.key}/${sub}`;
          return {
            ...n,
            id: key,
            key,
            label: sub,
            path: `${n.path}/${sub}`,
            breadcrumbLabels: [...n.breadcrumbLabels, sub],
            fileCount: fc,
            mappedCount: n.state === "unmapped" ? 0 : fc,
            weight: Math.pow(Math.max(8, fc), 0.8),
            depth: n.depth + 1,
            parentId: n.id,
            children: [],
            hasPin: idx === 0 && n.hasPin,
            hasViolation: idx === 0 && n.hasViolation,
            hasProposal: false,
          };
        });
      }
      return [];
    };

    const buildPart = (
      parent: HierarchyNode,
      a0: number,
      a1: number,
      ringIdx: number
    ): PartitionNode[] => {
      if (ringIdx > depth) return [];
      const kids = getChildrenForPartition(parent, ringIdx - 1);
      const sum = kids.reduce((s, k) => s + (k.weight || Math.pow(Math.max(8, k.fileCount), 0.8)), 0) || 1;
      let cur = a0;
      return kids.map((k) => {
        const w = k.weight || Math.pow(Math.max(8, k.fileCount), 0.8);
        const span = (a1 - a0) * (w / sum);
        const pNode: PartitionNode = {
          node: k,
          ringIndex: ringIdx,
          a0: cur,
          a1: cur + span,
          children: [],
        };
        cur += span;
        if (ringIdx < depth) {
          pNode.children = buildPart(k, pNode.a0, pNode.a1, ringIdx + 1);
        }
        return pNode;
      });
    };

    const topPartition = buildPart(focusNode, 0, Math.PI * 2, 1);

    const byLevel: PartitionNode[][] = Array.from({ length: depth }, () => []);
    const collect = (arr: PartitionNode[]) => {
      for (const p of arr) {
        byLevel[p.ringIndex - 1].push(p);
        if (p.children.length > 0) collect(p.children);
      }
    };
    collect(topPartition);

    // Compute mapped percentage for center hub
    let tot = 0;
    let mapFiles = 0;
    const countLeafFiles = (n: HierarchyNode) => {
      if ((n.birth || 0) > timelineT) return;
      if (!n.children || n.children.length === 0) {
        tot += n.fileCount;
        if (n.state === "mapped") mapFiles += n.fileCount;
      } else {
        n.children.forEach(countLeafFiles);
      }
    };
    countLeafFiles(root);
    const pct = tot > 0 ? Math.round((mapFiles / tot) * 100) : 82;

    return {
      levels: byLevel,
      ringStep: step,
      mappedPct: pct,
      totalFiles: tot || root.fileCount,
    };
  }, [focusNode, depth, growth, denseL4, timelineT, root]);

  const passFilter = (n: HierarchyNode): boolean => {
    if (filterMode === "all") return true;
    if (filterMode === "uncharted" || filterMode === "unmapped") return n.state === "unmapped";
    if (filterMode === "issues") return n.hasViolation;
    if (filterMode === "proposals") return n.hasProposal;
    return n.state === filterMode;
  };

  const updateTipPos = (ev: React.MouseEvent, content: React.ReactNode) => {
    if (!stageRef.current) return;
    const r = stageRef.current.getBoundingClientRect();
    setTip({
      x: Math.min(r.width - 280, Math.max(12, ev.clientX - r.left + 14)),
      y: Math.min(r.height - 150, Math.max(12, ev.clientY - r.top + 14)),
      html: content,
    });
  };

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

  const selectedNode =
    selectedEntity && selectedEntity.kind !== "edge"
      ? selectedEntity.node || findNodeById(root, selectedEntity.key || selectedEntity.id)
      : null;

  const isRootFocus = focusNode.id === root.id || focusNode.depth === 0;

  return (
    <div
      ref={stageRef}
      className="stage-soft"
      style={{ flex: 1, minHeight: 540, userSelect: "none" }}
      onWheel={(e) => {
        e.preventDefault();
        setZoom((z) => ({
          ...z,
          k: Math.max(0.6, Math.min(2.6, z.k * (e.deltaY < 0 ? 1.12 : 0.89))),
        }));
      }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button,.zctl,.sect")) return;
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
      <div className="stage-top">
        {isRootFocus ? (
          <div className="ctx-banner">
            <span>
              Radial hierarchy · Rings show depth in this map (1 to {depth})
            </span>
          </div>
        ) : (
          <div className="ctx-banner">
            <span>
              Map root: <b>{focusNode.path}/</b> (Global depth {focusNode.depth}) · Rings show
              depth in this map
            </span>
          </div>
        )}

        {selectedNode && (
          <div className="sel-bar">
            <span className="sel-path">
              Selected: <b>{selectedNode.breadcrumbLabels.join(" › ")}</b>
            </span>
            {selectedNode.children &&
              selectedNode.children.length > 0 &&
              selectedNode.id !== focusNode.id && (
                <button
                  type="button"
                  className="btn-soft primary"
                  onClick={() => onDrillDown(selectedNode.id)}
                >
                  Open map
                </button>
              )}
            <button
              type="button"
              className="btn-soft"
              onClick={() => onOpenConstellation(selectedNode.key)}
            >
              Constellation
            </button>
          </div>
        )}
      </div>

      {/* Main Radial SVG */}
      <svg
        viewBox="-360 -295 720 590"
        aria-label="Radial codebase atlas"
        style={{ width: "100%", height: "100%", maxHeight: 610, display: "block", margin: "0 auto" }}
      >
        <defs>
          <pattern
            id="hatch-radial"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" fill="var(--unm)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--hatch)" strokeWidth="1.5" />
          </pattern>
        </defs>

        <g transform={`translate(${zoom.x},${zoom.y}) scale(${zoom.k})`}>
          {/* Outer Halo Ring */}
          <circle
            r={R0 + ringStep * depth + 10}
            fill="none"
            stroke="var(--line)"
            strokeOpacity="0.6"
          />

          {/* Concentric Rings (1..depth) */}
          {levels.map((ringNodes, i) => {
            const r0 = R0 + i * ringStep + (i ? 3 : 0);
            const r1 = R0 + (i + 1) * ringStep;

            return (
              <g key={`ring-${i + 1}`}>
                {ringNodes.map((p) => {
                  const n = p.node;
                  const dPath = arcPath(r0, r1, p.a0, p.a1);
                  if (!dPath) return null;

                  const isSelected = selectedNode?.key === n.key;
                  const pass = passFilter(n);
                  const inHoverLineage =
                    !hoveredKey || isLineageMatch(n.key, hoveredKey);
                  const dimmed = !pass || (hoveredKey !== null && !inHoverLineage);

                  const span = p.a1 - p.a0;
                  const midAngle = (p.a0 + p.a1) * 0.5;
                  const midR = (r0 + r1) * 0.5;
                  const lx = Math.sin(midAngle) * midR;
                  const ly = -Math.cos(midAngle) * midR;
                  const deg = (midAngle * 180) / Math.PI;
                  const rot = deg > 90 && deg < 270 ? deg + 180 : deg;

                  const flags = computeNodeFlags(n);
                  const globalDepth = n.depth;
                  const globalNote =
                    !isRootFocus ? ` (global depth ${globalDepth})` : "";

                  // Status badge positions near outer edge of sector
                  const markR = r1 - 9;
                  const showPin = n.hasPin && span > 0.08;
                  const showViol = n.hasViolation && span > 0.07;
                  const showProp = n.hasProposal && span > 0.08;
                  const showUnm = n.state === "unmapped" && span > 0.14;

                  return (
                    <g
                      key={n.key}
                      className={`sect ${isSelected ? "sel" : ""} ${dimmed ? "dim" : ""}`}
                      onMouseMove={(ev) => {
                        setHoveredKey(n.key);
                        updateTipPos(
                          ev,
                          <div>
                            <b className="serif">{n.label}</b>
                            <div className="tm">{n.breadcrumbLabels.join(" › ")}</div>
                            <div>
                              <b>Layer {i + 1} in this map</b>
                              {globalNote} · {n.state} · {n.fileCount} files
                            </div>
                            <div className="tm">{stateDescription(n.state, n)}</div>
                            {flags.pin > 0 && (
                              <div style={{ color: "var(--accent)", fontWeight: 600 }}>
                                Pinned check active ({flags.pin})
                              </div>
                            )}
                            {flags.prop > 0 && (
                              <div style={{ color: "var(--amber)", fontWeight: 600 }}>
                                Pending proposal ({flags.prop})
                              </div>
                            )}
                            {flags.viol > 0 && (
                              <div style={{ color: "var(--red)", fontWeight: 600 }}>
                                Rule violation ({flags.viol})
                              </div>
                            )}
                            <div className="tm">
                              {n.children && n.children.length > 0
                                ? 'Click to inspect (or use "Open map") · double-click shortcut'
                                : "Click to inspect (leaf node)"}
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
                        if (n.children && n.children.length > 0) {
                          onDrillDown(n.id);
                        } else {
                          handleSelectNode(n);
                        }
                      }}
                    >
                      <path
                        d={dPath}
                        fill={fillFor(n.state)}
                        stroke={
                          n.hasViolation
                            ? "var(--red)"
                            : isSelected
                            ? "var(--ink)"
                            : "var(--bg)"
                        }
                        strokeWidth={n.hasViolation || isSelected ? 1.8 : 1.2}
                        strokeDasharray={n.state === "inferred" ? "4 2.5" : undefined}
                      />

                      {/* Sector Labels & Domain Icons */}
                      {n.depth === 1 && i === 0 && span > 0.18 ? (
                        <g style={{ pointerEvents: "none" }}>
                          {n.icon && (
                            <g
                              transform={`translate(${(lx - 10).toFixed(1)},${(ly - 20).toFixed(
                                1
                              )}) scale(0.82)`}
                              opacity={0.78}
                            >
                              <SvgDomainIcon iconKey={n.icon} stroke="var(--ink)" strokeWidth={1.7} />
                            </g>
                          )}
                          <text
                            x={lx.toFixed(1)}
                            y={(ly + 8).toFixed(1)}
                            textAnchor="middle"
                            fontSize="11.5"
                            fontWeight="600"
                            fill="var(--ink)"
                          >
                            {n.label}
                          </text>
                        </g>
                      ) : (
                        (() => {
                          const arcLen = span * midR;
                          if (arcLen < 26 || r1 - r0 < 18) return null;
                          const maxC = Math.max(3, Math.floor((r1 - r0 - 8) / 5.6));
                          const txt =
                            n.label.length > maxC ? `${n.label.slice(0, maxC - 1)}…` : n.label;
                          return (
                            <text
                              transform={`translate(${lx.toFixed(1)},${ly.toFixed(
                                1
                              )}) rotate(${rot - 90})`}
                              textAnchor="middle"
                              dominantBaseline="central"
                              fontSize={i === 0 ? "11" : i === 1 ? "10" : "9"}
                              fill="var(--ink)"
                              style={{ pointerEvents: "none" }}
                            >
                              {txt}
                            </text>
                          );
                        })()
                      )}

                      {/* Status Marks (Pin, Proposal, Violation, Unmapped) */}
                      {showPin && (
                        <g
                          transform={`translate(${(Math.sin(p.a0 + 0.05) * markR).toFixed(1)},${(
                            -Math.cos(p.a0 + 0.05) * markR
                          ).toFixed(1)})`}
                          style={{ pointerEvents: "none" }}
                        >
                          <circle r={6.5} fill="var(--panel)" stroke="var(--ink)" strokeWidth="1.2" />
                          <SvgMiniLock stroke="var(--ink)" />
                        </g>
                      )}

                      {showProp && (
                        <g
                          transform={`translate(${(Math.sin(p.a1 - 0.05) * markR).toFixed(1)},${(
                            -Math.cos(p.a1 - 0.05) * markR
                          ).toFixed(1)})`}
                          style={{ pointerEvents: "none" }}
                        >
                          <circle r={6.5} fill="var(--amber)" stroke="var(--panel)" strokeWidth="1.2" />
                          <text
                            y={3}
                            textAnchor="middle"
                            fontSize="9"
                            fontWeight="700"
                            fill="#fff"
                          >
                            !
                          </text>
                        </g>
                      )}

                      {showViol && (
                        <g
                          transform={`translate(${(Math.sin(midAngle) * (r1 - 6)).toFixed(1)},${(
                            -Math.cos(midAngle) *
                            (r1 - 6)
                          ).toFixed(1)})`}
                          style={{ pointerEvents: "none" }}
                        >
                          <SvgMiniAlertTriangle stroke="#fff" fill="var(--red)" />
                        </g>
                      )}

                      {showUnm && (
                        <g
                          transform={`translate(${(Math.sin(midAngle) * (r0 + 10)).toFixed(1)},${(
                            -Math.cos(midAngle) *
                            (r0 + 10)
                          ).toFixed(1)})`}
                          style={{ pointerEvents: "none" }}
                        >
                          <circle r={6.5} fill="var(--panel)" stroke="var(--mute)" />
                          <text
                            y={3}
                            textAnchor="middle"
                            fontSize="9"
                            fontWeight="700"
                            fill="var(--mute)"
                          >
                            ?
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}

          {/* Center Hub Disc */}
          <g
            style={{ cursor: isRootFocus ? "default" : "pointer" }}
            onClick={(ev) => {
              ev.stopPropagation();
              if (!isRootFocus) onDrillUp();
            }}
          >
            <circle
              r={R0 - 6}
              fill="var(--disc)"
              stroke="var(--line)"
              style={{ filter: "drop-shadow(0 6px 14px var(--shadow))" }}
            />
            <text
              y={isRootFocus ? -6 : -10}
              textAnchor="middle"
              fontSize="14"
              fontWeight="600"
              fill="var(--ink)"
              className="serif"
            >
              {isRootFocus ? root.label : focusNode.label}
            </text>
            <text y={isRootFocus ? 12 : 8} textAnchor="middle" fontSize="11" fill="var(--mute)">
              {isRootFocus ? `${mappedPct}% mapped` : `${focusNode.fileCount} files`}
            </text>
            <text
              y={26}
              textAnchor="middle"
              fontSize="10"
              fill={isRootFocus ? "var(--mute)" : "var(--accent)"}
              fontWeight={isRootFocus ? undefined : "600"}
            >
              {isRootFocus ? `${totalFiles} files` : "‹ Up one level"}
            </text>
          </g>
        </g>
      </svg>

      {/* 4 Corner Instructional Callouts (100% Lucide Icons) */}
      <div className="call c-tl">
        <div className="ic">
          <Grid size={16} />
        </div>
        <div>
          <b>Unmapped area (?)</b>
          Hatched slices haven&apos;t been charted yet.
        </div>
      </div>

      <div className="call c-tr">
        <div className="ic">
          <Box size={16} />
        </div>
        <div>
          <b>Click to inspect · Open map</b>
          Select any slice and click <b>Open map</b> (or double-click).
        </div>
      </div>

      <div className="call c-bl">
        <div className="ic">
          <Lock size={16} />
        </div>
        <div>
          <b>Pinned checks &amp; proposals</b>
          Lock = enforced rule. Amber ! = pending proposal.
        </div>
      </div>

      <div className="call c-br">
        <div className="ic" style={{ color: "var(--red)" }}>
          <AlertTriangle size={16} />
        </div>
        <div>
          <b>Red triangle = Violation</b>
          Switch to Constellation or Topology to see the offending link.
        </div>
      </div>

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
