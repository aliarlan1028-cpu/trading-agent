import test from "node:test";
import assert from "node:assert/strict";
import { reviewMissedOpportunities } from "../server/missedOpportunity.mjs";

function baseDb(movers) {
  return {
    user: { id: "owner-1", tenantId: "tenant_owner", isOwner: true },
    marketMovers: { movers },
    fills: [],
    positions: [],
    agentRuns: [],
    memoryItems: [],
    missedOpportunities: [],
    auditLogs: [],
    traces: [],
    meta: {},
    // 白名单只含 BTC；用不在白名单、未分析的大波动避免触发 LLM/通知的动态依赖。
    mandates: [{ id: "m1", status: "active", allowedSymbols: ["BTC/USDT"] }]
  };
}

test("大波动且未交易 → 记为错过机会（白名单外，无 LLM 依赖路径）", async () => {
  const db = baseDb([
    { symbol: "PEPE/USDT", changePct: 18, quoteVolUsdt: 90_000_000 },
    { symbol: "DOGE/USDT", changePct: -14, quoteVolUsdt: 50_000_000 }
  ]);
  const r = await reviewMissedOpportunities(db);
  assert.equal(r.missed, 2, "两个大波动都应被记为错过");
  assert.equal(db.missedOpportunities.length, 2);
  assert.ok(db.missedOpportunities.every((m) => m.inWhitelist === false));
});

test("小于阈值的波动不算错过", async () => {
  const db = baseDb([{ symbol: "XRP/USDT", changePct: 4, quoteVolUsdt: 90_000_000 }]);
  const r = await reviewMissedOpportunities(db);
  assert.equal(r.missed, 0);
});

test("近窗口内交易过的品种不算错过", async () => {
  const db = baseDb([{ symbol: "SOL/USDT", changePct: 20, quoteVolUsdt: 90_000_000 }]);
  db.fills = [{ symbol: "SOL/USDT", kind: "close", realizedPnl: 5, createdAt: new Date().toISOString() }];
  const r = await reviewMissedOpportunities(db);
  assert.equal(r.missed, 0, "做过 SOL 就不算错过它");
});

test("同一品种同一天只复盘一次（幂等）", async () => {
  const db = baseDb([{ symbol: "AVAX/USDT", changePct: 16, quoteVolUsdt: 90_000_000 }]);
  await reviewMissedOpportunities(db);
  const r2 = await reviewMissedOpportunities(db);
  assert.equal(r2.missed, 0, "第二次同日不应重复记录");
  assert.equal(db.missedOpportunities.length, 1);
});

test("白名单内错过机会默认只进入 Owner 证据，不自动调用 LLM 或写入生效记忆", async () => {
  const old = process.env.MISSED_OPP_LLM_ENABLED;
  delete process.env.MISSED_OPP_LLM_ENABLED;
  try {
    const db = baseDb([{ symbol: "BTC/USDT", changePct: 15, quoteVolUsdt: 200_000_000 }]);
    const result = await reviewMissedOpportunities(db);
    assert.equal(result.missed, 1);
    assert.equal(db.memoryItems.length, 0);
    assert.equal(db.missedOpportunities[0].ownerReviewRoute, "opportunity_detection");
    assert.equal(db.missedOpportunities[0].qualification.qualified, false);
    assert.equal(db.ownerImprovementItems.length, 0, "a 24h mover alone cannot prove there was a tradable missed entry");
  } finally {
    if (old === undefined) delete process.env.MISSED_OPP_LLM_ENABLED;
    else process.env.MISSED_OPP_LLM_ENABLED = old;
  }
});

test("只有带有事前确定性入场证据的白名单机会才进入 Owner 改进队列", async () => {
  const observedAt = new Date(Date.now() - 60_000).toISOString();
  const db = baseDb([{
    symbol: "BTC/USDT", changePct: 15, quoteVolUsdt: 200_000_000,
    counterfactualEvidence: {
      id: "replay-1", source: "deterministic_market_replay", observedAt,
      entryObserved: true, setupReady: true, liquidityPassed: true, netRewardRisk: 2, invalidated: false
    }
  }]);
  db.marketMovers.scannedAt = new Date().toISOString();
  db.agentRuns.push({ createdAt: observedAt, steps: [{ symbol: "BTC/USDT" }] });
  const result = await reviewMissedOpportunities(db);
  assert.equal(result.items[0].qualification.qualified, true);
  assert.equal(db.ownerImprovementItems[0].destination, "agent");
});
