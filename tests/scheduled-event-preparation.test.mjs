import assert from "node:assert/strict";
import test from "node:test";

import { prepareScheduledEventMilestones } from "../server/scheduledEvents.mjs";

function fixture(due) {
  return {
    system: {}, notifications: [], auditLogs: [],
    events: [{
      id: "event_fomc", scheduled: true, title: "FOMC 利率决议", due: new Date(due).toISOString(),
      impact: 85, source: "Federal Reserve", sourceLink: "https://federalreserve.gov/",
      relatedSymbols: ["BTC/USDT", "ETH/USDT"]
    }]
  };
}

test("高影响日程在 T-24/T-90/T+2 分阶段且幂等准备", () => {
  const base = Date.UTC(2026, 7, 9, 0, 0, 0);
  const due = base + 20 * 60 * 60_000;
  const db = fixture(due);
  const t24 = prepareScheduledEventMilestones(db, base);
  assert.deepEqual(t24.reached.map((item) => item.stage), ["T24"]);
  assert.equal(t24.wakeSignals.length, 0);

  const t90 = prepareScheduledEventMilestones(db, due - 60 * 60_000);
  assert.deepEqual(t90.reached.map((item) => item.stage), ["T90"]);
  assert.equal(t90.wakeSignals[0].mayTriggerTradeDirectly, false);
  assert.equal(db.system.pendingNewsSignals.length, 1);

  assert.equal(prepareScheduledEventMilestones(db, due - 30 * 60_000).reached.length, 0);
  const post = prepareScheduledEventMilestones(db, due + 3 * 60_000);
  assert.deepEqual(post.reached.map((item) => item.stage), ["POST2"]);
  assert.equal(db.system.pendingNewsSignals.length, 2);
  assert.match(post.wakeSignals[0].summary, /核验实际结果/);
});
