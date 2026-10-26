// apps/studio/src/components/TopBar.tsx
import React, { useState, useEffect } from "react";
import { useStore } from "../store";
import { api, isTauri, openProjectDialog } from "../api";
import { getStudioPrefs, setTheme, applyTheme } from "../lib/prefs";

export const TopBar: React.FC = () => {
  const {
    graph,
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
  } = useStore();

  const [syncing, setSyncing] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const prefs = getStudioPrefs();
    let effective = prefs.theme;
    if (effective === "system") {
      effective = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    setCurrentTheme(effective as "light" | "dark");
    applyTheme(prefs.theme);
  }, []);

  const toggleTheme = () => {
    const next = currentTheme === "dark" ? "light" : "dark";
    setCurrentTheme(next);
    setTheme(next);
  };

  if (!graph) return null;

  const pinsCount = (graph.pins || []).filter((p: any) => p.status === "active").length;
  const proposalsCount = graph.proposals?.length || 0;
  const violationsCount = (graph.code_edges || []).filter((e: any) => e.violation).length;

  const doSync = async () => {
    setSyncing(true);
    const r: any = await run("Syncing", () => api.sync());
    setSyncing(false);
    if (r) {
      notify(`Synced ${r.files} files — applied ${r.applied.length}, proposed ${r.proposed.length}`);
    }
  };

  return (
    <header
      className="studio-topbar"
      style={{
        height: "52px",
        background: "var(--panel)",
        borderBottom: "1px solid var(--line)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 24px",
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {/* Left: Project title & 4D time badge */}
      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "13px", color: "var(--mute)" }}>Projects</span>
          <span style={{ color: "var(--mute)" }}>›</span>
          <span style={{ fontWeight: 600, fontSize: "14px", color: "var(--ink)" }}>{graph.project.name}</span>
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
              onClick={() => scrubToTurn(null)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--amber)", fontSize: "14px", lineHeight: "1" }}
            >
              ×
            </button>
          </span>
        )}

        {isTauri() && (
          <button
            onClick={async () => {
              const p = await openProjectDialog();
              if (p) {
                notify(`Opened ${p}`);
                await refresh();
              }
            }}
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              padding: "3px 8px",
              borderRadius: "4px",
              fontSize: "11px",
              color: "var(--ink)",
              cursor: "pointer",
            }}
          >
            Open folder…
          </button>
        )}
      </div>

      {/* Center: System Status Pill & Session Undo/Redo Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--mute)" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: violationsCount > 0 ? "var(--red)" : "var(--accent)", display: "inline-block" }} />
          <span>
            {violationsCount > 0
              ? `${violationsCount} rule violation(s) need attention`
              : `Everything balances. ${pinsCount} pin(s) · ${proposalsCount} proposal(s) waiting`}
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
              borderRadius: "6px",
              padding: "2px 6px",
            }}
          >
            <button
              onClick={() => undo()}
              title="Undo (Ctrl+Z)"
              style={{
                background: "none",
                border: "none",
                fontSize: "12px",
                cursor: "pointer",
                color: "var(--ink)",
                padding: "2px 4px",
                borderRadius: "3px",
              }}
            >
              ↶ Undo
            </button>
            {redoStack.length > 0 && (
              <button
                onClick={() => redo()}
                title="Redo (Ctrl+Y)"
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "12px",
                  cursor: "pointer",
                  color: "var(--ink)",
                  padding: "2px 4px",
                  borderRadius: "3px",
                }}
              >
                ↷ Redo
              </button>
            )}
            <button
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
      </div>

      {/* Right: Search, Sync, Theme Toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <button
          onClick={() => setDrawer("search")}
          style={{
            background: "var(--side)",
            border: "1px solid var(--line)",
            padding: "5px 12px",
            borderRadius: "6px",
            fontSize: "12px",
            color: "var(--mute)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span>Search code, features, decisions…</span>
          <kbd style={{ background: "var(--line)", color: "var(--ink)", padding: "1px 5px", borderRadius: "4px", fontSize: "10px" }}>⌘K</kbd>
        </button>

        <button
          onClick={doSync}
          disabled={syncing}
          style={{
            background: "var(--side)",
            border: "1px solid var(--line)",
            padding: "5px 10px",
            borderRadius: "6px",
            fontSize: "12px",
            color: "var(--ink)",
            cursor: "pointer",
          }}
        >
          {syncing ? "Syncing…" : "Sync"}
        </button>

        <button
          onClick={toggleTheme}
          title={`Switch to ${currentTheme === "dark" ? "light" : "dark"} theme`}
          style={{
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            border: "1px solid var(--line)",
            background: "var(--side)",
            color: "var(--ink)",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            fontSize: "14px",
            padding: 0,
          }}
        >
          {currentTheme === "dark" ? "☀" : "☾"}
        </button>
      </div>
    </header>
  );
};
