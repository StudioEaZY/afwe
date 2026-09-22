import { useEffect, useState } from "react";
import { useStore, nodeById, kindIcon } from "../store";
import { api } from "../api";
import { Modal, Field } from "./Modal";

function Section({ title, hint, children, count }: { title: string; hint?: string; children: any; count?: number }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="sec">
      <div className="sec-head" onClick={() => setOpen(!open)}>
        <span className={`chev ${open ? "open" : ""}`}>▸</span>
        <span>{title}</span>
        {count !== undefined && <span className="cnt">{count}</span>}
        {hint && <span className="hint">{hint}</span>}
      </div>
      {open && <div className="sec-body">{children}</div>}
    </div>
  );
}

export function ContextPanel() {
  const { graph, selected, selectedFile, select, run, notify, setView } = useStore();
  const [detail, setDetail] = useState<any>(null);
  const [ctx, setCtx] = useState<any>(null);
  const [tab, setTab] = useState<"human" | "llm">("human");
  const [editing, setEditing] = useState(false);
  const [constraining, setConstraining] = useState(false);
  const [mapping, setMapping] = useState(false);
  const [fileInfo, setFileInfo] = useState<any>(null);

  useEffect(() => {
    if (!selected) return;
    setDetail(null);
    setCtx(null);
    api.node(selected).then(setDetail).catch((e) => notify(`✗ ${e.message}`));
  }, [selected, graph]);

  useEffect(() => {
    if (!selected) return;
    if (tab !== "llm" && !selectedFile) return;
    const q = selectedFile ? { files: [selectedFile] } : { node: selected };
    api.context(q).then(setCtx).catch(() => {});
  }, [selected, selectedFile, tab, graph]);

  useEffect(() => {
    setFileInfo(selectedFile ? graph?.files.find((f) => f.path === selectedFile) ?? null : null);
  }, [selectedFile, graph]);

  const node = nodeById(graph, selected);
  if (!graph || !node) return <aside className="panel right" />;
  const parent = nodeById(graph, node.parent);

  const link = (id: string, label?: string) => (
    <a key={id} className="ref" onClick={() => select(id)}>
      {label || graph.nodes.find((n) => n.id === id)?.path || id}
    </a>
  );

  return (
    <aside className="panel right">
      <div className="panel-head">
        <span className="crumbs">
          {parent && (
            <>
              {link(parent.id, parent.name)}
              <span className="sep">/</span>
            </>
          )}
          <b>
            {kindIcon(node.kind)} {node.name}
          </b>
        </span>
        <span className="tabs small">
          <button className={tab === "human" ? "tab active" : "tab"} onClick={() => setTab("human")}>
            Context
          </button>
          <button className={tab === "llm" ? "tab active" : "tab"} onClick={() => setTab("llm")} title="Exactly what an agent receives from afwe_context">
            Agent view
          </button>
        </span>
      </div>

      {selectedFile && (
        <div className="filebox">
          <div className="fb-head">
            <span className="mono">{selectedFile}</span>
            <button className="ghost small" onClick={() => useStore.getState().selectFile(null)}>
              ✕
            </button>
          </div>
          {fileInfo && (
            <div className="fb-meta">
              <span>{fileInfo.language}</span>
              <span>{fileInfo.symbols} symbols</span>
              <span>{fileInfo.imports.length} imports</span>
              {!fileInfo.node && <span className="warn">unmapped</span>}
            </div>
          )}
          {ctx && ctx.memory?.length > 0 && (
            <div className="fb-mem">
              <div className="muted">Knowledge that applies to this file (passive guardrail):</div>
              {ctx.memory.map((m: any) => (
                <div key={m.id} className="mem-line">
                  <span className={`kind ${m.kind}`}>{m.kind}</span> {m.title}
                  <span className="muted"> — {m.why.join("; ")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "llm" ? (
        <div className="llm">
          <p className="hint">This is the micro-context AFWE inserts for an agent working on this {selectedFile ? "file" : "node"} — only what applies, nothing else.</p>
          {ctx ? <pre className="md">{ctx.markdown}</pre> : <div className="muted">loading…</div>}
        </div>
      ) : (
        <div className="ctx">
          <Section title="What is this">
            <div className="kv">
              <span>kind</span>
              <span>{node.kind}</span>
              <span>path</span>
              <span className="mono">{node.path}</span>
              <span>status</span>
              <span>{node.status || "active"}</span>
              {node.origin && (
                <>
                  <span>origin</span>
                  <span>{node.origin}</span>
                </>
              )}
              {node.tags.length > 0 && (
                <>
                  <span>tags</span>
                  <span>{node.tags.join(", ")}</span>
                </>
              )}
            </div>
            {node.description && <p>{node.description}</p>}
          </Section>

          <Section title="Why does it exist">
            {node.purpose ? <p className="purpose">{node.purpose}</p> : <p className="muted">No purpose recorded. Agents will not know why this node exists.</p>}
            <button className="small ghost" onClick={() => setEditing(true)}>
              edit
            </button>
          </Section>

          <Section title="What contains it / what it contains" count={node.children.length}>
            <div className="chain">
              {parent ? (
                <>
                  contained by {link(parent.id)}
                </>
              ) : (
                <span className="muted">root node</span>
              )}
            </div>
            <ul className="list">
              {node.children.map((c) => {
                const ch = nodeById(graph, c)!;
                return (
                  <li key={c}>
                    {kindIcon(ch.kind)} {link(c, ch.name)} <span className="muted">{ch.files} files</span>
                  </li>
                );
              })}
            </ul>
          </Section>

          <Section title="What depends on it / what it depends on" count={(detail?.relations?.out?.length ?? 0) + (detail?.relations?.in?.length ?? 0)}>
            {detail ? (
              <>
                <div className="sub">depends on</div>
                <ul className="list">
                  {detail.relations.out.map((r: any, i: number) => (
                    <li key={i}>
                      → {link(graph.nodes.find((n) => n.path === r.to_path)?.id || r.to, r.to_path)} <span className={`pill ${r.status}`}>{r.status}</span>
                      {r.rationale && <div className="muted">{r.rationale}</div>}
                    </li>
                  ))}
                  {detail.code_edges.out
                    .filter((e: any) => !detail.relations.out.some((r: any) => r.to_path === e.to_path))
                    .map((e: any, i: number) => {
                      const viol = graph.code_edges.find((ce) => ce.from === node.id && ce.to === e.to)?.violation;
                      return (
                        <li key={"u" + i} className={viol ? "violation" : "undeclared"}>
                          → {link(e.to, e.to_path)} <span className={`pill ${viol ? "error" : "undeclared"}`}>{viol ? `violates ${viol}` : `code only · ${e.count}`}</span>
                          {!viol && (
                            <button className="small ghost" onClick={() => run("Declaring", () => api.bp.relate(node.id, e.to, "depends_on", "declared from Studio"))}>
                              declare
                            </button>
                          )}
                        </li>
                      );
                    })}
                </ul>
                <div className="sub">depended on by</div>
                <ul className="list">
                  {detail.relations.in.map((r: any, i: number) => (
                    <li key={i}>
                      ← {link(graph.nodes.find((n) => n.path === r.from_path)?.id || r.from, r.from_path)} <span className={`pill ${r.status}`}>{r.status}</span>
                    </li>
                  ))}
                  {detail.code_edges.in
                    .filter((e: any) => !detail.relations.in.some((r: any) => r.from_path === e.from_path))
                    .map((e: any, i: number) => (
                      <li key={"u" + i} className="undeclared">
                        ← {link(e.from, e.from_path)} <span className="pill undeclared">code only · {e.count}</span>
                      </li>
                    ))}
                </ul>
              </>
            ) : (
              <div className="muted">loading…</div>
            )}
          </Section>

          <Section title="What implements it" count={node.files}>
            <div className="sub">
              mapping rules{" "}
              <button className="small ghost" onClick={() => setMapping(true)}>
                edit
              </button>
            </div>
            <ul className="list mono">
              {(node.implements.files || []).map((f) => (
                <li key={f}>{f}</li>
              ))}
              {(node.implements.symbols || []).map((s) => (
                <li key={s}>{s}</li>
              ))}
              {!(node.implements.files?.length || node.implements.symbols?.length) && <li className="muted">{node.children.length ? "no direct mapping — implemented through its children" : "no mapping — node is not implemented yet (planned?)"}</li>}
            </ul>
            <div className="sub">files ({node.files})</div>
            <ul className="list mono files">
              {node.file_list.slice(0, 40).map((f) => (
                <li key={f} className={selectedFile === f ? "sel" : ""} onClick={() => useStore.getState().selectFile(f)}>
                  {f}
                </li>
              ))}
              {node.file_list.length > 40 && <li className="muted">+{node.file_list.length - 40} more</li>}
            </ul>
            {detail?.symbols?.length > 0 && (
              <>
                <div className="sub">symbols ({detail.symbols.length})</div>
                <ul className="list mono syms">
                  {detail.symbols.slice(0, 60).map((s: any) => (
                    <li key={s.id} title={s.file}>
                      <span className="muted">{s.kind}</span> {s.qualified}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Section>

          <Section title="What constraints apply" count={detail?.constraints?.length}>
            <ul className="list">
              {detail?.constraints?.map((raw: any) => {
                const c = { ...raw, to: raw.to || [], except: raw.except || [] };
                return (
                <li key={c.id}>
                  <b>{c.id}</b> <span className="pill">{c.severity}</span>
                  <div>
                    {c.rule === "must_not_depend" ? (
                      <>
                        <span className="mono">{c.from}</span> must not depend on <span className="mono">{c.to.join(", ")}</span>
                      </>
                    ) : (
                      <>
                        <span className="mono">{c.from}</span> may depend only on <span className="mono">{c.except.join(", ") || "(nothing)"}</span>
                      </>
                    )}
                    {c.rule === "must_not_depend" && c.except.length > 0 && <span className="muted"> except {c.except.join(", ")}</span>}
                  </div>
                  {c.rationale && <div className="muted">{c.rationale}</div>}
                  <button className="small ghost danger" onClick={() => confirm(`Remove constraint ${c.id}?`) && run("Removing constraint", () => api.bp.unconstrain(c.id))}>
                    remove
                  </button>
                </li>
                );
              })}
            </ul>
            <button className="small ghost" onClick={() => setConstraining(true)}>
              + constraint
            </button>
          </Section>

          <Section title="What decisions apply" count={(detail?.memory?.length ?? 0) + (detail?.inherited_memory?.length ?? 0)}>
            <ul className="list">
              {detail?.memory?.map((m: any) => (
                <li key={m.id} onClick={() => setView("memory")}>
                  <span className={`kind ${m.kind}`}>{m.kind}</span> {m.title} {m.status && <span className="pill">{m.status}</span>}
                </li>
              ))}
              {detail?.inherited_memory?.map((m: any) => (
                <li key={"i" + m.id} className="inherited" onClick={() => setView("memory")}>
                  <span className={`kind ${m.kind}`}>{m.kind}</span> {m.title} <span className="muted">via {m.from}</span>
                </li>
              ))}
              {detail && !detail.memory.length && !detail.inherited_memory.length && <li className="muted">no decisions recorded for this node</li>}
            </ul>
          </Section>

          <Section title="Guardrails" count={detail?.guardrails?.length}>
            <ul className="list">
              {detail?.guardrails?.map((g: any) => (
                <li key={g.id}>
                  <span className={`pill ${g.mode}`}>{g.mode}</span> {g.statement}
                  {g.exceptions?.length > 0 && <div className="muted">exceptions: {g.exceptions.join("; ")}</div>}
                </li>
              ))}
            </ul>
          </Section>

          {detail?.workflows?.length > 0 && (
            <Section title="Workflows" count={detail.workflows.length}>
              <ul className="list">
                {detail.workflows.map((w: any) => (
                  <li key={w.id} onClick={() => setView("workflows")}>
                    ⤷ {w.title} <span className="pill">{w.status}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <div className="danger-zone">
            <button
              className="small ghost danger"
              onClick={async () => {
                if (confirm(`Remove node "${node.path}" from the blueprint? Children are re-parented; the code is not touched.`)) {
                  await run("Removing node", () => api.bp.remove(node.id));
                }
              }}
            >
              remove node
            </button>
          </div>
        </div>
      )}

      {editing && (
        <EditNodeModal
          node={node}
          onClose={() => setEditing(false)}
          onSave={async (patch) => {
            await run("Updating node", () => api.bp.update(node.id, patch));
            setEditing(false);
          }}
        />
      )}
      {constraining && <ConstraintModal from={node.id} onClose={() => setConstraining(false)} />}
      {mapping && (
        <MappingModal
          node={node}
          onClose={() => setMapping(false)}
          onSave={async (files, symbols) => {
            await run("Updating mapping", () => api.bp.update(node.id, { files, symbols }));
            setMapping(false);
          }}
        />
      )}
    </aside>
  );
}

function EditNodeModal({ node, onClose, onSave }: { node: any; onClose: () => void; onSave: (patch: any) => void }) {
  const [name, setName] = useState(node.name);
  const [purpose, setPurpose] = useState(node.purpose || "");
  const [description, setDescription] = useState(node.description || "");
  const [kind, setKind] = useState(node.kind);
  const [status, setStatus] = useState(node.status || "active");
  return (
    <Modal title={`Edit ${node.path}`} onClose={onClose}>
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Kind">
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {["product", "subsystem", "module", "component", "service", "library", "boundary", "data", "ui"].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </Field>
      <Field label="Why does it exist? (purpose)">
        <textarea rows={3} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
      </Field>
      <Field label="Description">
        <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Status">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option>active</option>
          <option>planned</option>
          <option>deprecated</option>
        </select>
      </Field>
      <div className="actions">
        <button className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button onClick={() => onSave({ name, purpose, description, kind, status })}>Save</button>
      </div>
    </Modal>
  );
}

function MappingModal({ node, onClose, onSave }: { node: any; onClose: () => void; onSave: (files: string[], symbols: string[]) => void }) {
  const [files, setFiles] = useState((node.implements.files || []).join("\n"));
  const [symbols, setSymbols] = useState((node.implements.symbols || []).join("\n"));
  return (
    <Modal title={`Implementation mapping — ${node.path}`} onClose={onClose}>
      <p className="hint">Identity is path + symbol + structure, never line numbers. Globs are allowed (src/auth/**). Symbols use file::Symbol or file::Class.method.</p>
      <Field label="Files / globs (one per line)">
        <textarea rows={6} value={files} onChange={(e) => setFiles(e.target.value)} />
      </Field>
      <Field label="Symbols (one per line)">
        <textarea rows={4} value={symbols} onChange={(e) => setSymbols(e.target.value)} />
      </Field>
      <div className="actions">
        <button className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button onClick={() => onSave(files.split("\n").map((s: string) => s.trim()).filter(Boolean), symbols.split("\n").map((s: string) => s.trim()).filter(Boolean))}>Save</button>
      </div>
    </Modal>
  );
}

export function ConstraintModal({ from, onClose }: { from: string; onClose: () => void }) {
  const { graph, run } = useStore();
  const [rule, setRule] = useState<"must_not_depend" | "may_depend_only">("must_not_depend");
  const [src, setSrc] = useState(from);
  const [targets, setTargets] = useState<string[]>([]);
  const [except, setExcept] = useState<string[]>([]);
  const [rationale, setRationale] = useState("");
  const [severity, setSeverity] = useState("error");
  const opts = graph?.nodes.map((n) => (
    <option key={n.id} value={n.id}>
      {n.path}
    </option>
  ));
  const srcName = graph?.nodes.find((n) => n.id === src)?.name;
  return (
    <Modal title="Structural constraint" onClose={onClose}>
      <p className="hint">
        Example: “Payments may depend on Identity but must not depend on UI”. Constraints are enforced by <code>afwe verify</code> and shown in agent context.
      </p>
      <Field label="Subject">
        <select value={src} onChange={(e) => setSrc(e.target.value)}>
          {opts}
        </select>
      </Field>
      <Field label="Rule">
        <select value={rule} onChange={(e) => setRule(e.target.value as any)}>
          <option value="must_not_depend">must not depend on…</option>
          <option value="may_depend_only">may depend only on…</option>
        </select>
      </Field>
      {rule === "must_not_depend" ? (
        <>
          <Field label="Forbidden targets (multi-select)">
            <select multiple value={targets} onChange={(e) => setTargets(Array.from(e.target.selectedOptions).map((o) => o.value))}>
              {opts}
            </select>
          </Field>
          <Field label="Except (allowed anyway)">
            <select multiple value={except} onChange={(e) => setExcept(Array.from(e.target.selectedOptions).map((o) => o.value))}>
              {opts}
            </select>
          </Field>
        </>
      ) : (
        <Field label="Allowed targets (everything else is forbidden)">
          <select multiple value={except} onChange={(e) => setExcept(Array.from(e.target.selectedOptions).map((o) => o.value))}>
            {opts}
          </select>
        </Field>
      )}
      <Field label="Rationale (becomes agent context)">
        <textarea rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} />
      </Field>
      <Field label="Severity">
        <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option>error</option>
          <option>warn</option>
        </select>
      </Field>
      <div className="preview">
        {srcName} {rule === "must_not_depend" ? "must not depend on" : "may depend only on"}{" "}
        {(rule === "must_not_depend" ? targets : except).map((t) => graph?.nodes.find((n) => n.id === t)?.name).join(", ") || "…"}
        {rule === "must_not_depend" && except.length > 0 && ` (except ${except.map((t) => graph?.nodes.find((n) => n.id === t)?.name).join(", ")})`}
      </div>
      <div className="actions">
        <button className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          disabled={rule === "must_not_depend" ? targets.length === 0 : except.length === 0}
          onClick={async () => {
            await run("Adding constraint", () => api.bp.constrain({ from: src, rule, to: rule === "must_not_depend" ? targets : [], except, rationale: rationale || null, severity }));
            onClose();
          }}
        >
          Add constraint
        </button>
      </div>
    </Modal>
  );
}
