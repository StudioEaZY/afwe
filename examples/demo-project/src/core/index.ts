// Core — Pure domain entities, business rules, domain event contracts, and invariant utilities.
import { Shared_entry } from "../shared/index";

export const Core_entry = {
  id: "Core",
  name: "Core",
  deps: [Shared_entry],
};

export * from "./mod_2";

export * from "../workspace/tagging/ColorWheel";
export * from "../workspace/search/Search";
export * from "../workspace/preview/Preview";
