// Backend/auth/models — models
import { Backend_events_models_entry } from "../../events/models/index";

export const Backend_auth_models_entry = {
  id: "Backend/auth/models",
  name: "models",
  deps: [Backend_events_models_entry],
};

export * from "./mod_2";

export * from "./mod_3";
