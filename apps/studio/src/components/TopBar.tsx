// apps/studio/src/components/TopBar.tsx
import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Sun,
  Moon,
  Undo2,
  Redo2,
  X,
  Search,
  RefreshCw,
  FolderOpen,
} from "lucide-react";
import { useStore } from "../store";
import { api, isTauri, openProjectDialog } from "../api";
import { getStudioPrefs, setTheme, applyTheme } from "../lib/prefs";
import { buildHierarchyTree, HierarchyNode } from "../lib/hierarchy";

export const TopBar: React.FC = () => {
  const {
    graph,
    view,
    activeLens,
    activeTurn,
    scrubToTurn,
    setDrawer,
    drawer,
    notify,
    refresh,
    run,
    undoStack,
    redoStack,
    undo,
    redo,
    setView,
    selectEntity,
    drillDown,
    setConstellationAnchor,
  } = useStore();

  const [syncing, setSyncing] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<"light" | "dark">("light");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prefs = getStudioPrefs();
    let effective = prefs.theme;
    if (effective === "system") {
      effective = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    setCurrentTheme(effective as "light" | "dark");
    applyTheme(prefs.theme);
  }, []);

  // Close instant search dropdown when clicking outside
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDocClick);
    return () => document.removeEventListener("pointerdown", onDocClick);
  }, []);

  const toggleTheme = () => {
    const next = currentTheme === "dark" ? "light" : "dark";
    setCurrentTheme(next);
    setTheme(next);
  };

  // Build flat list of hierarchy nodes for instant search autocomplete
  const allHierarchyNodes = useMemo(() => {
    if (!graph) return [];
    const root = buildHierarchyTree(graph);
    const out: HierarchyNode[] = [];
    const walk = (n: HierarchyNode) => {
      if (n.id !== "root") out.push(n);
      for (const c of n.children || []) walk(c);
    };
    walk(root);
    return out;
  }, [graph]);

  const searchHits = useMemo(() => {
    const raw = searchQuery.trim();
    if (!raw) {
      // When input is focused but empty, show curated suggestions
      const presets = [
        "Backend/events/models",
        "Services/jobs/auth",
        "Data/schema",
        "Web/views/checkout",
        "Backend/api/routes",
        "Backend",
        "Services",
        "Data",
        "Web",
      ];
      return allHierarchyNodes
        .filter((n) => presets.includes(n.key))
        .slice(0, 8);
    }
    // Clean query: strip noise/punctuation
    const q = raw.toLowerCase().replace(/[^a-z0-9_\-\/]/g, "").trim();
    if (!q) return [];
    return allHierarchyNodes
      .filter(
        (n) =>
          n.label.toLowerCase().includes(q) ||
          n.path.toLowerCase().includes(q) ||
          n.key.toLowerCase().includes(q) ||
          n.breadcrumbLabels.some((b) => b.toLowerCase().includes(q))
      )
      .slice(0, 12);
  }, [allHierarchyNodes, searchQuery]);

  if (!graph) return null;

  const pinsCount = (graph.pins || []).filter((p: any) => p.status === "active").length;
  const proposalsCount = graph.proposals?.length || 0;
  const violationsCount = (graph.code_edges || []).filter((e: any) => e.violation).length;

  const doSync = async () => {
    setSyncing(true);
    const r: any = await run("Syncing", () => api.sync());
    setSyncing(false);
    if (r) {
      notify(
        `Synced ${r.files} files — applied ${r.applied.length}, proposed ${r.proposed.length}`
      );
    }
  };

  const handleSelectSearchResult = (n: HierarchyNode) => {
    setSearchOpen(false);
    setSearchQuery("");
    if (view !== "overview") {
      setView("overview");
    }
    selectEntity({
      id: n.id,
      key: n.key,
      kind: n.kind,
      label: n.label,
      path: n.path,
      status: n.hasViolation ? "violation" : "mapped",
      state: n.state,
      fileCount: n.fileCount,
      mappedCount: n.mappedCount,
      node: n,
    });
    if (activeLens === "constellation") {
      setConstellationAnchor(n.key);
    } else if (activeLens === "radial") {
      if (n.children && n.children.length > 0) {
        drillDown(n.id);
      } else if (n.parentId && n.parentId !== "root") {
        drillDown(n.parentId);
      }
    }
  };

  return (
    <header
      className="studio-topbar"
      style={{
        height: "56px",
        background: "var(--panel)",
        borderBottom: "1px solid var(--line)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 22px",
        flexShrink: 0,
        userSelect: "none",
        gap: 16,
      }}
    >
      {/* Left: Project title & 4D time badge */}
      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "13px", color: "var(--mute)" }}>Projects</span>
          <span style={{ color: "var(--mute)" }}>›</span>
          <span style={{ fontWeight: 600, fontSize: "14px", color: "var(--ink)" }}>
            {graph.project.name}
          </span>
        </div>

        {activeTurn && (
          <span
            style={{
              background: "var(--side)",
              border: "1px solid var(--line)",
              color: "var(--amber)",
              fontSize: "11px",
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: "12px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            4D Time-Travel: #{activeTurn}
            <button
              type="button"
              onClick={() => scrubToTurn(null)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--amber)",
                display: "inline-flex",
                alignItems: "center",
                padding: 0,
              }}
            >
              <X size={12} />
            </button>
          </span>
        )}

        {isTauri() && (
          <button
            type="button"
            onClick={async () => {
              const p = await openProjectDialog();
              if (p) {
                notify(`Opened ${p}`);
                await refresh();
              }
            }}
            className="btn-soft"
            style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
          >
            <FolderOpen size={13} />
            Open folder
          </button>
        )}
      </div>

      {/* Center: Instant Search Autocomplete (.search-wrap + .sdrop) */}
      <div ref={searchWrapRef} className="search-wrap">
        <label className="search" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Search size={14} style={{ color: "var(--mute)", flexShrink: 0 }} />
          <input
            type="text"
            value={searchQuery}
            placeholder="Search modules, features, or paths…"
            aria-label="Search"
            onFocus={() => setSearchOpen(true)}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSearchOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && searchHits.length > 0) {
                handleSelectSearchResult(searchHits[0]);
              } else if (e.key === "Escape") {
                setSearchOpen(false);
              }
            }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setSearchOpen(false);
              }}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                color: "var(--mute)",
                display: "inline-flex",
              }}
            >
              <X size={13} />
            </button>
          )}
        </label>

        {searchOpen && (
          <div className="sdrop on">
            {searchQuery.trim().length === 0 && searchHits.length > 0 && (
              <div
                style={{
                  padding: "5px 10px 4px",
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "var(--mute)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                Suggested modules &amp; subnodes
              </div>
            )}
            {searchHits.length > 0 ? (
              searchHits.map((n) => (
                <div
                  key={n.key}
                  className="sitem"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelectSearchResult(n);
                  }}
                >
                  <span>
                    <b>{n.label}</b>{" "}
                    <small>· {n.breadcrumbLabels.join(" › ")}</small>
                  </span>
                  <small>
                    {n.state} · {n.fileCount}f
                  </small>
                </div>
              ))
            ) : (
              <div className="sitem" style={{ color: "var(--mute)", cursor: "default" }}>
                <span>No matching modules or subnodes for &quot;{searchQuery}&quot;</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right: Status Pill, Session Undo/Redo, Sync, Theme Toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "7px",
            fontSize: "12px",
            color: "var(--mute)",
          }}
        >
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: violationsCount > 0 ? "var(--red)" : "var(--accent)",
              display: "inline-block",
            }}
          />
          <span>
            {violationsCount > 0
              ? `${violationsCount} violation(s)`
              : `${pinsCount} pin(s) · ${proposalsCount} proposal(s)`}
          </span>
        </div>

        {/* Reversible Actions Session Pill */}
        {undoStack.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              background: "var(--side)",
              border: "1px solid var(--line)",
              borderRadius: "8px",
              padding: "3px 6px",
            }}
          >
            <button
              type="button"
              onClick={() => undo()}
              title="Undo (Ctrl+Z)"
              style={{
                background: "none",
                border: "none",
                fontSize: "12px",
                cursor: "pointer",
                color: "var(--ink)",
                padding: "2px 5px",
                borderRadius: "4px",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Undo2 size={13} />
              Undo
            </button>
            {redoStack.length > 0 && (
              <button
                type="button"
                onClick={() => redo()}
                title="Redo (Ctrl+Y)"
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "12px",
                  cursor: "pointer",
                  color: "var(--ink)",
                  padding: "2px 5px",
                  borderRadius: "4px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Redo2 size={13} />
                Redo
              </button>
            )}
            <button
              type="button"
              onClick={() => setDrawer(drawer === "history" ? null : "history")}
              style={{
                background: "var(--line)",
                border: "none",
                fontSize: "10px",
                fontWeight: 700,
                color: "var(--ink)",
                padding: "1px 5px",
                borderRadius: "10px",
                cursor: "pointer",
              }}
            >
              {undoStack.length}
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={doSync}
          disabled={syncing}
          className="btn-soft"
          style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
        >
          <RefreshCw size={12} />
          {syncing ? "Syncing…" : "Sync"}
        </button>

        <button
          type="button"
          onClick={toggleTheme}
          title={`Switch to ${currentTheme === "dark" ? "light" : "dark"} theme`}
          style={{
            width: "34px",
            height: "34px",
            borderRadius: "50%",
            border: "1px solid var(--line)",
            background: "var(--panel)",
            color: "var(--ink)",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            padding: 0,
          }}
        >
          {currentTheme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>
    </header>
  );
};
