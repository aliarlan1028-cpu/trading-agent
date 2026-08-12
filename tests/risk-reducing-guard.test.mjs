import test from "node:test";
import assert from "node:assert/strict";
import { validateWriteGuard } from "../server/tradeActions.mjs";

function baseDb() {
  return {
    system: { liveTradingEnabled: false, realTradingAck: false, orderWriteEnabled: false, killSwitch: true },
    apiKeyMetadata: [{ exchange: "OKX", withdrawPermission: false, permissionVerifiedAt: new Date().toISOString() }],
    mandates: [],
    grayReleasePolicies: [],
    auditLogs: [],
    paperSessions: []
  };
}

const provenance = {
  exchange: "OKX",
  marketType: "perpetual_usdt",
  symbol: "BTC/USDT",
  clientOrderId: "entry1",
  agentRunId: "run-1",
  analysisBundleId: "analysis-1",
  tradePlanId: "plan-1",
  riskCheckId: "risk-1",
  mandateId: "mandate-1"
};

test("kill switch and disabled entry gates never block risk-reducing cancellation", () => {
  const db = baseDb();
  db.apiKeyMetadata = [];
  const result = validateWriteGuard(db, "cancel_order", provenance);
  assert.equal(result.allowed, true);
  assert.equal(result.riskReducing, true);
});

test("kill switch still blocks new entries", () => {
  const result = validateWriteGuard(baseDb(), "place_order", {
    ...provenance,
    side: "BUY",
    type: "LIMIT",
    price: 100,
    quantity: 1,
    stopLoss: 95
  });
  assert.equal(result.allowed, false);
});
