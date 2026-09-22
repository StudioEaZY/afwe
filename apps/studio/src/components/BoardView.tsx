import { useEffect, useState } from "react";
import { useStore } from "../store";
import { api } from "../api";
import { Modal, Field } from "./Modal";

const ACTION_LABEL: Record<string, string> = {
  afwe_context: "Ask AFWE for context",
  harness: "Harness step",
  afwe_workflow: "Author node workflow",
  afwe_blueprint: "Update blueprint",
  afwe_verify: "Verify against AFWE",
  afwe_update: "Update memory / architecture",
  afwe_log: "Log completion",
  afwe_sync: "Sync",
};

export function BoardView() {
  const { graph, run, notify, select, setView, setDrawer } = useStore();
  const [board, setBoard] = useState<any>(null);
  const [contracts, setContracts] = useState<any[]>([]);
  const [agents, setAgents] = useState<string>("");
  const [tab, setTab] = useState<"board" | "contracts">("board");
  const [starting, setStarting] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const load = () => {
    api.board().then(setBoard).catch((e) => notify(`✗ ${e.message}`));
    api.contracts().then(setContracts).catch(() => {});
    api.contractRender().then((r) => setAgents(r.markdown)).catch(() => {});
  };
  useEffect(load, [graph]);

  if (!board) return <div className="empty-sm center">loading board…</div>;
  const tasks = [...board.tasks].reverse();
  const hasOpen = (t: any) => t.status === "open" || board.items.some((i: any) => i.task === t.id && i.status === "open");
  const system = board.items.filter((i: any) => !i.task && (showDone || i.status === "open"));

  return (
    <div className="board">
      <div className="board-head">
        <span className="tabs small">
          <button className={tab === "board" ? "tab active" : "tab"} onClick={() => setTab("board")}>
            Board / Tasks <span className="badge">{board.open}</span>
          </button>
          <button className={tab === "contracts" ? "tab active" : "tab"} onClick={() => setTab("contracts")}>
            Contracts
          </button>
        </span>
        <span className="spacer" />
        <label className="muted">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> show completed
        </label>
        <button className="small" onClick={() => setStarting(true)}>
          + start task
        </button>
      </div>

      {tab === "board" && (
        <div className="board-cols">
          <div className="col">
            <h3>
              Contract obligations <span className="muted">what the harness still owes AFWE</span>
            </h3>
            {tasks.filter((t: any) => showDone || hasOpen(t)).length === 0 && <div className="empty-sm">No tasks. Agents open tasks via <code>afwe_task_start</code>; you can also start one here.</div>}
            {tasks
              .filter((t: any) => showDone || hasOpen(t))
              .map((t: any) => {
                const items = board.items.filter((i: any) => i.task === t.id);
                const open = items.filter((i: any) => i.status === "open").length;
                return (
                  <div key={t.id} className={`task ${t.status}`}>
                    <div className="t-head">
                      <span className="pill">{t.kind}</span>
                      <b>{t.title}</b>
                      <span className={`origin ${String(t.origin || "").startsWith("llm") ? "llm" : "human"}`}>{t.origin}</span>
                      <span className="muted">contract: {t.contract}</span>
                      <span className="spacer" />
                      <span className="muted">
                        {items.length - open}/{items.length} done
                      </span>
                      {t.status !== "open" && open > 0 && <span className="pill warn">closed with {open} unfulfilled</span>}
                      {t.status !== "open" && open === 0 && <span className="pill">{t.status}</span>}
                      {t.status === "open" && (
                        <button
                          className="small ghost"
                          onClick={async () => {
                            const msg = prompt("What changed and why? (logged)");
                            if (msg === null) return;
                            const r: any = await run("Closing task", () => api.task.done(t.id, msg || undefined));
                            if (r) notify(r.unfulfilled?.length ? `Task closed with ${r.unfulfilled.length} unfulfilled obligations` : "Task closed — all obligations met");
                          }}
                        >
                          mark done
                        </button>
                      )}
                    </div>
                    {(t.files?.length > 0 || t.nodes?.length > 0) && (
                      <div className="muted mono small">
                        {t.nodes?.map((n: string) => (
                          <a key={n} className="ref" onClick={() => { select(n); setView("blueprint"); }}>
                            {n}
                          </a>
                        ))}{" "}
                        {t.files?.join(", ")}
                      </div>
                    )}
                    <ol className="steps">
                      {items.map((i: any) => (
                        <li key={i.id} className={i.status}>
                          <span className="check">{i.status === "done" ? "☑" : i.status === "dismissed" ? "☒" : "☐"}</span>
                          <span className="act">{ACTION_LABEL[i.action] || i.action}</span>
                          <span className="muted">{i.detail}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                );
              })}
          </div>
          <div className="col">
            <h3>
              System items <span className="muted">proposals, uncertain reconciliations, sync</span>
            </h3>
            {system.length === 0 && <div className="empty-sm">Nothing needs a human right now.</div>}
            {system.map((i: any) => (
              <div key={i.id} className={`sysitem ${i.kind} ${i.status}`}>
                <div className="t-head">
                  <span className="pill">{i.kind}</span>
                  <b>{i.title}</b>
                  <span className="spacer" />
                  <span className="muted">{i.created.slice(0, 16).replace("T", " ")}</span>
                </div>
                {i.detail && <div className="muted">{i.detail}</div>}
                <div className="p-actions">
                  {i.kind === "proposal" && (
                    <button className="small" onClick={() => setDrawer("drift")}>
                      open in drift
                    </button>
                  )}
                  {i.kind === "sync" && (
                    <button className="small" onClick={() => run("Syncing", () => api.sync()).then(load)}>
                      sync now
                    </button>
                  )}
                  {i.status === "open" && (
                    <button className="small ghost" onClick={() => run("Dismissing", () => api.boardDismiss(i.id), false).then(load)}>
                      dismiss
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "contracts" && (
        <div className="contracts">
          <p className="hint">
            Contracts are scoped instructions that tell the harness what AFWE needs. AFWE is not a harness and does not own the agent loop — it only states its obligations and ticks them off as the agent calls its tools.
          </p>
          {contracts.map((c: any) => (
            <div key={c.id} className="contract">
              <h3>
                {c.name} <span className="muted">({c.id}) — task kinds: {c.task_kinds.join(", ")}</span>
              </h3>
              {c.description && <p>{c.description}</p>}
              <ol className="steps">
                {c.steps.map((s: any) => (
                  <li key={s.id}>
                    <span className="pill">{s.phase}</span> <span className="act">{ACTION_LABEL[s.action] || s.action}</span> <span className="muted">{s.instruction}</span>
                    {s.optional && <span className="pill">optional</span>}
                  </li>
                ))}
              </ol>
            </div>
          ))}
          <h3>
            AGENTS.md / CLAUDE.md block <span className="muted">(`afwe contract render`)</span>
          </h3>
          <pre className="md">{agents}</pre>
        </div>
      )}

      {starting && (
        <StartTaskModal
          onClose={() => setStarting(false)}
          onDone={() => {
            setStarting(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function StartTaskModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { graph, run, selected } = useStore();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("code");
  const [nodes, setNodes] = useState<string[]>(selected ? [selected] : []);
  return (
    <Modal title="Start task" onClose={onClose}>
      <Field label="Title">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Kind (selects the contract)">
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {["code", "bugfix", "refactor", "feature", "architecture", "workflow"].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </Field>
      <Field label="Nodes">
        <select multiple value={nodes} onChange={(e) => setNodes(Array.from(e.target.selectedOptions).map((o) => o.value))}>
          {graph?.nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.path}
            </option>
          ))}
        </select>
      </Field>
      <div className="actions">
        <button className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          disabled={!title.trim()}
          onClick={async () => {
            const r = await run("Starting task", () => api.task.start({ title, kind, nodes }));
            if (r) onDone();
          }}
        >
          Start
        </button>
      </div>
    </Modal>
  );
}
