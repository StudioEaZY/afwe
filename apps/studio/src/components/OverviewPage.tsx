import React, { useMemo, useState } from "react";
import { Lock, AlertTriangle } from "lucide-react";
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
import { NodeInspector } from "./NodeInspector";

const CURATED_ANCHOR_OPTIONS: { group: string; items: { value: string; label: string }[] }[] = [
  {
    group: "Subnodes (Direct Node-Level Links)",
    items: [
      { value: "Backend/events/models", label: "Backend › events › models (Rich hub)" },
      { value: "Services/jobs/auth", label: "Services › jobs › auth" },
      { value: "Data/schema", label: "Data › schema (Cycle + Violation)" },
      { value: "Web/views", label: "Web › views (Violation)" },
      { value: "Web/views/checkout", label: "Web › views › checkout" },
      { value: "Backend/api/routes", label: "Backend › api › routes" },
      { value: "Backend/auth", label: "Backend › auth" },
    ],
  },
  {
    group: "Subnodes (Parent-Level Fallback)",
    items: [
      { value: "Backend/billing/webhooks", label: "Backend › billing › webhooks (Fallback demo)" },
      { value: "Data/legacy_etl", label: "Data › legacy_etl (Unmapped fallback)" },
    ],
  },
  {
    group: "Top-Level Domains",
    items: [
      { value: "Backend", label: "Backend (Domain)" },
      { value: "Services", label: "Services (Domain)" },
      { value: "Data", label: "Data (Domain)" },
      { value: "Core", label: "Core (Domain)" },
      { value: "Web", label: "Web (Domain)" },
      { value: "Mobile", label: "Mobile (Domain)" },
      { value: "Shared", label: "Shared (Domain)" },
      { value: "Infrastructure", label: "Infrastructure (Domain)" },
    ],
  },
];

export const OverviewPage: React.FC = () => {
  const {
    graph,
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
  } = useStore();

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

  // Resolve current Constellation anchor node & fallback status for header/breadcrumbs
  const constellationHeaderCtx = useMemo(() => {
    const req =
      findNodeById(rootHierarchy, constellationAnchorKey) ||
      findNodeById(rootHierarchy, "Backend/events/models") ||
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
      : "How does the architecture flow, and where are the forbidden paths?";

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
    return "Layered architectural flow from Presentation (top) down to Foundation (bottom). Red upward arrows highlight forbidden dependencies that violate tier boundaries.";
  }, [activeLens, focusNode, constellationHeaderCtx]);

  // Check if current constellation anchor is in CURATED_ANCHOR_OPTIONS
  const isAnchorInPresetList = useMemo(() => {
    const key = constellationHeaderCtx.req.key;
    return CURATED_ANCHOR_OPTIONS.some((g) => g.items.some((item) => item.value === key));
  }, [constellationHeaderCtx]);

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

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Main Center Stage Column */}
      <main style={{ flex: 1, padding: "20px 24px", minWidth: 0, overflowY: "auto" }}>
        {/* Breadcrumbs (#crumbs) */}
        <div className="crumbs">
          {activeLens === "radial" && breadcrumbs.length > 0 && (
            <>
              <b onClick={() => setScope(null)}>Codebase</b>
              {breadcrumbs.map((crumb, idx) => (
                <React.Fragment key={crumb.id}>
                  {" › "}
                  {idx < breadcrumbs.length - 1 ? (
                    <b onClick={() => setScope(crumb.id)}>{crumb.label}</b>
                  ) : (
                    <span>{crumb.label}</span>
                  )}
                </React.Fragment>
              ))}
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
        </div>

        {/* Headline Row + 3-Mode Segmented Switcher */}
        <div className="headline">
          <div className="title-block">
            <h1 className="serif">Codebase Overview</h1>
            <span className="view-question">{viewQuestion}</span>
          </div>

          <div className="seg" role="tablist" aria-label="View mode">
            <button
              type="button"
              className={activeLens === "radial" ? "on" : ""}
              onClick={() => setActiveLens("radial")}
            >
              Atlas (Radial)
            </button>
            <button
              type="button"
              className={activeLens === "constellation" ? "on" : ""}
              onClick={() => {
                if (selectedNode) {
                  setConstellationAnchor(selectedNode.key);
                }
                setActiveLens("constellation");
              }}
            >
              Constellation
            </button>
            <button
              type="button"
              className={activeLens === "topology" ? "on" : ""}
              onClick={() => setActiveLens("topology")}
            >
              Topology
            </button>
          </div>
        </div>

        {/* Dynamic Subtitle (#sub) */}
        <p className="sub">{subtitle}</p>

        {/* Unified Filter & Mode Controls Bar (.bar) */}
        <div className="bar">
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

          <div className="sp" style={{ flex: 1 }} />

          {/* Radial-Only Controls (#radCtl) */}
          {activeLens === "radial" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span
                className="ctl"
                title="How many nested rings to show inside the current map"
              >
                Depth in this map
                <button
                  type="button"
                  onClick={() => setRadialDepth((d) => Math.max(1, d - 1))}
                >
                  −
                </button>
                <b>{radialDepth}</b>
                <button
                  type="button"
                  onClick={() => setRadialDepth((d) => Math.min(4, d + 1))}
                >
                  +
                </button>
              </span>

              <button
                type="button"
                className={`ctl toggle ${growth ? "on" : ""}`}
                onClick={() => setGrowth((g) => !g)}
                title="Scale outer rings with the timeline slider"
              >
                Growth: <b>{growth ? "On" : "Off"}</b>
              </button>

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
                  {CURATED_ANCHOR_OPTIONS.map((grp) => (
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
        </div>

        {/* Active Map Stage */}
        {activeLens === "radial" && (
          <RadialMap
            root={rootHierarchy}
            focusNode={focusNode}
            depth={radialDepth}
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

        {/* Bottom Legend & Rewind Timeline Scrubber (.foot) */}
        <div className="foot">
          <span className="leg">
            <i className="sw" style={{ background: "var(--mapped)" }} />
            Mapped
          </span>
          <span className="leg">
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
          <span className="leg">
            <i
              className="sw"
              style={{
                background:
                  "repeating-linear-gradient(45deg,var(--unm) 0 3px,var(--hatch) 3px 5px)",
              }}
            />
            Unmapped
          </span>
          <span className="leg">
            <i className="sw" style={{ background: "var(--legacy)" }} />
            Legacy
          </span>
          <span className="leg">
            <Lock size={12} style={{ color: "var(--ink)" }} />
            Pinned check
          </span>
          <span className="leg">
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
            Pending proposal
          </span>
          <span className="leg">
            <i
              style={{
                width: 16,
                borderTop: "2px dashed var(--red)",
                display: "inline-block",
              }}
            />
            <AlertTriangle size={12} style={{ color: "var(--red)" }} />
            Rule violation
          </span>

          <div className="tl">
            {activeLens === "constellation" && constellationScope === "two" && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                Compare from
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(compareT * 100)}
                  onChange={(e) => setCompareT(Number(e.target.value) / 100)}
                />
              </span>
            )}
            <span>Rewind</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(overviewTimelineT * 100)}
              onChange={(e) => setOverviewTimelineT(Number(e.target.value) / 100)}
            />
            <b style={{ minWidth: 38, color: "var(--ink)" }}>{timelineLabel}</b>
          </div>
        </div>
      </main>

      {/* Right Context Inspector (.side-inspector) */}
      <NodeInspector />
    </div>
  );
};
