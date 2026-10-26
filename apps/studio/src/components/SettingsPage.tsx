// apps/studio/src/components/SettingsPage.tsx
import React, { useState } from "react";
import { useStore } from "../store";
import { api } from "../api";

export const SettingsPage: React.FC = () => {
  const { graph, notify, run, refresh } = useStore();
  const [exploreMode, setExploreMode] = useState<boolean>(!!graph?.policy?.explore_mode);
  const [materializeOutput, setMaterializeOutput] = useState<any | null>(null);

  const handleToggleExplore = async () => {
    if (exploreMode) {
      await run("Locking explore mode", async () => {
        await api.explore.lock();
        setExploreMode(false);
        notify("Explore mode locked. Blocking checks are enforced.");
        refresh();
      });
    } else {
      await run("Unlocking explore mode", async () => {
        await api.explore.unlock();
        setExploreMode(true);
        notify("Explore mode unlocked: blocking checks downgraded to warnings.");
        refresh();
      });
    }
  };

  const handleMaterialize = async (target: string) => {
    await run(`Materializing ${target}`, async () => {
      const opts: any = { apply: true };
      if (target === "git_hooks") opts.git_hooks = true;
      if (target === "ci") opts.ci = true;
      if (target === "claude_hooks") opts.claude_hooks = true;
      if (target === "all") {
        opts.git_hooks = true;
        opts.ci = true;
        opts.claude_hooks = true;
      }
      const res = await api.materialize(opts);
      setMaterializeOutput(res);
      notify(`Materialized ${target}`);
    });
  };

  const modelProfiles = graph?.calibration?.models || {};

  return (
    <div className="settings-page" style={{ height: "100%", width: "100%", overflowY: "auto", background: "#FAF8F3", padding: "24px 32px" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <h2 style={{ fontFamily: "Newsreader, serif", fontSize: "26px", fontWeight: 600, color: "#1D1C1A", margin: "0 0 4px 0" }}>
          Engine Settings & Governance Policy
        </h2>
        <div style={{ fontSize: "13px", color: "#6B675D", fontFamily: "'IBM Plex Sans', sans-serif" }}>
          Explore mode prototyping, tripwire materialization, graduation policy, and model calibration trust profiles.
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "800px" }}>
        {/* Explore Mode Card */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E5E0D5", borderRadius: "10px", padding: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: "16px", color: "#1D1C1A", display: "flex", alignItems: "center", gap: "8px" }}>
                <span>{exploreMode ? "🔓" : "🔒"}</span> Explore Mode ({exploreMode ? "Unlocked" : "Enforced"})
              </div>
              <div style={{ fontSize: "12.5px", color: "#6B675D", marginTop: "4px", lineHeight: "1.4" }}>
                When enabled, AFWE temporarily converts blocking checks into warnings so you can prototype rapidly without gate interruption. Locking runs full verification.
              </div>
            </div>
            <button
              onClick={handleToggleExplore}
              style={{
                background: exploreMode ? "#2E7A57" : "#FAF8F3",
                color: exploreMode ? "#FFFFFF" : "#1D1C1A",
                border: "1px solid #DCD9D0",
                padding: "8px 16px",
                borderRadius: "6px",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {exploreMode ? "Lock Engine (Enforce)" : "Unlock (Explore)"}
            </button>
          </div>
        </div>

        {/* Tripwire Materialization Manager */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E5E0D5", borderRadius: "10px", padding: "20px" }}>
          <div style={{ fontWeight: 600, fontSize: "16px", color: "#1D1C1A", marginBottom: "6px" }}>
            Tripwire Materialization
          </div>
          <div style={{ fontSize: "12.5px", color: "#6B675D", marginBottom: "16px", lineHeight: "1.4" }}>
            Deploy standing BLAKE3 deterministic checks directly into developer workflows without requiring active AFWE daemon processes.
          </div>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              onClick={() => handleMaterialize("git_hooks")}
              style={{ background: "#FAF8F3", border: "1px solid #DCD9D0", padding: "8px 14px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
            >
              Materialize Git Pre-Commit
            </button>
            <button
              onClick={() => handleMaterialize("ci")}
              style={{ background: "#FAF8F3", border: "1px solid #DCD9D0", padding: "8px 14px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
            >
              Materialize GitHub Actions CI
            </button>
            <button
              onClick={() => handleMaterialize("claude_hooks")}
              style={{ background: "#FAF8F3", border: "1px solid #DCD9D0", padding: "8px 14px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
            >
              Materialize Claude Hooks
            </button>
            <button
              onClick={() => handleMaterialize("all")}
              style={{ background: "#2E7A57", color: "#FFFFFF", border: "none", padding: "8px 16px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
            >
              Materialize All
            </button>
          </div>

          {materializeOutput && (
            <div style={{ marginTop: "14px", background: "#FAF8F3", padding: "12px", borderRadius: "6px", border: "1px solid #ECE7D9", fontSize: "11.5px", fontFamily: "'IBM Plex Mono', monospace" }}>
              {JSON.stringify(materializeOutput, null, 2)}
            </div>
          )}
        </div>

        {/* Model Calibration Trust Profiles */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E5E0D5", borderRadius: "10px", padding: "20px" }}>
          <div style={{ fontWeight: 600, fontSize: "16px", color: "#1D1C1A", marginBottom: "6px" }}>
            Model Calibration Trust Profiles
          </div>
          <div style={{ fontSize: "12.5px", color: "#6B675D", marginBottom: "16px" }}>
            Per-model tracking of assumption accuracy, verified evidence rate, and human confirmations.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {Object.keys(modelProfiles).length === 0 ? (
              <div style={{ fontSize: "12px", color: "#8E8878" }}>No external model profiles recorded yet.</div>
            ) : (
              Object.entries(modelProfiles).map(([modelId, prof]: [string, any]) => (
                <div key={modelId} style={{ padding: "12px", borderRadius: "6px", background: "#FAF8F3", border: "1px solid #ECE7D9", fontSize: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontWeight: 600, color: "#1D1C1A" }}>{modelId}</div>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "#2E7A57" }}>
                      Trust Factor: {(prof.trust_factor ?? 1.0).toFixed(2)}×
                    </span>
                  </div>
                  <div style={{ fontSize: "11px", color: "#6B675D", marginTop: "2px" }}>
                    Accepted by human: {prof.human_accepted ?? prof.confirmed_by_human ?? 0} · Rejected: {prof.human_rejected ?? prof.rejected_by_human ?? 0}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
