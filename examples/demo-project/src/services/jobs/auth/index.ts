// Services/jobs/auth — Background credential rotation, token revocation, and OAuth key refresh jobs.
import { Backend_auth_tokens_entry } from "../../../backend/auth/tokens/index";
import { Backend_events_models_entry } from "../../../backend/events/models/index";

export const Services_jobs_auth_entry = {
  id: "Services/jobs/auth",
  name: "auth",
  deps: [Backend_auth_tokens_entry, Backend_events_models_entry],
};

export * from "./mod_2";

export * from "./mod_3";
