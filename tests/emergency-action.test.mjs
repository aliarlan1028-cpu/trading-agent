import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { validateWriteGuard } from "../server/tradeActions.mjs";

process.env.REQUIRE_AUDIT_CHAIN_OK = "false";
process.env.OKX_API_KEY = "emergency-action-test-key";
const apiKeyFingerprint = crypto.createHash("sha256").update(process.env.OKX_API_KEY).digest("hex").slice(0, 16);

const db = {
  system: { killSwitch: true, liveTradingEnabled: false }, mandates: [], auditLogs: [], executionOrders: [],
  exchangeAccounts: [{ id: "okx-main", exchange: "OKX", readEnabled: true, tradeEnabled: true, apiKeyFingerprint }],
  accountSnapshots: [{
    id: "snapshot-current", accountId: "okx-main", apiKeyFingerprint,
    exchange: "OKX", status: "ok", createdAt: new Date().toISOString(),
    openOrdersComplete: true, algoOrdersComplete: true, algoOrders: [],
    openOrders: [{ ordId: "entry-order-1", clOrdId: "entry123", instId: "BTC-USDT-SWAP", reduceOnly: false, state: "live" }],
    positions: [{ instId: "BTC-USDT-SWAP", posSide: "long", pos: "1", ctVal: "0.01", coinSize: 0.01 }]
  }]
};

test("EmergencyAction 可在熔断状态独立撤单/平仓", () => {
  const cancel = validateWriteGuard(db, "cancel_order", {
    exchange: "OKX", symbol: "BTC/USDT", orderId: "entry-order-1", clientOrderId: "entry123", emergencyActionId: "emergency_recovery_1"
  });
  assert.equal(cancel.allowed, true);
  assert.equal(cancel.riskReducing, true);

  const close = validateWriteGuard(db, "close_position", {
    exchange: "OKX", symbol: "BTC/USDT", positionSide: "long", closePosition: true, emergencyActionId: "emergency_liq_1"
  });
  assert.equal(close.allowed, true);
});

test("伪造或缺失 EmergencyAction 不能绕过来源链，也不能用于开仓", () => {
  const missing = validateWriteGuard(db, "close_position", { exchange: "OKX", symbol: "BTC/USDT", positionSide: "long", closePosition: true });
  assert.equal(missing.reason, "missing_execution_provenance");

  const entryDb = {
    system: { killSwitch: false, liveTradingEnabled: true, realTradingAck: true, orderWriteEnabled: true },
    apiKeyMetadata: [{ exchange: "OKX", withdrawPermission: false, permissionVerifiedAt: new Date().toISOString() }],
    auditLogs: [], mandates: [],
    exchangeAccounts: [{ id: "okx-main", exchange: "OKX", readEnabled: true, tradeEnabled: true, apiKeyFingerprint }],
    accountSnapshots: [{ id: "entry-snapshot", accountId: "okx-main", apiKeyFingerprint, exchange: "OKX", status: "ok", createdAt: new Date().toISOString(), positions: [], openOrders: [], algoOrders: [], openOrdersComplete: true, algoOrdersComplete: true }]
  };
  const entry = validateWriteGuard(entryDb, "place_order", {
    exchange: "OKX", marketType: "perpetual_usdt", symbol: "BTC/USDT", side: "BUY", price: 100,
    quantity: 1, stopLoss: 95, emergencyActionId: "emergency_fake"
  });
  assert.equal(entry.reason, "missing_execution_provenance");
});
