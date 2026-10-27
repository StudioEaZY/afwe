// Backend/auth — Identity verification, token issuance, and SSO integration.
import { Data_models_entry } from "../../data/models/index";
import { Shared_config_entry } from "../../shared/config/index";

export const Backend_auth_entry = {
  id: "Backend/auth",
  name: "auth",
  deps: [Data_models_entry, Shared_config_entry],
};

export * from "./mod_2";

export * from "./mod_3";
