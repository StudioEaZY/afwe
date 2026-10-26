// apps/studio/src/components/TopBar.tsx
import React, { useState } from "react";
import { useStore } from "../store";
import { api, isTauri, openProjectDialog } from "../api";

export const TopBar: React.FC = () => {
  const {
    graph,
    activeTurn,
    scrubToTurn,
    setDrawer,
    notify,
    refresh,
    run,
  } = useStore();

  const [syncing, setSyncing] = useState(false);

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
        background: "#FFFFFF",
        borderBottom: "1px solid #E5E0D5",
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
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "13px", color: "#6B675D" }}>Projects</span>
          <span style={{ color: "#8E8878" }}>›</span>
          <span style={{ fontWeight: 600, fontSize: "14px", color: "#1D1C1A" }}>{graph.project.name}</span>
        </div>

        {activeTurn && (
          <span
            style={{
              background: "#FAF3DB",
              border: "1px solid #EEDEA8",
              color: "#87661A",
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
              style={{ background: "none", border: "none", cursor: "pointer", color: "#87661A", fontSize: "14px", lineHeight: "1" }}
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
              background: "#FAF8F3",
              border: "1px solid #DCD9D0",
              padding: "3px 8px",
              borderRadius: "4px",
              fontSize: "11px",
              color: "#4A463E",
              cursor: "pointer",
            }}
          >
            Open folder…
          </button>
        )}
      </div>

      {/* Center: System Status Pill */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12.5px", color: "#4A463E" }}>
        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: violationsCount > 0 ? "#B23A2B" : "#2E7A57", display: "inline-block" }} />
        <span>
          {violationsCount > 0
            ? `${violationsCount} rule violation(s) need attention`
            : `Everything balances. ${pinsCount} pin(s) · ${proposalsCount} proposal(s) waiting`}
        </span>
      </div>

      {/* Right: Quick Search, Sync & Actions */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <button
          onClick={() => setDrawer("search")}
          style={{
            background: "#FAF8F3",
            border: "1px solid #DCD9D0",
            padding: "5px 12px",
            borderRadius: "6px",
            fontSize: "12px",
            color: "#6B675D",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span>Search code, features, decisions…</span>
          <kbd style={{ background: "#ECE7D9", padding: "1px 5px", borderRadius: "4px", fontSize: "10px" }}>⌘K</kbd>
        </button>

        <button
          onClick={doSync}
          disabled={syncing}
          style={{
            background: "#FAF8F3",
            border: "1px solid #DCD9D0",
            padding: "5px 10px",
            borderRadius: "6px",
            fontSize: "12px",
            color: "#4A463E",
            cursor: "pointer",
          }}
        >
          {syncing ? "Syncing…" : "Sync"}
        </button>
      </div>
    </header>
  );
};
