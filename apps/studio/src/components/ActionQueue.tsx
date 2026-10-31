import React, { useState, useEffect } from "react";
import {
  ListFilter,
  CheckCircle,
  AlertCircle,
  Clock,
  GitCommit,
  RotateCcw,
  Trash2,
  Copy,
  Check,
  ShieldAlert,
  ArrowRight,
  RefreshCw,
  FolderSync,
  Layers,
  Wrench,
} from "lucide-react";
import { api, ActionQueueItem, ActionQueueResponse, ActionQueueStats } from "../api";

interface ActionQueueProps {
  compact?: boolean;
  onItemActed?: () => void;
}

type FilterState = "all" | "staged" | "ghost_redo" | "ready" | "advisory_drift" | "stale_leases" | "unattributed";

export const ActionQueue: React.FC<ActionQueueProps> = ({ compact = false, onItemActed }) => {
  const [data, setData] = useState<ActionQueueResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterState>("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchQueue = async () => {
    try {
      const q = await api.queue.get();
      setData(q);
    } catch (err: any) {
      console.warn("queue.get failed:", err);
    }
  };

  useEffect(() => {
    fetchQueue();

    // Listen to SSE queue update events if available
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/events");
      es.addEventListener("queue", () => {
        fetchQueue();
      });
      es.addEventListener("turn", () => {
        fetchQueue();
      });
    } catch (_) {}

    const interval = setInterval(fetchQueue, 6000);
    return () => {
      clearInterval(interval);
      if (es) es.close();
    };
  }, []);

  const handleAct = async (itemId: string, action: string) => {
    setActionInProgress(itemId);
    setError(null);
    try {
      await api.queue.act(itemId, action);
      await fetchQueue();
      if (onItemActed) onItemActed();
    } catch (err: any) {
      setError(err?.message || `Failed to execute ${action} on ${itemId}`);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleBatchAct = async (batchAction: string) => {
    setActionInProgress("batch:" + batchAction);
    setError(null);
    try {
      await api.queue.batch(batchAction);
      await fetchQueue();
      if (onItemActed) onItemActed();
    } catch (err: any) {
      setError(err?.message || `Failed to execute batch ${batchAction}`);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleHealRestore = async (item: ActionQueueItem) => {
    if (!item.remediation) return;
    setActionInProgress("heal:" + item.id);
    setError(null);
    try {
      await api.heal.restore({
        file: item.remediation.target_file,
        hash: item.remediation.baseline_blob_hash,
        parent_turn: item.remediation.parent_turn,
      });
      await fetchQueue();
      if (onItemActed) onItemActed();
    } catch (err: any) {
      setError(err?.message || `Self-heal failed for ${item.remediation.target_file}`);
    } finally {
      setActionInProgress(null);
    }
  };

  const copyPrompt = (item: ActionQueueItem) => {
    const lines = [
      `[AFWE Steering Request for ${item.id}]`,
      `State: ${item.state.toUpperCase()}`,
      `Title: ${item.title}`,
      `Origin: ${item.origin} (Authority: ${item.authority})`,
    ];
    if (item.human_floor_reasons.length > 0) {
      lines.push(`Human Floor Triggers:`);
      item.human_floor_reasons.forEach((r) => lines.push(` - ${r}`));
    }
    if (item.pins.length > 0) {
      lines.push(`Active Invariant Pins: ${item.pins.join(", ")}`);
    }
    lines.push(`Summary: ${item.description}`);
    lines.push(`Allowed Actions: ${item.allowed_actions.join(", ")}`);
    lines.push(`Prompt instructions: Inspect the failure and resolve cleanly or refine intent.`);

    navigator.clipboard.writeText(lines.join("\n"));
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  if (!data) return null;

  const items = data.items || [];
  const stats = data.stats || {
    total_actionable: 0,
    staged_count: 0,
    ghost_redo_count: 0,
    ready_count: 0,
    advisory_drift_count: 0,
    stale_leases_count: 0,
    unattributed_count: 0,
  };

  const filteredItems = items.filter((item) => {
    if (filter === "all") return true;
    return item.state === filter;
  });

  const getStateStyle = (state: string) => {
    switch (state) {
      case "staged":
        return { color: "#22c55e", bg: "rgba(34, 197, 94, 0.12)", border: "rgba(34, 197, 94, 0.4)" };
      case "ghost_redo":
        return { color: "#eab308", bg: "rgba(234, 179, 8, 0.12)", border: "rgba(234, 179, 8, 0.4)" };
      case "ready":
        return { color: "#3b82f6", bg: "rgba(59, 130, 246, 0.12)", border: "rgba(59, 130, 246, 0.4)" };
      case "advisory_drift":
        return { color: "#06b6d4", bg: "rgba(6, 182, 212, 0.12)", border: "rgba(6, 182, 212, 0.4)" };
      case "stale_leases":
        return { color: "#a855f7", bg: "rgba(168, 85, 247, 0.12)", border: "rgba(168, 85, 247, 0.4)" };
      case "unattributed":
        return { color: "#f43f5e", bg: "rgba(244, 63, 94, 0.12)", border: "rgba(244, 63, 94, 0.4)" };
      default:
        return { color: "var(--ink)", bg: "var(--side)", border: "var(--line)" };
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: "8px",
        overflow: "hidden",
        margin: compact ? "4px 0" : "12px 0",
      }}
    >
      {/* Action Queue Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          background: "var(--side)",
          borderBottom: "1px solid var(--line)",
          flexWrap: "wrap",
          gap: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Layers size={15} style={{ color: "var(--accent)" }} />
          <span style={{ fontWeight: 700, fontSize: "13px", color: "var(--ink)" }}>
            AFWE Action Queue
          </span>
          <span
            style={{
              fontSize: "11px",
              padding: "2px 7px",
              borderRadius: "10px",
              background: stats.total_actionable > 0 ? "var(--accent)" : "var(--line)",
              color: stats.total_actionable > 0 ? "#fff" : "var(--mute)",
              fontWeight: 700,
            }}
          >
            {stats.total_actionable} Actionable
          </span>
        </div>

        {/* Batch Action Buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {stats.ready_count > 0 && (
            <button
              type="button"
              className="btn-soft small"
              onClick={() => handleBatchAct("commit_ready")}
              disabled={actionInProgress !== null}
              title="Batch commit all ready turns in sequence"
              style={{ fontSize: "11px", color: "#3b82f6" }}
            >
              <GitCommit size={12} />
              <span>Batch Commit Ready ({stats.ready_count})</span>
            </button>
          )}

          {stats.ghost_redo_count > 0 && (
            <button
              type="button"
              className="btn-soft small"
              onClick={() => handleBatchAct("abandon_ghost_redo")}
              disabled={actionInProgress !== null}
              title="Batch abandon orphaned ghost redo turns"
              style={{ fontSize: "11px", color: "#eab308" }}
            >
              <Trash2 size={12} />
              <span>Batch Abandon Redo ({stats.ghost_redo_count})</span>
            </button>
          )}

          {stats.stale_leases_count > 0 && (
            <button
              type="button"
              className="btn-soft small"
              onClick={() => handleBatchAct("prune_stale_leases")}
              disabled={actionInProgress !== null}
              title="Batch prune stale concurrent node leases"
              style={{ fontSize: "11px", color: "#a855f7" }}
            >
              <Wrench size={12} />
              <span>Prune Stale Leases ({stats.stale_leases_count})</span>
            </button>
          )}

          <button
            type="button"
            className="btn-ghost small"
            onClick={fetchQueue}
            title="Refresh queue"
            style={{ padding: "4px" }}
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          padding: "6px 14px",
          background: "var(--panel)",
          borderBottom: "1px solid var(--line)",
          overflowX: "auto",
        }}
      >
        {(
          [
            { id: "all", label: "All", count: stats.total_actionable },
            { id: "staged", label: "Staged", count: stats.staged_count },
            { id: "ghost_redo", label: "Ghost Redo", count: stats.ghost_redo_count },
            { id: "ready", label: "Ready", count: stats.ready_count },
            { id: "advisory_drift", label: "Drift", count: stats.advisory_drift_count },
            { id: "stale_leases", label: "Stale Leases", count: stats.stale_leases_count },
            { id: "unattributed", label: "Unattributed", count: stats.unattributed_count },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilter(tab.id)}
            style={{
              border: "none",
              background: filter === tab.id ? "var(--side)" : "transparent",
              color: filter === tab.id ? "var(--ink)" : "var(--mute)",
              fontWeight: filter === tab.id ? 700 : 500,
              padding: "4px 8px",
              borderRadius: "6px",
              fontSize: "11px",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
            }}
          >
            <span>{tab.label}</span>
            {tab.count > 0 && (
              <span
                style={{
                  fontSize: "9px",
                  padding: "1px 5px",
                  borderRadius: "8px",
                  background: filter === tab.id ? "var(--line)" : "var(--side)",
                }}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <div
          style={{
            margin: "8px 14px 0 14px",
            padding: "6px 10px",
            background: "rgba(239, 68, 68, 0.12)",
            border: "1px solid var(--red)",
            borderRadius: "6px",
            color: "var(--red)",
            fontSize: "11px",
          }}
        >
          {error}
        </div>
      )}

      {/* Items List */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          padding: "10px 14px",
          maxHeight: compact ? "280px" : "480px",
          overflowY: "auto",
        }}
      >
        {filteredItems.length === 0 ? (
          <div
            style={{
              padding: "20px 0",
              textAlign: "center",
              color: "var(--mute)",
              fontSize: "12px",
            }}
          >
            No active queue items in this category. System invariants satisfied.
          </div>
        ) : (
          filteredItems.map((item) => {
            const badgeStyle = getStateStyle(item.state);
            const isActing = actionInProgress === item.id;

            return (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  padding: "10px 12px",
                  background: "var(--side)",
                  border: "1px solid var(--line)",
                  borderRadius: "6px",
                  fontSize: "12px",
                }}
              >
                {/* Item Top Row */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <span
                      style={{
                        padding: "2px 6px",
                        borderRadius: "4px",
                        fontSize: "10px",
                        fontWeight: 700,
                        color: badgeStyle.color,
                        background: badgeStyle.bg,
                        border: `1px solid ${badgeStyle.border}`,
                        letterSpacing: "0.5px",
                      }}
                    >
                      {item.state.toUpperCase().replace("_", " ")}
                    </span>
                    <span style={{ fontWeight: 700, color: "var(--ink)", fontFamily: "monospace" }}>
                      {item.id}
                    </span>
                    <span style={{ color: "var(--mute)", fontSize: "11px" }}>
                      by <strong>{item.origin}</strong> ({item.authority})
                    </span>
                  </div>

                  {/* Diff Summary */}
                  {item.diff_summary && item.diff_summary.files_changed > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px" }}>
                      <span style={{ color: "var(--mute)" }}>{item.diff_summary.files_changed} file(s)</span>
                      <span style={{ color: "#22c55e" }}>+{item.diff_summary.insertions}</span>
                      <span style={{ color: "#ef4444" }}>-{item.diff_summary.deletions}</span>
                    </div>
                  )}
                </div>

                {/* Title & Description */}
                <div style={{ color: "var(--ink)", fontWeight: 500 }}>
                  {item.title}
                </div>
                {item.description && (
                  <div style={{ color: "var(--mute)", fontSize: "11px", lineHeight: 1.4 }}>
                    {item.description}
                  </div>
                )}

                {/* Human Floor Warning */}
                {item.requires_human && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      background: "rgba(239, 68, 68, 0.08)",
                      border: "1px solid rgba(239, 68, 68, 0.2)",
                      borderRadius: "4px",
                      padding: "4px 8px",
                      color: "var(--red)",
                      fontSize: "11px",
                    }}
                  >
                    <ShieldAlert size={13} />
                    <span>
                      <strong>Human Floor:</strong> {item.human_floor_reasons.join("; ") || "Requires direct human approval"}
                    </span>
                  </div>
                )}

                {/* Pins */}
                {item.pins && item.pins.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap", fontSize: "10px" }}>
                    <span style={{ color: "var(--mute)" }}>Pins:</span>
                    {item.pins.map((p) => (
                      <span
                        key={p}
                        style={{
                          background: "var(--panel)",
                          border: "1px solid var(--line)",
                          padding: "1px 5px",
                          borderRadius: "4px",
                          fontFamily: "monospace",
                        }}
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                )}

                {/* Action Buttons Row */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginTop: "4px",
                    paddingTop: "6px",
                    borderTop: "1px solid var(--line)",
                    flexWrap: "wrap",
                    gap: "6px",
                  }}
                >
                  {/* Left: Steering Prompt Copy */}
                  <button
                    type="button"
                    className="btn-ghost small"
                    onClick={() => copyPrompt(item)}
                    title="Copy formatted steering prompt for agent chat"
                    style={{ fontSize: "11px", display: "inline-flex", alignItems: "center", gap: 4 }}
                  >
                    {copiedId === item.id ? <Check size={11} style={{ color: "#22c55e" }} /> : <Copy size={11} />}
                    <span>{copiedId === item.id ? "Copied Prompt!" : "Copy Prompt"}</span>
                  </button>

                  {/* Right: State Action Buttons */}
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    {item.remediation && (
                      <button
                        type="button"
                        className="btn-soft small"
                        onClick={() => handleHealRestore(item)}
                        disabled={isActing}
                        title={`Restore ${item.remediation.target_file} from recorded baseline`}
                        style={{ fontSize: "11px", color: "var(--accent)" }}
                      >
                        <Wrench size={11} />
                        <span>Self-Heal Restore</span>
                      </button>
                    )}

                    {item.allowed_actions.includes("approve") && (
                      <button
                        type="button"
                        className="btn-soft small"
                        onClick={() => handleAct(item.id, "approve")}
                        disabled={isActing}
                        style={{ fontSize: "11px", color: "#22c55e", fontWeight: 600 }}
                      >
                        <CheckCircle size={11} />
                        <span>Approve Proposal</span>
                      </button>
                    )}

                    {item.allowed_actions.includes("commit") && (
                      <button
                        type="button"
                        className="btn-soft small"
                        onClick={() => handleAct(item.id, "commit")}
                        disabled={isActing}
                        style={{ fontSize: "11px", color: "#3b82f6", fontWeight: 600 }}
                      >
                        <GitCommit size={11} />
                        <span>Commit to Git</span>
                      </button>
                    )}

                    {item.allowed_actions.includes("revert") && (
                      <button
                        type="button"
                        className="btn-soft small"
                        onClick={() => handleAct(item.id, "revert")}
                        disabled={isActing}
                        style={{ fontSize: "11px" }}
                      >
                        <RotateCcw size={11} />
                        <span>Revert</span>
                      </button>
                    )}

                    {item.allowed_actions.includes("abandon") && (
                      <button
                        type="button"
                        className="btn-soft small"
                        onClick={() => handleAct(item.id, "abandon")}
                        disabled={isActing}
                        style={{ fontSize: "11px", color: "var(--red)" }}
                      >
                        <Trash2 size={11} />
                        <span>Abandon</span>
                      </button>
                    )}

                    {item.allowed_actions.includes("prune") && (
                      <button
                        type="button"
                        className="btn-soft small"
                        onClick={() => handleAct(item.id, "prune")}
                        disabled={isActing}
                        style={{ fontSize: "11px", color: "#a855f7" }}
                      >
                        <Trash2 size={11} />
                        <span>Prune Lease</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
