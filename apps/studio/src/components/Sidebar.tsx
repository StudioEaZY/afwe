// apps/studio/src/components/Sidebar.tsx
import React from "react";
import { useStore, View } from "../store";

export const Sidebar: React.FC = () => {
  const { graph, view, setView } = useStore();

  const projectName = graph?.project?.name || "Codebase";
  const violationsCount = (graph?.code_edges || []).filter((e: any) => e.violation).length;
  const questionsCount = (graph?.calibration?.questions || []).filter((q: any) => q.status === "open").length;

  const navItems: { key: View; label: string; sub: string; icon: string; badge?: number; badgeColor?: string }[] = [
    { key: "overview", label: "Overview", sub: "Radial & Topology maps", icon: "⌘" },
    { key: "timeline", label: "Timeline & Turns", sub: "Scrubber & visual diffs", icon: "⏱" },
    { key: "blueprint", label: "Blueprint", sub: "Nodes, globs & rules", icon: "▥" },
    { key: "checks", label: "Checks", sub: "Tripwires & pins", icon: "✓", badge: violationsCount > 0 ? violationsCount : undefined, badgeColor: "#C94A38" },
    { key: "decisions", label: "Decisions", sub: "Human queue & memory", icon: "⚖", badge: questionsCount > 0 ? questionsCount : undefined, badgeColor: "#C98A3C" },
    { key: "settings", label: "Settings", sub: "Engine, colors & policy", icon: "⚙" },
  ];

  return (
    <aside
      className="studio-sidebar"
      style={{
        width: "200px",
        height: "100%",
        background: "#F4EFE6",
        borderRight: "1px solid #E5E0D5",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      <div>
        {/* Logo / Brand Header */}
        <div style={{ padding: "20px 18px 16px 18px", borderBottom: "1px solid #ECE7D9" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
            <span style={{ fontFamily: "Newsreader, serif", fontSize: "22px", fontWeight: 700, color: "#1D1C1A", letterSpacing: "0.5px" }}>
              AFWE
            </span>
          </div>
          <div style={{ fontSize: "11px", color: "#6B675D", marginTop: "3px", fontFamily: "'IBM Plex Sans', sans-serif" }}>
            Your code. Its memory. Its rules.
          </div>
        </div>

        {/* Navigation Item List */}
        <nav style={{ padding: "14px 10px", display: "flex", flexDirection: "column", gap: "4px" }}>
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
                  padding: "9px 12px",
                  borderRadius: "8px",
                  border: "none",
                  background: isActive ? "#E4DEC6" : "transparent",
                  color: "#1D1C1A",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background 0.15s ease",
                  width: "100%",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "14px", color: isActive ? "#1D1C1A" : "#6B675D" }}>{item.icon}</span>
                  <div>
                    <div style={{ fontWeight: isActive ? 600 : 500, fontSize: "13px" }}>{item.label}</div>
                    <div style={{ fontSize: "10.5px", color: "#6B675D", marginTop: "1px" }}>{item.sub}</div>
                  </div>
                </div>
                {item.badge !== undefined && (
                  <span
                    style={{
                      background: item.badgeColor || "#1D1C1A",
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
      </div>

      {/* Bottom Footer Info & Decorative Contour */}
      <div style={{ padding: "14px 16px", borderTop: "1px solid #ECE7D9" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ color: "#2E7A57", fontSize: "10px" }}>●</span>
          <span style={{ fontWeight: 600, fontSize: "12px", color: "#1D1C1A" }}>{projectName}</span>
        </div>
        <div style={{ fontSize: "11px", color: "#6B675D", marginTop: "2px" }}>
          {graph?.files?.length || 0} files · main
        </div>
      </div>
    </aside>
  );
};
