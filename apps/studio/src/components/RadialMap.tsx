// apps/studio/src/components/RadialMap.tsx
// Soft, tactile radial atlas with pill-wedge geometry, layer scaling, orbiting dependencies, and hover lineage
import React, { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { useStore, FilterMode } from "../store";
import {
  buildHierarchyTree,
  findNodeById,
  HierarchyNode,
  SelectedEntity,
} from "../lib/hierarchy";

export interface RadialMapProps {
  onSelectEntity?: (entity: SelectedEntity) => void;
  onDrillDown?: (nodeId: string) => void;
}

interface ExternalDependency {
  name: string;
  dir: "out" | "in";
  bad: boolean;
  ang: number;
}

export const RadialMap: React.FC<RadialMapProps> = ({ onSelectEntity, onDrillDown }) => {
  const {
    graph,
    currentScopeId,
    drillDown,
    drillUp,
    selectEntity,
    filterMode,
    setFilterMode,
  } = useStore();

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Dev controls state
  const [depthLimit, setDepthLimit] = useState<number>(5);
  const [maxLayers, setMaxLayers] = useState<number>(5); // 5 = Hard limit: 5, 9 = Unlimited
  const [showSplits, setShowSplits] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(1);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    node: HierarchyNode | null;
    layer: number;
    partOf?: string;
  }>({ visible: false, x: 0, y: 0, node: null, layer: 0 });

  // Double click tracker (<350ms)
  const lastClickRef = useRef<{ id: string | null; time: number }>({ id: null, time: 0 });

  const rootHierarchy = useMemo(() => buildHierarchyTree(graph), [graph]);

  const focusNode: HierarchyNode = useMemo(() => {
    if (!currentScopeId || currentScopeId === "root") return rootHierarchy;
    return findNodeById(rootHierarchy, currentScopeId) || rootHierarchy;
  }, [rootHierarchy, currentScopeId]);

  // Ring radii matching AFWE Codebase Atlas
  const ringR = useCallback((i: number): [number, number] => {
    if (i === 1) return [80, 190];
    if (i === 2) return [190, 232];
    if (i === 3) return [232, 272];
    if (i === 4) return [272, 330];
    if (i === 5) return [330, 360];
    return [360 + (i - 6) * 28, 388 + (i - 6) * 28];
  }, []);

  const pt = (r: number, a: number) => ({
    x: r * Math.sin(a),
    y: -r * Math.cos(a),
  });

  // Soft pill-wedge arc geometry with d = 4.5 inset
  const makeArc = (r0: number, r1: number, a0: number, a1: number): string => {
    const d = 4.5;
    r0 += d;
    r1 -= d;
    if (r1 <= r0) return "";
    const Ao = a0 + d / r1;
    const Bo = a1 - d / r1;
    const Ai = a0 + d / r0;
    const Bi = a1 - d / r0;
    if (Bo <= Ao || Bi <= Ai) return "";

    const f = (n: number) => n.toFixed(1);
    const p = (r: number, a: number) => {
      const q = pt(r, a);
      return `${f(q.x)} ${f(q.y)}`;
    };
    const L = Bo - Ao > Math.PI ? 1 : 0;
    return `M${p(r1, Ao)}A${f(r1)} ${f(r1)} 0 ${L} 1 ${p(r1, Bo)}L${p(r0, Bi)}A${f(r0)} ${f(r0)} 0 ${L} 0 ${p(r0, Ai)}Z`;
  };

  // Split layer 4 cells into sub-quadrants
  const splitSlice = (r0: number, r1: number, a0: number, a1: number, k: number) => {
    const mid = (r0 + r1) / 2;
    const am = (a0 + a1) / 2;
    if (k === 1) return [[r0, r1, a0, a1]];
    if (k === 2) return [[r0, mid, a0, a1], [mid, r1, a0, a1]];
    if (k === 3) return [[r0, mid, a0, a1], [mid, r1, a0, am], [mid, r1, am, a1]];
    return [
      [r0, mid, a0, am],
      [r0, mid, am, a1],
      [mid, r1, a0, am],
      [mid, r1, am, a1],
    ];
  };

  // External dependency items orbiting the ring when drilled into a subsystem
  const externalDependencies: ExternalDependency[] = useMemo(() => {
    if (!focusNode || focusNode === rootHierarchy || !graph) return [];

    const outgoing = new Set<string>();
    const incoming = new Set<string>();
    const violations = new Set<string>();

    const focusPrefix = focusNode.id;
    (graph.code_edges || []).forEach((e: any) => {
      const fromFocus = e.from === focusPrefix || e.from.startsWith(focusPrefix + "/") || e.from.startsWith(focusPrefix + ".");
      const toFocus = e.to === focusPrefix || e.to.startsWith(focusPrefix + "/") || e.to.startsWith(focusPrefix + ".");

      if (fromFocus && !toFocus) {
        const targetTop = e.to.split(/[\/\.]/)[0];
        if (targetTop) {
          outgoing.add(targetTop);
          if (e.violation) violations.add(targetTop);
        }
      } else if (toFocus && !fromFocus) {
        const sourceTop = e.from.split(/[\/\.]/)[0];
        if (sourceTop) {
          incoming.add(sourceTop);
          if (e.violation) violations.add(sourceTop);
        }
      }
    });

    // Fallback simulated dependencies for rich visual experience if graph edges are sparse
    if (outgoing.size === 0 && incoming.size === 0 && rootHierarchy.children) {
      const siblings = rootHierarchy.children.filter((c) => c.id !== focusNode.id);
      siblings.slice(0, 2).forEach((s) => outgoing.add(s.label));
      siblings.slice(2, 4).forEach((s) => incoming.add(s.label));
    }

    const outList = Array.from(outgoing).map((n) => ({
      name: n,
      dir: "out" as const,
      bad: violations.has(n),
      ang: 0,
    }));
    const inList = Array.from(incoming).map((n) => ({
      name: n,
      dir: "in" as const,
      bad: violations.has(n),
      ang: 0,
    }));

    const place = (arr: ExternalDependency[], centerAngle: number) => {
      const k = arr.length;
      const span = Math.min(1.5, 0.5 + k * 0.3);
      arr.forEach((e, i) => {
        e.ang = centerAngle + (k === 1 ? 0 : (i / (k - 1) - 0.5) * span);
      });
    };

    place(outList, -Math.PI / 2); // West: Depends on
    place(inList, Math.PI / 2);  // East: Used by

    return [...outList, ...inList];
  }, [focusNode, rootHierarchy, graph]);

  // Compute Layout Tree for Focus Node up to depthLimit
  const layoutItems = useMemo(() => {
    interface LayoutSlice {
      node: HierarchyNode;
      layer: number;
      r0: number;
      r1: number;
      a0: number;
      a1: number;
      state: "mapped" | "inferred" | "unmapped" | "legacy";
      pathD: string;
      subQuadrants?: { pathD: string; partOf: string; state: "mapped" | "inferred" | "unmapped" | "legacy" }[];
    }

    const items: LayoutSlice[] = [];

    const recurse = (node: HierarchyNode, layer: number, a0: number, a1: number) => {
      if (layer > depthLimit) return;
      const [r0, r1] = ringR(layer);

      // Determine state
      let state: "mapped" | "inferred" | "unmapped" | "legacy" = "mapped";
      if (!node.isCharted) state = "unmapped";
      else if (node.hasViolation) state = "legacy";
      else if (node.raw?.status === "inferred") state = "inferred";

      if (layer === 4 && showSplits) {
        const partsCount = Math.min(4, Math.max(1, (node.children?.length || 1)));
        const quads = splitSlice(r0, r1, a0, a1, partsCount);
        const subQuads = quads.map((q, idx) => ({
          pathD: makeArc(q[0], q[1], q[2], q[3]),
          partOf: `Part ${idx + 1} of ${partsCount}`,
          state,
        }));
        items.push({
          node,
          layer,
          r0,
          r1,
          a0,
          a1,
          state,
          pathD: makeArc(r0, r1, a0, a1),
          subQuadrants: subQuads,
        });
      } else {
        items.push({
          node,
          layer,
          r0,
          r1,
          a0,
          a1,
          state,
          pathD: makeArc(r0, r1, a0, a1),
        });
      }

      const kids = node.children || [];
      if (kids.length > 0 && layer < depthLimit) {
        const totalWeight = kids.reduce((sum, k) => sum + Math.max(1, k.fileCount), 0);
        let currA = a0;
        kids.forEach((k) => {
          const span = ((a1 - a0) * Math.max(1, k.fileCount)) / totalWeight;
          recurse(k, layer + 1, currA, currA + span);
          currA += span;
        });
      }
    };

    const rootKids = focusNode.children || [];
    if (rootKids.length > 0) {
      const totalWeight = rootKids.reduce((sum, k) => sum + Math.max(1, k.fileCount), 0);
      let currA = 0;
      rootKids.forEach((k) => {
        const span = (Math.PI * 2 * Math.max(1, k.fileCount)) / totalWeight;
        recurse(k, 1, currA, currA + span);
        currA += span;
      });
    }

    return items;
  }, [focusNode, depthLimit, showSplits, ringR]);

  // Handle single-click vs double-click (<350ms)
  const handleEntityClick = (node: HierarchyNode) => {
    const now = performance.now();
    const last = lastClickRef.current;

    if (last.id === node.id && now - last.time < 350) {
      // Double Click -> Drill Down
      lastClickRef.current = { id: null, time: 0 };
      if (node.children && node.children.length > 0) {
        drillDown(node.id);
        if (onDrillDown) onDrillDown(node.id);
      }
      return;
    }

    // Single Click -> Select Entity into Inspector
    lastClickRef.current = { id: node.id, time: now };
    const entity: SelectedEntity = {
      id: node.id,
      kind: node.kind,
      label: node.label,
      path: node.path,
      status: node.hasViolation ? "violation" : node.hasPin ? "pinned" : node.isCharted ? "mapped" : "uncharted",
      fileCount: node.fileCount,
      mappedCount: node.mappedCount,
      parentId: node.parentId,
      raw: node.raw,
    };
    selectEntity(entity);
    if (onSelectEntity) onSelectEntity(entity);
  };

  // Keyboard navigation: Escape drills up
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && focusNode !== rootHierarchy) {
        drillUp();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusNode, rootHierarchy, drillUp]);

  // Compute ViewBox dimensions
  const Rout = ringR(depthLimit)[1];
  const Rp = Rout + 88;
  const W = (externalDependencies.length ? Rp + 84 : Rout + 38) / zoom;
  const Ht = (Rout + 38) / zoom;

  // Filter check
  const isSliceVisible = (state: string) => {
    const f: string = filterMode;
    if (f === "all") return true;
    if (f === "mapped") return state === "mapped";
    if (f === "inferred") return state === "inferred";
    if (f === "uncharted" || f === "unmapped") return state === "unmapped";
    if (f === "legacy") return state === "legacy";
    return true;
  };

  // Hover Lineage check: hovered node's ancestors and descendants stay 100% opaque
  const isLineageMatch = (nodeId: string) => {
    if (!hoveredNodeId) return true;
    return (
      nodeId === hoveredNodeId ||
      nodeId.startsWith(hoveredNodeId + "/") ||
      nodeId.startsWith(hoveredNodeId + ".") ||
      hoveredNodeId.startsWith(nodeId + "/") ||
      hoveredNodeId.startsWith(nodeId + ".")
    );
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        userSelect: "none",
        background: "var(--bg)",
        overflow: "hidden",
      }}
    >
      {/* Top Atlas Control Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "10px 20px 6px 20px",
          flexWrap: "wrap",
          zIndex: 10,
        }}
      >
        {/* Filter Chips */}
        <div style={{ display: "flex", gap: "6px" }}>
          {(["all", "mapped", "inferred", "unmapped", "legacy"] as const).map((mode) => {
            const active = filterMode === mode || (mode === "unmapped" && filterMode === "uncharted");
            return (
              <button
                key={mode}
                onClick={() => setFilterMode(mode as FilterMode)}
                style={{
                  border: "1px solid var(--line)",
                  background: active ? "var(--accent)" : "var(--panel)",
                  color: active ? "var(--accent-ink)" : "var(--ink)",
                  borderRadius: "99px",
                  padding: "4px 12px",
                  fontSize: "12px",
                  cursor: "pointer",
                  fontWeight: active ? 600 : 500,
                  transition: "all 0.15s ease",
                }}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1 }} />

        {/* Up One Level Button */}
        {focusNode !== rootHierarchy && (
          <button
            onClick={() => drillUp()}
            style={{
              border: "1px solid var(--line)",
              background: "var(--panel)",
              color: "var(--ink)",
              borderRadius: "9px",
              padding: "4px 10px",
              fontSize: "12px",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            ‹ Up one level (Esc)
          </button>
        )}

        {/* Layers Depth Control */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            border: "1px solid var(--line)",
            background: "var(--panel)",
            borderRadius: "10px",
            padding: "3px 8px",
            fontSize: "12px",
            color: "var(--ink)",
          }}
        >
          <span>Layers</span>
          <button
            disabled={depthLimit <= 1}
            onClick={() => setDepthLimit((d) => Math.max(1, d - 1))}
            style={{
              border: "1px solid var(--line)",
              background: "var(--panel)",
              borderRadius: "6px",
              padding: "1px 6px",
              cursor: depthLimit <= 1 ? "default" : "pointer",
              color: "var(--ink)",
              opacity: depthLimit <= 1 ? 0.4 : 1,
            }}
          >
            −
          </button>
          <b style={{ minWidth: "12px", textAlign: "center" }}>{depthLimit}</b>
          <button
            disabled={depthLimit >= maxLayers}
            onClick={() => setDepthLimit((d) => Math.min(maxLayers, d + 1))}
            style={{
              border: "1px solid var(--line)",
              background: "var(--panel)",
              borderRadius: "6px",
              padding: "1px 6px",
              cursor: depthLimit >= maxLayers ? "default" : "pointer",
              color: "var(--ink)",
              opacity: depthLimit >= maxLayers ? 0.4 : 1,
            }}
          >
            +
          </button>
        </div>

        {/* Growth Limit Dropdown */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            border: "1px solid var(--line)",
            background: "var(--panel)",
            borderRadius: "10px",
            padding: "3px 8px",
            fontSize: "12px",
            color: "var(--ink)",
          }}
        >
          <span>Growth</span>
          <select
            value={maxLayers}
            onChange={(e) => {
              const val = Number(e.target.value);
              setMaxLayers(val);
              if (depthLimit > val) setDepthLimit(val);
            }}
            style={{
              background: "var(--panel)",
              color: "var(--ink)",
              border: "none",
              fontSize: "12px",
              cursor: "pointer",
              outline: "none",
            }}
          >
            <option value={5}>Hard limit: 5</option>
            <option value={9}>Unlimited</option>
          </select>
        </div>

        {/* Layer 4 Splits Checkbox */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            border: "1px solid var(--line)",
            background: "var(--panel)",
            borderRadius: "10px",
            padding: "3px 8px",
            fontSize: "12px",
            color: "var(--ink)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={showSplits}
            onChange={(e) => setShowSplits(e.target.checked)}
            style={{ cursor: "pointer", accentColor: "var(--accent)" }}
          />
          Layer 4 splits
        </label>
      </div>

      {/* Main Map Stage Card */}
      <div
        className="stage-soft"
        style={{
          flex: 1,
          margin: "0 20px 10px 20px",
          minHeight: 0,
          position: "relative",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <svg
          ref={svgRef}
          viewBox={`${-W} ${-Ht} ${2 * W} ${2 * Ht}`}
          style={{ width: "100%", height: "100%", display: "block" }}
        >
          <defs>
            <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="7" height="7" fill="var(--unm)" />
              <line y2="7" stroke="var(--hatch)" strokeWidth="1.4" />
            </pattern>
            <radialGradient id="cg">
              <stop offset="0" stopColor="var(--panel)" />
              <stop offset="1" stopColor="var(--side)" />
            </radialGradient>
            <marker id="ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M1 1L9 5L1 9z" fill="var(--mute)" />
            </marker>
            <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M1 1L9 5L1 9z" fill="var(--red)" />
            </marker>
          </defs>

          {/* Background Outer Disc & Guide Concentric Circles */}
          <circle r={Rout + 18} className="disc" />
          {Array.from({ length: depthLimit }, (_, idx) => (
            <circle key={idx} r={ringR(idx + 1)[1]} className="guide" />
          ))}

          {/* Center Disc: Root or Parent Navigation Hub */}
          <g
            className={`ctr${focusNode !== rootHierarchy ? " link" : ""}`}
            onClick={() => {
              if (focusNode !== rootHierarchy) drillUp();
            }}
            onMouseEnter={(e) => {
              setTooltip({
                visible: true,
                x: e.clientX,
                y: e.clientY,
                node: focusNode,
                layer: 0,
              });
            }}
            onMouseMove={(e) => {
              setTooltip((prev) => ({ ...prev, x: e.clientX, y: e.clientY }));
            }}
            onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
          >
            <circle r={76} fill="url(#cg)" stroke="var(--line)" strokeWidth="1.5" />
            {/* Progress Arc */}
            <circle r={68} fill="none" stroke="var(--line)" strokeWidth="3" />
            <circle
              r={68}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="3"
              strokeLinecap="round"
              transform="rotate(-90)"
              strokeDasharray={`${(0.82 * 2 * Math.PI * 68).toFixed(0)} 999`}
            />
            <text
              y={-3}
              className="lbl serif"
              style={{ fontSize: focusNode.label.length > 12 ? "14px" : "16px", fontWeight: 600 }}
            >
              {focusNode.label}
            </text>
            <text y={15} className="lbl m" style={{ fontSize: "11px" }}>
              {focusNode === rootHierarchy ? "(root)" : `‹ back · ${focusNode.fileCount.toLocaleString()} files`}
            </text>
          </g>

          {/* Pill-Wedge Cells */}
          <g className="cells">
            {layoutItems.map((item, idx) => {
              const visible = isSliceVisible(item.state);
              const inLineage = isLineageMatch(item.node.id);
              const isHovered = hoveredNodeId === item.node.id;

              if (item.subQuadrants && item.subQuadrants.length > 0) {
                return (
                  <g key={`${item.layer}-${item.node.id}-${idx}`}>
                    {item.subQuadrants.map((sq, sqIdx) => (
                      <path
                        key={sqIdx}
                        d={sq.pathD}
                        className={`cell s-${sq.state} ${item.node.hasViolation ? "v" : ""} ${
                          !visible ? "dim" : ""
                        } ${!inLineage ? "fade" : ""}`}
                        onClick={() => handleEntityClick(item.node)}
                        onMouseEnter={(e) => {
                          setHoveredNodeId(item.node.id);
                          setTooltip({
                            visible: true,
                            x: e.clientX,
                            y: e.clientY,
                            node: item.node,
                            layer: item.layer,
                            partOf: sq.partOf,
                          });
                        }}
                        onMouseMove={(e) => {
                          setTooltip((prev) => ({ ...prev, x: e.clientX, y: e.clientY }));
                        }}
                        onMouseLeave={() => {
                          setHoveredNodeId(null);
                          setTooltip((prev) => ({ ...prev, visible: false }));
                        }}
                      />
                    ))}
                    {/* Amber dashed split outline */}
                    <path d={item.pathD} className="ov sp" />
                  </g>
                );
              }

              return (
                <path
                  key={`${item.layer}-${item.node.id}-${idx}`}
                  d={item.pathD}
                  className={`cell s-${item.state} ${item.node.hasViolation ? "v" : ""} ${
                    !visible ? "dim" : ""
                  } ${!inLineage ? "fade" : ""}`}
                  onClick={() => handleEntityClick(item.node)}
                  onMouseEnter={(e) => {
                    setHoveredNodeId(item.node.id);
                    setTooltip({
                      visible: true,
                      x: e.clientX,
                      y: e.clientY,
                      node: item.node,
                      layer: item.layer,
                    });
                  }}
                  onMouseMove={(e) => {
                    setTooltip((prev) => ({ ...prev, x: e.clientX, y: e.clientY }));
                  }}
                  onMouseLeave={() => {
                    setHoveredNodeId(null);
                    setTooltip((prev) => ({ ...prev, visible: false }));
                  }}
                />
              );
            })}
          </g>

          {/* Overlays: Pin, Proposal, Violation Outlines */}
          <g>
            {layoutItems.map((item, idx) => {
              if (item.node.hasViolation) {
                return <path key={`viol-${idx}`} d={item.pathD} className="ov viol" />;
              }
              if (item.node.hasPin) {
                return <path key={`pin-${idx}`} d={item.pathD} className="ov pin" />;
              }
              if (item.node.hasProposal) {
                return <path key={`prop-${idx}`} d={item.pathD} className="ov prop" />;
              }
              return null;
            })}
          </g>

          {/* Ring 1 Radial Category Labels */}
          <g>
            {layoutItems
              .filter((item) => item.layer === 1)
              .map((item, idx) => {
                const midAngle = (item.a0 + item.a1) / 2;
                const midR = (item.r0 + item.r1) / 2;
                const m = pt(midR, midAngle);
                const arcWidth = (item.a1 - item.a0) * midR;
                if (arcWidth < 50) return null;

                return (
                  <g key={`lbl-${idx}`} style={{ pointerEvents: "none" }}>
                    <text
                      x={m.x}
                      y={m.y - 2}
                      className="lbl serif"
                      style={{ fontSize: arcWidth > 90 ? "14px" : "12px", fontWeight: 600 }}
                    >
                      {item.node.label}
                    </text>
                    <text x={m.x} y={m.y + 14} className="lbl m" style={{ fontSize: "10.5px" }}>
                      {item.node.fileCount.toLocaleString()} files
                    </text>
                  </g>
                );
              })}
          </g>

          {/* Orbiting External Dependencies (When Drilled Down) */}
          {externalDependencies.length > 0 && (
            <g>
              {externalDependencies.map((ext, idx) => {
                const west = ext.dir === "out";
                const cp = pt(Rp, ext.ang);
                const anchorAngle = west ? -Math.PI / 2 : Math.PI / 2;
                const A = pt(Rout + 2, anchorAngle);
                const C1 = pt(Rout + 46, anchorAngle);
                const px = cp.x + (west ? 62 : -62);
                const C2x = px + (west ? 60 : -60);

                const d = west
                  ? `M${A.x} ${A.y}C${C1.x} ${C1.y} ${C2x} ${cp.y} ${px} ${cp.y}`
                  : `M${px} ${cp.y}C${C2x} ${cp.y} ${C1.x} ${C1.y} ${A.x} ${A.y}`;

                return (
                  <g
                    key={idx}
                    className={`ex${ext.bad ? " bad" : ""}`}
                    onClick={() => {
                      const match = rootHierarchy.children?.find((c) => c.label === ext.name);
                      if (match) handleEntityClick(match);
                    }}
                  >
                    <path
                      d={d}
                      className={`edge${west ? "" : " in"}${ext.bad ? " bad" : ""}`}
                      markerEnd={`url(#${ext.bad ? "arr" : "ar"})`}
                    />
                    <circle cx={A.x} cy={A.y} r={4} className="dot" />
                    <rect x={cp.x - 62} y={cp.y - 16} width={124} height={32} rx={16} />
                    <text x={cp.x} y={cp.y}>
                      {ext.name}
                    </text>
                  </g>
                );
              })}

              {externalDependencies.some((e) => e.dir === "out") && (
                <text x={-Rp} y={-Rout - 10} className="lbl m" style={{ fontSize: "12px", fontWeight: 500 }}>
                  Depends on
                </text>
              )}
              {externalDependencies.some((e) => e.dir === "in") && (
                <text x={Rp} y={-Rout - 10} className="lbl m" style={{ fontSize: "12px", fontWeight: 500 }}>
                  Used by
                </text>
              )}
            </g>
          )}
        </svg>

        {/* 4 Corner Callout Cards */}
        {focusNode === rootHierarchy && (
          <>
            <div
              className="co"
              style={{ left: "16px", top: "16px" }}
              onClick={() => setFilterMode("uncharted")}
            >
              <i>▨</i>
              <div>
                <b>Unmapped territory</b>
                <span>Click to filter unmapped files</span>
              </div>
            </div>

            <div
              className="co"
              style={{ right: "16px", top: "16px" }}
              onClick={() => setFilterMode("inferred")}
            >
              <i style={{ background: "var(--inferred)" }}>▢</i>
              <div>
                <b>Inferred structure</b>
                <span>Guessed from code syntax</span>
              </div>
            </div>

            <div
              className="co"
              style={{ left: "16px", bottom: "46px" }}
              onClick={() => setFilterMode("all")}
            >
              <i style={{ color: "var(--amber)" }}>✦</i>
              <div>
                <b>Pinned by you</b>
                <span>Architectural boundaries</span>
              </div>
            </div>

            <div
              className="co"
              style={{ right: "16px", bottom: "46px" }}
              onClick={() => setFilterMode("proposals")}
            >
              <i style={{ background: "var(--redbg)", color: "var(--red)" }}>△</i>
              <div>
                <b>Proposals & Issues</b>
                <span>Pending balance checks</span>
              </div>
            </div>
          </>
        )}

        {/* Vertical Left Zoom Controls */}
        <div className="zoom-controls">
          <button className="btn-icon" onClick={() => setZoom((z) => Math.min(2.2, z * 1.25))} title="Zoom In">
            +
          </button>
          <button className="btn-icon" onClick={() => setZoom((z) => Math.max(0.8, z / 1.25))} title="Zoom Out">
            −
          </button>
          <button className="btn-icon" onClick={() => setZoom(1)} title="Reset Zoom">
            ◎
          </button>
        </div>

        {/* Stage Bottom Legend */}
        <div className="stage-legend">
          <span><i style={{ background: "var(--mapped)" }} />Mapped</span>
          <span><i style={{ background: "var(--inferred)" }} />Inferred</span>
          <span><i style={{ background: "var(--unm)" }} />Unmapped</span>
          <span><i style={{ background: "var(--legacy)" }} />Legacy</span>
          <span><i style={{ background: "var(--redbg)", border: "1px solid var(--red)" }} />Rule violation</span>
          {focusNode !== rootHierarchy && (
            <>
              <span style={{ marginLeft: "10px" }}>⟶ depends on</span>
              <span>⋯▸ used by</span>
            </>
          )}
        </div>
      </div>

      {/* Floating Cursor Tooltip */}
      {tooltip.visible && tooltip.node && (
        <div
          className="tip-floating on"
          style={{
            left: `${Math.min(window.innerWidth - 280, tooltip.x + 16)}px`,
            top: `${Math.max(10, Math.min(window.innerHeight - 150, tooltip.y + 16))}px`,
          }}
        >
          <b className="serif">{tooltip.node.label}</b>
          <div className="tm" style={{ marginTop: "2px" }}>
            {tooltip.node.path || tooltip.node.label}
          </div>
          <div style={{ marginTop: "4px" }}>
            Layer {tooltip.layer} · {tooltip.node.isCharted ? "Mapped" : "Unmapped"} · {tooltip.node.fileCount.toLocaleString()} files
          </div>
          {tooltip.partOf && <div className="tm">{tooltip.partOf}</div>}
          {tooltip.node.hasViolation && <div className="fr" style={{ marginTop: "2px" }}>Rule violation here</div>}
          {tooltip.node.hasPin && <div className="fl" style={{ marginTop: "2px" }}>Pinned: do not modify</div>}
          <div className="tm" style={{ marginTop: "6px", borderTop: "1px solid var(--line)", paddingTop: "4px" }}>
            Click to inspect · double-click to open its map
          </div>
        </div>
      )}
    </div>
  );
};
