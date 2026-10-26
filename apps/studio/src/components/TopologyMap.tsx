// apps/studio/src/components/TopologyMap.tsx
import React, { useMemo, useState } from "react";
import { useStore } from "../store";
import {
  buildHierarchyTree,
  findNodeById,
  generateOrganicClusterHull,
  HierarchyNode,
  SelectedEntity,
} from "../lib/hierarchy";
import { getTopologyTerritoryStyle } from "../lib/palettes";

interface TopologyMapProps {
  onSelectEntity?: (entity: SelectedEntity) => void;
  onDrillDown?: (nodeId: string) => void;
}

export const TopologyMap: React.FC<TopologyMapProps> = ({ onSelectEntity, onDrillDown }) => {
  const {
    graph,
    currentScopeId,
    currentDepth,
    drillDown,
    drillUp,
    selectEntity,
    jumpToTurn,
  } = useStore();

  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [activeAttentionTab, setActiveAttentionTab] = useState<"attention" | "turns" | "proposals" | "pins">("attention");

  const rootHierarchy = useMemo(() => buildHierarchyTree(graph), [graph]);

  const focusNode: HierarchyNode = useMemo(() => {
    if (!currentScopeId) return rootHierarchy;
    return findNodeById(rootHierarchy, currentScopeId) || rootHierarchy;
  }, [rootHierarchy, currentScopeId]);

  const children = focusNode.children || [];
  const totalFiles = focusNode.fileCount || (graph?.files?.length || 1);
  const violationsCount = (graph?.code_edges || []).filter((e: any) => e.violation).length;
  const pinsCount = (graph?.pins || []).filter((p: any) => p.status === "active").length;
  const questionsCount = (graph?.calibration?.questions || []).filter((q: any) => q.status === "open").length;

  const isDrilledIn = currentDepth > 0;

  // ── Layout Calculations ──
  // If at Root: asymmetric organic constellation
  // If Drilled-in: central sweeping envelope with external satellite pills
  const { territories, satellites, outerEnvelopeD } = useMemo(() => {
    const list: any[] = [];
    const satList: any[] = [];

    if (!isDrilledIn) {
      // Root Constellation layout (Screenshot 3)
      // Asymmetric placement: 3 columns with varied heights and L-shapes
      const colDefs = [
        { startX: 40, y: 30, width: 280 },
        { startX: 350, y: 30, width: 300 },
        { startX: 680, y: 30, width: 270 },
      ];

      const colHeights = [30, 30, 30];

      children.forEach((child, index) => {
        // Pick column with smallest height
        let targetCol = 0;
        if (colHeights[1] < colHeights[targetCol]) targetCol = 1;
        if (colHeights[2] < colHeights[targetCol]) targetCol = 2;

        const subItems = child.children || [];
        const cardCount = Math.max(1, subItems.length);
        const isLshape = cardCount >= 5;
        const w = colDefs[targetCol].width;
        const h = isLshape ? 210 : cardCount <= 2 ? 110 : 165;
        const x = colDefs[targetCol].startX;
        const y = colHeights[targetCol];
        colHeights[targetCol] += h + 24;

        const cards: any[] = [];
        const cardW = 118;
        const cardH = 46;

        subItems.slice(0, 6).forEach((sub, subIdx) => {
          const colIdx = subIdx % 2;
          const rowIdx = Math.floor(subIdx / 2);
          const cx = x + 16 + colIdx * (cardW + 12);
          const cy = y + 42 + rowIdx * (cardH + 10);
          cards.push({
            id: sub.id,
            label: sub.label,
            path: sub.path,
            subPath: sub.path.split("/").pop() || sub.label,
            isCharted: sub.isCharted,
            fileCount: sub.fileCount,
            hasViolation: sub.hasViolation,
            hasPin: sub.hasPin,
            x: cx,
            y: cy,
            width: cardW,
            height: cardH,
            node: sub,
          });
        });

        const style = getTopologyTerritoryStyle(child.label, child.hasViolation);

        list.push({
          id: child.id,
          label: child.label,
          path: child.path,
          isCharted: child.isCharted,
          fileCount: child.fileCount,
          hasViolation: child.hasViolation,
          hasPin: child.hasPin,
          x,
          y,
          width: w,
          height: h,
          style,
          hullD: generateOrganicClusterHull(x, y, w, h, cardCount, index, isLshape ? "l-shape" : cardCount <= 2 ? "capsule" : "box"),
          cards,
          node: child,
        });
      });

      return { territories: list, satellites: [], outerEnvelopeD: "" };
    } else {
      // Drilled-In Domain View (Screenshot 2)
      // Main central domain surrounded by external satellite nodes
      const centerX = 160;
      const centerY = 40;
      const centerW = 660;
      const centerH = 400;

      // Sweeping amoeba boundary for the focused domain
      const envelope = generateOrganicClusterHull(centerX, centerY, centerW, centerH, 8, 3, "amoeba");

      // Place children inside the sweeping boundary
      const innerCols = 3;
      children.forEach((child, index) => {
        const col = index % innerCols;
        const row = Math.floor(index / innerCols);
        const ix = centerX + 40 + col * 195;
        const iy = centerY + 50 + row * 160;
        const iw = 180;
        const ih = 140;

        const subItems = child.children || [];
        const cards: any[] = [];
        subItems.slice(0, 4).forEach((sub, sIdx) => {
          const scx = ix + 12 + (sIdx % 2) * 78;
          const scy = iy + 38 + Math.floor(sIdx / 2) * 44;
          cards.push({
            id: sub.id,
            label: sub.label,
            path: sub.path,
            subPath: sub.path.split("/").pop() || sub.label,
            isCharted: sub.isCharted,
            fileCount: sub.fileCount,
            hasViolation: sub.hasViolation,
            hasPin: sub.hasPin,
            x: scx,
            y: scy,
            width: 72,
            height: 38,
            node: sub,
          });
        });

        const style = getTopologyTerritoryStyle(child.label, child.hasViolation);

        list.push({
          id: child.id,
          label: child.label,
          path: child.path,
          isCharted: child.isCharted,
          fileCount: child.fileCount,
          hasViolation: child.hasViolation,
          hasPin: child.hasPin,
          x: ix,
          y: iy,
          width: iw,
          height: ih,
          style,
          hullD: generateOrganicClusterHull(ix, iy, iw, ih, subItems.length, index, "box"),
          cards,
          node: child,
        });
      });

      // External satellite domains placed around the outer envelope
      satList.push(
        { id: "sat:web", label: "Web / Frontend", x: 20, y: 70, width: 110, height: 42, relation: "API requests", direction: "in" },
        { id: "sat:infra", label: "Infrastructure", x: 20, y: 260, width: 110, height: 42, relation: "Webhooks (in)", direction: "in" },
        { id: "sat:data", label: "Data / Storage", x: 840, y: 120, width: 110, height: 42, relation: "Reads / Writes", direction: "out" },
        { id: "sat:shared", label: "Shared / Core", x: 840, y: 280, width: 110, height: 42, relation: "Types & Utils", direction: "out" },
      );

      return { territories: list, satellites: satList, outerEnvelopeD: envelope };
    }
  }, [children, isDrilledIn]);

  // Inter-territory dependency ribbons
  const edges = useMemo(() => {
    const codeEdges = graph?.code_edges || [];
    const list: any[] = [];
    const territoryMap = new Map<string, any>();
    territories.forEach((t) => {
      territoryMap.set(t.id, t);
      t.cards.forEach((c: any) => territoryMap.set(c.id, t));
    });

    let count = 0;
    for (const ce of codeEdges) {
      if (count >= 12) break;
      const fromT = territoryMap.get(ce.from);
      const toT = territoryMap.get(ce.to);

      if (fromT && toT && fromT.id !== toT.id) {
        const x1 = fromT.x + fromT.width / 2;
        const y1 = fromT.y + fromT.height / 2;
        const x2 = toT.x + toT.width / 2;
        const y2 = toT.y + toT.height / 2;

        const dx = x2 - x1;
        const dy = y2 - y1;
        const cx1 = x1 + dx * 0.25 - dy * 0.15;
        const cy1 = y1 + dy * 0.25 + dx * 0.15;
        const cx2 = x1 + dx * 0.75 - dy * 0.15;
        const cy2 = y1 + dy * 0.75 + dx * 0.15;

        const pathD = `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;

        list.push({
          id: `edge:${ce.from}->${ce.to}`,
          fromId: ce.from,
          toId: ce.to,
          fromName: fromT.label,
          toName: toT.label,
          verb: ce.violation ? "Rule violation" : ce.count > 5 ? "API requests" : "Uses",
          count: ce.count,
          isViolation: !!ce.violation,
          pathD,
          midX,
          midY,
          raw: ce,
        });
        count++;
      }
    }
    return list;
  }, [territories, graph]);

  const handleSelectNode = (node: HierarchyNode) => {
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

  const handleDoubleClickNode = (nodeId: string) => {
    drillDown(nodeId);
    if (onDrillDown) onDrillDown(nodeId);
  };

  const canvasWidth = 980;
  const canvasHeight = Math.max(540, isDrilledIn ? 500 : Math.max(...territories.map((t) => t.y + t.height + 40), 520));

  return (
    <div
      className="topology-map-container"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#FAF8F4",
        color: "#1D1C1A",
        fontFamily: "'IBM Plex Sans', sans-serif",
      }}
    >
      {/* 1. Top KPI Summary Strip (Screenshot 3) */}
      <div style={{ padding: "14px 24px 8px 24px", borderBottom: "1px solid #ECE7D9", background: "#FAF8F4" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
            <h2 style={{ fontFamily: "Newsreader, serif", fontSize: "24px", fontWeight: 600, color: "#1D1C1A", margin: 0 }}>
              {focusNode.label} {isDrilledIn ? "Domain Topology" : "Topology"}
            </h2>
            <span style={{ fontSize: "12px", background: "#E8F3ED", color: "#2E7A57", padding: "2px 8px", borderRadius: "12px", fontWeight: 600 }}>
              ● {focusNode.mappedCount > 0 ? "Charted Architecture" : "Uncharted"}
            </span>
          </div>

          {isDrilledIn && (
            <button
              onClick={() => drillUp()}
              style={{
                background: "#FFFFFF",
                border: "1px solid #DCD9D0",
                padding: "6px 14px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: 600,
                color: "#1D1C1A",
                cursor: "pointer",
                boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              }}
            >
              ↑ Step out to Root
            </button>
          )}
        </div>

        {/* 6-KPI Metric Pill Strip */}
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          {[
            { label: "Total files", value: totalFiles.toLocaleString() },
            { label: "Features", value: children.length },
            { label: "Modules", value: Math.max(1, Math.round(totalFiles / 32)) },
            { label: "Pinned items", value: pinsCount, isPin: true },
            { label: "Open proposals", value: questionsCount },
            { label: "Rule violation", value: violationsCount, isViolation: violationsCount > 0 },
          ].map((kpi, idx) => (
            <div
              key={idx}
              style={{
                background: kpi.isViolation ? "#FDECE9" : "#FFFFFF",
                border: `1px solid ${kpi.isViolation ? "#FCD8D2" : "#ECE7D9"}`,
                borderRadius: "6px",
                padding: "4px 10px",
                fontSize: "11px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span style={{ color: "#8E8878" }}>{kpi.label}</span>
              <span style={{ fontWeight: 700, color: kpi.isViolation ? "#C94A38" : kpi.isPin ? "#87661A" : "#1D1C1A" }}>
                {kpi.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 2. Main SVG Topology Canvas */}
      <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
        <svg width={canvasWidth} height={canvasHeight} style={{ overflow: "visible", padding: "10px" }}>
          <defs>
            <filter id="topo-card-shadow" x="-8%" y="-8%" width="116%" height="120%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#42361E" floodOpacity="0.06" />
            </filter>

            <marker id="arrow-slate" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
              <path d="M 0 1 L 6 4 L 0 7 Z" fill="#6E685F" />
            </marker>

            <marker id="arrow-green" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
              <path d="M 0 1 L 6 4 L 0 7 Z" fill="#2E7A57" />
            </marker>

            <marker id="arrow-red" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
              <path d="M 0 1 L 6 4 L 0 7 Z" fill="#C94A38" />
            </marker>
          </defs>

          {/* Drilled-In: Sweeping Outer Amoeba Boundary Envelope (Screenshot 2) */}
          {isDrilledIn && outerEnvelopeD && (
            <g className="outer-domain-envelope">
              <path
                d={outerEnvelopeD}
                fill="#EBF3EE"
                fillOpacity={0.65}
                stroke="#6A987E"
                strokeWidth="1.5"
                strokeDasharray="6 4"
              />
              <text x="180" y="70" fontSize="13" fontWeight="700" fill="#256345" style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}>
                {focusNode.label} Domain Boundary
              </text>
            </g>
          )}

          {/* External Satellite Nodes (When Drilled In) */}
          {isDrilledIn &&
            satellites.map((sat) => (
              <g key={sat.id} transform={`translate(${sat.x}, ${sat.y})`} style={{ cursor: "pointer" }}>
                <rect width={sat.width} height={sat.height} rx="8" fill="#FFFFFF" stroke="#DCD9D0" filter="url(#topo-card-shadow)" />
                <text x="10" y="24" fontSize="11" fontWeight="600" fill="#1D1C1A">
                  {sat.label}
                </text>

                {/* Arrow connecting satellite to main envelope */}
                {sat.direction === "in" && (
                  <path
                    d={`M ${sat.width} ${sat.height / 2} C ${sat.width + 25} ${sat.height / 2}, 150 ${sat.y + 10}, 180 ${sat.y + 10}`}
                    fill="none"
                    stroke="#6E685F"
                    strokeWidth="1.2"
                    markerEnd="url(#arrow-slate)"
                  />
                )}
                {sat.direction === "out" && (
                  <path
                    d={`M 810 ${sat.y + 20} C 825 ${sat.y + 20}, ${sat.x - 20} ${sat.height / 2}, 0 ${sat.height / 2}`}
                    fill="none"
                    stroke="#6E685F"
                    strokeWidth="1.2"
                    markerEnd="url(#arrow-slate)"
                  />
                )}
              </g>
            ))}

          {/* Dependency Ribbons */}
          <g className="topology-edges">
            {edges.map((edge) => {
              const isSelected = selectedEdgeId === edge.id;
              return (
                <g key={edge.id} onClick={() => setSelectedEdgeId(edge.id)} style={{ cursor: "pointer" }}>
                  <path
                    d={edge.pathD}
                    fill="none"
                    stroke={edge.isViolation ? "#C94A38" : isSelected ? "#1D1C1A" : "#8A8475"}
                    strokeWidth={edge.isViolation ? 2 : isSelected ? 2 : 1.2}
                    strokeDasharray={edge.isViolation ? "4 3" : "none"}
                    markerEnd={edge.isViolation ? "url(#arrow-red)" : "url(#arrow-slate)"}
                  />
                  {/* Verb Pill */}
                  <g transform={`translate(${edge.midX}, ${edge.midY})`}>
                    <rect
                      x="-32"
                      y="-10"
                      width="64"
                      height="20"
                      rx="10"
                      fill={edge.isViolation ? "#FDECE9" : "#FFFFFF"}
                      stroke={edge.isViolation ? "#C94A38" : "#DCD9D0"}
                      strokeWidth="1"
                    />
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill={edge.isViolation ? "#C94A38" : "#4A463E"}
                      style={{ fontSize: "9px", fontWeight: 600 }}
                    >
                      {edge.verb}
                    </text>
                  </g>
                </g>
              );
            })}
          </g>

          {/* Territories & Nested Feature Cards */}
          {territories.map((territory) => {
            return (
              <g key={territory.id} className="territory-group">
                {/* Organic Wonky Spline Hull */}
                <path
                  d={territory.hullD}
                  fill={territory.style.fill}
                  fillOpacity={0.7}
                  stroke={territory.hasViolation ? "#C94A38" : territory.style.stroke}
                  strokeWidth={territory.hasViolation ? 1.8 : 1.2}
                  strokeDasharray="5 4"
                  onClick={() => handleSelectNode(territory.node)}
                  onDoubleClick={() => handleDoubleClickNode(territory.id)}
                  style={{ cursor: "pointer", transition: "all 0.15s ease" }}
                />

                {/* Territory Domain Header */}
                <text
                  x={territory.x + 16}
                  y={territory.y + 24}
                  fill="#1D1C1A"
                  style={{ fontFamily: "Newsreader, serif", fontSize: "15px", fontWeight: 600, cursor: "pointer" }}
                  onClick={() => handleSelectNode(territory.node)}
                  onDoubleClick={() => handleDoubleClickNode(territory.id)}
                >
                  {territory.label}
                </text>
                <text
                  x={territory.x + territory.width - 16}
                  y={territory.y + 24}
                  textAnchor="end"
                  fill="#8E8878"
                  style={{ fontSize: "10.5px" }}
                >
                  {territory.fileCount} files
                </text>

                {/* Feature Cards Inside Territory */}
                {territory.cards.map((card: any) => {
                  const isHovered = hoveredNodeId === card.id;
                  return (
                    <g
                      key={card.id}
                      transform={`translate(${card.x}, ${card.y})`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectNode(card.node);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        handleDoubleClickNode(card.id);
                      }}
                      onMouseEnter={() => setHoveredNodeId(card.id)}
                      onMouseLeave={() => setHoveredNodeId(null)}
                      style={{ cursor: "pointer" }}
                    >
                      <rect
                        width={card.width}
                        height={card.height}
                        rx="6"
                        fill={isHovered ? "#FBF9F4" : "#FFFFFF"}
                        stroke={card.hasViolation ? "#C94A38" : "#E2DCce"}
                        strokeWidth={card.hasViolation ? 1.5 : 1}
                        filter="url(#topo-card-shadow)"
                      />
                      <text x="8" y="16" fill="#1D1C1A" style={{ fontSize: "11px", fontWeight: 600 }}>
                        {card.label.length > 12 ? `${card.label.slice(0, 11)}…` : card.label}
                      </text>
                      <text x="8" y="30" fill="#8E8878" style={{ fontSize: "9.5px", fontFamily: "'IBM Plex Mono', monospace" }}>
                        {card.subPath}
                      </text>
                      {card.hasViolation && <circle cx={card.width - 10} cy="12" r="4.5" fill="#C94A38" />}
                      {card.hasPin && !card.hasViolation && (
                        <text x={card.width - 14} y="15" fill="#C89D54" fontSize="10">
                          ✦
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>

      {/* 3. Bottom Attention Strip & Legend (Screenshot 2 & 3) */}
      <div style={{ background: "#FFFFFF", borderTop: "1px solid #ECE7D9" }}>
        {/* Bottom Legend */}
        <div style={{ padding: "6px 24px", borderBottom: "1px solid #ECE7D9", display: "flex", alignItems: "center", gap: "16px", fontSize: "11px", color: "#6E685F" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#2E7A57", display: "inline-block" }} />
            <span>Mapped</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#C94A38", display: "inline-block" }} />
            <span>Violation</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <span style={{ color: "#C89D54", fontWeight: "bold" }}>✦</span>
            <span>Pinned</span>
          </div>
          <span style={{ color: "#DCD9D0" }}>|</span>
          <span>──→ Uses</span>
          <span style={{ color: "#C94A38" }}>- - → Forbidden Dep</span>
        </div>

        {/* 4-Column Interactive Attention Tray */}
        <div style={{ display: "flex", padding: "10px 24px", gap: "14px", background: "#FAF8F4" }}>
          {/* Needs Attention Tab */}
          <div
            onClick={() => setActiveAttentionTab("attention")}
            style={{
              flex: 1,
              background: activeAttentionTab === "attention" ? "#FFFFFF" : "transparent",
              border: `1px solid ${activeAttentionTab === "attention" ? "#DCD9D0" : "transparent"}`,
              borderRadius: "6px",
              padding: "8px 12px",
              cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#C94A38" }}>● Needs attention (3)</span>
            </div>
            <div style={{ fontSize: "11px", color: "#6E685F", marginTop: "2px" }}>
              1 rule violation · 2 calibration questions
            </div>
          </div>

          {/* Recent Turns Tab */}
          <div
            onClick={() => {
              setActiveAttentionTab("turns");
              jumpToTurn("t0004");
            }}
            style={{
              flex: 1,
              background: activeAttentionTab === "turns" ? "#FFFFFF" : "transparent",
              border: `1px solid ${activeAttentionTab === "turns" ? "#DCD9D0" : "transparent"}`,
              borderRadius: "6px",
              padding: "8px 12px",
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#1D1C1A" }}>Recent turns</div>
            <div style={{ fontSize: "11px", color: "#6E685F", marginTop: "2px" }}>
              #t0004 Checkout flow improvement (committed)
            </div>
          </div>

          {/* Proposals Tab */}
          <div
            onClick={() => setActiveAttentionTab("proposals")}
            style={{
              flex: 1,
              background: activeAttentionTab === "proposals" ? "#FFFFFF" : "transparent",
              border: `1px solid ${activeAttentionTab === "proposals" ? "#DCD9D0" : "transparent"}`,
              borderRadius: "6px",
              padding: "8px 12px",
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#1D1C1A" }}>Proposals (1)</div>
            <div style={{ fontSize: "11px", color: "#6E685F", marginTop: "2px" }}>
              Decouple payments from web/components
            </div>
          </div>

          {/* Pinned Items Tab */}
          <div
            onClick={() => setActiveAttentionTab("pins")}
            style={{
              flex: 1,
              background: activeAttentionTab === "pins" ? "#FFFFFF" : "transparent",
              border: `1px solid ${activeAttentionTab === "pins" ? "#DCD9D0" : "transparent"}`,
              borderRadius: "6px",
              padding: "8px 12px",
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#C89D54" }}>✦ Pinned items (7)</div>
            <div style={{ fontSize: "11px", color: "#6E685F", marginTop: "2px" }}>
              Payment signature & stripe webhook invariants locked
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
