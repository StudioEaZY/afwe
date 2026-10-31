import React, { useState } from 'react';

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
  event = {
    seq: 1,
    timestamp: new Date().toISOString(),
    project_id: 'afwe',
    host_id: 'laptop',
    turn_id: 't0061',
    kind: 'turn.staged',
    blast_radius: 'low',
    requires_human: true,
    title: 'Turn t0061: staged proposal awaiting confirmation',
    detail: 'Touch files in apps/studio and crates/afwe-cli',
    touched_files: ['apps/studio/src-tauri/tauri.conf.json', 'apps/studio/src/components/PresenceCard.tsx'],
    agent_quote: 'Add Tauri card window with no-activate focus safety.',
  },
  onApprove,
  onRevert,
  onReply,
  onOpen,
  onDismiss,
}) => {
  const [replyText, setReplyText] = useState('');
  const [showReplyInput, setShowReplyInput] = useState(false);

  const isSticky = event.requires_human || event.blast_radius === 'high' || event.kind.startsWith('turn.staged');

  return (
    <div
      tabIndex={-1}
      className="w-[380px] h-[260px] bg-slate-900/95 border border-slate-700/80 rounded-xl p-3.5 shadow-2xl backdrop-blur-md flex flex-col justify-between text-slate-200 select-none font-sans outline-none"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* Header */}
      <div>
        <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-2 mb-2">
          <div className="flex items-center gap-1.5">
            <span className="text-blue-400 font-bold text-sm tracking-wide flex items-center gap-1">
              ⛨ AFWE
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
              {event.project_id}@{event.host_id}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                isSticky
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              }`}
            >
              {isSticky ? 'Sticky' : 'Done'}
            </span>
            <button
              onClick={onDismiss}
              className="text-slate-500 hover:text-slate-300 text-xs px-1 hover:bg-slate-800 rounded transition"
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="text-xs font-semibold text-slate-100 line-clamp-1">{event.title}</div>
        <div className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">{event.detail}</div>

        {/* Quoted Agent Text */}
        {event.agent_quote && (
          <div className="mt-2 text-[11px] bg-slate-950/70 border-l-2 border-blue-500/80 px-2 py-1.5 rounded-r text-slate-300 italic line-clamp-2">
            <span className="text-blue-400 font-medium not-italic text-[10px] block mb-0.5">
              The agent said:
            </span>
            "{event.agent_quote}"
          </div>
        )}
      </div>

      {/* Reply input drawer if toggled */}
      {showReplyInput ? (
        <div className="flex items-center gap-1.5 pt-1">
          <input
            type="text"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Type steering reply..."
            className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
            autoFocus
          />
          <button
            onClick={() => {
              if (replyText.trim() && onReply) {
                onReply(replyText.trim());
                setShowReplyInput(false);
                setReplyText('');
              }
            }}
            className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium"
          >
            Send
          </button>
          <button
            onClick={() => setShowReplyInput(false)}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs"
          >
            Cancel
          </button>
        </div>
      ) : (
        /* Action Buttons */
        <div className="flex items-center justify-between gap-1.5 pt-2 border-t border-slate-800/80">
          <div className="flex items-center gap-1">
            {event.requires_human && (
              <button
                onClick={() => onApprove && onApprove()}
                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-medium transition shadow-sm"
              >
                Approve
              </button>
            )}
            <button
              onClick={() => onRevert && onRevert()}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-rose-300 rounded text-xs font-medium transition"
            >
              Revert
            </button>
            <button
              onClick={() => setShowReplyInput(true)}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-medium transition"
            >
              Reply
            </button>
          </div>

          <button
            onClick={() => onOpen && onOpen()}
            className="px-2 py-1 bg-blue-900/40 hover:bg-blue-900/60 text-blue-300 border border-blue-700/50 rounded text-xs font-medium transition"
          >
            Open Studio →
          </button>
        </div>
      )}
    </div>
  );
};
