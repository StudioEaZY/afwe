import React, { useState, useEffect } from "react";
import { Shield, ShieldAlert, Bot, Clock, AlertTriangle, Cpu, CheckCircle } from "lucide-react";
import { api, AuthorityRecord } from "../api";
import { Modal, Field } from "./Modal";

interface DelegationModalProps {
  onClose: () => void;
  onSuccess: (record: AuthorityRecord) => void;
}

export const DelegationModal: React.FC<DelegationModalProps> = ({ onClose, onSuccess }) => {
  const [holder, setHolder] = useState("orchestrator-1");
  const [door, setDoor] = useState<"ui" | "mcp">("ui");
  const [ttlHours, setTtlHours] = useState(4);
  const [autoApprovals, setAutoApprovals] = useState(20);
  const [selfHeals, setSelfHeals] = useState(5);
  const [autoMerge, setAutoMerge] = useState(false);
  const [allowedDomains, setAllowedDomains] = useState("");
  const [deniedDomains, setDeniedDomains] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasOpenTurn, setHasOpenTurn] = useState<boolean | null>(null);

  useEffect(() => {
    // Check if there are open turns (R4 mandate)
    api.status().then((res: any) => {
      const activeTurns = res.turns || [];
      const open = activeTurns.some((t: any) => t.status === "open");
      setHasOpenTurn(open);
    }).catch(() => {
      setHasOpenTurn(false);
    });
  }, []);

  const handleGrant = async () => {
    setError(null);
    setLoading(true);
    try {
      const params = {
        holder: holder.trim(),
        door,
        ttl_seconds: Math.min(12, Math.max(1, ttlHours)) * 3600,
        auto_approvals_max: Math.min(50, Math.max(1, autoApprovals)),
        self_heals_max: Math.min(10, Math.max(0, selfHeals)),
        auto_merge: autoMerge,
        allowed_domains: allowedDomains ? allowedDomains.split(",").map((s) => s.trim()).filter(Boolean) : [],
        denied_domains: deniedDomains ? deniedDomains.split(",").map((s) => s.trim()).filter(Boolean) : [],
      };

      const result = await api.authority.delegate(params);
      onSuccess(result);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to grant delegation");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Delegate Prompter Authority (Agent Loop)" onClose={onClose} wide>
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {hasOpenTurn && (
          <div
            style={{
              padding: "10px 14px",
              background: "rgba(239, 68, 68, 0.12)",
              border: "1px solid var(--red)",
              borderRadius: "8px",
              color: "var(--red)",
              fontSize: "12px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <ShieldAlert size={16} />
            <span>
              <strong>R4 Invariant:</strong> A turn is currently OPEN. Prompter delegation can only be granted when no turns are actively open. Close or abandon the open turn first.
            </span>
          </div>
        )}

        <div
          style={{
            padding: "10px 14px",
            background: "var(--side)",
            border: "1px solid var(--line)",
            borderRadius: "8px",
            fontSize: "12px",
            color: "var(--mute)",
            lineHeight: 1.5,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, color: "var(--ink)", marginBottom: 4 }}>
            <Shield size={14} style={{ color: "var(--accent)" }} />
            <span>Prompter Delegation Contract</span>
          </div>
          Delegating prompter authority allows an orchestrator agent to act as prompter for worker agents during a bounded loop.
          Human-floor pins and policy violations remain strictly parked for human review. Failed validation immediately drops authority back to <code>human_only</code>.
        </div>

        <Field label="Orchestrator Agent ID">
          <input
            type="text"
            className="input"
            value={holder}
            onChange={(e) => setHolder(e.target.value)}
            placeholder="e.g. orchestrator-1"
            disabled={loading}
          />
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <Field label="Door Authority Interface">
            <select
              className="input"
              value={door}
              onChange={(e) => setDoor(e.target.value as "ui" | "mcp")}
              disabled={loading}
            >
              <option value="ui">UI (Computer Use / Human Interactive - Default)</option>
              <option value="mcp">MCP (Headless Agentic Loop)</option>
            </select>
          </Field>

          <Field label="TTL Window (Hours, Max 12h)">
            <input
              type="number"
              className="input"
              min={1}
              max={12}
              value={ttlHours}
              onChange={(e) => setTtlHours(parseInt(e.target.value) || 1)}
              disabled={loading}
            />
          </Field>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <Field label="Auto-Approvals Budget (Max 50)">
            <input
              type="number"
              className="input"
              min={1}
              max={50}
              value={autoApprovals}
              onChange={(e) => setAutoApprovals(parseInt(e.target.value) || 1)}
              disabled={loading}
            />
          </Field>

          <Field label="Self-Heals Budget (Max 10)">
            <input
              type="number"
              className="input"
              min={0}
              max={10}
              value={selfHeals}
              onChange={(e) => setSelfHeals(parseInt(e.target.value) || 0)}
              disabled={loading}
            />
          </Field>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <Field label="Allowed Subsystem Domains (optional, comma-separated)">
            <input
              type="text"
              className="input"
              placeholder="e.g. backend, core, parser"
              value={allowedDomains}
              onChange={(e) => setAllowedDomains(e.target.value)}
              disabled={loading}
            />
          </Field>

          <Field label="Denied Subsystem Domains (optional, comma-separated)">
            <input
              type="text"
              className="input"
              placeholder="e.g. auth, payments, security"
              value={deniedDomains}
              onChange={(e) => setDeniedDomains(e.target.value)}
              disabled={loading}
            />
          </Field>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={autoMerge}
            onChange={(e) => setAutoMerge(e.target.checked)}
            disabled={loading}
          />
          <span>Enable Clean Auto-Merge for Derivable Baseline Restores (Section 8 Opt-in)</span>
        </label>

        {error && (
          <div
            style={{
              padding: "8px 12px",
              background: "rgba(239, 68, 68, 0.12)",
              border: "1px solid var(--red)",
              borderRadius: "6px",
              color: "var(--red)",
              fontSize: "12px",
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" }}>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-accent"
            onClick={handleGrant}
            disabled={loading || !holder.trim() || hasOpenTurn === true}
            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
          >
            <Bot size={14} />
            {loading ? "Granting…" : "Grant Delegation"}
          </button>
        </div>
      </div>
    </Modal>
  );
};
