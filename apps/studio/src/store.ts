import { create } from "zustand";
import { api, Graph, GraphNode } from "./api";
import { getStudioPrefs, setStartView as persistStartView, addBookmark as persistBookmark, removeBookmark as persistRemoveBookmark, StudioPrefs, StudioBookmark } from "./lib/prefs";
import { SelectedEntity } from "./lib/hierarchy";

export type View =
  | "overview"
  | "timeline"
  | "checks"
  | "decisions"
  | "settings"
  | "blueprint"
  | "workflows"
  | "memory"
  | "pins";

export type FilterMode = "all" | "mapped" | "uncharted" | "proposals" | "issues";

interface State {
  graph: Graph | null;
  loading: boolean;
  error: string | null;
  view: View;
  selected: string | null; // blueprint node id
  selectedFile: string | null;
  expanded: Set<string>;
  showImpl: boolean;
  lens: string | null; // legacy lens id or null
  drawer: null | "drift" | "search";
  toast: string | null;
  busy: string | null;
  onboardOpen: boolean;
  configured: boolean | null;

  // ── v2 Architecture Map & Navigation ──
  activeLens: "radial" | "topology";
  currentScopeId: string | null; // null = root project
  currentDepth: number;
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
  setActiveLens: (lens: "radial" | "topology") => void;
  drillDown: (nodeId: string) => void;
  drillUp: () => void;
  setScope: (nodeId: string | null) => void;
  selectEntity: (entity: SelectedEntity | null) => void;
  setFilterMode: (m: FilterMode) => void;
  pinStartView: (nodeId: string | null, lens: "radial" | "topology") => void;
  addBookmark: (b: StudioBookmark) => void;
  removeBookmark: (id: string) => void;
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
  currentDepth: initialPrefs.defaultStartNodeId ? 1 : 0,
  selectedEntity: null,
  filterMode: "all",
  prefs: initialPrefs,

  refreshScene: async () => {
    try {
      const [scene, res] = await Promise.all([
        api.scene.get(),
        api.timeline4d.frames(),
      ]);
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
        selected: prevSelected && graph.nodes.some((n) => n.id === prevSelected) ? prevSelected : graph.nodes[0]?.id ?? null,
      });
    } catch (e: any) {
      set({ loading: false, error: e.message || String(e) });
    }
  },

  setView: (view) => {
    let mapped: View = view;
    if (view === "blueprint" || view === "workflows") mapped = "overview";
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
      get().notify(`✗ ${e.message || e}`);
      return undefined;
    } finally {
      set({ busy: null });
    }
  },

  // Map actions
  setActiveLens: (lens) => set({ activeLens: lens }),

  drillDown: (nodeId: string) => {
    const nextDepth = get().currentDepth + 1;
    set({ currentScopeId: nodeId, currentDepth: nextDepth });
  },

  drillUp: () => {
    const depth = get().currentDepth;
    if (depth <= 0) return;
    // Step up: find parent of currentScopeId in graph or reset to root
    const graph = get().graph;
    const cur = get().currentScopeId;
    let parentId: string | null = null;
    if (graph && cur) {
      const node = graph.nodes.find((n) => n.id === cur);
      if (node && node.parent) {
        parentId = node.parent;
      }
    }
    set({ currentScopeId: parentId, currentDepth: Math.max(0, depth - 1) });
  },

  setScope: (nodeId) => set({ currentScopeId: nodeId, currentDepth: nodeId ? 1 : 0 }),

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

export const kindIcon = (kind: string) =>
  ({
    project: "⌘",
    domain: "▣",
    feature: "▢",
    folder: "📁",
    file: "📄",
    symbol: "λ",
    boundary: "▥",
    violation: "▲",
    pin: "✦",
    question: "?",
    proposal: "✎",
    module: "▢",
    service: "⚙",
    ui: "▭",
  }[kind] || "▢");
