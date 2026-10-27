// Data/migrations — Zero-downtime schema migration runner and history.
import { Infrastructure_deploy_entry } from "../../infrastructure/deploy/index";

export const Data_migrations_entry = {
  id: "Data/migrations",
  name: "migrations",
  deps: [Infrastructure_deploy_entry],
};
