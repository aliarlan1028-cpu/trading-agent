import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "exec-sizing-"));
const { computePositionSize } = await import("../server/executionEngine.mjs");

function db(equity, ceilingPct) {
  return {
    portfolio: { totalEquityUsdt: equity },
    grayReleasePolicies: [{ enabled: true, maxNotionalUsdt: 200 }],
    mandates: [{ id: "m1", status: "active", maxSingleTradeRiskPct: ceilingPct, allowedSymbols: ["ADA/USDT"] }]
  };
}
// ADA-like:入场0.1575,止损0.161 → 止损距离0.0035
const plan = { symbol: "ADA/USDT", entry_range: [0.1565, 0.1585], stop_loss: 0.161, mandateId: "m1" };

test("小账户自动放大到最小名义额,封顶在风险上限内", () => {
  // 10U账户+1%风险→仓位~4.5U<5U;上限15%足够,自动放大到5U
  const r = computePositionSize({ ...db(10, 15) }, { ...plan, max_loss_pct: 1 });
  assert.ok(!r.error, `不该拒:${r.error}`);
  assert.ok(Math.abs(r.notional - 5) < 0.5, `名义额应≈5, 实际${r.notional}`);
  assert.match(r.sizedBy, /min_notional_scaled/);
});

test("风险上限太低无法放大到最小额→如实拒", () => {
  // 上限仅0.5%,放大到5U所需风险超上限→拒
  const r = computePositionSize({ ...db(10, 0.5) }, { ...plan, max_loss_pct: 0.3 });
  assert.equal(r.error, "below_min_notional");
});

test("账户够大→正常按风险%定仓,不触发放大", () => {
  const r = computePositionSize({ ...db(1000, 15) }, { ...plan, max_loss_pct: 1 });
  assert.ok(!r.error);
  assert.ok(r.notional > 5);
  assert.ok(!String(r.sizedBy).includes("min_notional_scaled"));
});
