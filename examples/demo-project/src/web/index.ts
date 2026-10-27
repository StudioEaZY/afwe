// Web — Customer-facing web application shell, views, hooks, and API client.
import { Backend_entry } from "../backend/index";
import { Shared_entry } from "../shared/index";

export const Web_entry = {
  id: "Web",
  name: "Web",
  deps: [Backend_entry, Shared_entry],
};
