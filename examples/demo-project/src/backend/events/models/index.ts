// Backend/events/models — Canonical event payload models and envelope definitions.
import { Backend_events_schema_entry } from "../schema/index";
import { Data_schema_entry } from "../../../data/schema/index";
import { Core_models_entry } from "../../../core/models/index";
import { Shared_types_entry } from "../../../shared/types/index";
import { Shared_utils_entry } from "../../../shared/utils/index";

export const Backend_events_models_entry = {
  id: "Backend/events/models",
  name: "models",
  deps: [Backend_events_schema_entry, Data_schema_entry, Core_models_entry, Shared_types_entry, Shared_utils_entry],
};
