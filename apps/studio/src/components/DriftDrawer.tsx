import { useEffect, useState } from "react";
import { useStore } from "../store";
import { api } from "../api";

const pct = (c: number) => `${Math.round(c * 100)}%`;

export function DriftDrawer() {
  const { graph, setDrawer, run, notify, select } = useStore();
  const [drift, setDrift] = useState<any>(null);
  const [review, setReview] = useState<any>(null);
  const [tab, setTab] = useState<"proposals" | "findings" | "log">("proposals");
  const [log, setLog] = useState<any[]>([]);

  const load = () => {
    api.drift().then(setDrift).catch((e) => notify(`✗ ${e.message}`));
    api.log(60).then(setLog).catch(() => {});
  };
  useEffect(load, [graph]);

  if (!graph) return null;
  const proposals = graph.proposals;
  const policy = graph.policy;

  return (
    <div className="drawer">
      <div className="drawer-head">
        <b>Drift</b>
        <span className="muted">
          blueprint ⇄ code — {graph.sync.status === "in_sync" ? "in sync" : graph.sync.status === "stale" ? "out of sync: run Sync" : "never synced"}
        </span>
        <span className="tabs small">
          <button className={tab === "proposals" ? "tab active" : "tab"} onClick={() => setTab("proposals")}>
            Proposals {proposals.length > 0 && <span className="badge warn">{proposals.length}</span>}
          </button>
          <button className={tab === "findings" ? "tab active" : "tab"} onClick={() => setTab("findings")}>
            Findings {drift && <span className="badge">{drift.count}</span>}
          </button>
          <button className={tab === "log" ? "tab active" : "tab"} onClick={() => setTab("log")}>
            Change log
          </button>
        </span>
        <button className="ghost small" onClick={() => setDrawer(null)}>
          ✕
        </button>
      </div>
      <div className="policy muted">
        confidence policy: ≥{pct(policy.auto_reconcile_min)} auto-reconcile + log · {pct(policy.soft_reconcile_min)}–{pct(policy.auto_reconcile_min)} auto-reconcile if no contradiction + uncertainty marker · &lt;{pct(policy.soft_reconcile_min)} propose (accept / revert / review)
      </div>

      {tab === "proposals" && (
        <div className="drawer-body">
          {proposals.length === 0 && <div className="empty-sm">No pending proposals. AFWE never invents agreement — anything under {pct(policy.soft_reconcile_min)} confidence lands here.</div>}
          {proposals.map((p: any) => (
            <div key={p.id} className="proposal">
              <div className="p-head">
                <span className={`pill ${p.finding.severity}`}>{p.finding.kind.replace(/_/g, " ")}</span>
                <span className="conf">confidence {pct(p.finding.confidence)}</span>
                <span className="muted">{p.created.slice(0, 16).replace("T", " ")}</span>
              </div>
              <div className="p-summary">{p.finding.summary}</div>
              {p.finding.evidence?.length > 0 && (
                <ul className="evidence">
                  {p.finding.evidence.slice(0, 4).map((e: string, i: number) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
              {p.finding.nodes?.length > 0 && (
                <div className="muted">
                  nodes:{" "}
                  {p.finding.nodes.map((n: string) => (
                    <a key={n} className="ref" onClick={() => select(n)}>
                      {n}
                    </a>
                  ))}
                </div>
              )}
              <div className="p-actions">
                <button onClick={() => run("Accepting proposal", () => api.proposal(p.id, "accept")).then(() => notify("Proposal accepted and logged"))}>Accept</button>
                <button className="ghost" onClick={() => run("Reverting proposal", () => api.proposal(p.id, "revert")).then(() => notify("Proposal reverted (logged)"))}>
                  Revert
                </button>
                <button className="ghost" onClick={async () => setReview(await api.proposal(p.id, "review"))}>
                  Review impact
                </button>
              </div>
            </div>
          ))}
          {review && (
            <div className="review">
              <div className="p-head">
                <b>Impact review</b>
                <button className="ghost small" onClick={() => setReview(null)}>
                  ✕
                </button>
              </div>
              <div className="p-summary">{review.finding.summary}</div>
              <div className="kv">
                <span>nodes</span>
                <span>{review.nodes.join(", ") || "—"}</span>
                <span>memory</span>
                <span>{review.memory.map((m: any) => `${m.kind}: ${m.title}`).join("; ") || "—"}</span>
                <span>guardrails</span>
                <span>{review.guardrails.map((g: any) => g.statement).join("; ") || "—"}</span>
                <span>constraints</span>
                <span>{review.constraints.map((c: any) => c.id).join(", ") || "—"}</span>
                <span>files</span>
                <span className="mono">{review.files.slice(0, 12).join(", ") || "—"}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "findings" && (
        <div className="drawer-body">
          {!drift && <div className="muted">analysing…</div>}
          {drift && drift.findings.length === 0 && <div className="empty-sm">Blueprint and code agree.</div>}
          {drift?.findings.map((it: any) => (
            <div key={it.finding.id} className={`finding ${it.bucket}`}>
              <div className="p-head">
                <span className={`pill ${it.finding.severity}`}>{it.finding.kind.replace(/_/g, " ")}</span>
                <span className="conf">{pct(it.finding.confidence)}</span>
                <span className={`bucket ${it.bucket}`}>{it.bucket === "auto" ? "will auto-apply on sync" : it.bucket === "soft" ? "auto-apply + uncertainty marker" : it.bucket === "proposal" ? "becomes a proposal" : "info"}</span>
              </div>
              <div className="p-summary">{it.finding.summary}</div>
              {it.describe && <div className="muted">→ {it.describe}</div>}
              {it.finding.nodes?.length > 0 && (
                <div className="muted">
                  {it.finding.nodes.map((n: string) => (
                    <a key={n} className="ref" onClick={() => select(n)}>
                      {n}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
          {drift && drift.findings.length > 0 && (
            <button
              onClick={async () => {
                const r: any = await run("Syncing", () => api.sync());
                if (r) notify(`Synced — applied ${r.applied.length}, proposed ${r.proposed.length}`);
                load();
              }}
            >
              ↻ Sync now
            </button>
          )}
        </div>
      )}

      {tab === "log" && (
        <div className="drawer-body log">
          {log
            .slice()
            .reverse()
            .map((e: any, i: number) => (
              <div key={i} className="logline">
                <span className="muted">{(e.ts || "").slice(0, 16).replace("T", " ")}</span>
                <span className={`origin ${e.origin?.startsWith("llm") ? "llm" : "human"}`}>{e.origin}</span>
                <span className="pill">{e.kind}</span>
                <span>{e.summary}</span>
                {e.confidence != null && <span className="conf">{pct(e.confidence)}</span>}
                {e.uncertain && <span className="pill warn">uncertain</span>}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
