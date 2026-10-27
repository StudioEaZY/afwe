// Infrastructure — Container deployment manifests, OpenTelemetry collectors, and message queue provisioning.
import { Core_entry } from "../core/index";
import { Shared_entry } from "../shared/index";

export const Infrastructure_entry = {
  id: "Infrastructure",
  name: "Infrastructure",
  deps: [Core_entry, Shared_entry],
};

export * from "./mod_2";
