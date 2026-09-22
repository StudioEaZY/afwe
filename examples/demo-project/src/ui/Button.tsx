export function Button(props: { label: string; onClick?: () => void }) {
  return { type: "button", props };
}
