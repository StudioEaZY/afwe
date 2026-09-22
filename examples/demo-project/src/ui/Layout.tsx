import { Button } from "./Button";

export function Layout(children: unknown[]) {
  return { type: "layout", children: [...children, Button({ label: "Help" })] };
}
