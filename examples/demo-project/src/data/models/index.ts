// Data/models — Data access repositories and typed SQL builders.
import { Data_schema_entry } from "../schema/index";
import { Shared_types_entry } from "../../shared/types/index";

export const Data_models_entry = {
  id: "Data/models",
  name: "models",
  deps: [Data_schema_entry, Shared_types_entry],
};

export * from "./mod_2";

export * from "./mod_3";
