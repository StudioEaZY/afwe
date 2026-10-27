// Mobile/adapters — Device storage, biometrics, and push notification bridges.
import { Backend_api_handlers_entry } from "../../backend/api/handlers/index";

export const Mobile_adapters_entry = {
  id: "Mobile/adapters",
  name: "adapters",
  deps: [Backend_api_handlers_entry],
};
