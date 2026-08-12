import assert from "node:assert/strict";
import test from "node:test";
import { correctUnbackedWatchRegistration, hasWatchRegistrationClaim } from "../server/watchClaimGuard.mjs";

test("声称本轮新增观察哨但没有工具证据时给出精确更正", () => {
  const result = correctUnbackedWatchRegistration("已同步登记观察哨盯回踩。", []);
  assert.equal(result.corrected, true);
  assert.match(result.text, /本轮所述新条件不会自动盯盘/);
  assert.match(result.text, /已经登记的观察哨仍照常运行/);
});

test("只描述现有观察哨在位不会被误判为本轮登记", () => {
  const text = "BTC 3 个观察哨在位，现有条件继续盯盘。";
  assert.equal(hasWatchRegistrationClaim(text), false);
  assert.equal(correctUnbackedWatchRegistration(text, []).corrected, false);
});

test("本轮 register_watch 成功时不追加更正，失败时仍更正", () => {
  const text = "已经登记 1 个观察哨。";
  assert.equal(correctUnbackedWatchRegistration(text, [{ name: "register_watch", summary: "已挂观察哨 watch_1" }]).corrected, false);
  assert.equal(correctUnbackedWatchRegistration(text, [{ name: "register_watch", summary: "失败：条件已经成立" }]).corrected, true);
});
