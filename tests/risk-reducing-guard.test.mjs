import test from "node:test";
import assert from "node:assert/strict";
import { classifyAuthoritativeRiskReduction, validateWriteGuard } from "../server/tradeActions.mjs";
import { currentOkxCredentialFingerprint, normalizeOkxSnapshotPositions } from "../server/exchangeConnector.mjs";

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

test("kill switch and disabled entry gates do not block an authoritatively verified entry cancellation", () => {
  const previous = process.env.OKX_API_KEY;
  process.env.OKX_API_KEY = "risk-reduction-test-key";
  const db = baseDb();
  db.apiKeyMetadata = [];
  const fingerprint = currentOkxCredentialFingerprint();
  db.exchangeAccounts = [{ id: "acc1", exchange: "OKX", readEnabled: true, tradeEnabled: true, apiKeyFingerprint: fingerprint }];
  db.accountSnapshots = [{
    id: "snap1", accountId: "acc1", exchange: "OKX", status: "ok", apiKeyFingerprint: fingerprint,
    createdAt: new Date().toISOString(), positions: [], algoOrders: [], algoOrdersComplete: true,
    openOrdersComplete: true, openOrders: [{ instId: "BTC-USDT-SWAP", clOrdId: "entry1", reduceOnly: false }]
  }];
  try {
    const result = validateWriteGuard(db, "cancel_order", { ...provenance, accountId: "acc1" });
    assert.equal(result.allowed, true);
    assert.equal(result.riskReducing, true);
  } finally {
    if (previous === undefined) delete process.env.OKX_API_KEY; else process.env.OKX_API_KEY = previous;
  }
});

test("normalized OKX snapshot preserves net short sign and contract-to-coin units", async () => {
  const rows = await normalizeOkxSnapshotPositions([
    { instId: "BTC-USDT-SWAP", posSide: "net", pos: "-2" },
    { instId: "ETH-USDT-SWAP", posSide: "net", pos: "3" },
    { instId: "SOL-USDT-SWAP", posSide: "short", pos: "4" }
  ], { resolveContractValue: async () => 0.01 });
  assert.deepEqual(rows.map((row) => [row.canonicalDirection, row.contractSize, row.coinSize, row.positionQuantityComplete]), [
    ["short", 2, 0.02, true], ["long", 3, 0.03, true], ["short", 4, 0.04, true]
  ]);
});

test("net-mode shorts can close without coin quantity while TP remains unit checked", () => {
  const previous = process.env.OKX_API_KEY;
  process.env.OKX_API_KEY = "risk-reduction-position-test-key";
  const fingerprint = currentOkxCredentialFingerprint();
  const snapshot = {
    id: "snap2", accountId: "acc1", exchange: "OKX", status: "ok", apiKeyFingerprint: fingerprint,
    createdAt: new Date().toISOString(), openOrders: [], algoOrders: [], openOrdersComplete: true, algoOrdersComplete: true,
    positions: [{ instId: "BTC-USDT-SWAP", posSide: "net", pos: "-2", rawSignedPosition: -2, canonicalDirection: "short", coinSize: null }]
  };
  const db = { ...baseDb(), exchangeAccounts: [{ id: "acc1", exchange: "OKX", readEnabled: true, tradeEnabled: true, apiKeyFingerprint: fingerprint }], accountSnapshots: [snapshot] };
  try {
    const close = classifyAuthoritativeRiskReduction(db, "close_position", { accountId: "acc1", symbol: "BTC/USDT", positionSide: "short" });
    assert.equal(close.riskReducing, true);
    assert.equal(close.positionQuantity, null);
    const tpUnknown = classifyAuthoritativeRiskReduction(db, "take_profit", {
      accountId: "acc1", symbol: "BTC/USDT", positionSide: "short", targets: [{ side: "buy", posSide: "short", quantity: 0.01 }]
    });
    assert.equal(tpUnknown.reason, "authoritative_position_quantity_unavailable");
    snapshot.positions[0].ctVal = 0.01;
    snapshot.positions[0].coinSize = 0.02;
    const tp = classifyAuthoritativeRiskReduction(db, "take_profit", {
      accountId: "acc1", symbol: "BTC/USDT", positionSide: "short", targets: [{ side: "buy", posSide: "short", quantity: 0.02 }]
    });
    assert.equal(tp.riskReducing, true);
    const reverse = classifyAuthoritativeRiskReduction(db, "take_profit", {
      accountId: "acc1", symbol: "BTC/USDT", positionSide: "short", targets: [{ side: "sell", posSide: "short", quantity: 0.01 }]
    });
    assert.equal(reverse.reason, "take_profit_direction_override");
    const oversize = classifyAuthoritativeRiskReduction(db, "take_profit", {
      accountId: "acc1", symbol: "BTC/USDT", positionSide: "short", targets: [{ side: "buy", posSide: "short", quantity: 0.03 }]
    });
    assert.equal(oversize.reason, "reduce_quantity_exceeds_position");
  } finally {
    if (previous === undefined) delete process.env.OKX_API_KEY; else process.env.OKX_API_KEY = previous;
  }
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
