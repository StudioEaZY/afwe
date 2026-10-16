import { create } from "zustand";
import { api, Graph, GraphNode } from "./api";

export type View = "blueprint" | "workflows" | "board" | "memory" | "timeline" | "pins";

interface State {
  graph: Graph | null;
  loading: boolean;
  error: string | null;
  view: View;
  selected: string | null; // blueprint node id
  selectedFile: string | null;
  expanded: Set<string>;
  showImpl: boolean;
  lens: string | null; // lens id or null = main blueprint
  drawer: null | "drift" | "search";
  toast: string | null;
  busy: string | null;
  onboardOpen: boolean;
  configured: boolean | null;

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
}

export const useStore = create<State>((set, get) => ({
  graph: null,
  loading: false,
  error: null,
  view: "blueprint",
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
    let nodeId: string | null = null;
    if (s && selectedDotPath) {
      const match = s.nodes.find((n) => n.dot_path === selectedDotPath);
      if (match) nodeId = match.id;
    }
    set({ selectedDotPath, selected: nodeId ?? get().selected, selectedFile: null });
  },
  setOnboardOpen: (b) => set({ onboardOpen: b }),
  setConfigured: (b) => set({ configured: b }),

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const graph = await api.graph();
      const { expanded, selected } = get();
      // first load: expand the root(s) and their first level
      let next = expanded;
      if (expanded.size === 0) {
        next = new Set<string>();
        graph.nodes.filter((n) => n.depth <= 1).forEach((n) => next.add(n.id));
      }
      set({ graph, loading: false, expanded: next, selected: selected && graph.nodes.some((n) => n.id === selected) ? selected : graph.nodes[0]?.id ?? null });
    } catch (e: any) {
      set({ loading: false, error: e.message || String(e) });
    }
  },
  setView: (view) => set({ view }),
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
}));

export const nodeById = (g: Graph | null, id: string | null | undefined): GraphNode | undefined => (g && id ? g.nodes.find((n) => n.id === id) : undefined);

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
  ({ product: "◆", subsystem: "▣", module: "▢", component: "◇", service: "⚙", library: "▤", boundary: "▥", data: "⛁", ui: "▭", group: "▣" } as Record<string, string>)[kind] || "▢";
