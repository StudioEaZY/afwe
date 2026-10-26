// apps/studio/src/components/TimelineDualScrubber.tsx
// Interactive dual timeline scrubber with mouse-wheel zoom/pan, draggable handles, and upper wave curve
import React, { useRef, useState, useEffect, useMemo, useCallback } from "react";

export interface TimelineTurnItem {
  id: string;
  number: number;
  label: string;
  date: string;
  status: "committed" | "staged" | "failed" | "ready";
  hasPin?: boolean;
  hasViolation?: boolean;
}

interface TimelineDualScrubberProps {
  turns: TimelineTurnItem[];
  selectedTurnId: string | null;
  onSelectTurn: (turnId: string) => void;
}

export const TimelineDualScrubber: React.FC<TimelineDualScrubberProps> = ({
  turns,
  selectedTurnId,
  onSelectTurn,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const upperSvgRef = useRef<SVGSVGElement>(null);
  const lowerSvgRef = useRef<SVGSVGElement>(null);

  const totalCount = Math.max(1, turns.length);

  // Range window in fractional coordinates [0..1]
  const [range, setRange] = useState<[number, number]>([
    Math.max(0, 1 - 12 / totalCount),
    1,
  ]);

  // Keep range updated if turns count changes drastically
  useEffect(() => {
    if (turns.length > 0) {
      setRange((prev) => {
        const span = Math.max(0.08, Math.min(1, prev[1] - prev[0]));
        return [Math.max(0, 1 - span), 1];
      });
    }
  }, [turns.length]);

  // Dragging interaction state
  type DragTarget = "left-handle" | "right-handle" | "window-body" | null;
  const [draggingTarget, setDraggingTarget] = useState<DragTarget>(null);
  const dragStartRef = useRef<{ startX: number; initialRange: [number, number] }>({
    startX: 0,
    initialRange: [0, 1],
  });

  // Calculate turns visible inside range
  const visibleTurnIndices = useMemo(() => {
    if (turns.length === 0) return [];
    const minIdx = Math.max(0, Math.floor(range[0] * (turns.length - 1)));
    const maxIdx = Math.min(turns.length - 1, Math.ceil(range[1] * (turns.length - 1)));
    const indices: number[] = [];
    for (let i = minIdx; i <= maxIdx; i++) {
      indices.push(i);
    }
    return indices.length > 0 ? indices : [0];
  }, [range, turns.length]);

  // Step backward / forward
  const handleStep = useCallback(
    (direction: -1 | 1) => {
      if (turns.length === 0) return;
      const currentIdx = turns.findIndex((t) => t.id === selectedTurnId);
      const nextIdx = Math.max(0, Math.min(turns.length - 1, (currentIdx >= 0 ? currentIdx : turns.length - 1) + direction));
      const nextTurn = turns[nextIdx];
      onSelectTurn(nextTurn.id);

      // Auto-pan range if next turn steps outside
      const frac = nextIdx / (turns.length - 1 || 1);
      const span = range[1] - range[0];
      if (frac < range[0]) {
        const newStart = Math.max(0, frac - 0.05);
        setRange([newStart, Math.min(1, newStart + span)]);
      } else if (frac > range[1]) {
        const newEnd = Math.min(1, frac + 0.05);
        setRange([Math.max(0, newEnd - span), newEnd]);
      }
    },
    [turns, selectedTurnId, range, onSelectTurn]
  );

  // Wheel zoom / pan handler
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 1.15 : 0.85;
    const currentSpan = range[1] - range[0];
    const newSpan = Math.max(0.05, Math.min(1, currentSpan * zoomFactor));

    // Center zoom around cursor position
    const rect = containerRef.current?.getBoundingClientRect();
    const cursorFrac = rect ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) : 0.5;
    const anchor = range[0] + cursorFrac * currentSpan;

    const newStart = Math.max(0, anchor - cursorFrac * newSpan);
    const newEnd = Math.min(1, newStart + newSpan);
    setRange([newStart, newEnd]);
  };

  // Zoom button controls
  const handleZoomIn = () => {
    const span = range[1] - range[0];
    const newSpan = Math.max(0.05, span * 0.75);
    const mid = (range[0] + range[1]) / 2;
    setRange([Math.max(0, mid - newSpan / 2), Math.min(1, mid + newSpan / 2)]);
  };

  const handleZoomOut = () => {
    const span = range[1] - range[0];
    const newSpan = Math.min(1, span * 1.35);
    const mid = (range[0] + range[1]) / 2;
    setRange([Math.max(0, mid - newSpan / 2), Math.min(1, mid + newSpan / 2)]);
  };

  const handleFit = () => {
    setRange([0, 1]);
  };

  // Lower Heatmap Pointer Events
  const handleLowerPointerDown = (e: React.PointerEvent, target: DragTarget) => {
    e.stopPropagation();
    setDraggingTarget(target);
    dragStartRef.current = {
      startX: e.clientX,
      initialRange: [range[0], range[1]],
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleLowerPointerMove = (e: React.PointerEvent) => {
    if (!draggingTarget || !lowerSvgRef.current) return;
    const rect = lowerSvgRef.current.getBoundingClientRect();
    const deltaFrac = (e.clientX - dragStartRef.current.startX) / rect.width;
    const [initStart, initEnd] = dragStartRef.current.initialRange;

    if (draggingTarget === "window-body") {
      const span = initEnd - initStart;
      let newStart = Math.max(0, Math.min(1 - span, initStart + deltaFrac));
      setRange([newStart, newStart + span]);
    } else if (draggingTarget === "left-handle") {
      const newStart = Math.max(0, Math.min(initEnd - 0.04, initStart + deltaFrac));
      setRange([newStart, initEnd]);
    } else if (draggingTarget === "right-handle") {
      const newEnd = Math.min(1, Math.max(initStart + 0.04, initEnd + deltaFrac));
      setRange([initStart, newEnd]);
    }
  };

  const handleLowerPointerUp = () => {
    setDraggingTarget(null);
  };

  // Geometry for Upper Wave
  const upperWidth = 1000;
  const upperHeight = 120;
  const waveBaseY = 82;

  // Compute smooth curve points for visible turns
  const wavePoints = useMemo(() => {
    if (visibleTurnIndices.length === 0) return [];
    const count = visibleTurnIndices.length;
    const margin = 60;
    const usableW = upperWidth - margin * 2;

    return visibleTurnIndices.map((idx, i) => {
      const turn = turns[idx];
      const x = margin + (count > 1 ? (i / (count - 1)) * usableW : usableW / 2);
      // Elevation wave based on status / violations
      const lift = turn.hasViolation ? 32 : turn.hasPin ? 24 : turn.status === "committed" ? 18 : 12;
      const y = waveBaseY - lift;
      return { x, y, turn, idx };
    });
  }, [visibleTurnIndices, turns, waveBaseY]);

  // Construct smooth cubic spline path
  const wavePathD = useMemo(() => {
    if (wavePoints.length <= 1) return "";
    let d = `M ${wavePoints[0].x} ${wavePoints[0].y}`;
    for (let i = 0; i < wavePoints.length - 1; i++) {
      const p0 = wavePoints[i];
      const p1 = wavePoints[i + 1];
      const cx1 = (p0.x + p1.x) / 2;
      const cy1 = p0.y;
      const cx2 = (p0.x + p1.x) / 2;
      const cy2 = p1.y;
      d += ` C ${cx1} ${cy1}, ${cx2} ${cy2}, ${p1.x} ${p1.y}`;
    }
    return d;
  }, [wavePoints]);

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      style={{
        display: "flex",
        flexDirection: "column",
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: "16px",
        padding: "10px 18px",
        boxShadow: "0 1px 0 var(--glow) inset, 0 14px 30px -20px var(--shadow)",
        userSelect: "none",
        gap: "6px",
      }}
    >
      {/* Top Header Strip: Status, Title, Zoom Controls, Step Buttons */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--mute)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Turns Workstation Timeline
          </span>
          <span style={{ fontSize: "11px", color: "var(--ink)", background: "var(--side)", padding: "2px 8px", borderRadius: "10px", fontWeight: 600 }}>
            {visibleTurnIndices.length} of {turns.length} turns in view
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {/* Step Back / Step Forward Buttons */}
          <button
            onClick={() => handleStep(-1)}
            title="Step to previous turn (<)"
            style={{
              background: "var(--side)",
              border: "1px solid var(--line)",
              color: "var(--ink)",
              borderRadius: "6px",
              padding: "2px 8px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            ‹
          </button>
          <button
            onClick={() => handleStep(1)}
            title="Step to next turn (>)"
            style={{
              background: "var(--side)",
              border: "1px solid var(--line)",
              color: "var(--ink)",
              borderRadius: "6px",
              padding: "2px 8px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            ›
          </button>

          {/* Zoom controls */}
          <button
            onClick={handleZoomIn}
            title="Zoom In (+)"
            style={{
              background: "var(--side)",
              border: "1px solid var(--line)",
              color: "var(--ink)",
              borderRadius: "6px",
              padding: "2px 8px",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            +
          </button>
          <button
            onClick={handleZoomOut}
            title="Zoom Out (−)"
            style={{
              background: "var(--side)",
              border: "1px solid var(--line)",
              color: "var(--ink)",
              borderRadius: "6px",
              padding: "2px 8px",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            −
          </button>
          <button
            onClick={handleFit}
            title="Fit All History"
            style={{
              background: "var(--side)",
              border: "1px solid var(--line)",
              color: "var(--ink)",
              borderRadius: "6px",
              padding: "2px 8px",
              fontSize: "11px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Fit
          </button>
        </div>
      </div>

      {/* 1. Upper Spline Wave Scrubber */}
      <svg
        ref={upperSvgRef}
        viewBox={`0 0 ${upperWidth} ${upperHeight}`}
        style={{ width: "100%", height: "110px", overflow: "visible" }}
      >
        <defs>
          <linearGradient id="waveGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Base guideline and date ticks */}
        <line x1={40} y1={waveBaseY} x2={upperWidth - 40} y2={waveBaseY} stroke="var(--line)" strokeWidth={1.5} />

        {/* Wave Spline */}
        {wavePathD && (
          <path
            d={wavePathD}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2.4}
            strokeLinecap="round"
            style={{ opacity: 0.85 }}
          />
        )}

        {/* Turn points on wave */}
        {wavePoints.map(({ x, y, turn }) => {
          const isSelected = turn.id === selectedTurnId;
          const isCommitted = turn.status === "committed";
          const isFailed = turn.status === "failed";
          const isStage = turn.status === "ready" || turn.status === "staged";

          const dotColor = isFailed ? "var(--red)" : isStage ? "var(--amber)" : isCommitted ? "var(--accent)" : "var(--mute)";

          return (
            <g
              key={turn.id}
              onClick={() => onSelectTurn(turn.id)}
              style={{ cursor: "pointer" }}
            >
              {/* Vertical connector stem to base line */}
              <line
                x1={x}
                y1={y}
                x2={x}
                y2={waveBaseY}
                stroke={isSelected ? "var(--ink)" : "var(--line)"}
                strokeWidth={isSelected ? 1.8 : 1}
                strokeDasharray={isSelected ? "none" : "3 3"}
              />

              {/* Turn status point */}
              <circle
                cx={x}
                cy={y}
                r={isSelected ? 6 : 4}
                fill={dotColor}
                stroke="var(--panel)"
                strokeWidth={2}
              />

              {/* Elevated Badges / Callouts */}
              {isSelected ? (
                <g transform={`translate(${x}, ${y - 28})`}>
                  <rect
                    x={-34}
                    y={-12}
                    width={68}
                    height={22}
                    rx={11}
                    fill="var(--ink)"
                    stroke="var(--panel)"
                    strokeWidth={1.5}
                  />
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="var(--panel)"
                    fontSize={11}
                    fontWeight={700}
                  >
                    ⭐ #{turn.id}
                  </text>
                </g>
              ) : turn.hasViolation ? (
                <g transform={`translate(${x}, ${y - 18})`}>
                  <circle r={7} fill="var(--red)" />
                  <text textAnchor="middle" dominantBaseline="central" fill="#FFFFFF" fontSize={9} fontWeight="bold">
                    !
                  </text>
                </g>
              ) : turn.hasPin ? (
                <g transform={`translate(${x}, ${y - 18})`}>
                  <circle r={6} fill="var(--amber)" />
                  <text textAnchor="middle" dominantBaseline="central" fill="#FFFFFF" fontSize={8}>
                    📌
                  </text>
                </g>
              ) : null}

              {/* Turn ID and Date below baseline */}
              <text
                x={x}
                y={waveBaseY + 14}
                textAnchor="middle"
                fontSize={10}
                fontWeight={isSelected ? 700 : 500}
                fill={isSelected ? "var(--ink)" : "var(--mute)"}
              >
                #{turn.id}
              </text>
              <text
                x={x}
                y={waveBaseY + 26}
                textAnchor="middle"
                fontSize={9}
                fill="var(--mute)"
              >
                {turn.date}
              </text>
            </g>
          );
        })}
      </svg>

      {/* 2. Lower Block Heatmap with Draggable Selection Window */}
      <div style={{ position: "relative", height: "42px", marginTop: "2px" }}>
        <svg
          ref={lowerSvgRef}
          viewBox="0 0 1000 40"
          style={{ width: "100%", height: "100%", display: "block" }}
          onPointerMove={handleLowerPointerMove}
          onPointerUp={handleLowerPointerUp}
        >
          {/* Background Heatmap Blocks */}
          {turns.map((t, idx) => {
            const blockW = Math.max(2, 980 / totalCount - 2);
            const bx = 10 + (idx / totalCount) * 980;
            const isCommitted = t.status === "committed";
            const isFailed = t.status === "failed";
            const isStage = t.status === "ready" || t.status === "staged";
            const color = isFailed ? "var(--red)" : isStage ? "var(--amber)" : isCommitted ? "var(--mapped)" : "var(--unm)";

            return (
              <rect
                key={t.id}
                x={bx}
                y={8}
                width={blockW}
                height={24}
                rx={2}
                fill={color}
                opacity={0.8}
                onClick={() => onSelectTurn(t.id)}
                style={{ cursor: "pointer" }}
              >
                <title>{`Turn #${t.id}: ${t.label} (${t.status})`}</title>
              </rect>
            );
          })}

          {/* Selection Window Overlay */}
          {(() => {
            const leftX = 10 + range[0] * 980;
            const rightX = 10 + range[1] * 980;
            const windowW = Math.max(20, rightX - leftX);

            return (
              <g>
                {/* Window body */}
                <rect
                  x={leftX}
                  y={4}
                  width={windowW}
                  height={32}
                  rx={6}
                  fill="var(--accent)"
                  fillOpacity={0.18}
                  stroke="var(--accent)"
                  strokeWidth={1.5}
                  style={{ cursor: "grab" }}
                  onPointerDown={(e) => handleLowerPointerDown(e, "window-body")}
                />

                {/* Left Grip Handle */}
                <rect
                  x={leftX - 4}
                  y={6}
                  width={8}
                  height={28}
                  rx={4}
                  fill="var(--accent)"
                  stroke="var(--panel)"
                  strokeWidth={1.5}
                  style={{ cursor: "ew-resize" }}
                  onPointerDown={(e) => handleLowerPointerDown(e, "left-handle")}
                />

                {/* Right Grip Handle */}
                <rect
                  x={rightX - 4}
                  y={6}
                  width={8}
                  height={28}
                  rx={4}
                  fill="var(--accent)"
                  stroke="var(--panel)"
                  strokeWidth={1.5}
                  style={{ cursor: "ew-resize" }}
                  onPointerDown={(e) => handleLowerPointerDown(e, "right-handle")}
                />
              </g>
            );
          })()}
        </svg>
      </div>
    </div>
  );
};
