import test from "node:test";
import assert from "node:assert/strict";
import { isEventRiskActive } from "../server/eventRisk.mjs";

test("event risk applies only inside its active time window", () => {
  const now = Date.now();
  assert.equal(isEventRiskActive({ due: new Date(now + 60_000).toISOString(), status: "跟进中" }, now), true);
  assert.equal(isEventRiskActive({ due: new Date(now - 2 * 24 * 60 * 60_000).toISOString(), status: "跟进中" }, now), false);
  assert.equal(isEventRiskActive({ due: new Date(now + 60_000).toISOString(), status: "closed" }, now), false);
});
