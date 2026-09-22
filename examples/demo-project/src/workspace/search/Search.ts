import { Library, Item } from "../library/Library";

export function search(lib: Library, q: string): Item[] {
  const needle = q.toLowerCase();
  return lib.all().filter((i) => i.title.toLowerCase().includes(needle) || i.tags.some((t) => t.name.includes(needle)));
}
