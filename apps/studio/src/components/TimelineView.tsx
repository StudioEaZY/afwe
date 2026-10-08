import { useEffect, useState } from "react";
import { call } from "../api";
import { useStore } from "../store";

/** History by intent: committed turns, proposals to confirm or revert, losses and restores. */
export function TimelineView() {
  const { notify, refresh } = useStore();
  const [entries, setEntries] = useState<any[]>([]);
  const [vcs, setVcs] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [patch, setPatch] = useState("");
  const [losses, setLosses] = useState<any>(null);
  const [plan, setPlan] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const v: any = await call("timeline.list", { limit: 200 });
    setEntries(v.turns || []);
    setVcs(v.vcs || "");
    setLosses(await call("timeline.losses", {}));
  };

  const open = async (turn: string) => {
    setSel(turn);
    setPlan(null);
    setDetail(await call("timeline.get", { turn }));
    try {
      const d: any = await call("timeline.diff", { turn });
      setPatch(d.patch || "");
    } catch {
      setPatch("");
    }
  };

  const act = async (label: string, fn: () => Promise<any>) => {
    setBusy(true);
    try {
      const r = await fn();
      notify(`${label}: ${r?.status ?? "done"}`);
      await load();
      if (sel) await open(sel);
      await refresh();
    } catch (e: any) {
      notify(`${label} failed: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load().catch((e) => notify(String(e?.message || e)));
  }, []);

  const missing: any[] = losses?.currently_missing || [];
  const t = detail?.turn;

  return (
    <div className="tl">
      <div className="tl-list">
        <div className="panel-head">
          <span>Timeline</span>
          <span className="muted small-text">{vcs === "git" ? "git" : "no version control"}</span>
          <button className="ghost small" onClick={() => load()} disabled={busy}>
            refresh
          </button>
        </div>
        {missing.length > 0 && (
          <div className="tl-losses">
            <div className="tl-h">Features that are gone</div>
            {missing.map((m: any) => (
              <div key={m.node} className="tl-loss">
                <span>
                  {m.name || m.node}{" "}
                  <span className={m.on_purpose ? "muted" : "warn-text"}>
                    lost in {m.lost_in}
                    {m.on_purpose ? " (declared)" : " (collateral)"}
                  </span>
                </span>
                <button
                  className="small"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      setPlan(await call("timeline.restore", { feature: m.node, apply: false }));
                    } catch (e: any) {
                      notify(String(e?.message || e));
                    }
                  }}
                >
                  restore…
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="tl-rows">
          {entries.length === 0 && <div className="empty-hint">No turns yet. Start one with <code>afwe turn begin "…"</code>.</div>}
          {entries.map((e: any) => (
            <button key={e.turn} className={`tl-row ${sel === e.turn ? "active" : ""}`} onClick={() => open(e.turn)}>
              <span className="tl-id">{e.turn}</span>
              <span className={`tl-status st-${e.status}`}>{e.status}</span>
              <span className="tl-prompt">{e.prompt || e.summary}</span>
              <span className="tl-meta">
                {e.sha ? e.sha : ""} {e.confidence != null ? `${Math.round(e.confidence * 100)}%` : ""}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="tl-detail">
        {!t && <div className="empty-hint">Select a turn to see its prompt, its gate and its diff.</div>}
        {t && (
          <>
            <div className="tl-title">
              <span className="tl-id">{t.id}</span>
              <span className={`tl-status st-${t.status}`}>{t.status}</span>
              {detail?.commit?.sha && <span className="muted">commit {String(detail.commit.sha).slice(0, 7)}</span>}
            </div>
            <p className="tl-prompt-full">{t.prompt}</p>
            <div className="tl-kv">
              <span>strength</span>
              <b className={t.strength === "unverified" ? "warn-text" : ""}>{String(t.strength).replace("llm_judged", "LLM-judged")}</b>
              <span>confidence</span>
              <b>{Math.round((t.confidence || 0) * 100)}%</b>
              <span>origin</span>
              <b>{t.origin}</b>
            </div>
            {t.confidence_parts && (
              <div className="tl-parts">
                {Object.entries(t.confidence_parts).map(([k, v]: any) => (
                  <span key={k} className="pill">
                    {k} {Math.round(v * 100)}%
                  </span>
                ))}
              </div>
            )}
            {(t.status === "staged" || t.status === "ready") && (
              <div className="tl-actions">
                {t.status === "staged" && (
                  <button disabled={busy} onClick={() => act("confirm", () => call("turn.confirm", { turn: t.id }))}>
                    Accept (commit through the gate)
                  </button>
                )}
                <button className="ghost" disabled={busy} onClick={() => act("revert", () => call("turn.revert", { turn: t.id }))}>
                  Revert
                </button>
              </div>
            )}
            {(t.gate?.reasons || []).length > 0 && (
              <div className="tl-block">
                <div className="tl-h">Gate</div>
                {(t.gate.reasons as string[]).map((r, i) => (
                  <div key={i} className="tl-reason">
                    {r}
                  </div>
                ))}
              </div>
            )}
            {(t.checks || []).length > 0 && (
              <div className="tl-block">
                <div className="tl-h">Checks</div>
                {(t.checks as any[]).map((c) => (
                  <div key={c.id} className="tl-check">
                    <span className={c.passed ? "ok-text" : "bad-text"}>{c.passed ? "✔" : "✖"}</span> {c.title || c.id}{" "}
                    <span className="muted">
                      ({c.trust}, by {c.authored_by})
                    </span>
                    {c.message && <div className="muted small-text">{c.message}</div>}
                  </div>
                ))}
              </div>
            )}
            {(t.intents || []).length > 0 && (
              <div className="tl-block">
                <div className="tl-h">Intents</div>
                {(t.intents as any[]).map((i) => (
                  <div key={i.id} className="tl-check">
                    {i.action} <b>{i.id}</b> {(i.targets || []).join(", ")}
                  </div>
                ))}
              </div>
            )}
            {plan && (
              <div className="tl-block tl-plan">
                <div className="tl-h">
                  Restore plan for <code>{plan.feature}</code> (from {plan.from_turn}, lost in {plan.lost_turn})
                </div>
                {(plan.files || []).map((f: any) => (
                  <div key={f.path} className="tl-check">
                    {f.path} <span className="muted">({f.conflicts} conflict region(s))</span>
                  </div>
                ))}
                <button
                  disabled={busy}
                  onClick={() => act("restore", () => call("timeline.restore", { feature: plan.feature, apply: true }))}
                >
                  Open the restore turn
                </button>
              </div>
            )}
            {patch && (
              <div className="tl-block">
                <div className="tl-h">Diff</div>
                <pre className="tl-patch">{patch}</pre>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
