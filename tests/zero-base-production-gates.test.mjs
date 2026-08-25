import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runner = readFileSync(new URL("./run-zero-base-production-gates.mjs", import.meta.url), "utf8");

test("production visual gates own an isolated backend and Vite lifecycle", () => {
  assert.match(runner, /server\/index\.mjs/);
  assert.match(runner, /node_modules\/vite\/bin\/vite\.js/);
  assert.match(runner, /NODE_TEST_CONTEXT:\s*"1"/);
  assert.match(runner, /TEST_DATA_ROOT:/);
  assert.match(runner, /realpath\(["']\/tmp["']\)/);
  assert.match(runner, /VITE_API_PROXY_TARGET:/);
  assert.match(runner, /run-production-shell-selection-browser\.mjs/);
  assert.match(runner, /run-event-risk-production-visual\.mjs/);
  assert.match(runner, /KORDYN_APP_URL:/);
  assert.match(runner, /KORDYN_VISUAL_BASE_URL:/);
  assert.match(runner, /finally\s*\{[\s\S]*stopProcess\(vite\)[\s\S]*stopProcess\(backend\)[\s\S]*rm\(tempRoot/);
});
