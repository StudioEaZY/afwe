// apps/studio/src/lib/palettes.ts
// Dual Color Engine for AFWE Studio: Separated palettes for Radial and Topology

export interface ColorHueFamily {
  name: string;
  ring1: string; // Inner ring (rich/deeper)
  ring2: string; // Middle ring (balanced)
  ring3: string; // Outer ring (delicate/lighter)
  accent: string;
  translucentHull: string; // For topology background wash
  border: string;
}

// ── 1. Radial Multi-Hue Domain Color Families ──
// Slices touch edge-to-edge; high adjacent contrast and ring luminance stepping
export const RADIAL_DOMAIN_FAMILIES: ColorHueFamily[] = [
  {
    name: "Forest Sage",
    ring1: "#5A9473",
    ring2: "#85B499",
    ring3: "#B1D3BF",
    accent: "#2E7A57",
    translucentHull: "#EBF3EE",
    border: "#44785C",
  },
  {
    name: "Warm Ochre",
    ring1: "#C88E3E",
    ring2: "#DBAE6E",
    ring3: "#EED1A2",
    accent: "#A66D24",
    translucentHull: "#FBF5EB",
    border: "#AA7227",
  },
  {
    name: "Coastal Slate-Teal",
    ring1: "#478093",
    ring2: "#72A3B3",
    ring3: "#A5C7D2",
    accent: "#2E5E6F",
    translucentHull: "#E9F2F5",
    border: "#336575",
  },
  {
    name: "Terracotta Clay",
    ring1: "#BD654D",
    ring2: "#D48B77",
    ring3: "#EBB5A7",
    accent: "#9C4630",
    translucentHull: "#FAF0EC",
    border: "#9E4C37",
  },
  {
    name: "Muted Indigo",
    ring1: "#736894",
    ring2: "#978EAE",
    ring3: "#C0B9D0",
    accent: "#514670",
    translucentHull: "#F1EFF6",
    border: "#5B5079",
  },
  {
    name: "Olive Moss",
    ring1: "#82924E",
    ring2: "#A3B177",
    ring3: "#C9D3A8",
    accent: "#637233",
    translucentHull: "#F3F5EA",
    border: "#67753A",
  },
  {
    name: "Heather Violet",
    ring1: "#935E82",
    ring2: "#B184A3",
    ring3: "#D3B2C8",
    accent: "#764366",
    translucentHull: "#F7EEF4",
    border: "#79476A",
  },
  {
    name: "Nordic Denim",
    ring1: "#527596",
    ring2: "#7C9CB9",
    ring3: "#B0C5DA",
    accent: "#375574",
    translucentHull: "#EDF2F7",
    border: "#3E5D7A",
  },
];

export const RADIAL_PALETTE_PRESETS: Record<string, { label: string; families: ColorHueFamily[] }> = {
  editorial: {
    label: "Editorial Rich (Default)",
    families: RADIAL_DOMAIN_FAMILIES,
  },
  botanical: {
    label: "Botanical Earth",
    families: [
      RADIAL_DOMAIN_FAMILIES[0], // Sage
      RADIAL_DOMAIN_FAMILIES[5], // Olive
      RADIAL_DOMAIN_FAMILIES[1], // Ochre
      RADIAL_DOMAIN_FAMILIES[3], // Terracotta
    ],
  },
  oceanic: {
    label: "Oceanic Slate",
    families: [
      RADIAL_DOMAIN_FAMILIES[2], // Coastal Slate
      RADIAL_DOMAIN_FAMILIES[7], // Nordic Denim
      RADIAL_DOMAIN_FAMILIES[4], // Muted Indigo
      RADIAL_DOMAIN_FAMILIES[0], // Sage
    ],
  },
  blueprint: {
    label: "High-Contrast Blueprint",
    families: [
      RADIAL_DOMAIN_FAMILIES[7], // Denim
      RADIAL_DOMAIN_FAMILIES[1], // Ochre
      RADIAL_DOMAIN_FAMILIES[2], // Slate
      RADIAL_DOMAIN_FAMILIES[0], // Sage
    ],
  },
};

// ── 2. Topology Color System ──
// Translucent organic territory washes, high-contrast white cards, and semantic edge ribbons
export interface TopologyTerritoryStyle {
  fill: string;
  stroke: string;
  badgeBg: string;
  badgeText: string;
}

export const TOPOLOGY_TERRITORY_STYLES: Record<string, TopologyTerritoryStyle> = {
  services: { fill: "#EBF3EE", stroke: "#6A987E", badgeBg: "#D8EAE0", badgeText: "#256345" },
  backend: { fill: "#EBF3EE", stroke: "#6A987E", badgeBg: "#D8EAE0", badgeText: "#256345" },
  web: { fill: "#FBF5EB", stroke: "#BA986A", badgeBg: "#F4E8D3", badgeText: "#876226" },
  frontend: { fill: "#FBF5EB", stroke: "#BA986A", badgeBg: "#F4E8D3", badgeText: "#876226" },
  shared: { fill: "#EDF2F7", stroke: "#6A89A8", badgeBg: "#DBE6F0", badgeText: "#2F5170" },
  core: { fill: "#EDF2F7", stroke: "#6A89A8", badgeBg: "#DBE6F0", badgeText: "#2F5170" },
  data: { fill: "#F1EFF6", stroke: "#8879A8", badgeBg: "#E3DEF0", badgeText: "#4C3D6E" },
  libs: { fill: "#FAF0EC", stroke: "#BD735F", badgeBg: "#F4DFD7", badgeText: "#963D25" },
  external: { fill: "#FAF0EC", stroke: "#BD735F", badgeBg: "#F4DFD7", badgeText: "#963D25" },
  infra: { fill: "#F3F5EA", stroke: "#8E9E5E", badgeBg: "#E6ECCB", badgeText: "#556429" },
  scripts: { fill: "#F3F5EA", stroke: "#8E9E5E", badgeBg: "#E6ECCB", badgeText: "#556429" },
  tools: { fill: "#F3F5EA", stroke: "#8E9E5E", badgeBg: "#E6ECCB", badgeText: "#556429" },
  tests: { fill: "#E9F2F5", stroke: "#5E93A3", badgeBg: "#D4E6EB", badgeText: "#246173" },
  violation: { fill: "#FDECE9", stroke: "#C94A38", badgeBg: "#FCD8D2", badgeText: "#A82B1B" },
  default: { fill: "#F5F3EC", stroke: "#A39C8C", badgeBg: "#EAE5D8", badgeText: "#5C5648" },
};

export const getTopologyTerritoryStyle = (labelOrKind: string, hasViolation?: boolean): TopologyTerritoryStyle => {
  if (hasViolation) return TOPOLOGY_TERRITORY_STYLES.violation;
  const l = (labelOrKind || "").toLowerCase();
  for (const [key, style] of Object.entries(TOPOLOGY_TERRITORY_STYLES)) {
    if (key !== "default" && key !== "violation" && l.includes(key)) {
      return style;
    }
  }
  return TOPOLOGY_TERRITORY_STYLES.default;
};

// ── 3. Shared Semantic Status Colors ──
export const SEMANTIC_COLORS = {
  unchartedFill: "#FAF8F3",
  unchartedHatch: "#D6CFC0",
  unchartedStroke: "#9C9484",
  violationText: "#C94A38",
  violationFill: "#FDECE9",
  violationStroke: "#C94A38",
  pinnedAccent: "#C89D54",
  pinnedFill: "#FAF3DB",
  addedAccent: "#2E7A57",
  addedFill: "#E8F3ED",
  modifiedAccent: "#D49B35",
  modifiedFill: "#FAF3DB",
  removedAccent: "#A82B1B",
  removedFill: "#FDECE9",
  edgeUses: "#6E685F",
  edgeNew: "#2E7A57",
  edgeViolation: "#C94A38",
  edgeRemoved: "#A82B1B",
  edgeProposed: "#D49B35",
};
