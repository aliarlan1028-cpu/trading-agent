import assert from "node:assert/strict";
import test from "node:test";
import {
  MOBILE_MORE_UTILITIES,
  MOBILE_WORKSPACE_NAV,
  mobileWorkspaceDestinations
} from "../src/mobileNavigation.js";
import { resolveMobileRoute } from "../src/productArchitecture.js";

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

test("every workspace-local destination resolves to its canonical product workspace", () => {
  const canonicalWorkspace = { trade: "live" };
  for (const workspace of ["ai", "trade", "lab", "control"]) {
    for (const destination of mobileWorkspaceDestinations(workspace)) {
      assert.equal(resolveMobileRoute(destination.id).workspace, canonicalWorkspace[workspace] || workspace, destination.id);
    }
  }
});
