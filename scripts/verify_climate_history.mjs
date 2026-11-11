import { readFileSync } from "node:fs";
import { historyClimateCurrentPoints, historySetpointPoints } from "../custom_components/ha_thermo/www/ha-thermo-common.js";

const states = JSON.parse(readFileSync(new URL("../tests/fixtures/climate_history_delta.json", import.meta.url), "utf8"));
const entity = "climate.test";
const current = historyClimateCurrentPoints(states, entity);
const target = historySetpointPoints(states, entity);

if (current.length < 3) {
  console.error("expected >= 3 current points from attribute deltas, got", current.length);
  process.exit(1);
}
if (target.length < 3) {
  console.error("expected >= 3 target points from attribute deltas, got", target.length);
  process.exit(1);
}
console.log("ok", { current: current.length, target: target.length });
