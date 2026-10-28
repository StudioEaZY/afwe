// apps/studio/src/components/SettingsPage.tsx
import React, { useState } from "react";
import { Clock, Lock, Unlock } from "lucide-react";
import { useStore } from "../store";
import { api } from "../api";
import { RADIAL_PALETTE_PRESETS } from "../lib/palettes";

export const SettingsPage: React.FC = () => {
  const {
    graph,
    notify,
    run,
    refresh,
    prefs,
    setRadialPalette,
    setTopologyPalette,
    setGraceSeconds,
    setIgnoreGlobs: setStoreIgnoreGlobs,
    scheduleQuarantineAction,
  } = useStore();

  const [exploreMode, setExploreMode] = useState<boolean>(!!graph?.policy?.explore_mode);
  const [materializeOutput, setMaterializeOutput] = useState<any | null>(null);
  const [ignoreGlobs, setIgnoreGlobs] = useState<string[]>(
    prefs.ignoreGlobs || ["dist/**", "target/**", "node_modules/**", "**/*.spec.ts", "**/*.test.tsx"]
  );
  const [newGlob, setNewGlob] = useState("");

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

  const handleCreateSnapshot = () => {
    notify(`Created contingency snapshot: .afwe/snapshots/explore-${Date.now()}`);
  };

  const handleTestQuarantine = () => {
    scheduleQuarantineAction({
      id: "test-quarantine",
      label: "Test Cascading Action",
      description: "Testing 10-second quarantine grace period before agent dispatch",
      isCascading: true,
      execute: async () => {
        notify("Quarantine elapsed. Test action executed!");
      },
    });
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

  const handleAddGlob = () => {
    if (newGlob.trim()) {
      const updated = [...ignoreGlobs, newGlob.trim()];
      setIgnoreGlobs(updated);
      setStoreIgnoreGlobs(updated);
      setNewGlob("");
      notify(`Added ignore glob: ${newGlob.trim()}`);
    }
  };

  const handleRemoveGlob = (idx: number) => {
    const updated = ignoreGlobs.filter((_, i) => i !== idx);
    setIgnoreGlobs(updated);
    setStoreIgnoreGlobs(updated);
  };

  const modelProfiles = graph?.calibration?.models || {};

  return (
    <div
      className="settings-page"
      style={{
        height: "100%",
        width: "100%",
        overflowY: "auto",
        background: "#FAF8F4",
        padding: "24px 32px",
        color: "#1D1C1A",
        fontFamily: "'IBM Plex Sans', sans-serif",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <h2 style={{ fontFamily: "Newsreader, serif", fontSize: "28px", fontWeight: 600, color: "#1D1C1A", margin: "0 0 4px 0" }}>
          Engine Settings & Governance Policy
        </h2>
        <div style={{ fontSize: "13px", color: "#6E685F" }}>
          Two-tier quarantine grace period, graph color systems, explore mode snapshots, and calibration profiles.
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "840px" }}>
        {/* 1. Two-Tier Undo & Quarantine Grace Period Settings */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E5E0D5", borderRadius: "10px", padding: "22px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: "16px", color: "#1D1C1A", display: "flex", alignItems: "center", gap: "8px" }}>
                <Clock size={16} /> Two-Tier Undo & Quarantine Grace Period
              </div>
              <div style={{ fontSize: "12.5px", color: "#6E685F", marginTop: "4px", lineHeight: "1.45" }}>
                Because AFWE actions cascade into the codebase (modifying files, triggering AI agents, and regenerating git/CI hooks), destructive actions are quarantined for a countdown grace period before execution.
              </div>
            </div>
            <button
              onClick={handleTestQuarantine}
              style={{
                background: "#FAF8F4",
                border: "1px solid #DCD9D0",
                padding: "6px 14px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: 600,
                color: "#1D1C1A",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              Test Quarantine Bar
            </button>
          </div>

          <div style={{ background: "#FAF8F4", border: "1px solid #ECE7D9", borderRadius: "8px", padding: "14px", marginTop: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: "13px", color: "#1D1C1A" }}>Cascading Action Grace Countdown</div>
                <div style={{ fontSize: "11.5px", color: "#6E685F", marginTop: "2px" }}>
                  Time held in quarantine before dispatching fixes to AI agents or touching files.
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <input
                  type="range"
                  min="5"
                  max="30"
                  step="5"
                  value={prefs.graceSeconds || 10}
                  onChange={(e) => setGraceSeconds(parseInt(e.target.value, 10))}
                  style={{ width: "120px", cursor: "pointer" }}
                />
                <span style={{ fontWeight: 700, fontSize: "14px", color: "#1D1C1A", minWidth: "35px" }}>
                  {prefs.graceSeconds || 10}s
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 2. Graph Color System (Radial vs Topology) */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E5E0D5", borderRadius: "10px", padding: "22px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ fontWeight: 600, fontSize: "16px", color: "#1D1C1A", marginBottom: "4px" }}>
            Graph Color System
          </div>
          <div style={{ fontSize: "12.5px", color: "#6E685F", marginBottom: "16px", lineHeight: "1.4" }}>
            Separated color engines ensure Radial sunbursts have high adjacent contrast and luminance stepping, while Topology maps maintain translucent territory washes behind crisp feature cards.
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            {/* Radial Palette Picker */}
            <div style={{ background: "#FAF8F4", border: "1px solid #ECE7D9", borderRadius: "8px", padding: "14px" }}>
              <div style={{ fontWeight: 600, fontSize: "13px", color: "#1D1C1A", marginBottom: "4px" }}>
                Radial Sunburst Palette
              </div>
              <div style={{ fontSize: "11px", color: "#6E685F", marginBottom: "10px" }}>
                Controls multi-hue domain families and ring luminance steps.
              </div>
              <select
                value={prefs.radialPalette || "editorial"}
                onChange={(e) => setRadialPalette(e.target.value)}
                style={{
                  width: "100%",
                  padding: "7px 10px",
                  borderRadius: "6px",
                  border: "1px solid #DCD9D0",
                  fontSize: "12px",
                  background: "#FFFFFF",
                  cursor: "pointer",
                }}
              >
                {Object.entries(RADIAL_PALETTE_PRESETS).map(([k, p]) => (
                  <option key={k} value={k}>
                    {p.label}
                  </option>
                ))}
              </select>

              {/* Swatch Preview */}
              <div style={{ display: "flex", gap: "6px", marginTop: "12px" }}>
                {(RADIAL_PALETTE_PRESETS[prefs.radialPalette || "editorial"]?.families || []).slice(0, 5).map((fam, i) => (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}>
                    <div style={{ height: "14px", background: fam.ring1, borderRadius: "2px" }} />
                    <div style={{ height: "14px", background: fam.ring2, borderRadius: "2px" }} />
                    <div style={{ height: "14px", background: fam.ring3, borderRadius: "2px" }} />
                  </div>
                ))}
              </div>
            </div>

            {/* Topology Palette Picker */}
            <div style={{ background: "#FAF8F4", border: "1px solid #ECE7D9", borderRadius: "8px", padding: "14px" }}>
              <div style={{ fontWeight: 600, fontSize: "13px", color: "#1D1C1A", marginBottom: "4px" }}>
                Topology Constellation Palette
              </div>
              <div style={{ fontSize: "11px", color: "#6E685F", marginBottom: "10px" }}>
                Controls translucent territory fills and semantic ribbon status.
              </div>
              <select
                value={prefs.topologyPalette || "cartographic"}
                onChange={(e) => setTopologyPalette(e.target.value)}
                style={{
                  width: "100%",
                  padding: "7px 10px",
                  borderRadius: "6px",
                  border: "1px solid #DCD9D0",
                  fontSize: "12px",
                  background: "#FFFFFF",
                  cursor: "pointer",
                }}
              >
                <option value="cartographic">Cartographic Tint (Default)</option>
                <option value="parchment">Warm Parchment</option>
                <option value="monochrome">Crisp Monochrome + Semantic Accents</option>
              </select>

              {/* Swatch Preview */}
              <div style={{ display: "flex", gap: "6px", marginTop: "12px" }}>
                <div style={{ flex: 1, height: "46px", background: "#EBF3EE", border: "1px solid #6A987E", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9.5px", color: "#256345", fontWeight: 600 }}>
                  Services
                </div>
                <div style={{ flex: 1, height: "46px", background: "#FBF5EB", border: "1px solid #BA986A", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9.5px", color: "#876226", fontWeight: 600 }}>
                  Frontend
                </div>
                <div style={{ flex: 1, height: "46px", background: "#FDECE9", border: "1px solid #C94A38", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9.5px", color: "#A82B1B", fontWeight: 600 }}>
                  Violation
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Explore Mode & Contingency Snapshots */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E5E0D5", borderRadius: "10px", padding: "22px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: "16px", color: "#1D1C1A", display: "flex", alignItems: "center", gap: "8px" }}>
                {exploreMode ? <Unlock size={16} /> : <Lock size={16} />} Explore Mode ({exploreMode ? "Unlocked" : "Enforced"})
              </div>
              <div style={{ fontSize: "12.5px", color: "#6E685F", marginTop: "4px", lineHeight: "1.4" }}>
                When enabled, AFWE temporarily converts blocking checks into warnings so you can prototype rapidly without gate interruption. Locking runs full verification.
              </div>
            </div>
            <button
              onClick={handleToggleExplore}
              style={{
                background: exploreMode ? "#2E7A57" : "#FAF8F4",
                color: exploreMode ? "#FFFFFF" : "#1D1C1A",
                border: "1px solid #DCD9D0",
                padding: "8px 16px",
                borderRadius: "6px",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              {exploreMode ? "Lock Engine (Enforce)" : "Unlock (Explore)"}
            </button>
          </div>

          <div style={{ marginTop: "16px", paddingTop: "14px", borderTop: "1px solid #ECE7D9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "#1D1C1A" }}>Pre-Explore Contingency Snapshot</div>
              <div style={{ fontSize: "11.5px", color: "#6E685F" }}>
                Save a local recovery point before exploratory refactoring.
              </div>
            </div>
            <button
              onClick={handleCreateSnapshot}
              style={{
                background: "#FAF8F4",
                border: "1px solid #DCD9D0",
                padding: "5px 12px",
                borderRadius: "5px",
                fontSize: "11.5px",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              Create Snapshot Tag
            </button>
          </div>
        </div>

        {/* 4. Scoped Ignore Globs Manager */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E5E0D5", borderRadius: "10px", padding: "22px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ fontWeight: 600, fontSize: "16px", color: "#1D1C1A", marginBottom: "4px" }}>
            Scoped Ignore Globs
          </div>
          <div style={{ fontSize: "12.5px", color: "#6E685F", marginBottom: "14px" }}>
            File patterns excluded from boundary verification and check generation.
          </div>

          <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
            <input
              type="text"
              placeholder="e.g. dist/** or **/*.mock.ts"
              value={newGlob}
              onChange={(e) => setNewGlob(e.target.value)}
              style={{
                flex: 1,
                padding: "6px 12px",
                borderRadius: "6px",
                border: "1px solid #DCD9D0",
                fontSize: "12px",
                fontFamily: "'IBM Plex Mono', monospace",
              }}
            />
            <button
              onClick={handleAddGlob}
              style={{
                background: "#1D1C1A",
                color: "#FFFFFF",
                border: "none",
                padding: "6px 14px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Add Glob
            </button>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {ignoreGlobs.map((glob, idx) => (
              <span
                key={idx}
                style={{
                  background: "#FAF8F4",
                  border: "1px solid #ECE7D9",
                  padding: "4px 8px",
                  borderRadius: "5px",
                  fontSize: "11px",
                  fontFamily: "'IBM Plex Mono', monospace",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span>{glob}</span>
                <span onClick={() => handleRemoveGlob(idx)} style={{ cursor: "pointer", color: "#8E8878", fontWeight: "bold" }}>
                  ✕
                </span>
              </span>
            ))}
          </div>
        </div>

        {/* 5. Tripwire Materialization Manager */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E5E0D5", borderRadius: "10px", padding: "22px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ fontWeight: 600, fontSize: "16px", color: "#1D1C1A", marginBottom: "4px" }}>
            Tripwire Materialization
          </div>
          <div style={{ fontSize: "12.5px", color: "#6E685F", marginBottom: "16px", lineHeight: "1.4" }}>
            Deploy standing BLAKE3 deterministic checks directly into developer workflows without requiring active AFWE daemon processes.
          </div>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              onClick={() => handleMaterialize("git_hooks")}
              style={{ background: "#FAF8F4", border: "1px solid #DCD9D0", padding: "8px 14px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
            >
              Materialize Git Pre-Commit
            </button>
            <button
              onClick={() => handleMaterialize("ci")}
              style={{ background: "#FAF8F4", border: "1px solid #DCD9D0", padding: "8px 14px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
            >
              Materialize GitHub Actions CI
            </button>
            <button
              onClick={() => handleMaterialize("claude_hooks")}
              style={{ background: "#FAF8F4", border: "1px solid #DCD9D0", padding: "8px 14px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
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
            <div style={{ marginTop: "14px", background: "#FAF8F4", padding: "12px", borderRadius: "6px", border: "1px solid #ECE7D9", fontSize: "11.5px", fontFamily: "'IBM Plex Mono', monospace" }}>
              {JSON.stringify(materializeOutput, null, 2)}
            </div>
          )}
        </div>

        {/* 6. Model Calibration Trust Profiles */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E5E0D5", borderRadius: "10px", padding: "22px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ fontWeight: 600, fontSize: "16px", color: "#1D1C1A", marginBottom: "4px" }}>
            Model Calibration Trust Profiles
          </div>
          <div style={{ fontSize: "12.5px", color: "#6E685F", marginBottom: "16px" }}>
            Per-model tracking of assumption accuracy, verified evidence rate, and human confirmations.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {Object.keys(modelProfiles).length === 0 ? (
              <div style={{ fontSize: "12px", color: "#8E8878" }}>No external model profiles recorded yet.</div>
            ) : (
              Object.entries(modelProfiles).map(([modelId, prof]: [string, any]) => (
                <div key={modelId} style={{ padding: "12px", borderRadius: "6px", background: "#FAF8F4", border: "1px solid #ECE7D9", fontSize: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontWeight: 600, color: "#1D1C1A" }}>{modelId}</div>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "#2E7A57" }}>
                      Trust Factor: {(prof.trust_factor ?? 1.0).toFixed(2)}×
                    </span>
                  </div>
                  <div style={{ fontSize: "11px", color: "#6E685F", marginTop: "2px" }}>
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
