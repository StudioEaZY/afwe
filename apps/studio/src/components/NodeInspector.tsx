// apps/studio/src/components/NodeInspector.tsx
import React, { useState } from "react";
import { useStore } from "../store";
import { SelectedEntity } from "../lib/hierarchy";
import { api } from "../api";

export const NodeInspector: React.FC = () => {
  const {
    graph,
    selectedEntity,
    selectEntity,
    setActiveLens,
    drillDown,
    notify,
    run,
    scrubToTurn,
  } = useStore();

  const [activeTab, setActiveTab] = useState<"overview" | "files" | "deps" | "rules" | "history">("overview");

  // Fallback state when nothing is selected
  if (!selectedEntity) {
    const totalFiles = graph?.files?.length || 0;
    const unmappedFiles = graph?.unmapped?.length || 0;
    const mappedFiles = Math.max(0, totalFiles - unmappedFiles);
    const mappedPct = totalFiles > 0 ? Math.round((mappedFiles / totalFiles) * 100) : 0;
    const proposalsCount = graph?.proposals?.length || 0;
    const codeEdgesCount = graph?.code_edges?.length || 0;

    // Top uncharted areas by top-level folder
    const folderCounts = new Map<string, number>();
    for (const f of graph?.unmapped || []) {
      const top = (f as string).split("/")[0] || "(root)";
      folderCounts.set(top, (folderCounts.get(top) || 0) + 1);
    }
    const topUncharted = Array.from(folderCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    return (
      <aside className="node-inspector-pane" style={{ width: "340px", height: "100%", overflowY: "auto", background: "#FFFFFF", borderLeft: "1px solid #E5E0D5", padding: "20px" }}>
        <h3 style={{ fontFamily: "Newsreader, serif", fontSize: "18px", color: "#1D1C1A", marginTop: 0, marginBottom: "16px" }}>
          Repository Health
        </h3>

        {/* Donut Metric Card */}
        <div style={{ background: "#FAF8F3", border: "1px solid #E5E0D5", borderRadius: "10px", padding: "16px", marginBottom: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={{ position: "relative", width: "64px", height: "64px" }}>
              <svg viewBox="0 0 36 36" style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#E5E0D5" strokeWidth="4" />
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="#2E7A57"
                  strokeWidth="4"
                  strokeDasharray={`${mappedPct}, 100`}
                />
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: "bold", color: "#1D1C1A" }}>
                {mappedPct}%
              </div>
            </div>
            <div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#1D1C1A" }}>{mappedFiles.toLocaleString()} Mapped files</div>
              <div style={{ fontSize: "12px", color: "#6B675D", marginTop: "2px" }}>{unmappedFiles.toLocaleString()} Uncharted files</div>
              <div style={{ fontSize: "11px", color: "#8E8878", marginTop: "2px" }}>{codeEdgesCount} Detected dependencies</div>
            </div>
          </div>
        </div>

        {/* Top Uncharted Areas */}
        <div style={{ marginBottom: "24px" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "#6B675D", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>
            Top Uncharted Folders
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {topUncharted.map(([folder, count]) => (
              <div
                key={folder}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  background: "#FAF8F3",
                  border: "1px solid #ECE7D9",
                  fontSize: "12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span>📁</span>
                  <span style={{ fontWeight: 500, color: "#1D1C1A" }}>{folder}</span>
                </div>
                <div style={{ color: "#6B675D" }}>{count} files</div>
              </div>
            ))}
          </div>
        </div>

        {/* Next Steps Onboarding */}
        <div>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "#6B675D", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>
            Next Steps
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ padding: "10px", borderRadius: "6px", background: "#FAF8F3", border: "1px solid #ECE7D9", fontSize: "12px" }}>
              <div style={{ fontWeight: 600, color: "#1D1C1A" }}>1. Review proposed structure</div>
              <div style={{ fontSize: "11px", color: "#6B675D", marginTop: "2px" }}>{proposalsCount} proposals waiting for human review.</div>
            </div>
            <div style={{ padding: "10px", borderRadius: "6px", background: "#FAF8F3", border: "1px solid #ECE7D9", fontSize: "12px" }}>
              <div style={{ fontWeight: 600, color: "#1D1C1A" }}>2. Chart key domains</div>
              <div style={{ fontSize: "11px", color: "#6B675D", marginTop: "2px" }}>Select any uncharted folder and promote to blueprint.</div>
            </div>
          </div>
        </div>
      </aside>
    );
  }

  // Active Entity Details
  const isViolation = selectedEntity.status === "violation";
  const isPinned = selectedEntity.status === "pinned";
  const isMapped = selectedEntity.status === "mapped";

  // Check matching rules
  const matchingConstraints = (graph?.constraints || []).filter(
    (c: any) => c.from === selectedEntity.id || (c.to || []).includes(selectedEntity.id)
  );

  // Check matching edges
  const matchingEdges = (graph?.code_edges || []).filter(
    (e: any) => e.from === selectedEntity.id || e.to === selectedEntity.id
  );

  const handleCopyPrompt = () => {
    const prompt = `Please review and fix the architectural boundary issue in ${selectedEntity.label} (${selectedEntity.path}). Enforce the constraint rules without altering the public API.`;
    navigator.clipboard.writeText(prompt);
    notify("Copied agent prompt to clipboard");
  };

  const handleAcceptPin = async () => {
    await run("Accepting Pin", async () => {
      await api.pin.propose({
        statement: `Protect critical behaviors in ${selectedEntity.label}`,
        kind: "decision",
        severity: "block",
        nodes: [selectedEntity.id],
      });
      notify(`Pinned ${selectedEntity.label}`);
    });
  };

  return (
    <aside className="node-inspector-pane" style={{ width: "350px", height: "100%", overflowY: "auto", background: "#FFFFFF", borderLeft: "1px solid #E5E0D5", display: "flex", flexDirection: "column" }}>
      {/* Header with Object Kind Badge */}
      <div style={{ padding: "16px 20px 12px 20px", borderBottom: "1px solid #E5E0D5" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
          <span
            style={{
              fontSize: "10px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.6px",
              background: "#ECE7D9",
              color: "#4A463E",
              padding: "2px 6px",
              borderRadius: "4px",
            }}
          >
            {selectedEntity.kind}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 600,
                color: isViolation ? "#B23A2B" : isMapped ? "#2E7A57" : "#8E8878",
                background: isViolation ? "#FDECE9" : isMapped ? "#E8F3ED" : "#FAF8F3",
                padding: "2px 8px",
                borderRadius: "12px",
              }}
            >
              ● {isViolation ? "Rule violation" : isMapped ? "Mapped" : "Uncharted"}
            </span>
            <button
              onClick={() => selectEntity(null)}
              style={{ background: "none", border: "none", fontSize: "16px", cursor: "pointer", color: "#8E8878" }}
            >
              ×
            </button>
          </div>
        </div>

        <h3 style={{ fontFamily: "Newsreader, serif", fontSize: "20px", fontWeight: 600, color: "#1D1C1A", margin: "0 0 2px 0" }}>
          {selectedEntity.label}
        </h3>
        <div style={{ fontSize: "12px", color: "#6B675D", fontFamily: "'IBM Plex Mono', monospace" }}>
          {selectedEntity.path}
        </div>
      </div>

      {/* Progressive Tab Bar */}
      <div style={{ display: "flex", borderBottom: "1px solid #E5E0D5", background: "#FAF8F3", padding: "0 12px" }}>
        {[
          { key: "overview", label: "Overview" },
          { key: "files", label: `Files ${selectedEntity.fileCount || 0}` },
          { key: "deps", label: `Deps ${matchingEdges.length}` },
          { key: "rules", label: "Rules" },
          { key: "history", label: "History" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            style={{
              background: "none",
              border: "none",
              borderBottom: activeTab === tab.key ? "2px solid #1D1C1A" : "2px solid transparent",
              padding: "8px 10px",
              fontSize: "12px",
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? "#1D1C1A" : "#6B675D",
              cursor: "pointer",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{ flex: 1, padding: "16px 20px", overflowY: "auto" }}>
        {activeTab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Priority Alert Slot: Violation Card */}
            {isViolation && (
              <div style={{ background: "#FDECE9", border: "1px solid #F3C6BE", borderRadius: "8px", padding: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#B23A2B", fontWeight: 600, fontSize: "12.5px" }}>
                  <span>▲</span> Rule violation detected
                </div>
                <div style={{ fontSize: "12px", color: "#682017", marginTop: "4px", lineHeight: "1.4" }}>
                  Forbidden dependency crossing established architectural boundary.
                </div>
                <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                  <button
                    onClick={() => setActiveLens("topology")}
                    style={{
                      background: "#FFFFFF",
                      border: "1px solid #DCD9D0",
                      padding: "5px 10px",
                      borderRadius: "5px",
                      fontSize: "11px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    View in Topology
                  </button>
                  <button
                    onClick={handleCopyPrompt}
                    style={{
                      background: "#B23A2B",
                      color: "#FFFFFF",
                      border: "none",
                      padding: "5px 10px",
                      borderRadius: "5px",
                      fontSize: "11px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Copy Agent Prompt
                  </button>
                </div>
              </div>
            )}

            {/* Priority Slot: Pin Recommendation */}
            {!isViolation && !isPinned && isMapped && (
              <div style={{ background: "#FAF3DB", border: "1px solid #EEDEA8", borderRadius: "8px", padding: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#87661A", fontWeight: 600, fontSize: "12px" }}>
                  <span>✦</span> Intent pin recommendation
                </div>
                <div style={{ fontSize: "11.5px", color: "#6A4E11", marginTop: "4px" }}>
                  Protect critical interface and behavior in {selectedEntity.label} from silent alteration.
                </div>
                <button
                  onClick={handleAcceptPin}
                  style={{
                    background: "#87661A",
                    color: "#FFFFFF",
                    border: "none",
                    padding: "5px 10px",
                    borderRadius: "5px",
                    fontSize: "11px",
                    fontWeight: 600,
                    marginTop: "8px",
                    cursor: "pointer",
                  }}
                >
                  Accept & Pin
                </button>
              </div>
            )}

            {/* Description */}
            <div>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#6B675D", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>
                Purpose / Description
              </div>
              <div style={{ fontSize: "13px", color: "#1D1C1A", lineHeight: "1.4" }}>
                {selectedEntity.description || selectedEntity.purpose || "No architectural description recorded yet. Click to define purpose."}
              </div>
            </div>

            {/* Quick 2x2 Stats Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <div style={{ background: "#FAF8F3", padding: "10px", borderRadius: "6px", border: "1px solid #ECE7D9" }}>
                <div style={{ fontSize: "11px", color: "#6B675D" }}>Total Files</div>
                <div style={{ fontSize: "15px", fontWeight: 600, color: "#1D1C1A" }}>{selectedEntity.fileCount || 0}</div>
              </div>
              <div style={{ background: "#FAF8F3", padding: "10px", borderRadius: "6px", border: "1px solid #ECE7D9" }}>
                <div style={{ fontSize: "11px", color: "#6B675D" }}>Active Rules</div>
                <div style={{ fontSize: "15px", fontWeight: 600, color: "#1D1C1A" }}>{matchingConstraints.length}</div>
              </div>
            </div>

            {/* Drill-down Action Button */}
            <button
              onClick={() => drillDown(selectedEntity.id)}
              style={{
                background: "#FAF8F3",
                border: "1px solid #DCD9D0",
                padding: "8px 12px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: 600,
                color: "#1D1C1A",
                cursor: "pointer",
                textAlign: "center",
              }}
            >
              Dive deeper inside {selectedEntity.label} →
            </button>
          </div>
        )}

        {activeTab === "files" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ fontSize: "12px", color: "#6B675D", marginBottom: "6px" }}>
              Showing files associated with {selectedEntity.label}:
            </div>
            {((selectedEntity.raw?.file_list || []) as string[]).slice(0, 30).map((file) => (
              <div
                key={file}
                style={{
                  padding: "6px 8px",
                  borderRadius: "4px",
                  background: "#FAF8F3",
                  fontSize: "11.5px",
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: "#1D1C1A",
                }}
              >
                {file}
              </div>
            ))}
          </div>
        )}

        {activeTab === "deps" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ fontSize: "12px", color: "#6B675D", marginBottom: "4px" }}>
              Relationships for {selectedEntity.label}:
            </div>
            {matchingEdges.map((edge: any, i: number) => (
              <div
                key={i}
                style={{
                  padding: "8px",
                  borderRadius: "6px",
                  background: edge.violation ? "#FDECE9" : "#FAF8F3",
                  border: `1px solid ${edge.violation ? "#F3C6BE" : "#ECE7D9"}`,
                  fontSize: "12px",
                }}
              >
                <div style={{ fontWeight: 600, color: edge.violation ? "#B23A2B" : "#1D1C1A" }}>
                  {edge.from} → {edge.to}
                </div>
                <div style={{ fontSize: "11px", color: "#6B675D", marginTop: "2px" }}>
                  {edge.count} file import(s) · {edge.violation ? "Violation" : "Permitted"}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === "rules" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ fontSize: "12px", color: "#6B675D", marginBottom: "4px" }}>
              Constraints & Rules ({matchingConstraints.length}):
            </div>
            {matchingConstraints.map((c: any, i: number) => (
              <div
                key={i}
                style={{
                  padding: "10px",
                  borderRadius: "6px",
                  background: "#FAF8F3",
                  border: "1px solid #ECE7D9",
                  fontSize: "12px",
                }}
              >
                <div style={{ fontWeight: 600, color: "#1D1C1A" }}>{c.id}</div>
                <div style={{ fontSize: "11.5px", color: "#6B675D", marginTop: "4px" }}>
                  {c.rule || c.kind}: {c.from} → {Array.isArray(c.to) ? c.to.join(", ") : String(c.to || "")}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === "history" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ fontSize: "12px", color: "#6B675D", marginBottom: "4px" }}>
              Turns that modified this node:
            </div>
            {(graph?.turns || []).slice(0, 5).map((turn: any) => (
              <div
                key={turn.id}
                style={{
                  padding: "10px",
                  borderRadius: "6px",
                  background: "#FAF8F3",
                  border: "1px solid #ECE7D9",
                  fontSize: "12px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, color: "#1D1C1A" }}>#{turn.id}</span>
                  <button
                    onClick={() => scrubToTurn(turn.id)}
                    style={{
                      background: "#FFFFFF",
                      border: "1px solid #DCD9D0",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      fontSize: "10.5px",
                      cursor: "pointer",
                    }}
                  >
                    Time-travel map
                  </button>
                </div>
                <div style={{ fontSize: "11.5px", color: "#4A463E", marginTop: "4px" }}>
                  {turn.summary || turn.prompt}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
};
