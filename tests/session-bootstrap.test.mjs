import assert from "node:assert/strict";
import test from "node:test";
import { initialAuthRequired, shouldBootstrapCoreOnMount } from "../src/sessionBootstrap.js";

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
