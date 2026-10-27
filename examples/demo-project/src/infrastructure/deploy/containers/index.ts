// Infrastructure/deploy/containers — containers
import { Services_billing_entry } from "../../../services/billing/index"; // VIOLATION 3: Infrastructure/deploy -> Services/billing

export const Infrastructure_deploy_containers_entry = {
  id: "Infrastructure/deploy/containers",
  name: "containers",
  deps: [Services_billing_entry],
};

export * from "./mod_2";
