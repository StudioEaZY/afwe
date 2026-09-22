import { User } from "../identity/user";
import { charge } from "./stripe";
// ⚠ architectural violation on purpose: Payments must not depend on UI (see constraints.yaml)
import { Button } from "../ui/Button";

export interface Cart { items: { sku: string; cents: number }[] }

export async function checkout(user: User, cart: Cart) {
  const total = cart.items.reduce((sum, i) => sum + i.cents, 0);
  console.log("charging", user.email, total); // ⚠ forbidden by the payments-boundary active guardrail
  await charge(user.id, total);
  return Button; // nonsense, but it makes the dependency real
}
