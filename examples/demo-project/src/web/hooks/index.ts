// Web/hooks — Reusable React state and data-fetching hooks.
import { Backend_api_routes_entry } from "../../backend/api/routes/index";

export const Web_hooks_entry = {
  id: "Web/hooks",
  name: "hooks",
  deps: [Backend_api_routes_entry],
};

export * from "./mod_2";
