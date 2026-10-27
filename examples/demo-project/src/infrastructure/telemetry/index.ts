// Infrastructure/telemetry — Metrics exporters and distributed trace samplers.
import { Services_analytics_entry } from "../../services/analytics/index";

export const Infrastructure_telemetry_entry = {
  id: "Infrastructure/telemetry",
  name: "telemetry",
  deps: [Services_analytics_entry],
};
