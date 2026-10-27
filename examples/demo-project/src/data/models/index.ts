// Data/models — Data access repositories and typed SQL builders.
import { Data_schema_entry } from "../schema/index";
import { Shared_types_entry } from "../../shared/types/index";
import { Web_views_entry } from "../../web/views/index"; // VIOLATION 1: Data/models -> Web/views

export const Data_models_entry = {
  id: "Data/models",
  name: "models",
  deps: [Data_schema_entry, Shared_types_entry, Web_views_entry],
};

export * from "./mod_2";

export * from "./mod_3";
