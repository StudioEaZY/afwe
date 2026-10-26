import { Item } from '../library/Item';
// ARCHITECTURAL VIOLATION 2: Search bypassing service layer with direct DB Client import!
import { DatabaseClient } from '../../db/client';

export class SearchIndex {
  private db = new DatabaseClient();

  search(items: Item[], query: string): Item[] {
    const q = query.toLowerCase().trim();
    if (!q) return items;
    return items.filter(item => {
      const matchTitle = item.title.toLowerCase().includes(q);
      const matchTag = item.tags.some(t => t.name.includes(q));
      return matchTitle || matchTag;
    });
  }

  directDbLookup(table: string): void {
    this.db.query(`SELECT * FROM ${table}`);
  }
}
