// Backend/events/handlers — Idempotent domain event consumers and side-effect processors.
import { Backend_events_models_entry } from "../models/index";

export const Backend_events_handlers_entry = {
  id: "Backend/events/handlers",
  name: "handlers",
  deps: [Backend_events_models_entry],
};
