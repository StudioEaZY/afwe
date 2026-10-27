// Services — Background job runners, billing orchestration, notifications, and analytics pipelines.
import { Backend_entry } from "../backend/index";
import { Core_entry } from "../core/index";
import { Data_entry } from "../data/index";

export const Services_entry = {
  id: "Services",
  name: "Services",
  deps: [Backend_entry, Core_entry, Data_entry],
};

export * from "./mod_2";
