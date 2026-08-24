import assert from "node:assert/strict";
import test from "node:test";

import { buildPatrolView, traceSucceeded } from "../src/patrolView.js";

const patrolMessage = {
  id: "msg_patrol",
  sessionId: "chat_autocycle",
  createdAt: "2026-08-24T08:00:00.000Z",
  capabilityCoverage: {
    ok: true,
    covered: 6,
    required: 6,
    missing: [],
    whitelist: { expected: 2, analyzed: 2, symbols: ["BTC/USDT", "ETH/USDT"] },
    watches: { expected: 1, analyzed: 1, symbols: ["BTC/USDT"] },
    marketScan: { completed: true, universe: 431, candidates: 8, error: null },
    externalCandidates: [{ symbol: "SOL/USDT", side: "long", score: 82, analyzed: true }],
    checkedAt: "2026-08-24T08:01:00.000Z"
  },
  toolCallSummary: { totalCalls: 8, modelCalls: 2, preflightCalls: 6 },
  toolTrace: [
    { name: "scan_market_opportunities", args: {}, summary: "扫描 431 个合约", latencyMs: 31, origin: "system_preflight" },
    { name: "register_watch", args: { symbol: "BTC/USDT" }, summary: "已挂观察哨 watch_1", latencyMs: 12, origin: "model" }
  ],
  presentation: {
    headline: "等待 BTC 突破后回踩确认",
    nextAction: { code: "watch_primary_condition", detail: null },
    linked: { watchId: "watch_1", planId: null }
  }
};

test("自主巡检视图只接受可识别的巡检消息", () => {
  assert.equal(buildPatrolView({ ...patrolMessage, sessionId: "chat_manual" }), null);
  assert.equal(buildPatrolView({ ...patrolMessage, capabilityCoverage: null }), null);
});

test("自主巡检视图保留真实覆盖、动作与关联记录", () => {
  const view = buildPatrolView(patrolMessage);
  assert.equal(view.status, "complete");
  assert.deepEqual(view.scope.whitelist, { value: 2, total: 2, complete: true, symbols: ["BTC/USDT", "ETH/USDT"] });
  assert.equal(view.scope.market.universe, 431);
  assert.equal(view.operations.length, 1);
  assert.equal(view.operations[0].name, "register_watch");
  assert.equal(view.operations[0].symbol, "BTC/USDT");
  assert.deepEqual(view.linked, { watchId: "watch_1" });
  assert.equal(view.calls.total, 8);
});

test("缺失覆盖或失败回执会进入需关注状态，不伪造动作", () => {
  const view = buildPatrolView({
    ...patrolMessage,
    capabilityCoverage: {
      ...patrolMessage.capabilityCoverage,
      ok: false,
      covered: 5,
      missing: [{ name: "get_microstructure", symbol: "ETH/USDT" }],
      marketScan: { completed: false, universe: 0, candidates: 0, error: "source unavailable" }
    },
    toolTrace: [{ name: "get_microstructure", args: { symbol: "ETH/USDT" }, summary: "失败：source unavailable", origin: "system_preflight" }],
    presentation: { headline: null, nextAction: null, linked: {} }
  });
  assert.equal(view.status, "attention");
  assert.equal(view.operations.length, 0);
  assert.equal(view.failures.length, 1);
  assert.equal(view.scope.market.completed, false);
  assert.equal(view.headline, null);
  assert.equal(traceSucceeded({ summary: "失败：source unavailable" }), false);
});
