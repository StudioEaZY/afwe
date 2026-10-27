import React, { useMemo } from "react";
import {
  Globe,
  Smartphone,
  Settings,
  Server,
  Layers,
  Database,
  Share2,
  Cloud,
  AlertTriangle,
  ArrowRight,
  Lock,
  FileCode,
} from "lucide-react";
import { useStore } from "../store";
import {
  buildHierarchyTree,
  buildDirectedEdges,
  findNodeById,
  getDomainNode,
  computeNodeFlags,
  hasBlueprintLinks,
  stateDescription,
  shortLabel,
  HierarchyNode,
} from "../lib/hierarchy";

function renderDomainLucideIcon(iconKey?: string) {
  switch (iconKey) {
    case "web":
      return <Globe size={18} />;
    case "phone":
      return <Smartphone size={18} />;
    case "gear":
      return <Settings size={18} />;
    case "srv":
      return <Server size={18} />;
    case "db":
      return <Database size={18} />;
    case "link":
      return <Share2 size={18} />;
    case "cloud":
      return <Cloud size={18} />;
    case "layers":
    default:
      return <Layers size={18} />;
  }
}

export const NodeInspector: React.FC = () => {
  const {
    graph,
    activeLens,
    currentScopeId,
    constellationAnchorKey,
    forceParentFallback,
    overviewTimelineT,
    selectedEntity,
    selectEntity,
    drillDown,
    drillUp,
    setActiveLens,
    setConstellationAnchor,
    openConstellationFor,
    openCodePreview,
  } = useStore();

  const root = useMemo(() => buildHierarchyTree(graph), [graph]);
  const { domainEdges, nodeEdges } = useMemo(
    () => buildDirectedEdges(graph, root),
    [graph, root]
  );

  const focusNode = useMemo(() => {
    if (!currentScopeId) return root;
    return findNodeById(root, currentScopeId) || root;
  }, [root, currentScopeId]);

  // 1. Edge Inspection Mode (when selectedEntity.kind === "edge")
  if (selectedEntity && selectedEntity.kind === "edge" && selectedEntity.edgeData) {
    const e = selectedEntity.edgeData;
    const nFrom = findNodeById(root, e.a);
    const nTo = findNodeById(root, e.b);
    const isNodeEdge = e.a.includes("/") || e.b.includes("/");

    const inspectEndpoint = (n: HierarchyNode | null, fallbackKey: string) => {
      if (!n) return;
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
    };

    return (
      <aside className="side-inspector" aria-label="Inspector">
        <div className="sh">
          <div
            className="ic"
            style={
              e.bad
                ? { borderColor: "var(--red)", color: "var(--red)" }
                : undefined
            }
          >
            {e.bad ? <AlertTriangle size={18} /> : <ArrowRight size={18} />}
          </div>
          <div>
            <h2 className="serif">
              {shortLabel(e.a)} → {shortLabel(e.b)}{" "}
              <span className={`st ${e.bad ? "s-violation" : "s-mapped"}`}>
                {e.bad ? "violation" : "allowed"}
              </span>
            </h2>
            <p>
              {isNodeEdge ? "Node-level" : "Domain-level"} directed dependency · Introduced at{" "}
              {Math.round((e.birth || 0.1) * 100)}% of timeline
            </p>
          </div>
        </div>

        <div className="sec">
          <h3>Direction &amp; Meaning</h3>
          <div className="row">
            <span>From (Consumer)</span>
            <b>{e.a}</b>
          </div>
          <div className="row">
            <span>To (Dependency)</span>
            <b>{e.b}</b>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--mute)" }}>
            <b>{e.a}</b> imports or calls interfaces exposed by <b>{e.b}</b>.
          </p>
        </div>

        {e.bad && (
          <div className="warn">
            <b>Rule violation</b>
            <br />
            {e.a} must not depend on {e.b}.<br />
            <span style={{ opacity: 0.85 }}>
              Suggested fix: invert dependency via an event or move shared types into Shared.
            </span>
          </div>
        )}

        <div className="sec">
          <h3>Inspect Endpoints</h3>
          {nFrom && (
            <div
              className="row click"
              onClick={() => inspectEndpoint(nFrom, e.a)}
            >
              <span>Inspect {e.a}</span>
              <span style={{ color: "var(--mute)" }}>
                {nFrom.fileCount} files · {nFrom.state}
              </span>
            </div>
          )}
          {nTo && (
            <div
              className="row click"
              onClick={() => inspectEndpoint(nTo, e.b)}
            >
              <span>Inspect {e.b}</span>
              <span style={{ color: "var(--mute)" }}>
                {nTo.fileCount} files · {nTo.state}
              </span>
            </div>
          )}
        </div>

        <div className="sec">
          <h3>Constellation Focus</h3>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
            <button
              type="button"
              className="btn-soft primary"
              onClick={() => openConstellationFor(e.a)}
            >
              Centre on {shortLabel(e.a)}
            </button>
            <button
              type="button"
              className="btn-soft"
              onClick={() => openConstellationFor(e.b)}
            >
              Centre on {shortLabel(e.b)}
            </button>
          </div>
        </div>
      </aside>
    );
  }

  // 2. Node Inspection Mode
  const activeNode: HierarchyNode = useMemo(() => {
    if (selectedEntity) {
      const found =
        selectedEntity.node ||
        findNodeById(root, selectedEntity.key || selectedEntity.id);
      if (found && found.id !== "root") return found;
    }
    if (activeLens === "constellation" && constellationAnchorKey) {
      const anchor = findNodeById(root, constellationAnchorKey);
      if (anchor && anchor.id !== "root") return anchor;
    }
    if (focusNode && focusNode.id !== "root") {
      return focusNode;
    }
    return root.children[0] || root;
  }, [selectedEntity, activeLens, constellationAnchorKey, focusNode, root]);

  const dom = useMemo(() => getDomainNode(root, activeNode), [root, activeNode]);
  const flags = useMemo(() => computeNodeFlags(activeNode), [activeNode]);

  // Determine layer & depth context string
  const layerInfo = useMemo(() => {
    const globalD = activeNode.depth;
    if (activeLens === "radial") {
      if (focusNode.depth > 0 && activeNode.id === focusNode.id) {
        return `Current map root (Global depth ${globalD})`;
      }
      const relD = globalD - focusNode.depth;
      if (relD > 0) {
        return `Layer ${relD} in this map${
          focusNode.depth > 0 ? ` (global depth ${globalD})` : ""
        }`;
      }
    }
    return `Global depth ${globalD}`;
  }, [activeLens, focusNode, activeNode]);

  // Determine relationships (Node-level vs Domain-level fallback)
  const relContext = useMemo(() => {
    const isDom = activeNode.depth <= 1;
    const hasDirect = isDom
      ? true
      : nodeEdges.some((e) => e.a === activeNode.key || e.b === activeNode.key);
    const isFallback = !isDom && (!hasDirect || forceParentFallback);

    const useNodeRel = !isDom && hasDirect && !forceParentFallback;
    const relKey = useNodeRel ? activeNode.key : dom.key;
    const relPool = useNodeRel ? nodeEdges : domainEdges;

    const aliveEdges = relPool.filter(
      (e) =>
        e.birth <= overviewTimelineT &&
        (e.death === null || e.death > overviewTimelineT)
    );

    const deps = aliveEdges.filter((e) => e.a === relKey);
    const used = aliveEdges.filter((e) => e.b === relKey);
    const bads = aliveEdges.filter(
      (e) => e.bad && (e.a === relKey || e.b === relKey)
    );

    const relScopeLabel = useNodeRel
      ? "Node-level"
      : isDom
      ? "Domain-level"
      : `Module-level (${dom.label})`;

    return { isDom, hasDirect, isFallback, useNodeRel, deps, used, bads, relScopeLabel };
  }, [activeNode, dom, nodeEdges, domainEdges, forceParentFallback, overviewTimelineT]);

  const { isFallback, deps, used, bads, relScopeLabel } = relContext;

  const nodeLinked = hasBlueprintLinks(activeNode);
  const constraintsToShow =
    activeNode.constraints && activeNode.constraints.length > 0
      ? activeNode.constraints
      : activeNode.state === "mapped" && dom.constraints && dom.constraints.length > 0
      ? dom.constraints
      : [];
  const decisionsToShow =
    activeNode.decisions && activeNode.decisions.length > 0
      ? activeNode.decisions
      : activeNode.state === "mapped" && dom.decisions && dom.decisions.length > 0
      ? dom.decisions
      : [];

  const handleSelectChildOrTarget = (targetKeyOrId: string) => {
    const found = findNodeById(root, targetKeyOrId);
    if (!found) return;
    selectEntity({
      id: found.id,
      key: found.key,
      kind: found.kind,
      label: found.label,
      path: found.path,
      status: found.hasViolation ? "violation" : "mapped",
      state: found.state,
      fileCount: found.fileCount,
      node: found,
    });
    if (activeLens === "constellation") {
      setConstellationAnchor(found.key);
    }
  };

  return (
    <aside className="side-inspector" aria-label="Inspector">
      {/* Header (.sh) */}
      <div className="sh">
        <div className="ic">{renderDomainLucideIcon(dom.icon)}</div>
        <div style={{ minWidth: 0 }}>
          <h2 className="serif">
            {activeNode.label}{" "}
            <span className={`st s-${activeNode.state}`}>{activeNode.state}</span>
          </h2>
          <p>
            {activeNode.path}/ · {activeNode.fileCount} files
          </p>
          <p style={{ marginTop: 2 }}>{layerInfo}</p>
        </div>
      </div>

      {/* Honest Blueprint Link Status Box (.bp-status) */}
      <div className={`bp-status ${nodeLinked ? "linked" : ""}`}>
        {stateDescription(activeNode.state, activeNode)}
      </div>

      {/* Rule Violation Warning (.warn) */}
      {(bads.length > 0 || flags.viol > 0) && (
        <div className="warn">
          <b>Rule violation</b>
          <br />
          {bads[0]
            ? `${bads[0].a} depends on ${bads[0].b}, which is forbidden.`
            : activeNode.violationDetails?.[0] ||
              `${activeNode.label} contains a boundary violation.`}
        </div>
      )}

      {/* Honest Parent-Level Fallback Info Box (.info-box) */}
      {activeLens === "constellation" && isFallback && (
        <div className="info-box">
          <b>Parent-level fallback active:</b> AFWE only has module-level dependency data for{" "}
          <b>{dom.label}</b> right now, not specifically for{" "}
          <b>{activeNode.breadcrumbLabels.join(" › ")}</b>. Showing <b>{dom.label}</b>{" "}
          relationships on the canvas.
        </div>
      )}

      {/* Contextual Action Buttons */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {activeLens === "radial" && (
          <>
            {activeNode.children &&
              activeNode.children.length > 0 &&
              activeNode.id !== focusNode.id && (
                <button
                  type="button"
                  className="btn-soft primary"
                  onClick={() => drillDown(activeNode.id)}
                >
                  Open map
                </button>
              )}
            {focusNode.depth > 0 && activeNode.id === focusNode.id && (
              <button type="button" className="btn-soft" onClick={drillUp}>
                ‹ Up one level
              </button>
            )}
            <button
              type="button"
              className="btn-soft"
              onClick={() => openConstellationFor(activeNode.key)}
            >
              Constellation
            </button>
          </>
        )}

        {activeLens === "constellation" && (
          <>
            {activeNode.key !== constellationAnchorKey && (
              <button
                type="button"
                className="btn-soft primary"
                onClick={() => setConstellationAnchor(activeNode.key)}
              >
                Centre here
              </button>
            )}
            <button
              type="button"
              className="btn-soft"
              onClick={() => {
                setActiveLens("radial");
                if (activeNode.children && activeNode.children.length > 0) {
                  drillDown(activeNode.id);
                } else if (activeNode.parentId && activeNode.parentId !== "root") {
                  drillDown(activeNode.parentId);
                }
              }}
            >
              Open map in Atlas
            </button>
          </>
        )}

        {activeLens === "topology" && (
          <>
            <button
              type="button"
              className="btn-soft primary"
              onClick={() => {
                setActiveLens("radial");
                drillDown(activeNode.id);
              }}
            >
              Open map in Atlas
            </button>
            <button
              type="button"
              className="btn-soft"
              onClick={() => openConstellationFor(activeNode.key)}
            >
              Constellation
            </button>
          </>
        )}
      </div>

      {/* Inside <Node> Section */}
      <div className="sec">
        <h3>Inside {activeNode.label}</h3>
        {activeNode.children && activeNode.children.length > 0 ? (
          activeNode.children.slice(0, 8).map((c) => (
            <div
              key={c.key}
              className="row click"
              onClick={() => handleSelectChildOrTarget(c.key)}
            >
              <span>{c.label}</span>
              <span style={{ color: "var(--mute)" }}>
                {c.fileCount} files · {c.state}
              </span>
            </div>
          ))
        ) : (
          <>
            <div className="row" style={{ color: "var(--mute)" }}>
              <span>Leaf module ({activeNode.fileCount} files)</span>
            </div>
            {(activeNode.filesList || []).slice(0, 4).map((f) => (
              <div
                key={f}
                className="row click"
                onClick={() =>
                  openCodePreview({
                    filePath: f,
                    title: `${activeNode.label} — ${f.split("/").pop()}`,
                  })
                }
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <FileCode size={12} style={{ color: "var(--mute)" }} />
                  {f.split("/").pop()}
                </span>
                <span style={{ color: "var(--mute)", fontSize: 11 }}>preview</span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Relationships Section */}
      <div className="sec">
        <h3>Relationships ({relScopeLabel})</h3>
        <div className="row">
          <span>Depends on ({deps.length})</span>
          <span>
            {deps.length > 0
              ? deps
                  .slice(0, 4)
                  .map((e) => shortLabel(e.b))
                  .join(", ")
              : "None"}
          </span>
        </div>
        <div className="row">
          <span>Used by ({used.length})</span>
          <span>
            {used.length > 0
              ? used
                  .slice(0, 4)
                  .map((e) => shortLabel(e.a))
                  .join(", ")
              : "None"}
          </span>
        </div>

        {/* Clickable direct neighbors */}
        {(deps.length > 0 || used.length > 0) && (
          <div style={{ marginTop: 6 }}>
            {deps.slice(0, 3).map((e) => (
              <div
                key={`dep-${e.b}`}
                className="row click"
                onClick={() => handleSelectChildOrTarget(e.b)}
              >
                <span>→ {shortLabel(e.b)}</span>
                <span style={{ color: e.bad ? "var(--red)" : "var(--mute)", fontSize: 11.5 }}>
                  {e.bad ? "violation" : "dependency"}
                </span>
              </div>
            ))}
            {used.slice(0, 3).map((e) => (
              <div
                key={`con-${e.a}`}
                className="row click"
                onClick={() => handleSelectChildOrTarget(e.a)}
              >
                <span>← {shortLabel(e.a)}</span>
                <span style={{ color: e.bad ? "var(--red)" : "var(--mute)", fontSize: 11.5 }}>
                  {e.bad ? "violation" : "consumer"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Constraints Section */}
      <div className="sec">
        <h3>Constraints</h3>
        {constraintsToShow.length > 0 ? (
          constraintsToShow.map((c, idx) => (
            <div key={idx} className="row">
              <span>• {c}</span>
            </div>
          ))
        ) : (
          <div className="row" style={{ color: "var(--mute)" }}>
            <span>No explicit constraints linked to this node.</span>
          </div>
        )}
      </div>

      {/* Decisions Section */}
      <div className="sec">
        <h3>Decisions</h3>
        {decisionsToShow.length > 0 ? (
          decisionsToShow.map(([dTitle, dStatus], idx) => (
            <div key={idx} className="row">
              <span>{dTitle}</span>
              <span style={{ color: "var(--mute)" }}>{dStatus}</span>
            </div>
          ))
        ) : (
          <div className="row" style={{ color: "var(--mute)" }}>
            <span>No architectural decisions linked to this node.</span>
          </div>
        )}
      </div>

      {/* Active Pins Section (if present) */}
      {activeNode.pinDetails && activeNode.pinDetails.length > 0 && (
        <div className="sec">
          <h3>Pinned Checks ({activeNode.pinDetails.length})</h3>
          {activeNode.pinDetails.map((pStmt, idx) => (
            <div key={idx} className="row">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <Lock size={12} style={{ color: "var(--accent)", flexShrink: 0 }} />
                {pStmt}
              </span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
};
