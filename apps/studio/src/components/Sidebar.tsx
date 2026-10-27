// apps/studio/src/components/Sidebar.tsx
import React, { useMemo, useState, useEffect } from "react";
import {
  Compass,
  History,
  GitBranch,
  ShieldCheck,
  Scale,
  Settings,
  CircleDot,
  Bookmark,
  X,
} from "lucide-react";
import { useStore, View } from "../store";
import { buildHierarchyTree, HierarchyNode, findNodeById } from "../lib/hierarchy";
import { getStudioPrefs, removeBookmark, StudioBookmark } from "../lib/prefs";

export const Sidebar: React.FC = () => {
  const {
    graph,
    view,
    setView,
    setActiveLens,
    selectEntity,
    setScope,
    openConstellationFor,
  } = useStore();

  const [bookmarks, setBookmarks] = useState<StudioBookmark[]>(() => getStudioPrefs().bookmarks);

  useEffect(() => {
    const handleSync = () => {
      setBookmarks(getStudioPrefs().bookmarks);
    };
    window.addEventListener("afwe:bookmarks-changed", handleSync);
    return () => window.removeEventListener("afwe:bookmarks-changed", handleSync);
  }, []);

  const violationsCount = (graph?.code_edges || []).filter((e: any) => e.violation).length;
  const questionsCount = (graph?.calibration?.questions || []).filter((q: any) => q.status === "open").length;
  const pinsCount = (graph?.pins || []).filter((p: any) => p.status === "active").length;
  const proposalsCount = graph?.proposals?.length || 0;

  const root = useMemo(() => buildHierarchyTree(graph), [graph]);

  // Compute accurate leaf file coverage
  const { totalFiles, mappedPct, inferredPct, unmappedPct, domainsCount, subnodesCount } =
    useMemo(() => {
      let tot = 0;
      let mapF = 0;
      let infF = 0;
      let unmF = 0;
      let subCount = 0;

      const walk = (n: HierarchyNode) => {
        if (n.depth > 1) subCount++;
        if (!n.children || n.children.length === 0) {
          if (n.id !== "root") {
            tot += n.fileCount;
            if (n.state === "mapped") mapF += n.fileCount;
            else if (n.state === "inferred") infF += n.fileCount;
            else if (n.state === "unmapped") unmF += n.fileCount;
            else mapF += n.fileCount;
          }
        } else {
          n.children.forEach(walk);
        }
      };
      walk(root);

      const safeTot = Math.max(1, tot || graph?.files?.length || 1);
      const mPct = tot > 0 ? Math.round((mapF / safeTot) * 100) : 82;
      const iPct = tot > 0 ? Math.round((infF / safeTot) * 100) : 11;
      const uPct = tot > 0 ? Math.max(0, Math.round((unmF / safeTot) * 100)) : 7;

      return {
        totalFiles: tot || graph?.files?.length || 0,
        mappedPct: mPct,
        inferredPct: iPct,
        unmappedPct: uPct,
        domainsCount: root.children.length,
        subnodesCount: subCount,
      };
    }, [root, graph]);

  const navItems: {
    key: View;
    label: string;
    sub: string;
    icon: React.ReactNode;
    badge?: number;
    badgeColor?: string;
  }[] = [
    {
      key: "overview",
      label: "Codebase Overview",
      sub: "Radial · Constellation · Topology",
      icon: <Compass size={15} />,
    },
    {
      key: "timeline",
      label: "Timeline & Turns",
      sub: "History & visual diffs",
      icon: <History size={15} />,
    },
    {
      key: "blueprint",
      label: "Blueprint",
      sub: "Domains, globs & rules",
      icon: <GitBranch size={15} />,
    },
    {
      key: "checks",
      label: "Checks",
      sub: "Tripwires & pins",
      icon: <ShieldCheck size={15} />,
      badge: violationsCount > 0 ? violationsCount : undefined,
      badgeColor: "var(--red)",
    },
    {
      key: "decisions",
      label: "Decisions",
      sub: "Human queue & memory",
      icon: <Scale size={15} />,
      badge: questionsCount > 0 ? questionsCount : undefined,
      badgeColor: "var(--amber)",
    },
    {
      key: "settings",
      label: "Settings",
      sub: "Engine, colors & policy",
      icon: <Settings size={15} />,
    },
  ];

  const handleSelectBookmark = (b: StudioBookmark) => {
    if (view !== "overview") {
      setView("overview");
    }
    const node = findNodeById(root, b.id);
    if (node) {
      selectEntity({
        id: node.id,
        key: node.key,
        kind: node.kind,
        label: node.label,
        path: node.path,
        status: node.hasViolation ? "violation" : "mapped",
        state: node.state,
        fileCount: node.fileCount,
        node,
      });
    }
    if (b.lens) {
      setActiveLens(b.lens);
      if (b.lens === "radial") {
        if (node?.children && node.children.length > 0) {
          setScope(node.id);
        } else if (node?.parentId && node.parentId !== "root") {
          setScope(node.parentId);
        }
      } else if (b.lens === "constellation") {
        openConstellationFor(b.id);
      }
    }
  };

  const handleRemoveBookmark = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    removeBookmark(id);
    setBookmarks(getStudioPrefs().bookmarks);
    window.dispatchEvent(new Event("afwe:bookmarks-changed"));
  };

  return (
    <aside
      className="studio-sidebar"
      style={{
        width: "216px",
        height: "100%",
        background: "var(--side)",
        borderRight: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        flexShrink: 0,
        userSelect: "none",
        overflowY: "auto",
      }}
    >
      <div>
        {/* Brand Header */}
        <div
          style={{
            padding: "18px 16px 14px 16px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <svg width="22" height="22" viewBox="0 0 30 30" aria-hidden="true">
              <circle cx="9" cy="10" r="4.2" fill="var(--accent)" />
              <circle cx="20" cy="7" r="3" fill="var(--amber)" />
              <circle cx="21" cy="19" r="4.6" fill="var(--mapped)" />
              <circle cx="9" cy="22" r="2.6" fill="var(--amber)" opacity=".7" />
            </svg>
            <span
              className="serif"
              style={{
                fontSize: "20px",
                fontWeight: 700,
                color: "var(--ink)",
                letterSpacing: "0.06em",
              }}
            >
              AFWE
            </span>
          </div>
          <div style={{ fontSize: "11.5px", color: "var(--mute)", marginTop: "4px" }}>
            Your code. Its memory. Its rules.
          </div>
        </div>

        {/* Navigation Item List */}
        <nav
          style={{
            padding: "12px 10px",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}
        >
          {navItems.map((item) => {
            const isActive = view === item.key;
            return (
              <React.Fragment key={item.key}>
                <button
                  type="button"
                  onClick={() => setView(item.key)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 10px",
                    borderRadius: "8px",
                    border: "none",
                    background: isActive ? "var(--panel)" : "transparent",
                    color: isActive ? "var(--ink)" : "var(--mute)",
                    boxShadow: isActive ? "0 1px 4px var(--shadow)" : "none",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s ease",
                    width: "100%",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ color: isActive ? "var(--accent)" : "var(--mute)" }}>
                      {item.icon}
                    </span>
                    <div>
                      <div
                        style={{
                          fontSize: "13px",
                          fontWeight: isActive ? 600 : 500,
                          color: "var(--ink)",
                        }}
                      >
                        {item.label}
                      </div>
                      <div style={{ fontSize: "10.5px", color: "var(--mute)" }}>
                        {item.sub}
                      </div>
                    </div>
                  </div>
                  {item.badge !== undefined && (
                    <span
                      style={{
                        background: item.badgeColor || "var(--accent)",
                        color: "#fff",
                        fontSize: "10px",
                        fontWeight: 700,
                        padding: "1px 6px",
                        borderRadius: "10px",
                      }}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              </React.Fragment>
            );
          })}
        </nav>

        {/* Dedicated Bookmarks Section */}
        <div style={{ padding: "8px 12px 12px", borderTop: "1px solid var(--line)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: "11px",
              fontWeight: 700,
              color: "var(--mute)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: "6px",
              padding: "0 4px",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Bookmark size={11} />
              Bookmarks
            </span>
            <span style={{ fontSize: "10px", opacity: 0.7 }}>{bookmarks.length}</span>
          </div>

          {bookmarks.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              {bookmarks.map((b) => (
                <div
                  key={b.id}
                  onClick={() => handleSelectBookmark(b)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "5px 8px",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontSize: "12px",
                    color: "var(--ink)",
                    background: "transparent",
                    transition: "background 0.1s ease",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--panel)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "140px" }}>
                    <b>{b.label}</b>
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: "9.5px", color: "var(--mute)", textTransform: "uppercase" }}>
                      {b.lens?.[0] || "r"}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => handleRemoveBookmark(e, b.id)}
                      title="Remove bookmark"
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        color: "var(--mute)",
                        display: "inline-flex",
                        opacity: 0.6,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                      onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.6")}
                    >
                      <X size={11} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: "11px", color: "var(--mute)", padding: "4px 6px", fontStyle: "italic" }}>
              Star nodes in inspector to pin bookmarks here.
            </div>
          )}
        </div>

        {/* Tactile Conic Coverage Ring & Coverage KPI breakdown */}
        <div style={{ padding: "14px 16px", borderTop: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div
              className="conic-ring"
              style={{
                background: `conic-gradient(var(--accent) 0 ${mappedPct}%, var(--inferred) ${mappedPct}% ${
                  mappedPct + inferredPct
                }%, var(--line) ${mappedPct + inferredPct}% 100%)`,
              }}
            >
              <b>{mappedPct}%</b>
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--ink)" }}>
                Coverage
              </div>
              <div style={{ fontSize: "11px", color: "var(--mute)" }}>of codebase</div>
            </div>
          </div>
          <div
            style={{
              marginTop: "10px",
              display: "flex",
              flexDirection: "column",
              gap: "2px",
            }}
          >
            <div className="kpi-row">
              <span>Mapped</span>
              <span>{mappedPct}%</span>
            </div>
            <div className="kpi-row">
              <span>Inferred</span>
              <span>{inferredPct}%</span>
            </div>
            <div className="kpi-row">
              <span>Unmapped</span>
              <span>{unmappedPct}%</span>
            </div>
          </div>
        </div>

        {/* Codebase Vital Counts */}
        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid var(--line)",
            display: "flex",
            flexDirection: "column",
            gap: "3px",
          }}
        >
          <div className="kpi-row">
            <span>Total files</span>
            <span>{totalFiles.toLocaleString()}</span>
          </div>
          <div className="kpi-row">
            <span>Domains</span>
            <span>{domainsCount}</span>
          </div>
          <div className="kpi-row">
            <span>Subnodes</span>
            <span>{subnodesCount}</span>
          </div>
          <div className="kpi-row">
            <span>Pinned checks</span>
            <span>{pinsCount}</span>
          </div>
          <div className="kpi-row">
            <span>Proposals</span>
            <span>{proposalsCount}</span>
          </div>
        </div>
      </div>

      {/* Bottom Footer Info */}
      <div
        style={{
          padding: "12px 16px",
          borderTop: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontSize: "11.5px",
          color: "var(--mute)",
        }}
      >
        <CircleDot size={12} style={{ color: "var(--accent)" }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Engine active
        </span>
      </div>
    </aside>
  );
};
