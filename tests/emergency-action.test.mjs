import assert from "node:assert/strict";
import test from "node:test";
import { validateWriteGuard } from "../server/tradeActions.mjs";

process.env.REQUIRE_AUDIT_CHAIN_OK = "false";

const db = { system: { killSwitch: true, liveTradingEnabled: false }, mandates: [], auditLogs: [] };

test("EmergencyAction 可在熔断状态独立撤单/平仓", () => {
  const cancel = validateWriteGuard(db, "cancel_order", {
    exchange: "OKX", symbol: "BTC/USDT", clientOrderId: "entry123", emergencyActionId: "emergency_recovery_1"
  });
  assert.equal(cancel.allowed, true);
  assert.equal(cancel.riskReducing, true);

  const close = validateWriteGuard(db, "close_position", {
    exchange: "OKX", symbol: "BTC/USDT", closePosition: true, emergencyActionId: "emergency_liq_1"
  });
  assert.equal(close.allowed, true);
});

test("伪造或缺失 EmergencyAction 不能绕过来源链，也不能用于开仓", () => {
  const missing = validateWriteGuard(db, "close_position", { exchange: "OKX", symbol: "BTC/USDT", closePosition: true });
  assert.equal(missing.reason, "missing_execution_provenance");

  const entryDb = {
    system: { killSwitch: false, liveTradingEnabled: true, realTradingAck: true, orderWriteEnabled: true },
    apiKeyMetadata: [{ exchange: "OKX", withdrawPermission: false, permissionVerifiedAt: new Date().toISOString() }],
    auditLogs: [], mandates: []
  };
  const entry = validateWriteGuard(entryDb, "place_order", {
    exchange: "OKX", marketType: "perpetual_usdt", symbol: "BTC/USDT", side: "BUY", price: 100,
    quantity: 1, stopLoss: 95, emergencyActionId: "emergency_fake"
  });
  assert.equal(entry.reason, "missing_execution_provenance");
});
