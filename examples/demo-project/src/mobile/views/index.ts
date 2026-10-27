// Mobile/views — Mobile screen layouts and navigation stacks.
import { Backend_api_routes_entry } from "../../backend/api/routes/index";
import { Backend_api_entry } from "../../backend/api/index";

export const Mobile_views_entry = {
  id: "Mobile/views",
  name: "views",
  deps: [Backend_api_routes_entry, Backend_api_entry],
};

export * from "./mod_2";
