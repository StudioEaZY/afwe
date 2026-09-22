import { create } from "zustand";
import { api, Graph, GraphNode } from "./api";

export type View = "blueprint" | "workflows" | "board" | "memory";

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

  refresh: () => Promise<void>;
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
  select: (id) => set({ selected: id, selectedFile: null }),
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
