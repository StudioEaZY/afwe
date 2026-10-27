// Services/billing — Subscription lifecycle, invoicing, and payment gateway reconciliation.
import { Backend_events_models_entry } from "../../backend/events/models/index";
import { Backend_billing_entry } from "../../backend/billing/index";

export const Services_billing_entry = {
  id: "Services/billing",
  name: "billing",
  deps: [Backend_events_models_entry, Backend_billing_entry],
};

export * from "./mod_2";

export * from "./mod_3";
