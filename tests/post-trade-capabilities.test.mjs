import assert from "node:assert/strict";
import test from "node:test";

import { recordPostTradeCapabilities } from "../server/postTradeCapabilities.mjs";
import { financiallyReconciledFills, reconciledFill } from "./financial-fixtures.mjs";

function closedFill(index, strategy = "trend") {
  return reconciledFill({ id: `fill-${index}`, kind: "close", executionOrderId: `exec-${index}`, strategy, symbol: "BTC/USDT", realizedPnl: index % 2 ? 2 : -1, slippageBps: 1 + index / 10, createdAt: new Date(2026, 0, index + 1).toISOString() });
}

test("每次平仓自动记录执行质量，达到二十个同策略样本后启动漂移检测", () => {
  const db = { meta: {}, fills: [], executionOrders: [], toolExecutions: [], toolCallStats: {} };
  for (let index = 0; index < 19; index += 1) db.fills.unshift(closedFill(index));
  const twentieth = closedFill(19);
  db.fills.unshift(twentieth);
  db.fills = financiallyReconciledFills(db.fills);
  const result = recordPostTradeCapabilities(db, twentieth);
  assert.deepEqual(result.recorded, ["execution_quality", "strategy_drift"]);
  assert.equal(db.toolCallStats.execution_quality.sourceCalls.system, 1);
  assert.equal(db.toolCallStats.strategy_drift.sourceCalls.system, 1);
  assert.equal(result.driftResult.diagnosis.trades, 20);
  const duplicate = recordPostTradeCapabilities(db, twentieth);
  assert.equal(duplicate.skipped, "already_recorded");
  assert.equal(db.toolCallStats.execution_quality.calls, 1);
});

test("样本未满二十笔时不制造漂移调用量", () => {
  const db = { meta: {}, fills: [], executionOrders: [], toolExecutions: [], toolCallStats: {} };
  const fill = closedFill(1);
  db.fills.push(fill);
  db.fills = financiallyReconciledFills(db.fills);
  const result = recordPostTradeCapabilities(db, fill);
  assert.deepEqual(result.recorded, ["execution_quality"]);
  assert.equal(db.toolCallStats.strategy_drift, undefined);
});
