// Backend — Core API gateway, domain event bus, authentication service, and billing controllers.
import { Data_entry } from "../data/index";
import { Shared_entry } from "../shared/index";
import { Core_entry } from "../core/index";

export const Backend_entry = {
  id: "Backend",
  name: "Backend",
  deps: [Data_entry, Shared_entry, Core_entry],
};

export * from "./mod_2";

export * from "./mod_3";
