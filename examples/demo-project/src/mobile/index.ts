// Mobile — iOS and Android client views, offline sync hooks, and native adapters.
import { Backend_entry } from "../backend/index";
import { Shared_entry } from "../shared/index";
import { Core_entry } from "../core/index";

export const Mobile_entry = {
  id: "Mobile",
  name: "Mobile",
  deps: [Backend_entry, Shared_entry, Core_entry],
};

export * from "./mod_2";
