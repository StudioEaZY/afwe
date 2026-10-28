import React, { useMemo, useState, useEffect } from "react";
import { Lock, AlertTriangle, Disc3, Layers, Boxes } from "lucide-react";
import { useStore, FilterMode, ConstellationScope } from "../store";
import {
  buildHierarchyTree,
  buildDirectedEdges,
  findNodeById,
  getDomainNode,
  HierarchyNode,
} from "../lib/hierarchy";
import { RadialMap } from "./RadialMap";
import { ConstellationMap } from "./ConstellationMap";
import { TopologyMap } from "./TopologyMap";
import { GraphView } from "./GraphView";
import { NodeInspector } from "./NodeInspector";
import { TimelineDualScrubber, TimelineTurnItem } from "./TimelineDualScrubber";
import { ConstellationGlyph } from "../lib/lucideSvgPaths";

export const OverviewPage: React.FC = () => {
  const {
    graph,
    timelineFrames,
    refreshScene,
    activeLens,
    currentScopeId,
    constellationAnchorKey,
    constellationScope,
    forceParentFallback,
    overviewTimelineT,
    selectedEntity,
    filterMode,
    setActiveLens,
    setConstellationAnchor,
    openConstellationFor,
    setConstellationScope,
    setForceParentFallback,
    setOverviewTimelineT,
    drillDown,
    drillUp,
    setScope,
    selectEntity,
    setFilterMode,
    showImpl,
    setShowImpl,
  } = useStore();

  useEffect(() => {
    refreshScene();
  }, [refreshScene]);

  // Radial-specific view controls matching AFWE Codebase Atlas
  const [radialDepth, setRadialDepth] = useState<number>(3);
  const [growth, setGrowth] = useState<boolean>(false);
  const [denseL4, setDenseL4] = useState<boolean>(false);

  // Constellation-specific controls
  const [compareT, setCompareT] = useState<number>(0.35);
  const [neighborhoodExpanded, setNeighborhoodExpanded] = useState<boolean>(false);

  // Build full hierarchy tree & directed edge sets from backend graph
  const rootHierarchy = useMemo(() => buildHierarchyTree(graph), [graph]);
  const { domainEdges, nodeEdges } = useMemo(
    () => buildDirectedEdges(graph, rootHierarchy),
    [graph, rootHierarchy]
  );

  // Resolve current Radial focus node
  const focusNode: HierarchyNode = useMemo(() => {
    if (!currentScopeId) return rootHierarchy;
    return findNodeById(rootHierarchy, currentScopeId) || rootHierarchy;
  }, [rootHierarchy, currentScopeId]);

  // Dynamically calculate the maximum available tree depth under the current focus node
  const maxAvailableDepth = useMemo(() => {
    function computeSubtreeDepth(node: HierarchyNode): number {
      if (!node.children || node.children.length === 0) return 1;
      return 1 + Math.max(...node.children.map(computeSubtreeDepth));
    }
    const availableRings = computeSubtreeDepth(focusNode) - 1;
    return Math.max(1, Math.min(6, availableRings));
  }, [focusNode]);

  // Autoscale depth if current depth exceeds available depth in this focus subtree
  const effectiveRadialDepth = Math.min(radialDepth, maxAvailableDepth);

  // Resolve current Constellation anchor node & fallback status for header/breadcrumbs
  const constellationHeaderCtx = useMemo(() => {
    const req =
      findNodeById(rootHierarchy, constellationAnchorKey) ||
      findNodeById(rootHierarchy, "Backend.events.models") ||
      rootHierarchy.children[0] ||
      rootHierarchy;
    const isDom = req.depth <= 1;
    const hasDirect = isDom
      ? true
      : nodeEdges.some((e) => e.a === req.key || e.b === req.key);
    const isFallback = !isDom && (!hasDirect || forceParentFallback);
    const eff = isDom || isFallback ? getDomainNode(rootHierarchy, req) : req;
    return { req, eff, isDom, isFallback };
  }, [rootHierarchy, constellationAnchorKey, nodeEdges, forceParentFallback]);

  // Breadcrumb trail for Radial drill-down
  const breadcrumbs = useMemo(() => {
    const trail: HierarchyNode[] = [];
    let curr: HierarchyNode | null = focusNode;
    while (curr && curr.id !== "root") {
      trail.unshift(curr);
      curr = curr.parentId ? findNodeById(rootHierarchy, curr.parentId) : null;
    }
    return trail;
  }, [rootHierarchy, focusNode]);

  // Adaptive Legend Indicator Counts (pruning 0-count swatches)
  const indicatorCounts = useMemo(() => {
    let pinCount = 0;
    let propCount = 0;
    let legacyCount = 0;

    const countNode = (n: HierarchyNode) => {
      if ((n.birth || 0) > overviewTimelineT) return;
      if (n.hasPin) pinCount++;
      if (n.hasProposal) propCount++;
      if (n.state === "legacy") legacyCount++;
      (n.children || []).forEach(countNode);
    };
    countNode(rootHierarchy);

    // Canonical violation count matching TopBar shell
    const violationsCount = (graph?.code_edges || []).filter((e: any) => Boolean(e.violation)).length;

    return {
      pins: pinCount,
      proposals: propCount,
      violations: violationsCount,
      legacy: legacyCount,
    };
  }, [rootHierarchy, graph, overviewTimelineT]);

  const selectedNode =
    selectedEntity && selectedEntity.kind !== "edge"
      ? selectedEntity.node || findNodeById(rootHierarchy, selectedEntity.key || selectedEntity.id)
      : null;

  // Dynamic guiding question pill (#viewQuestion)
  const viewQuestion =
    activeLens === "radial"
      ? "What's inside this part of the codebase?"
      : activeLens === "constellation"
      ? "What does this part depend on, and what depends on it?"
      : activeLens === "topology"
      ? "How does the architecture flow, and where are the forbidden paths?"
      : "What is the complete component tree DAG, and what files implement each domain?";

  // Dynamic subtitle (#sub)
  const subtitle = useMemo(() => {
    if (activeLens === "radial") {
      if (focusNode.depth > 0) {
        return `Viewing inside ${focusNode.path}/ (global depth ${focusNode.depth}). Rings show layers inside this sub-map. Click the centre disc or "Up one level" to zoom out.`;
      }
      return "A calm map of your codebase. Each ring shows depth inside the current map, and slice size reflects file count. Click any slice to inspect, or click Open map to zoom in.";
    }
    if (activeLens === "constellation") {
      const { req, eff, isDom, isFallback } = constellationHeaderCtx;
      if (isFallback) {
        return `Dependency field for ${req.breadcrumbLabels.join(
          " › "
        )} — showing parent module ${
          eff.label
        } because node-level links aren't charted for this subnode yet.`;
      }
      if (!isDom) {
        return `Dependency field for ${req.breadcrumbLabels.join(" › ")}. Left = what ${
          req.label
        } depends on; Right = what depends on ${
          req.label
        }. Click any node to inspect, or double-click to centre on it.`;
      }
      return `Domain-level dependency field for ${eff.label}. Left = dependencies; Right = consumers. Click any node to inspect or double-click to centre here.`;
    }
    if (activeLens === "topology") {
      return "Layered architectural flow from Presentation (top) down to Foundation (bottom). Red upward arrows highlight forbidden dependencies that violate tier boundaries.";
    }
    return "Complete architectural component DAG. Tree layout with leaf file inspection (showImpl), drag-and-drop reparenting, and constraint wiring.";
  }, [activeLens, focusNode, constellationHeaderCtx]);

  // Dynamically generated curated anchors from current hierarchy
  const curatedAnchorOptions = useMemo(() => {
    if (!rootHierarchy) return [];
    const domains = (rootHierarchy.children || []).map((c) => ({
      value: c.key,
      label: `${c.label} (Domain)`,
    }));

    const allSubnodes: HierarchyNode[] = [];
    const collect = (n: HierarchyNode) => {
      if (n.depth >= 2) allSubnodes.push(n);
      for (const child of n.children || []) collect(child);
    };
    collect(rootHierarchy);

    // Nodes with code edges / violations / pins
    const richNodes = allSubnodes
      .filter((n) => n.hasViolation || n.hasPin || n.fileCount >= 3)
      .slice(0, 10)
      .map((n) => ({
        value: n.key,
        label: `${n.breadcrumbLabels.join(" › ")}${n.hasViolation ? " (Violation)" : n.hasPin ? " (Pinned)" : ""}`,
      }));

    const otherNodes = allSubnodes
      .filter((n) => !richNodes.some((r) => r.value === n.key))
      .slice(0, 6)
      .map((n) => ({
        value: n.key,
        label: n.breadcrumbLabels.join(" › "),
      }));

    const groups: { group: string; items: { value: string; label: string }[] }[] = [];
    if (richNodes.length > 0) {
      groups.push({ group: "Subnodes (Direct Node-Level Links)", items: richNodes });
    }
    if (otherNodes.length > 0) {
      groups.push({ group: "Subnodes (Structural & Fallback)", items: otherNodes });
    }
    if (domains.length > 0) {
      groups.push({ group: "Top-Level Domains", items: domains });
    }
    return groups;
  }, [rootHierarchy]);

  // Check if current constellation anchor is in curated options
  const isAnchorInPresetList = useMemo(() => {
    const key = constellationHeaderCtx.req.key;
    return curatedAnchorOptions.some((g) => g.items.some((item) => item.value === key));
  }, [constellationHeaderCtx, curatedAnchorOptions]);

  const handleToggleLayer4Splits = () => {
    const next = !denseL4;
    setDenseL4(next);
    if (next && radialDepth < 4) {
      setRadialDepth(4);
    }
  };

  // Timeline label formatting matching AFWE Codebase Atlas
  const timelineLabel = useMemo(() => {
    if (activeLens === "constellation" && constellationScope === "two") {
      return `${Math.round(compareT * 100)}% → ${Math.round(overviewTimelineT * 100)}%`;
    }
    return overviewTimelineT >= 0.99
      ? "Now"
      : `-${Math.round((1 - overviewTimelineT) * 90)}d`;
  }, [activeLens, constellationScope, compareT, overviewTimelineT]);

  // Map timeline frames to TimelineTurnItem list for TimelineDualScrubber
  const scrubberItems: TimelineTurnItem[] = useMemo(() => {
    if (timelineFrames && timelineFrames.length > 0) {
      return timelineFrames.map((f, idx) => ({
        id: f.turn,
        number: idx + 1,
        label: f.summary || f.prompt || `Turn #${f.turn}`,
        date: f.ts ? new Date(f.ts).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : `Turn ${idx + 1}`,
        status: (f.status === "failed" ? "failed" : f.status === "ready" || f.status === "staged" ? "staged" : "committed") as any,
        hasPin: f.pin_proposals > 0,
        hasViolation: f.checks_count > 0,
      }));
    }
    return [
      { id: "t0001", number: 1, label: "Initial Architecture", date: "Start", status: "committed" },
      { id: "t0010", number: 2, label: "Core Services", date: "Core", status: "committed", hasPin: true },
      { id: "t0020", number: 3, label: "API & Data Layers", date: "Data", status: "committed" },
      { id: "t0030", number: 4, label: "Presentation & Web", date: "Web", status: "committed", hasViolation: true },
      { id: "t0040", number: 5, label: "Current Head", date: "Now", status: "committed" },
    ] as TimelineTurnItem[];
  }, [timelineFrames]);

  const activeTurnId = useMemo(() => {
    if (scrubberItems.length === 0) return null;
    const idx = Math.min(
      scrubberItems.length - 1,
      Math.max(0, Math.round(overviewTimelineT * (scrubberItems.length - 1)))
    );
    return scrubberItems[idx]?.id || null;
  }, [scrubberItems, overviewTimelineT]);

  const handleSelectTurn = (turnId: string) => {
    const idx = scrubberItems.findIndex((t) => t.id === turnId);
    if (idx >= 0 && scrubberItems.length > 1) {
      setOverviewTimelineT(idx / (scrubberItems.length - 1));
    }
  };

  const scrubberRange: [number, number] = useMemo(() => {
    if (activeLens === "constellation" && constellationScope === "two") {
      return [compareT, overviewTimelineT];
    }
    return [Math.max(0, overviewTimelineT - 0.2), overviewTimelineT];
  }, [activeLens, constellationScope, compareT, overviewTimelineT]);

  const handleRangeChange = (newRange: [number, number]) => {
    if (activeLens === "constellation" && constellationScope === "two") {
      setCompareT(newRange[0]);
      setOverviewTimelineT(newRange[1]);
    } else {
      setOverviewTimelineT(newRange[1]);
    }
  };

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Main Center Stage Column */}
      <main style={{ flex: 1, padding: "16px 22px", minWidth: 0, overflowY: "auto" }}>
        {/* Breadcrumbs (#crumbs) */}
        <div className="crumbs">
          {activeLens === "radial" && (
            <>
              {breadcrumbs.length === 0 ? (
                <b onClick={() => setScope(null)}>Overview</b>
              ) : (
                <>
                  <a onClick={() => setScope(null)}>Overview</a>
                  {breadcrumbs.map((crumb, idx) => (
                    <React.Fragment key={crumb.id}>
                      {" › "}
                      {idx < breadcrumbs.length - 1 ? (
                        <a onClick={() => setScope(crumb.id)}>{crumb.label}</a>
                      ) : (
                        <b>{crumb.label}</b>
                      )}
                    </React.Fragment>
                  ))}
                </>
              )}
            </>
          )}

          {activeLens === "constellation" && (
            <span>
              Constellation · Anchor:{" "}
              <b onClick={() => selectEntity({
                id: constellationHeaderCtx.req.id,
                key: constellationHeaderCtx.req.key,
                kind: constellationHeaderCtx.req.kind,
                label: constellationHeaderCtx.req.label,
                path: constellationHeaderCtx.req.path,
                status: "mapped",
                state: constellationHeaderCtx.req.state,
                fileCount: constellationHeaderCtx.req.fileCount,
                node: constellationHeaderCtx.req,
              })}>
                {constellationHeaderCtx.req.breadcrumbLabels.join(" › ")}
              </b>
              {constellationHeaderCtx.isFallback && (
                <>
                  {" · Fallback: "}
                  <b>{constellationHeaderCtx.eff.label}</b>
                </>
              )}
            </span>
          )}

          {activeLens === "topology" && (
            <span>Architectural Topology · 4-Tier Layered View</span>
          )}

          {activeLens === "blueprint" && (
            <span>Architectural Blueprint · Full Component Tree DAG</span>
          )}
        </div>

        {/* Headline Row + 4-Mode Compact Icon-Segmented Switcher */}
        <div className="headline">
          <div className="title-block">
            <h1 className="serif">Codebase Overview</h1>
            <span className="view-question">{viewQuestion}</span>
          </div>

          <div className="seg" role="tablist" aria-label="View mode">
            {[
              {
                id: "radial" as const,
                label: "Radial",
                icon: <Disc3 size={14} strokeWidth={2} />,
              },
              {
                id: "constellation" as const,
                label: "Constellation",
                icon: <ConstellationGlyph size={14} />,
              },
              {
                id: "topology" as const,
                label: "Topology",
                icon: <Layers size={14} strokeWidth={2} />,
              },
              {
                id: "blueprint" as const,
                label: "Blueprint",
                icon: <Boxes size={14} strokeWidth={2} />,
              },
            ].map((item) => {
              const isActive = activeLens === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={isActive ? "on" : ""}
                  onClick={() => {
                    if (item.id === "constellation" && selectedNode) {
                      setConstellationAnchor(selectedNode.key);
                    }
                    setActiveLens(item.id);
                  }}
                  title={`${item.label} view`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: isActive ? "6px" : "0px",
                    padding: isActive ? "5px 12px" : "5px 9px",
                    transition: "all 0.16s ease-in-out",
                  }}
                >
                  {item.icon}
                  {isActive && (
                    <span style={{ fontWeight: 600, fontSize: "12px", whiteSpace: "nowrap" }}>
                      {item.label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Dynamic Subtitle (#sub) */}
        <p className="sub">{subtitle}</p>

        {/* Unified Filter & Mode Controls Bar (.bar) */}
        <div className="bar">
          {/* Up One Level button when zoomed into Radial */}
          {activeLens === "radial" && focusNode.depth > 0 && (
            <button type="button" className="chip" onClick={drillUp}>
              ‹ Up one level
            </button>
          )}

          {/* Primary Open Map button in Radial when a parent node is selected */}
          {activeLens === "radial" &&
            selectedNode &&
            selectedNode.children &&
            selectedNode.children.length > 0 &&
            selectedNode.id !== focusNode.id && (
              <button
                type="button"
                className="btn-soft primary"
                onClick={() => drillDown(selectedNode.id)}
                title="Make the selected slice the new centre of the radial map"
              >
                Open map
              </button>
            )}

          {/* Radial-Only Controls (#radCtl) */}
          {activeLens === "radial" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span
                className="ctl"
                title={`Controls how many concentric folder tiers are projected simultaneously (1 to ${maxAvailableDepth} available in this subtree)`}
              >
                Depth in this map
                <button
                  type="button"
                  onClick={() => setRadialDepth((d) => Math.max(1, Math.min(d, maxAvailableDepth) - 1))}
                  title="Decrease depth"
                  disabled={effectiveRadialDepth <= 1}
                >
                  −
                </button>
                <b>{effectiveRadialDepth}</b>
                <button
                  type="button"
                  onClick={() => setRadialDepth((d) => Math.min(maxAvailableDepth, d + 1))}
                  title="Increase depth"
                  disabled={effectiveRadialDepth >= maxAvailableDepth}
                >
                  +
                </button>
              </span>

              <button
                type="button"
                className={`ctl toggle ${denseL4 ? "on" : ""}`}
                onClick={handleToggleLayer4Splits}
                title="Split Layer 3 modules into finer Layer 4 sub-slices"
              >
                Layer 4 splits: <b>{denseL4 ? "On" : "Off"}</b>
              </button>
            </div>
          )}

          {/* Constellation-Only Controls (#conCtl) */}
          {activeLens === "constellation" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <div className="seg" title="Relationship scope">
                {(
                  [
                    { id: "node", label: "This node" },
                    { id: "map", label: "Whole map" },
                    { id: "two", label: "Two moments" },
                  ] as { id: ConstellationScope; label: string }[]
                ).map((sc) => (
                  <button
                    key={sc.id}
                    type="button"
                    className={constellationScope === sc.id ? "on" : ""}
                    onClick={() => setConstellationScope(sc.id)}
                  >
                    {sc.label}
                  </button>
                ))}
              </div>

              <label className="ctl">
                Anchor
                <select
                  value={constellationHeaderCtx.req.key}
                  onChange={(e) => {
                    const key = e.target.value;
                    setConstellationAnchor(key);
                    const n = findNodeById(rootHierarchy, key);
                    if (n) {
                      selectEntity({
                        id: n.id,
                        key: n.key,
                        kind: n.kind,
                        label: n.label,
                        path: n.path,
                        status: n.hasViolation ? "violation" : "mapped",
                        state: n.state,
                        fileCount: n.fileCount,
                        node: n,
                      });
                    }
                  }}
                >
                  {!isAnchorInPresetList && (
                    <optgroup label="Selected Node">
                      <option value={constellationHeaderCtx.req.key}>
                        {constellationHeaderCtx.req.breadcrumbLabels.join(" › ")}
                      </option>
                    </optgroup>
                  )}
                  {curatedAnchorOptions.map((grp) => (
                    <optgroup key={grp.group} label={grp.group}>
                      {grp.items.map((it) => (
                        <option key={it.value} value={it.value}>
                          {it.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>

              <button
                type="button"
                className={`ctl toggle ${forceParentFallback ? "on" : ""}`}
                onClick={() => setForceParentFallback(!forceParentFallback)}
                title="Simulate missing node-level dependency data to inspect the honest parent-level fallback behavior"
              >
                Granularity:{" "}
                <b>{forceParentFallback ? "Parent fallback" : "Actual node links"}</b>
              </button>

              <button
                type="button"
                className={`ctl toggle ${neighborhoodExpanded ? "on" : ""}`}
                onClick={() => setNeighborhoodExpanded((v) => !v)}
                title="Toggle between direct neighbors only (1 hop) and indirect neighbors (2 hops)"
              >
                Neighborhood:{" "}
                <b>{neighborhoodExpanded ? "Expand next step" : "Direct only"}</b>
              </button>
            </div>
          )}

          {/* Blueprint-Only Controls (#bpCtl) */}
          {activeLens === "blueprint" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                className={`ctl toggle ${showImpl ? "on" : ""}`}
                onClick={() => setShowImpl(!showImpl)}
                title="Reveal implementing files underneath each domain and subsystem node"
              >
                Show Implementation: <b>{showImpl ? "On" : "Off"}</b>
              </button>
            </div>
          )}

          <div className="sp" style={{ flex: 1 }} />

          {/* Right-Aligned Filter Mode Chips (positioned under the View switcher) */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {(
              [
                { id: "all", label: "All" },
                { id: "mapped", label: "Mapped" },
                { id: "inferred", label: "Inferred" },
                { id: "unmapped", label: "Unmapped" },
                { id: "legacy", label: "Legacy" },
              ] as { id: FilterMode; label: string }[]
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                className={`chip ${
                  filterMode === f.id || (f.id === "unmapped" && filterMode === "uncharted")
                    ? "on"
                    : ""
                }`}
                onClick={() => setFilterMode(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Active Map Stage */}
        {activeLens === "radial" && (
          <RadialMap
            root={rootHierarchy}
            focusNode={focusNode}
            depth={effectiveRadialDepth}
            growth={growth}
            denseL4={denseL4}
            timelineT={overviewTimelineT}
            selectedEntity={selectedEntity}
            filterMode={filterMode}
            onSelectEntity={selectEntity}
            onDrillDown={drillDown}
            onDrillUp={drillUp}
            onOpenConstellation={(nodeKey) => openConstellationFor(nodeKey)}
          />
        )}

        {activeLens === "constellation" && (
          <ConstellationMap
            root={rootHierarchy}
            anchorKey={constellationAnchorKey}
            domainEdges={domainEdges}
            nodeEdges={nodeEdges}
            scope={constellationScope}
            forceParentFallback={forceParentFallback}
            timelineT={overviewTimelineT}
            compareT={compareT}
            neighborhoodExpanded={neighborhoodExpanded}
            filterMode={filterMode}
            selectedEntity={selectedEntity}
            onSelectEntity={selectEntity}
            onSetAnchor={(nodeKey) => setConstellationAnchor(nodeKey)}
            onSetForceParentFallback={setForceParentFallback}
            onOpenInRadial={(nodeId) => {
              setActiveLens("radial");
              drillDown(nodeId);
            }}
          />
        )}

        {activeLens === "topology" && (
          <TopologyMap
            timelineT={overviewTimelineT}
            onSelectEntity={selectEntity}
            onDrillDown={(nodeId) => {
              setActiveLens("radial");
              drillDown(nodeId);
            }}
            onOpenConstellation={(nodeKey) => openConstellationFor(nodeKey)}
          />
        )}

        {activeLens === "blueprint" && (
          <div
            style={{
              height: "640px",
              width: "100%",
              borderRadius: "10px",
              overflow: "hidden",
              border: "1px solid var(--line)",
              position: "relative",
              background: "var(--bg)",
            }}
          >
            <GraphView timelineT={overviewTimelineT} />
          </div>
        )}

        {/* Unified Interactive Dual Timeline Scrubber */}
        <div style={{ marginTop: "12px", marginBottom: "4px" }}>
          <TimelineDualScrubber
            turns={scrubberItems}
            selectedTurnId={activeTurnId}
            onSelectTurn={handleSelectTurn}
            range={scrubberRange}
            onRangeChange={handleRangeChange}
            compact={true}
          />
        </div>

        {/* Bottom Legend (.foot) */}
        <div className="foot" style={{ marginTop: "4px" }}>
          <span className="leg" title="Files mapped to declared blueprint domains with verified boundaries and rules">
            <i className="sw" style={{ background: "var(--mapped)" }} />
            Mapped
          </span>
          <span className="leg" title="Inferred module boundaries automatically detected from folder structures and imports">
            <i
              className="sw"
              style={{
                background: "var(--inferred)",
                borderStyle: "dashed",
                borderColor: "var(--amber)",
              }}
            />
            Inferred
          </span>
          <span className="leg" title="Uncharted area. Hatched slices have not been charted into a blueprint domain yet.">
            <i
              className="sw"
              style={{
                background:
                  "repeating-linear-gradient(45deg,var(--unm) 0 3px,var(--hatch) 3px 5px)",
              }}
            />
            Unmapped (?)
          </span>
          {indicatorCounts.legacy > 0 && (
            <span className="leg" title={`Legacy subsystems maintained with quarantine boundaries (${indicatorCounts.legacy})`}>
              <i className="sw" style={{ background: "var(--legacy)" }} />
              Legacy ({indicatorCounts.legacy})
            </span>
          )}
          {indicatorCounts.pins > 0 && (
            <span className="leg" title={`Lock icon: Enforced invariant rule strictly checked before commit (${indicatorCounts.pins})`}>
              <Lock size={12} style={{ color: "var(--ink)" }} />
              Pinned check ({indicatorCounts.pins})
            </span>
          )}
          {indicatorCounts.proposals > 0 && (
            <span className="leg" title={`Amber ! badge: Pending proposal awaiting review or confirmation (${indicatorCounts.proposals})`}>
              <span
                style={{
                  display: "inline-grid",
                  placeItems: "center",
                  width: 13,
                  height: 13,
                  borderRadius: "50%",
                  background: "var(--amber)",
                  color: "#fff",
                  fontSize: 9,
                  fontWeight: 700,
                }}
              >
                !
              </span>
              Pending proposal ({indicatorCounts.proposals})
            </span>
          )}
          {indicatorCounts.violations > 0 && (
            <span className="leg" title={`Red triangle: Boundary violation detected between architectural subsystems (${indicatorCounts.violations})`}>
              <i
                style={{
                  width: 16,
                  borderTop: "2px dashed var(--red)",
                  display: "inline-block",
                }}
              />
              <AlertTriangle size={12} style={{ color: "var(--red)" }} />
              Rule violation ({indicatorCounts.violations})
            </span>
          )}

          <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: "11px", color: "var(--mute)" }}>Point in time:</span>
            <b style={{ minWidth: 38, color: "var(--ink)", fontSize: "11px" }}>{timelineLabel}</b>
          </div>
        </div>
      </main>

      {/* Right Context Inspector (.side-inspector) */}
      <NodeInspector />
    </div>
  );
};
