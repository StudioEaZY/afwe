import { useEffect, useState } from "react";
import { call } from "../api";
import { useStore } from "../store";

/** Decisions a human has locked (pins), the intents behind the work, and the checks the gate runs. */
export function PinsView() {
  const { notify } = useStore();
  const [pins, setPins] = useState<any[]>([]);
  const [budget, setBudget] = useState<any>(null);
  const [intents, setIntents] = useState<any[]>([]);
  const [checks, setChecks] = useState<any[]>([]);

  const load = async () => {
    setPins((await call("pin.list", {})) as any[]);
    setBudget(await call("pin.budget", {}));
    setIntents((await call("intent.list", {})) as any[]);
    setChecks((await call("check.list", {})) as any[]);
  };

  useEffect(() => {
    load().catch((e) => notify(String(e?.message || e)));
  }, []);

  const run = async (label: string, fn: () => Promise<any>) => {
    try {
      await fn();
      notify(label);
      await load();
    } catch (e: any) {
      notify(String(e?.message || e));
    }
  };

  const order = { proposed: 0, active: 1, retired: 2 } as Record<string, number>;
  const sorted = [...pins].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

  return (
    <div className="pv">
      <section className="pv-col">
        <div className="panel-head">
          <span>Pins</span>
          <span className="muted small-text">human-locked decisions and intentional bugs</span>
        </div>
        {budget && (
          <div className="pv-budget">
            <div>
              <b>{budget.active}</b> of <b>{budget.limit}</b> pins active
              <span className="muted"> · auto {budget.auto_limit} for {budget.blueprint_nodes} nodes × slider {budget.slider}</span>
            </div>
            <div className="pv-meter">
              <div style={{ width: `${Math.min(100, (budget.active / Math.max(1, budget.limit)) * 100)}%` }} />
            </div>
            <label className="pv-slider">
              <span>strictness</span>
              <input
                type="range"
                min={1}
                max={5}
                step={1}
                value={budget.slider}
                onChange={(e) => run(`slider ${e.target.value}`, () => call("pin.budget", { slider: Number(e.target.value) }))}
              />
              <span className="muted small-text">{["relaxed", "lean", "balanced", "firm", "strict"][budget.slider - 1]}</span>
            </label>
          </div>
        )}
        <div className="pv-rows">
          {sorted.length === 0 && <div className="empty-hint">No pins yet. Say “keep it like that” in a prompt, or add one with <code>afwe pin propose</code>.</div>}
          {sorted.map((p) => (
            <div key={p.id} className={`pv-row st-${p.status}`}>
              <div className="pv-top">
                <span className={`pill ${p.severity === "block" ? "error" : p.severity === "confirm" ? "warn" : ""}`}>{p.severity}</span>
                {p.intentional && <span className="pill passive">intentional</span>}
                <span className="pill">{p.status}</span>
                <span className="muted small-text">{p.id}</span>
              </div>
              <div className="pv-statement">{p.statement}</div>
              <div className="muted small-text">
                {(p.attaches?.nodes || []).length > 0 ? `on ${p.attaches.nodes.join(", ")}` : "global"} · from {p.origin}
                {p.created_from ? ` · ${p.created_from}` : ""}
              </div>
              <div className="pv-actions">
                {p.status === "proposed" && (
                  <button className="small" onClick={() => run("accepted", () => call("pin.accept", { id: p.id }))}>
                    accept
                  </button>
                )}
                {p.status !== "retired" && (
                  <button className="ghost small" onClick={() => run("retired", () => call("pin.retire", { id: p.id, reason: "retired in the Studio" }))}>
                    retire
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="pv-col">
        <div className="panel-head">
          <span>Intents</span>
          <span className="muted small-text">merged from the raw prompts; the prompts are kept</span>
        </div>
        <div className="pv-rows">
          {intents.length === 0 && <div className="empty-hint">Intents appear when a turn declares them (<code>turn assume</code>).</div>}
          {intents.map((i) => (
            <div key={i.id} className="pv-row">
              <div className="pv-top">
                <b>{i.title || i.id}</b>
                <span className="pill">{i.status}</span>
                <span className="muted small-text">{(i.from_turns || []).length} turn(s)</span>
              </div>
              <div className="pv-statement">{i.statement || <span className="muted">no statement</span>}</div>
              {(i.history || []).length > 1 && <div className="muted small-text">{i.history.length} revisions · latest from {i.history[i.history.length - 1].turn}</div>}
            </div>
          ))}
        </div>
      </section>

      <section className="pv-col">
        <div className="panel-head">
          <span>Checks</span>
          <span className="muted small-text">what the gate must pass</span>
        </div>
        <div className="pv-rows">
          {checks.length === 0 && <div className="empty-hint">No registered checks. Confirmed claims become checks automatically (checkgen).</div>}
          {checks.map((c) => (
            <div key={c.id} className="pv-row">
              <div className="pv-top">
                <span className={`pill ${c.trust === "deterministic" ? "passive" : ""}`}>{c.trust}</span>
                <span className="muted small-text">by {c.authored_by}</span>
              </div>
              <div className="pv-statement">{c.title || c.id}</div>
              <div className="muted small-text">
                {c.claim ? `claim: ${c.claim.type}` : `command: ${c.command}`}
                {(c.attaches?.nodes || []).length > 0 ? ` · on ${c.attaches.nodes.join(", ")}` : ""}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
