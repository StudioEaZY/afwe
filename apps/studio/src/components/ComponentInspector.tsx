import { useStore } from "../store";

export function ComponentInspector({ onSwitchMode }: { onSwitchMode?: () => void }) {
  const { scene, selectedDotPath } = useStore();

  if (!scene) {
    return <aside className="panel inspector"><div className="empty-sm">Loading Inspector...</div></aside>;
  }

  const activePath = selectedDotPath || scene.nodes[0]?.dot_path;
  const node = scene.nodes.find((n) => n.dot_path === activePath);

  if (!node) {
    return (
      <aside className="panel inspector">
        <div className="panel-head inspector-head">
          <span className="muted">Component Inspector</span>
          {onSwitchMode && (
            <button className="ghost small mode-switch-btn" onClick={onSwitchMode} title="Switch to Context & Actions">
              ⇄ Context
            </button>
          )}
        </div>
        <div className="empty-sm center">Select an entity in the Outliner or Scene Graph</div>
      </aside>
    );
  }

  const { impl, governance, verification, lease, delta } = node.components;

  return (
    <aside className="panel inspector">
      <div className="panel-head inspector-head">
        <div className="inspector-title">
          <span className="dot-prefix">DOT:</span>
          <span className="mono bold">{node.dot_path}</span>
        </div>
        {onSwitchMode && (
          <button className="ghost small mode-switch-btn" onClick={onSwitchMode} title="Switch to Context & Actions">
            ⇄ Context
          </button>
        )}
      </div>

      <div className="inspector-body">
        {/* 1. Identity Component */}
        <div className="card component-card">
          <div className="card-head">
            <span className="comp-name">Identity Component</span>
            <span className={`pill ${node.status}`}>{node.status}</span>
          </div>
          <div className="card-body kv-table">
            <div className="kv-row">
              <span className="muted">Name</span>
              <b>{node.id}</b>
            </div>
            <div className="kv-row">
              <span className="muted">Kind</span>
              <span className="kind">{node.kind}</span>
            </div>
            <div className="kv-row">
              <span className="muted">Origin</span>
              <span className="origin">{node.origin}</span>
            </div>
            {node.purpose && (
              <div className="kv-block">
                <span className="muted">Purpose:</span>
                <p className="purpose-text">{node.purpose}</p>
              </div>
            )}
          </div>
        </div>

        {/* 2. Temporal Delta Component */}
        <div className="card component-card">
          <div className="card-head">
            <span className="comp-name">4D Temporal Delta</span>
            <span className={`pill delta-${delta.status}`}>{delta.status}</span>
          </div>
          <div className="card-body">
            <div className="kv-row">
              <span className="muted">Files Changed:</span>
              <b>{delta.delta_files}</b>
            </div>
            {delta.notes && <div className="hint-note">{delta.notes}</div>}
          </div>
        </div>

        {/* 3. Governance Component */}
        <div className="card component-card">
          <div className="card-head">
            <span className="comp-name">Governance Component</span>
            <span className="count-badge">{governance.pins_count} Pins</span>
          </div>
          <div className="card-body">
            <div className="kv-row">
              <span className="muted">Constraints:</span>
              <span>{governance.constraints_count}</span>
            </div>
            <div className="kv-row">
              <span className="muted">Guardrails:</span>
              <span>{governance.guardrails_count}</span>
            </div>
            {governance.pin_ids.length > 0 && (
              <div className="sub-list">
                <span className="muted small">Active Pins:</span>
                <ul>
                  {governance.pin_ids.map((p) => (
                    <li key={p} className="pin-item">
                      ⛨ {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* 4. Implementation Component */}
        <div className="card component-card">
          <div className="card-head">
            <span className="comp-name">Implementation Component</span>
            <span className="count-badge">{impl.files_count} files</span>
          </div>
          <div className="card-body">
            <div className="kv-row">
              <span className="muted">AST Symbols:</span>
              <span>{impl.symbols_count}</span>
            </div>
            {impl.files.length > 0 && (
              <div className="sub-list">
                <span className="muted small">Realised Files:</span>
                <ul className="file-list">
                  {impl.files.map((f) => (
                    <li key={f} className="file-item mono small" title={f}>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* 5. Verification Component */}
        <div className="card component-card">
          <div className="card-head">
            <span className="comp-name">Verification Component</span>
            <span className={`pill ${verification.passed ? "ok" : "bad"}`}>
              {verification.passed ? "PASS" : "FAIL"}
            </span>
          </div>
          <div className="card-body">
            <div className="kv-row">
              <span className="muted">Confidence:</span>
              <b>{Math.round(verification.confidence * 100)}%</b>
            </div>
            <div className="kv-row">
              <span className="muted">Checks:</span>
              <span>{verification.checks_count}</span>
            </div>
          </div>
        </div>

        {/* 6. Lease Component */}
        {lease.is_locked && (
          <div className="card component-card locked">
            <div className="card-head">
              <span className="comp-name">Node Concurrency Lease</span>
              <span className="pill warn">LOCKED</span>
            </div>
            <div className="card-body">
              <div className="kv-row">
                <span className="muted">Agent:</span>
                <b>{lease.agent}</b>
              </div>
              <div className="kv-row">
                <span className="muted">Mission:</span>
                <span>{lease.mission}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
