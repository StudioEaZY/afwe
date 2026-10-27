// Core/models — Domain aggregates, entities, and value objects.
import { Core_rules_entry } from "../rules/index";
import { Shared_utils_entry } from "../../shared/utils/index";

export const Core_models_entry = {
  id: "Core/models",
  name: "models",
  deps: [Core_rules_entry, Shared_utils_entry],
};
