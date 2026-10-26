// apps/studio/src/lib/prefs.ts
// Local persistence for Studio user preferences (default start view, bookmarks, lens preference, color palettes, and quarantine grace timer).

export interface StudioBookmark {
  id: string;
  label: string;
  path: string;
  lens: "radial" | "topology";
}

export interface StudioPrefs {
  defaultStartNodeId: string | null;
  defaultLens: "radial" | "topology";
  bookmarks: StudioBookmark[];
  radialPalette: string;
  topologyPalette: string;
  graceSeconds: number; // Tier 1 quarantine countdown (default 10)
}

const PREFS_STORAGE_KEY = "afwe.studio.prefs.v2.5";

const DEFAULT_PREFS: StudioPrefs = {
  defaultStartNodeId: null,
  defaultLens: "radial",
  bookmarks: [],
  radialPalette: "editorial",
  topologyPalette: "cartographic",
  graceSeconds: 10,
};

export function getStudioPrefs(): StudioPrefs {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    return {
      defaultStartNodeId: parsed.defaultStartNodeId || null,
      defaultLens: parsed.defaultLens === "topology" ? "topology" : "radial",
      bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [],
      radialPalette: parsed.radialPalette || "editorial",
      topologyPalette: parsed.topologyPalette || "cartographic",
      graceSeconds: typeof parsed.graceSeconds === "number" ? parsed.graceSeconds : 10,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveStudioPrefs(prefs: Partial<StudioPrefs>): StudioPrefs {
  try {
    const current = getStudioPrefs();
    const updated: StudioPrefs = {
      ...current,
      ...prefs,
    };
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function setStartView(nodeId: string | null, lens: "radial" | "topology"): StudioPrefs {
  return saveStudioPrefs({
    defaultStartNodeId: nodeId,
    defaultLens: lens,
  });
}

export function addBookmark(bookmark: StudioBookmark): StudioPrefs {
  const current = getStudioPrefs();
  const filtered = current.bookmarks.filter((b) => b.id !== bookmark.id);
  const updated = [bookmark, ...filtered].slice(0, 8); // Keep up to 8 bookmarks
  return saveStudioPrefs({ bookmarks: updated });
}

export function removeBookmark(bookmarkId: string): StudioPrefs {
  const current = getStudioPrefs();
  const updated = current.bookmarks.filter((b) => b.id !== bookmarkId);
  return saveStudioPrefs({ bookmarks: updated });
}

export function setPalettes(radialPalette: string, topologyPalette: string): StudioPrefs {
  return saveStudioPrefs({ radialPalette, topologyPalette });
}

export function setGraceSeconds(graceSeconds: number): StudioPrefs {
  return saveStudioPrefs({ graceSeconds });
}
