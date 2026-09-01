import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGACY_ACTION_ENDPOINTS,
  V2_ACTION_ENDPOINTS,
  resolveKordynUiVersion
} from "../src/kordynV2/cutover.js";

const sorted = (values) => [...values].sort();

test("legacy and V2 switches leave API route and action contracts unchanged", () => {
  assert.equal(resolveKordynUiVersion({ PROD: true, VITE_KORDYN_UI_VERSION: "legacy" }), "legacy");
  assert.equal(resolveKordynUiVersion({ PROD: true, VITE_KORDYN_UI_VERSION: "v2" }), "v2");
  assert.deepEqual(sorted(V2_ACTION_ENDPOINTS), sorted(LEGACY_ACTION_ENDPOINTS));
});

test("rollback contract is explicit, immutable, unique, and covers safety-critical actions", () => {
  assert.equal(Object.isFrozen(V2_ACTION_ENDPOINTS), true);
  assert.equal(Object.isFrozen(LEGACY_ACTION_ENDPOINTS), true);
  assert.equal(new Set(V2_ACTION_ENDPOINTS).size, V2_ACTION_ENDPOINTS.length);
  assert.ok(V2_ACTION_ENDPOINTS.length >= 50, `expected broad deployed action coverage, received ${V2_ACTION_ENDPOINTS.length}`);
  for (const endpoint of [
    "POST /api/trade-plans/:id/approve",
    "POST /api/reconciler/run",
    "POST /api/risk/emergency-flatten",
    "POST /api/risk/kill-switch",
    "POST /api/knowledge/convert",
    "POST /api/review/improvements/:id/action",
    "POST /api/scheduler/recover",
    "POST /api/config/live-trading"
  ]) {
    assert.ok(V2_ACTION_ENDPOINTS.includes(endpoint), `rollback contract includes ${endpoint}`);
  }
});
