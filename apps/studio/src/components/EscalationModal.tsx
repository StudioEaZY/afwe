import React, { useState } from "react";
import { ShieldAlert, Check, X, Clock, Terminal } from "lucide-react";
import { useStore } from "../store";

interface Props {
  onClose: () => void;
}

export const EscalationModal: React.FC<Props> = ({ onClose }) => {
  const { escalations, approveEscalation, rejectEscalation, refresh } = useStore();
  const [busyId, setBusyId] = useState<string | null>(null);

  const pending = escalations.filter((e) => e.status === "pending");
  const decided = escalations.filter((e) => e.status !== "pending");

  const handleApprove = async (id: string) => {
    setBusyId(id);
    try {
      await approveEscalation(id);
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (id: string) => {
    setBusyId(id);
    try {
      await rejectEscalation(id);
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0, 0, 0, 0.45)",
        backdropFilter: "blur(2px)",
        display: "grid",
        placeItems: "center",
        padding: "20px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "12px",
          width: "100%",
          maxWidth: "680px",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.15)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid var(--line)",
            background: "var(--side)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "8px",
                background: pending.length > 0 ? "rgba(239, 68, 68, 0.12)" : "var(--line)",
                color: pending.length > 0 ? "var(--red)" : "var(--mute)",
                display: "grid",
                placeItems: "center",
              }}
            >
              <ShieldAlert size={18} />
            </div>
            <div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--ink)" }}>
                Human Escalation Review Queue
              </div>
              <div style={{ fontSize: "11px", color: "var(--mute)" }}>
                Autonomous guard-loosening requests requiring human sign-off
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ghost"
            style={{ padding: "4px 8px", cursor: "pointer", borderRadius: "6px" }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Content body */}
        <div
          style={{
            padding: "16px 20px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          {escalations.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "40px 20px",
                color: "var(--mute)",
                fontSize: "13px",
              }}
            >
              <Check size={28} style={{ color: "var(--accent)", margin: "0 auto 8px auto", display: "block" }} />
              No escalations queued. All architectural guardrails and invariant pins are intact.
            </div>
          ) : (
            <>
              {pending.length > 0 && (
                <div>
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      color: "var(--red)",
                      marginBottom: "8px",
                    }}
                  >
                    Pending Human Decision ({pending.length})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {pending.map((esc) => (
                      <div
                        key={esc.id}
                        style={{
                          background: "var(--side)",
                          border: "1px solid var(--red)",
                          borderRadius: "8px",
                          padding: "12px 14px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "8px",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div>
                            <span
                              style={{
                                fontFamily: "monospace",
                                fontSize: "11px",
                                fontWeight: 700,
                                background: "rgba(239, 68, 68, 0.1)",
                                color: "var(--red)",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                marginRight: "8px",
                              }}
                            >
                              {esc.op}
                            </span>
                            <span style={{ fontSize: "11px", color: "var(--mute)" }}>
                              ID: {esc.id} · Requested by {esc.origin}
                            </span>
                          </div>
                          <div style={{ fontSize: "11px", color: "var(--mute)", display: "flex", alignItems: "center", gap: "4px" }}>
                            <Clock size={12} />
                            {new Date(esc.created_at).toLocaleTimeString()}
                          </div>
                        </div>

                        <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)", lineHeight: 1.4 }}>
                          {esc.description}
                        </div>

                        {esc.params && Object.keys(esc.params).length > 0 && (
                          <div
                            style={{
                              background: "var(--panel)",
                              border: "1px solid var(--line)",
                              borderRadius: "6px",
                              padding: "6px 8px",
                              fontSize: "11px",
                              fontFamily: "monospace",
                              color: "var(--ink)",
                              maxHeight: "100px",
                              overflowY: "auto",
                            }}
                          >
                            <div style={{ color: "var(--mute)", fontSize: "10px", marginBottom: "2px" }}>PARAMS:</div>
                            {JSON.stringify(esc.params, null, 2)}
                          </div>
                        )}

                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "4px" }}>
                          <button
                            type="button"
                            disabled={busyId === esc.id}
                            onClick={() => handleReject(esc.id)}
                            className="btn-soft"
                            style={{
                              padding: "4px 10px",
                              fontSize: "11.5px",
                              color: "var(--red)",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                            <X size={13} />
                            Reject
                          </button>
                          <button
                            type="button"
                            disabled={busyId === esc.id}
                            onClick={() => handleApprove(esc.id)}
                            style={{
                              padding: "4px 12px",
                              fontSize: "11.5px",
                              fontWeight: 600,
                              background: "var(--accent)",
                              color: "#fff",
                              border: "none",
                              borderRadius: "6px",
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                            <Check size={13} />
                            Approve (Human Override)
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {decided.length > 0 && (
                <div style={{ marginTop: pending.length > 0 ? "16px" : "0" }}>
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      color: "var(--mute)",
                      marginBottom: "8px",
                    }}
                  >
                    Resolved Decisions ({decided.length})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {decided.map((esc) => (
                      <div
                        key={esc.id}
                        style={{
                          background: "var(--side)",
                          border: "1px solid var(--line)",
                          borderRadius: "6px",
                          padding: "8px 10px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          opacity: 0.8,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span
                            style={{
                              fontSize: "10px",
                              fontWeight: 700,
                              textTransform: "uppercase",
                              padding: "2px 5px",
                              borderRadius: "4px",
                              background: esc.status === "approved" ? "rgba(16, 185, 129, 0.12)" : "rgba(239, 68, 68, 0.12)",
                              color: esc.status === "approved" ? "var(--green)" : "var(--red)",
                            }}
                          >
                            {esc.status}
                          </span>
                          <span style={{ fontSize: "11.5px", color: "var(--ink)" }}>{esc.description}</span>
                        </div>
                        <span style={{ fontSize: "10.5px", color: "var(--mute)" }}>
                          {esc.decided_by ? `by ${esc.decided_by}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
