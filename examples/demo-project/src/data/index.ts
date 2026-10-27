// Data — Relational schema definitions, query repositories, migrations, and ETL scripts.
import { Shared_entry } from "../shared/index";
import { Web_entry } from "../web/index";

export const Data_entry = {
  id: "Data",
  name: "Data",
  deps: [Shared_entry, Web_entry],
};
