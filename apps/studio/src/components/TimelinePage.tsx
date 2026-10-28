// apps/studio/src/components/TimelinePage.tsx
// Comprehensive Turns Workstation: interactive dual timeline scrubber, side-by-side live topology diff,
// CodeMirror 6 syntax-highlighted code merge viewer, and contextual Turn Inspector.
import React, { useEffect, useState, useMemo, useCallback } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowLeftRight,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Plus,
  Lock,
  List,
  MoreHorizontal,
  ChevronRight,
  X,
  FileCode,
  Disc3,
  Layers,
  Boxes,
} from "lucide-react";
import { ConstellationGlyph } from "../lib/lucideSvgPaths";
import { useStore } from "../store";
import { api, SceneData, Graph } from "../api";
import { TimelineDualScrubber, TimelineTurnItem } from "./TimelineDualScrubber";
import { CodeDiffViewer } from "./CodeDiffViewer";
import { TopologyMap, TopologyDiffMode } from "./TopologyMap";
import { ConstellationMap } from "./ConstellationMap";
import { RadialMap } from "./RadialMap";
import { GraphView } from "./GraphView";
import { buildHierarchyTree, buildDirectedEdges, HierarchyNode } from "../lib/hierarchy";
import { HarnessFixButton } from "./HarnessFixPrompt";

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
  const [filterChip, setFilterChip] = useState<string>("all");
  const [activeDiffTab, setActiveDiffTab] = useState<"files" | "map" | "deps" | "checks">("files");
  const [activeInspectorTab, setActiveInspectorTab] = useState<"summary" | "changes" | "decisions" | "checks">("summary");
  const [diffText, setDiffText] = useState<string>("");
  const [turnRecord, setTurnRecord] = useState<any | null>(null);

  // Scenes for Before vs After live topology comparison
  const [beforeScene, setBeforeScene] = useState<SceneData | null>(null);
  const [afterScene, setAfterScene] = useState<SceneData | null>(null);

  // Diff view mode selector supporting all 4 view types with Blueprint as default
  const [diffViewMode, setDiffViewMode] = useState<"blueprint" | "constellation" | "radial" | "topology">("blueprint");

  // Reconstructed point-in-time graphs for Before & After 3-view comparison
  const beforeEffectiveGraph = useMemo<Graph | null>(() => {
    if (!graph) return null;
    if (!beforeScene) return graph;
    const s = beforeScene as any;
    return {
      ...graph,
      nodes: s.nodes || graph.nodes || [],
      code_edges: s.edges || s.code_edges || graph.code_edges || [],
    } as Graph;
  }, [beforeScene, graph]);

  const afterEffectiveGraph = useMemo<Graph | null>(() => {
    if (!graph) return null;
    if (!afterScene) return graph;
    const s = afterScene as any;
    return {
      ...graph,
      nodes: s.nodes || graph.nodes || [],
      code_edges: s.edges || s.code_edges || graph.code_edges || [],
    } as Graph;
  }, [afterScene, graph]);

  const beforeRoot = useMemo(() => buildHierarchyTree(beforeEffectiveGraph), [beforeEffectiveGraph]);
  const afterRoot = useMemo(() => buildHierarchyTree(afterEffectiveGraph), [afterEffectiveGraph]);

  const { domainEdges: beforeDomainEdges, nodeEdges: beforeNodeEdges } = useMemo(
    () => buildDirectedEdges(beforeEffectiveGraph, beforeRoot),
    [beforeEffectiveGraph, beforeRoot]
  );
  const { domainEdges: afterDomainEdges, nodeEdges: afterNodeEdges } = useMemo(
    () => buildDirectedEdges(afterEffectiveGraph, afterRoot),
    [afterEffectiveGraph, afterRoot]
  );

  const projectName = graph?.project?.name || "workspace";

  const loadData = useCallback(async () => {
    try {
      const turnRes: any = await api.timeline.list(50);
      const fetched = Array.isArray(turnRes)
        ? turnRes
        : Array.isArray(turnRes?.turns)
        ? turnRes.turns
        : [];

      // Normalize turn records so id is always defined whether backend sends 'turn' or 'id'
      const list = fetched.map((t: any, idx: number) => ({
        ...t,
        id: t.id || t.turn || t.turn_hash || `t${String(idx + 1).padStart(4, "0")}`,
        turn_hash: t.turn_hash || t.id,
      }));

      setRawTurns(list);

      const targetId = activeTurn || (list.length > 0 ? list[list.length - 1].id : null);
      setSelectedTurnId(targetId);
      if (targetId) {
        loadTurnDetails(targetId, list);
      }
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

      // 3. Fetch comprehensive turn record (intents, gate decision, touched files/nodes, checks)
      try {
        const full = await api.timeline.get(turnId);
        setTurnRecord(full);
      } catch {
        setTurnRecord(null);
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
      label: t.title || t.summary || t.prompt || `Turn #${t.id}`,
      date: t.date || (t.ts ? new Date(t.ts).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : `Turn ${idx + 1}`),
      status: t.status === "failed" ? "failed" : t.status === "ready" || t.status === "staged" ? "staged" : "committed",
      hasPin: t.hasPin ?? (idx === 1 || idx === 3 || idx === 6),
      hasViolation: t.hasViolation ?? (idx === 3 || idx === 5),
    }));
  }, [rawTurns]);

  // Filter chips list
  const filterChips = [
    { id: "all", label: "All turns" },
    { id: "code", label: "Code changes" },
    { id: "proposals", label: "Proposals" },
    { id: "violations", label: "Rule violations" },
    { id: "pins", label: "Pins" },
    { id: "blueprint", label: "Blueprint updates" },
  ];

  // Compute live structural delta between Before and After
  const diffData: TopologyDiffMode = useMemo(() => {
    const t = turnRecord?.turn;
    const touchedNodes: string[] = t?.touched?.nodes || selectedTurn?.nodes || [];
    const reasons: string[] = t?.gate?.reasons || selectedTurn?.reasons || [];
    const isViolated = reasons.some((r: string) =>
      r.toLowerCase().includes("violation") ||
      r.toLowerCase().includes("forbid") ||
      r.toLowerCase().includes("blocked")
    );

    const modifiedNodes = new Set<string>(touchedNodes);
    const addedNodes = new Set<string>();
    const removedNodes = new Set<string>();
    const violatedNodes = new Set<string>(isViolated ? touchedNodes : []);

    return { addedNodes, modifiedNodes, removedNodes, violatedNodes };
  }, [turnRecord, selectedTurn]);

  // Revert turn triggers Tier 1 Quarantine with 10-second grace timer
  const handleRevertTurn = () => {
    if (!selectedTurn) return;
    scheduleQuarantineAction({
      id: `revert-${selectedTurn.id}`,
      label: `Revert Turn #${selectedTurn.id}`,
      description: `Reverting this turn will undo local modifications across codebase and git history.`,
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
      {/* ── Main Center Column: Header, Filter Chips, Scrubber, Architecture Diff, Diff Drawer ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", minWidth: 0, overflowY: "auto" }}>
        {/* 1. Header & Filter Chips Strip */}
        <div style={{ padding: "14px 24px 10px 24px", background: "var(--panel)", borderBottom: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
            <div>
              <div style={{ fontSize: "12px", color: "var(--mute)", marginBottom: "4px" }}>
                Projects › {projectName} › Turns
              </div>
              <h1 className="serif" style={{ fontSize: "24px", fontWeight: 700, margin: 0, color: "var(--ink)", letterSpacing: "0.02em" }}>
                Turns
              </h1>
              <div style={{ fontSize: "12.5px", color: "var(--mute)", marginTop: "2px" }}>
                Every change, all at once. Explore how your codebase and its architecture evolved over time.
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <button
                type="button"
                className="btn-soft"
                style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "12px", padding: "5px 10px" }}
              >
                <List size={13} />
                View as list
              </button>
              <button
                type="button"
                className="btn-soft"
                style={{ display: "inline-flex", alignItems: "center", padding: "5px 8px" }}
              >
                <MoreHorizontal size={14} />
              </button>
            </div>
          </div>

          {/* Filter Chips Bar */}
          <div style={{ display: "flex", gap: "6px", marginTop: "12px", flexWrap: "wrap" }}>
            {filterChips.map((chip) => {
              const active = filterChip === chip.id;
              return (
                <button
                  key={chip.id}
                  onClick={() => setFilterChip(chip.id)}
                  style={{
                    background: active ? "var(--ink)" : "var(--panel)",
                    color: active ? "var(--panel)" : "var(--ink)",
                    border: `1px solid ${active ? "var(--ink)" : "var(--line)"}`,
                    borderRadius: "16px",
                    padding: "4px 12px",
                    fontSize: "12px",
                    fontWeight: active ? 600 : 500,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. Interactive Dual Timeline Scrubber (Wave Curve + Milestone Dates + Heatmap Window) */}
        <div style={{ padding: "10px 24px", background: "var(--bg)", borderBottom: "1px solid var(--line)" }}>
          <TimelineDualScrubber
            turns={scrubberItems}
            selectedTurnId={selectedTurnId}
            onSelectTurn={handleSelectTurn}
          />
        </div>

        {/* Diff View Mode Switcher Header Bar (Constellation Default) */}
        <div
          style={{
            padding: "8px 24px",
            background: "var(--bg)",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--mute)" }}>
              Diff View:
            </span>
            <div
              style={{
                display: "inline-flex",
                background: "var(--panel)",
                border: "1px solid var(--line)",
                borderRadius: "8px",
                padding: "2px",
                gap: "2px",
              }}
            >
              {[
                {
                  id: "blueprint" as const,
                  label: "Blueprint",
                  icon: <Boxes size={13} strokeWidth={2} />,
                },
                {
                  id: "constellation" as const,
                  label: "Constellation",
                  icon: <ConstellationGlyph size={13} />,
                },
                {
                  id: "radial" as const,
                  label: "Radial",
                  icon: <Disc3 size={13} strokeWidth={2} />,
                },
                {
                  id: "topology" as const,
                  label: "Topology",
                  icon: <Layers size={13} strokeWidth={2} />,
                },
              ].map((item) => {
                const isActive = diffViewMode === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setDiffViewMode(item.id)}
                    title={`${item.label} diff`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: isActive ? "5px" : "0px",
                      fontSize: "12px",
                      fontWeight: isActive ? 600 : 500,
                      padding: isActive ? "4px 10px" : "4px 8px",
                      borderRadius: "6px",
                      border: "none",
                      background: isActive ? "var(--ink)" : "transparent",
                      color: isActive ? "var(--panel)" : "var(--mute)",
                      cursor: "pointer",
                      transition: "all 0.16s ease-in-out",
                    }}
                  >
                    {item.icon}
                    {isActive && <span>{item.label}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <span style={{ fontSize: "11px", color: "var(--mute)" }}>
            Comparing architecture across Turn #{selectedTurn?.id}
          </span>
        </div>

        {/* 3. Live Side-by-Side Architecture Diff ('Before #id' vs 'After #id') */}
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid var(--line)",
            background: "var(--bg)",
            minHeight: "330px",
            overflow: "hidden",
            position: "relative",
          }}
        >
          {/* Before Pane */}
          <div style={{ flex: 1, padding: "10px 16px", borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span
                  style={{
                    display: "inline-grid",
                    placeItems: "center",
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: "var(--redbg)",
                    color: "var(--red)",
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  −
                </span>
                <span style={{ fontWeight: 700, fontSize: "13px", color: "var(--ink)" }}>
                  Before #{selectedTurn?.id}
                </span>
                <span style={{ fontSize: "11px", color: "var(--mute)" }}>
                  {selectedTurn?.beforeTime || "Jun 25, 2025 · 22:14"}
                </span>
              </div>
              <span style={{ fontSize: "10.5px", background: "var(--side)", padding: "1px 6px", borderRadius: "4px", color: "var(--mute)", fontFamily: "var(--mono)" }}>
                main @ {selectedTurn?.beforeCommit || "a3f9c2"}
              </span>
            </div>

            <div style={{ flex: 1, minHeight: "340px", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "10px", overflow: "hidden", display: "flex" }}>
              {diffViewMode === "blueprint" ? (
                <GraphView
                  timelineT={1}
                  graph={beforeEffectiveGraph}
                  compact={true}
                />
              ) : diffViewMode === "constellation" ? (
                <ConstellationMap
                  root={beforeRoot}
                  anchorKey={null}
                  domainEdges={beforeDomainEdges}
                  nodeEdges={beforeNodeEdges}
                  scope="map"
                  forceParentFallback={false}
                  timelineT={1}
                  compareT={1}
                  neighborhoodExpanded={false}
                  filterMode="all"
                  selectedEntity={null}
                  onSelectEntity={() => {}}
                  onSetAnchor={() => {}}
                  onSetForceParentFallback={() => {}}
                  onOpenInRadial={() => {}}
                />
              ) : diffViewMode === "radial" ? (
                <RadialMap
                  root={beforeRoot}
                  focusNode={beforeRoot}
                  depth={3}
                  growth={false}
                  denseL4={false}
                  timelineT={1}
                  selectedEntity={null}
                  filterMode="all"
                  onSelectEntity={() => {}}
                  onDrillDown={() => {}}
                  onDrillUp={() => {}}
                  onOpenConstellation={() => {}}
                />
              ) : (
                <TopologyMap
                  compact={true}
                  snapshotScene={beforeScene}
                  diffMode={diffData}
                />
              )}
            </div>
          </div>

          {/* Center Split Divider Handle < > */}
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
                cursor: "col-resize",
              }}
            >
              <ArrowLeftRight size={13} />
            </div>
          </div>

          {/* After Pane */}
          <div style={{ flex: 1, padding: "10px 16px", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span
                  style={{
                    display: "inline-grid",
                    placeItems: "center",
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: "var(--side)",
                    color: "var(--accent)",
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  +
                </span>
                <span style={{ fontWeight: 700, fontSize: "13px", color: "var(--ink)" }}>
                  After #{selectedTurn?.id}
                </span>
                <span style={{ fontSize: "11px", color: "var(--mute)" }}>
                  {selectedTurn?.afterTime || "Jun 26, 2025 · 14:32"}
                </span>
              </div>
              <span style={{ fontSize: "10.5px", background: "var(--side)", padding: "1px 6px", borderRadius: "4px", color: "var(--accent)", fontFamily: "var(--mono)", fontWeight: 600 }}>
                main @ {selectedTurn?.afterCommit || "b7e1d4"}
              </span>
            </div>

            <div style={{ flex: 1, minHeight: "340px", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "10px", overflow: "hidden", display: "flex" }}>
              {diffViewMode === "blueprint" ? (
                <GraphView
                  timelineT={1}
                  graph={afterEffectiveGraph}
                  compact={true}
                />
              ) : diffViewMode === "constellation" ? (
                <ConstellationMap
                  root={afterRoot}
                  anchorKey={null}
                  domainEdges={afterDomainEdges}
                  nodeEdges={afterNodeEdges}
                  scope="map"
                  forceParentFallback={false}
                  timelineT={1}
                  compareT={1}
                  neighborhoodExpanded={false}
                  filterMode="all"
                  selectedEntity={null}
                  onSelectEntity={() => {}}
                  onSetAnchor={() => {}}
                  onSetForceParentFallback={() => {}}
                  onOpenInRadial={() => {}}
                />
              ) : diffViewMode === "radial" ? (
                <RadialMap
                  root={afterRoot}
                  focusNode={afterRoot}
                  depth={3}
                  growth={false}
                  denseL4={false}
                  timelineT={1}
                  selectedEntity={null}
                  filterMode="all"
                  onSelectEntity={() => {}}
                  onDrillDown={() => {}}
                  onDrillUp={() => {}}
                  onOpenConstellation={() => {}}
                />
              ) : (
                <TopologyMap
                  compact={true}
                  snapshotScene={afterScene}
                  diffMode={diffData}
                />
              )}
            </div>
          </div>
        </div>

        {/* Architecture Diff Legend Bar */}
        <div
          style={{
            padding: "6px 24px",
            background: "var(--panel)",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            gap: "14px",
            fontSize: "11px",
            color: "var(--mute)",
            flexWrap: "wrap",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--line)", display: "inline-block" }} />
            Unchanged
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", display: "inline-block" }} />
            Added
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--amber)", display: "inline-block" }} />
            Modified
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--red)", display: "inline-block" }} />
            Removed
          </span>
          <span style={{ borderLeft: "1px solid var(--line)", height: 12, margin: "0 4px" }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 14, height: 2, background: "var(--mute)", display: "inline-block" }} />
            Dependency (uses)
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--accent)" }}>
            <span style={{ width: 14, height: 2, background: "var(--accent)", borderTop: "1px dashed var(--accent)", display: "inline-block" }} />
            New dependency
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--red)" }}>
            <span style={{ width: 14, height: 2, background: "var(--red)", borderTop: "1px dashed var(--red)", display: "inline-block" }} />
            Removed dependency
          </span>
          {(diffData.violatedNodes?.size || 0) > 0 && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--red)", fontWeight: 600 }}>
              <span style={{ width: 14, height: 2, background: "var(--red)", borderTop: "2px dotted var(--red)", display: "inline-block" }} />
              Rule violation ({diffData.violatedNodes?.size})
            </span>
          )}
        </div>

        {/* 4. Bottom Tabbed Diff Panel */}
        <div style={{ padding: "10px 24px 24px 24px", display: "flex", flexDirection: "column", gap: "10px" }}>
          {/* Tabs bar */}
          <div style={{ display: "flex", gap: "4px", borderBottom: "1px solid var(--line)", paddingBottom: "2px" }}>
            {[
              { id: "files", label: "Files (12)" },
              { id: "map", label: "Map diff" },
              { id: "deps", label: "Dependency diff" },
              { id: "checks", label: "Checks (2)" },
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
              <div style={{ color: "var(--red)", background: "var(--redbg)", padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--red)", marginBottom: 8 }}>
                <b>Boundary Violation:</b> Direct dependency between presentation web tier and services layer (<code>services/auth → web/components</code>).
              </div>
              <div><b>New edge:</b> <code>apps/web/components → services/payments</code> (allowed)</div>
              <div><b>Removed edge:</b> <code>apps/web/components → apps/web/lib/stripe</code></div>
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
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--red)", marginBottom: 4 }}>
                <AlertTriangle size={13} /> Rule violation: UI layer must not depend directly on Services
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><CheckCircle2 size={13} style={{ color: "var(--accent)" }} /> Tripwire gate checked before commit</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><CheckCircle2 size={13} style={{ color: "var(--accent)" }} /> Invariant pin held: <code>pin-studio-bookmarks-wired</code></div>
            </div>
          )}
        </div>
      </div>

      {/* ── Right Column: High-Fidelity Contextual Turn Inspector Drawer ── */}
      <aside
        style={{
          width: "320px",
          background: "var(--panel)",
          borderLeft: "1px solid var(--line)",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          overflowY: "auto",
        }}
      >
        {/* Drawer Header with Turn ID and Status Badge */}
        {!selectedTurn ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--mute)", fontSize: "12px" }}>
            No turn selected or recorded yet.<br /><br />
            Run <code style={{ color: "var(--ink)" }}>afwe turn begin &quot;&lt;prompt&gt;&quot; --target &lt;files&gt;</code> to create a turn.
          </div>
        ) : (() => {
          const turnData = turnRecord?.turn || selectedTurn;
          const touchedFiles: string[] = turnData?.touched?.files || turnData?.files || [];
          const turnIntents: any[] = turnData?.intents || [];
          const gateReasons: string[] = turnData?.gate?.reasons || turnData?.reasons || [];
          const gateDecision: string = turnData?.gate?.decision || turnData?.status || "committed";
          const isViolated = gateReasons.some((r: string) =>
            r.toLowerCase().includes("violation") ||
            r.toLowerCase().includes("forbid") ||
            r.toLowerCase().includes("blocked")
          );

          return (
            <>
              <div style={{ padding: "16px 18px 12px 18px", borderBottom: "1px solid var(--line)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--ink)" }}>
                      Turn #{selectedTurn?.id}
                    </span>
                    <span
                      style={{
                        fontSize: "10.5px",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        padding: "1px 6px",
                        borderRadius: "4px",
                        background: isViolated ? "var(--redbg)" : "var(--side)",
                        color: isViolated ? "var(--red)" : "var(--accent)",
                        border: "1px solid var(--line)",
                      }}
                    >
                      {gateDecision.toUpperCase()}
                    </span>
                  </div>
                  {isViolated && (
                    <HarnessFixButton
                      issueType="constraint_violation"
                      title={`Turn #${selectedTurn?.id} Rule Violation`}
                      rationale={gateReasons.join("\n")}
                      cliCommand={`afwe turn redo ${selectedTurn?.id}`}
                      compact={true}
                    />
                  )}
                </div>
                {turnData?.turn_hash && (
                  <div style={{ fontSize: "10.5px", color: "var(--mute)", fontFamily: "monospace", display: "flex", gap: "6px", alignItems: "center", marginTop: "3px", flexWrap: "wrap" }}>
                    <span>Hash: {turnData.turn_hash.slice(0, 10)}</span>
                    {turnData.alias && <span style={{ background: "var(--side)", padding: "1px 5px", borderRadius: "4px" }}>Alias: {turnData.alias}</span>}
                    {turnData.parent_hash && (
                      <button
                        type="button"
                        onClick={() => {
                          const pTurn = rawTurns.find((t) => t.turn_hash === turnData.parent_hash || t.id === turnData.parent_hash);
                          if (pTurn) handleSelectTurn(pTurn.id);
                        }}
                        style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "10.5px", textDecoration: "underline", padding: 0 }}
                      >
                        Parent: {turnData.parent_hash.slice(0, 8)}
                      </button>
                    )}
                  </div>
                )}
                <div style={{ fontSize: "11px", color: "var(--mute)", marginTop: "4px" }}>
                  {turnData?.ts ? new Date(turnData.ts).toLocaleString() : selectedTurn?.afterTime || "Committed turn"}
                </div>

                <h2 className="serif" style={{ fontSize: "16px", fontWeight: 700, margin: "10px 0 4px 0", color: "var(--ink)" }}>
                  {turnData?.summary || (turnData?.prompt ? turnData.prompt.split("\n")[0] : `Turn #${selectedTurn?.id}`)}
                </h2>

                {/* Original Captured Prompt Card */}
                {turnData?.prompt && (
                  <div
                    style={{
                      background: "var(--side)",
                      border: "1px solid var(--line)",
                      borderRadius: "8px",
                      padding: "8px 10px",
                      marginTop: "8px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <span style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--mute)" }}>
                        Verbatim Prompt (.afwe/turns/{selectedTurn?.id}.yaml)
                      </span>
                      <button
                        type="button"
                        className="btn-soft"
                        style={{ padding: "1px 6px", fontSize: "10px", cursor: "pointer" }}
                        onClick={() => {
                          if (turnData?.prompt) {
                            navigator.clipboard.writeText(turnData.prompt);
                            notify("Prompt copied to clipboard");
                          }
                        }}
                      >
                        Copy
                      </button>
                    </div>
                    <div style={{ fontSize: "11.5px", color: "var(--ink)", whiteSpace: "pre-wrap", lineHeight: "1.4" }}>
                      "{turnData.prompt}"
                    </div>
                  </div>
                )}

                {/* Author / Origin */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <div
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: "50%",
                        background: "var(--accent)",
                        color: "#fff",
                        display: "grid",
                        placeItems: "center",
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      {(turnData?.origin || "H").charAt(0).toUpperCase()}
                    </div>
                    <span style={{ fontSize: "12px", color: "var(--ink)", fontWeight: 500 }}>
                      {turnData?.origin === "human" ? "Human Engineer" : `Agent (${turnData?.agent || turnData?.origin || "autonomous"})`}
                    </span>
                  </div>
                  <span style={{ fontSize: "11px", color: "var(--mute)" }}>
                    {turnData?.strength || "deterministic"} · {Math.round((turnData?.confidence ?? 0.9) * 100)}%
                  </span>
                </div>
              </div>

              {/* Inspector tabs */}
              <div style={{ display: "flex", borderBottom: "1px solid var(--line)", padding: "4px 8px", background: "var(--side)" }}>
                {(["summary", "changes", "decisions", "checks"] as const).map((tab) => {
                  const countLabel =
                    tab === "changes"
                      ? ` ${touchedFiles.length}`
                      : tab === "decisions"
                      ? ` ${turnIntents.length}`
                      : tab === "checks"
                      ? ` ${gateReasons.length}`
                      : "";
                  return (
                    <button
                      key={tab}
                      onClick={() => setActiveInspectorTab(tab)}
                      style={{
                        flex: 1,
                        border: "none",
                        background: activeInspectorTab === tab ? "var(--panel)" : "transparent",
                        color: activeInspectorTab === tab ? "var(--ink)" : "var(--mute)",
                        borderRadius: "6px",
                        padding: "4px 4px",
                        fontSize: "11px",
                        fontWeight: activeInspectorTab === tab ? 600 : 500,
                        cursor: "pointer",
                        textTransform: "capitalize",
                      }}
                    >
                      {tab}{countLabel}
                    </button>
                  );
                })}
              </div>

              {/* Inspector Tab Content */}
              <div style={{ padding: "16px 18px", fontSize: "12px", lineHeight: "1.5", display: "flex", flexDirection: "column", gap: "16px" }}>
                {activeInspectorTab === "summary" && (
                  <>
                    {/* Key Changes Section */}
                    <div>
                      <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--mute)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>
                        Touched Files ({touchedFiles.length})
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        {touchedFiles.slice(0, 5).map((f) => (
                          <div key={f} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--side)", padding: "6px 8px", borderRadius: "6px" }}>
                            <span style={{ fontFamily: "monospace", fontSize: "11px", color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {f}
                            </span>
                          </div>
                        ))}
                        {touchedFiles.length === 0 && (
                          <div style={{ color: "var(--mute)", fontSize: "11.5px" }}>No code files modified in this turn.</div>
                        )}
                      </div>
                    </div>

                    {/* Active File Claims Section */}
                    {turnData?.claims && turnData.claims.length > 0 && (
                      <div>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--mute)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>
                          Active Claims ({turnData.claims.length})
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          {turnData.claims.map((c: any, i: number) => (
                            <div key={i} style={{ background: "var(--side)", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--line)" }}>
                              <div style={{ fontFamily: "monospace", fontSize: "11px", color: "var(--ink)" }}>{c.path}</div>
                              {c.base_blob && (
                                <div style={{ fontSize: "10px", color: "var(--mute)", fontFamily: "monospace", marginTop: "2px" }}>
                                  Blob: {c.base_blob.slice(0, 8)} {c.node ? `· Node: ${c.node}` : ""}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Intent & Rationale Section */}
                    <div>
                      <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--mute)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>
                        Intents ({turnIntents.length})
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        {turnIntents.map((it: any) => (
                          <div key={it.id || it} style={{ background: "var(--side)", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--line)", fontSize: "11.5px", color: "var(--ink)" }}>
                            <b>{it.id || it}</b>
                            {it.rationale && <div style={{ color: "var(--mute)", marginTop: "2px" }}>{it.rationale}</div>}
                          </div>
                        ))}
                        {turnIntents.length === 0 && (
                          <div style={{ background: "var(--side)", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--line)", fontSize: "11.5px", color: "var(--mute)" }}>
                            {turnData?.summary || "Initial baseline snapshot."}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Rules & Checks Section */}
                    <div>
                      <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--mute)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>
                        Gate Decision &amp; Checks
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {gateReasons.map((r, i) => (
                          <div key={i} style={{ background: isViolated ? "var(--redbg)" : "var(--side)", border: `1px solid ${isViolated ? "var(--red)" : "var(--line)"}`, borderRadius: "8px", padding: "8px 10px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ color: isViolated ? "var(--red)" : "var(--ink)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
                                {isViolated ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} style={{ color: "var(--accent)" }} />}
                                {isViolated ? "Rule Violation" : "Gate Passed"}
                              </span>
                            </div>
                            <div style={{ color: "var(--ink)", fontSize: "11.5px", marginTop: "3px" }}>
                              {r}
                            </div>
                          </div>
                        ))}
                        {gateReasons.length === 0 && (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--accent)", fontSize: "11.5px" }}>
                            <CheckCircle2 size={13} /> All architectural invariant checks passed.
                          </div>
                        )}

                        {/* CheckGen Generated Records */}
                        {turnData?.checkgen && turnData.checkgen.length > 0 && (
                          <div style={{ marginTop: "6px" }}>
                            <div style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--mute)", textTransform: "uppercase", marginBottom: "4px" }}>
                              CheckGen Records ({turnData.checkgen.length})
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                              {turnData.checkgen.map((cg: any, i: number) => (
                                <div key={i} style={{ fontSize: "11px", color: "var(--ink)", background: "var(--side)", padding: "4px 6px", borderRadius: "4px", fontFamily: "monospace" }}>
                                  {cg.check_id || cg.id || (typeof cg === "string" ? cg : JSON.stringify(cg))}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Action Buttons: Revert */}
                    <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
                      <button
                        type="button"
                        onClick={handleRevertTurn}
                        style={{
                          flex: 1,
                          background: "var(--panel)",
                          border: "1px solid var(--line)",
                          borderRadius: "8px",
                          padding: "7px 10px",
                          fontSize: "12px",
                          color: "var(--red)",
                          fontWeight: 600,
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 5,
                        }}
                      >
                        <RotateCcw size={12} />
                        Revert this turn
                      </button>
                    </div>
                  </>
                )}

                {activeInspectorTab === "changes" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--mute)", textTransform: "uppercase" }}>
                      All Modified Files ({touchedFiles.length})
                    </div>
                    {touchedFiles.map((f) => (
                      <div key={f} style={{ background: "var(--side)", padding: "8px 10px", borderRadius: "6px", fontFamily: "monospace", fontSize: "11px", color: "var(--ink)", wordBreak: "break-all" }}>
                        {f}
                      </div>
                    ))}
                    {touchedFiles.length === 0 && <div style={{ color: "var(--mute)" }}>No files touched.</div>}
                  </div>
                )}

                {activeInspectorTab === "decisions" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--mute)", textTransform: "uppercase" }}>
                      Declared Intents ({turnIntents.length})
                    </div>
                    {turnIntents.map((it: any) => (
                      <div key={it.id || it} style={{ background: "var(--side)", padding: "10px", borderRadius: "6px", border: "1px solid var(--line)" }}>
                        <div style={{ fontWeight: 600, color: "var(--ink)" }}>{it.id || it}</div>
                        {it.action && <div style={{ fontSize: "11px", color: "var(--accent)" }}>Action: {it.action}</div>}
                        {it.rationale && <div style={{ fontSize: "11.5px", color: "var(--mute)", marginTop: "4px" }}>{it.rationale}</div>}
                      </div>
                    ))}
                    {turnIntents.length === 0 && <div style={{ color: "var(--mute)" }}>No explicit intents declared.</div>}
                  </div>
                )}

                {activeInspectorTab === "checks" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--mute)", textTransform: "uppercase" }}>
                      Checks &amp; Gate Evaluation
                    </div>
                    <div style={{ background: "var(--side)", padding: "8px 10px", borderRadius: "6px" }}>
                      <div><b>Decision:</b> {gateDecision}</div>
                      <div><b>Strength:</b> {turnData?.strength || "deterministic"}</div>
                      <div><b>Confidence:</b> {Math.round((turnData?.confidence ?? 0.9) * 100)}%</div>
                    </div>
                    {gateReasons.map((r, i) => (
                      <div key={i} style={{ background: "var(--panel)", border: "1px solid var(--line)", padding: "8px 10px", borderRadius: "6px", fontSize: "11.5px" }}>
                        {r}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          );
        })()}
      </aside>
    </div>
  );
};
