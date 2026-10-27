// Data/schema — PostgreSQL table DDL, views, and index declarations.
import { Data_migrations_entry } from "../migrations/index";
import { Shared_config_entry } from "../../shared/config/index";
import { Web_views_entry } from "../../web/views/index";

export const Data_schema_entry = {
  id: "Data/schema",
  name: "schema",
  deps: [Data_migrations_entry, Shared_config_entry, Web_views_entry],
};

export * from "./mod_2";

export * from "./mod_3";
