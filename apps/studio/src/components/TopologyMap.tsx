// apps/studio/src/components/TopologyMap.tsx
import React, { useMemo, useState } from "react";
import { useStore } from "../store";
import {
  buildHierarchyTree,
  findNodeById,
  generateOrganicHull,
  HierarchyNode,
  SelectedEntity,
} from "../lib/hierarchy";

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
  } = useStore();

  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const rootHierarchy = useMemo(() => buildHierarchyTree(graph), [graph]);

  const focusNode: HierarchyNode = useMemo(() => {
    if (!currentScopeId) return rootHierarchy;
    return findNodeById(rootHierarchy, currentScopeId) || rootHierarchy;
  }, [rootHierarchy, currentScopeId]);

  const children = focusNode.children || [];
  const totalFiles = focusNode.fileCount || 1;
  const isOverallCharted = focusNode.mappedCount / totalFiles > 0.35;

  // Layout geometry calculations: arranged in a clean organic 2-column or 3-column cluster
  const territories = useMemo(() => {
    const list: any[] = [];
    const cols = children.length <= 4 ? 2 : 3;
    const colWidth = 240;
    const rowHeight = 170;
    const startX = 40;
    const startY = 40;

    children.forEach((child, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = startX + col * (colWidth + 40);
      const y = startY + row * (rowHeight + 35);
      const w = colWidth;
      const h = rowHeight;

      // Children inside this territory (either features or subfolder parcels)
      const subItems = child.children || [];
      const cards: any[] = [];
      const parcels: any[] = [];

      if (child.isCharted || isOverallCharted) {
        // Layout 2x2 or 2x3 cards inside territory
        const cardW = 95;
        const cardH = 46;
        subItems.slice(0, 4).forEach((sub, subIdx) => {
          const cx = x + 16 + (subIdx % 2) * (cardW + 12);
          const cy = y + 42 + Math.floor(subIdx / 2) * (cardH + 10);
          cards.push({
            id: sub.id,
            label: sub.label,
            path: sub.path,
            subPath: sub.path.split("/").pop() || sub.label,
            isCharted: sub.isCharted,
            fileCount: sub.fileCount,
            hasViolation: sub.hasViolation,
            hasPin: sub.hasPin,
            hasQuestion: sub.hasQuestion,
            x: cx,
            y: cy,
            width: cardW,
            height: cardH,
            node: sub,
          });
        });
      } else {
        // Uncharted territory: render proportional hatched treemap parcels
        const parcelW = (w - 32) / 3;
        const parcelH = (h - 56) / 2;
        subItems.slice(0, 6).forEach((sub, subIdx) => {
          const px = x + 16 + (subIdx % 3) * (parcelW + 4);
          const py = y + 46 + Math.floor(subIdx / 3) * (parcelH + 4);
          parcels.push({
            id: sub.id,
            label: sub.label,
            path: sub.path,
            isCharted: sub.isCharted,
            fileCount: sub.fileCount,
            x: px,
            y: py,
            width: parcelW,
            height: parcelH,
            node: sub,
          });
        });
      }

      list.push({
        id: child.id,
        label: child.label,
        path: child.path,
        isCharted: child.isCharted,
        fileCount: child.fileCount,
        mappedCount: child.mappedCount,
        hasViolation: child.hasViolation,
        hasPin: child.hasPin,
        x,
        y,
        width: w,
        height: h,
        hullPath: generateOrganicHull(x, y, w, h, index),
        cards,
        parcels,
        node: child,
      });
    });

    return list;
  }, [children, isOverallCharted]);

  // Compute inter-territory dependency curves
  const edges = useMemo(() => {
    const codeEdges = graph?.code_edges || [];
    const list: any[] = [];
    const territoryMap = new Map<string, any>();
    territories.forEach((t) => {
      territoryMap.set(t.id, t);
      t.cards.forEach((c: any) => territoryMap.set(c.id, t));
    });

    let edgeCount = 0;
    for (const ce of codeEdges) {
      if (edgeCount >= 10) break; // Keep visual clutter low
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
          verb: ce.violation ? "Forbidden Dep" : ce.count > 5 ? "HTTP API" : "Uses",
          count: ce.count,
          isViolation: !!ce.violation,
          pathD,
          midX,
          midY,
          raw: ce,
        });
        edgeCount++;
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
      status: node.hasViolation
        ? "violation"
        : node.hasPin
        ? "pinned"
        : node.isCharted
        ? "mapped"
        : "uncharted",
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

  const handleSelectEdge = (edge: any) => {
    setSelectedEdgeId(edge.id);
    const entity: SelectedEntity = {
      id: edge.id,
      kind: "edge",
      label: `${edge.fromName} → ${edge.toName}`,
      path: `${edge.fromId} -> ${edge.toId}`,
      status: edge.isViolation ? "violation" : "mapped",
      fileCount: edge.count,
      description: edge.isViolation
        ? `Forbidden dependency detected: ${edge.fromName} imports ${edge.toName}.`
        : `Static analysis observed ${edge.count} file imports between ${edge.fromName} and ${edge.toName}.`,
      raw: edge.raw,
    };
    selectEntity(entity);
    if (onSelectEntity) onSelectEntity(entity);
  };

  const canvasWidth = 860;
  const canvasHeight = Math.max(580, Math.ceil(children.length / 3) * 220 + 80);

  return (
    <div className="topology-map-container" style={{ position: "relative", width: "100%", height: "100%", overflow: "auto", background: "#FAF8F3" }}>
      {/* Top Header */}
      <div style={{ padding: "16px 24px 8px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ fontFamily: "Newsreader, serif", fontSize: "24px", fontWeight: 600, color: "#1D1C1A", margin: 0 }}>
              {focusNode.label} Topology{" "}
              <span
                style={{
                  fontSize: "12px",
                  background: isOverallCharted ? "#E8F3ED" : "#ECE7D9",
                  color: isOverallCharted ? "#2E7A57" : "#6B675D",
                  padding: "2px 8px",
                  borderRadius: "12px",
                  marginLeft: "10px",
                  fontWeight: 600,
                  fontFamily: "'IBM Plex Sans', sans-serif",
                }}
              >
                ● {isOverallCharted ? "Charted" : "Uncharted"}
              </span>
            </h2>
            <div style={{ fontSize: "13px", color: "#6B675D", marginTop: "3px", fontFamily: "'IBM Plex Sans', sans-serif" }}>
              Architectural structure, organic boundaries and intent. Select any node or relationship.
            </div>
          </div>
          {currentDepth > 0 && (
            <button
              onClick={() => drillUp()}
              style={{
                background: "#FFFFFF",
                border: "1px solid #DCD9D0",
                padding: "6px 12px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: 600,
                color: "#1D1C1A",
                cursor: "pointer",
              }}
            >
              ↑ Step out
            </button>
          )}
        </div>
      </div>

      <svg width={canvasWidth} height={canvasHeight} style={{ overflow: "visible" }}>
        <defs>
          <filter id="card-shadow" x="-8%" y="-8%" width="116%" height="120%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#5A4A2A" floodOpacity="0.08" />
          </filter>

          <pattern id="topo-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="#D3CABE" strokeWidth="1.2" />
          </pattern>

          <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M 0 1 L 6 4 L 0 7 Z" fill="#6B675D" />
          </marker>

          <marker id="arrowhead-violation" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M 0 1 L 6 4 L 0 7 Z" fill="#B23A2B" />
          </marker>
        </defs>

        {/* 1. Curved Dependency Edges */}
        <g className="topology-edges">
          {edges.map((edge) => {
            const isSelected = selectedEdgeId === edge.id;
            return (
              <g
                key={edge.id}
                onClick={() => handleSelectEdge(edge)}
                style={{ cursor: "pointer" }}
              >
                <path
                  d={edge.pathD}
                  fill="none"
                  stroke={edge.isViolation ? "#B23A2B" : isSelected ? "#1D1C1A" : "#8A8475"}
                  strokeWidth={edge.isViolation ? 2 : isSelected ? 2 : 1.2}
                  strokeDasharray={edge.isViolation ? "4 3" : "none"}
                  markerEnd={edge.isViolation ? "url(#arrowhead-violation)" : "url(#arrowhead)"}
                />
                {/* Midpoint Verb Pill */}
                <g transform={`translate(${edge.midX}, ${edge.midY})`}>
                  <rect
                    x="-28"
                    y="-9"
                    width="56"
                    height="18"
                    rx="9"
                    fill={edge.isViolation ? "#FDECE9" : "#FFFFFF"}
                    stroke={edge.isViolation ? "#B23A2B" : "#DCD9D0"}
                    strokeWidth="1"
                  />
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={edge.isViolation ? "#B23A2B" : "#4A463E"}
                    style={{ fontSize: "9.5px", fontWeight: 600, fontFamily: "'IBM Plex Sans', sans-serif" }}
                  >
                    {edge.verb}
                  </text>
                </g>
              </g>
            );
          })}
        </g>

        {/* 2. Territory Hulls & Cards */}
        {territories.map((territory) => {
          return (
            <g key={territory.id} className="territory-hull-group">
              {/* Organic Concave Hull Stroke */}
              <path
                d={territory.hullPath}
                fill={territory.isCharted ? "#F4EFE6" : "#FAF8F3"}
                fillOpacity={0.65}
                stroke={territory.hasViolation ? "#B23A2B" : "#8E8878"}
                strokeWidth={territory.hasViolation ? 2 : 1.2}
                strokeDasharray="5 4"
                onClick={() => handleSelectNode(territory.node)}
                onDoubleClick={() => handleDoubleClickNode(territory.id)}
                style={{ cursor: "pointer" }}
              />

              {/* Territory Domain Label */}
              <text
                x={territory.x + 16}
                y={territory.y + 24}
                fill="#1D1C1A"
                style={{
                  fontFamily: "Newsreader, serif",
                  fontSize: "15px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
                onClick={() => handleSelectNode(territory.node)}
                onDoubleClick={() => handleDoubleClickNode(territory.id)}
              >
                {territory.label}
              </text>
              <text
                x={territory.x + territory.width - 16}
                y={territory.y + 24}
                textAnchor="end"
                fill="#6B675D"
                style={{
                  fontFamily: "'IBM Plex Sans', sans-serif",
                  fontSize: "11px",
                }}
              >
                {territory.fileCount} files
              </text>

              {/* Charted Mode: Feature Node Cards */}
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
                      fill={isHovered ? "#F7F5EE" : "#FFFFFF"}
                      stroke={card.hasViolation ? "#B23A2B" : "#DCD9D0"}
                      strokeWidth={card.hasViolation ? 1.5 : 1}
                      filter="url(#card-shadow)"
                    />
                    <text
                      x="10"
                      y="18"
                      fill="#1D1C1A"
                      style={{
                        fontFamily: "'IBM Plex Sans', sans-serif",
                        fontSize: "11.5px",
                        fontWeight: 600,
                      }}
                    >
                      {card.label.length > 11 ? `${card.label.slice(0, 10)}…` : card.label}
                    </text>
                    <text
                      x="10"
                      y="33"
                      fill="#6B675D"
                      style={{
                        fontFamily: "'IBM Plex Sans', sans-serif",
                        fontSize: "9.5px",
                      }}
                    >
                      {card.subPath}
                    </text>
                    {card.hasViolation && (
                      <circle cx={card.width - 12} cy="14" r="5" fill="#B23A2B" />
                    )}
                    {card.hasPin && !card.hasViolation && (
                      <text x={card.width - 16} y="16" fill="#C89D54" fontSize="10">
                        ✦
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Uncharted Mode: Proportional Hatched Parcels */}
              {territory.parcels.map((parcel: any) => {
                return (
                  <g
                    key={parcel.id}
                    transform={`translate(${parcel.x}, ${parcel.y})`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelectNode(parcel.node);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      handleDoubleClickNode(parcel.id);
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <rect
                      width={parcel.width}
                      height={parcel.height}
                      rx="3"
                      fill="url(#topo-hatch)"
                      stroke="#C4BCAB"
                      strokeWidth="1"
                    />
                    <text
                      x="6"
                      y="15"
                      fill="#4A463E"
                      style={{
                        fontFamily: "'IBM Plex Sans', sans-serif",
                        fontSize: "9px",
                        fontWeight: 500,
                      }}
                    >
                      {parcel.label.length > 8 ? `${parcel.label.slice(0, 7)}…` : parcel.label}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
};
