import { useEffect } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { useStore } from "./store";
import { TopBar } from "./components/TopBar";
import { TreePanel } from "./components/TreePanel";
import { GraphView } from "./components/GraphView";
import { ContextPanel } from "./components/ContextPanel";
import { BottomBar } from "./components/BottomBar";
import { DriftDrawer } from "./components/DriftDrawer";
import { WorkflowView } from "./components/WorkflowView";
import { BoardView } from "./components/BoardView";
import { MemoryView } from "./components/MemoryView";
import { SearchPalette } from "./components/SearchPalette";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { TimelineView } from "./components/TimelineView";
import { PinsView } from "./components/PinsView";
import { OnboardingModal } from "./components/OnboardingModal";
import { call } from "./api";

export default function App() {
  const { graph, error, loading, view, refresh, drawer, setDrawer, toast, busy, onboardOpen, setOnboardOpen, setConfigured } = useStore();

  useEffect(() => {
    refresh();
    call("onboard.detect", {})
      .then((d: any) => {
        setConfigured(!!d.configured);
        if (!d.configured && !sessionStorage.getItem("afwe.onboard.later")) setOnboardOpen(true);
      })
      .catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setDrawer(useStore.getState().drawer === "search" ? null : "search");
      }
      if (e.key === "Escape") setDrawer(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (error && !graph) {
    return (
      <div className="empty">
        <h1>AFWE Studio</h1>
        <p className="err">{error}</p>
        <p>
          Run <code>afwe init</code> in your project, then <code>afwe studio</code> (web) or open the folder from the desktop app.
        </p>
        <button onClick={refresh}>Retry</button>
      </div>
    );
  }
  if (!graph) return <div className="empty">{loading ? "Loading…" : "No project loaded"}</div>;

  return (
    <div className="app">
      <TopBar />
      {view === "blueprint" && (
        <div className="main three">
          <ErrorBoundary name="Architecture tree">
            <TreePanel />
          </ErrorBoundary>
          <ReactFlowProvider>
            <ErrorBoundary name="Architecture graph">
              <GraphView />
            </ErrorBoundary>
          </ReactFlowProvider>
          <ErrorBoundary name="Context panel">
            <ContextPanel />
          </ErrorBoundary>
        </div>
      )}
      {view === "workflows" && (
        <ReactFlowProvider>
          <ErrorBoundary name="Workflows">
            <WorkflowView />
          </ErrorBoundary>
        </ReactFlowProvider>
      )}
      {view === "board" && (
        <ErrorBoundary name="Board">
          <BoardView />
        </ErrorBoundary>
      )}
      {view === "timeline" && <TimelineView />}
      {view === "pins" && <PinsView />}
      {onboardOpen && <OnboardingModal />}
      {view === "memory" && (
        <ErrorBoundary name="Memory">
          <MemoryView />
        </ErrorBoundary>
      )}
      {view === "blueprint" && <BottomBar />}
      {drawer === "drift" && (
        <ErrorBoundary name="Drift drawer">
          <DriftDrawer />
        </ErrorBoundary>
      )}
      {drawer === "search" && <SearchPalette />}
      {toast && <div className="toast">{toast}</div>}
      {busy && <div className="busy">{busy}…</div>}
    </div>
  );
}
