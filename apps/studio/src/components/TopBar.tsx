import { useState } from "react";
import { useStore, View } from "../store";
import { api, isTauri, openProjectDialog } from "../api";

const tabs: { id: View; label: string }[] = [
  { id: "blueprint", label: "Blueprint" },
  { id: "workflows", label: "Workflows" },
  { id: "board", label: "Board / Tasks" },
  { id: "memory", label: "Memory" },
  { id: "timeline", label: "Timeline" },
  { id: "pins", label: "Pins" },
];

export function TopBar() {
  const { graph, view, setView, setDrawer, run, notify, refresh, configured, setOnboardOpen } = useStore();
  const [syncing, setSyncing] = useState(false);
  if (!graph) return null;
  const sync = graph.sync.status;
  const syncLabel = sync === "in_sync" ? "in sync" : sync === "stale" ? "out of sync" : "never synced";

  const doSync = async () => {
    setSyncing(true);
    const r: any = await run("Syncing", () => api.sync());
    setSyncing(false);
    if (r) notify(`Synced ${r.files} files — applied ${r.applied.length}, proposed ${r.proposed.length}${r.uncertain.length ? `, ${r.uncertain.length} uncertain` : ""}`);
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">AFWE</span>
        <span className="project" title={graph.project.description || ""}>
          {graph.project.name}
        </span>
        {isTauri() && (
          <button
            className="ghost small"
            onClick={async () => {
              const p = await openProjectDialog();
              if (p) {
                notify(`Opened ${p}`);
                await refresh();
              }
            }}
          >
            open…
          </button>
        )}
      </div>
      <nav className="tabs">
        {tabs.map((t) => (
          <button key={t.id} className={view === t.id ? "tab active" : "tab"} onClick={() => setView(t.id)}>
            {t.label}
            {t.id === "board" && graph.board_open > 0 && <span className="badge">{graph.board_open}</span>}
          </button>
        ))}
      </nav>
      <div className="right">
        {configured === false && (
          <button className="ghost" onClick={() => setOnboardOpen(true)} title="Configure git, CI and the agent contract">
            set up
          </button>
        )}
        <button className={`sync ${sync}`} onClick={doSync} disabled={syncing} title={graph.sync.last_sync ? `last sync ${graph.sync.last_sync}` : "run afwe sync"}>
          ● {syncing ? "syncing…" : syncLabel}
        </button>
        <button className="ghost" onClick={() => setDrawer("drift")} title="Drift & proposals">
          drift{graph.proposals.length > 0 && <span className="badge warn">{graph.proposals.length}</span>}
        </button>
        <button className="ghost" onClick={() => setDrawer("search")} title="Search (⌘K)">
          search ⌘K
        </button>
      </div>
    </header>
  );
}
