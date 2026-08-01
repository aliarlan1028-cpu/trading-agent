import test from "node:test";
import assert from "node:assert/strict";
import { reviewMissedOpportunities } from "../server/missedOpportunity.mjs";

function baseDb(movers) {
  return {
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
