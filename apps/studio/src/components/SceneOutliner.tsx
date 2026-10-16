import { useState } from "react";
import { useStore, kindIcon } from "../store";

export function SceneOutliner({ onSwitchMode }: { onSwitchMode?: () => void }) {
  const { scene, selectedDotPath, selectDotPath, dotQuery, setDotQuery } = useStore();
  const [tab, setTab] = useState<"outliner" | "assets">("outliner");

  if (!scene) {
    return <div className="panel outliner"><div className="empty-sm">Loading Scene...</div></div>;
  }

  const nodes = scene.nodes.filter((n) => {
    if (!dotQuery) return true;
    return (
      n.dot_path.toLowerCase().includes(dotQuery.toLowerCase()) ||
      n.id.toLowerCase().includes(dotQuery.toLowerCase())
    );
  });

  return (
    <aside className="panel outliner">
      <div className="panel-head">
        <div className="tabs small">
          <button
            className={`tab ${tab === "outliner" ? "active" : ""}`}
            onClick={() => setTab("outliner")}
          >
            Scene Outliner
          </button>
          <button
            className={`tab ${tab === "assets" ? "active" : ""}`}
            onClick={() => setTab("assets")}
          >
            Asset Registry ({scene.assets.files_count})
          </button>
        </div>
        {onSwitchMode && (
          <button className="ghost small mode-switch-btn" onClick={onSwitchMode} title="Switch to Classic Tree view">
            ⇄ Tree
          </button>
        )}
      </div>

      <div className="outliner-search">
        <input
          type="text"
          placeholder="Filter dot-path (e.g. afwe.crates.*)..."
          value={dotQuery}
          onChange={(e) => setDotQuery(e.target.value)}
        />
      </div>

      {tab === "outliner" ? (
        <div className="tree outliner-tree">
          {nodes.map((n) => {
            const isSelected = selectedDotPath === n.dot_path;
            const delta = n.components.delta;
            return (
              <div
                key={n.dot_path}
                className={`row outliner-row ${isSelected ? "sel" : ""} delta-${delta.status}`}
                style={{ paddingLeft: `${8 + n.depth * 14}px` }}
                onClick={() => selectDotPath(n.dot_path)}
              >
                <span className="icon">{kindIcon(n.kind)}</span>
                <span className="name" title={n.dot_path}>
                  {n.id}
                </span>

                <div className="archetype-slots">
                  {n.components.governance.pins_count > 0 && (
                    <span className="slot-badge pin" title={`${n.components.governance.pins_count} Pin(s)`}>
                      ⛨ {n.components.governance.pins_count}
                    </span>
                  )}
                  {n.components.lease.is_locked && (
                    <span className="slot-badge lease" title={`Leased by ${n.components.lease.agent}`}>
                      🔒
                    </span>
                  )}
                  {n.components.impl.files_count > 0 && (
                    <span className="slot-badge file" title={`${n.components.impl.files_count} file(s)`}>
                      📄 {n.components.impl.files_count}
                    </span>
                  )}
                  {delta.status !== "unchanged" && (
                    <span className={`slot-badge delta ${delta.status}`}>
                      {delta.status === "added" ? "+" : delta.status === "modified" ? "Δ" : delta.status === "plannedfuture" ? "◌" : "×"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="asset-registry-view">
          <div className="asset-group">
            <div className="asset-group-title">Deduplicated Assets in Registry</div>
            <div className="asset-row">
              <span>Source Files</span>
              <b>{scene.assets.files_count}</b>
            </div>
            <div className="asset-row">
              <span>AST Symbols</span>
              <b>{scene.assets.symbols_count}</b>
            </div>
            <div className="asset-row">
              <span>Memory Decisions</span>
              <b>{scene.assets.memory_count}</b>
            </div>
            <div className="asset-row">
              <span>Active Pins</span>
              <b>{scene.assets.pins_count}</b>
            </div>
            <div className="asset-row">
              <span>Registered Checks</span>
              <b>{scene.assets.checks_count}</b>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
