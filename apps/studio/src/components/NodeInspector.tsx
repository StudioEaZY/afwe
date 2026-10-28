// apps/studio/src/components/NodeInspector.tsx
import React, { useMemo, useState, useEffect } from "react";
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
  Bookmark,
  FileText,
  Edit3,
  PlusCircle,
  Copy,
  Check,
} from "lucide-react";
import { useStore } from "../store";
import { api } from "../api";
import { HarnessFixButton } from "./HarnessFixPrompt";
import { EditNodeModal, MappingModal, ConstraintModal } from "./BlueprintModals";
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
  DirectedEdge,
  SelectedEntity,
} from "../lib/hierarchy";
import { getStudioPrefs, addBookmark, removeBookmark, StudioBookmark } from "../lib/prefs";

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

interface EdgeInspectorViewProps {
  edgeData: DirectedEdge;
  root: HierarchyNode;
  onSelectEntity: (entity: SelectedEntity) => void;
  onOpenConstellation: (nodeKey: string) => void;
}

const EdgeInspectorView: React.FC<EdgeInspectorViewProps> = ({
  edgeData: e,
  root,
  onSelectEntity,
  onOpenConstellation,
}) => {
  const nFrom = findNodeById(root, e.a);
  const nTo = findNodeById(root, e.b);
  const isNodeEdge = e.a.includes("/") || e.b.includes("/");

  const inspectEndpoint = (n: HierarchyNode | null, fallbackKey: string) => {
    if (!n) return;
    onSelectEntity({
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
        <div className="warn" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div>
            <b>Rule violation</b>
            <br />
            {e.a} must not depend on {e.b}.
            {e.bridge?.violationDetail && (
              <div style={{ marginTop: 4, fontWeight: 600 }}>
                Violation: {e.bridge.violationDetail}
              </div>
            )}
            <br />
            <span style={{ opacity: 0.85 }}>
              Suggested fix: invert dependency via an event or move shared types into Shared.
            </span>
          </div>
          <HarnessFixButton
            compact
            issueType="constraint_violation"
            title={`${shortLabel(e.a)} -> ${shortLabel(e.b)} boundary violation`}
            sourceNode={e.a}
            targetNode={e.b}
            rationale={`${e.a} must not depend on ${e.b}`}
            suggestedAction="Invert the dependency via an interface or move shared types behind an allowed boundary."
          />
        </div>
      )}

      {e.bridge && e.bridge.entrypoints && e.bridge.entrypoints.length > 0 && (
        <div className="sec">
          <h3>Concrete Capability Bridges ({e.bridge.entrypoints.length})</h3>
          {e.bridge.entrypoints.map((ep: string, idx: number) => (
            <div
              key={idx}
              className="row"
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "11px",
                color: e.bad ? "var(--red)" : "var(--ink)",
              }}
            >
              <span>• {ep}</span>
            </div>
          ))}
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
            onClick={() => onOpenConstellation(e.a)}
          >
            Centre on {shortLabel(e.a)}
          </button>
          <button
            type="button"
            className="btn-soft"
            onClick={() => onOpenConstellation(e.b)}
          >
            Centre on {shortLabel(e.b)}
          </button>
        </div>
      </div>
    </aside>
  );
};

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
    notify,
    run,
  } = useStore();

  const [activeTab, setActiveTab] = useState<"inspect" | "agent">("inspect");
  const [agentBriefing, setAgentBriefing] = useState<string>("");
  const [briefingLoading, setBriefingLoading] = useState<boolean>(false);
  const [briefingCopied, setBriefingCopied] = useState<boolean>(false);

  const [editingNode, setEditingNode] = useState<boolean>(false);
  const [editingMapping, setEditingMapping] = useState<boolean>(false);
  const [addingConstraint, setAddingConstraint] = useState<boolean>(false);

  const [bookmarks, setBookmarks] = useState<StudioBookmark[]>(() => getStudioPrefs().bookmarks);

  useEffect(() => {
    const handleSync = () => {
      setBookmarks(getStudioPrefs().bookmarks);
    };
    window.addEventListener("afwe:bookmarks-changed", handleSync);
    return () => window.removeEventListener("afwe:bookmarks-changed", handleSync);
  }, []);

  const root = useMemo(() => buildHierarchyTree(graph), [graph]);
  const { domainEdges, nodeEdges } = useMemo(
    () => buildDirectedEdges(graph, root),
    [graph, root]
  );

  const focusNode = useMemo(() => {
    if (!currentScopeId) return root;
    return findNodeById(root, currentScopeId) || root;
  }, [root, currentScopeId]);

  // Determine active node unconditionally so hook count never diverges
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

  // Determine dependencies & consumers
  const { deps, used, isFallback, relScopeLabel } = useMemo(() => {
    const isDomain = activeNode.depth <= 1;
    const directNodeEdges = nodeEdges.filter(
      (e) => e.a === activeNode.key || e.b === activeNode.key
    );

    if (isDomain) {
      const d = domainEdges.filter(
        (e) =>
          e.a === dom.label &&
          e.birth <= overviewTimelineT &&
          (e.death === null || e.death > overviewTimelineT)
      );
      const u = domainEdges.filter(
        (e) =>
          e.b === dom.label &&
          e.birth <= overviewTimelineT &&
          (e.death === null || e.death > overviewTimelineT)
      );
      return { deps: d, used: u, isFallback: false, relScopeLabel: "Domain" };
    }

    if (directNodeEdges.length > 0 && !forceParentFallback) {
      const d = directNodeEdges.filter(
        (e) =>
          e.a === activeNode.key &&
          e.birth <= overviewTimelineT &&
          (e.death === null || e.death > overviewTimelineT)
      );
      const u = directNodeEdges.filter(
        (e) =>
          e.b === activeNode.key &&
          e.birth <= overviewTimelineT &&
          (e.death === null || e.death > overviewTimelineT)
      );
      return { deps: d, used: u, isFallback: false, relScopeLabel: "Node-level" };
    }

    const d = domainEdges.filter(
      (e) =>
        e.a === dom.label &&
        e.birth <= overviewTimelineT &&
        (e.death === null || e.death > overviewTimelineT)
    );
    const u = domainEdges.filter(
      (e) =>
        e.b === dom.label &&
        e.birth <= overviewTimelineT &&
        (e.death === null || e.death > overviewTimelineT)
    );
    return {
      deps: d,
      used: u,
      isFallback: true,
      relScopeLabel: `Parent domain (${dom.label})`,
    };
  }, [activeNode, dom, nodeEdges, domainEdges, forceParentFallback, overviewTimelineT]);

  // Check blueprint mapping & constraints
  const { nodeLinked, constraintsToShow } = useMemo(() => {
    const linked = hasBlueprintLinks(activeNode);
    const constraints: string[] = [];

    if (graph && (graph as any).constraints && Array.isArray((graph as any).constraints)) {
      (graph as any).constraints.forEach((c: any) => {
        const matchesScope =
          c.from === activeNode.key ||
          c.to === activeNode.key ||
          c.from === dom.label ||
          c.to === dom.label;
        if (matchesScope && c.rule) {
          constraints.push(c.rule);
        }
      });
    }

    if (constraints.length === 0 && linked) {
      constraints.push(
        `${activeNode.label} is governed by ${dom.label} architectural boundary conventions.`
      );
    }
    return { nodeLinked: linked, constraintsToShow: constraints };
  }, [graph, activeNode, dom]);

  // Check applicable decisions
  const decisionsToShow = useMemo(() => {
    const list: [string, string][] = [];
    if (graph && (graph as any).decisions && Array.isArray((graph as any).decisions)) {
      (graph as any).decisions.forEach((d: any) => {
        const matches =
          (d.nodes && (d.nodes.includes(activeNode.key) || d.nodes.includes(dom.label))) ||
          (d.title && d.title.toLowerCase().includes(activeNode.label.toLowerCase()));
        if (matches) {
          list.push([d.title, d.status || "Accepted"]);
        }
      });
    }
    return list;
  }, [graph, activeNode, dom]);

  // If selectedEntity is an edge, render EdgeInspectorView without violating hook count
  if (selectedEntity && selectedEntity.kind === "edge" && selectedEntity.edgeData) {
    return (
      <EdgeInspectorView
        edgeData={selectedEntity.edgeData}
        root={root}
        onSelectEntity={selectEntity}
        onOpenConstellation={openConstellationFor}
      />
    );
  }

  const isBookmarked = bookmarks.some((b) => b.id === activeNode.key);

  useEffect(() => {
    if (activeTab === "agent" && activeNode) {
      setBriefingLoading(true);
      api.context({ node: activeNode.key || activeNode.id })
        .then((res: any) => {
          setAgentBriefing(res?.markdown || `# Agent Briefing: ${activeNode.label}\nNo micro-context returned.`);
        })
        .catch((err: any) => {
          setAgentBriefing(`# Error retrieving agent context\n${err?.message || err}`);
        })
        .finally(() => setBriefingLoading(false));
    }
  }, [activeTab, activeNode.key]);

  const handleToggleBookmark = () => {
    if (isBookmarked) {
      removeBookmark(activeNode.key);
    } else {
      addBookmark({
        id: activeNode.key,
        label: activeNode.label,
        path: activeNode.path,
        lens: activeLens,
      });
    }
    setBookmarks(getStudioPrefs().bookmarks);
    window.dispatchEvent(new Event("afwe:bookmarks-changed"));
  };

  const bads = deps.filter((e) => e.bad).concat(used.filter((e) => e.bad));

  const handleSelectChildOrTarget = (targetKey: string) => {
    const found = findNodeById(root, targetKey);
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
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
            <h2 className="serif" style={{ margin: 0 }}>
              {activeNode.label}{" "}
              <span className={`st s-${activeNode.state}`}>{activeNode.state}</span>
            </h2>
            <button
              type="button"
              className={`btn-soft ${isBookmarked ? "primary" : ""}`}
              onClick={handleToggleBookmark}
              title={isBookmarked ? "Remove bookmark" : "Bookmark this node"}
              style={{ padding: "3px 6px", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}
            >
              <Bookmark size={12} fill={isBookmarked ? "currentColor" : "none"} />
              <span style={{ fontSize: "11px" }}>{isBookmarked ? "Saved" : "Star"}</span>
            </button>
          </div>
          <p style={{ margin: "4px 0 0" }}>
            {activeNode.path}/ · {activeNode.fileCount} files
          </p>
          <p style={{ marginTop: 2 }}>{layerInfo}</p>
        </div>
      </div>

      {/* Segmented Inspector vs Agent Briefing View Switcher */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--line)", background: "var(--side)", margin: "0 -16px 12px -16px", padding: "0 16px" }}>
        <button
          type="button"
          onClick={() => setActiveTab("inspect")}
          style={{
            flex: 1,
            padding: "8px 0",
            background: "none",
            border: "none",
            borderBottom: activeTab === "inspect" ? "2px solid var(--accent)" : "2px solid transparent",
            fontWeight: activeTab === "inspect" ? 600 : 500,
            fontSize: "12px",
            color: activeTab === "inspect" ? "var(--ink)" : "var(--mute)",
            cursor: "pointer",
          }}
        >
          Inspector
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("agent")}
          style={{
            flex: 1,
            padding: "8px 0",
            background: "none",
            border: "none",
            borderBottom: activeTab === "agent" ? "2px solid var(--accent)" : "2px solid transparent",
            fontWeight: activeTab === "agent" ? 600 : 500,
            fontSize: "12px",
            color: activeTab === "agent" ? "var(--ink)" : "var(--mute)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "5px",
          }}
        >
          <FileText size={12} />
          <span>Agent View</span>
        </button>
      </div>

      {activeTab === "agent" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--mute)", textTransform: "uppercase" }}>
              Exact LLM Micro-Context Briefing
            </span>
            <button
              type="button"
              className="btn-soft"
              onClick={() => {
                navigator.clipboard.writeText(agentBriefing);
                setBriefingCopied(true);
                setTimeout(() => setBriefingCopied(false), 2000);
              }}
              style={{ padding: "3px 8px", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px" }}
            >
              {briefingCopied ? <Check size={11} /> : <Copy size={11} />}
              <span>{briefingCopied ? "Copied" : "Copy Briefing"}</span>
            </button>
          </div>
          <pre
            style={{
              background: "var(--bg)",
              border: "1px solid var(--line)",
              borderRadius: "6px",
              padding: "12px",
              fontSize: "11px",
              fontFamily: "'IBM Plex Mono', monospace",
              color: "var(--ink)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: "420px",
              overflowY: "auto",
              margin: 0,
            }}
          >
            {briefingLoading ? "Retrieving agent micro-context..." : agentBriefing}
          </pre>
        </div>
      ) : (
        <>

      {/* Honest Blueprint Link Status Box (.bp-status) */}
      <div className={`bp-status ${nodeLinked ? "linked" : ""}`}>
        {stateDescription(activeNode.state, activeNode)}
      </div>

      {/* Rule Violation Warning (.warn) */}
      {(bads.length > 0 || flags.viol > 0) && (
        <div className="warn" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div>
            <b>Rule violation</b>
            <br />
            {bads[0]
              ? `${bads[0].a} depends on ${bads[0].b}, which is forbidden.`
              : activeNode.violationDetails?.[0] ||
                `${activeNode.label} contains a boundary violation.`}
          </div>
          <HarnessFixButton
            compact
            issueType="constraint_violation"
            title={`${activeNode.label} boundary rule violation`}
            sourceNode={activeNode.key}
            targetNode={bads[0]?.b}
            rationale={bads[0] ? `${bads[0].a} must not depend on ${bads[0].b}` : undefined}
            suggestedAction="Repair boundary constraint violation or invert dependency."
          />
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
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0" }}>
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
              Open map
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
              Open map
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Constraints</h3>
          <button
            type="button"
            className="btn-soft"
            onClick={() => setAddingConstraint(true)}
            style={{ padding: "2px 6px", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px" }}
          >
            <PlusCircle size={11} />
            <span>+ Rule</span>
          </button>
        </div>
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

      {/* Blueprint Inline Actions */}
      <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid var(--line)", display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn-soft"
          onClick={() => setEditingNode(true)}
          style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", padding: "4px 8px" }}
        >
          <Edit3 size={11} />
          <span>Edit Node</span>
        </button>
        <button
          type="button"
          className="btn-soft"
          onClick={() => setEditingMapping(true)}
          style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", padding: "4px 8px" }}
        >
          <FileCode size={11} />
          <span>Edit Mapping</span>
        </button>
      </div>

      </>
      )}

      {editingNode && (
        <EditNodeModal
          node={{ id: activeNode.key, name: activeNode.label, path: activeNode.path, status: activeNode.state }}
          onClose={() => setEditingNode(false)}
          onSave={async (patch) => {
            await run("Updating Node", async () => {
              await api.bp.update(activeNode.key, patch);
              notify(`Updated ${activeNode.label}`);
            });
            setEditingNode(false);
          }}
        />
      )}

      {editingMapping && (
        <MappingModal
          node={{ id: activeNode.key, path: activeNode.path, implements: { files: activeNode.filesList || [] } }}
          onClose={() => setEditingMapping(false)}
          onSave={async (files, symbols) => {
            await run("Updating Mapping", async () => {
              await api.bp.update(activeNode.key, { files, symbols });
              notify(`Updated mapping for ${activeNode.label}`);
            });
            setEditingMapping(false);
          }}
        />
      )}

      {addingConstraint && (
        <ConstraintModal
          from={activeNode.key}
          onClose={() => setAddingConstraint(false)}
        />
      )}
    </aside>
  );
};
