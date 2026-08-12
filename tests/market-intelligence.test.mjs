import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "market-intelligence-test-"));
const {
  buildDailyBrief,
  dailyBriefForPrompt,
  getFlowSnapshot,
  getMarketIntelligence,
  ingestOkxLiquidationActivity,
  parseFarsideEtfHtml,
  recordSourceHealth,
  removeLegacyPaidFlowData,
  sourceHealthSummary,
  upsertIntelligenceFact
} = await import("../server/marketIntelligence.mjs");

function dbFixture() {
  return {
    meta: {}, system: { killSwitch: false, riskStatus: "正常" }, eventSources: [], events: [],
    marketIntelligenceFacts: [], marketIntelligenceSourceHealth: {}, marketCalendarEvents: [],
    dailyBriefs: [], positions: [], watchTriggers: [], marketMovers: { movers: [] }
  };
}

test("统一事实按来源外部ID幂等更新，并过滤过期事实", () => {
  const db = dbFixture();
  const first = upsertIntelligenceFact(db, { sourceId: "s1", externalId: "n1", title: "A", publishedAt: new Date().toISOString(), ttlMs: 60_000 });
  const second = upsertIntelligenceFact(db, { sourceId: "s1", externalId: "n1", title: "A updated", publishedAt: new Date().toISOString(), ttlMs: 60_000 });
  assert.equal(first.id, second.id);
  assert.equal(db.marketIntelligenceFacts.length, 1);
  upsertIntelligenceFact(db, { sourceId: "s1", externalId: "old", title: "old", publishedAt: new Date(Date.now() - 5 * 3_600_000).toISOString(), ttlMs: 1 });
  assert.deepEqual(getMarketIntelligence(db, { horizonHours: 24 }).map((fact) => fact.id), [first.id]);
});

test("来源健康读取不重复累加失败次数，并能判定陈旧", () => {
  const db = dbFixture();
  const checkedAt = new Date(Date.now() - 3 * 3_600_000).toISOString();
  recordSourceHealth(db, { id: "core", name: "core", category: "news", required: true, staleAfterMs: 60_000 }, { status: "failed", checkedAt, error: "timeout" });
  const first = sourceHealthSummary(db).find((item) => item.sourceId === "core");
  const second = sourceHealthSummary(db).find((item) => item.sourceId === "core");
  assert.equal(first.consecutiveFailures, 1);
  assert.equal(second.consecutiveFailures, 1);
  assert.equal(second.health, "stale");
});

test("Daily Brief 是可追溯分析上下文，不会直接成为交易信号", () => {
  const db = dbFixture();
  const now = new Date().toISOString();
  const news = upsertIntelligenceFact(db, { sourceId: "news", externalId: "n", type: "news", category: "news", title: "Verified catalyst", publishedAt: now, confidence: 0.8 });
  upsertIntelligenceFact(db, { sourceId: "farside_btc_etf", externalId: "etf", type: "flow", category: "etf_flow", title: "BTC ETF", symbols: ["BTC/USDT"], publishedAt: now, ttlMs: 72 * 3_600_000, values: { dailyNetUsd: 10 } });
  const brief = buildDailyBrief(db, { asOf: now });
  assert.equal(brief.mayTriggerTradeDirectly, false);
  assert.equal(brief.role, "analysis_context_only");
  assert.ok(brief.evidenceFactIds.includes(news.id));
  assert.equal(getFlowSnapshot(db).btcEtf.values.dailyNetUsd, 10);
  assert.match(dailyBriefForPrompt(db), /禁止直接作为下单信号/);
});

test("Daily Brief 会纳入实时快讯事实但仍禁止直接交易", () => {
  const db = dbFixture();
  const now = new Date().toISOString();
  const flash = upsertIntelligenceFact(db, {
    sourceId: "me_news_flash", externalId: "flash-1", type: "news", category: "flash_news",
    title: "重要快讯", publishedAt: now, confidence: 0.72, values: { impact: 82, mayTriggerTradeDirectly: false }
  });
  const brief = buildDailyBrief(db, { asOf: now });
  assert.ok(brief.topNews.some((item) => item.factId === flash.id));
  assert.equal(brief.mayTriggerTradeDirectly, false);
});

test("Daily Brief 不会把未来日历事实排进今日新闻", () => {
  const db = dbFixture();
  const asOf = "2026-08-10T05:00:00.000Z";
  const current = upsertIntelligenceFact(db, {
    sourceId: "flash", externalId: "current", type: "news", category: "flash_news",
    title: "当前快讯", publishedAt: "2026-08-10T04:50:00.000Z", confidence: 0.7
  });
  upsertIntelligenceFact(db, {
    sourceId: "calendar", externalId: "future", type: "news", category: "宏观事件",
    title: "四个月后的 CPI", publishedAt: "2026-12-10T13:30:00.000Z", confidence: 1, values: { impact: 100 }
  });
  const brief = buildDailyBrief(db, { asOf });
  assert.deepEqual(brief.topNews.map((item) => item.factId), [current.id]);
  assert.equal(brief.macroContext.mayTriggerTradeDirectly, false);
  assert.equal(brief.macroContext.economicCyclePhase, "insufficient_verified_macro_data");
});

test("Farside 公开表格解析日期、总净流和括号负数", () => {
  const rows = parseFarsideEtfHtml(`
    <table><tr><th>Date</th><th>IBIT</th><th>Total</th></tr>
    <tr><td>28 Jul 2026</td><td>(54.8)</td><td>(49.7)</td></tr>
    <tr><td>27 Jul 2026</td><td>10.0</td><td>11.6</td></tr></table>
  `);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].date.slice(0, 10), "2026-07-28");
  assert.equal(rows[0].totalMillions, -49.7);
});

test("OKX 强平活动只保留交易所范围事件数，不伪造美元总额", () => {
  const db = dbFixture();
  const fetchedAt = new Date().toISOString();
  db.marketRegime = {
    smartMoney: {
      symbol: "BTC/USDT", fetchedAt,
      liquidations: { total: 12, longLiqCount: 9, shortLiqCount: 3, dominantSide: "long" }
    }
  };
  const fact = ingestOkxLiquidationActivity(db);
  assert.equal(fact.values.scope, "OKX");
  assert.equal(fact.values.metric, "event_count");
  assert.equal(fact.values.totalCount, 12);
  assert.equal(fact.values.usdNotional, null);
  assert.equal(fact.values.globalMarketTotal, false);
  assert.equal(getFlowSnapshot(db).okxLiquidationActivity.id, fact.id);
});

test("旧付费流量来源会从事实、健康状态和历史日报中完整迁移清除", () => {
  const db = dbFixture();
  db.marketIntelligenceFacts.push(
    { id: "legacy_etf", sourceId: "coinglass_btc_etf", category: "etf_flow" },
    { id: "legacy_liq", sourceId: "legacy", category: "global_liquidation" },
    { id: "legacy_me", sourceId: "me_news_crypto", category: "crypto_news" },
    { id: "keep", sourceId: "farside_btc_etf", category: "etf_flow" }
  );
  db.marketIntelligenceSourceHealth.coinglass_market_flows = { name: "CoinGlass flows" };
  db.marketIntelligenceSourceHealth.me_news_crypto = { name: "ME News Crypto" };
  db.marketIntelligenceSourceHealth.me_news_flash = { name: "ME News 7×24 快讯" };
  db.dailyBriefs.push({
    topNews: [{ factId: "legacy_me" }, { factId: "keep" }],
    flow: {
      globalLiquidation: { id: "legacy_liq" },
      btcEtf: { id: "legacy_etf", sourceId: "coinglass_btc_etf" },
      unavailable: ["global_liquidation", "sentiment"]
    },
    dataQuality: { unconfiguredSources: ["me_news_crypto"], healthySources: ["me_news_flash"], staleRequiredSources: [] },
    evidenceFactIds: ["legacy_etf", "legacy_liq", "legacy_me", "keep"]
  });
  removeLegacyPaidFlowData(db);
  assert.deepEqual(db.marketIntelligenceFacts.map((fact) => fact.id), ["keep"]);
  assert.deepEqual(Object.keys(db.marketIntelligenceSourceHealth), ["me_news_flash"]);
  assert.equal("globalLiquidation" in db.dailyBriefs[0].flow, false);
  assert.equal(db.dailyBriefs[0].flow.btcEtf, null);
  assert.deepEqual(db.dailyBriefs[0].flow.unavailable, ["sentiment"]);
  assert.deepEqual(db.dailyBriefs[0].topNews.map((item) => item.factId), ["keep"]);
  assert.deepEqual(db.dailyBriefs[0].dataQuality.unconfiguredSources, []);
  assert.deepEqual(db.dailyBriefs[0].evidenceFactIds, ["keep"]);
});
