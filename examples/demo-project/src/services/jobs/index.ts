// Services/jobs — Asynchronous job workers, schedulers, and background auth token maintenance.
import { Backend_events_models_entry } from "../../backend/events/models/index";
import { Backend_events_entry } from "../../backend/events/index";

export const Services_jobs_entry = {
  id: "Services/jobs",
  name: "jobs",
  deps: [Backend_events_models_entry, Backend_events_entry],
};
