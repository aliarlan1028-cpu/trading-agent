import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "cancel-idem-"));
process.env.OKX_API_KEY = "cancel-idempotency-test-key";
delete process.env.OKX_API_SECRET;
delete process.env.OKX_API_PASSPHRASE;
const apiKeyFingerprint = crypto.createHash("sha256").update(process.env.OKX_API_KEY).digest("hex").slice(0, 16);

const { executeTradeAction } = await import("../server/tradeActions.mjs");
const { reserveOmsOrder } = await import("../server/store.mjs");

function dbFixture(entryClientOrderId = null) {
  return {
    system: { liveTradingEnabled: true, realTradingAck: true, orderWriteEnabled: true, killSwitch: false },
    orders: [],
    mandates: [],
    riskIncidents: [],
    auditLogs: [],
    traces: [],
    executionOrders: entryClientOrderId ? [{
      id: "exec-entry", status: "entry_pending", exchange: "OKX", symbol: "BTC/USDT",
      exchangeOrderId: "77001", clientOrderId: entryClientOrderId
    }] : [],
    exchangeAccounts: [{
      id: "okx-main", exchange: "OKX", readEnabled: true, tradeEnabled: true, apiKeyFingerprint
    }],
    accountSnapshots: [{
      id: "snapshot-current", accountId: "okx-main", apiKeyFingerprint,
      exchange: "OKX", status: "ok", createdAt: new Date().toISOString(),
      positions: [], openOrdersComplete: true, algoOrdersComplete: true, algoOrders: [],
      openOrders: entryClientOrderId ? [{
        ordId: "77001", clOrdId: entryClientOrderId, instId: "BTC-USDT-SWAP", reduceOnly: false, state: "live"
      }] : []
    }],
    meta: {}
  };
}

test("cancel_order must not collide with the entry order's idempotency reservation", async () => {
  const entryCoid = "execregress0001";
  const db = dbFixture(entryCoid);
  // 模拟入场单已占用该 clientOrderId 的 OMS 预留（与实际执行路径一致）
  const entry = reserveOmsOrder({
    exchange: "OKX",
    clientOrderId: entryCoid,
    action: "place_order",
    payload: { symbol: "BTC/USDT", side: "BUY", type: "LIMIT", price: 100, quantity: 1, clientOrderId: entryCoid }
  });
  assert.equal(entry.status, "reserved");

  // 保护失败/手动撤单路径：撤单复用入场 coid（交易所 origClientOrderId 语义）。
  // 修复前：预留键相同、payload 不同 → 被误判 idempotency_payload_conflict 而 blocked。
  const cancel = await executeTradeAction(db, "cancel_order", {
    exchange: "OKX",
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

  // 明确拒绝（缺凭证）后重试必须真实重试并再次如实失败，不能包装成假 ACK。
  const retry = await executeTradeAction(db, "cancel_order", {
    exchange: "OKX",
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
  assert.equal(retry.status, "missing_credentials");
  assert.notEqual(retry.status, "idempotent_replay");
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
