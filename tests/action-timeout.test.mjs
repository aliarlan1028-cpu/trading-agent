import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/lib.jsx", import.meta.url), "utf8");

function configuredTimeout(path) {
  const body = source.match(/export function actionTimeoutMs\(url\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(body, "actionTimeoutMs must remain a dedicated policy function");
  const isNativeApp = () => false;
  return Function("url", "isNativeApp", body)(path, isNativeApp);
}

test("long-running research actions are not aborted by the normal 12-second UI timeout", () => {
  assert.equal(configuredTimeout("/api/strategy/research"), 180000);
  assert.equal(configuredTimeout("/api/strategy/studio/drafts/draft_1/backtest"), 120000);
  assert.equal(configuredTimeout("/api/paper/run"), 120000);
  assert.equal(configuredTimeout("/api/knowledge/skills/skill_1/validate"), 120000);
  assert.equal(configuredTimeout("/api/knowledge/skills/skill_1/paper"), 120000);
  assert.equal(configuredTimeout("/api/tasks/task_1/run"), 12000);
});
