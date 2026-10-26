import { Item, ItemId } from './Item';
import { Tag } from '../tagging/Tags';
// ARCHITECTURAL VIOLATION 1: Workspace must not depend on billing checkout internals!
import { StripeGateway } from '../../billing/stripe/StripeGateway';

export class Library {
  private items = new Map<ItemId, Item>();

  constructor(private stripeGateway?: StripeGateway) {}

  add(item: Item): void {
    this.items.set(item.id, item);
  }

  get(id: ItemId): Item | undefined {
    return this.items.get(id);
  }

  all(): Item[] {
    return Array.from(this.items.values());
  }

  tagItem(id: ItemId, tag: Tag): void {
    const item = this.items.get(id);
    if (!item) return;
    if (!item.tags.some(t => t.id === tag.id)) {
      item.tags.push(tag);
    }
  }
}
