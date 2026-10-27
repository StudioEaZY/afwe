// Backend/events/schema — JSON schema registry and runtime payload validators.
import { Shared_types_entry } from "../../../shared/types/index";
import { Shared_config_entry } from "../../../shared/config/index";

export const Backend_events_schema_entry = {
  id: "Backend/events/schema",
  name: "schema",
  deps: [Shared_types_entry, Shared_config_entry],
};

export * from "./mod_2";

export * from "./mod_3";
