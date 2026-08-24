import assert from "node:assert/strict";
import test from "node:test";
import {
  MOBILE_MORE_UTILITIES,
  MOBILE_WORKSPACE_NAV,
  mobileWorkspaceDestinations
} from "../src/mobileNavigation.js";

test("More contains only global utilities", () => {
  assert.deepEqual(MOBILE_MORE_UTILITIES.map((item) => item.id), ["operationsCenter", "systemSettings"]);
});

test("workspace destinations are unique and never duplicated in More", () => {
  const owned = Object.values(MOBILE_WORKSPACE_NAV).flat().map((item) => item.id);
  const utilities = MOBILE_MORE_UTILITIES.map((item) => item.id);
  assert.equal(new Set(owned).size, owned.length);
  assert.equal(owned.some((id) => utilities.includes(id)), false);
});

test("unknown workspace resolves to no destinations", () => {
  assert.deepEqual(mobileWorkspaceDestinations("unknown"), []);
});
