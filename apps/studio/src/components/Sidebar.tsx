// apps/studio/src/components/Sidebar.tsx
import React from "react";
import { useStore, View } from "../store";

export const Sidebar: React.FC = () => {
  const { graph, view, setView } = useStore();

  const projectName = graph?.project?.name || "Codebase";
  const violationsCount = (graph?.code_edges || []).filter((e: any) => e.violation).length;
  const questionsCount = (graph?.calibration?.questions || []).filter((q: any) => q.status === "open").length;

  const totalFiles = graph?.files?.length || 0;
  const nodes = graph?.nodes || [];
  const featuresCount = nodes.filter((n: any) => n.kind === "feature").length;
  const modulesCount = nodes.filter((n: any) => n.kind === "module").length;
  const pinsCount = (graph?.pins || []).filter((p: any) => p.status === "active").length;
  const proposalsCount = graph?.proposals?.length || 0;

  // Compute coverage stats
  const mappedNodes = nodes.filter((n: any) => n.status !== "inferred" && n.status !== "unmapped").length;
  const inferredNodes = nodes.filter((n: any) => n.status === "inferred").length;
  const unmappedNodes = Math.max(0, nodes.length - mappedNodes - inferredNodes);
  const totalNodesCount = Math.max(1, nodes.length);
  const mappedPct = Math.round((mappedNodes / totalNodesCount) * 100);
  const inferredPct = Math.round((inferredNodes / totalNodesCount) * 100);
  const unmappedPct = Math.max(0, 100 - mappedPct - inferredPct);

  const navItems: { key: View; label: string; sub: string; icon: string; badge?: number; badgeColor?: string }[] = [
    { key: "overview", label: "Overview", sub: "Radial & Topology maps", icon: "⌘" },
    { key: "timeline", label: "Timeline & Turns", sub: "Scrubber & visual diffs", icon: "⏱" },
    { key: "blueprint", label: "Blueprint", sub: "Nodes, globs & rules", icon: "▥" },
    { key: "checks", label: "Checks", sub: "Tripwires & pins", icon: "✓", badge: violationsCount > 0 ? violationsCount : undefined, badgeColor: "var(--red)" },
    { key: "decisions", label: "Decisions", sub: "Human queue & memory", icon: "⚖", badge: questionsCount > 0 ? questionsCount : undefined, badgeColor: "var(--amber)" },
    { key: "settings", label: "Settings", sub: "Engine, colors & policy", icon: "⚙" },
  ];

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
        {/* Logo / Brand Header */}
        <div style={{ padding: "18px 16px 14px 16px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <svg width="22" height="22" viewBox="0 0 30 30" aria-hidden="true">
              <circle cx="9" cy="10" r="4.2" fill="var(--accent)" />
              <circle cx="20" cy="7" r="3" fill="var(--amber)" />
              <circle cx="21" cy="19" r="4.6" fill="var(--mapped)" />
              <circle cx="9" cy="22" r="2.6" fill="var(--amber)" opacity=".7" />
            </svg>
            <span className="serif" style={{ fontSize: "20px", fontWeight: 700, color: "var(--ink)", letterSpacing: "0.5px" }}>
              AFWE
            </span>
          </div>
          <div style={{ fontSize: "11px", color: "var(--mute)", marginTop: "4px" }}>
            Your code. Its memory. Its rules.
          </div>
        </div>

        {/* Navigation Item List */}
        <nav style={{ padding: "12px 10px", display: "flex", flexDirection: "column", gap: "3px" }}>
          {navItems.map((item) => {
            const isActive = view === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setView(item.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 10px",
                  borderRadius: "10px",
                  border: "none",
                  background: isActive ? "var(--panel)" : "transparent",
                  boxShadow: isActive ? "0 4px 12px -6px var(--shadow)" : "none",
                  color: "var(--ink)",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background 0.15s ease",
                  width: "100%",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "14px", color: isActive ? "var(--accent)" : "var(--mute)" }}>{item.icon}</span>
                  <div>
                    <div style={{ fontWeight: isActive ? 600 : 500, fontSize: "13px" }}>{item.label}</div>
                    <div style={{ fontSize: "10.5px", color: "var(--mute)", marginTop: "1px" }}>{item.sub}</div>
                  </div>
                </div>
                {item.badge !== undefined && (
                  <span
                    style={{
                      background: item.badgeColor || "var(--ink)",
                      color: "#FFFFFF",
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
            );
          })}
        </nav>

        {/* Tactile Conic Coverage Ring & Coverage KPI breakdown */}
        <div style={{ padding: "14px 16px", borderTop: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div
              className="conic-ring"
              style={{
                background: `conic-gradient(var(--accent) 0 ${mappedPct}%, var(--inferred) ${mappedPct}% ${mappedPct + inferredPct}%, var(--line) ${mappedPct + inferredPct}% 100%)`,
              }}
            >
              <b>{mappedPct}%</b>
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--ink)" }}>Coverage</div>
              <div style={{ fontSize: "11px", color: "var(--mute)" }}>Architectural audit</div>
            </div>
          </div>
          <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "2px" }}>
            <div className="kpi-row"><span>Mapped</span><span>{mappedPct}%</span></div>
            <div className="kpi-row"><span>Inferred</span><span>{inferredPct}%</span></div>
            <div className="kpi-row"><span>Unmapped</span><span>{unmappedPct}%</span></div>
          </div>
        </div>

        {/* Codebase Vital Counts */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: "3px" }}>
          <div className="kpi-row"><span>Total files</span><span>{totalFiles.toLocaleString()}</span></div>
          <div className="kpi-row"><span>Features</span><span>{featuresCount}</span></div>
          <div className="kpi-row"><span>Modules</span><span>{modulesCount}</span></div>
          <div className="kpi-row"><span>Pins</span><span>{pinsCount}</span></div>
          <div className="kpi-row"><span>Proposals</span><span>{proposalsCount}</span></div>
        </div>
      </div>

      {/* Bottom Footer Info */}
      <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line)", background: "var(--side)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ color: "var(--accent)", fontSize: "10px" }}>●</span>
          <span style={{ fontWeight: 600, fontSize: "12px", color: "var(--ink)" }}>{projectName}</span>
        </div>
        <div style={{ fontSize: "11px", color: "var(--mute)", marginTop: "2px" }}>
          {totalFiles.toLocaleString()} files · main
        </div>
      </div>
    </aside>
  );
};
