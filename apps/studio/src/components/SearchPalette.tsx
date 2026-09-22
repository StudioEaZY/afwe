import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { api } from "../api";

const ICON: Record<string, string> = { node: "▢", memory: "✎", guardrail: "⛨", workflow: "⤷", file: "⌗", symbol: "ƒ" };

export function SearchPalette() {
  const { setDrawer, select, selectFile, setView, graph } = useStore();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<any[]>([]);
  const [i, setI] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  useEffect(() => {
    if (!q.trim()) return setHits([]);
    const t = setTimeout(() => api.search(q).then((r) => { setHits(r.hits.slice(0, 40)); setI(0); }).catch(() => {}), 120);
    return () => clearTimeout(t);
  }, [q]);

  const go = (h: any) => {
    setDrawer(null);
    switch (h.type) {
      case "node":
        setView("blueprint");
        select(h.id);
        break;
      case "file": {
        setView("blueprint");
        const node = graph?.files.find((f) => f.path === h.id)?.node;
        if (node) select(node);
        selectFile(h.id);
        break;
      }
      case "symbol": {
        setView("blueprint");
        const file = h.id.split("::")[0];
        const node = graph?.files.find((f) => f.path === file)?.node;
        if (node) select(node);
        selectFile(file);
        break;
      }
      case "memory":
      case "guardrail":
        setView("memory");
        break;
      case "workflow":
        setView("workflows");
        break;
    }
  };

  return (
    <div className="overlay" onMouseDown={() => setDrawer(null)}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={ref}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search nodes, memory, guardrails, workflows, files, symbols…"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setI((x) => Math.min(x + 1, hits.length - 1));
            if (e.key === "ArrowUp") setI((x) => Math.max(x - 1, 0));
            if (e.key === "Enter" && hits[i]) go(hits[i]);
          }}
        />
        <div className="hits">
          {hits.map((h, k) => (
            <div key={h.type + h.id} className={`hit ${k === i ? "sel" : ""}`} onMouseEnter={() => setI(k)} onClick={() => go(h)}>
              <span className="icon">{ICON[h.type] || "•"}</span>
              <span className="type">{h.type}</span>
              <span className="title">{h.title}</span>
              {h.detail && <span className="muted">{String(h.detail).slice(0, 80)}</span>}
            </div>
          ))}
          {q && hits.length === 0 && <div className="empty-sm">no matches</div>}
        </div>
      </div>
    </div>
  );
}
