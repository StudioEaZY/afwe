// Services/notifications — Transactional email, webhook dispatch, and push delivery.
import { Backend_events_models_entry } from "../../backend/events/models/index";
import { Backend_events_handlers_entry } from "../../backend/events/handlers/index";
import { Backend_events_entry } from "../../backend/events/index";

export const Services_notifications_entry = {
  id: "Services/notifications",
  name: "notifications",
  deps: [Backend_events_models_entry, Backend_events_handlers_entry, Backend_events_entry],
};

export * from "./mod_2";
