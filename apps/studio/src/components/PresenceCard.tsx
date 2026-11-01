import React, { useState, useEffect } from 'react';
import { call } from '../api';

export interface PresenceEventPayload {
  seq: number;
  timestamp: string;
  project_id: string;
  host_id: string;
  turn_hash?: string;
  turn_id?: string;
  kind: string;
  outcome?: string;
  blast_radius: 'low' | 'medium' | 'high';
  requires_human: boolean;
  title: string;
  detail: string;
  touched_files: string[];
  agent_quote?: string;
  metadata?: Record<string, any>;
}

interface PresenceCardProps {
  event?: PresenceEventPayload;
  onApprove?: (note?: string) => void;
  onRevert?: () => void;
  onReply?: (message: string) => void;
  onOpen?: () => void;
  onDismiss?: () => void;
}

export const PresenceCard: React.FC<PresenceCardProps> = ({
  event: propEvent,
  onApprove,
  onRevert,
  onReply,
  onOpen,
  onDismiss,
}) => {
  const [activeEvent, setActiveEvent] = useState<PresenceEventPayload | null>(propEvent || null);
  const [replyText, setReplyText] = useState('');
  const [showReplyInput, setShowReplyInput] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Auto-load live active turn or queue item if no prop passed
  useEffect(() => {
    if (propEvent) {
      setActiveEvent(propEvent);
      return;
    }

    const checkReplyParam = typeof window !== 'undefined' && 
      (new URLSearchParams(window.location.search).get('focus') === 'reply' || 
       new URLSearchParams(window.location.search).get('reply') === 'true');
    if (checkReplyParam) {
      setShowReplyInput(true);
    }

    async function loadCurrentState() {
      try {
        // First check Action Queue for pending items
        const q = await call("queue.get", {});
        if (q && q.items && q.items.length > 0) {
          const item = q.items[0];
          setActiveEvent({
            seq: 1,
            timestamp: new Date().toISOString(),
            project_id: 'afwe',
            host_id: 'local',
            turn_id: item.id,
            kind: `queue.${item.kind}`,
            blast_radius: item.blast_radius || 'medium',
            requires_human: item.requires_human ?? true,
            title: item.title,
            detail: item.detail,
            touched_files: [],
            agent_quote: item.detail,
          });
          return;
        }

        // Second check active turns
        const t = await call("timeline.get", {});
        const openTurn = (t?.turns || []).find((turn: any) => turn.status === "open");
        if (openTurn) {
          setActiveEvent({
            seq: 1,
            timestamp: openTurn.created_at || new Date().toISOString(),
            project_id: 'afwe',
            host_id: 'local',
            turn_id: openTurn.alias || openTurn.id,
            kind: 'turn.active',
            blast_radius: 'low',
            requires_human: true,
            title: `Turn ${openTurn.alias || openTurn.id}: In Progress`,
            detail: openTurn.prompt || "Turn changes active in working tree",
            touched_files: openTurn.claims || [],
            agent_quote: openTurn.prompt,
          });
          return;
        }

        // Fallback default if queue & turn are idle
        setActiveEvent({
          seq: 1,
          timestamp: new Date().toISOString(),
          project_id: 'afwe',
          host_id: 'local',
          turn_id: 'active',
          kind: 'system.idle',
          blast_radius: 'low',
          requires_human: false,
          title: 'All Invariants Satisfied',
          detail: 'No pending approvals or uncommitted turns awaiting review.',
          touched_files: [],
        });
      } catch (e) {
        console.warn("Could not load queue state for presence card:", e);
      }
    }

    loadCurrentState();
  }, [propEvent]);

  const ev = activeEvent || {
    seq: 1,
    timestamp: new Date().toISOString(),
    project_id: 'afwe',
    host_id: 'local',
    kind: 'turn.active',
    blast_radius: 'low',
    requires_human: false,
    title: 'AFWE Presence Card',
    detail: 'Loading workspace state...',
    touched_files: [],
  };

  const isSticky = ev.requires_human || ev.blast_radius === 'high' || ev.kind.startsWith('turn.staged');

  const handleApprove = async () => {
    if (onApprove) {
      onApprove();
      return;
    }
    setLoading(true);
    try {
      if (ev.turn_id && ev.turn_id.startsWith('t')) {
        try {
          await call("turn.confirm", { turn: ev.turn_id });
          setActionStatus("✔ Proposal approved & confirmed");
          setLoading(false);
          return;
        } catch {
          // fallback to turn.commit if not staged
        }
        await call("turn.commit", { turn: ev.turn_id, summary: "Approved via Card HUD", footer_shown: true, confirmed: true });
        setActionStatus("✔ Approved successfully");
      } else {
        await call("queue.act", { item: ev.turn_id || "active", action: "approve" });
        setActionStatus("✔ Approved successfully");
      }
    } catch (e: any) {
      setActionStatus(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenStudio = () => {
    if (onOpen) {
      onOpen();
      return;
    }
    const targetUrl = ev.turn_id ? `/?view=timeline&turn=${ev.turn_id}` : '/';
    window.location.href = `${window.location.origin}${targetUrl}`;
  };

  const handleRevert = async () => {
    if (onRevert) {
      onRevert();
      return;
    }
    setLoading(true);
    try {
      if (ev.turn_id && ev.turn_id.startsWith('t')) {
        await call("turn.redo", { turn: ev.turn_id });
      } else {
        await call("queue.act", { item: ev.turn_id || "active", action: "revert" });
      }
      setActionStatus("✔ Reverted changes");
    } catch (e: any) {
      setActionStatus(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleOptionClick = async (option: string) => {
    setLoading(true);
    try {
      await call("turn.resume", {
        turn: ev.turn_id,
        answer: option,
      });
      setActionStatus(`✔ Resumed with ${option}`);
    } catch (e: any) {
      setActionStatus(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleReply = async () => {
    if (!replyText.trim()) return;
    if (onReply) {
      onReply(replyText.trim());
      setShowReplyInput(false);
      setReplyText('');
      return;
    }
    setLoading(true);
    try {
      if (ev.kind === "mid_turn.pause") {
        await call("turn.resume", {
          turn: ev.turn_id,
          answer: replyText.trim(),
        });
        setShowReplyInput(false);
        setReplyText('');
        setActionStatus("✔ Resumed with steering answer");
      } else {
        await call("memory.add", {
          kind: "decision",
          title: `Steering instruction for ${ev.turn_id || "turn"}`,
          body: replyText.trim(),
        });
        setShowReplyInput(false);
        setReplyText('');
        setActionStatus("✔ Steering reply recorded");
      }
    } catch (e: any) {
      setActionStatus(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDismiss = () => {
    if (onDismiss) {
      onDismiss();
    } else {
      window.close();
    }
  };

  return (
    <div
      tabIndex={-1}
      className="w-[420px] bg-slate-900/95 border border-slate-700/80 rounded-2xl p-4 shadow-2xl backdrop-blur-xl flex flex-col justify-between text-slate-200 select-none font-sans outline-none"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* Header with Official AFWE Emblem and Wordmark */}
      <div>
        <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5 mb-3">
          <div className="flex items-center gap-2.5">
            <img src="/afwe-icon.svg" alt="AFWE" className="w-6 h-6 object-contain" />
            <img
              src="/afwe-wordmark.svg"
              alt="AFWE"
              className="h-3.5 w-auto object-contain filter invert opacity-90"
            />
            {ev.turn_id && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-800/90 text-blue-300 font-mono font-medium">
                {ev.turn_id}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                isSticky
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              }`}
            >
              {isSticky ? 'Action Required' : 'Monitored'}
            </span>
            <button
              onClick={handleDismiss}
              className="text-slate-500 hover:text-slate-300 text-xs px-1.5 py-0.5 hover:bg-slate-800 rounded transition"
              title="Close Card"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="text-[13px] font-semibold text-slate-100 line-clamp-1">{ev.title}</div>
        <div className="text-[11.5px] text-slate-400 line-clamp-2 mt-0.5 leading-relaxed">{ev.detail}</div>

        {/* Quoted Agent Text */}
        {ev.agent_quote && (
          <div className="mt-2 text-[11px] bg-slate-950/70 border-l-2 border-blue-500/80 px-2.5 py-1.5 rounded-r text-slate-300 italic line-clamp-2">
            <span className="text-blue-400 font-medium not-italic text-[10px] block mb-0.5">
              Agent Note:
            </span>
            "{ev.agent_quote}"
          </div>
        )}

        {actionStatus && (
          <div className="mt-2 text-[11px] text-blue-300 bg-blue-950/40 border border-blue-800/40 px-2 py-1 rounded">
            {actionStatus}
          </div>
        )}
      </div>

      {/* Reply input drawer if toggled */}
      {showReplyInput ? (
        <div className="flex items-center gap-1.5 pt-3 mt-2 border-t border-slate-800/80">
          <input
            type="text"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleReply()}
            placeholder="Type steering reply to agent..."
            className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500 placeholder-slate-500"
            autoFocus
          />
          <button
            disabled={loading}
            onClick={handleReply}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition disabled:opacity-50"
          >
            Send
          </button>
          <button
            onClick={() => setShowReplyInput(false)}
            className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition"
          >
            Cancel
          </button>
        </div>
      ) : (
        /* Action Buttons */
        <div className="flex flex-col gap-2 pt-3 mt-3 border-t border-slate-800/80">
          {ev.kind === "mid_turn.pause" && Array.isArray(ev.metadata?.options) && ev.metadata.options.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pb-1">
              {ev.metadata.options.map((opt: string) => (
                <button
                  key={opt}
                  disabled={loading}
                  onClick={() => handleOptionClick(opt)}
                  className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-medium transition"
                >
                  ✔ {opt}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {ev.requires_human && ev.kind !== "mid_turn.pause" && (
                <button
                  disabled={loading}
                  onClick={handleApprove}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium transition shadow-sm disabled:opacity-50"
                >
                  Approve
                </button>
              )}
              {ev.kind !== "mid_turn.pause" && (
                <button
                  disabled={loading}
                  onClick={handleRevert}
                  className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-rose-300 rounded-lg text-xs font-medium transition disabled:opacity-50"
                >
                  Revert
                </button>
              )}
              <button
                onClick={() => setShowReplyInput(true)}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition"
              >
                Reply
              </button>
            </div>

            <button
              onClick={handleOpenStudio}
              className="px-3 py-1.5 bg-blue-900/40 hover:bg-blue-900/60 text-blue-300 border border-blue-700/50 rounded-lg text-xs font-medium transition flex items-center gap-1"
            >
              Open Studio &rarr;
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
