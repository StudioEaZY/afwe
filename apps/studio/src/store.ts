import { create } from "zustand";
import { api, Graph, GraphNode } from "./api";
import {
  getStudioPrefs,
  setStartView as persistStartView,
  addBookmark as persistBookmark,
  removeBookmark as persistRemoveBookmark,
  setPalettes as persistPalettes,
  setGraceSeconds as persistGraceSeconds,
  StudioPrefs,
  StudioBookmark,
  MapLens,
} from "./lib/prefs";
import { SelectedEntity } from "./lib/hierarchy";

export type View =
  | "overview"
  | "timeline"
  | "blueprint"
  | "checks"
  | "decisions"
  | "settings"
  | "workflows"
  | "memory"
  | "pins";

export type FilterMode =
  | "all"
  | "mapped"
  | "inferred"
  | "unmapped"
  | "uncharted"
  | "legacy"
  | "proposals"
  | "issues";

export type ConstellationScope = "node" | "map" | "two";

export interface UndoAction {
  id: string;
  label: string;
  timestamp: number;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

export interface QuarantineAction {
  id: string;
  label: string;
  description: string;
  secondsLeft: number;
  totalSeconds: number;
  isCascading: boolean;
  execute: () => Promise<void>;
  cancel: () => void;
}

export interface CodePreviewTarget {
  filePath: string;
  line?: number;
  symbol?: string;
  pattern?: string;
  title?: string;
}

export interface ConsequenceModalData {
  title: string;
  statement: string;
  impact: string[];
  isCascading: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

interface State {
  graph: Graph | null;
  loading: boolean;
  error: string | null;
  view: View;
  selected: string | null;
  selectedFile: string | null;
  expanded: Set<string>;
  showImpl: boolean;
  lens: string | null;
  drawer: null | "drift" | "search" | "history";
  toast: string | null;
  busy: string | null;
  onboardOpen: boolean;
  configured: boolean | null;

  // ── v2 Architecture Map & Navigation (Radial, Constellation, Topology) ──
  activeLens: MapLens;
  currentScopeId: string | null; // null = root project in Radial
  currentDepth: number;
  constellationAnchorKey: string | null; // e.g. "Backend/events/models"
  constellationScope: ConstellationScope;
  forceParentFallback: boolean;
  overviewTimelineT: number; // 0..1 continuous rewind playhead on Overview
  selectedEntity: SelectedEntity | null;
  filterMode: FilterMode;
  prefs: StudioPrefs;

  // ── v4: Scene Graph & 4D Timeline ──
  scene: import("./api").SceneData | null;
  activeTurn: string | null;
  compareFromTurn: string | null;
  timelineFrames: import("./api").TimelineFrame[];
  dotQuery: string;
  selectedDotPath: string | null;

  // ── Two-Tier Undo & Quarantine Grace System ──
  undoStack: UndoAction[];
  redoStack: UndoAction[];
  pendingQuarantine: QuarantineAction | null;
  quarantineIntervalId: any | null;
  consequenceModal: ConsequenceModalData | null;
  codePreviewTarget: CodePreviewTarget | null;

  refresh: () => Promise<void>;
  refreshScene: () => Promise<void>;
  scrubToTurn: (turn: string | null, toTurn?: string) => Promise<void>;
  setDotQuery: (q: string) => void;
  selectDotPath: (dot: string | null) => void;
  setOnboardOpen: (b: boolean) => void;
  setConfigured: (b: boolean) => void;
  setView: (v: View) => void;
  select: (id: string | null) => void;
  selectFile: (path: string | null) => void;
  toggle: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  setShowImpl: (b: boolean) => void;
  setLens: (id: string | null) => void;
  setDrawer: (d: State["drawer"]) => void;
  notify: (msg: string | null) => void;
  run: <T>(label: string, fn: () => Promise<T>, refresh?: boolean) => Promise<T | undefined>;

  // ── Map actions ──
  setActiveLens: (lens: MapLens) => void;
  setConstellationAnchor: (nodeKey: string) => void;
  openConstellationFor: (nodeKey: string) => void;
  setConstellationScope: (scope: ConstellationScope) => void;
  setForceParentFallback: (b: boolean) => void;
  setOverviewTimelineT: (t: number) => void;
  drillDown: (nodeId: string) => void;
  drillUp: () => void;
  setScope: (nodeId: string | null) => void;
  selectEntity: (entity: SelectedEntity | null) => void;
  setFilterMode: (m: FilterMode) => void;
  pinStartView: (nodeId: string | null, lens: MapLens) => void;
  addBookmark: (b: StudioBookmark) => void;
  removeBookmark: (id: string) => void;
  setRadialPalette: (p: string) => void;
  setTopologyPalette: (p: string) => void;
  setGraceSeconds: (s: number) => void;

  // ── Deep Links ──
  jumpToNodeOnMap: (nodeId: string) => void;
  jumpToTurn: (turnId: string) => void;
  openCodePreview: (target: CodePreviewTarget) => void;
  closeCodePreview: () => void;

  // ── Two-Tier Quarantine & Undo/Redo Actions ──
  openConsequenceModal: (opts: ConsequenceModalData) => void;
  closeConsequenceModal: () => void;
  scheduleQuarantineAction: (opts: {
    id: string;
    label: string;
    description: string;
    isCascading: boolean;
    execute: () => Promise<void>;
    undo?: () => Promise<void>;
  }) => void;
  cancelQuarantineAction: () => void;
  executeQuarantineActionNow: () => Promise<void>;
  pushUndo: (action: UndoAction) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

const initialPrefs = getStudioPrefs();

export const useStore = create<State>((set, get) => ({
  graph: null,
  loading: false,
  error: null,
  view: "overview",
  selected: null,
  selectedFile: null,
  expanded: new Set(),
  showImpl: false,
  lens: null,
  drawer: null,
  toast: null,
  busy: null,
  onboardOpen: false,
  configured: null,
  scene: null,
  activeTurn: null,
  compareFromTurn: null,
  timelineFrames: [],
  dotQuery: "",
  selectedDotPath: null,

  // Map state
  activeLens: initialPrefs.defaultLens || "radial",
  currentScopeId: initialPrefs.defaultStartNodeId || null,
  currentDepth: initialPrefs.defaultStartNodeId ? initialPrefs.defaultStartNodeId.split("/").length : 0,
  constellationAnchorKey: "Backend/events/models",
  constellationScope: "map",
  forceParentFallback: false,
  overviewTimelineT: 1,
  selectedEntity: null,
  filterMode: "all",
  prefs: initialPrefs,

  // Two-Tier Undo & Quarantine Grace System
  undoStack: [],
  redoStack: [],
  pendingQuarantine: null,
  quarantineIntervalId: null,
  consequenceModal: null,
  codePreviewTarget: null,

  refreshScene: async () => {
    try {
      const [scene, res] = await Promise.all([api.scene.get(), api.timeline4d.frames()]);
      set({ scene, timelineFrames: res.frames || [] });
    } catch (e: any) {
      console.warn("Could not load scene or frames:", e);
    }
  },

  scrubToTurn: async (turn: string | null, toTurn?: string) => {
    if (!turn) {
      set({ activeTurn: null, compareFromTurn: null });
      await get().refreshScene();
      return;
    }
    try {
      const scene = await api.timeline4d.snapshot(turn, toTurn);
      set({ scene, activeTurn: turn, compareFromTurn: toTurn || null });
    } catch (e: any) {
      get().notify(`Failed to scrub to ${turn}: ${e.message || e}`);
    }
  },

  setDotQuery: (dotQuery: string) => set({ dotQuery }),
  selectDotPath: (selectedDotPath: string | null) => {
    const s = get().scene;
    let selId = get().selected;
    if (s && selectedDotPath) {
      const match = s.nodes.find((n) => n.dot_path === selectedDotPath);
      if (match) selId = match.id;
    }
    set({ selectedDotPath, selected: selId });
  },

  setOnboardOpen: (onboardOpen: boolean) => set({ onboardOpen }),
  setConfigured: (configured: boolean) => set({ configured }),

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const graph = await api.graph();
      const prevSelected = get().selected;
      const next = new Set<string>();
      if (graph.nodes) {
        graph.nodes.filter((n) => n.depth <= 1).forEach((n) => next.add(n.id));
      }
      set({
        graph,
        loading: false,
        expanded: next,
        selected:
          prevSelected && graph.nodes.some((n) => n.id === prevSelected)
            ? prevSelected
            : graph.nodes[0]?.id ?? null,
      });
    } catch (e: any) {
      set({ loading: false, error: e.message || String(e) });
    }
  },

  setView: (view) => {
    let mapped: View = view;
    if (view === "workflows") mapped = "overview";
    else if (view === "memory") mapped = "decisions";
    else if (view === "pins") mapped = "checks";
    set({ view: mapped });
  },

  select: (id) => {
    const s = get().scene;
    let dot: string | null = null;
    if (s && id) {
      const match = s.nodes.find((n) => n.id === id || n.dot_path.endsWith(id));
      if (match) dot = match.dot_path;
    }
    set({ selected: id, selectedFile: null, selectedDotPath: dot ?? get().selectedDotPath });
  },

  selectFile: (path) => set({ selectedFile: path }),

  toggle: (id) => {
    const s = new Set(get().expanded);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    set({ expanded: s });
  },

  expandAll: () => {
    const g = get().graph;
    if (!g) return;
    set({ expanded: new Set(g.nodes.map((n) => n.id)) });
  },

  collapseAll: () => {
    const g = get().graph;
    if (!g) return;
    set({ expanded: new Set(g.nodes.filter((n) => n.depth === 0).map((n) => n.id)) });
  },

  setShowImpl: (showImpl) => set({ showImpl }),
  setLens: (lens) => set({ lens }),
  setDrawer: (drawer) => set({ drawer }),

  notify: (toast) => {
    set({ toast });
    if (toast) setTimeout(() => set((s) => (s.toast === toast ? { toast: null } : {})), 4000);
  },

  run: async (label, fn, refresh = true) => {
    set({ busy: label });
    try {
      const r = await fn();
      if (refresh) await get().refresh();
      return r;
    } catch (e: any) {
      get().notify(`Error: ${e.message || e}`);
      return undefined;
    } finally {
      set({ busy: null });
    }
  },

  // Map actions
  setActiveLens: (lens) => {
    if (lens === "constellation") {
      const curSel = get().selectedEntity;
      const curScope = get().currentScopeId;
      let anchor = get().constellationAnchorKey || "Backend/events/models";
      if (curSel && curSel.kind !== "edge" && curSel.id !== "root") {
        anchor = curSel.key || curSel.id;
      } else if (curScope && curScope !== "root") {
        anchor = curScope;
      }
      set({ activeLens: lens, constellationAnchorKey: anchor, forceParentFallback: false });
      return;
    }
    set({ activeLens: lens });
  },

  setConstellationAnchor: (nodeKey: string) => {
    set({ constellationAnchorKey: nodeKey, forceParentFallback: false });
  },

  openConstellationFor: (nodeKey: string) => {
    set({
      view: "overview",
      activeLens: "constellation",
      constellationAnchorKey: nodeKey,
      forceParentFallback: false,
    });
  },

  setConstellationScope: (constellationScope: ConstellationScope) => set({ constellationScope }),
  setForceParentFallback: (forceParentFallback: boolean) => set({ forceParentFallback }),
  setOverviewTimelineT: (overviewTimelineT: number) => set({ overviewTimelineT }),

  drillDown: (nodeId: string) => {
    const clean = nodeId === "root" ? null : nodeId;
    const nextDepth = clean ? clean.split("/").length : 0;
    set({
      currentScopeId: clean,
      currentDepth: nextDepth,
      activeLens: "radial",
      constellationAnchorKey: clean || get().constellationAnchorKey,
    });
  },

  drillUp: () => {
    const cur = get().currentScopeId;
    if (!cur) return;
    const parts = cur.split("/");
    if (parts.length <= 1) {
      set({ currentScopeId: null, currentDepth: 0 });
    } else {
      const parentKey = parts.slice(0, -1).join("/");
      set({ currentScopeId: parentKey, currentDepth: parts.length - 1 });
    }
  },

  setScope: (nodeId) => {
    const clean = !nodeId || nodeId === "root" ? null : nodeId;
    set({
      currentScopeId: clean,
      currentDepth: clean ? clean.split("/").length : 0,
    });
  },

  selectEntity: (selectedEntity) => {
    set({ selectedEntity });
    if (selectedEntity) {
      set({ selected: selectedEntity.id });
    }
  },

  setFilterMode: (filterMode) => set({ filterMode }),

  pinStartView: (nodeId, lens) => {
    const updated = persistStartView(nodeId, lens);
    set({ prefs: updated });
    get().notify(nodeId ? `Pinned ${nodeId} as start view` : "Pinned project root as start view");
  },

  addBookmark: (b) => {
    const updated = persistBookmark(b);
    set({ prefs: updated });
    get().notify(`Bookmarked ${b.label}`);
  },

  removeBookmark: (id) => {
    const updated = persistRemoveBookmark(id);
    set({ prefs: updated });
  },

  setRadialPalette: (radialPalette: string) => {
    const cur = get().prefs;
    const updated = persistPalettes(radialPalette, cur.topologyPalette);
    set({ prefs: updated });
    get().notify(`Radial palette set to ${radialPalette}`);
  },

  setTopologyPalette: (topologyPalette: string) => {
    const cur = get().prefs;
    const updated = persistPalettes(cur.radialPalette, topologyPalette);
    set({ prefs: updated });
    get().notify(`Topology palette set to ${topologyPalette}`);
  },

  setGraceSeconds: (graceSeconds: number) => {
    const updated = persistGraceSeconds(graceSeconds);
    set({ prefs: updated });
    get().notify(`Quarantine grace timer set to ${graceSeconds}s`);
  },

  // ── Deep Links ──
  jumpToNodeOnMap: (nodeId: string) => {
    const graph = get().graph;
    let parentId: string | null = null;
    let nodeLabel = nodeId;
    if (graph) {
      const match = graph.nodes.find((n) => n.id === nodeId);
      if (match) {
        parentId = match.parent || null;
        nodeLabel = match.name || match.id;
      }
    }
    set({
      view: "overview",
      currentScopeId: parentId,
      currentDepth: parentId ? parentId.split("/").length : 0,
      selected: nodeId,
      selectedEntity: {
        id: nodeId,
        key: nodeId,
        kind: "feature",
        label: nodeLabel,
        path: nodeId.toLowerCase(),
        status: "mapped",
        state: "mapped",
        fileCount: 1,
        mappedCount: 1,
      },
    });
    get().notify(`Jumped to ${nodeLabel} on map`);
  },

  jumpToTurn: (turnId: string) => {
    set({ view: "timeline", activeTurn: turnId });
    get().scrubToTurn(turnId);
    get().notify(`Inspecting Turn #${turnId}`);
  },

  openCodePreview: (target: CodePreviewTarget) => {
    set({ codePreviewTarget: target });
  },

  closeCodePreview: () => {
    set({ codePreviewTarget: null });
  },

  // ── Two-Tier Quarantine & Undo/Redo Actions ──
  openConsequenceModal: (opts) => set({ consequenceModal: opts }),
  closeConsequenceModal: () => set({ consequenceModal: null }),

  scheduleQuarantineAction: (opts) => {
    const prev = get().pendingQuarantine;
    if (prev) {
      if (get().quarantineIntervalId) clearInterval(get().quarantineIntervalId);
    }

    const totalSeconds = get().prefs.graceSeconds || 10;
    let secondsRemaining = totalSeconds;

    const action: QuarantineAction = {
      id: opts.id,
      label: opts.label,
      description: opts.description,
      secondsLeft: secondsRemaining,
      totalSeconds,
      isCascading: opts.isCascading,
      execute: async () => {
        if (get().quarantineIntervalId) clearInterval(get().quarantineIntervalId);
        set({ pendingQuarantine: null, quarantineIntervalId: null });
        await opts.execute();
        if (opts.undo) {
          get().pushUndo({
            id: opts.id,
            label: opts.label,
            timestamp: Date.now(),
            undo: opts.undo,
            redo: opts.execute,
          });
        }
      },
      cancel: () => {
        if (get().quarantineIntervalId) clearInterval(get().quarantineIntervalId);
        set({ pendingQuarantine: null, quarantineIntervalId: null });
        get().notify(`Cancelled: ${opts.label}`);
      },
    };

    const interval = setInterval(() => {
      secondsRemaining -= 1;
      if (secondsRemaining <= 0) {
        clearInterval(interval);
        action.execute();
      } else {
        const cur = get().pendingQuarantine;
        if (cur && cur.id === opts.id) {
          set({
            pendingQuarantine: {
              ...cur,
              secondsLeft: secondsRemaining,
            },
          });
        }
      }
    }, 1000);

    set({ pendingQuarantine: action, quarantineIntervalId: interval });
  },

  cancelQuarantineAction: () => {
    const cur = get().pendingQuarantine;
    if (cur) cur.cancel();
  },

  executeQuarantineActionNow: async () => {
    const cur = get().pendingQuarantine;
    if (cur) await cur.execute();
  },

  pushUndo: (action: UndoAction) => {
    const stack = [action, ...get().undoStack].slice(0, 30);
    set({ undoStack: stack, redoStack: [] });
  },

  undo: async () => {
    const stack = [...get().undoStack];
    if (stack.length === 0) {
      get().notify("Nothing to undo.");
      return;
    }
    const item = stack.shift()!;
    try {
      await item.undo();
      const redo = [item, ...get().redoStack];
      set({ undoStack: stack, redoStack: redo });
      get().notify(`Undone: ${item.label}`);
      await get().refresh();
    } catch (e: any) {
      get().notify(`Undo failed: ${e.message || e}`);
    }
  },

  redo: async () => {
    const stack = [...get().redoStack];
    if (stack.length === 0) {
      get().notify("Nothing to redo.");
      return;
    }
    const item = stack.shift()!;
    try {
      await item.redo();
      const undo = [item, ...get().undoStack];
      set({ undoStack: undo, redoStack: stack });
      get().notify(`Redone: ${item.label}`);
      await get().refresh();
    } catch (e: any) {
      get().notify(`Redo failed: ${e.message || e}`);
    }
  },
}));

export const nodeById = (g: Graph | null, id: string | null | undefined): GraphNode | undefined =>
  g && id ? g.nodes.find((n) => n.id === id) : undefined;

export const ancestors = (g: Graph, id: string): string[] => {
  const out: string[] = [];
  let cur = nodeById(g, id)?.parent;
  while (cur) {
    out.push(cur);
    cur = nodeById(g, cur)?.parent ?? null;
  }
  return out;
};

export const kindIcon = (kind: string) => kind;
