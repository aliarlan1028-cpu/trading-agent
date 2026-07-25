import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "execution-safety-"));
delete process.env.BINANCE_API_KEY;
delete process.env.BINANCE_API_SECRET;

const { closeExecution, executeApprovedPlan } = await import("../server/executionEngine.mjs");

function dbFixture() {
  const mandate = {
    id: "m1",
    version: 1,
    status: "active",
    allowedSymbols: ["BTC/USDT"],
    marketTypes: ["perpetual_usdt"],
    strategies: ["trend"],
    allowedActions: ["open", "cancel", "close"],
    validUntil: "2099-01-01T00:00:00.000Z",
    maxLeverage: 3,
    maxSingleTradeRiskPct: 1
  };
  const plan = {
    id: `plan-${Math.random()}`,
    status: "approved",
    lastRiskCheck: { passed: true },
    mandateId: "m1",
    mandateVersion: 1,
    exchange: "BINANCE",
    symbol: "BTC/USDT",
    marketType: "perpetual_usdt",
    strategy: "trend",
    direction: "long",
    leverage: 2,
    stopLoss: 95,
    takeProfit: [110],
    entry_range: [100, 100],
    entry: { riskPercent: 0.5 },
    agentRunId: "run-1",
    analysisBundleId: "analysis-1"
  };
  return {
    system: { liveTradingEnabled: false, killSwitch: false, remainingDailyLossUsdt: null },
    portfolio: { totalEquityUsdt: null, availableMarginUsdt: null, weekPnl: 0 },
    fills: [],
    markets: [{ symbol: "BTC/USDT", fundingRate: 0.01, spreadBps: 2, microSyncedAt: new Date().toISOString(), changePct: 1 }],
    events: [],
    positions: [],
    tradePlans: [plan],
    mandates: [mandate],
    grayReleasePolicies: [{ id: "gray", enabled: true, maxNotionalUsdt: 50 }],
    executionOrders: [],
    riskChecks: [],
    riskRules: [],
    riskIncidents: [],
    auditLogs: [],
    traces: [],
    meta: {},
    apiKeyMetadata: [{ exchange: "BINANCE", withdrawPermission: false, permissionVerifiedAt: new Date().toISOString() }],
    orders: [],
    paperSessions: []
  };
}

test("approved plans remain dry-run when live trading is disabled", async () => {
  const db = dbFixture();
  const result = await executeApprovedPlan(db, db.tradePlans[0].id, { manualApproval: true });
  assert.equal(result.status, "dry_run");
  assert.equal(result.executionOrder.status, "dry_run");
  assert.equal(db.orders.length, 0);
});

test("missing exchange credentials never produce a false local cancellation", async () => {
  const db = dbFixture();
  db.system.killSwitch = true;
  db.executionOrders.push({
    id: "exec-pending",
    status: "entry_pending",
    exchange: "BINANCE",
    symbol: "BTC/USDT",
    clientOrderId: "entry-1",
    agentRunId: "run-1",
    analysisBundleId: "analysis-1",
    planId: db.tradePlans[0].id,
    riskCheckId: "risk-1",
    mandateId: "m1",
    events: []
  });
  const result = await closeExecution(db, "exec-pending", "kill_switch");
  assert.equal(result.status, "cancel_unconfirmed");
  assert.equal(db.executionOrders[0].status, "entry_pending");
});
