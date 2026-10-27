// Backend/events/adapters — Outbox relay and message broker transport adapters.
import { Backend_events_models_entry } from "../models/index";

export const Backend_events_adapters_entry = {
  id: "Backend/events/adapters",
  name: "adapters",
  deps: [Backend_events_models_entry],
};
