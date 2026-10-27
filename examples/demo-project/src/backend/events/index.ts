// Backend/events — Domain event publishing, canonical event models, handlers, and transport adapters.
import { Data_schema_entry } from "../../data/schema/index";
import { Core_events_entry } from "../../core/events/index";
import { Shared_utils_entry } from "../../shared/utils/index";

export const Backend_events_entry = {
  id: "Backend/events",
  name: "events",
  deps: [Data_schema_entry, Core_events_entry, Shared_utils_entry],
};
