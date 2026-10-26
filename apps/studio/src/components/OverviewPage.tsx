// apps/studio/src/components/OverviewPage.tsx
import React, { useMemo } from "react";
import { useStore } from "../store";
import { RadialMap } from "./RadialMap";
import { TopologyMap } from "./TopologyMap";
import { NodeInspector } from "./NodeInspector";
import { buildHierarchyTree, findNodeById } from "../lib/hierarchy";

export const OverviewPage: React.FC = () => {
  const {
    graph,
    activeLens,
    setActiveLens,
    currentScopeId,
    currentDepth,
    setScope,
    pinStartView,
    addBookmark,
    prefs,
    scrubToTurn,
  } = useStore();

  const rootHierarchy = useMemo(() => buildHierarchyTree(graph), [graph]);

  const focusNode = useMemo(() => {
    if (!currentScopeId) return rootHierarchy;
    return findNodeById(rootHierarchy, currentScopeId) || rootHierarchy;
  }, [rootHierarchy, currentScopeId]);

  // Compute Breadcrumb trail
  const breadcrumbs = useMemo(() => {
    const trail = [{ id: "root", label: graph?.project?.name || "Codebase" }];
    if (currentScopeId && currentScopeId !== "root") {
      let cur = findNodeById(rootHierarchy, currentScopeId);
      const stack = [];
      while (cur && cur.id !== "root") {
        stack.unshift({ id: cur.id, label: cur.label });
        cur = cur.parentId ? findNodeById(rootHierarchy, cur.parentId) : null;
      }
      trail.push(...stack);
    }
    return trail;
  }, [graph, currentScopeId, rootHierarchy]);

  // KPI Calculations
  const totalFiles = graph?.files?.length || 0;
  const unmappedFiles = graph?.unmapped?.length || 0;
  const mappedFiles = Math.max(0, totalFiles - unmappedFiles);
  const mappedPct = totalFiles > 0 ? Math.round((mappedFiles / totalFiles) * 100) : 0;
  const proposalsCount = graph?.proposals?.length || 0;
  const violationsCount = (graph?.code_edges || []).filter((e: any) => e.violation).length;

  const isCurrentStartView = prefs.defaultStartNodeId === currentScopeId && prefs.defaultLens === activeLens;

  const handleToggleStartView = () => {
    if (isCurrentStartView) {
      pinStartView(null, activeLens);
    } else {
      pinStartView(currentScopeId, activeLens);
    }
  };

  const handleAddBookmark = () => {
    addBookmark({
      id: focusNode.id,
      label: focusNode.label,
      path: focusNode.path,
      lens: activeLens,
    });
  };

  return (
    <div className="overview-page" style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", background: "#FAF8F3" }}>
      {/* 1. Top KPI Metric Strip */}
      <div
        className="kpi-metric-strip"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "14px",
          padding: "10px 24px",
          borderBottom: "1px solid #E5E0D5",
          background: "#FFFFFF",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#FAF8F3", padding: "6px 14px", borderRadius: "8px", border: "1px solid #ECE7D9" }}>
          <span style={{ fontSize: "14px" }}>📄</span>
          <div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#1D1C1A" }}>{totalFiles.toLocaleString()}</div>
            <div style={{ fontSize: "10.5px", color: "#6B675D" }}>Total files</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#FAF8F3", padding: "6px 14px", borderRadius: "8px", border: "1px solid #ECE7D9" }}>
          <span style={{ fontSize: "14px" }}>▣</span>
          <div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#2E7A57" }}>{mappedPct}%</div>
            <div style={{ fontSize: "10.5px", color: "#6B675D" }}>{mappedFiles.toLocaleString()} Mapped</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#FAF8F3", padding: "6px 14px", borderRadius: "8px", border: "1px solid #ECE7D9" }}>
          <span style={{ fontSize: "14px" }}>◌</span>
          <div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#8E8878" }}>{100 - mappedPct}%</div>
            <div style={{ fontSize: "10.5px", color: "#6B675D" }}>{unmappedFiles.toLocaleString()} Uncharted</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#FAF8F3", padding: "6px 14px", borderRadius: "8px", border: "1px solid #ECE7D9" }}>
          <span style={{ fontSize: "14px" }}>✎</span>
          <div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#1D1C1A" }}>{proposalsCount}</div>
            <div style={{ fontSize: "10.5px", color: "#6B675D" }}>Proposals</div>
          </div>
        </div>

        {violationsCount > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#FDECE9", padding: "6px 14px", borderRadius: "8px", border: "1px solid #F3C6BE" }}>
            <span style={{ fontSize: "14px", color: "#B23A2B" }}>▲</span>
            <div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#B23A2B" }}>{violationsCount}</div>
              <div style={{ fontSize: "10.5px", color: "#8B2317" }}>Rule violations</div>
            </div>
          </div>
        )}
      </div>

      {/* 2. Navigation Bar: Breadcrumbs, Layers, Lens Switcher, Bookmarks */}
      <div
        className="map-nav-bar"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 24px",
          borderBottom: "1px solid #E5E0D5",
          background: "#FAF8F3",
        }}
      >
        {/* Breadcrumb Trail */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
          {breadcrumbs.map((crumb, idx) => (
            <React.Fragment key={crumb.id}>
              {idx > 0 && <span style={{ color: "#8E8878" }}>›</span>}
              <button
                onClick={() => setScope(crumb.id === "root" ? null : crumb.id)}
                style={{
                  background: "none",
                  border: "none",
                  color: idx === breadcrumbs.length - 1 ? "#1D1C1A" : "#6B675D",
                  fontWeight: idx === breadcrumbs.length - 1 ? 600 : 400,
                  cursor: "pointer",
                  padding: "2px 4px",
                  borderRadius: "4px",
                }}
              >
                {crumb.label}
              </button>
            </React.Fragment>
          ))}

          {/* Quick-Jump Layer Indicator */}
          <span style={{ marginLeft: "12px", background: "#ECE7D9", color: "#4A463E", fontSize: "11px", padding: "2px 8px", borderRadius: "10px", fontWeight: 600 }}>
            L{currentDepth}
          </span>
        </div>

        {/* View Controls: Start view, Bookmark, Lens switcher */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            onClick={handleToggleStartView}
            style={{
              background: isCurrentStartView ? "#E8F3ED" : "#FFFFFF",
              border: `1px solid ${isCurrentStartView ? "#2E7A57" : "#DCD9D0"}`,
              color: isCurrentStartView ? "#2E7A57" : "#4A463E",
              padding: "5px 10px",
              borderRadius: "6px",
              fontSize: "11.5px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {isCurrentStartView ? "✓ Start View" : "📌 Set Start View"}
          </button>

          <button
            onClick={handleAddBookmark}
            style={{
              background: "#FFFFFF",
              border: "1px solid #DCD9D0",
              color: "#4A463E",
              padding: "5px 10px",
              borderRadius: "6px",
              fontSize: "11.5px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            + Bookmark
          </button>

          {/* Dual Lens Switcher: Radial vs Topology */}
          <div style={{ display: "flex", background: "#ECE7D9", padding: "3px", borderRadius: "8px" }}>
            <button
              onClick={() => setActiveLens("radial")}
              style={{
                background: activeLens === "radial" ? "#FFFFFF" : "transparent",
                color: activeLens === "radial" ? "#1D1C1A" : "#6B675D",
                border: "none",
                padding: "4px 12px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: activeLens === "radial" ? 600 : 400,
                cursor: "pointer",
                boxShadow: activeLens === "radial" ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
              }}
            >
              Radial
            </button>
            <button
              onClick={() => setActiveLens("topology")}
              style={{
                background: activeLens === "topology" ? "#FFFFFF" : "transparent",
                color: activeLens === "topology" ? "#1D1C1A" : "#6B675D",
                border: "none",
                padding: "4px 12px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: activeLens === "topology" ? 600 : 400,
                cursor: "pointer",
                boxShadow: activeLens === "topology" ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
              }}
            >
              Topology
            </button>
          </div>
        </div>
      </div>

      {/* 3. Main Center Split: Map Canvas (Left) + Contextual Inspector (Right) */}
      <div style={{ flex: 1, display: "flex", minHeight: 0, position: "relative" }}>
        <div style={{ flex: 1, height: "100%", overflow: "hidden" }}>
          {activeLens === "radial" ? <RadialMap /> : <TopologyMap />}
        </div>
        <NodeInspector />
      </div>

      {/* 4. Bottom Horizontal Turn Scrubber Strip */}
      <div
        className="bottom-turn-scrubber"
        style={{
          height: "90px",
          background: "#FFFFFF",
          borderTop: "1px solid #E5E0D5",
          padding: "8px 24px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: "6px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#6B675D", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Every Moment All at Once · Recent Turns
          </div>
          <button
            onClick={() => scrubToTurn(null)}
            style={{ background: "none", border: "none", color: "#2E7A57", fontSize: "11px", fontWeight: 600, cursor: "pointer" }}
          >
            Reset to Present
          </button>
        </div>

        <div style={{ display: "flex", gap: "10px", overflowX: "auto" }}>
          {(graph?.turns || []).slice(0, 7).map((turn: any) => (
            <div
              key={turn.id}
              onClick={() => scrubToTurn(turn.id)}
              style={{
                flexShrink: 0,
                padding: "6px 12px",
                borderRadius: "6px",
                background: "#FAF8F3",
                border: "1px solid #ECE7D9",
                cursor: "pointer",
                fontSize: "11.5px",
                display: "flex",
                flexDirection: "column",
                gap: "2px",
                minWidth: "160px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 600, color: "#1D1C1A" }}>#{turn.id}</span>
                <span
                  style={{
                    fontSize: "9px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    padding: "1px 4px",
                    borderRadius: "3px",
                    background: turn.status === "committed" ? "#E8F3ED" : "#FAF3DB",
                    color: turn.status === "committed" ? "#2E7A57" : "#87661A",
                  }}
                >
                  {turn.status}
                </span>
              </div>
              <div style={{ fontSize: "10.5px", color: "#6B675D", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {turn.summary || turn.prompt}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
