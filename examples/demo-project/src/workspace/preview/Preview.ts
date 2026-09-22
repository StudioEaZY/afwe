import type { Item } from "../library/Library";
import { CanvasRenderer } from "../../canvas/CanvasRenderer";

const renderer = new CanvasRenderer();

export function preview(item: Item) {
  return renderer.render({ title: item.title, interactive: false });
}
