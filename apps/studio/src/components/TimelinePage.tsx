// apps/studio/src/components/TimelinePage.tsx
import React, { useEffect, useState } from "react";
import { useStore } from "../store";
import { api } from "../api";
import { TimelineScrubber4D } from "./TimelineScrubber4D";

export const TimelinePage: React.FC = () => {
  const { graph, notify, run, scrubToTurn, activeTurn } = useStore();
  const [turns, setTurns] = useState<any[]>([]);
  const [losses, setLosses] = useState<any[]>([]);
  const [selectedTurn, setSelectedTurn] = useState<any | null>(null);
  const [diffText, setDiffText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [turnList, lossList] = await Promise.all([
        api.timeline.list(40),
        api.timeline.losses(),
      ]);
      setTurns(turnList || []);
      setLosses(lossList || []);
      if (turnList && turnList.length > 0) {
        setSelectedTurn(turnList[0]);
        loadDiff(turnList[0].id);
      }
    } catch (e: any) {
      notify(`Could not load timeline: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const loadDiff = async (turnId: string) => {
    try {
      const res = await api.timeline.diff(turnId);
      setDiffText(typeof res === "string" ? res : JSON.stringify(res, null, 2));
    } catch {
      setDiffText("No patch available for this turn.");
    }
  };

  const handleSelectTurn = (t: any) => {
    setSelectedTurn(t);
    loadDiff(t.id);
  };

  const handleRestoreFeature = async (featureName: string) => {
    await run(`Restoring ${featureName}`, async () => {
      await api.timeline.restore(featureName, true);
      notify(`Opened restore turn for ${featureName}`);
      loadData();
    });
  };

  return (
    <div className="timeline-page" style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", background: "#FAF8F3" }}>
      {/* Page Title & 4D Scrub Bar */}
      <div style={{ padding: "16px 24px 12px 24px", borderBottom: "1px solid #E5E0D5", background: "#FFFFFF" }}>
        <h2 style={{ fontFamily: "Newsreader, serif", fontSize: "24px", fontWeight: 600, color: "#1D1C1A", margin: "0 0 4px 0" }}>
          Timeline & 4D Turn Stream
        </h2>
        <div style={{ fontSize: "13px", color: "#6B675D", fontFamily: "'IBM Plex Sans', sans-serif" }}>
          Intent-indexed history, leaf-to-root turn judgments, patch receipts, and collateral loss recovery.
        </div>
      </div>

      <div style={{ borderBottom: "1px solid #E5E0D5", background: "#FFFFFF" }}>
        <TimelineScrubber4D />
      </div>

      {/* Main Split: Turn Stream (Left) + Detail & Diff Receipt (Right) */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Left: Chronological Turns List */}
        <div style={{ width: "380px", borderRight: "1px solid #E5E0D5", overflowY: "auto", background: "#FFFFFF", padding: "16px" }}>
          {/* Collateral Loss Alert Card (if any losses detected) */}
          {losses.length > 0 && (
            <div style={{ background: "#FAF3DB", border: "1px solid #EEDEA8", borderRadius: "8px", padding: "12px", marginBottom: "16px" }}>
              <div style={{ fontWeight: 600, color: "#87661A", fontSize: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                <span>✦</span> {losses.length} Collateral Loss(es) Detected
              </div>
              <div style={{ fontSize: "11px", color: "#6A4E11", marginTop: "4px" }}>
                Features that were implemented and vanished in subsequent turns.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
                {losses.slice(0, 3).map((l: any, idx: number) => (
                  <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11.5px" }}>
                    <span style={{ fontWeight: 500, color: "#1D1C1A" }}>{l.feature || l.id}</span>
                    <button
                      onClick={() => handleRestoreFeature(l.feature || l.id)}
                      style={{
                        background: "#87661A",
                        color: "#FFFFFF",
                        border: "none",
                        padding: "2px 8px",
                        borderRadius: "4px",
                        fontSize: "10.5px",
                        cursor: "pointer",
                      }}
                    >
                      Restore 3-way
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ fontSize: "11px", fontWeight: 700, color: "#6B675D", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" }}>
            Turns History
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {turns.map((t) => {
              const isSelected = selectedTurn?.id === t.id;
              const isTurnActive = activeTurn === t.id;
              return (
                <div
                  key={t.id}
                  onClick={() => handleSelectTurn(t)}
                  style={{
                    padding: "12px",
                    borderRadius: "8px",
                    background: isSelected ? "#F4EFE6" : "#FAF8F3",
                    border: `1px solid ${isSelected ? "#1D1C1A" : "#ECE7D9"}`,
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 700, color: "#1D1C1A", fontSize: "13px" }}>#{t.id}</span>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <span
                        style={{
                          fontSize: "9.5px",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          padding: "1px 5px",
                          borderRadius: "3px",
                          background: t.status === "committed" ? "#E8F3ED" : "#FAF3DB",
                          color: t.status === "committed" ? "#2E7A57" : "#87661A",
                        }}
                      >
                        {t.status}
                      </span>
                      {isTurnActive && (
                        <span style={{ fontSize: "9.5px", background: "#2E7A57", color: "#FFFFFF", padding: "1px 5px", borderRadius: "3px", fontWeight: 600 }}>
                          Map active
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: "12px", color: "#1D1C1A", lineHeight: "1.3" }}>
                    {t.summary || t.prompt}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", color: "#8E8878", marginTop: "4px" }}>
                    <span>{t.origin || "human"}</span>
                    <span>{t.ts ? new Date(t.ts).toLocaleDateString() : ""}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Turn Judgment & Diff Viewer */}
        <div style={{ flex: 1, padding: "20px 24px", overflowY: "auto", background: "#FAF8F3" }}>
          {selectedTurn ? (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <div>
                  <h3 style={{ fontFamily: "Newsreader, serif", fontSize: "20px", fontWeight: 600, color: "#1D1C1A", margin: 0 }}>
                    Turn #{selectedTurn.id} Receipt
                  </h3>
                  <div style={{ fontSize: "12px", color: "#6B675D", marginTop: "2px" }}>
                    {selectedTurn.ts} · Origin: {selectedTurn.origin || "human"}
                  </div>
                </div>
                <button
                  onClick={() => scrubToTurn(selectedTurn.id)}
                  style={{
                    background: "#2E7A57",
                    color: "#FFFFFF",
                    border: "none",
                    padding: "6px 14px",
                    borderRadius: "6px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Scrub Map to #{selectedTurn.id}
                </button>
              </div>

              {/* Summary / Prompt Box */}
              <div style={{ background: "#FFFFFF", border: "1px solid #E5E0D5", borderRadius: "8px", padding: "16px", marginBottom: "20px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#6B675D", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>
                  Turn Statement
                </div>
                <div style={{ fontSize: "14px", color: "#1D1C1A", fontWeight: 500 }}>
                  {selectedTurn.summary || selectedTurn.prompt}
                </div>
              </div>

              {/* Patch Diff Box */}
              <div style={{ background: "#FFFFFF", border: "1px solid #E5E0D5", borderRadius: "8px", padding: "16px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#6B675D", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>
                  Diff Patch
                </div>
                <pre
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: "11.5px",
                    lineHeight: "1.4",
                    color: "#1D1C1A",
                    background: "#FAF8F3",
                    padding: "12px",
                    borderRadius: "6px",
                    overflowX: "auto",
                    whiteSpace: "pre-wrap",
                    maxHeight: "400px",
                  }}
                >
                  {diffText || "Loading diff..."}
                </pre>
              </div>
            </div>
          ) : (
            <div style={{ color: "#6B675D", fontSize: "13px" }}>Select a turn from the left list to inspect its receipt.</div>
          )}
        </div>
      </div>
    </div>
  );
};
