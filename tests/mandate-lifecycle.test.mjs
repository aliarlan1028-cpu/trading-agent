import assert from "node:assert/strict";
import test from "node:test";

import { transitionMandate } from "../server/mandateLifecycle.mjs";
import { evaluateTradePlan } from "../server/riskEngine.mjs";

const valid = (overrides = {}) => ({
  id: "m1", status: "draft", version: 1,
  allowedSymbols: ["BTC/USDT"],
  allowedActions: ["open", "close", "cancel", "amend", "move_stop", "take_profit"],
  maxLeverage: 5, maxLeverageBySymbol: { "BTC/USDT": 5 },
  maxSingleTradeRiskPct: 1, maxDailyLossPct: 2, maxWeeklyLossPct: 5,
  maxOrderNotionalUsdt: 50, maxSymbolNotionalUsdt: 50, maxPortfolioNotionalUsdt: 50,
  validFrom: new Date(Date.now() - 1000).toISOString(),
  validUntil: new Date(Date.now() + 86_400_000).toISOString(),
  ...overrides
});

test("legacy chat pending_confirmation drafts validate and become the single active mandate", () => {
  const old = valid({ id: "old", status: "active", version: 2 });
  const draft = valid({ id: "chat", status: "pending_confirmation" });
  const db = { mandates: [old, draft], grayReleasePolicies: [], auditLogs: [] };
  const result = transitionMandate(db, draft.id, "activate", { nowIso: () => "2026-08-15T00:00:00.000Z" });
  assert.equal(result.ok, true);
  assert.equal(draft.status, "active");
  assert.equal(old.status, "superseded");
  assert.equal(old.version, 3);
  assert.equal(db.mandates.filter((item) => item.status === "active").length, 1);
});

test("invalid mandate activation fails without a success-shaped response", () => {
  const mandate = valid({ allowedSymbols: [] });
  const db = { mandates: [mandate], grayReleasePolicies: [], auditLogs: [] };
  const result = transitionMandate(db, mandate.id, "activate");
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, "mandate_validation_failed");
  assert.equal(mandate.status, "draft");
});

test("pause and revoke advance the authorization version and keep old plans stale after reactivation", () => {
  const mandate = valid({ status: "active" });
  const db = {
    mandates: [mandate], grayReleasePolicies: [], auditLogs: [], riskChecks: [],
    system: { killSwitch: false, liveTradingEnabled: false },
    positions: [], executionOrders: [], fills: [], events: [], riskRules: [], markets: [{ symbol: "BTC/USDT", price: 100 }],
    portfolio: { totalEquityUsdt: 1000 }
  };
  const oldPlan = { id: "p1", mandateId: mandate.id, mandateVersion: 1, symbol: "BTC/USDT", direction: "long", entryLow: 100, entryHigh: 100, stopLoss: 95, leverage: 2 };
  assert.equal(transitionMandate(db, mandate.id, "pause").ok, true);
  assert.equal(mandate.version, 2);
  assert.equal(transitionMandate(db, mandate.id, "activate").ok, true);
  assert.equal(mandate.version, 2);
  const risk = evaluateTradePlan(db, oldPlan);
  assert.equal(risk.passed, false);
  assert.ok(risk.checks.some((check) => check.name === "授权版本" && check.passed === false));
  assert.equal(transitionMandate(db, mandate.id, "revoke").ok, true);
  assert.equal(mandate.version, 3);
  assert.equal(transitionMandate(db, mandate.id, "activate").error, "mandate_state_conflict");
});
