import { useStore } from "../store";
import { api } from "../api";

/** Bottom bar lives outside the ReactFlowProvider, so zoom-to-fit is dispatched via a custom event. */
export function BottomBar() {
  const { graph, expandAll, collapseAll, showImpl, setShowImpl, run, notify } = useStore();
  if (!graph) return null;
  const violations = graph.code_edges.filter((e) => e.violation).length;
  const undeclared = graph.code_edges.filter((e) => !e.declared && !e.violation).length;
  return (
    <footer className="bottombar">
      <div className="group">
        <button className="ghost" onClick={() => window.dispatchEvent(new CustomEvent("afwe:fit"))}>
          ⤢ Zoom to fit
        </button>
        <button className="ghost" onClick={expandAll}>
          ⊞ Expand
        </button>
        <button className="ghost" onClick={collapseAll}>
          ⊟ Collapse
        </button>
        <button className={showImpl ? "ghost on" : "ghost"} onClick={() => setShowImpl(!showImpl)}>
          ⌗ Show Implementation
        </button>
      </div>
      <div className="stats">
        <span>{graph.nodes.length} nodes</span>
        <span>{graph.files.length} files</span>
        <span>{graph.unmapped.length > 0 ? <span className="warn">{graph.unmapped.length} unmapped</span> : "all files mapped"}</span>
        <span>{graph.relations.length} declared relations</span>
        {undeclared > 0 && <span className="warn">{undeclared} undeclared code edges</span>}
        {violations > 0 && <span className="bad">{violations} constraint violations</span>}
      </div>
      <div className="group">
        <button
          className="ghost"
          onClick={async () => {
            const r: any = await run("Verifying", () => api.verify([]), false);
            if (r) notify(r.ok ? `✓ verify ok (${r.warnings} warnings)` : `✗ verify failed: ${r.errors} errors, ${r.warnings} warnings — see Board`);
          }}
        >
          ✓ Verify
        </button>
        <button
          onClick={async () => {
            const r: any = await run("Syncing", () => api.sync());
            if (r) notify(`Synced — applied ${r.applied.length}, proposed ${r.proposed.length}`);
          }}
        >
          ↻ Sync
        </button>
      </div>
    </footer>
  );
}
