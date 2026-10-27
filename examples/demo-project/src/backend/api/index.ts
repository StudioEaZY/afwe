// Backend/api — Versioned REST and RPC route definitions, request handlers, and auth middleware.
import { Backend_events_entry } from "../events/index";
import { Backend_auth_entry } from "../auth/index";
import { Data_models_entry } from "../../data/models/index";

export const Backend_api_entry = {
  id: "Backend/api",
  name: "api",
  deps: [Backend_events_entry, Backend_auth_entry, Data_models_entry],
};

export * from "./mod_2";

export * from "./mod_3";
