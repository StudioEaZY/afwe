// Core/rules — Pricing, entitlement quota, and permission evaluation engines.
import { Shared_config_entry } from "../../shared/config/index";

export const Core_rules_entry = {
  id: "Core/rules",
  name: "rules",
  deps: [Shared_config_entry],
};

export * from "./mod_2";

export * from "./mod_3";
