import { CanvasRenderer } from "../canvas/CanvasRenderer";

const renderer = new CanvasRenderer();

export function Widget(title: string) {
  // interactive rendering is prioritised over Lighthouse score here (decision: lighthouse-exception)
  return renderer.render({ title, interactive: true });
}
