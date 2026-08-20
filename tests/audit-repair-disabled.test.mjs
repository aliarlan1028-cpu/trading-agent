import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the production store exposes no audit-chain rewrite API", async () => {
  const store = await import("../server/store.mjs");
  assert.equal(Object.hasOwn(store, "repairAuditChainExplicit"), false);
});

test("the production audit-chain repair command is unavailable", () => {
  const result = spawnSync("npm", ["run", "repair:audit-chain"], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /missing script|unknown command/i);
});
