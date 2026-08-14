import assert from "node:assert/strict";
import test from "node:test";
import { hasNewWebRelease, normalizeRelease } from "../src/releaseUpdate.js";

test("网页只在两个不可变发布版本确实不一致时提示刷新", () => {
  assert.equal(hasNewWebRelease("abc-20260814", "abc-20260814"), false);
  assert.equal(hasNewWebRelease("abc-20260814", "def-20260815"), true);
  assert.equal(hasNewWebRelease("dev", "def-20260815"), false);
  assert.equal(hasNewWebRelease("abc-20260814", "dev"), false);
  assert.equal(normalizeRelease(" unknown "), null);
});
