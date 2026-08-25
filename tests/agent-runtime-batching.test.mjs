import assert from "node:assert/strict";
import test from "node:test";

import { agentDecisionRunSucceeded, newsSignalDescriptor, newsSignalSymbols, runAgentCycle, selectAgentDecisionBatch, settleAgentDecisionBatch } from "../server/agentRuntime.mjs";
import { seedDatabase } from "../server/store.mjs";

test("scheduler-owned agent cycles defer every internal database save", async () => {
  const db = seedDatabase();
  let saveCalls = 0;
  const run = await runAgentCycle(db, { deferPersistence: true }, () => { saveCalls += 1; }, {
    activeProvider: () => null,
    syncPublicMarket: async () => ({ price: 100 }),
    fetchMarketRegime: async () => ({ global: null, smartMoney: null })
  });

  assert.equal(run.status, "patrol_only");
  assert.equal(saveCalls, 0, "the scheduler must be the only persistence owner");
});

test("manually invoked agent cycles still persist before returning", async () => {
  const db = seedDatabase();
  let saveCalls = 0;
  const run = await runAgentCycle(db, {}, () => { saveCalls += 1; }, {
    activeProvider: () => null,
    syncPublicMarket: async () => ({ price: 100 }),
    fetchMarketRegime: async () => ({ global: null, smartMoney: null })
  });

  assert.equal(run.status, "patrol_only");
  assert.equal(saveCalls, 1, "manual/API cycles retain immediate durability");
});

test("fast-move batching acknowledges only the four events actually leased for deep analysis", () => {
  const moves = Array.from({ length: 6 }, (_, index) => ({
    id: `move_${index + 1}`, symbol: `C${index + 1}/USDT`, direction: "up", movePct: index + 1
  }));
  const db = { system: { pendingFastMoves: [...moves] }, watchTriggers: [] };
  const batch = selectAgentDecisionBatch({ trigger: "fast_move", fastMoves: db.system.pendingFastMoves });

  assert.deepEqual(batch.fastMoves.map((row) => row.id), ["move_1", "move_2", "move_3", "move_4"]);
  const result = settleAgentDecisionBatch(db, batch, { status: "completed" });
  assert.equal(result.acknowledged, true);
  assert.deepEqual(db.system.pendingFastMoves.map((row) => row.id), ["move_5", "move_6"]);
});

test("watch batching leases at most four symbols and a blocked closure acknowledges none", () => {
  const watches = Array.from({ length: 6 }, (_, index) => ({
    id: `watch_${index + 1}`, symbol: `C${index + 1}/USDT`, status: "triggered", triggerHandled: false
  }));
  const db = { system: {}, watchTriggers: watches };
  const batch = selectAgentDecisionBatch({ trigger: "watch_trigger", triggeredWatches: watches });

  assert.deepEqual(batch.triggeredWatches.map((row) => row.id), ["watch_1", "watch_2", "watch_3", "watch_4"]);
  const blocked = { status: "failed", decisionBlocked: true, watchReviewClosure: { applicable: true, ok: false } };
  assert.equal(agentDecisionRunSucceeded(blocked), false);
  assert.equal(settleAgentDecisionBatch(db, batch, blocked).acknowledged, false);
  assert.equal(watches.some((watch) => watch.triggerHandled), false);

  settleAgentDecisionBatch(db, batch, { status: "completed", watchReviewClosure: { applicable: true, ok: true } });
  assert.deepEqual(watches.filter((watch) => watch.triggerHandled).map((watch) => watch.id), ["watch_1", "watch_2", "watch_3", "watch_4"]);
  assert.deepEqual(watches.filter((watch) => !watch.triggerHandled).map((watch) => watch.id), ["watch_5", "watch_6"]);
});

test("news settlement removes only leased records and preserves a same-key arrival after the lease", () => {
  const leased = { factId: "fact_1", symbols: ["BTC/USDT"], queuedAt: "2026-08-18T00:00:00.000Z" };
  const laterDuplicate = { factId: "fact_1", symbols: ["BTC/USDT"], queuedAt: "2026-08-18T00:01:00.000Z" };
  const untouched = { factId: "fact_2", symbols: ["ETH/USDT"] };
  const db = { system: { pendingNewsSignals: [leased, laterDuplicate, untouched] }, watchTriggers: [] };
  const batch = selectAgentDecisionBatch({ trigger: "news", newsSignals: [leased] });

  settleAgentDecisionBatch(db, batch, { status: "completed" });
  assert.equal(db.system.pendingNewsSignals.length, 2);
  assert.equal(db.system.pendingNewsSignals[0], laterDuplicate);
  assert.equal(db.system.pendingNewsSignals[1], untouched);
});

test("news projection merges derived and source symbols, survives a missing timestamp and preserves source tier", () => {
  const signal = {
    factId: "fact_1", affectedSymbols: [], symbols: ["BTC/USDT"], trustTier: "source_supplied",
    analysisStatus: "source_metadata_only"
  };
  assert.deepEqual(newsSignalSymbols(signal), ["BTC/USDT"]);
  const descriptor = newsSignalDescriptor(signal);
  assert.match(descriptor, /trustTier=source_supplied/);
  assert.match(descriptor, /publishedAt=unknown/);
  assert.match(descriptor, /symbols=BTC\/USDT/);
  assert.doesNotMatch(descriptor, /trustTier=unverified_aggregator/);
});
