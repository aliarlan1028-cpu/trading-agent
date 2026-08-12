import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "exec-sizing-"));
const { computePositionSize } = await import("../server/executionEngine.mjs");
const { accountMarginCapacity } = await import("../server/tradingCapacity.mjs");

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

test("仓位模式先按授权单笔名义额裁剪，不会在写单前因 53.2U > 50U 整笔拒绝", () => {
  const state = db(34.0463, 10);
  state.mandates[0] = {
    ...state.mandates[0],
    positionPct: 50,
    maxOrderNotionalUsdt: 50,
    maxSymbolNotionalUsdt: 100,
    maxPortfolioNotionalUsdt: 200
  };
  state.markets = [];
  state.positions = [];
  const sui = { symbol: "SUI/USDT", direction: "short", leverage: 10, entry_range: [0.698, 0.702], stop_loss: 0.7075, mandateId: "m1", max_loss_pct: 10 };
  state.mandates[0].allowedSymbols = ["SUI/USDT"];
  const r = computePositionSize(state, sui);
  assert.ok(!r.error, JSON.stringify(r));
  assert.ok(r.notional <= 50, `名义额不得超过授权上限，实际 ${r.notional}`);
  assert.equal(r.quantity, 71);
  assert.match(r.sizedBy, /mandate_capped/);
});

test("授权币种或组合剩余额度比单笔上限更小时采用最小剩余额度", () => {
  const state = db(100, 10);
  state.mandates[0] = {
    ...state.mandates[0],
    positionPct: 50,
    maxOrderNotionalUsdt: 50,
    maxSymbolNotionalUsdt: 60,
    maxPortfolioNotionalUsdt: 200
  };
  state.positions = [{ symbol: "ADA/USDT", direction: "long", size: 200, mark: 0.25, notionalUsdt: 50, source: "exchange_rest" }];
  const r = computePositionSize(state, { ...plan, leverage: 10, max_loss_pct: 10 });
  assert.ok(!r.error, JSON.stringify(r));
  assert.ok(r.notional <= 10, `币种剩余额度仅 10U，实际 ${r.notional}`);
});

test("实盘定仓受真实可用保证金和成交后保证金使用率硬约束", () => {
  const state = db(34, 10);
  state.system = { liveTradingEnabled: true };
  state.accountSnapshots = [{
    id: "snap-live", exchange: "OKX", status: "ok", createdAt: new Date().toISOString(),
    balances: [{ totalEq: "34", details: [{ ccy: "USDT", availEq: "12" }] }]
  }];
  state.mandates[0] = {
    ...state.mandates[0], allowedSymbols: ["SUI/USDT"], positionPct: 50,
    maxOrderNotionalUsdt: 50, maxSymbolNotionalUsdt: 100, maxPortfolioNotionalUsdt: 200,
    maxMarginUtilizationPct: 70
  };
  state.positions = [];
  state.executionOrders = [];
  const r = computePositionSize(state, { symbol: "SUI/USDT", direction: "long", leverage: 5, entry_range: [1, 1], stop_loss: 0.9, mandateId: "m1", max_loss_pct: 10 });
  assert.ok(!r.error, JSON.stringify(r));
  assert.ok(r.notional <= 8.96, `成交后70%使用率上限只剩1.8U空间，5x并预留费用后名义额不应超过约8.95U，实际 ${r.notional}`);
  assert.ok(r.projectedMargin.projectedUtilizationPct <= 70 + 1e-9);
  assert.match(r.sizedBy, /available_margin_capped/);
});

test("实盘账户快照过期时拒绝定仓，不回退到本地余额猜测", () => {
  const state = db(34, 10);
  state.system = { liveTradingEnabled: true };
  state.accountSnapshots = [{
    id: "snap-stale", exchange: "OKX", status: "ok", createdAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    balances: [{ totalEq: "34", details: [{ ccy: "USDT", availEq: "34" }] }]
  }];
  state.mandates[0].allowedSymbols = ["SUI/USDT"];
  const r = computePositionSize(state, { symbol: "SUI/USDT", leverage: 5, entry_range: [1, 1], stop_loss: 0.9, mandateId: "m1" });
  assert.equal(r.error, "account_snapshot_stale");
});

test("实盘拒绝明显来自未来的账户快照，避免服务器时钟异常绕过新鲜度检查", () => {
  const state = db(34, 10);
  state.system = { liveTradingEnabled: true };
  state.accountSnapshots = [{
    id: "snap-future", exchange: "OKX", status: "ok", createdAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    balances: [{ totalEq: "34", details: [{ ccy: "USDT", availEq: "34" }] }]
  }];
  state.mandates[0].allowedSymbols = ["SUI/USDT"];
  const r = computePositionSize(state, { symbol: "SUI/USDT", leverage: 5, entry_range: [1, 1], stop_loss: 0.9, mandateId: "m1" });
  assert.equal(r.error, "account_snapshot_time_invalid");
});

test("旧在途单缺少创建时间或名义字段时仍保守预留保证金", () => {
  const state = db(100, 10);
  state.system = { liveTradingEnabled: true };
  state.accountSnapshots = [{
    id: "snap-current", exchange: "OKX", status: "ok", createdAt: new Date().toISOString(),
    balances: [{ totalEq: "100", details: [{ ccy: "USDT", availEq: "100" }] }]
  }];
  state.executionOrders = [{ id: "legacy-pending", status: "entry_pending", symbol: "ADA/USDT", quantity: 10, entryPrice: 2, leverage: 2 }];
  const capacity = accountMarginCapacity(state, { mandate: { maxMarginUtilizationPct: 70 }, leverage: 2, live: true });
  assert.equal(capacity.ok, true);
  assert.equal(capacity.pendingMargin, 10);
  assert.equal(capacity.remainingMargin, 60);
});
