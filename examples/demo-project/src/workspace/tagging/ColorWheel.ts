// tag-color-wheel component & tag-pill-renderer widget
export const TAG_PALETTE = ["#4338ca", "#059669", "#d97706", "#dc2626", "#7c3aed"];

export function getTagColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const index = Math.abs(hash) % TAG_PALETTE.length;
  return TAG_PALETTE[index];
}

export function renderTagPill(name: string): { label: string; bg: string } {
  return { label: name.toLowerCase().trim(), bg: getTagColor(name) };
}
