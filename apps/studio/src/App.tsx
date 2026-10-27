// apps/studio/src/App.tsx
import { useEffect } from "react";
import { useStore } from "./store";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { OverviewPage } from "./components/OverviewPage";
import { TimelinePage } from "./components/TimelinePage";
import { BlueprintPage } from "./components/BlueprintPage";
import { ChecksPage } from "./components/ChecksPage";
import { DecisionsPage } from "./components/DecisionsPage";
import { SettingsPage } from "./components/SettingsPage";
import { DriftDrawer } from "./components/DriftDrawer";
import { SearchPalette } from "./components/SearchPalette";
import { GovernanceActionModal } from "./components/GovernanceActionModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { call } from "./api";

export default function App() {
  const {
    graph,
    error,
    loading,
    view,
    refresh,
    refreshScene,
    drawer,
    setDrawer,
    toast,
    busy,
    setOnboardOpen,
    setConfigured,
    undo,
    redo,
  } = useStore();

  useEffect(() => {
    refresh();
    refreshScene();
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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
      if (e.key === "Escape") setDrawer(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (error && !graph) {
    return (
      <div className="empty" style={{ padding: "40px", textAlign: "center", background: "var(--bg)", height: "100vh" }}>
        <h1 className="serif" style={{ fontSize: "32px", color: "var(--ink)" }}>AFWE Studio</h1>
        <p style={{ color: "var(--red)", fontSize: "14px", marginTop: "12px" }}>{error}</p>
        <p style={{ color: "var(--mute)", fontSize: "13px" }}>
          Run <code>afwe init</code> in your project, then <code>afwe studio</code> (web) or open the folder from the desktop app.
        </p>
        <button
          onClick={refresh}
          style={{
            marginTop: "16px",
            background: "var(--accent)",
            color: "var(--accent-ink)",
            border: "none",
            padding: "8px 18px",
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!graph) {
    return (
      <div className="empty" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "var(--bg)", color: "var(--mute)", fontSize: "14px" }}>
        {loading ? "Loading project data…" : "No project loaded"}
      </div>
    );
  }

  return (
    <div className="app-container" style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden", background: "var(--bg)", color: "var(--ink)" }}>
      {/* 1. Left Vertical Navigation Sidebar */}
      <Sidebar />

      {/* 2. Main Right Content Area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", minWidth: 0, overflow: "hidden" }}>
        <TopBar />

        <main style={{ flex: 1, height: "calc(100% - 56px)", overflow: "hidden", position: "relative" }}>
          {view === "overview" && (
            <ErrorBoundary name="Codebase Overview">
              <OverviewPage />
            </ErrorBoundary>
          )}

          {view === "timeline" && (
            <ErrorBoundary name="Timeline & Turns">
              <TimelinePage />
            </ErrorBoundary>
          )}

          {view === "blueprint" && (
            <ErrorBoundary name="Architectural Blueprint">
              <BlueprintPage />
            </ErrorBoundary>
          )}

          {view === "checks" && (
            <ErrorBoundary name="Checks & Pins">
              <ChecksPage />
            </ErrorBoundary>
          )}

          {view === "decisions" && (
            <ErrorBoundary name="Decisions & Queue">
              <DecisionsPage />
            </ErrorBoundary>
          )}

          {view === "settings" && (
            <ErrorBoundary name="Settings">
              <SettingsPage />
            </ErrorBoundary>
          )}
        </main>
      </div>

      {/* Drawers, Overlays & Two-Tier Quarantine Modals */}
      {drawer === "drift" && (
        <ErrorBoundary name="Drift drawer">
          <DriftDrawer />
        </ErrorBoundary>
      )}

      {drawer === "search" && <SearchPalette />}

      <GovernanceActionModal />

      {toast && (
        <div
          className="toast"
          style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            background: "#1D1C1A",
            color: "#FFFFFF",
            padding: "10px 18px",
            borderRadius: "6px",
            fontSize: "12.5px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            zIndex: 9999,
          }}
        >
          {toast}
        </div>
      )}

      {busy && (
        <div
          className="busy"
          style={{
            position: "fixed",
            top: "16px",
            right: "24px",
            background: "#2E7A57",
            color: "#FFFFFF",
            padding: "6px 14px",
            borderRadius: "6px",
            fontSize: "12px",
            fontWeight: 600,
            zIndex: 9999,
          }}
        >
          {busy}…
        </div>
      )}
    </div>
  );
}
