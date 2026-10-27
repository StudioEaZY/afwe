// Services/analytics — Uncharted event aggregation and cohort funnel scripts.
import { Backend_events_handlers_entry } from "../../backend/events/handlers/index";

export const Services_analytics_entry = {
  id: "Services/analytics",
  name: "analytics",
  deps: [Backend_events_handlers_entry],
};

export * from "./mod_2";

export * from "./mod_3";
