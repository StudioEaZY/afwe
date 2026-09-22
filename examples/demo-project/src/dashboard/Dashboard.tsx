import { Layout } from "../ui/Layout";
import { Widget } from "./Widget";
import { Library } from "../workspace/library/Library";

export function Dashboard(lib: Library) {
  return Layout(lib.recent(5).map((item) => Widget(item.title)));
}
