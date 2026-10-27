// apps/studio/src/components/TimelineDualScrubber.tsx
// Interactive dual timeline scrubber with mouse-wheel zoom/pan, draggable handles, and upper wave curve
import React, { useRef, useState, useEffect, useMemo, useCallback } from "react";
import { ChevronLeft, ChevronRight, Plus, Minus, Maximize2, Star } from "lucide-react";
import { SvgMiniLock, SvgMiniAlertTriangle } from "../lib/lucideSvgPaths";

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
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 1.15 : 0.85;
      const currentSpan = range[1] - range[0];
      const newSpan = Math.max(0.05, Math.min(1, currentSpan * zoomFactor));

      const rect = el.getBoundingClientRect();
      const cursorFrac = rect ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) : 0.5;
      const anchor = range[0] + cursorFrac * currentSpan;

      const newStart = Math.max(0, anchor - cursorFrac * newSpan);
      const newEnd = Math.min(1, newStart + newSpan);
      setRange([newStart, newEnd]);
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [range]);

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
    const currentSpan = initEnd - initStart;

    if (draggingTarget === "window-body") {
      const newStart = Math.max(0, Math.min(1 - currentSpan, initStart + deltaFrac));
      setRange([newStart, newStart + currentSpan]);
    } else if (draggingTarget === "left-handle") {
      const newStart = Math.max(0, Math.min(initEnd - 0.05, initStart + deltaFrac));
      setRange([newStart, initEnd]);
    } else if (draggingTarget === "right-handle") {
      const newEnd = Math.min(1, Math.max(initStart + 0.05, initEnd + deltaFrac));
      setRange([initStart, newEnd]);
    }
  };

  const handleLowerPointerUp = (e: React.PointerEvent) => {
    if (draggingTarget) {
      setDraggingTarget(null);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  // Wave Layout Coordinates Calculation
  const upperWidth = 1000;
  const upperHeight = 110;
  const waveBaseY = 70;

  const wavePoints = useMemo(() => {
    const count = visibleTurnIndices.length;
    const margin = 48;
    const usableW = upperWidth - margin * 2;

    return visibleTurnIndices.map((idx, i) => {
      const turn = turns[idx];
      const x = margin + (count > 1 ? (i / (count - 1)) * usableW : usableW / 2);
      // Elevation wave based on status / violations
      const lift = turn.hasViolation ? 28 : turn.hasPin ? 22 : turn.status === "committed" ? 16 : 10;
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
      style={{
        display: "flex",
        flexDirection: "column",
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: "16px",
        padding: "8px 16px 12px 16px",
        boxShadow: "0 1px 0 var(--glow) inset, 0 12px 24px -16px var(--shadow)",
        userSelect: "none",
        gap: "4px",
      }}
    >
      {/* 1. Upper Spline Wave Scrubber with Chevrons on sides */}
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        {/* Left Step Button */}
        <button
          onClick={() => handleStep(-1)}
          title="Step to previous turn"
          style={{
            position: "absolute",
            left: "-6px",
            zIndex: 10,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            color: "var(--ink)",
            borderRadius: "50%",
            width: "28px",
            height: "28px",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            boxShadow: "0 2px 6px var(--shadow)",
          }}
        >
          <ChevronLeft size={16} />
        </button>

        <svg
          ref={upperSvgRef}
          viewBox={`0 0 ${upperWidth} ${upperHeight}`}
          style={{ width: "100%", height: "105px", overflow: "visible" }}
        >
          {/* Base guideline */}
          <line x1={36} y1={waveBaseY} x2={upperWidth - 36} y2={waveBaseY} stroke="var(--line)" strokeWidth={1.5} />

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
                  r={isSelected ? 7 : 4}
                  fill={isSelected ? "var(--ink)" : dotColor}
                  stroke="var(--panel)"
                  strokeWidth={2}
                />

                {/* Selected Star Pill / Violations / Pins above */}
                {isSelected ? (
                  <g transform={`translate(${x}, ${y - 32})`}>
                    <path
                      d="M0 -11 L2.5 -3.5 L10.5 -3.5 L4.2 1.2 L6.5 8.8 L0 4.2 L-6.5 8.8 L-4.2 1.2 L-10.5 -3.5 L-2.5 -3.5 Z"
                      fill="var(--amber)"
                      transform="scale(0.85)"
                    />
                    <rect
                      x={-34}
                      y={-2}
                      width={68}
                      height={20}
                      rx={10}
                      fill="var(--ink)"
                      stroke="var(--panel)"
                      strokeWidth={1.2}
                    />
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#fff"
                      fontSize={10.5}
                      fontWeight={700}
                      y={8}
                    >
                      #{turn.id}
                    </text>
                  </g>
                ) : turn.hasViolation ? (
                  <g transform={`translate(${x}, ${y - 18})`}>
                    <SvgMiniAlertTriangle stroke="#fff" fill="var(--red)" />
                  </g>
                ) : turn.hasPin ? (
                  <g transform={`translate(${x}, ${y - 18})`}>
                    <circle r={6.5} fill="var(--panel)" stroke="var(--ink)" strokeWidth={1.1} />
                    <SvgMiniLock stroke="var(--ink)" />
                  </g>
                ) : null}

                {/* Date label below baseline */}
                <text
                  x={x}
                  y={waveBaseY + 16}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={isSelected ? 700 : 500}
                  fill={isSelected ? "var(--ink)" : "var(--mute)"}
                >
                  {turn.date}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Right Step Button */}
        <button
          onClick={() => handleStep(1)}
          title="Step to next turn"
          style={{
            position: "absolute",
            right: "-6px",
            zIndex: 10,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            color: "var(--ink)",
            borderRadius: "50%",
            width: "28px",
            height: "28px",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            boxShadow: "0 2px 6px var(--shadow)",
          }}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* 2. Lower Block Heatmap with Draggable Selection Window */}
      <div style={{ position: "relative", height: "32px", marginTop: "2px" }}>
        <svg
          ref={lowerSvgRef}
          viewBox="0 0 1000 32"
          style={{ width: "100%", height: "100%", display: "block" }}
          onPointerMove={handleLowerPointerMove}
          onPointerUp={handleLowerPointerUp}
        >
          {/* Background Heatmap Blocks */}
          {turns.map((t, idx) => {
            const blockW = Math.max(3, 980 / totalCount - 2.5);
            const bx = 10 + (idx / totalCount) * 980;
            const isCommitted = t.status === "committed";
            const isFailed = t.status === "failed";
            const isStage = t.status === "ready" || t.status === "staged";
            const color = isFailed ? "var(--red)" : isStage ? "var(--amber)" : isCommitted ? "var(--mapped)" : "var(--line)";

            return (
              <rect
                key={t.id}
                x={bx}
                y={6}
                width={blockW}
                height={20}
                rx={2}
                fill={color}
                opacity={0.85}
                onClick={() => onSelectTurn(t.id)}
                style={{ cursor: "pointer" }}
              >
                <title>{`Turn #${t.id}: ${t.label} (${t.status})`}</title>
              </rect>
            );
          })}

          {/* Selection Window Overlay with [ ||| ] Grips */}
          {(() => {
            const leftX = 10 + range[0] * 980;
            const rightX = 10 + range[1] * 980;
            const windowW = Math.max(26, rightX - leftX);
            const midX = leftX + windowW / 2;

            return (
              <g>
                {/* Window body */}
                <rect
                  x={leftX}
                  y={3}
                  width={windowW}
                  height={26}
                  rx={5}
                  fill="var(--accent)"
                  fillOpacity={0.14}
                  stroke="var(--accent)"
                  strokeWidth={1.5}
                  style={{ cursor: "grab" }}
                  onPointerDown={(e) => handleLowerPointerDown(e, "window-body")}
                />

                {/* Triple center grip lines [ ||| ] */}
                <line x1={midX - 3.5} y1={9} x2={midX - 3.5} y2={23} stroke="var(--accent)" strokeWidth={1.4} opacity={0.7} />
                <line x1={midX} y1={9} x2={midX} y2={23} stroke="var(--accent)" strokeWidth={1.4} opacity={0.7} />
                <line x1={midX + 3.5} y1={9} x2={midX + 3.5} y2={23} stroke="var(--accent)" strokeWidth={1.4} opacity={0.7} />

                {/* Left Grip Handle */}
                <rect
                  x={leftX - 3}
                  y={4}
                  width={6}
                  height={24}
                  rx={3}
                  fill="var(--accent)"
                  stroke="var(--panel)"
                  strokeWidth={1.2}
                  style={{ cursor: "ew-resize" }}
                  onPointerDown={(e) => handleLowerPointerDown(e, "left-handle")}
                />

                {/* Right Grip Handle */}
                <rect
                  x={rightX - 3}
                  y={4}
                  width={6}
                  height={24}
                  rx={3}
                  fill="var(--accent)"
                  stroke="var(--panel)"
                  strokeWidth={1.2}
                  style={{ cursor: "ew-resize" }}
                  onPointerDown={(e) => handleLowerPointerDown(e, "right-handle")}
                />
              </g>
            );
          })()}
        </svg>
      </div>

      {/* 3. Bottom Scrubber Info & Zoom Controls */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "4px" }}>
        <span style={{ fontSize: "11px", color: "var(--mute)" }}>
          Drag to explore. Each block represents a turn.
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <button
            type="button"
            onClick={handleZoomOut}
            title="Zoom Out"
            style={{
              background: "var(--side)",
              border: "1px solid var(--line)",
              color: "var(--ink)",
              borderRadius: "5px",
              padding: "2px 6px",
              display: "inline-flex",
              alignItems: "center",
              cursor: "pointer",
            }}
          >
            <Minus size={12} />
          </button>
          <button
            type="button"
            onClick={handleZoomIn}
            title="Zoom In"
            style={{
              background: "var(--side)",
              border: "1px solid var(--line)",
              color: "var(--ink)",
              borderRadius: "5px",
              padding: "2px 6px",
              display: "inline-flex",
              alignItems: "center",
              cursor: "pointer",
            }}
          >
            <Plus size={12} />
          </button>
          <button
            type="button"
            onClick={handleFit}
            title="Fit All History"
            style={{
              background: "var(--side)",
              border: "1px solid var(--line)",
              color: "var(--ink)",
              borderRadius: "5px",
              padding: "2px 8px",
              fontSize: "11px",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              cursor: "pointer",
            }}
          >
            Fit
          </button>
        </div>
      </div>
    </div>
  );
};
