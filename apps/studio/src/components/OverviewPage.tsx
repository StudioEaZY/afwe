// apps/studio/src/components/OverviewPage.tsx
// Soft, tactile Overview with Codebase Atlas aesthetics, dual lens switcher, rewind timeline, and inspector
import React, { useMemo, useState, useRef } from "react";
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
    activeTurn,
  } = useStore();

  const [timelineT, setTimelineT] = useState<number>(1);
  const [isDraggingTl, setIsDraggingTl] = useState<boolean>(false);
  const tlSvgRef = useRef<SVGSVGElement>(null);

  const rootHierarchy = useMemo(() => buildHierarchyTree(graph), [graph]);

  const focusNode = useMemo(() => {
    if (!currentScopeId) return rootHierarchy;
    return findNodeById(rootHierarchy, currentScopeId) || rootHierarchy;
  }, [rootHierarchy, currentScopeId]);

  // Compute Breadcrumb trail
  const breadcrumbs = useMemo(() => {
    const trail = [{ id: "root", label: "Atlas" }];
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
  }, [currentScopeId, rootHierarchy]);

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

  // Timeline Scrubbing
  const turns = graph?.turns || [];
  const handleTimelineMove = (clientX: number) => {
    if (!tlSvgRef.current) return;
    const rect = tlSvgRef.current.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setTimelineT(t);

    if (turns.length > 0) {
      if (t >= 0.98) {
        scrubToTurn(null);
      } else {
        const turnIdx = Math.min(turns.length - 1, Math.floor(t * turns.length));
        scrubToTurn(turns[turnIdx].id);
      }
    }
  };

  const currentScrubbedTurn = useMemo(() => {
    if (timelineT >= 0.98 || turns.length === 0) return null;
    const turnIdx = Math.min(turns.length - 1, Math.floor(timelineT * turns.length));
    return turns[turnIdx];
  }, [timelineT, turns]);

  // Simulated activity bars for timeline
  const bars = useMemo(() => {
    const heights = [9, 11, 6, 22, 13, 20, 19, 14, 18, 13, 23, 6, 7, 20, 17, 9, 14, 8, 19, 17, 5, 6, 21, 22, 14, 14, 15, 23, 19, 22, 18, 6, 6, 12, 19, 6, 5, 13, 24, 22, 18, 13, 16, 15, 4, 18, 15, 9, 23, 7, 19, 5, 10, 13, 8, 11, 16, 16, 19, 6, 9, 18, 16, 21, 12, 8, 17, 21, 12, 17];
    return heights.map((h, i) => ({
      x: 24 + i * 15,
      h,
    }));
  }, []);

  return (
    <div
      className="overview-page"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        background: "var(--bg)",
        overflowY: "auto",
      }}
    >
      {/* 1. Header with Breadcrumbs, Title Row, Subtitle & Lens Switcher */}
      <div style={{ padding: "16px 24px 6px 24px" }}>
        {/* Breadcrumb Trail */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--mute)", minHeight: "18px" }}>
          {breadcrumbs.map((crumb, idx) => (
            <React.Fragment key={crumb.id}>
              {idx > 0 && <span>›</span>}
              <button
                onClick={() => setScope(crumb.id === "root" ? null : crumb.id)}
                style={{
                  background: "none",
                  border: "none",
                  color: idx === breadcrumbs.length - 1 ? "var(--ink)" : "var(--mute)",
                  fontWeight: idx === breadcrumbs.length - 1 ? 600 : 400,
                  cursor: "pointer",
                  padding: 0,
                  fontSize: "12px",
                }}
              >
                {crumb.label}
              </button>
            </React.Fragment>
          ))}
          <span style={{ marginLeft: "8px", background: "var(--side)", color: "var(--ink)", fontSize: "11px", padding: "1px 7px", borderRadius: "10px", fontWeight: 600 }}>
            L{currentDepth}
          </span>
        </div>

        {/* Title Row & Quick Pills */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px", marginTop: "4px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <h1 className="serif" style={{ margin: 0, fontSize: "28px", color: "var(--ink)", fontWeight: 600 }}>
              {focusNode.id === "root" ? "Codebase Atlas" : focusNode.label}
            </h1>
            <span className="pill" style={{ background: "var(--side)", color: "var(--mute)", border: "1px solid var(--line)" }}>
              {mappedPct}% mapped
            </span>
            {violationsCount > 0 && (
              <span className="pill" style={{ background: "var(--redbg)", color: "var(--red)", border: "1px solid var(--red)" }}>
                {violationsCount} issue(s)
              </span>
            )}
          </div>

          {/* Right Controls: Start view, Bookmark, Dual Lens Switcher */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              onClick={handleToggleStartView}
              style={{
                background: isCurrentStartView ? "var(--side)" : "var(--panel)",
                border: `1px solid ${isCurrentStartView ? "var(--accent)" : "var(--line)"}`,
                color: isCurrentStartView ? "var(--accent)" : "var(--ink)",
                padding: "4px 10px",
                borderRadius: "8px",
                fontSize: "12px",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {isCurrentStartView ? "✓ Start View" : "📌 Set Start View"}
            </button>

            <button
              onClick={handleAddBookmark}
              style={{
                background: "var(--panel)",
                border: "1px solid var(--line)",
                color: "var(--ink)",
                padding: "4px 10px",
                borderRadius: "8px",
                fontSize: "12px",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              + Bookmark
            </button>

            {/* Dual Lens Switcher: Radial vs Topology */}
            <div style={{ display: "flex", background: "var(--side)", padding: "2px", borderRadius: "8px", border: "1px solid var(--line)" }}>
              <button
                onClick={() => setActiveLens("radial")}
                style={{
                  background: activeLens === "radial" ? "var(--panel)" : "transparent",
                  color: activeLens === "radial" ? "var(--ink)" : "var(--mute)",
                  border: "none",
                  padding: "4px 12px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: activeLens === "radial" ? 600 : 500,
                  cursor: "pointer",
                  boxShadow: activeLens === "radial" ? "0 2px 6px var(--shadow)" : "none",
                }}
              >
                Radial
              </button>
              <button
                onClick={() => setActiveLens("topology")}
                style={{
                  background: activeLens === "topology" ? "var(--panel)" : "transparent",
                  color: activeLens === "topology" ? "var(--ink)" : "var(--mute)",
                  border: "none",
                  padding: "4px 12px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: activeLens === "topology" ? 600 : 500,
                  cursor: "pointer",
                  boxShadow: activeLens === "topology" ? "0 2px 6px var(--shadow)" : "none",
                }}
              >
                Topology
              </button>
            </div>
          </div>
        </div>

        {/* Subtitle */}
        <p style={{ margin: "4px 0 10px 0", color: "var(--mute)", fontSize: "13px" }}>
          {focusNode.id === "root"
            ? "Explore your codebase structure. Double-click any section to open its own map."
            : `${focusNode.label} up close. Orbiting satellites are external modules it depends on (left) or that depend on it (right).`}
        </p>
      </div>

      {/* 2. Main Center Split: Map Canvas (Left) + Contextual Inspector (Right) */}
      <div style={{ flex: 1, display: "flex", minHeight: "460px", position: "relative" }}>
        <div style={{ flex: 1, height: "100%", overflow: "hidden" }}>
          {activeLens === "radial" ? <RadialMap /> : <TopologyMap />}
        </div>
        <NodeInspector />
      </div>

      {/* 3. Homepage Rewind Timeline Card (#tl) directly from AFWE Codebase Atlas */}
      <div style={{ padding: "10px 24px 20px 24px" }}>
        <div
          className="card-soft"
          style={{
            position: "relative",
            padding: "10px 14px",
            background: "var(--panel)",
            borderRadius: "16px",
            border: "1px solid var(--line)",
          }}
        >
          {timelineT < 0.98 && (
            <button
              onClick={() => {
                setTimelineT(1);
                scrubToTurn(null);
              }}
              style={{
                position: "absolute",
                right: "16px",
                top: "10px",
                fontSize: "11px",
                padding: "2px 10px",
                background: "var(--accent)",
                color: "var(--accent-ink)",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontWeight: 600,
                zIndex: 10,
              }}
            >
              Jump to now
            </button>
          )}

          <svg
            ref={tlSvgRef}
            viewBox="0 0 1096 76"
            style={{ width: "100%", height: "auto", display: "block", touchAction: "none", userSelect: "none", cursor: "ew-resize" }}
            onPointerDown={(e) => {
              setIsDraggingTl(true);
              e.currentTarget.setPointerCapture(e.pointerId);
              handleTimelineMove(e.clientX);
            }}
            onPointerMove={(e) => {
              if (isDraggingTl) handleTimelineMove(e.clientX);
            }}
            onPointerUp={() => setIsDraggingTl(false)}
          >
            {/* Activity Bars */}
            {bars.map((b, i) => {
              const headX = 24 + timelineT * 1044;
              const isFuture = b.x > headX;
              return (
                <rect
                  key={i}
                  x={b.x}
                  y={40 - b.h}
                  width={9}
                  height={b.h}
                  rx={2}
                  className={`bar-t${isFuture ? " fut" : ""}`}
                />
              );
            })}

            {/* Base timeline dashed guide line */}
            <line
              x1={24}
              y1={50}
              x2={1072}
              y2={50}
              strokeWidth={4}
              strokeLinecap="round"
              strokeDasharray="0 14"
              style={{ stroke: "var(--mute)" }}
            />

            {/* Markers: Pin added (amber) and violation (red) */}
            <circle cx={300} cy={50} r={5} fill="var(--amber)" />
            <circle cx={820} cy={50} r={5} fill="var(--amber)" />
            {violationsCount > 0 && <circle cx={594} cy={50} r={6} fill="var(--red)" />}

            {/* Date month ticks */}
            <text x={24} y={70} fontSize={11} fill="var(--mute)">Jul</text>
            <text x={301} y={70} fontSize={11} fill="var(--mute)">Aug</text>
            <text x={578} y={70} fontSize={11} fill="var(--mute)">Sep</text>
            <text x={846} y={70} fontSize={11} fill="var(--mute)">Oct</text>

            <text x={24} y={12} fontSize={11} fill="var(--mute)">
              Drag to rewind the whole map
            </text>

            {/* Playhead text label */}
            <text
              x={24 + timelineT * 1044 > 980 ? 24 + timelineT * 1044 - 30 : 1046}
              y={70}
              fontSize={12}
              fontWeight={600}
              textAnchor={24 + timelineT * 1044 > 980 ? "end" : "end"}
              fill="var(--ink)"
            >
              {timelineT >= 0.98
                ? "Now · Present"
                : currentScrubbedTurn
                ? `Turn #${currentScrubbedTurn.id} · ${currentScrubbedTurn.prompt?.slice(0, 24)}…`
                : `Turn ${Math.round(timelineT * 214)}`}
            </text>

            {/* Playhead Scrubber Disc */}
            <circle
              cx={24 + timelineT * 1044}
              cy={50}
              r={9}
              fill="var(--ink)"
              stroke="var(--panel)"
              strokeWidth={3}
              style={{ cursor: "grab" }}
            />
          </svg>
        </div>

        {/* 4. Recent Turn Cards directly below timeline */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "12px",
            marginTop: "12px",
          }}
        >
          {(turns.length > 0 ? turns.slice(0, 3) : [
            { id: "t0027", status: "committed", prompt: "Checkout flow improvement", ts: "Today · 3 files" },
            { id: "t0026", status: "ready", prompt: "Add analytics events", ts: "Yesterday · 2 files" },
            { id: "t0025", status: "failed", prompt: "Fix mobile layout", ts: "2 days ago · 5 files" },
          ]).map((t: any) => {
            const isCommitted = t.status === "committed";
            const isStage = t.status === "ready" || t.status === "staged";
            const isRedo = t.status === "failed";
            const tagClass = isCommitted ? "" : isStage ? "s" : "r";

            return (
              <div
                key={t.id}
                onClick={() => scrubToTurn(t.id)}
                className="turn card-soft"
                style={{
                  padding: "11px 14px",
                  fontSize: "13px",
                  cursor: "pointer",
                  border: activeTurn === t.id ? "1.5px solid var(--accent)" : "1px solid var(--line)",
                  background: activeTurn === t.id ? "var(--side)" : "var(--panel)",
                }}
              >
                <span className={`tag ${tagClass}`}>
                  {isCommitted ? "COMMIT" : isStage ? "STAGE" : "REDO"}
                </span>
                <small style={{ color: "var(--mute)" }}>#{t.id}</small>
                <br />
                <b style={{ color: "var(--ink)", display: "inline-block", marginTop: "3px" }}>
                  {t.summary || t.prompt?.slice(0, 38) || "Turn update"}
                </b>
                <br />
                <small style={{ color: "var(--mute)" }}>
                  {t.ts || "Recent update"}
                </small>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
