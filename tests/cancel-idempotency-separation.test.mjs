import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "cancel-idem-"));
delete process.env.BINANCE_API_KEY;
delete process.env.BINANCE_API_SECRET;

const { executeTradeAction } = await import("../server/tradeActions.mjs");
const { reserveOmsOrder } = await import("../server/store.mjs");

function dbFixture() {
  return {
    system: { liveTradingEnabled: true, realTradingAck: true, orderWriteEnabled: true, killSwitch: false },
    orders: [],
    mandates: [],
    riskIncidents: [],
    auditLogs: [],
    traces: [],
    meta: {}
  };
}

test("cancel_order must not collide with the entry order's idempotency reservation", async () => {
  const db = dbFixture();
  const entryCoid = "exec_regress0001";
  // 模拟入场单已占用该 clientOrderId 的 OMS 预留（与实际执行路径一致）
  const entry = reserveOmsOrder({
    exchange: "BINANCE",
    clientOrderId: entryCoid,
    action: "place_order",
    payload: { symbol: "BTC/USDT", side: "BUY", type: "LIMIT", price: 100, quantity: 1, clientOrderId: entryCoid }
  });
  assert.equal(entry.status, "reserved");

  // 保护失败/手动撤单路径：撤单复用入场 coid（交易所 origClientOrderId 语义）。
  // 修复前：预留键相同、payload 不同 → 被误判 idempotency_payload_conflict 而 blocked。
  const cancel = await executeTradeAction(db, "cancel_order", {
    exchange: "BINANCE",
    marketType: "perpetual_usdt",
    symbol: "BTC/USDT",
    orderId: "77001",
    clientOrderId: entryCoid,
    agentRunId: "run1",
    analysisBundleId: "ab1",
    tradePlanId: "plan1",
    riskCheckId: "rc1",
    mandateId: "m1",
    manualApproval: true
  });
  assert.notEqual(cancel.status, "blocked", `cancel was blocked: ${cancel.reason}`);
  assert.notEqual(cancel.reason, "idempotency_payload_conflict");
  // 无凭证环境下应走到交易所调用层并如实返回 missing_credentials（而不是被幂等闸拦截）
  assert.equal(cancel.status, "missing_credentials");

  // 同一撤单重试仍应幂等（派生键 cancel_order:<coid> 命中 replay，不产生第二次预留）
  const retry = await executeTradeAction(db, "cancel_order", {
    exchange: "BINANCE",
    marketType: "perpetual_usdt",
    symbol: "BTC/USDT",
    orderId: "77001",
    clientOrderId: entryCoid,
    agentRunId: "run1",
    analysisBundleId: "ab1",
    tradePlanId: "plan1",
    riskCheckId: "rc1",
    mandateId: "m1",
    manualApproval: true
  });
  assert.equal(retry.status, "idempotent_replay");
});

test("protection_failed plans are locked out of auto re-execution", async () => {
  const { executeApprovedPlan } = await import("../server/executionEngine.mjs");
  const db = dbFixture();
  db.tradePlans = [{ id: "plan-locked", status: "protection_failed", lastRiskCheck: { passed: true } }];
  db.executionOrders = [];
  const result = await executeApprovedPlan(db, "plan-locked", {});
  assert.equal(result.status, "plan_not_approved");
  assert.equal(result.planStatus, "protection_failed");
});
