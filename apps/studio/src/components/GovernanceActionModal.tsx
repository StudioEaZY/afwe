// apps/studio/src/components/GovernanceActionModal.tsx
import React, { useEffect, useState } from "react";
import { useStore } from "../store";

export const GovernanceActionModal: React.FC = () => {
  const {
    consequenceModal,
    closeConsequenceModal,
    pendingQuarantine,
    cancelQuarantineAction,
    executeQuarantineActionNow,
    codePreviewTarget,
    closeCodePreview,
    drawer,
    setDrawer,
    undoStack,
    redoStack,
    undo,
    redo,
  } = useStore();

  const [previewContent, setPreviewContent] = useState<string | null>(null);

  useEffect(() => {
    if (codePreviewTarget) {
      // Create readable mock/demo preview based on path or pattern
      const p = codePreviewTarget.filePath;
      const sym = codePreviewTarget.symbol || "targetFunction";
      const pat = codePreviewTarget.pattern || "";
      setPreviewContent(`// File: ${p}
// Matched symbol / pattern: ${sym} ${pat ? `(pattern: ${pat})` : ""}

import { createPayment, verifyWebhook } from "@afwe/services/payments";
import { logger } from "@afwe/shared/logger";

/**
 * Deterministic Tripwire Boundary:
 * Guaranteed against unauthorized signature mutation.
 */
export async function ${sym}(payload: Record<string, any>) {
  logger.info("[tripwire-guarded] processing checkout transaction", { id: payload.id });
  
  if (!payload.amount || payload.amount <= 0) {
    throw new Error("Invalid payment amount detected");
  }

  // Active CheckSpec assertion:
  const verified = await verifyWebhook(payload.signature);
  if (!verified) {
    throw new Error("Payment signature verification failed");
  }

  return await createPayment({
    amount: payload.amount,
    currency: payload.currency || "USD",
    meta: { tripwire: true }
  });
}`);
    }
  }, [codePreviewTarget]);

  return (
    <>
      {/* 1. Consequence Confirmation Modal */}
      {consequenceModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(29, 28, 26, 0.45)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
          }}
          onClick={closeConsequenceModal}
        >
          <div
            style={{
              background: "#FAF8F3",
              border: "1px solid #DCD9D0",
              borderRadius: "12px",
              padding: "24px 28px",
              maxWidth: "520px",
              width: "90%",
              boxShadow: "0 12px 36px rgba(0,0,0,0.22)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
              <span style={{ fontSize: "20px" }}>{consequenceModal.isCascading ? "⚠️" : "⚖"}</span>
              <h3 style={{ fontFamily: "Newsreader, serif", fontSize: "22px", margin: 0, color: "#1D1C1A" }}>
                {consequenceModal.title}
              </h3>
            </div>

            {consequenceModal.isCascading && (
              <div
                style={{
                  background: "#FDECE9",
                  border: "1px solid #FCD8D2",
                  color: "#A82B1B",
                  fontSize: "11.5px",
                  fontWeight: 600,
                  padding: "6px 10px",
                  borderRadius: "6px",
                  marginBottom: "12px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                ● Cascading Action (Triggers 10s quarantine before modifying files/hooks)
              </div>
            )}

            <p style={{ fontSize: "13px", color: "#4A463E", lineHeight: "1.45", margin: "0 0 14px 0" }}>
              {consequenceModal.statement}
            </p>

            {consequenceModal.impact.length > 0 && (
              <div style={{ background: "#FFFFFF", border: "1px solid #ECE7D9", borderRadius: "8px", padding: "12px 14px", marginBottom: "20px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#6B675D", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>
                  What happens when this applies:
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                  {consequenceModal.impact.map((imp, idx) => (
                    <div key={idx} style={{ fontSize: "12px", color: "#1D1C1A", display: "flex", alignItems: "flex-start", gap: "6px" }}>
                      <span style={{ color: "#B23A2B" }}>•</span>
                      <span>{imp}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                onClick={closeConsequenceModal}
                style={{
                  background: "#FFFFFF",
                  border: "1px solid #DCD9D0",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  fontSize: "12.5px",
                  fontWeight: 500,
                  color: "#1D1C1A",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  consequenceModal.onConfirm();
                  closeConsequenceModal();
                }}
                style={{
                  background: consequenceModal.isCascading ? "#B23A2B" : "#2E7A57",
                  border: "none",
                  padding: "8px 18px",
                  borderRadius: "6px",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  color: "#FFFFFF",
                  cursor: "pointer",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
                }}
              >
                {consequenceModal.confirmLabel || (consequenceModal.isCascading ? "Stage in 10s Quarantine" : "Confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Tier 1: 10-Second Quarantine Countdown Bar */}
      {pendingQuarantine && (
        <div
          style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            background: "#1D1C1A",
            color: "#FFFFFF",
            padding: "12px 18px",
            borderRadius: "10px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
            zIndex: 99999,
            display: "flex",
            alignItems: "center",
            gap: "14px",
            border: "1px solid #3E3B35",
            maxWidth: "460px",
          }}
        >
          {/* Circular Countdown Progress Ring */}
          <div style={{ position: "relative", width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="32" height="32" viewBox="0 0 32 32">
              <circle cx="16" cy="16" r="13" stroke="#3E3B35" strokeWidth="2.5" fill="none" />
              <circle
                cx="16"
                cy="16"
                r="13"
                stroke="#C89D54"
                strokeWidth="2.5"
                fill="none"
                strokeDasharray={81.68}
                strokeDashoffset={81.68 * (1 - pendingQuarantine.secondsLeft / Math.max(1, pendingQuarantine.totalSeconds))}
                strokeLinecap="round"
                transform="rotate(-90 16 16)"
                style={{ transition: "stroke-dashoffset 1s linear" }}
              />
            </svg>
            <span style={{ position: "absolute", fontSize: "11px", fontWeight: 700, color: "#FFFFFF" }}>
              {pendingQuarantine.secondsLeft}
            </span>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "12px", fontWeight: 700, color: "#FAF8F3" }}>
                {pendingQuarantine.label}
              </span>
              {pendingQuarantine.isCascading && (
                <span style={{ fontSize: "9px", background: "#87661A", color: "#FAF3DB", padding: "1px 5px", borderRadius: "3px", fontWeight: 700 }}>
                  Cascades
                </span>
              )}
            </div>
            <div style={{ fontSize: "11px", color: "#A8A295", marginTop: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {pendingQuarantine.description} (applies in {pendingQuarantine.secondsLeft}s)
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
            <button
              onClick={cancelQuarantineAction}
              style={{
                background: "#FAF8F3",
                color: "#1D1C1A",
                border: "none",
                padding: "6px 12px",
                borderRadius: "5px",
                fontSize: "11.5px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Undo / Cancel
            </button>
            <button
              onClick={executeQuarantineActionNow}
              style={{
                background: "#2E7A57",
                color: "#FFFFFF",
                border: "none",
                padding: "6px 10px",
                borderRadius: "5px",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Run Now
            </button>
          </div>
        </div>
      )}

      {/* 3. Source File & Symbol Preview Modal */}
      {codePreviewTarget && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(29, 28, 26, 0.45)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
          }}
          onClick={closeCodePreview}
        >
          <div
            style={{
              background: "#FAF8F3",
              border: "1px solid #DCD9D0",
              borderRadius: "12px",
              padding: "20px 24px",
              maxWidth: "760px",
              width: "90%",
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 12px 36px rgba(0,0,0,0.25)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <div>
                <h3 style={{ fontFamily: "Newsreader, serif", fontSize: "20px", margin: 0, color: "#1D1C1A" }}>
                  {codePreviewTarget.title || "Source Code Preview"}
                </h3>
                <div style={{ fontSize: "11.5px", color: "#6B675D", fontFamily: "'IBM Plex Mono', monospace", marginTop: "2px" }}>
                  📄 {codePreviewTarget.filePath}
                  {codePreviewTarget.symbol && ` :: ${codePreviewTarget.symbol}`}
                </div>
              </div>
              <button
                onClick={closeCodePreview}
                style={{ background: "none", border: "none", fontSize: "16px", cursor: "pointer", color: "#6B675D" }}
              >
                ✕
              </button>
            </div>

            <pre
              style={{
                flex: 1,
                background: "#FFFFFF",
                border: "1px solid #ECE7D9",
                borderRadius: "8px",
                padding: "16px",
                overflow: "auto",
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: "12px",
                lineHeight: "1.5",
                color: "#1D1C1A",
              }}
            >
              {previewContent}
            </pre>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "14px" }}>
              <button
                onClick={closeCodePreview}
                style={{
                  background: "#1D1C1A",
                  color: "#FFFFFF",
                  border: "none",
                  padding: "7px 16px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Session Reversible History Drawer */}
      {drawer === "history" && (
        <div
          style={{
            position: "fixed",
            top: "52px",
            right: 0,
            width: "380px",
            height: "calc(100vh - 52px)",
            background: "#FFFFFF",
            borderLeft: "1px solid #E5E0D5",
            boxShadow: "-4px 0 20px rgba(0,0,0,0.08)",
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ padding: "16px 20px", borderBottom: "1px solid #ECE7D9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: "15px", color: "#1D1C1A" }}>Session Undo / Redo History</div>
              <div style={{ fontSize: "11px", color: "#6B675D" }}>{undoStack.length} reversible actions in session</div>
            </div>
            <button onClick={() => setDrawer(null)} style={{ background: "none", border: "none", fontSize: "14px", cursor: "pointer", color: "#6B675D" }}>
              ✕
            </button>
          </div>

          <div style={{ padding: "12px 20px", background: "#FAF8F3", borderBottom: "1px solid #ECE7D9", display: "flex", gap: "10px" }}>
            <button
              onClick={() => undo()}
              disabled={undoStack.length === 0}
              style={{
                flex: 1,
                background: undoStack.length > 0 ? "#1D1C1A" : "#ECE7D9",
                color: undoStack.length > 0 ? "#FFFFFF" : "#8A8475",
                border: "none",
                padding: "7px 12px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: undoStack.length > 0 ? "pointer" : "default",
              }}
            >
              ↶ Undo (Ctrl+Z)
            </button>
            <button
              onClick={() => redo()}
              disabled={redoStack.length === 0}
              style={{
                flex: 1,
                background: redoStack.length > 0 ? "#FAF8F3" : "#ECE7D9",
                color: redoStack.length > 0 ? "#1D1C1A" : "#8A8475",
                border: "1px solid #DCD9D0",
                padding: "7px 12px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: redoStack.length > 0 ? "pointer" : "default",
              }}
            >
              ↷ Redo (Ctrl+Y)
            </button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: "10px" }}>
            {undoStack.length === 0 ? (
              <div style={{ fontSize: "12px", color: "#8E8878", textAlign: "center", marginTop: "40px" }}>
                No actions taken yet this session.
              </div>
            ) : (
              undoStack.map((item, idx) => (
                <div
                  key={item.id}
                  style={{
                    padding: "10px 12px",
                    borderRadius: "6px",
                    background: idx === 0 ? "#F4EFE6" : "#FAF8F3",
                    border: `1px solid ${idx === 0 ? "#1D1C1A" : "#ECE7D9"}`,
                    fontSize: "12px",
                  }}
                >
                  <div style={{ fontWeight: 600, color: "#1D1C1A" }}>{item.label}</div>
                  <div style={{ fontSize: "10.5px", color: "#6B675D", marginTop: "2px" }}>
                    {new Date(item.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
};
