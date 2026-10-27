// Backend/api/routes — Public API route declarations and OpenAPI bindings.
import { Backend_events_models_entry } from "../../events/models/index";

export const Backend_api_routes_entry = {
  id: "Backend/api/routes",
  name: "routes",
  deps: [Backend_events_models_entry],
};

export * from "./mod_2";

export * from "./mod_3";
