import { useEffect, useState } from "react";
import { useStore } from "../store";
import { api } from "../api";
import { Modal, Field } from "./Modal";

const KINDS = ["decision", "constraint", "exception", "terminology", "problem"];

export function MemoryView() {
  const { graph, run, notify, select, setView } = useStore();
  const [items, setItems] = useState<any[]>([]);
  const [guardrails, setGuardrails] = useState<any[]>([]);
  const [kind, setKind] = useState<string>("");
  const [node, setNode] = useState<string>("");
  const [q, setQ] = useState("");
  const [current, setCurrent] = useState<string | null>(null);
  const [entry, setEntry] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addingGuard, setAddingGuard] = useState(false);
  const [section, setSection] = useState<"memory" | "guardrails">("memory");

  const load = () => {
    api.memory.list({ kind: kind || undefined, node: node || undefined, q: q || undefined }).then((r) => setItems(r.memory));
    api.guardrail.list().then(setGuardrails);
  };
  useEffect(load, [kind, node, q, graph]);
  useEffect(() => {
    if (current) api.memory.get(current).then(setEntry).catch(() => setEntry(null));
    else setEntry(null);
  }, [current, graph]);

  const counts = KINDS.map((k) => [k, Object.values(graph?.memory || {}).filter((m: any) => m.kind === k).length] as const);

  return (
    <div className="main three memory-view">
      <aside className="panel left">
        <div className="panel-head">
          <span className="tabs small">
            <button className={section === "memory" ? "tab active" : "tab"} onClick={() => setSection("memory")}>
              Memory
            </button>
            <button className={section === "guardrails" ? "tab active" : "tab"} onClick={() => setSection("guardrails")}>
              Guardrails <span className="badge">{guardrails.length}</span>
            </button>
          </span>
        </div>
        {section === "memory" ? (
          <>
            <div className="filters">
              <input placeholder="search knowledge…" value={q} onChange={(e) => setQ(e.target.value)} />
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">all kinds</option>
                {counts.map(([k, c]) => (
                  <option key={k} value={k}>
                    {k}s ({c})
                  </option>
                ))}
              </select>
              <select value={node} onChange={(e) => setNode(e.target.value)}>
                <option value="">any node</option>
                {graph?.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.path}
                  </option>
                ))}
              </select>
            </div>
            <div className="tree">
              {items.map((m) => (
                <div key={m.id} className={`row mem ${current === m.id ? "sel" : ""}`} onClick={() => setCurrent(m.id)}>
                  <span className={`kind ${m.kind}`}>{m.kind}</span>
                  <span className="name">{m.title}</span>
                  {m.status && m.status !== "accepted" && <span className="pill">{m.status}</span>}
                </div>
              ))}
              {items.length === 0 && <div className="empty-sm">No knowledge matches.</div>}
            </div>
            <div className="panel-foot">
              <button className="small" onClick={() => setAdding(true)}>
                + memory
              </button>
              <span className="hint">memory/&lt;kind&gt;/*.md · indexed by node, file, symbol, tag</span>
            </div>
          </>
        ) : (
          <>
            <div className="tree">
              {guardrails.map((g) => (
                <div key={g.id} className={`row mem ${current === "g:" + g.id ? "sel" : ""}`} onClick={() => setCurrent("g:" + g.id)}>
                  <span className={`pill ${g.mode}`}>{g.mode}</span>
                  <span className="name">{g.statement}</span>
                </div>
              ))}
            </div>
            <div className="panel-foot">
              <button className="small" onClick={() => setAddingGuard(true)}>
                + guardrail
              </button>
              <span className="hint">passive = context insertion · active = checks that fail verify</span>
            </div>
          </>
        )}
      </aside>

      <section className="detail">
        {current?.startsWith("g:") ? (
          <GuardrailDetail g={guardrails.find((x) => "g:" + x.id === current)} onRemove={async (id) => { await run("Removing guardrail", () => api.guardrail.remove(id)); setCurrent(null); }} />
        ) : entry ? (
          <article className="memory">
            <div className="m-head">
              <span className={`kind ${entry.kind}`}>{entry.kind}</span>
              <h2>{entry.title}</h2>
              <span className="spacer" />
              <button className="small ghost" onClick={() => setEditing(true)}>
                edit
              </button>
              <button
                className="small ghost danger"
                onClick={async () => {
                  if (confirm(`Delete memory "${entry.title}"?`)) {
                    await run("Removing memory", () => api.memory.remove(entry.id));
                    setCurrent(null);
                  }
                }}
              >
                delete
              </button>
            </div>
            <div className="m-meta">
              <span>
                id <code>{entry.id}</code>
              </span>
              <span>status {entry.status || "—"}</span>
              <span>
                origin <span className={`origin ${String(entry.origin || "").startsWith("llm") ? "llm" : "human"}`}>{entry.origin || "—"}</span>
              </span>
              <span>created {entry.created || "—"}</span>
              {entry.updated && <span>updated {entry.updated}</span>}
              <span>
                file <code>.afwe/{entry.path}</code>
              </span>
            </div>
            <div className="m-scope">
              <div>
                <b>applies to</b>{" "}
                {entry.applies_to?.length
                  ? entry.applies_to.map((n: string) => (
                      <a key={n} className="ref" onClick={() => { select(graph?.nodes.find((x) => x.id === n || x.path === n || x.name === n)?.id || n); setView("blueprint"); }}>
                        {n}
                      </a>
                    ))
                  : <span className="muted">whole project</span>}
              </div>
              {entry.files?.length > 0 && (
                <div>
                  <b>files</b> <span className="mono">{entry.files.join(", ")}</span>
                </div>
              )}
              {entry.symbols?.length > 0 && (
                <div>
                  <b>symbols</b> <span className="mono">{entry.symbols.join(", ")}</span>
                </div>
              )}
              {entry.tags?.length > 0 && (
                <div>
                  <b>tags</b> {entry.tags.join(", ")}
                </div>
              )}
              {entry.enforces?.length > 0 && (
                <div>
                  <b>enforces constraints</b> {entry.enforces.join(", ")}
                </div>
              )}
              {entry.supersedes && (
                <div>
                  <b>supersedes</b> {entry.supersedes}
                </div>
              )}
              {entry.workflow && (
                <div>
                  <b>from workflow</b> {entry.workflow}
                </div>
              )}
            </div>
            <pre className="md body">{entry.body}</pre>
          </article>
        ) : (
          <div className="empty-sm center">
            <h3>Memory is an indexed knowledge system</h3>
            <p>
              Files = knowledge. Index = location/retrieval. Code = implementation.
              <br />
              Select an entry, or add a decision / constraint / exception / terminology / problem.
            </p>
            <div className="kinds">
              {counts.map(([k, c]) => (
                <span key={k} className={`kind ${k}`}>
                  {c} {k}
                  {c === 1 ? "" : "s"}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {adding && (
        <MemoryModal
          onClose={() => setAdding(false)}
          onSave={async (p) => {
            const r: any = await run("Adding memory", () => api.memory.add(p));
            if (r) {
              setAdding(false);
              setCurrent(r.id);
              notify(`Saved .afwe/${r.path}`);
            }
          }}
        />
      )}
      {editing && entry && (
        <MemoryModal
          entry={entry}
          onClose={() => setEditing(false)}
          onSave={async (p) => {
            await run("Updating memory", () => api.memory.update(entry.id, p));
            setEditing(false);
            api.memory.get(entry.id).then(setEntry);
          }}
        />
      )}
      {addingGuard && (
        <GuardrailModal
          onClose={() => setAddingGuard(false)}
          onSave={async (g) => {
            const r: any = await run("Adding guardrail", () => api.guardrail.add(g));
            if (r) {
              setAddingGuard(false);
              setSection("guardrails");
              setCurrent("g:" + r.id);
            }
          }}
        />
      )}
    </div>
  );
}

function GuardrailDetail({ g, onRemove }: { g: any; onRemove: (id: string) => void }) {
  if (!g) return null;
  const scope = (s: any) => [...(s.nodes || []).map((n: string) => `node ${n}`), ...(s.files || []).map((f: string) => `files ${f}`), ...(s.relations || []).map((r: string) => `relation ${r}`), ...(s.lenses || []).map((l: string) => `lens ${l}`), ...(s.tags || []).map((t: string) => `tag ${t}`), ...(s.global ? ["global"] : [])].join(", ") || "—";
  return (
    <article className="memory">
      <div className="m-head">
        <span className={`pill ${g.mode}`}>{g.mode}</span>
        <h2>{g.statement}</h2>
        <span className="spacer" />
        <button className="small ghost danger" onClick={() => confirm("Remove guardrail?") && onRemove(g.id)}>
          delete
        </button>
      </div>
      <div className="m-meta">
        <span>
          id <code>{g.id}</code>
        </span>
        <span>origin {g.origin || "—"}</span>
        <span>status {g.status || "active"}</span>
      </div>
      <div className="m-scope">
        {g.reason && (
          <div>
            <b>reason</b> {g.reason}
          </div>
        )}
        <div>
          <b>scope</b> {scope(g.scope || {})}
        </div>
        {g.exceptions?.length > 0 && (
          <div>
            <b>exceptions</b> {g.exceptions.join("; ")} <span className="muted">(apply in: {scope(g.exception_scope || {})})</span>
          </div>
        )}
        {g.memory?.length > 0 && (
          <div>
            <b>explained by</b> {g.memory.join(", ")}
          </div>
        )}
      </div>
      {g.checks?.length > 0 && (
        <>
          <h3>Active checks (enforced by afwe verify)</h3>
          <ul className="list">
            {g.checks.map((c: any, i: number) => (
              <li key={i} className="mono">
                <b>{c.type}</b> {c.run || c.pattern || c.path || ""} {c.to_nodes?.length ? `→ ${c.to_nodes.join(", ")}` : ""} {c.files?.length ? `[${c.files.join(", ")}]` : ""} {c.when ? `(when ${c.when})` : ""}
                {c.message && <div className="muted">{c.message}</div>}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="hint">Guardrails are orthogonal to the tree: they attach to nodes, relations, groups, lenses or file regions — never to individual files by accident.</p>
    </article>
  );
}

function MemoryModal({ entry, onClose, onSave }: { entry?: any; onClose: () => void; onSave: (p: any) => void }) {
  const { graph } = useStore();
  const [kind, setKind] = useState(entry?.kind || "decision");
  const [title, setTitle] = useState(entry?.title || "");
  const [body, setBody] = useState(entry?.body || "## Decision\n\n\n## Reason\n\n\n## Trade-off\n\n");
  const [applies, setApplies] = useState<string[]>(entry?.applies_to || []);
  const [files, setFiles] = useState((entry?.files || []).join("\n"));
  const [tags, setTags] = useState((entry?.tags || []).join(", "));
  const [status, setStatus] = useState(entry?.status || "accepted");
  return (
    <Modal title={entry ? `Edit ${entry.id}` : "Add memory"} onClose={onClose} wide>
      <div className="two">
        <div>
          {!entry && (
            <Field label="Kind">
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {KINDS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Title">
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Applies to nodes (scope)">
            <select multiple value={applies} onChange={(e) => setApplies(Array.from(e.target.selectedOptions).map((o) => o.value))}>
              {graph?.nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.path}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Files / globs (one per line)">
            <textarea rows={3} value={files} onChange={(e) => setFiles(e.target.value)} />
          </Field>
          <Field label="Tags (comma separated)">
            <input value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {["accepted", "proposed", "superseded", "open", "resolved"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Body (markdown — the actual knowledge)">
          <textarea rows={18} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
      </div>
      <div className="actions">
        <button className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button disabled={!title.trim()} onClick={() => onSave({ kind, title, body, applies_to: applies, files: files.split("\n").map((s: string) => s.trim()).filter(Boolean), tags: tags.split(",").map((s: string) => s.trim()).filter(Boolean), status })}>
          Save
        </button>
      </div>
    </Modal>
  );
}

function GuardrailModal({ onClose, onSave }: { onClose: () => void; onSave: (g: any) => void }) {
  const { graph } = useStore();
  const [mode, setMode] = useState<"passive" | "active">("passive");
  const [statement, setStatement] = useState("");
  const [reason, setReason] = useState("");
  const [nodes, setNodes] = useState<string[]>([]);
  const [files, setFiles] = useState("");
  const [global, setGlobal] = useState(false);
  const [exceptions, setExceptions] = useState("");
  const [exNodes, setExNodes] = useState<string[]>([]);
  const [checkType, setCheckType] = useState("forbid_pattern");
  const [pattern, setPattern] = useState("");
  const [command, setCommand] = useState("");
  const [toNodes, setToNodes] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const opts = graph?.nodes.map((n) => (
    <option key={n.id} value={n.id}>
      {n.path}
    </option>
  ));
  return (
    <Modal title="Add guardrail" onClose={onClose} wide>
      <div className="two">
        <div>
          <Field label="Mode">
            <select value={mode} onChange={(e) => setMode(e.target.value as any)}>
              <option value="passive">passive — inserted as micro-context</option>
              <option value="active">active — check that fails verify</option>
            </select>
          </Field>
          <Field label="Statement">
            <input autoFocus value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="Do not use WebSockets in Dashboard widgets" />
          </Field>
          <Field label="Reason">
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Field label="Scope: nodes">
            <select multiple value={nodes} onChange={(e) => setNodes(Array.from(e.target.selectedOptions).map((o) => o.value))}>
              {opts}
            </select>
          </Field>
          <Field label="Scope: file globs (one per line)">
            <textarea rows={2} value={files} onChange={(e) => setFiles(e.target.value)} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={global} onChange={(e) => setGlobal(e.target.checked)} /> whole project
          </label>
        </div>
        <div>
          <Field label="Exceptions (one per line)">
            <textarea rows={2} value={exceptions} onChange={(e) => setExceptions(e.target.value)} placeholder="Realtime widgets may use WebSockets" />
          </Field>
          <Field label="Exception scope: nodes">
            <select multiple value={exNodes} onChange={(e) => setExNodes(Array.from(e.target.selectedOptions).map((o) => o.value))}>
              {opts}
            </select>
          </Field>
          {mode === "active" && (
            <>
              <Field label="Check type">
                <select value={checkType} onChange={(e) => setCheckType(e.target.value)}>
                  {["forbid_pattern", "require_pattern", "forbid_import", "command", "require_file"].map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </Field>
              {(checkType === "forbid_pattern" || checkType === "require_pattern") && (
                <Field label="Regex pattern">
                  <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="new WebSocket\\(" />
                </Field>
              )}
              {checkType === "command" && (
                <Field label="Command (non-zero exit = violation; {files} is substituted)">
                  <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npm test -- --findRelatedTests {files}" />
                </Field>
              )}
              {checkType === "require_file" && (
                <Field label="Required path">
                  <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="src/payments/README.md" />
                </Field>
              )}
              {checkType === "forbid_import" && (
                <Field label="Forbidden target nodes">
                  <select multiple value={toNodes} onChange={(e) => setToNodes(Array.from(e.target.selectedOptions).map((o) => o.value))}>
                    {opts}
                  </select>
                </Field>
              )}
              <Field label="Message shown to the agent">
                <input value={message} onChange={(e) => setMessage(e.target.value)} />
              </Field>
            </>
          )}
        </div>
      </div>
      <div className="actions">
        <button className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          disabled={!statement.trim() || (mode === "active" && !(pattern || command || toNodes.length))}
          onClick={() => {
            const check: any = { type: checkType, message: message || null };
            if (checkType === "command") check.run = command;
            else if (checkType === "require_file") check.path = pattern;
            else if (checkType === "forbid_import") check.to_nodes = toNodes;
            else check.pattern = pattern;
            onSave({
              id: "",
              mode,
              statement,
              reason: reason || null,
              scope: { nodes, files: files.split("\n").map((s) => s.trim()).filter(Boolean), global },
              exceptions: exceptions.split("\n").map((s) => s.trim()).filter(Boolean),
              exception_scope: { nodes: exNodes },
              checks: mode === "active" ? [check] : [],
            });
          }}
        >
          Save guardrail
        </button>
      </div>
    </Modal>
  );
}
