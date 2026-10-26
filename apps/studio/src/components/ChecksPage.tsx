// apps/studio/src/components/ChecksPage.tsx
import React, { useEffect, useState } from "react";
import { useStore } from "../store";
import { api } from "../api";

export const ChecksPage: React.FC = () => {
  const { graph, notify, run } = useStore();
  const [pins, setPins] = useState<any[]>([]);
  const [checks, setChecks] = useState<any[]>([]);
  const [slider, setSlider] = useState<number>(3);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [pinList, checkList] = await Promise.all([
        api.pin.list(),
        api.check.list(true),
      ]);
      setPins(pinList || []);
      setChecks(checkList || []);
      if (graph?.policy?.pins?.slider) {
        setSlider(graph.policy.pins.slider);
      }
    } catch (e: any) {
      notify(`Could not load checks: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSliderChange = async (val: number) => {
    setSlider(val);
    await run(`Updating Pin Budget`, async () => {
      await api.pin.budget(val);
      notify(`Pin budget set to ${val}`);
    });
  };

  const handleRetirePin = async (id: string) => {
    await run(`Retiring pin ${id}`, async () => {
      await api.pin.retire(id);
      notify(`Retired pin ${id}`);
      loadData();
    });
  };

  const handleRemoveCheck = async (id: string) => {
    await run(`Removing check ${id}`, async () => {
      await api.check.remove(id);
      notify(`Removed check ${id}`);
      loadData();
    });
  };

  const constraints = graph?.constraints || [];
  const guardrails = graph?.guardrails || [];

  return (
    <div className="checks-page" style={{ height: "100%", width: "100%", overflowY: "auto", background: "#FAF8F3", padding: "24px 32px" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <h2 style={{ fontFamily: "Newsreader, serif", fontSize: "26px", fontWeight: 600, color: "#1D1C1A", margin: "0 0 4px 0" }}>
          Checks, Constraints & Pins
        </h2>
        <div style={{ fontSize: "13px", color: "#6B675D", fontFamily: "'IBM Plex Sans', sans-serif" }}>
          Deterministic tripwires, standing architectural boundaries, and intent lock pins.
        </div>
      </div>

      {/* Pin Budget Slider Card */}
      <div style={{ background: "#FFFFFF", border: "1px solid #E5E0D5", borderRadius: "10px", padding: "18px 24px", marginBottom: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: "14px", color: "#1D1C1A" }}>Pin Budget Multiplier</div>
            <div style={{ fontSize: "12px", color: "#6B675D", marginTop: "2px" }}>
              Controls how strictly AFWE caps active intent pins (1 relaxed · 3 balanced · 5 strict).
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <input
              type="range"
              min="1"
              max="5"
              value={slider}
              onChange={(e) => handleSliderChange(parseInt(e.target.value, 10))}
              style={{ width: "140px", cursor: "pointer" }}
            />
            <span style={{ fontWeight: 700, fontSize: "15px", color: "#1D1C1A", minWidth: "20px" }}>{slider}</span>
          </div>
        </div>
      </div>

      {/* Grid of Sections */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
        {/* Active Pins Card */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E5E0D5", borderRadius: "10px", padding: "18px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
            <div style={{ fontWeight: 600, fontSize: "15px", color: "#1D1C1A", display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ color: "#C89D54" }}>✦</span> Active Pins ({pins.filter((p) => p.status === "active").length})
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {pins.filter((p) => p.status === "active").length === 0 ? (
              <div style={{ fontSize: "12px", color: "#8E8878" }}>No active pins yet. Pin critical behaviors from the map.</div>
            ) : (
              pins
                .filter((p) => p.status === "active")
                .map((pin) => (
                  <div
                    key={pin.id}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "6px",
                      background: "#FAF8F3",
                      border: "1px solid #ECE7D9",
                      fontSize: "12px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: "10px",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: "#1D1C1A" }}>{pin.statement}</div>
                      <div style={{ fontSize: "11px", color: "#6B675D", marginTop: "2px" }}>
                        Attaches to: {(pin.attaches || []).join(", ") || "Global"} · {pin.severity}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRetirePin(pin.id)}
                      style={{
                        background: "none",
                        border: "1px solid #DCD9D0",
                        padding: "2px 8px",
                        borderRadius: "4px",
                        fontSize: "11px",
                        color: "#8E8878",
                        cursor: "pointer",
                      }}
                    >
                      Retire
                    </button>
                  </div>
                ))
            )}
          </div>
        </div>

        {/* Materialized Tripwires (CheckSpecs) */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E5E0D5", borderRadius: "10px", padding: "18px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
            <div style={{ fontWeight: 600, fontSize: "15px", color: "#1D1C1A", display: "flex", alignItems: "center", gap: "6px" }}>
              <span>✓</span> Standing Tripwire Checks ({checks.filter((c) => c.status === "active").length})
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {checks.filter((c) => c.status === "active").length === 0 ? (
              <div style={{ fontSize: "12px", color: "#8E8878" }}>No active tripwires generated yet.</div>
            ) : (
              checks
                .filter((c) => c.status === "active")
                .map((chk) => (
                  <div
                    key={chk.id}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "6px",
                      background: "#FAF8F3",
                      border: "1px solid #ECE7D9",
                      fontSize: "12px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: "10px",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: "#1D1C1A" }}>{chk.title || chk.id}</div>
                      <div style={{ fontSize: "11px", color: "#6B675D", marginTop: "2px" }}>
                        Claim: {chk.claim?.type} · Authored by: {chk.authored_by}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveCheck(chk.id)}
                      style={{
                        background: "none",
                        border: "1px solid #DCD9D0",
                        padding: "2px 8px",
                        borderRadius: "4px",
                        fontSize: "11px",
                        color: "#8E8878",
                        cursor: "pointer",
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))
            )}
          </div>
        </div>

        {/* Blueprint Boundary Constraints */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E5E0D5", borderRadius: "10px", padding: "18px 20px" }}>
          <div style={{ fontWeight: 600, fontSize: "15px", color: "#1D1C1A", marginBottom: "14px" }}>
            Architectural Constraints ({constraints.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {constraints.map((c: any) => (
              <div
                key={c.id}
                style={{
                  padding: "10px 12px",
                  borderRadius: "6px",
                  background: "#FAF8F3",
                  border: "1px solid #ECE7D9",
                  fontSize: "12px",
                }}
              >
                <div style={{ fontWeight: 600, color: "#1D1C1A" }}>{c.id}</div>
                <div style={{ fontSize: "11.5px", color: "#6B675D", marginTop: "3px" }}>
                  {c.from} {c.kind} {(c.to || []).join(", ")}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Guardrails */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E5E0D5", borderRadius: "10px", padding: "18px 20px" }}>
          <div style={{ fontWeight: 600, fontSize: "15px", color: "#1D1C1A", marginBottom: "14px" }}>
            Guardrails ({guardrails.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {guardrails.length === 0 ? (
              <div style={{ fontSize: "12px", color: "#8E8878" }}>No active/passive guardrails declared.</div>
            ) : (
              guardrails.map((g: any) => (
                <div
                  key={g.id}
                  style={{
                    padding: "10px 12px",
                    borderRadius: "6px",
                    background: "#FAF8F3",
                    border: "1px solid #ECE7D9",
                    fontSize: "12px",
                  }}
                >
                  <div style={{ fontWeight: 600, color: "#1D1C1A" }}>{g.statement}</div>
                  <div style={{ fontSize: "11px", color: "#6B675D", marginTop: "3px" }}>
                    Mode: {g.mode} · Severity: {g.severity || "warning"}
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
