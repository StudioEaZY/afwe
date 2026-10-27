// Infrastructure/queues — Queue broker bindings and dead-letter queue consumers.
import { Backend_events_adapters_entry } from "../../backend/events/adapters/index";

export const Infrastructure_queues_entry = {
  id: "Infrastructure/queues",
  name: "queues",
  deps: [Backend_events_adapters_entry],
};
