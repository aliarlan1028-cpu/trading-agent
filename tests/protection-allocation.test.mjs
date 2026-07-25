import test from "node:test";
import assert from "node:assert/strict";
import { allocateProtectionQuantities } from "../server/executionEngine.mjs";

test("take-profit allocation never exceeds the filled position", () => {
  const quantities = allocateProtectionQuantities(0.001, 2, 50_000);
  assert.equal(quantities.length, 2);
  assert.ok(quantities.every((value) => value > 0));
  assert.ok(quantities.reduce((sum, value) => sum + value, 0) <= 0.001);
});

test("allocation fails closed when precision cannot represent every target", () => {
  assert.deepEqual(allocateProtectionQuantities(0.0001, 3, 50_000), []);
});
