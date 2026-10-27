// Core/events — In-process domain event dispatcher and contracts.
import { Backend_events_models_entry } from "../../backend/events/models/index";

export const Core_events_entry = {
  id: "Core/events",
  name: "events",
  deps: [Backend_events_models_entry],
};
