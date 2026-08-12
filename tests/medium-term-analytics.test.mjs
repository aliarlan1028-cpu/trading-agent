import test from "node:test";
import assert from "node:assert/strict";
import { backfillMediumTermPriceHistory, buildEventVolatilityStats, buildMediumTermAnalytics, captureEventVolatilityObservations, mediumTermPriceHistoryReady, mediumTermSymbolsForCollection, recordMediumTermSample } from "../server/mediumTermAnalytics.mjs";

const FIVE = 300_000;
const base = Date.parse("2026-08-01T00:00:00Z");

function seedSeries(db, symbol, count, priceFn, oiFn, flowFn = () => [110, 90]) {
  for (let i = 0; i < count; i += 1) {
    const [buy, sell] = flowFn(i);
    recordMediumTermSample(db, { symbol, at: new Date(base + i * FIVE), price: priceFn(i), priceObservedAt: new Date(base + i * FIVE), openInterest: oiFn(i), fundingRatePct: 0.01, oiObservedAt: new Date(base + i * FIVE), fundingObservedAt: new Date(base + i * FIVE), takerBuyVolume: buy, takerSellVolume: sell, flowAt: new Date(base + i * FIVE), flowScope: "OKX_CONTRACT_INSTRUMENT_5M", spreadBps: 2, depthUsdt: 100000 });
  }
}

test("5分钟事实桶幂等更新且保留主动买卖绝对量", () => {
  const db = { mediumTermSamples: [] };
  recordMediumTermSample(db, { symbol: "BTC/USDT", at: new Date(base + 1), price: 100, openInterest: 1000, takerBuyVolume: 10, takerSellVolume: 8 });
  recordMediumTermSample(db, { symbol: "BTC/USDT", at: new Date(base + 60_000), price: 101, openInterest: 1001, takerBuyVolume: 12, takerSellVolume: 7 });
  assert.equal(db.mediumTermSamples.length, 1);
  assert.equal(db.mediumTermSamples[0].price, 101);
  assert.equal(db.mediumTermSamples[0].takerBuyVolume, 12);
});

test("同一观察桶后续Rubik失败或返回旧桶时不覆盖已有CVD事实", () => {
  const db = { mediumTermSamples: [] };
  recordMediumTermSample(db, { symbol: "BTC/USDT", at: new Date(base + 60_000), price: 100, openInterest: 1000, takerBuyVolume: 12, takerSellVolume: 7, flowAt: new Date(base), flowScope: "OKX_CONTRACT_INSTRUMENT_5M" });
  recordMediumTermSample(db, { symbol: "BTC/USDT", at: new Date(base + 120_000), price: 101, openInterest: 1001 });
  assert.equal(db.mediumTermSamples[0].takerBuyVolume, 12);
  assert.equal(db.mediumTermSamples[0].takerSellVolume, 7);
  assert.equal(db.mediumTermSamples[0].flowBucketAt, base);
  recordMediumTermSample(db, { symbol: "BTC/USDT", at: new Date(base + 180_000), price: 102, openInterest: 1002, takerBuyVolume: 99, takerSellVolume: 1, flowAt: new Date(base - FIVE), flowScope: "OKX_CONTRACT_INSTRUMENT_5M" });
  assert.equal(db.mediumTermSamples[0].takerBuyVolume, 12, "更旧的源桶不能覆盖已保存的新源桶");
});

test("微观结构缺失时仍保存价格序列，且同桶失败不覆盖已有OI/Funding", () => {
  const db = { mediumTermSamples: [] };
  const observedAt = new Date(base + 60_000).toISOString();
  assert.equal(recordMediumTermSample(db, { symbol: "BTC/USDT", at: observedAt, price: 100, priceObservedAt: observedAt }).status, "recorded");
  assert.equal(db.mediumTermSamples[0].openInterest, null);
  recordMediumTermSample(db, { symbol: "BTC/USDT", at: observedAt, price: 101, priceObservedAt: observedAt, openInterest: 1000, oiObservedAt: observedAt, fundingRatePct: 0.01, fundingObservedAt: observedAt });
  recordMediumTermSample(db, { symbol: "BTC/USDT", at: new Date(base + 120_000), price: 102, priceObservedAt: new Date(base + 120_000) });
  assert.equal(db.mediumTermSamples[0].openInterest, 1000);
  assert.equal(db.mediumTermSamples[0].fundingRatePct, 0.01);
});

test("15m/1h/4h联合状态与CVD从同一5分钟事实序列派生", () => {
  const db = { mediumTermSamples: [] };
  seedSeries(db, "BTC/USDT", 50, i => 100 + i * 0.1, i => 1000 + i * 2);
  const now = base + 49 * FIVE;
  const row = buildMediumTermAnalytics(db, { now }).symbols[0];
  assert.equal(row.windows["15m"].status, "ok");
  assert.match(row.windows["1h"].leverageState, /long_build/);
  assert.ok(row.windows["4h"].cvd > 0);
  assert.ok(row.windows["4h"].takerBuySellRatio > 1);
});

test("价格上涨但CVD为负时标记背离，流量覆盖不足则不伪造CVD", () => {
  const db = { mediumTermSamples: [] };
  seedSeries(db, "BTC/USDT", 15, i => 100 + i * 0.2, i => 1000 + i, () => [70, 100]);
  let row = buildMediumTermAnalytics(db, { now: base + 14 * FIVE }).symbols[0];
  assert.equal(row.windows["1h"].divergence, "bearish_price_cvd");
  for (const sample of db.mediumTermSamples.slice(0, 8)) { sample.takerBuyVolume = null; sample.takerSellVolume = null; }
  row = buildMediumTermAnalytics(db, { now: base + 14 * FIVE }).symbols[0];
  assert.equal(row.windows["1h"].cvd, null);
});

test("BTC相关性与Beta要求覆盖完整声明窗口，短样本不能冒充7日Beta", () => {
  const db = { mediumTermSamples: [] };
  seedSeries(db, "BTC/USDT", 300, i => 100 * Math.exp(i * 0.001 + Math.sin(i) * 0.0005), i => 1000 + i);
  seedSeries(db, "ETH/USDT", 300, i => 200 * Math.exp(i * 0.002 + Math.sin(i) * 0.001), i => 2000 + i);
  const eth = buildMediumTermAnalytics(db, { now: base + 299 * FIVE }).symbols.find(r => r.symbol === "ETH/USDT");
  assert.equal(eth.btcRisk["24h"].status, "ok");
  assert.ok(eth.btcRisk["24h"].correlation > 0.99);
  assert.ok(eth.btcRisk["24h"].beta > 1.8);
  assert.equal(eth.btcRisk["24h"].returnInterval, "15m");
  assert.equal(eth.btcRisk["7d"].status, "insufficient");
  assert.match(eth.btcRisk["7d"].reason, /^paired_(window_boundary_missing|coverage_low)$/);
});

test("事件波动只统计精确高影响且已有完整T+4h数据的事件", () => {
  const db = { mediumTermSamples: [], events: [{ id: "e1", title: "美国 CPI", impact: 90, timePrecision: "minute", due: new Date(base + 60 * FIVE).toISOString() }] };
  seedSeries(db, "BTC/USDT", 130, i => 100 + i * 0.02 + (i >= 60 ? 1 : 0), i => 1000 + i);
  const stats = buildEventVolatilityStats(db, { now: base + 129 * FIVE });
  assert.equal(stats.observations.length, 1);
  assert.equal(stats.observations[0].type, "CPI");
  assert.ok(stats.observations[0].post1hRealizedVolPct > 0);
  assert.equal(stats.byType.CPI.status, "insufficient");
  assert.equal(stats.byType.CPI.avgPost1hRealizedVolPct, null, "样本不足时不得输出伪精确均值");
  assert.equal(captureEventVolatilityObservations(db, { now: base + 129 * FIVE }).added, 1);
  db.events = [];
  assert.equal(buildEventVolatilityStats(db, { now: base + 130 * FIVE }).observations.length, 1, "事件从活动表清理后历史观察仍保留");
});

test("官方日历事件可被统计，非minute精度的手工事件不能绕过质量门槛", () => {
  const due = new Date(base + 60 * FIVE).toISOString();
  const db = {
    mediumTermSamples: [],
    events: [{ id: "manual-date", title: "手工但只有日期", impact: 90, autoGenerated: false, timePrecision: "date", due }],
    marketCalendarEvents: [{ id: "official-cpi", title: "Consumer Price Index", importance: "high", timePrecision: "minute", due }]
  };
  seedSeries(db, "BTC/USDT", 130, i => 100 + i * 0.02 + (i >= 60 ? 1 : 0), i => 1000 + i);
  const stats = buildEventVolatilityStats(db, { now: base + 129 * FIVE });
  assert.deepEqual(stats.observations.map((row) => row.eventId), ["official-cpi"]);
});

test("风险事件表和官方日历里的同一事件不会被重复计数", () => {
  const due = new Date(base + 60 * FIVE).toISOString();
  const db = {
    mediumTermSamples: [],
    events: [{ id: "copy", title: "美国 CPI", impact: 80, timePrecision: "minute", due }],
    marketCalendarEvents: [{ id: "official", title: "Consumer Price Index", importance: "high", timePrecision: "minute", due }]
  };
  seedSeries(db, "BTC/USDT", 130, i => 100 + i * 0.02, i => 1000 + i);
  const stats = buildEventVolatilityStats(db, { now: base + 129 * FIVE });
  assert.equal(stats.observations.length, 1);
  assert.equal(stats.observations[0].type, "CPI");
});

test("事件发布时点的价格跳跃只能进入post窗口，不能污染pre窗口", () => {
  const due = base + 60 * FIVE;
  const db = { mediumTermSamples: [], events: [{ id: "jump", title: "CPI", impact: 90, timePrecision: "minute", due: new Date(due).toISOString() }] };
  seedSeries(db, "BTC/USDT", 130, i => i < 60 ? 100 : 110, i => 1000 + i);
  const observation = buildEventVolatilityStats(db, { now: base + 129 * FIVE }).observations[0];
  assert.equal(observation.eventBaselineAt, new Date(due - FIVE).toISOString());
  assert.equal(observation.pre1hRealizedVolPct, 0);
  assert.ok(observation.post15mRealizedVolPct > 9, "发布跳跃必须包含在事件后实现波动中");
  assert.equal(observation.quality.strictPreEventBaseline, true);
});

test("未识别的高影响事件不混入宏观事件家族统计", () => {
  const db = { mediumTermSamples: [], events: [{ id: "unknown", title: "某项目发布会", impact: 95, timePrecision: "minute", due: new Date(base + 60 * FIVE).toISOString() }] };
  seedSeries(db, "BTC/USDT", 130, i => 100 + i * 0.01, i => 1000 + i);
  assert.equal(buildEventVolatilityStats(db, { now: base + 129 * FIVE }).observations.length, 0);
});

test("同一存储桶在事件后更新时按真实价格观察时点归入post", () => {
  const due = base + 60 * FIVE + 2 * 60_000;
  const db = { mediumTermSamples: [], events: [{ id: "inside-bucket", title: "CPI", impact: 90, timePrecision: "minute", due: new Date(due).toISOString() }] };
  seedSeries(db, "BTC/USDT", 130, i => i < 61 ? 100 : 110, i => 1000 + i);
  const afterEvent = due + 2 * 60_000;
  recordMediumTermSample(db, { symbol: "BTC/USDT", at: new Date(afterEvent), price: 110, priceObservedAt: new Date(afterEvent), openInterest: 1060, oiObservedAt: new Date(afterEvent) });
  const observation = buildEventVolatilityStats(db, { now: base + 129 * FIVE }).observations[0];
  assert.equal(observation.eventBaselineAt, new Date(base + 60 * FIVE).toISOString(), "同桶事后更新不能覆盖该桶更早的事前价格");
  assert.ok(observation.post15mRealizedVolPct > 9, "下一事实桶应把事件跳跃计入post实现波动");
});

test("窗口起点缺失或最新事实陈旧时不借用旧样本出结论", () => {
  const db = { mediumTermSamples: [] };
  seedSeries(db, "BTC/USDT", 5, i => 100 + i, i => 1000 + i);
  let row = buildMediumTermAnalytics(db, { now: base + 4 * FIVE }).symbols[0];
  assert.equal(row.windows["1h"].status, "insufficient");
  row = buildMediumTermAnalytics(db, { now: base + 4 * FIVE + 20 * 60_000 }).symbols[0];
  assert.equal(row.windows["15m"].reason, "latest_sample_stale");
});

test("同一个Rubik源成交桶即使被多次观察也只计入一次CVD", () => {
  const db = { mediumTermSamples: [] };
  for (let i = 0; i < 13; i += 1) {
    const flowBucket = i === 12 ? 11 * FIVE : i * FIVE;
    recordMediumTermSample(db, { symbol: "BTC/USDT", at: new Date(base + i * FIVE), price: 100 + i, priceObservedAt: new Date(base + i * FIVE), openInterest: 1000 + i, oiObservedAt: new Date(base + i * FIVE), takerBuyVolume: 10, takerSellVolume: 5, flowAt: new Date(base + flowBucket), flowScope: "OKX_CONTRACT_INSTRUMENT_5M" });
  }
  const row = buildMediumTermAnalytics(db, { now: base + 12 * FIVE }).symbols[0].windows["1h"];
  assert.equal(row.cvdProxy, 60, "12个唯一源桶 × 净主动买5，而不是13次重复累计");
});

test("同一旧OI源时点被重复写入多个观察桶不能伪造窗口覆盖", () => {
  const db = { mediumTermSamples: [] };
  for (let i = 0; i < 13; i += 1) recordMediumTermSample(db, { symbol: "BTC/USDT", at: new Date(base + i * FIVE), price: 100 + i, priceObservedAt: new Date(base + i * FIVE), openInterest: 1000, oiObservedAt: new Date(base), fundingRatePct: 0.01, fundingObservedAt: new Date(base) });
  const row = buildMediumTermAnalytics(db, { now: base + 12 * FIVE }).symbols[0].windows["1h"];
  assert.equal(row.status, "insufficient");
  assert.equal(row.reason, "oi_window_coverage_low");
  assert.equal(row.samples, 1);
});

test("历史K线回填按收盘时刻记账，能立即形成Beta但不能伪造OI窗口", () => {
  const db = { mediumTermSamples: [] };
  const candles = Array.from({ length: 300 }, (_, i) => ({ time: base + i * FIVE, close: 100 + i, confirmed: true }));
  backfillMediumTermPriceHistory(db, "BTC/USDT", candles, { now: base + 301 * FIVE });
  backfillMediumTermPriceHistory(db, "ETH/USDT", candles.map((row, i) => ({ ...row, close: 200 + i * 2 })), { now: base + 301 * FIVE });
  assert.equal(db.mediumTermSamples.find((row) => row.symbol === "BTC/USDT" && row.bucketAt === base + FIVE)?.price, 100, "首根close应归属开盘后5分钟");
  const analytics = buildMediumTermAnalytics(db, { now: base + 300 * FIVE });
  const eth = analytics.symbols.find((row) => row.symbol === "ETH/USDT");
  assert.equal(eth.btcRisk["24h"].status, "ok");
  assert.equal(eth.windows["15m"].status, "insufficient");
  assert.match(eth.windows["15m"].reason, /^oi_/);
});

test("7d价格回填必须跨满声明窗口，6.5天不能误标完成", () => {
  const make = (count) => Array.from({ length: count }, (_, i) => ({ symbol: "BTC/USDT", bucketAt: base + i * 15 * 60_000, priceObservedAt: new Date(base + i * 15 * 60_000), price: 100 + i }));
  const full = make(674);
  assert.equal(mediumTermPriceHistoryReady(make(625), "BTC/USDT", { now: base + 624 * 15 * 60_000 }), false);
  assert.equal(mediumTermPriceHistoryReady(full, "BTC/USDT", { now: base + 673 * 15 * 60_000 }), true);
  assert.equal(mediumTermPriceHistoryReady(full, "ETH/USDT", { now: base + 673 * 15 * 60_000 }), false);
});

test("中频采集优先覆盖真实持仓，不会被自选列表上限裁掉", () => {
  const db = {
    positions: [{ symbol: "SUI/USDT", direction: "long", source: "exchange_rest", coinSize: 1, mark: 1 }],
    watchlist: Array.from({ length: 20 }, (_, i) => `W${i}/USDT`)
  };
  const symbols = mediumTermSymbolsForCollection(db, { allowedSymbols: ["DOGE/USDT"] }, 3);
  assert.deepEqual(symbols.slice(0, 3), ["BTC/USDT", "SUI/USDT", "DOGE/USDT"]);
  assert.ok(symbols.includes("SUI/USDT"));
});

test("非单合约口径的主动成交量不得进入CVD", () => {
  const db = { mediumTermSamples: [] };
  for (let i = 0; i < 13; i += 1) recordMediumTermSample(db, { symbol: "BTC/USDT", at: new Date(base + i * FIVE), price: 100 + i, priceObservedAt: new Date(base + i * FIVE), openInterest: 1000 + i, oiObservedAt: new Date(base + i * FIVE), takerBuyVolume: 20, takerSellVolume: 10, flowAt: new Date(base + i * FIVE), flowScope: "OKX_CONTRACTS_BY_CURRENCY_5M_PROXY" });
  const row = buildMediumTermAnalytics(db, { now: base + 12 * FIVE }).symbols[0].windows["1h"];
  assert.equal(row.cvd, null);
  assert.equal(row.flowCoveragePct, 0);
});

test("持仓输出净/毛BTC Beta等效敞口，缺Beta仓位明确partial", () => {
  const db = { mediumTermSamples: [], positions: [
    { symbol: "BTC/USDT", direction: "long", coinSize: 0.1, mark: 100 },
    { symbol: "ETH/USDT", direction: "short", coinSize: 1, mark: 200 },
    { symbol: "UNKNOWN/USDT", direction: "long", notionalUsdt: 50 }
  ] };
  seedSeries(db, "BTC/USDT", 300, i => 100 * Math.exp(i * 0.001 + Math.sin(i) * 0.0005), i => 1000 + i);
  seedSeries(db, "ETH/USDT", 300, i => 200 * Math.exp(i * 0.002 + Math.sin(i) * 0.001), i => 2000 + i);
  const risk = buildMediumTermAnalytics(db, { now: base + 299 * FIVE }).portfolioBtcRisk;
  assert.equal(risk.status, "partial");
  assert.ok(risk.grossBtcBetaExposureUsdt > Math.abs(risk.netBtcEquivalentUsdt));
  assert.equal(risk.positions.find((row) => row.symbol === "UNKNOWN/USDT").status, "insufficient");
  assert.equal(risk.positions.find((row) => row.symbol === "ETH/USDT").betaWindow, "24h", "3d样本不足时必须明确回退24h");
});

test("执行引擎与交易所的同一仓位合并后再算Beta，不能重复敞口", () => {
  const db = { mediumTermSamples: [], positions: [
    { id: "engine", source: "execution_engine", symbol: "BTC/USDT", direction: "long", size: 0.1, mark: 100 },
    { id: "exchange", source: "exchange_rest", symbol: "BTC/USDT", direction: "long", coinSize: 0.1, mark: 100 }
  ] };
  seedSeries(db, "BTC/USDT", 10, i => 100 + i, i => 1000 + i);
  const risk = buildMediumTermAnalytics(db, { now: base + 9 * FIVE }).portfolioBtcRisk;
  assert.equal(risk.status, "ok");
  assert.equal(risk.positions.length, 1);
  assert.equal(risk.grossBtcBetaExposureUsdt, 10);
});
