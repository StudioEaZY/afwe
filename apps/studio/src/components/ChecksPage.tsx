// apps/studio/src/components/ChecksPage.tsx
import React, { useEffect, useState } from "react";
import { useStore } from "../store";
import { api } from "../api";
import { extractAttachmentItems, formatAttachment } from "../lib/hierarchy";

export const ChecksPage: React.FC = () => {
  const {
    graph,
    notify,
    run,
    jumpToNodeOnMap,
    jumpToTurn,
    openCodePreview,
    openConsequenceModal,
    scheduleQuarantineAction,
  } = useStore();

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

  const handleRetirePin = (pin: any) => {
    openConsequenceModal({
      title: "Retire Intent Pin",
      statement: `Retire intent pin ${pin.id}: "${pin.statement}"`,
      isCascading: false,
      impact: [
        `Turn commit gates will stop blocking architectural changes to: ${formatAttachment(pin.attaches)}`,
        `Pin status will move to retired (soft archive).`,
        `You can undo this anytime during the session.`,
      ],
      confirmLabel: "Retire Pin",
      onConfirm: () => {
        scheduleQuarantineAction({
          id: `retire-pin-${pin.id}`,
          label: `Retire Pin: ${pin.id}`,
          description: `Retiring intent pin "${pin.statement}"`,
          isCascading: false,
          execute: async () => {
            await api.pin.retire(pin.id);
            notify(`Retired pin ${pin.id}`);
            loadData();
          },
        });
      },
      onCancel: () => {},
    });
  };

  const handleRemoveCheck = (chk: any) => {
    openConsequenceModal({
      title: "Remove Standing Tripwire Check",
      statement: `Remove check ${chk.id}: "${chk.title || chk.id}"`,
      isCascading: true,
      impact: [
        `Deterministic BLAKE3 gate verification will be removed from git hooks and CI.`,
        `Affected files/symbols will no longer be guarded: ${chk.claim?.files?.join(", ") || "attached source files"}.`,
        `Triggers re-materialization of .git/hooks/pre-commit and GitHub Actions.`,
      ],
      confirmLabel: "Stage in 10s Quarantine",
      onConfirm: () => {
        scheduleQuarantineAction({
          id: `remove-check-${chk.id}`,
          label: `Remove Check: ${chk.id}`,
          description: `Removing tripwire check "${chk.title || chk.id}"`,
          isCascading: true,
          execute: async () => {
            await api.check.remove(chk.id);
            notify(`Removed check ${chk.id}`);
            loadData();
          },
        });
      },
      onCancel: () => {},
    });
  };

  const constraints = graph?.constraints || [];
  const guardrails = graph?.guardrails || [];

  const renderAttachmentChips = (attaches: any) => {
    const items = extractAttachmentItems(attaches);
    if (items.length === 0) return <span style={{ color: "#8E8878" }}>global</span>;

    return (
      <div style={{ display: "inline-flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
        {items.map((item, idx) => {
          const isFile = item.includes("/") && (item.includes(".") || item.startsWith("src/") || item.startsWith("apps/") || item.startsWith("crates/"));
          return (
            <button
              key={idx}
              onClick={() => {
                if (isFile) {
                  openCodePreview({ filePath: item, symbol: item.split("/").pop() });
                } else {
                  jumpToNodeOnMap(item);
                }
              }}
              style={{
                background: "#FAF8F4",
                border: "1px solid #DCD9D0",
                borderRadius: "4px",
                padding: "1px 6px",
                fontSize: "10.5px",
                color: "#1D1C1A",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                fontFamily: isFile ? "'IBM Plex Mono', monospace" : "'IBM Plex Sans', sans-serif",
              }}
              title={isFile ? `Open source code preview: ${item}` : `Jump to node on map: ${item}`}
            >
              <span>{isFile ? "📄" : "▣"}</span>
              <span>{item}</span>
              <span style={{ color: "#8E8878", fontSize: "9px" }}>↗</span>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div
      className="checks-page"
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
          Checks, Constraints & Pins
        </h2>
        <div style={{ fontSize: "13px", color: "#6E685F" }}>
          Deterministic tripwires, standing architectural boundaries, and intent lock pins. Click any item to deep-link to code or map.
        </div>
      </div>

      {/* Pin Budget Slider Card */}
      <div style={{ background: "#FFFFFF", border: "1px solid #E5E0D5", borderRadius: "10px", padding: "18px 24px", marginBottom: "24px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: "14px", color: "#1D1C1A" }}>Pin Budget Multiplier</div>
            <div style={{ fontSize: "12px", color: "#6E685F", marginTop: "2px" }}>
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
        <div style={{ background: "#FFFFFF", border: "1px solid #E5E0D5", borderRadius: "10px", padding: "18px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
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
                      padding: "12px",
                      borderRadius: "8px",
                      background: "#FAF8F4",
                      border: "1px solid #ECE7D9",
                      fontSize: "12px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: "10px",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: "#1D1C1A", lineHeight: "1.35" }}>{pin.statement}</div>
                      <div style={{ fontSize: "11px", color: "#6E685F", marginTop: "6px", display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                        <span>Attaches to:</span>
                        {renderAttachmentChips(pin.attaches)}
                      </div>
                      {pin.created_from && (
                        <div style={{ marginTop: "6px" }}>
                          <button
                            onClick={() => jumpToTurn(pin.created_from)}
                            style={{
                              background: "#ECE7D9",
                              border: "none",
                              padding: "1px 6px",
                              borderRadius: "4px",
                              fontSize: "10px",
                              fontWeight: 600,
                              color: "#4A463E",
                              cursor: "pointer",
                            }}
                          >
                            ⏱ Created in #{pin.created_from} ↗
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleRetirePin(pin)}
                      style={{
                        background: "#FFFFFF",
                        border: "1px solid #DCD9D0",
                        padding: "3px 10px",
                        borderRadius: "5px",
                        fontSize: "11px",
                        color: "#6E685F",
                        cursor: "pointer",
                        fontWeight: 500,
                        flexShrink: 0,
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
        <div style={{ background: "#FFFFFF", border: "1px solid #E5E0D5", borderRadius: "10px", padding: "18px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
            <div style={{ fontWeight: 600, fontSize: "15px", color: "#1D1C1A", display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ color: "#2E7A57" }}>✓</span> Standing Tripwire Checks ({checks.filter((c) => c.status === "active").length})
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
                      padding: "12px",
                      borderRadius: "8px",
                      background: "#FAF8F4",
                      border: "1px solid #ECE7D9",
                      fontSize: "12px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: "10px",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: "#1D1C1A" }}>{chk.title || chk.id}</div>
                      <div style={{ fontSize: "11px", color: "#6E685F", marginTop: "4px" }}>
                        Claim: <span style={{ fontWeight: 600, color: "#1D1C1A" }}>{chk.claim?.type || "forbid_import"}</span> · Authored by: {chk.authored_by || "checkgen"}
                      </div>
                      {chk.claim?.files && chk.claim.files.length > 0 && (
                        <div style={{ marginTop: "6px", display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "10.5px", color: "#8E8878" }}>Files:</span>
                          {chk.claim.files.map((f: string, fIdx: number) => (
                            <button
                              key={fIdx}
                              onClick={() => openCodePreview({ filePath: f, title: `Guarded: ${f}` })}
                              style={{
                                background: "#FFFFFF",
                                border: "1px solid #DCD9D0",
                                padding: "1px 6px",
                                borderRadius: "4px",
                                fontSize: "10px",
                                fontFamily: "'IBM Plex Mono', monospace",
                                cursor: "pointer",
                                color: "#1D1C1A",
                              }}
                            >
                              📄 {f} ↗
                            </button>
                          ))}
                        </div>
                      )}
                      {chk.created_from && (
                        <div style={{ marginTop: "6px" }}>
                          <button
                            onClick={() => jumpToTurn(chk.created_from)}
                            style={{
                              background: "#ECE7D9",
                              border: "none",
                              padding: "1px 6px",
                              borderRadius: "4px",
                              fontSize: "10px",
                              fontWeight: 600,
                              color: "#4A463E",
                              cursor: "pointer",
                            }}
                          >
                            ⏱ Created in #{chk.created_from} ↗
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveCheck(chk)}
                      style={{
                        background: "#FFFFFF",
                        border: "1px solid #DCD9D0",
                        padding: "3px 10px",
                        borderRadius: "5px",
                        fontSize: "11px",
                        color: "#C94A38",
                        cursor: "pointer",
                        fontWeight: 500,
                        flexShrink: 0,
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
        <div style={{ background: "#FFFFFF", border: "1px solid #E5E0D5", borderRadius: "10px", padding: "18px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ fontWeight: 600, fontSize: "15px", color: "#1D1C1A", marginBottom: "14px" }}>
            Architectural Constraints ({constraints.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {constraints.map((c: any) => (
              <div
                key={c.id}
                style={{
                  padding: "12px",
                  borderRadius: "8px",
                  background: "#FAF8F4",
                  border: "1px solid #ECE7D9",
                  fontSize: "12px",
                }}
              >
                <div style={{ fontWeight: 600, color: "#1D1C1A" }}>{c.id}</div>
                <div style={{ fontSize: "11.5px", color: "#6E685F", marginTop: "4px", display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                  <button
                    onClick={() => jumpToNodeOnMap(c.from)}
                    style={{ background: "#FFFFFF", border: "1px solid #DCD9D0", padding: "1px 6px", borderRadius: "4px", fontSize: "10.5px", cursor: "pointer" }}
                  >
                    ▣ {c.from} ↗
                  </button>
                  <span style={{ fontWeight: 600, color: "#C94A38" }}>{c.rule || c.kind || "cannot_depend_on"}</span>
                  {(Array.isArray(c.to) ? c.to : [c.to]).map((target: string, tIdx: number) => (
                    <button
                      key={tIdx}
                      onClick={() => jumpToNodeOnMap(target)}
                      style={{ background: "#FFFFFF", border: "1px solid #DCD9D0", padding: "1px 6px", borderRadius: "4px", fontSize: "10.5px", cursor: "pointer" }}
                    >
                      ▣ {target} ↗
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Guardrails */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E5E0D5", borderRadius: "10px", padding: "18px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
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
                    padding: "12px",
                    borderRadius: "8px",
                    background: "#FAF8F4",
                    border: "1px solid #ECE7D9",
                    fontSize: "12px",
                  }}
                >
                  <div style={{ fontWeight: 600, color: "#1D1C1A" }}>{g.statement}</div>
                  <div style={{ fontSize: "11px", color: "#6E685F", marginTop: "3px" }}>
                    Mode: <span style={{ fontWeight: 600 }}>{g.mode}</span> · Severity: {g.severity || "warning"}
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
