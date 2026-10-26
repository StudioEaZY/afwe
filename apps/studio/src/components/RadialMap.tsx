// apps/studio/src/components/RadialMap.tsx
import React, { useMemo, useState } from "react";
import { useStore, FilterMode } from "../store";
import {
  buildHierarchyTree,
  findNodeById,
  determineSplitStrategy,
  discoverVisibleKinds,
  computeRadialLayout,
  describeArc,
  HierarchyNode,
  RadialSlice,
  SelectedEntity,
  EntityKind,
} from "../lib/hierarchy";

interface RadialMapProps {
  onSelectEntity?: (entity: SelectedEntity) => void;
  onDrillDown?: (nodeId: string) => void;
}

export const RadialMap: React.FC<RadialMapProps> = ({ onSelectEntity, onDrillDown }) => {
  const {
    graph,
    currentScopeId,
    currentDepth,
    drillDown,
    drillUp,
    selectEntity,
    filterMode,
    setFilterMode,
  } = useStore();

  const [hoveredSlice, setHoveredSlice] = useState<RadialSlice | null>(null);

  const rootHierarchy = useMemo(() => buildHierarchyTree(graph), [graph]);

  const focusNode: HierarchyNode = useMemo(() => {
    if (!currentScopeId) return rootHierarchy;
    return findNodeById(rootHierarchy, currentScopeId) || rootHierarchy;
  }, [rootHierarchy, currentScopeId]);

  const { strategyName, caption } = useMemo(
    () => determineSplitStrategy(focusNode),
    [focusNode]
  );

  const visibleKinds = useMemo(() => discoverVisibleKinds(focusNode), [focusNode]);

  // Canvas geometry
  const width = 760;
  const height = 560;
  const cx = width / 2;
  const cy = height / 2 + 10;
  const maxRadius = Math.min(width, height) / 2 - 32;

  const { slices, centerHub } = useMemo(
    () => computeRadialLayout(focusNode, cx, cy, maxRadius),
    [focusNode, cx, cy, maxRadius]
  );

  // Filter slices based on filterMode
  const filteredSlices = useMemo(() => {
    if (filterMode === "all") return slices;
    if (filterMode === "mapped") return slices.filter((s) => s.isCharted);
    if (filterMode === "uncharted") return slices.filter((s) => !s.isCharted);
    if (filterMode === "proposals") return slices.filter((s) => s.hasProposal);
    if (filterMode === "issues") return slices.filter((s) => s.hasViolation || s.hasQuestion);
    return slices;
  }, [slices, filterMode]);

  const handleSliceClick = (e: React.MouseEvent, slice: RadialSlice) => {
    e.stopPropagation();
    const entity: SelectedEntity = {
      id: slice.id,
      kind: slice.kind,
      label: slice.label,
      path: slice.path,
      status: slice.hasViolation
        ? "violation"
        : slice.hasPin
        ? "pinned"
        : slice.isCharted
        ? "mapped"
        : "uncharted",
      fileCount: slice.fileCount,
      mappedCount: slice.mappedCount,
      parentId: slice.node.parentId,
      raw: slice.node.raw,
    };
    selectEntity(entity);
    if (onSelectEntity) onSelectEntity(entity);
  };

  const handleSliceDoubleClick = (e: React.MouseEvent, slice: RadialSlice) => {
    e.stopPropagation();
    // Only drill down if node has children
    if (slice.node.children && slice.node.children.length > 0) {
      drillDown(slice.id);
      if (onDrillDown) onDrillDown(slice.id);
    }
  };

  const handleCenterClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentDepth > 0) {
      drillUp();
    } else {
      selectEntity({
        id: focusNode.id,
        kind: focusNode.kind,
        label: focusNode.label,
        path: focusNode.path,
        status: focusNode.isCharted ? "mapped" : "uncharted",
        fileCount: focusNode.fileCount,
        mappedCount: focusNode.mappedCount,
        parentId: null,
      });
    }
  };

  const getSliceFill = (slice: RadialSlice, isHovered: boolean) => {
    if (slice.hasViolation) return isHovered ? "#FBE6E3" : "#FDECE9";
    if (slice.hasPin) return isHovered ? "#F7EFCF" : "#FAF3DB";
    if (!slice.isCharted) return "url(#radial-hatch)";
    if (slice.ring === 1) return isHovered ? "#DCD4BE" : "#E6DFCD";
    return isHovered ? "#E3DDC9" : "#EEE9D9";
  };

  return (
    <div className="radial-map-container" style={{ position: "relative", width: "100%", height: "100%", userSelect: "none" }}>
      {/* Top Header & Adaptive Caption */}
      <div className="radial-top-header" style={{ padding: "16px 24px 8px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 style={{ fontFamily: "Newsreader, serif", fontSize: "24px", fontWeight: 600, color: "#1D1C1A", margin: 0 }}>
              {focusNode.label}
              {focusNode.hasViolation && (
                <span style={{ fontSize: "12px", background: "#FDECE9", color: "#B23A2B", padding: "2px 8px", borderRadius: "12px", marginLeft: "10px", fontWeight: 600 }}>
                  Issues need attention
                </span>
              )}
            </h2>
            <div style={{ fontSize: "13px", color: "#6B675D", marginTop: "3px", fontFamily: "'IBM Plex Sans', sans-serif" }}>
              {caption}
            </div>
          </div>

          {/* Filter Pills */}
          <div className="filter-pill-bar" style={{ display: "flex", gap: "6px", background: "#ECE7D9", padding: "3px", borderRadius: "8px" }}>
            {(["all", "mapped", "uncharted", "proposals", "issues"] as FilterMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setFilterMode(mode)}
                style={{
                  border: "none",
                  padding: "4px 10px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: filterMode === mode ? 600 : 400,
                  background: filterMode === mode ? "#FFFFFF" : "transparent",
                  color: filterMode === mode ? "#1D1C1A" : "#6B675D",
                  cursor: "pointer",
                  textTransform: "capitalize",
                  boxShadow: filterMode === mode ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
                  transition: "all 0.15s ease",
                }}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main SVG Canvas */}
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        style={{ overflow: "visible" }}
      >
        <defs>
          {/* Subtle Drop Shadow */}
          <filter id="radial-shadow" x="-10%" y="-10%" width="120%" height="125%">
            <feDropShadow dx="0" dy="8" stdDeviation="10" floodColor="#5A4A2A" floodOpacity="0.12" />
          </filter>

          {/* 45° Diagonal Hatch Pattern for Uncharted Territory */}
          <pattern id="radial-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="7" stroke="#C4BCAB" strokeWidth="1.5" />
          </pattern>
        </defs>

        {/* Outer Circular Bed */}
        <circle
          cx={cx}
          cy={cy}
          r={maxRadius + 4}
          fill="#FAF8F3"
          stroke="#E2DCce"
          strokeWidth="1"
          filter="url(#radial-shadow)"
        />

        {/* Concentric Grid Guides */}
        <circle cx={cx} cy={cy} r={maxRadius * 0.62} fill="none" stroke="#E2DCce" strokeDasharray="3 3" />
        <circle cx={cx} cy={cy} r={maxRadius * 0.28 + 8} fill="none" stroke="#E2DCce" />

        {/* Ring Slices */}
        <g className="radial-slices-group">
          {filteredSlices.map((slice) => {
            const isHovered = hoveredSlice?.id === slice.id;
            const pathD = describeArc(cx, cy, slice.innerRadius, slice.outerRadius, slice.startAngle, slice.endAngle);

            // Compute midpoint for text label placement
            const midAngle = (slice.startAngle + slice.endAngle) / 2;
            const midR = (slice.innerRadius + slice.outerRadius) / 2;
            const labelX = cx + midR * Math.cos(midAngle);
            const labelY = cy + midR * Math.sin(midAngle);
            const arcSpan = slice.endAngle - slice.startAngle;

            // Only display label if slice is wide enough
            const showLabel = arcSpan > 0.18;

            return (
              <g
                key={`${slice.ring}-${slice.id}`}
                onClick={(e) => handleSliceClick(e, slice)}
                onDoubleClick={(e) => handleSliceDoubleClick(e, slice)}
                onMouseEnter={() => setHoveredSlice(slice)}
                onMouseLeave={() => setHoveredSlice(null)}
                style={{ cursor: "pointer" }}
              >
                <path
                  d={pathD}
                  fill={getSliceFill(slice, isHovered)}
                  stroke={slice.hasViolation ? "#B23A2B" : "#1D1C1A"}
                  strokeWidth={slice.hasViolation ? 2 : 1}
                  strokeDasharray={!slice.isCharted ? "4 3" : "none"}
                  style={{
                    transition: "fill 0.15s ease, stroke 0.15s ease",
                  }}
                />

                {/* Slice Label & File Count (Inner Ring or prominent Outer Ring) */}
                {showLabel && (
                  <text
                    x={labelX}
                    y={labelY - (slice.ring === 1 ? 4 : 0)}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#1D1C1A"
                    style={{
                      fontFamily: "'IBM Plex Sans', sans-serif",
                      fontSize: slice.ring === 1 ? "11.5px" : "10px",
                      fontWeight: 600,
                      pointerEvents: "none",
                    }}
                  >
                    {slice.label.length > 14 ? `${slice.label.slice(0, 12)}…` : slice.label}
                  </text>
                )}
                {showLabel && slice.ring === 1 && (
                  <text
                    x={labelX}
                    y={labelY + 11}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#6B675D"
                    style={{
                      fontFamily: "'IBM Plex Sans', sans-serif",
                      fontSize: "9.5px",
                      pointerEvents: "none",
                    }}
                  >
                    {slice.fileCount.toLocaleString()} {slice.fileCount === 1 ? "file" : "files"}
                  </text>
                )}

                {/* Violation Attention Badge */}
                {slice.hasViolation && (
                  <g transform={`translate(${labelX + 16}, ${labelY - 14})`}>
                    <circle r="7" fill="#B23A2B" />
                    <text textAnchor="middle" dominantBaseline="central" fill="#FFFFFF" fontSize="9" fontWeight="bold">
                      !
                    </text>
                  </g>
                )}

                {/* Pin Badge */}
                {slice.hasPin && !slice.hasViolation && (
                  <g transform={`translate(${labelX + 16}, ${labelY - 14})`}>
                    <circle r="6" fill="#C89D54" />
                    <text textAnchor="middle" dominantBaseline="central" fill="#FFFFFF" fontSize="8">
                      ✦
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </g>

        {/* Center Hub: Current Scope Core */}
        <g onClick={handleCenterClick} style={{ cursor: currentDepth > 0 ? "pointer" : "default" }}>
          <circle
            cx={cx}
            cy={cy}
            r={centerHub.radius}
            fill="#FFFFFF"
            stroke="#1D1C1A"
            strokeWidth="1.5"
            filter="url(#radial-shadow)"
          />
          {currentDepth > 0 && (
            <text
              x={cx}
              y={cy - 22}
              textAnchor="middle"
              fill="#2E7A57"
              style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: "10px", fontWeight: 600 }}
            >
              ↑ Step out (Esc)
            </text>
          )}
          <text
            x={cx}
            y={cy - (currentDepth > 0 ? 4 : 8)}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#1D1C1A"
            style={{
              fontFamily: "Newsreader, serif",
              fontSize: "17px",
              fontWeight: 600,
            }}
          >
            {centerHub.label.length > 18 ? `${centerHub.label.slice(0, 16)}…` : centerHub.label}
          </text>
          <text
            x={cx}
            y={cy + 16}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#6B675D"
            style={{
              fontFamily: "'IBM Plex Sans', sans-serif",
              fontSize: "11px",
            }}
          >
            {centerHub.fileCount.toLocaleString()} files
          </text>
          <text
            x={cx}
            y={cy + 30}
            textAnchor="middle"
            dominantBaseline="central"
            fill={centerHub.isCharted ? "#2E7A57" : "#8A8475"}
            style={{
              fontFamily: "'IBM Plex Sans', sans-serif",
              fontSize: "10px",
              fontWeight: 500,
            }}
          >
            ● {centerHub.mappedCount > 0 ? `${Math.round((centerHub.mappedCount / Math.max(1, centerHub.fileCount)) * 100)}% mapped` : "Uncharted"}
          </text>
        </g>
      </svg>

      {/* Adaptive Legend at Bottom-Left (Only shows visible kinds at this level) */}
      <div
        className="radial-legend"
        style={{
          position: "absolute",
          bottom: "16px",
          left: "24px",
          background: "rgba(255, 255, 255, 0.85)",
          backdropFilter: "blur(6px)",
          border: "1px solid #E5E0D5",
          borderRadius: "8px",
          padding: "8px 12px",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          fontSize: "11px",
          color: "#4A463E",
          boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
        }}
      >
        <div style={{ fontWeight: 600, color: "#1D1C1A", fontSize: "10.5px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Legend ({strategyName})
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ width: "12px", height: "12px", background: "#E6DFCD", border: "1px solid #1D1C1A", borderRadius: "2px", display: "inline-block" }} />
          <span>Charted (Mapped blueprint)</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              width: "12px",
              height: "12px",
              background: "repeating-linear-gradient(45deg, #FAF8F3, #FAF8F3 2px, #C4BCAB 2px, #C4BCAB 4px)",
              border: "1px dashed #1D1C1A",
              borderRadius: "2px",
              display: "inline-block",
            }}
          />
          <span>Uncharted (Inferred code)</span>
        </div>
        {visibleKinds.includes("violation") && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ width: "12px", height: "12px", background: "#FDECE9", border: "1.5px solid #B23A2B", borderRadius: "2px", display: "inline-block" }} />
            <span style={{ color: "#B23A2B", fontWeight: 500 }}>Rule violation</span>
          </div>
        )}
        {visibleKinds.includes("pin") && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "#C89D54", fontWeight: "bold" }}>✦</span>
            <span>Pinned intent</span>
          </div>
        )}
      </div>

      {/* Floating Hover Tooltip */}
      {hoveredSlice && (
        <div
          style={{
            position: "absolute",
            top: "16px",
            right: "24px",
            background: "#1D1C1A",
            color: "#FFFFFF",
            padding: "8px 12px",
            borderRadius: "6px",
            fontSize: "12px",
            pointerEvents: "none",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            zIndex: 10,
          }}
        >
          <div style={{ fontWeight: 600 }}>{hoveredSlice.label}</div>
          <div style={{ fontSize: "11px", color: "#C4BCAB" }}>{hoveredSlice.path}</div>
          <div style={{ fontSize: "11px", marginTop: "4px" }}>
            {hoveredSlice.fileCount.toLocaleString()} files · {hoveredSlice.isCharted ? "Mapped" : "Uncharted"}
          </div>
          <div style={{ fontSize: "10px", color: "#8E8878", marginTop: "2px" }}>
            Double-click to dive inside
          </div>
        </div>
      )}
    </div>
  );
};
