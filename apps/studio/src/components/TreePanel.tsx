import { useState } from "react";
import { useStore, kindIcon } from "../store";
import { api } from "../api";
import { Modal, Field } from "./Modal";

interface TreeItem {
  id: string;
  name: string;
  kind: string;
  virtual: boolean;
  children: TreeItem[];
  workflows?: { id: string; title: string; status?: string }[];
}

export function TreePanel() {
  const { graph, selected, select, expanded, toggle, lens, setLens, run, notify } = useStore();
  const [adding, setAdding] = useState(false);
  const [newLens, setNewLens] = useState(false);
  if (!graph) return null;

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const build = (id: string): TreeItem => {
    const n = byId.get(id)!;
    return { id: n.id, name: n.name, kind: n.kind, virtual: false, children: n.children.filter((c) => byId.has(c)).map(build) };
  };
  let roots: TreeItem[];
  const lensObj = lens ? graph.lenses.find((l) => l.id === lens) : null;
  if (lensObj) {
    const conv = (g: any): TreeItem => ({ id: g.id, name: g.name, kind: g.kind, virtual: !!g.virtual, workflows: g.workflows, children: (g.children || []).map((c: any) => (c.virtual ? conv(c) : byId.has(c.id) ? build(c.id) : conv(c))) });
    roots = (lensObj.view.groups || []).map(conv);
  } else {
    roots = graph.nodes.filter((n) => !n.parent).map((n) => build(n.id));
  }

  const Row = ({ item, depth }: { item: TreeItem; depth: number }) => {
    const open = expanded.has(item.id) || item.virtual;
    const has = item.children.length > 0 || (item.workflows?.length ?? 0) > 0;
    return (
      <div>
        <div className={`row ${selected === item.id ? "sel" : ""} ${item.virtual ? "virtual" : ""}`} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => (item.virtual ? toggle(item.id) : select(item.id))} onDoubleClick={() => toggle(item.id)}>
          <span className={`chev ${has ? "" : "none"} ${open ? "open" : ""}`} onClick={(e) => { e.stopPropagation(); toggle(item.id); }}>
            ▸
          </span>
          <span className="icon">{kindIcon(item.kind)}</span>
          <span className="name">{item.name}</span>
          {!item.virtual && byId.get(item.id)?.status && byId.get(item.id)!.status !== "active" && <span className="pill">{byId.get(item.id)!.status}</span>}
        </div>
        {open && item.children.map((c) => <Row key={c.id} item={c} depth={depth + 1} />)}
        {open && item.workflows?.map((w) => (
          <div key={w.id} className="row wf" style={{ paddingLeft: 8 + (depth + 1) * 14 }} onClick={() => useStore.getState().setView("workflows")}>
            <span className="chev none">▸</span>
            <span className="icon">⤷</span>
            <span className="name">{w.title}</span>
            <span className="pill">{w.status || "workflow"}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <aside className="panel left">
      <div className="panel-head">
        <span>Architecture</span>
        <select value={lens || ""} onChange={(e) => setLens(e.target.value || null)} title="Custom abstraction (lens)">
          <option value="">Main Blueprint</option>
          {graph.lenses.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <div className="tree">
        {roots.map((r) => (
          <Row key={r.id} item={r} depth={0} />
        ))}
      </div>
      <div className="panel-foot">
        <button className="small" onClick={() => setAdding(true)}>
          + node
        </button>
        <button className="small ghost" onClick={() => setNewLens(true)}>
          + lens
        </button>
        {lensObj && (
          <button
            className="small ghost danger"
            onClick={async () => {
              if (confirm(`Remove lens "${lensObj.name}"? (the blueprint is untouched)`)) {
                await run("Removing lens", () => api.lens.remove(lensObj.id));
                setLens(null);
              }
            }}
          >
            remove lens
          </button>
        )}
      </div>
      {adding && (
        <AddNodeModal
          defaultParent={selected || graph.nodes[0]?.id}
          onClose={() => setAdding(false)}
          onDone={(id) => {
            setAdding(false);
            notify(`Added node ${id}`);
          }}
        />
      )}
      {newLens && <NewLensModal onClose={() => setNewLens(false)} />}
    </aside>
  );
}

export function AddNodeModal({ defaultParent, onClose, onDone }: { defaultParent?: string | null; onClose: () => void; onDone: (id: string) => void }) {
  const { graph, run } = useStore();
  const [name, setName] = useState("");
  const [parent, setParent] = useState(defaultParent || "");
  const [kind, setKind] = useState("module");
  const [purpose, setPurpose] = useState("");
  const [files, setFiles] = useState("");
  const [status, setStatus] = useState("active");
  return (
    <Modal title="Create node" onClose={onClose}>
      <Field label="Name">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Authentication" />
      </Field>
      <Field label="Parent">
        <select value={parent} onChange={(e) => setParent(e.target.value)}>
          <option value="">(root)</option>
          {graph?.nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.path}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Kind">
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {["subsystem", "module", "component", "service", "library", "boundary", "data", "ui", "product"].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </Field>
      <Field label="Why does it exist?">
        <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={3} />
      </Field>
      <Field label="Implemented by (files / globs, one per line)">
        <textarea value={files} onChange={(e) => setFiles(e.target.value)} rows={3} placeholder={"src/auth/**\nsrc/middleware/session.ts"} />
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
        <button
          disabled={!name.trim()}
          onClick={async () => {
            const r: any = await run("Creating node", () => api.bp.add({ name, parent: parent || null, kind, purpose: purpose || null, files: files.split("\n").map((s) => s.trim()).filter(Boolean), status }));
            if (r) onDone(r.id);
          }}
        >
          Create
        </button>
      </div>
    </Modal>
  );
}

function NewLensModal({ onClose }: { onClose: () => void }) {
  const { graph, run, setLens } = useStore();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [groups, setGroups] = useState<{ name: string; nodes: string[] }[]>([{ name: "", nodes: [] }]);
  return (
    <Modal title="New lens (custom abstraction)" onClose={onClose} wide>
      <p className="hint">A lens regroups existing blueprint nodes under your own headings. Zero impact on the codebase — it only changes how you look at it.</p>
      <Field label="Name">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Workspace Blueprint" />
      </Field>
      <Field label="Description">
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      {groups.map((g, i) => (
        <div key={i} className="group-row">
          <input placeholder="Group name (e.g. Library)" value={g.name} onChange={(e) => setGroups(groups.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <select multiple value={g.nodes} onChange={(e) => setGroups(groups.map((x, j) => (j === i ? { ...x, nodes: Array.from(e.target.selectedOptions).map((o) => o.value) } : x)))}>
            {graph?.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.path}
              </option>
            ))}
          </select>
        </div>
      ))}
      <button className="small ghost" onClick={() => setGroups([...groups, { name: "", nodes: [] }])}>
        + group
      </button>
      <div className="actions">
        <button className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          disabled={!name.trim() || groups.every((g) => !g.name.trim())}
          onClick={async () => {
            const r: any = await run("Saving lens", () => api.lens.save({ id: "", name, description, groups: groups.filter((g) => g.name.trim()) }));
            if (r) {
              setLens(r.id);
              onClose();
            }
          }}
        >
          Save lens
        </button>
      </div>
    </Modal>
  );
}
