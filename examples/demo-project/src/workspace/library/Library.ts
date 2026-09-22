import { Tag } from "../tagging/Tags";

export interface Item { id: string; title: string; tags: Tag[]; updatedAt: number }

export class Library {
  private items: Item[] = [];
  add(item: Item) { this.items.push(item); }
  recent(n: number): Item[] { return [...this.items].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, n); }
  all(): Item[] { return this.items; }
}
