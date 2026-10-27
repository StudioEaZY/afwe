// apps/studio/src/components/BlueprintModals.tsx
import React, { useState } from "react";
import { X } from "lucide-react";
import { useStore } from "../store";
import { api } from "../api";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.4)",
        backdropFilter: "blur(2px)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "12px",
          width: "560px",
          maxWidth: "95vw",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 18px 36px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg)" }}>
          <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: "var(--ink)" }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--mute)", cursor: "pointer", padding: "4px" }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ padding: "20px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: "14px" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "5px", fontSize: "12px", fontWeight: 500, color: "var(--ink)" }}>
      <span style={{ color: "var(--mute)", fontSize: "11.5px", fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  );
}

export function EditNodeModal({ node, onClose, onSave }: { node: any; onClose: () => void; onSave: (patch: any) => void }) {
  const [name, setName] = useState(node.name || node.id);
  const [purpose, setPurpose] = useState(node.purpose || "");
  const [description, setDescription] = useState(node.description || "");
  const [kind, setKind] = useState(node.kind || "module");
  const [status, setStatus] = useState(node.status || "active");

  return (
    <Modal title={`Edit ${node.path || node.id}`} onClose={onClose}>
      <Field label="Name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: "5px", border: "1px solid var(--line)", background: "var(--bg)", color: "var(--ink)", fontSize: "12.5px" }}
        />
      </Field>
      <Field label="Kind">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: "5px", border: "1px solid var(--line)", background: "var(--bg)", color: "var(--ink)", fontSize: "12.5px" }}
        >
          {["product", "subsystem", "module", "component", "service", "library", "boundary", "data", "ui"].map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </Field>
      <Field label="Why does it exist? (purpose)">
        <textarea
          rows={3}
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: "5px", border: "1px solid var(--line)", background: "var(--bg)", color: "var(--ink)", fontSize: "12.5px", fontFamily: "inherit" }}
        />
      </Field>
      <Field label="Description">
        <textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: "5px", border: "1px solid var(--line)", background: "var(--bg)", color: "var(--ink)", fontSize: "12.5px", fontFamily: "inherit" }}
        />
      </Field>
      <Field label="Status">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: "5px", border: "1px solid var(--line)", background: "var(--bg)", color: "var(--ink)", fontSize: "12.5px" }}
        >
          <option value="active">active</option>
          <option value="planned">planned (forward-looking direction)</option>
          <option value="deprecated">deprecated</option>
        </select>
      </Field>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "10px" }}>
        <button
          onClick={onClose}
          style={{ padding: "6px 14px", borderRadius: "5px", border: "1px solid var(--line)", background: "var(--side)", color: "var(--ink)", fontSize: "12px", cursor: "pointer" }}
        >
          Cancel
        </button>
        <button
          onClick={() => onSave({ name, purpose, description, kind, status })}
          style={{ padding: "6px 16px", borderRadius: "5px", border: "none", background: "var(--accent)", color: "var(--accent-ink)", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
        >
          Save Changes
        </button>
      </div>
    </Modal>
  );
}

export function MappingModal({ node, onClose, onSave }: { node: any; onClose: () => void; onSave: (files: string[], symbols: string[]) => void }) {
  const initialFiles = Array.isArray(node.implements?.files)
    ? node.implements.files.join("\n")
    : Array.isArray(node.files)
    ? node.files.join("\n")
    : "";
  const initialSymbols = Array.isArray(node.implements?.symbols)
    ? node.implements.symbols.join("\n")
    : Array.isArray(node.symbols)
    ? node.symbols.join("\n")
    : "";

  const [files, setFiles] = useState(initialFiles);
  const [symbols, setSymbols] = useState(initialSymbols);

  return (
    <Modal title={`Implementation Mapping — ${node.path || node.id}`} onClose={onClose}>
      <p style={{ margin: 0, fontSize: "11.5px", color: "var(--mute)", lineHeight: "1.4" }}>
        Identity is path + symbol + structure, never line numbers. Globs are allowed (e.g. <code>src/auth/**</code>). Symbols use <code>file::Symbol</code>.
      </p>
      <Field label="Files / globs (one per line)">
        <textarea
          rows={5}
          value={files}
          onChange={(e) => setFiles(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: "5px", border: "1px solid var(--line)", background: "var(--bg)", color: "var(--ink)", fontSize: "12px", fontFamily: "'IBM Plex Mono', monospace" }}
        />
      </Field>
      <Field label="Symbols (one per line)">
        <textarea
          rows={3}
          value={symbols}
          onChange={(e) => setSymbols(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: "5px", border: "1px solid var(--line)", background: "var(--bg)", color: "var(--ink)", fontSize: "12px", fontFamily: "'IBM Plex Mono', monospace" }}
        />
      </Field>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "10px" }}>
        <button
          onClick={onClose}
          style={{ padding: "6px 14px", borderRadius: "5px", border: "1px solid var(--line)", background: "var(--side)", color: "var(--ink)", fontSize: "12px", cursor: "pointer" }}
        >
          Cancel
        </button>
        <button
          onClick={() => {
            const fList = files.split("\n").map((s: string) => s.trim()).filter(Boolean);
            const sList = symbols.split("\n").map((s: string) => s.trim()).filter(Boolean);
            onSave(fList, sList);
          }}
          style={{ padding: "6px 16px", borderRadius: "5px", border: "none", background: "var(--accent)", color: "var(--accent-ink)", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
        >
          Save Mapping
        </button>
      </div>
    </Modal>
  );
}

export function ConstraintModal({ from, onClose }: { from: string; onClose: () => void }) {
  const { graph, run, notify } = useStore();
  const [rule, setRule] = useState<"must_not_depend" | "may_depend_only">("must_not_depend");
  const [src, setSrc] = useState(from);
  const [targets, setTargets] = useState<string[]>([]);
  const [except, setExcept] = useState<string[]>([]);
  const [rationale, setRationale] = useState("");
  const [severity, setSeverity] = useState("error");

  const nodes = graph?.nodes || [];
  const srcName = nodes.find((n) => n.id === src)?.name || src;

  return (
    <Modal title="Add Boundary Constraint" onClose={onClose}>
      <p style={{ margin: 0, fontSize: "11.5px", color: "var(--mute)", lineHeight: "1.4" }}>
        Example: <code>services/jobs</code> must not depend on <code>ui/dashboard</code>. Constraints are enforced by <code>afwe verify</code> and turn commit gates.
      </p>
      <Field label="Subject Node">
        <select
          value={src}
          onChange={(e) => setSrc(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: "5px", border: "1px solid var(--line)", background: "var(--bg)", color: "var(--ink)", fontSize: "12px" }}
        >
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>{n.path || n.name || n.id}</option>
          ))}
        </select>
      </Field>
      <Field label="Rule">
        <select
          value={rule}
          onChange={(e) => setRule(e.target.value as any)}
          style={{ padding: "7px 10px", borderRadius: "5px", border: "1px solid var(--line)", background: "var(--bg)", color: "var(--ink)", fontSize: "12px" }}
        >
          <option value="must_not_depend">must not depend on…</option>
          <option value="may_depend_only">may depend only on…</option>
        </select>
      </Field>
      <Field label={rule === "must_not_depend" ? "Forbidden Targets (multi-select)" : "Allowed Targets"}>
        <select
          multiple
          value={rule === "must_not_depend" ? targets : except}
          onChange={(e) => {
            const vals = Array.from(e.target.selectedOptions).map((o) => o.value);
            if (rule === "must_not_depend") setTargets(vals);
            else setExcept(vals);
          }}
          style={{ height: "100px", padding: "6px", borderRadius: "5px", border: "1px solid var(--line)", background: "var(--bg)", color: "var(--ink)", fontSize: "12px" }}
        >
          {nodes.filter((n) => n.id !== src).map((n) => (
            <option key={n.id} value={n.id}>{n.path || n.name || n.id}</option>
          ))}
        </select>
      </Field>
      <Field label="Rationale (becomes agent context & harness prompt)">
        <textarea
          rows={2}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="Why does this boundary constraint exist?"
          style={{ padding: "7px 10px", borderRadius: "5px", border: "1px solid var(--line)", background: "var(--bg)", color: "var(--ink)", fontSize: "12px", fontFamily: "inherit" }}
        />
      </Field>
      <Field label="Severity">
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: "5px", border: "1px solid var(--line)", background: "var(--bg)", color: "var(--ink)", fontSize: "12px" }}
        >
          <option value="error">error (blocks commit)</option>
          <option value="warn">warn (advisory warning)</option>
        </select>
      </Field>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "10px" }}>
        <button
          onClick={onClose}
          style={{ padding: "6px 14px", borderRadius: "5px", border: "1px solid var(--line)", background: "var(--side)", color: "var(--ink)", fontSize: "12px", cursor: "pointer" }}
        >
          Cancel
        </button>
        <button
          disabled={rule === "must_not_depend" ? targets.length === 0 : except.length === 0}
          onClick={async () => {
            await run("Adding constraint", async () => {
              await api.bp.constrain({
                from: src,
                rule,
                to: rule === "must_not_depend" ? targets : [],
                except,
                rationale: rationale || null,
                severity,
              });
              notify(`Added boundary constraint on ${srcName}`);
            });
            onClose();
          }}
          style={{
            padding: "6px 16px",
            borderRadius: "5px",
            border: "none",
            background: "var(--accent)",
            color: "var(--accent-ink)",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
            opacity: (rule === "must_not_depend" ? targets.length === 0 : except.length === 0) ? 0.5 : 1,
          }}
        >
          Add Constraint
        </button>
      </div>
    </Modal>
  );
}
