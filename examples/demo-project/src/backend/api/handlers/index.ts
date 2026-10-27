// Backend/api/handlers — HTTP controller handlers delegating to domain services.
import { Backend_events_models_entry } from "../../events/models/index";

export const Backend_api_handlers_entry = {
  id: "Backend/api/handlers",
  name: "handlers",
  deps: [Backend_events_models_entry],
};
