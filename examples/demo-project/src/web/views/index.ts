// Web/views — Interactive page views and checkout presentation flows.
import { Backend_events_models_entry } from "../../backend/events/models/index";
import { Backend_api_routes_entry } from "../../backend/api/routes/index";
import { Backend_api_entry } from "../../backend/api/index";

export const Web_views_entry = {
  id: "Web/views",
  name: "views",
  deps: [Backend_events_models_entry, Backend_api_routes_entry, Backend_api_entry],
};

export * from "./mod_2";

export * from "./mod_3";
