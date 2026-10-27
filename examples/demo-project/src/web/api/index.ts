// Web/api — Browser HTTP client and request interceptors.
import { Backend_api_handlers_entry } from "../../backend/api/handlers/index";

export const Web_api_entry = {
  id: "Web/api",
  name: "api",
  deps: [Backend_api_handlers_entry],
};

export * from "./mod_2";
