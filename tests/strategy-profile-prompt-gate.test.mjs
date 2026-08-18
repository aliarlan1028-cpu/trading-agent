import assert from "node:assert/strict";
import test from "node:test";
import { validatedStrategyProfilesForPrompt } from "../server/agentChat.mjs";
import { buildBacktestResearch } from "../server/strategyResearchView.mjs";

const profile = (overrides = {}) => ({
  id: "profile-1", symbol: "BTC/USDT", timeframe: "1h", strategyId: "trend",
  label: "Trend", confidence: "validated", rollingValidation: { passed: true },
  tenantId: "tenant_owner", ownerUserId: "owner-1", ownerApproval: { status: "approved" },
  oos: { trades: 20, expectancyR: 0.2 }, ...overrides
});

test("only optimizer-validated profiles with rolling and real paper pass enter the verified prompt block", () => {
  const db = {
    user: { id: "owner-1", tenantId: "tenant_owner" },
    strategyProfiles: [
      profile(),
      profile({ id: "oos", symbol: "ADA/USDT", confidence: "oos_ok" }),
      profile({ id: "rolling-failed", symbol: "SUI/USDT", rollingValidation: { passed: false } })
    ],
    paperSessions: [
      { id: "paper", symbol: "BTC/USDT", timeframe: "1h", strategyId: "trend", status: "passed", seeded: false }
    ]
  };
  assert.deepEqual(validatedStrategyProfilesForPrompt(db).map((row) => row.id), ["profile-1"]);
});

test("a seeded or missing paper pass is not enough for verified prompt authority", () => {
  const db = {
    user: { id: "owner-1", tenantId: "tenant_owner" },
    strategyProfiles: [profile()],
    paperSessions: [{ symbol: "BTC/USDT", timeframe: "1h", strategyId: "trend", status: "passed", seeded: true }]
  };
  assert.equal(validatedStrategyProfilesForPrompt(db).length, 0);
});

test("an optimizer-valid profile stays out of the Agent prompt until Owner approval", () => {
  const db = {
    user: { id: "owner-1", tenantId: "tenant_owner" },
    strategyProfiles: [profile({ ownerApproval: { status: "pending" } })],
    paperSessions: [{ id: "paper", symbol: "BTC/USDT", timeframe: "1h", strategyId: "trend", status: "passed", seeded: false }]
  };
  assert.equal(validatedStrategyProfilesForPrompt(db).length, 0);
});

test("research view does not count oos_ok as passed", () => {
  const db = { strategyProfiles: [profile({ confidence: "oos_ok" })], paperSessions: [], backtests: [], strategyStudioBacktests: [] };
  const report = buildBacktestResearch(db);
  const optimizer = report.historical.find((row) => row.evidenceType === "optimizer_oos");
  assert.ok(optimizer);
  assert.equal(optimizer.passed, false);
});
