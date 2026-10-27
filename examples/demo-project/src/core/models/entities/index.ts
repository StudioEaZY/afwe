// Core/models/entities — entities
import { Backend_api_entry } from "../../../backend/api/index"; // VIOLATION 2: Core/models -> Backend/api

export const Core_models_entities_entry = {
  id: "Core/models/entities",
  name: "entities",
  deps: [Backend_api_entry],
};

export * from "./mod_2";

export * from "./mod_3";
