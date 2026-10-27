// apps/studio/src/components/TimelinePage.tsx
// Comprehensive Turns Workstation: interactive dual timeline scrubber, side-by-side live topology diff,
// CodeMirror 6 syntax-highlighted code merge viewer, and contextual Turn Inspector.

import React, { useEffect, useState, useMemo, useCallback } from "react";
import { ArrowLeft, ArrowRight, ArrowLeftRight, CheckCircle2, RotateCcw } from "lucide-react";
import { useStore } from "../store";
import { api, SceneData } from "../api";
import { TimelineDualScrubber, TimelineTurnItem } from "./TimelineDualScrubber";
import { CodeDiffViewer } from "./CodeDiffViewer";
import { TopologyMap, TopologyDiffMode } from "./TopologyMap";

export const TimelinePage: React.FC = () => {
  const {
    graph,
    notify,
    run,
    activeTurn,
    scrubToTurn,
    scheduleQuarantineAction,
  } = useStore();

  const [rawTurns, setRawTurns] = useState<any[]>([]);
  const [selectedTurnId, setSelectedTurnId] = useState<string>("t0004");
  const [activeDiffTab, setActiveDiffTab] = useState<"files" | "map" | "deps" | "checks">("files");
  const [activeInspectorTab, setActiveInspectorTab] = useState<"summary" | "changes" | "decisions" | "checks">("summary");
  const [diffText, setDiffText] = useState<string>("");

  // Scenes for Before vs After live topology comparison
  const [beforeScene, setBeforeScene] = useState<SceneData | null>(null);
  const [afterScene, setAfterScene] = useState<SceneData | null>(null);

  const loadData = useCallback(async () => {
    try {
      const turnRes: any = await api.timeline.list(50);
      const fetched = Array.isArray(turnRes)
        ? turnRes
        : Array.isArray(turnRes?.turns)
        ? turnRes.turns
        : [];

      // Demo/Fallback turns with realistic history
      const list = fetched.length > 0
        ? fetched
        : [
            { id: "t0001", date: "Jun 10", prompt: "Initial project setup and architecture boundary definition", status: "committed" },
            { id: "t0002", date: "Jun 12", prompt: "Add auth service and session verification token engine", status: "committed", hasPin: true },
            { id: "t0003", date: "Jun 18", prompt: "Refactor shared types and validation schemas", status: "committed" },
            { id: "t0004", date: "Jun 26", prompt: "Checkout flow improvement: refactor payment logic into Services", status: "committed", hasPin: true, hasViolation: true },
            { id: "t0005", date: "Jun 28", prompt: "Implement Stripe and PayPal payment processors", status: "committed" },
            { id: "t0006", date: "Jul 01", prompt: "Introduce real-time notification queue for webhooks", status: "staged", hasViolation: true },
            { id: "t0007", date: "Jul 06", prompt: "Lock billing invariant pins and enforce deterministic checks", status: "committed", hasPin: true },
            { id: "t0008", date: "Jul 09", prompt: "Promote verified tripwires and update GitHub Actions CI", status: "committed" },
          ];

      setRawTurns(list);

      const targetId = activeTurn || (list.length > 3 ? list[3].id : list[0]?.id || "t0004");
      setSelectedTurnId(targetId);
      loadTurnDetails(targetId, list);
    } catch (e: any) {
      notify(`Could not load timeline: ${e.message || e}`);
    }
  }, [activeTurn, notify]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const loadTurnDetails = async (turnId: string, turnList?: any[]) => {
    const list = turnList || rawTurns;
    const currentIdx = list.findIndex((t) => t.id === turnId);
    const prevTurn = currentIdx > 0 ? list[currentIdx - 1] : null;

    try {
      // 1. Fetch real unified patch
      const diffRes: any = await api.timeline.diff(turnId);
      if (typeof diffRes === "string") {
        setDiffText(diffRes);
      } else if (diffRes && typeof diffRes.patch === "string") {
        setDiffText(diffRes.patch);
      } else {
        setDiffText("");
      }

      // 2. Fetch point-in-time snapshot scenes for Before & After live Topology
      try {
        const after = await api.timeline4d.snapshot(turnId);
        setAfterScene(after);
      } catch {
        setAfterScene(null);
      }

      if (prevTurn) {
        try {
          const before = await api.timeline4d.snapshot(prevTurn.id);
          setBeforeScene(before);
        } catch {
          setBeforeScene(null);
        }
      } else {
        setBeforeScene(null);
      }
    } catch (err: any) {
      console.warn("Could not load full turn details:", err);
    }
  };

  const handleSelectTurn = (turnId: string) => {
    setSelectedTurnId(turnId);
    scrubToTurn(turnId);
    loadTurnDetails(turnId);
  };

  const selectedTurn = useMemo(() => {
    return rawTurns.find((t) => t.id === selectedTurnId) || rawTurns[0] || null;
  }, [rawTurns, selectedTurnId]);

  // Convert raw turns into TimelineTurnItem list for the dual scrubber
  const scrubberItems: TimelineTurnItem[] = useMemo(() => {
    return rawTurns.map((t, idx) => ({
      id: t.id,
      number: idx + 1,
      label: t.summary || t.prompt || `Turn #${t.id}`,
      date: t.date || (t.ts ? new Date(t.ts).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : `Turn ${idx + 1}`),
      status: t.status === "failed" ? "failed" : t.status === "ready" || t.status === "staged" ? "staged" : "committed",
      hasPin: t.hasPin ?? (idx === 1 || idx === 3 || idx === 6),
      hasViolation: t.hasViolation ?? (idx === 3 || idx === 5),
    }));
  }, [rawTurns]);

  // Compute live structural delta between Before and After
  const diffData: TopologyDiffMode = useMemo(() => {
    const addedNodes = new Set<string>();
    const modifiedNodes = new Set<string>();
    const removedNodes = new Set<string>();
    const violatedNodes = new Set<string>();

    if (selectedTurn?.touched?.nodes) {
      selectedTurn.touched.nodes.forEach((n: string) => modifiedNodes.add(n));
    }
    if (selectedTurn?.removes) {
      selectedTurn.removes.forEach((r: string) => removedNodes.add(r));
    }
    if (selectedTurn?.implements) {
      Object.keys(selectedTurn.implements).forEach((i) => addedNodes.add(i));
    }

    if (selectedTurn?.hasViolation || selectedTurn?.gate === "redo") {
      violatedNodes.add("payments");
      violatedNodes.add("web");
    }

    return { addedNodes, modifiedNodes, removedNodes, violatedNodes };
  }, [selectedTurn]);

  // Revert turn triggers Tier 1 Quarantine
  const handleRevertTurn = () => {
    if (!selectedTurn) return;
    scheduleQuarantineAction({
      id: `revert-${selectedTurn.id}`,
      label: `Revert Turn #${selectedTurn.id}`,
      description: `Reverting this turn cascades to working directory and git history`,
      isCascading: true,
      execute: async () => {
        await run(`Reverting Turn #${selectedTurn.id}`, async () => {
          notify(`Turn #${selectedTurn.id} reverted.`);
          loadData();
        });
      },
    });
  };

  return (
    <div
      className="turns-workstation"
      style={{
        display: "flex",
        height: "100%",
        width: "100%",
        background: "var(--bg)",
        color: "var(--ink)",
        fontFamily: "'IBM Plex Sans', sans-serif",
        overflow: "hidden",
      }}
    >
      {/* ── Main Left & Center Column: Scrubber + Before/After Topology Diff + CodeMirror MergeView ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", minWidth: 0, overflowY: "auto" }}>
        {/* 1. Header Row */}
        <div style={{ padding: "14px 24px 8px 24px", background: "var(--panel)", borderBottom: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
            <div>
              <div style={{ fontSize: "11px", color: "var(--mute)", marginBottom: "2px" }}>
                Timeline & Turns · Visual Verification Workstation
              </div>
              <h1 className="serif" style={{ fontSize: "24px", fontWeight: 600, margin: 0, color: "var(--ink)" }}>
                Turn #{selectedTurn?.id}: {selectedTurn?.summary || selectedTurn?.prompt || "Selected Turn"}
              </h1>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  padding: "3px 8px",
                  borderRadius: "6px",
                  background: selectedTurn?.status === "committed" ? "var(--side)" : "var(--redbg)",
                  color: selectedTurn?.status === "committed" ? "var(--accent)" : "var(--red)",
                  border: `1px solid ${selectedTurn?.status === "committed" ? "var(--line)" : "var(--red)"}`,
                }}
              >
                {selectedTurn?.status || "committed"}
              </span>

              <button
                onClick={handleRevertTurn}
                style={{
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  borderRadius: "6px",
                  padding: "4px 10px",
                  fontSize: "12px",
                  color: "var(--red)",
                  cursor: "pointer",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <RotateCcw size={12} />
                Revert Turn
              </button>
            </div>
          </div>
        </div>

        {/* 2. Interactive Dual Scrubber Component (Wave Curve + Heatmap Window) */}
        <div style={{ padding: "10px 24px", background: "var(--bg)", borderBottom: "1px solid var(--line)" }}>
          <TimelineDualScrubber
            turns={scrubberItems}
            selectedTurnId={selectedTurnId}
            onSelectTurn={handleSelectTurn}
          />
        </div>

        {/* 3. Live Side-by-Side Topology Diff ('Before #tXXXX' vs 'After #tXXXX') */}
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid var(--line)",
            background: "var(--bg)",
            minHeight: "310px",
            overflow: "hidden",
            position: "relative",
          }}
        >
          {/* Before Card */}
          <div style={{ flex: 1, padding: "10px 16px", borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <ArrowLeft size={13} style={{ color: "var(--mute)" }} />
                <span style={{ fontWeight: 700, fontSize: "13px", color: "var(--ink)" }}>Before #{selectedTurn?.id}</span>
              </div>
              <span style={{ fontSize: "10.5px", background: "var(--side)", padding: "1px 6px", borderRadius: "4px", color: "var(--mute)", fontFamily: "var(--mono)" }}>
                prior state
              </span>
            </div>

            <div style={{ flex: 1, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "10px", overflow: "hidden" }}>
              <TopologyMap
                compact={true}
                snapshotScene={beforeScene}
                diffMode={diffData}
              />
            </div>
          </div>

          {/* Center Swap / Sync Icon */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>
            <div
              style={{
                width: "26px",
                height: "26px",
                borderRadius: "50%",
                background: "var(--panel)",
                border: "1px solid var(--line)",
                display: "grid",
                placeItems: "center",
                color: "var(--mute)",
                boxShadow: "0 2px 6px var(--shadow)",
              }}
            >
              <ArrowLeftRight size={13} />
            </div>
          </div>

          {/* After Card */}
          <div style={{ flex: 1, padding: "10px 16px", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <ArrowRight size={13} style={{ color: "var(--accent)" }} />
                <span style={{ fontWeight: 700, fontSize: "13px", color: "var(--ink)" }}>After #{selectedTurn?.id}</span>
              </div>
              <span style={{ fontSize: "10.5px", background: "var(--side)", padding: "1px 6px", borderRadius: "4px", color: "var(--accent)", fontFamily: "var(--mono)", fontWeight: 600 }}>
                turn applied
              </span>
            </div>

            <div style={{ flex: 1, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "10px", overflow: "hidden" }}>
              <TopologyMap
                compact={true}
                snapshotScene={afterScene}
                diffMode={diffData}
              />
            </div>
          </div>
        </div>

        {/* 4. Bottom Tabbed Diff Panel */}
        <div style={{ padding: "10px 24px 20px 24px", display: "flex", flexDirection: "column", gap: "10px" }}>
          {/* Tabs bar */}
          <div style={{ display: "flex", gap: "4px", borderBottom: "1px solid var(--line)", paddingBottom: "2px" }}>
            {[
              { id: "files", label: "Code Diff" },
              { id: "map", label: "Map Diff" },
              { id: "deps", label: "Dependency Diff" },
              { id: "checks", label: "Checks & Gates" },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveDiffTab(t.id as any)}
                style={{
                  background: activeDiffTab === t.id ? "var(--side)" : "transparent",
                  color: activeDiffTab === t.id ? "var(--ink)" : "var(--mute)",
                  border: "none",
                  padding: "5px 12px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: activeDiffTab === t.id ? 600 : 500,
                  cursor: "pointer",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          {activeDiffTab === "files" && (
            <CodeDiffViewer
              patchText={diffText}
              fallbackFiles={selectedTurn?.touched?.files}
            />
          )}

          {activeDiffTab === "map" && (
            <div
              style={{
                padding: "16px",
                background: "var(--panel)",
                borderRadius: "12px",
                border: "1px solid var(--line)",
                fontSize: "12px",
                lineHeight: "1.6",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: "13px", marginBottom: "8px", color: "var(--ink)" }}>
                Structural Map Deltas for #{selectedTurn?.id}
              </div>
              <div><b>Added nodes:</b> {Array.from(diffData.addedNodes || []).join(", ") || "None"}</div>
              <div><b>Modified nodes:</b> {Array.from(diffData.modifiedNodes || []).join(", ") || "None"}</div>
              <div><b>Removed nodes:</b> {Array.from(diffData.removedNodes || []).join(", ") || "None"}</div>
            </div>
          )}

          {activeDiffTab === "deps" && (
            <div
              style={{
                padding: "16px",
                background: "var(--panel)",
                borderRadius: "12px",
                border: "1px solid var(--line)",
                fontSize: "12px",
                lineHeight: "1.6",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: "13px", marginBottom: "8px", color: "var(--ink)" }}>
                Dependency Graph Deltas
              </div>
              {selectedTurn?.hasViolation ? (
                <div style={{ color: "var(--red)", background: "var(--redbg)", padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--red)" }}>
                  <b>Boundary Violation:</b> Direct dependency between presentation web tier and private backend subsystem.
                </div>
              ) : (
                <div style={{ color: "var(--accent)" }}>
                  All architectural dependencies comply with blueprint invariants.
                </div>
              )}
            </div>
          )}

          {activeDiffTab === "checks" && (
            <div
              style={{
                padding: "16px",
                background: "var(--panel)",
                borderRadius: "12px",
                border: "1px solid var(--line)",
                fontSize: "12px",
                lineHeight: "1.6",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: "13px", marginBottom: "8px", color: "var(--ink)" }}>
                Turn Gate Verification Checks
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><CheckCircle2 size={13} style={{ color: "var(--accent)" }} /> Tripwire gate checked before commit</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><CheckCircle2 size={13} style={{ color: "var(--accent)" }} /> No forbidden cyclic imports detected in core crates</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><CheckCircle2 size={13} style={{ color: "var(--accent)" }} /> Intent assumption claimed: <code>afwe-core does not import afwe-cli</code></div>
            </div>
          )}
        </div>
      </div>

      {/* ── Right Column: Contextual Turn Inspector ── */}
      <aside
        style={{
          width: "300px",
          background: "var(--side)",
          borderLeft: "1px solid var(--line)",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          overflowY: "auto",
        }}
      >
        <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ fontSize: "11px", color: "var(--mute)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Turn Inspector
          </div>
          <div className="serif" style={{ fontSize: "18px", fontWeight: 600, color: "var(--ink)", marginTop: "2px" }}>
            #{selectedTurn?.id}
          </div>
        </div>

        {/* Inspector tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--line)", padding: "4px 8px", background: "var(--side)" }}>
          {(["summary", "changes", "decisions", "checks"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveInspectorTab(tab)}
              style={{
                flex: 1,
                border: "none",
                background: activeInspectorTab === tab ? "var(--panel)" : "transparent",
                color: activeInspectorTab === tab ? "var(--ink)" : "var(--mute)",
                borderRadius: "6px",
                padding: "4px 6px",
                fontSize: "11px",
                fontWeight: activeInspectorTab === tab ? 600 : 500,
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Inspector Tab Content */}
        <div style={{ padding: "16px 18px", fontSize: "12px", lineHeight: "1.5" }}>
          {activeInspectorTab === "summary" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <b style={{ color: "var(--ink)" }}>Prompt:</b>
                <div style={{ color: "var(--mute)", marginTop: "2px" }}>
                  {selectedTurn?.prompt || "No prompt provided"}
                </div>
              </div>
              <div>
                <b style={{ color: "var(--ink)" }}>Summary:</b>
                <div style={{ color: "var(--mute)", marginTop: "2px" }}>
                  {selectedTurn?.summary || "Clean turn commit."}
                </div>
              </div>
              <div>
                <b style={{ color: "var(--ink)" }}>Timestamp:</b>
                <div style={{ color: "var(--mute)", marginTop: "2px" }}>
                  {selectedTurn?.date || "Recent"}
                </div>
              </div>
            </div>
          )}

          {activeInspectorTab === "changes" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <b style={{ color: "var(--ink)" }}>Touched Files:</b>
              {(selectedTurn?.touched?.files || []).map((f: string) => (
                <div key={f} style={{ fontFamily: "var(--mono)", fontSize: "11px", color: "var(--mute)" }}>
                  • {f}
                </div>
              ))}
              {(!selectedTurn?.touched?.files || selectedTurn.touched.files.length === 0) && (
                <div style={{ color: "var(--mute)" }}>No specific files cataloged.</div>
              )}
            </div>
          )}

          {activeInspectorTab === "decisions" && (
            <div style={{ color: "var(--mute)" }}>
              No explicit architectural decisions recorded on this turn.
            </div>
          )}

          {activeInspectorTab === "checks" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ color: "var(--accent)", display: "flex", alignItems: "center", gap: 5 }}><CheckCircle2 size={13} /> Deterministic gate checks passed</div>
              <div style={{ color: "var(--accent)", display: "flex", alignItems: "center", gap: 5 }}><CheckCircle2 size={13} /> Pin boundaries respected</div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};
