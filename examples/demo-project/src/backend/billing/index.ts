// Backend/billing — Backend billing ledger models, job triggers, and raw webhook receivers.
import { Data_models_entry } from "../../data/models/index";
import { Backend_events_entry } from "../events/index";

export const Backend_billing_entry = {
  id: "Backend/billing",
  name: "billing",
  deps: [Data_models_entry, Backend_events_entry],
};
