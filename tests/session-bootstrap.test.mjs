import assert from "node:assert/strict";
import test from "node:test";
import {
  initialAuthRequired,
  shouldBootstrapCoreOnMount,
  shouldSynchronizeAuthenticatedData
} from "../src/sessionBootstrap.js";

test("native without a token opens login and skips core bootstrap", () => {
  assert.equal(initialAuthRequired({ native: true, token: "" }), true);
  assert.equal(shouldBootstrapCoreOnMount({ native: true, token: "" }), false);
});

test("native token and Web cookie discovery remain server-authoritative", () => {
  assert.equal(initialAuthRequired({ native: true, token: "token-present" }), false);
  assert.equal(shouldBootstrapCoreOnMount({ native: true, token: "token-present" }), true);
  assert.equal(initialAuthRequired({ native: false, token: "" }), true);
  assert.equal(shouldBootstrapCoreOnMount({ native: false, token: "" }), true);
});

test("every background recovery source fails closed for native without a token", () => {
  for (const source of ["mount", "fallback", "focus", "visibility", "invalidation"]) {
    assert.equal(
      shouldSynchronizeAuthenticatedData({ native: true, token: "", source }),
      false,
      `${source} must not synchronize authenticated data before native login`
    );
  }
  assert.equal(shouldSynchronizeAuthenticatedData({ native: true, token: "token-present", source: "focus" }), true);
  assert.equal(shouldSynchronizeAuthenticatedData({ native: false, token: "", source: "focus" }), true);
});
