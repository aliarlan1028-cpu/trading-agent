import assert from "node:assert/strict";
import test from "node:test";

import { evaluateAgentDecisionWake, recordAgentDecisionWake } from "../server/decisionWakePolicy.mjs";

function dbFixture() {
  return {
    system: { executionMode: "full_auto", riskStatus: "normal" },
    markets: [{ symbol: "BTC/USDT", price: 60_000, changePct: 1.2, high24h: 61_000, low24h: 58_000, fundingRatePct: 0.01, spreadBps: 2, bookImbalancePct: 52, candles: [{ time: "2026-08-18T01:00:00.000Z", close: 60_000, closed: true }] }],
    marketRegime: { global: { breadthPct: 55, medianChangePct: 0.4, btcChangePct: 1.2 } },
    marketMovers: { movers: [] }, positions: []
  };
}

test("unchanged scheduled patrols stay deterministic until the maximum interval", () => {
  const db = dbFixture();
  const start = Date.parse("2026-08-18T02:00:00.000Z");
  const initial = evaluateAgentDecisionWake(db, { trigger: "scheduled_patrol", symbols: ["BTC/USDT"], now: start });
  assert.equal(initial.shouldWake, true);
  recordAgentDecisionWake(db, initial, { id: "run_1", completedAt: new Date(start).toISOString() });

  const quiet = evaluateAgentDecisionWake(db, { trigger: "scheduled_patrol", symbols: ["BTC/USDT"], now: start + 15 * 60_000 });
  assert.equal(quiet.shouldWake, false);
  assert.equal(quiet.reason, "decision_context_unchanged");

  const due = evaluateAgentDecisionWake(db, { trigger: "scheduled_patrol", symbols: ["BTC/USDT"], now: start + 61 * 60_000 });
  assert.equal(due.shouldWake, true);
  assert.equal(due.reason, "scheduled_max_interval_elapsed");
});

test("material changes are merged during cooldown and wake one later decision", () => {
  const db = dbFixture();
  const start = Date.parse("2026-08-18T02:00:00.000Z");
  const initial = evaluateAgentDecisionWake(db, { trigger: "scheduled_patrol", symbols: ["BTC/USDT"], now: start });
  recordAgentDecisionWake(db, initial, { id: "run_1", completedAt: new Date(start).toISOString() });
  db.markets[0].changePct = 4.4;

  const cooling = evaluateAgentDecisionWake(db, { trigger: "scheduled_patrol", symbols: ["BTC/USDT"], now: start + 20 * 60_000 });
  assert.equal(cooling.materialChanged, true);
  assert.equal(cooling.shouldWake, false);
  assert.equal(cooling.reason, "material_change_cooling_down");

  const ready = evaluateAgentDecisionWake(db, { trigger: "scheduled_patrol", symbols: ["BTC/USDT"], now: start + 31 * 60_000 });
  assert.equal(ready.shouldWake, true);
  assert.equal(ready.reason, "material_decision_context_changed");
});

test("watch, news and opportunity triggers always bypass scheduled cooldown", () => {
  const db = dbFixture();
  const start = Date.parse("2026-08-18T02:00:00.000Z");
  const initial = evaluateAgentDecisionWake(db, { trigger: "scheduled_patrol", symbols: ["BTC/USDT"], now: start });
  recordAgentDecisionWake(db, initial, { id: "run_1", completedAt: new Date(start).toISOString() });
  for (const trigger of ["watch_trigger", "news", "early_opportunity", "fast_move"]) {
    const result = evaluateAgentDecisionWake(db, { trigger, symbols: ["BTC/USDT"], now: start + 1000 });
    assert.equal(result.shouldWake, true, trigger);
    assert.match(result.reason, /^event_trigger:/);
  }
});

test("invalid duration configuration falls back safely and cannot suppress a due decision", () => {
  const db = dbFixture();
  const start = Date.parse("2026-08-18T02:00:00.000Z");
  const initial = evaluateAgentDecisionWake(db, { trigger: "scheduled_patrol", symbols: ["BTC/USDT"], now: start });
  recordAgentDecisionWake(db, initial, { id: "run_1", completedAt: new Date(start).toISOString() });

  const due = evaluateAgentDecisionWake(db, {
    trigger: "scheduled_patrol", symbols: ["BTC/USDT"], now: start + 24 * 60 * 60_000,
    maxIntervalMs: "invalid", materialCooldownMs: "invalid"
  });
  assert.equal(due.maxIntervalMs, 60 * 60_000);
  assert.equal(due.materialCooldownMs, 30 * 60_000);
  assert.equal(due.shouldWake, true);
  assert.equal(due.reason, "scheduled_max_interval_elapsed");
});

test("a future persisted decision time fails safe and wakes instead of freezing the scheduler", () => {
  const db = dbFixture();
  const now = Date.parse("2026-08-18T02:00:00.000Z");
  const initial = evaluateAgentDecisionWake(db, { trigger: "scheduled_patrol", symbols: ["BTC/USDT"], now });
  db.system.agentDecisionWakeState = {
    fingerprint: initial.fingerprint,
    decisionAt: "2099-01-01T00:00:00.000Z"
  };
  const result = evaluateAgentDecisionWake(db, { trigger: "scheduled_patrol", symbols: ["BTC/USDT"], now });
  assert.equal(result.shouldWake, true);
  assert.equal(result.reason, "initial_scheduled_decision");
  assert.equal(result.ageMs, null);
});
