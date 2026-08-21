import test from "node:test";
import assert from "node:assert/strict";
import { computeBehaviorProfile, buildClosedTrades } from "../server/behaviorProfile.mjs";
import { financiallyReconciledFills, installSystemTradeProvenance, reconciledFill } from "./financial-fixtures.mjs";
import { addSystemExecution, stampFixtureSystemAttribution } from "./helpers/system-trade-fixtures.mjs";

// 合成:盈利单=低杠杆短持仓,亏损单=高杠杆长持仓 → 应触发"越亏越加杠杆"+"拿不住盈利单"。
const T = (id, dir, pnl, lev, entryIso, closeIso, lossAttr) => ({
  entry: reconciledFill({ kind: "entry", planId: id, executionOrderId: id, symbol: "BTC/USDT", direction: dir, notionalUsdt: 100, createdAt: entryIso }),
  close: reconciledFill({ kind: "close", planId: id, executionOrderId: id, symbol: "BTC/USDT", direction: dir, realizedPnl: pnl, notionalUsdt: 100, regime: dir === "long" ? "趋势" : "震荡", lossAttribution: lossAttr || null, createdAt: closeIso }),
  plan: { id, symbol: "BTC/USDT", direction: dir, leverage: lev }
});
const rows = [
  T("t1", "long", 10, 5, "2026-08-01T10:00:00Z", "2026-08-01T10:30:00Z"),
  T("t2", "long", 8, 6, "2026-08-01T11:00:00Z", "2026-08-01T11:30:00Z"),
  T("t3", "short", -15, 12, "2026-08-01T12:00:00Z", "2026-08-01T15:00:00Z", "策略"),
  T("t4", "short", -12, 15, "2026-08-01T13:00:00Z", "2026-08-01T16:20:00Z", "市场异常")
];
const db = { fills: rows.flatMap((r) => [r.entry, r.close]), tradePlans: rows.map((r) => r.plan) };
installSystemTradeProvenance(db);

test("抽取每笔平仓交易:join plan 取杠杆、时间差算持仓时长、算 ROI", () => {
  const trades = buildClosedTrades(db);
  assert.equal(trades.length, 4);
  const t1 = trades.find((t) => t.pnl === 10);
  assert.equal(t1.leverage, 5, "杠杆来自 plan");
  assert.equal(t1.holdMinutes, 30, "持仓时长=平仓-入场时间差");
  assert.ok(Math.abs(t1.roiPct - (10 / (100 / 5)) * 100) < 1e-6, "ROI=pnl÷保证金");
  assert.equal(t1.win, true);
});

test("总体指标:胜率/盈亏比/期望值", () => {
  const p = computeBehaviorProfile(db);
  assert.equal(p.trades, 4);
  assert.equal(p.overall.winRatePct, 50);
  assert.ok(Math.abs(p.overall.profitFactor - 18 / 27) < 0.01, "PF=毛盈18/毛亏27");
  assert.equal(p.overall.expectancyUsdt, Number(((10 + 8 - 15 - 12) / 4).toFixed(2)));
  const point = p.scatter.find((item) => item.pnl === 10);
  assert.equal(point.direction, "long", "诊断点透传真实方向");
  assert.equal(point.pnl, 10, "诊断点透传真实已实现盈亏");
  assert.equal(point.closedAt, "2026-08-01T10:30:00Z", "诊断点透传真实平仓时间");
  assert.equal(point.regime, "趋势", "诊断点与绩效拆解使用同一市场状态事实");
});

test("致命习惯告警:越亏越加杠杆 + 拿不住盈利单", () => {
  const p = computeBehaviorProfile(db);
  const keys = p.flags.map((f) => f.key);
  assert.ok(keys.includes("gambler_leverage"), "亏损单均杠杆13.5>盈利单5.5*1.2 应告警");
  assert.ok(keys.includes("cant_hold_winners"), "盈利单持仓30m<亏损单190m*0.7 应告警");
});

test("按方向拆解:做多全胜、做空全亏", () => {
  const p = computeBehaviorProfile(db);
  assert.equal(p.byDirection.long.winRatePct, 100);
  assert.equal(p.byDirection.short.winRatePct, 0);
});

test("亏损归因分布 + 空数据不崩", () => {
  const p = computeBehaviorProfile(db);
  assert.equal(p.lossAttribution["策略"], 1);
  assert.equal(p.lossAttribution["市场异常"], 1);
  assert.equal(computeBehaviorProfile({ fills: [], tradePlans: [] }).trades, 0);
});

test("部分平仓按一个交易生命周期进入行为画像", () => {
  const partialDb = {
    tradePlans: [{ id: "p1", leverage: 5 }],
    fills: financiallyReconciledFills([
      { id: "in", kind: "entry", executionOrderId: "e1", tradePlanId: "p1", createdAt: "2026-08-01T00:00:00Z" },
      { id: "p", kind: "close", executionOrderId: "e1", tradePlanId: "p1", partial: true, symbol: "BTC/USDT", direction: "long", realizedPnl: 3, notionalUsdt: 40, createdAt: "2026-08-01T01:00:00Z" },
      { id: "f", kind: "close", executionOrderId: "e1", tradePlanId: "p1", symbol: "BTC/USDT", direction: "long", realizedPnl: -1, notionalUsdt: 60, createdAt: "2026-08-01T02:00:00Z" }
    ])
  };
  installSystemTradeProvenance(partialDb);
  const trades = buildClosedTrades(partialDb);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].pnl, 2);
  assert.equal(computeBehaviorProfile(partialDb).overall.winRatePct, 100);
});

test("行为画像使用成本后净值，毛盈利被费用翻转时归为亏损", () => {
  const feeFlip = {
    tradePlans: [{ id: "fee-plan", leverage: 2 }],
    fills: financiallyReconciledFills([
      { id: "fee-entry", kind: "entry", executionOrderId: "fee-exec", tradePlanId: "fee-plan", feeUsdt: 0.8, notionalUsdt: 100, createdAt: "2026-08-01T00:00:00Z" },
      { id: "fee-close", kind: "close", executionOrderId: "fee-exec", tradePlanId: "fee-plan", symbol: "BTC/USDT", realizedPnl: 1, feeUsdt: 0.4, notionalUsdt: 100, createdAt: "2026-08-01T01:00:00Z" }
    ])
  };
  installSystemTradeProvenance(feeFlip);
  const [trade] = buildClosedTrades(feeFlip);
  assert.equal(trade.grossPnl, 1);
  assert.ok(Math.abs(trade.pnl + 0.2) < 1e-9);
  assert.equal(trade.win, false);
  assert.ok(trade.roiPct < 0);
  assert.equal(computeBehaviorProfile(feeFlip).overall.winRatePct, 0);
});

test("pending raw entry cannot change a system trade's behavior ROI basis", () => {
  const db = { fills: [] };
  const execution = addSystemExecution(db, { executionOrderId: "roi-exec", planId: "roi-plan", quantity: 1 });
  execution.leverage = 2;
  db.fills = [
    reconciledFill(stampFixtureSystemAttribution({ id: "roi-entry", kind: "entry", symbol: "BTC/USDT", direction: "long", quantity: 1, price: 100, notionalUsdt: 100, createdAt: "2026-08-01T00:00:00Z" }, execution)),
    reconciledFill(stampFixtureSystemAttribution({ id: "roi-close", kind: "close", symbol: "BTC/USDT", direction: "long", quantity: 1, price: 110, realizedPnl: 10, createdAt: "2026-08-01T01:00:00Z" }, execution)),
    reconciledFill({ id: "roi-pending-entry", kind: "entry", executionOrderId: execution.id, planId: execution.planId, symbol: "BTC/USDT", direction: "long", quantity: 1, price: 100, notionalUsdt: 10000, createdAt: "2026-08-01T00:30:00Z", tradeAttribution: { schemaVersion: 1, scope: "attribution_pending", origin: "external_exchange", reason: "mixed_position_attribution" } })
  ];
  const [trade] = buildClosedTrades(db);
  assert.equal(trade.roiPct, 20);
});
