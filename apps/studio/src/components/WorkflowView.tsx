import { useCallback, useEffect, useMemo, useState } from "react";
import { ReactFlow, Background, Controls, Handle, Position, MarkerType, Node, Edge, NodeProps, useNodesState, useEdgesState, useReactFlow, BackgroundVariant, addEdge, Connection } from "@xyflow/react";
import { useStore } from "../store";
import { api } from "../api";
import { Modal, Field } from "./Modal";

const KINDS = ["intent", "prompt", "design", "step", "component", "decision", "question", "output", "note"];
const EDGE_KINDS = ["then", "refines", "depends", "produces", "answers"];

function WfNodeView({ data, selected }: NodeProps) {
  const n = (data as any).n;
  return (
    <div className={`wfnode k-${n.kind} ${selected ? "sel" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <div className="wf-kind">
        {n.kind}
        {n.origin && <span className={`origin ${String(n.origin).startsWith("llm") ? "llm" : "human"}`}>{n.origin}</span>}
      </div>
      <div className="wf-title">{n.title}</div>
      {n.text && <div className="wf-text">{n.text.length > 160 ? n.text.slice(0, 160) + "…" : n.text}</div>}
      {n.maps_to && (n.maps_to.nodes?.length || n.maps_to.files?.length) ? <div className="wf-map">↳ {[...(n.maps_to.nodes || []), ...(n.maps_to.files || [])].join(", ")}</div> : null}
      {n.status && <div className="wf-status">{n.status}</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { wf: WfNodeView };

export function WorkflowView() {
  const { graph, run, notify, refresh } = useStore();
  const [list, setList] = useState<any[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [wf, setWf] = useState<any>(null);
  const [dirty, setDirty] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const rf = useReactFlow();

  const loadList = useCallback(async () => {
    const l = await api.workflow.list();
    setList(l);
    if (!current && l.length) setCurrent(l[0].id);
  }, [current]);
  useEffect(() => {
    loadList();
  }, []);

  useEffect(() => {
    if (!current) return;
    api.workflow.get(current).then((w) => {
      setWf(w);
      setDirty(false);
      setSel(null);
    });
  }, [current]);

  // model → flow
  useEffect(() => {
    if (!wf) return;
    const auto = wf.nodes.every((n: any) => !n.position || (n.position.x === 0 && n.position.y === 0));
    setNodes(
      wf.nodes.map((n: any, i: number) => ({
        id: n.id,
        type: "wf",
        position: auto ? { x: (i % 4) * 300, y: Math.floor(i / 4) * 200 } : { x: n.position.x, y: n.position.y },
        data: { n },
        style: { width: 260 },
      }))
    );
    setEdges(
      wf.edges.map((e: any, i: number) => ({
        id: `e${i}:${e.from}->${e.to}`,
        source: e.from,
        target: e.to,
        label: e.label || (e.kind !== "then" ? e.kind : undefined),
        className: `wfe-${e.kind}`,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: { kind: e.kind },
      }))
    );
    setTimeout(() => rf.fitView({ padding: 0.2 }), 20);
  }, [wf]);

  const collect = () => {
    if (!wf) return null;
    const pos = new Map(nodes.map((n) => [n.id, n.position]));
    return {
      ...wf,
      nodes: wf.nodes.map((n: any) => ({ ...n, position: pos.get(n.id) || n.position })),
      edges: edges.map((e) => ({ from: e.source, to: e.target, kind: (e.data as any)?.kind || "then", label: typeof e.label === "string" && !EDGE_KINDS.includes(e.label) ? e.label : undefined })),
    };
  };

  const save = async (extra?: any) => {
    const w = collect();
    if (!w) return;
    const merged = { ...w, ...(extra || {}) };
    const r: any = await run("Saving workflow", () => api.workflow.upsert(merged), false);
    if (r) {
      setWf(r);
      setDirty(false);
      notify("Workflow saved");
      loadList();
      refresh();
    }
  };

  const onConnect = useCallback(
    (c: Connection) => {
      const kind = prompt("Edge kind: then | refines | depends | produces | answers", "then") || "then";
      setEdges((es) => addEdge({ ...c, id: `e${Date.now()}`, label: kind !== "then" ? kind : undefined, className: `wfe-${kind}`, markerEnd: { type: MarkerType.ArrowClosed }, data: { kind } }, es));
      setDirty(true);
    },
    []
  );

  const selNode = useMemo(() => wf?.nodes.find((n: any) => n.id === sel), [wf, sel]);

  const patchNode = (patch: any) => {
    setWf((w: any) => ({ ...w, nodes: w.nodes.map((n: any) => (n.id === sel ? { ...n, ...patch } : n)) }));
    setDirty(true);
  };
  const removeNode = () => {
    if (!sel) return;
    setWf((w: any) => ({ ...w, nodes: w.nodes.filter((n: any) => n.id !== sel), edges: w.edges.filter((e: any) => e.from !== sel && e.to !== sel) }));
    setEdges((es) => es.filter((e) => e.source !== sel && e.target !== sel));
    setSel(null);
    setDirty(true);
  };

  return (
    <div className="main three wf-view">
      <aside className="panel left">
        <div className="panel-head">
          <span>Workflows</span>
          <button className="small" onClick={() => setCreating(true)}>
            + new
          </button>
        </div>
        <div className="tree">
          {list.map((w) => (
            <div key={w.id} className={`row ${current === w.id ? "sel" : ""}`} onClick={() => setCurrent(w.id)}>
              <span className="icon">⤷</span>
              <span className="name">{w.title}</span>
              <span className="pill">{w.status}</span>
            </div>
          ))}
          {list.length === 0 && <div className="empty-sm">No workflows yet. A workflow is the desired structure/behaviour, frozen in time, with provenance (who asked, what the prompt was).</div>}
        </div>
        <div className="panel-foot hint">Nodes: intent → design → steps → components. Connect nodes to express order (then), refinement, dependency or what a step produces.</div>
      </aside>

      <section className="canvas">
        {wf ? (
          <>
            <div className="wf-toolbar">
              <b>{wf.title}</b>
              <select value={wf.status} onChange={(e) => { setWf({ ...wf, status: e.target.value }); setDirty(true); }}>
                {["draft", "in_progress", "implemented", "archived"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <span className={`origin ${String(wf.origin || "").startsWith("llm") ? "llm" : "human"}`}>origin: {wf.origin || "?"}</span>
              {wf.targets?.length > 0 && <span className="muted">targets: {wf.targets.join(", ")}</span>}
              <span className="spacer" />
              <button className="ghost small" onClick={() => setAdding(true)}>
                + node
              </button>
              <button className="ghost small" onClick={() => setPromoting(true)} title="Turn component nodes into planned blueprint nodes">
                promote → blueprint
              </button>
              <button className="ghost small danger" onClick={async () => { if (confirm(`Delete workflow "${wf.title}"?`)) { await run("Deleting workflow", () => api.workflow.remove(wf.id), false); setWf(null); setCurrent(null); loadList(); refresh(); } }}>
                delete
              </button>
              <button className={dirty ? "" : "ghost"} disabled={!dirty} onClick={() => save()}>
                save
              </button>
            </div>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={(c) => { onNodesChange(c); if (c.some((x) => x.type === "position" && (x as any).dragging === false)) setDirty(true); }}
              onEdgesChange={(c) => { onEdgesChange(c); if (c.some((x) => x.type === "remove")) setDirty(true); }}
              onConnect={onConnect}
              onNodeClick={(_, n) => setSel(n.id)}
              onPaneClick={() => setSel(null)}
              fitView
              minZoom={0.1}
              proOptions={{ hideAttribution: true }}
              deleteKeyCode={["Backspace", "Delete"]}
            >
              <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#2a2f3a" />
              <Controls showInteractive={false} />
            </ReactFlow>
          </>
        ) : (
          <div className="empty-sm center">Select or create a workflow.</div>
        )}
      </section>

      <aside className="panel right">
        {selNode ? (
          <div className="ctx pad">
            <div className="panel-head">
              <span>Node</span>
              <button className="ghost small danger" onClick={removeNode}>
                remove
              </button>
            </div>
            <Field label="Kind">
              <select value={selNode.kind} onChange={(e) => patchNode({ kind: e.target.value })}>
                {KINDS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </Field>
            <Field label="Title">
              <input value={selNode.title} onChange={(e) => patchNode({ title: e.target.value })} />
            </Field>
            <Field label="Text">
              <textarea rows={8} value={selNode.text || ""} onChange={(e) => patchNode({ text: e.target.value || null })} />
            </Field>
            <Field label="Status">
              <input value={selNode.status || ""} placeholder="planned / done / captured / open…" onChange={(e) => patchNode({ status: e.target.value || null })} />
            </Field>
            <Field label="Maps to blueprint nodes">
              <select multiple value={selNode.maps_to?.nodes || []} onChange={(e) => patchNode({ maps_to: { ...(selNode.maps_to || {}), nodes: Array.from(e.target.selectedOptions).map((o) => o.value) } })}>
                {graph?.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.path}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Maps to files (one per line)">
              <textarea rows={3} value={(selNode.maps_to?.files || []).join("\n")} onChange={(e) => patchNode({ maps_to: { ...(selNode.maps_to || {}), files: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) } })} />
            </Field>
            <div className="kv">
              <span>origin</span>
              <span>{selNode.origin || "—"}</span>
              <span>created</span>
              <span>{(selNode.created || "").slice(0, 16).replace("T", " ") || "—"}</span>
            </div>
          </div>
        ) : wf ? (
          <div className="ctx pad">
            <div className="panel-head">
              <span>Workflow</span>
            </div>
            <Field label="Title">
              <input value={wf.title} onChange={(e) => { setWf({ ...wf, title: e.target.value }); setDirty(true); }} />
            </Field>
            <Field label="Description">
              <textarea rows={4} value={wf.description || ""} onChange={(e) => { setWf({ ...wf, description: e.target.value || null }); setDirty(true); }} />
            </Field>
            <Field label="Targets (blueprint nodes)">
              <select multiple value={wf.targets || []} onChange={(e) => { setWf({ ...wf, targets: Array.from(e.target.selectedOptions).map((o) => o.value) }); setDirty(true); }}>
                {graph?.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.path}
                  </option>
                ))}
              </select>
            </Field>
            <div className="kv">
              <span>id</span>
              <span className="mono">{wf.id}</span>
              <span>nodes</span>
              <span>{wf.nodes.length}</span>
              <span>edges</span>
              <span>{edges.length}</span>
              <span>updated</span>
              <span>{(wf.updated || "").slice(0, 16).replace("T", " ")}</span>
              {wf.task && (
                <>
                  <span>task</span>
                  <span className="mono">{wf.task}</span>
                </>
              )}
            </div>
            <p className="hint">Provenance: the original prompt is kept in a <i>prompt</i> node (policy <code>provenance.retain_prompts</code>). The persisted thing is structured knowledge, not the conversation.</p>
          </div>
        ) : null}
      </aside>

      {creating && (
        <NewWorkflowModal
          onClose={() => setCreating(false)}
          onDone={(id) => {
            setCreating(false);
            loadList().then(() => setCurrent(id));
          }}
        />
      )}
      {adding && wf && (
        <AddWfNodeModal
          onClose={() => setAdding(false)}
          onAdd={(n) => {
            const id = `${n.kind}-${wf.nodes.length + 1}-${Math.random().toString(36).slice(2, 6)}`;
            const last = nodes[nodes.length - 1];
            const node = { ...n, id, position: last ? { x: last.position.x + 300, y: last.position.y } : { x: 0, y: 0 }, origin: "human" };
            setWf({ ...wf, nodes: [...wf.nodes, node], edges: sel ? [...wf.edges, { from: sel, to: id, kind: "then" }] : wf.edges });
            setDirty(true);
            setAdding(false);
            setSel(id);
          }}
        />
      )}
      {promoting && wf && (
        <PromoteModal
          wf={wf}
          onClose={() => setPromoting(false)}
          onDone={() => {
            setPromoting(false);
            api.workflow.get(wf.id).then(setWf);
          }}
        />
      )}
    </div>
  );
}

function NewWorkflowModal({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const { graph, run } = useStore();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [promptText, setPromptText] = useState("");
  const [targets, setTargets] = useState<string[]>([]);
  return (
    <Modal title="New workflow" onClose={onClose}>
      <Field label="Title">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add tagging to the workspace" />
      </Field>
      <Field label="Description / intent">
        <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Original prompt (kept as provenance)">
        <textarea rows={3} value={promptText} onChange={(e) => setPromptText(e.target.value)} placeholder="Paste what was asked, verbatim…" />
      </Field>
      <Field label="Targets (blueprint nodes)">
        <select multiple value={targets} onChange={(e) => setTargets(Array.from(e.target.selectedOptions).map((o) => o.value))}>
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
            const r: any = await run("Creating workflow", () => api.workflow.new({ title, description: description || null, prompt: promptText || null, targets }));
            if (r) onDone(r.id);
          }}
        >
          Create
        </button>
      </div>
    </Modal>
  );
}

function AddWfNodeModal({ onClose, onAdd }: { onClose: () => void; onAdd: (n: any) => void }) {
  const [kind, setKind] = useState("step");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  return (
    <Modal title="Add workflow node" onClose={onClose}>
      <Field label="Kind">
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </Field>
      <Field label="Title">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Text">
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <div className="actions">
        <button className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button disabled={!title.trim()} onClick={() => onAdd({ kind, title, text: text || null, status: null })}>
          Add
        </button>
      </div>
    </Modal>
  );
}

function PromoteModal({ wf, onClose, onDone }: { wf: any; onClose: () => void; onDone: () => void }) {
  const { graph, run, notify } = useStore();
  const [parent, setParent] = useState(wf.targets?.[0] || graph?.nodes[0]?.id || "");
  const comps = wf.nodes.filter((n: any) => n.kind === "component");
  return (
    <Modal title="Promote workflow → blueprint" onClose={onClose}>
      <p className="hint">
        Creates <b>planned</b> blueprint nodes for each <i>component</i> node ({comps.length}) under the chosen parent and links them back (maps_to). The code is not touched; implementation follows the architecture contract.
      </p>
      <ul className="list">
        {comps.map((c: any) => (
          <li key={c.id}>{c.title}</li>
        ))}
        {comps.length === 0 && <li className="muted">No component nodes in this workflow.</li>}
      </ul>
      <Field label="Parent node">
        <select value={parent} onChange={(e) => setParent(e.target.value)}>
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
          disabled={comps.length === 0}
          onClick={async () => {
            const r: any = await run("Promoting", () => api.workflow.promote(wf.id, parent));
            if (r) {
              notify(`Created ${Array.isArray(r) ? r.length : 0} planned nodes`);
              onDone();
            }
          }}
        >
          Promote
        </button>
      </div>
    </Modal>
  );
}
