import React, { useState, useEffect } from "react";
import { Shield, ShieldAlert, Bot, Clock, AlertOctagon, RefreshCw, KeyRound, Radio } from "lucide-react";
import { api, AuthorityRecord } from "../api";
import { DelegationModal } from "./DelegationModal";

interface AuthorityBannerProps {
  onAuthorityChange?: (record: AuthorityRecord) => void;
}

export const AuthorityBanner: React.FC<AuthorityBannerProps> = ({ onAuthorityChange }) => {
  const [authority, setAuthority] = useState<AuthorityRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [sseConnected, setSseConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAuthority = async () => {
    try {
      const rec = await api.authority.status();
      setAuthority(rec);
      if (onAuthorityChange) onAuthorityChange(rec);
    } catch (err: any) {
      console.warn("authority.status failed:", err);
    }
  };

  useEffect(() => {
    fetchAuthority();

    // Setup live SSE listener from AFWE daemon if available
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/events");
      es.onopen = () => setSseConnected(true);
      es.onerror = () => setSseConnected(false);
      es.addEventListener("authority", (e) => {
        try {
          const updated = JSON.parse(e.data);
          setAuthority(updated);
          if (onAuthorityChange) onAuthorityChange(updated);
        } catch (_) {}
      });
      es.addEventListener("queue", () => {
        // Queue updated event
      });
    } catch (_) {
      setSseConnected(false);
    }

    const interval = setInterval(fetchAuthority, 8000);
    return () => {
      clearInterval(interval);
      if (es) es.close();
    };
  }, []);

  const handleRevoke = async () => {
    setRevoking(true);
    setError(null);
    try {
      const updated = await api.authority.revoke();
      setAuthority(updated);
      if (onAuthorityChange) onAuthorityChange(updated);
    } catch (err: any) {
      setError(err?.message || "Failed to revoke delegation");
    } finally {
      setRevoking(false);
    }
  };

  if (!authority) return null;

  const isDelegated = authority.mode === "prompter_delegated" && authority.delegation;
  const delegation = authority.delegation;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 14px",
        background: isDelegated
          ? "linear-gradient(90deg, rgba(147, 51, 234, 0.08) 0%, rgba(79, 70, 229, 0.04) 100%)"
          : "var(--panel)",
        borderBottom: "1px solid var(--line)",
        borderLeft: isDelegated ? "3px solid #9333ea" : "3px solid var(--accent)",
        fontSize: "12px",
        gap: "12px",
        flexWrap: "wrap",
      }}
    >
      {/* Mode Status Pill */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        {isDelegated ? (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: "rgba(147, 51, 234, 0.15)",
              border: "1px solid rgba(147, 51, 234, 0.4)",
              color: "#a855f7",
              fontWeight: 700,
              fontSize: "11px",
              padding: "3px 8px",
              borderRadius: "12px",
              letterSpacing: "0.5px",
            }}
          >
            <Bot size={13} />
            <span>PROMPTER DELEGATED</span>
          </div>
        ) : (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: "rgba(34, 197, 94, 0.12)",
              border: "1px solid rgba(34, 197, 94, 0.3)",
              color: "var(--accent, #22c55e)",
              fontWeight: 700,
              fontSize: "11px",
              padding: "3px 8px",
              borderRadius: "12px",
              letterSpacing: "0.5px",
            }}
          >
            <Shield size={13} />
            <span>HUMAN-ONLY GOVERNANCE</span>
          </div>
        )}

        {isDelegated && delegation ? (
          <div style={{ display: "flex", alignItems: "center", gap: "12px", color: "var(--ink)" }}>
            <span>
              Holder: <strong>{delegation.holder.agent_id}</strong>
            </span>
            <span
              style={{
                fontSize: "10px",
                background: "var(--side)",
                padding: "2px 6px",
                borderRadius: "4px",
                border: "1px solid var(--line)",
                fontWeight: 600,
              }}
            >
              DOOR: {delegation.holder.door.toUpperCase()}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--mute)" }}>
              <Clock size={12} />
              Expires: {new Date(delegation.validity.expires_at).toLocaleTimeString()}
            </span>
            <span style={{ color: "var(--mute)" }}>
              Approvals:{" "}
              <strong>
                {delegation.budget.auto_approvals_used}/{delegation.budget.auto_approvals_max}
              </strong>
            </span>
            <span style={{ color: "var(--mute)" }}>
              Heals:{" "}
              <strong>
                {delegation.budget.self_heals_used}/{delegation.budget.self_heals_max}
              </strong>
            </span>
          </div>
        ) : (
          <span style={{ color: "var(--mute)" }}>
            Default deterministic state. No automated agent can approve turns, bypass gates, or loosen authority.
          </span>
        )}
      </div>

      {/* Right Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {/* SSE Indicator */}
        <span
          title={sseConnected ? "Daemon SSE live stream active" : "Polling fallback active"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            fontSize: "10px",
            color: sseConnected ? "var(--accent)" : "var(--mute)",
            padding: "2px 6px",
            borderRadius: "4px",
            background: "var(--side)",
            border: "1px solid var(--line)",
          }}
        >
          <Radio size={10} style={{ animation: sseConnected ? "pulse 2s infinite" : "none" }} />
          <span>{sseConnected ? "Live" : "Polling"}</span>
        </span>

        {isDelegated ? (
          <button
            type="button"
            className="btn-soft"
            onClick={handleRevoke}
            disabled={revoking}
            style={{
              borderColor: "var(--red)",
              color: "var(--red)",
              background: "rgba(239, 68, 68, 0.08)",
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontWeight: 600,
            }}
            title="Immediately revoke prompter delegation and restore human-only governance"
          >
            <AlertOctagon size={12} />
            {revoking ? "Revoking…" : "Revoke Delegation"}
          </button>
        ) : (
          <button
            type="button"
            className="btn-soft"
            onClick={() => setModalOpen(true)}
            style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
            title="Delegate prompter authority to an orchestrator agent for a bounded loop"
          >
            <Bot size={13} />
            <span>Delegate Prompter</span>
          </button>
        )}
      </div>

      {modalOpen && (
        <DelegationModal
          onClose={() => setModalOpen(false)}
          onSuccess={(rec) => {
            setAuthority(rec);
            if (onAuthorityChange) onAuthorityChange(rec);
          }}
        />
      )}
    </div>
  );
};
