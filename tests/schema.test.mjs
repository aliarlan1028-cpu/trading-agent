import { test } from "node:test";
import assert from "node:assert/strict";
import { validateTradePlan, validateOrder, validateRuntimeConfig } from "../server/schema.mjs";

test("合法做多计划通过并规范化双字段", () => {
  const r = validateTradePlan({ symbol: "BTC/USDT", direction: "long", entry_range: [60000, 60200], stopLoss: 59000, takeProfit: [61000, 62000], leverage: 3, max_loss_pct: 1 });
  assert.equal(r.valid, true);
  assert.equal(r.normalized.stop_loss, 59000);
  assert.deepEqual(r.normalized.take_profit, [61000, 62000]);
});

test("做多止损在入场上方 → 拒绝", () => {
  const r = validateTradePlan({ symbol: "BTC/USDT", direction: "long", entry_range: [60000, 60200], stopLoss: 60500, takeProfit: [61000], leverage: 3, max_loss_pct: 1 });
  assert.equal(r.valid, false);
  assert.match(r.errors.join(""), /止损.*必须低于/);
});

test("做空止损在入场下方 → 拒绝", () => {
  const r = validateTradePlan({ symbol: "ETH/USDT", direction: "short", entryLow: 3000, entryHigh: 3010, stop_loss: 2990, take_profit: [2900], leverage: 2, max_loss_pct: 0.5 });
  assert.equal(r.valid, false);
  assert.match(r.errors.join(""), /止损.*必须高于/);
});

test("入场区间颠倒 → 自动交换并警告", () => {
  const r = validateTradePlan({ symbol: "SOL/USDT", direction: "long", entry_range: [181, 180], stopLoss: 178, takeProfit: [185], leverage: 3, max_loss_pct: 1 });
  assert.equal(r.valid, true);
  assert.deepEqual(r.normalized.entry_range, [180, 181]);
  assert.match(r.warnings.join(""), /颠倒/);
});

test("NaN / 缺字段 → 拒绝", () => {
  const r = validateTradePlan({ symbol: "BTC/USDT", direction: "long", entry_range: [60000, "abc"], stopLoss: 59000, max_loss_pct: 1 });
  assert.equal(r.valid, false);
});

test("非法方向 → 拒绝", () => {
  const r = validateTradePlan({ symbol: "BTC/USDT", direction: "sideways", entry_range: [1, 2], stopLoss: 0.5, max_loss_pct: 1 });
  assert.equal(r.valid, false);
  assert.match(r.errors.join(""), /direction/);
});

test("订单校验：数量非正 / 限价缺价", () => {
  assert.equal(validateOrder({ symbol: "BTC/USDT", side: "buy", size: 0 }).valid, false);
  assert.equal(validateOrder({ symbol: "BTC/USDT", side: "buy", size: 1, orderType: "limit" }).valid, false);
  assert.equal(validateOrder({ symbol: "BTC/USDT", side: "buy", size: 1, orderType: "market" }).valid, true);
});

test("运行配置：空模型名拒绝、含空白拒绝、flash 警告", () => {
  assert.equal(validateRuntimeConfig({ DEEPSEEK_MODEL: "" }).valid, false);
  assert.equal(validateRuntimeConfig({ DEEPSEEK_MODEL: "deepseek v4" }).valid, false);
  const flash = validateRuntimeConfig({ DEEPSEEK_MODEL: "deepseek-v4-flash" });
  assert.equal(flash.valid, true);
  assert.match(flash.warnings.join(""), /flash/);
  assert.equal(validateRuntimeConfig({ GEMINI_MODEL: "gemini-3.7-flash" }).valid, false);
  assert.equal(validateRuntimeConfig({ GEMINI_MODEL: "google/gemini-3.7-flash" }).valid, true);
  assert.equal(validateRuntimeConfig({ LIVE_TRADING_ENABLED: "yes" }).valid, false);
});
