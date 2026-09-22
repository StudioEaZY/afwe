export interface Tag { name: string; color?: string }

export function normaliseTag(name: string): Tag {
  return { name: name.trim().toLowerCase() };
}
