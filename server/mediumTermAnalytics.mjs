import { normalizePositionsForUi } from "./positionView.mjs";

const FIVE_MIN = 300_000;
const BETA_INTERVAL = 15 * 60_000;
const DAY = 86_400_000;
const RETENTION_MS = 30 * DAY;
const MAX_SAMPLE_ROWS = 220_000; // 约可容纳 BTC + 20 个并发持仓品种的30天5m事实
const MAX_SAMPLE_STALENESS_MS = 10 * 60_000;
const MAX_POINT_DISTANCE_MS = 7.5 * 60_000;
const MIN_WINDOW_COVERAGE = 0.8;
const MIN_FLOW_COVERAGE = 0.7;
const WINDOWS = { "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000 };
const MIN_EVENT_OBSERVATIONS = 5;
const SUPPORTED_EVENT_TYPES = new Set(["FOMC", "CPI", "NFP", "PPI", "PCE", "GDP", "ECB", "BOJ", "JOBLESS_CLAIMS"]);
const STATE_THRESHOLDS = {
  "15m": { directionalPricePct: 0.15, flatPricePct: 0.08, materialOiPct: 0.25 },
  "1h": { directionalPricePct: 0.3, flatPricePct: 0.15, materialOiPct: 0.5 },
  "4h": { directionalPricePct: 0.6, flatPricePct: 0.3, materialOiPct: 1 }
};
const finite = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
const round = (v, n = 4) => finite(v) ? Number(Number(v).toFixed(n)) : null;
const mean = (v) => v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
const pct = (a, b) => finite(a) && finite(b) && Number(a) !== 0 ? (Number(b) / Number(a) - 1) * 100 : null;
const timestamp = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  const parsed = Number.isFinite(numeric) ? numeric : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};
const bucketAt = (at) => {
  const parsed = timestamp(at);
  return parsed === null ? NaN : Math.floor(parsed / FIVE_MIN) * FIVE_MIN;
};
const observationFreshForBucket = (row, field, tolerance = FIVE_MIN) => {
  const at = timestamp(row?.[field]);
  return at !== null && Math.abs(at - Number(row.bucketAt)) <= tolerance;
};
function uniqueObservations(rows, field) {
  const unique = new Map();
  for (const row of rows) {
    const at = timestamp(row?.[field]);
    if (at === null) continue;
    const sourceBucketAt = bucketAt(at);
    unique.set(sourceBucketAt, { ...row, observedBucketAt: row.bucketAt, bucketAt: sourceBucketAt });
  }
  return [...unique.values()].sort((a, b) => a.bucketAt - b.bucketAt);
}

function stdev(values) {
  if (values.length < 2) return null;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1));
}
function before(rows, at) {
  for (let index = rows.length - 1; index >= 0; index -= 1) if (rows[index].bucketAt <= at) return rows[index];
  return null;
}
function nearest(rows, at, tolerance = MAX_POINT_DISTANCE_MS) {
  let best = null;
  for (const row of rows) {
    const distance = Math.abs(row.bucketAt - at);
    if (distance <= tolerance && (!best || distance < best.distance)) best = { row, distance };
  }
  return best?.row || null;
}
function coverageStatus(samples, expected, threshold = MIN_WINDOW_COVERAGE) {
  const coveragePct = expected > 0 ? Math.min(100, samples / expected * 100) : 0;
  return { coveragePct: round(coveragePct, 1), sufficient: samples >= Math.ceil(expected * threshold) };
}
function quantile(values, q) {
  const sorted = values.filter(finite).map(Number).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * q, lower = Math.floor(index), upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export function recordMediumTermSample(db, input = {}) {
  const symbol = String(input.symbol || "").toUpperCase();
  const bucket = bucketAt(input.at || new Date());
  // 价格是 Beta/事件波动的独立事实源。OI 接口短暂失败不能拖垮价格序列；
  // OI 联合状态自己的质量门会把 OI 缺口明确标成 insufficient。
  if (!symbol || !Number.isFinite(bucket) || !finite(input.price) || Number(input.price) <= 0) return { status: "invalid" };
  db.mediumTermSamples ||= [];
  const next = {
    symbol, bucketAt: bucket, at: new Date(bucket).toISOString(), source: "OKX_PUBLIC_API",
    price: Number(input.price), priceObservedAt: input.priceObservedAt || null,
    openInterest: finite(input.openInterest) && Number(input.openInterest) >= 0 ? Number(input.openInterest) : null,
    fundingRatePct: finite(input.fundingRatePct) ? Number(input.fundingRatePct) : null,
    oiObservedAt: input.oiObservedAt || null, fundingObservedAt: input.fundingObservedAt || null,
    takerBuyVolume: finite(input.takerBuyVolume) ? Number(input.takerBuyVolume) : null,
    takerSellVolume: finite(input.takerSellVolume) ? Number(input.takerSellVolume) : null,
    flowBucketAt: input.flowAt ? bucketAt(input.flowAt) : null,
    flowScope: input.flowScope || null,
    spreadBps: finite(input.spreadBps) ? Number(input.spreadBps) : null, depthUsdt: finite(input.depthUsdt) ? Number(input.depthUsdt) : null,
    observedAt: input.observedAt || new Date().toISOString(), sourceAt: input.sourceAt || null, updatedAt: new Date().toISOString()
  };
  const existing = db.mediumTermSamples.find((row) => row.symbol === symbol && row.bucketAt === bucket);
  if (existing) {
    // 同一个观察桶会因 2 分钟调度被刷新多次。Rubik 偶发失败或仍返回更旧的
    // 5 分钟源桶时，不能用 null/旧值覆盖本桶已经拿到的有效单合约 CVD 事实。
    const usableFlow = (row) => row?.flowScope === "OKX_CONTRACT_INSTRUMENT_5M"
      && finite(row.flowBucketAt) && finite(row.takerBuyVolume) && finite(row.takerSellVolume);
    if (usableFlow(existing) && (!usableFlow(next) || Number(next.flowBucketAt) < Number(existing.flowBucketAt))) {
      next.takerBuyVolume = existing.takerBuyVolume;
      next.takerSellVolume = existing.takerSellVolume;
      next.flowBucketAt = existing.flowBucketAt;
      next.flowScope = existing.flowScope;
    }
    const preservePair = (valueField, observedField) => {
      const oldAt = timestamp(existing[observedField]);
      const newAt = timestamp(next[observedField]);
      if (finite(existing[valueField]) && (!finite(next[valueField]) || (oldAt !== null && newAt !== null && newAt < oldAt))) {
        next[valueField] = existing[valueField];
        next[observedField] = existing[observedField];
      }
    };
    // 一个 5 分钟事实桶只保留该桶最早的有效价格观察，保证采样相位稳定。
    // 若用调度末次价格覆盖，事件发生在桶中间时会把事后价格伪装成事前价格。
    const oldPriceAt = timestamp(existing.priceObservedAt), newPriceAt = timestamp(next.priceObservedAt);
    if (finite(existing.price) && oldPriceAt !== null && (newPriceAt === null || newPriceAt >= oldPriceAt)) {
      next.price = existing.price;
      next.priceObservedAt = existing.priceObservedAt;
    }
    preservePair("openInterest", "oiObservedAt");
    preservePair("fundingRatePct", "fundingObservedAt");
    if (finite(existing.spreadBps) && !finite(next.spreadBps)) next.spreadBps = existing.spreadBps;
    if (finite(existing.depthUsdt) && !finite(next.depthUsdt)) next.depthUsdt = existing.depthUsdt;
    if (existing.sourceAt && typeof existing.sourceAt === "object" && next.sourceAt && typeof next.sourceAt === "object") {
      next.sourceAt = Object.fromEntries(Object.keys({ ...existing.sourceAt, ...next.sourceAt }).map((key) => [key, next.sourceAt[key] ?? existing.sourceAt[key] ?? null]));
    }
    if (usableFlow(next)) next.source = "OKX_PUBLIC_API+RUBIK";
    Object.assign(existing, next);
  } else {
    if (next.flowScope === "OKX_CONTRACT_INSTRUMENT_5M" && finite(next.takerBuyVolume) && finite(next.takerSellVolume)) next.source = "OKX_PUBLIC_API+RUBIK";
    db.mediumTermSamples.unshift(next);
  }
  const cutoff = Date.now() - RETENTION_MS;
  db.mediumTermSamples = db.mediumTermSamples.filter((row) => row.bucketAt >= cutoff).slice(0, MAX_SAMPLE_ROWS);
  return { status: "recorded", row: existing || next };
}

function classifyLeverage(priceChangePct, oiChangePct, fundingRatePct, thresholds) {
  if (!finite(priceChangePct) || !finite(oiChangePct)) return "insufficient";
  const price = Number(priceChangePct), oi = Number(oiChangePct), funding = Number(fundingRatePct || 0);
  const priceDirectional = Math.abs(price) >= thresholds.directionalPricePct;
  const oiMaterial = Math.abs(oi) >= thresholds.materialOiPct;
  if (Math.abs(price) <= thresholds.flatPricePct && oi >= thresholds.materialOiPct) return "leverage_build_up";
  if (price >= thresholds.directionalPricePct && oi >= thresholds.materialOiPct) return funding >= 0.05 ? "long_build_crowded" : "long_build";
  if (price >= thresholds.directionalPricePct && oi <= -thresholds.materialOiPct) return "short_covering";
  if (price <= -thresholds.directionalPricePct && oi >= thresholds.materialOiPct) return funding <= -0.05 ? "short_build_crowded" : "short_build";
  if (price <= -thresholds.directionalPricePct && oi <= -thresholds.materialOiPct) return "long_deleveraging";
  if (priceDirectional && !oiMaterial) return "price_move_without_oi_confirmation";
  if (!priceDirectional && oi <= -thresholds.materialOiPct) return "deleveraging_without_direction";
  return "stable_or_mixed";
}

function windowStats(rows, timeframe, duration, now) {
  const priceRows = rows.filter((row) => finite(row.price) && observationFreshForBucket(row, "priceObservedAt"));
  const end = before(priceRows, now);
  const expected = Math.floor(duration / FIVE_MIN) + 1;
  if (!end || now - end.bucketAt > MAX_SAMPLE_STALENESS_MS) return { status: "insufficient", reason: "latest_sample_stale", samples: 0, expected, completenessPct: 0 };
  const startAt = end.bucketAt - duration;
  // 历史 K 线回填只有价格；OI 联合状态必须由前向采集的同频 OI 覆盖完整窗口，
  // 不能因为价格行很多就把 OI completeness 伪装成充足。
  const oiRows = uniqueObservations(rows.filter((row) => finite(row.openInterest) && observationFreshForBucket(row, "oiObservedAt")), "oiObservedAt");
  const start = nearest(oiRows, startAt);
  const inside = rows.filter((row) => row.bucketAt >= startAt && row.bucketAt <= end.bucketAt);
  const oiInside = oiRows.filter((row) => row.bucketAt >= startAt && row.bucketAt <= end.bucketAt);
  const completeness = coverageStatus(oiInside.length, expected);
  const oiEnd = before(oiRows, end.bucketAt);
  if (!oiEnd || end.bucketAt - oiEnd.bucketAt > MAX_POINT_DISTANCE_MS || !start || Math.abs(start.bucketAt - startAt) > MAX_POINT_DISTANCE_MS || !completeness.sufficient) return { status: "insufficient", reason: !start ? "oi_window_start_missing" : "oi_window_coverage_low", samples: oiInside.length, expected, completenessPct: completeness.coveragePct };
  const priceStart = nearest(priceRows, startAt);
  if (!priceStart) return { status: "insufficient", reason: "price_window_start_missing", samples: oiInside.length, expected, completenessPct: completeness.coveragePct };
  const priceChangePct = pct(priceStart.price, end.price), oiChangePct = pct(start.openInterest, oiEnd.openInterest);
  const fundingRows = uniqueObservations(inside.filter((row) => finite(row.fundingRatePct) && observationFreshForBucket(row, "fundingObservedAt")), "fundingObservedAt");
  const fundingValues = fundingRows.map((row) => Number(row.fundingRatePct));
  const fundingStart = fundingRows[0]?.fundingRatePct;
  const fundingEnd = fundingRows.at(-1)?.fundingRatePct;
  // 调度每2分钟、Rubik数据每5分钟；按源桶去重，避免同一成交桶出现在多个观察桶时被重复累计。
  const flowBySourceBucket = new Map();
  for (const row of rows) {
    if (!finite(row.flowBucketAt) || row.flowBucketAt < startAt || row.flowBucketAt > end.bucketAt) continue;
    if (row.flowScope !== "OKX_CONTRACT_INSTRUMENT_5M" || !finite(row.takerBuyVolume) || !finite(row.takerSellVolume)) continue;
    flowBySourceBucket.set(Number(row.flowBucketAt), row);
  }
  const flow = [...flowBySourceBucket.values()].sort((a, b) => a.flowBucketAt - b.flowBucketAt);
  const flowCoverage = coverageStatus(flow.length, expected, MIN_FLOW_COVERAGE);
  const buy = flow.reduce((sum, row) => sum + row.takerBuyVolume, 0), sell = flow.reduce((sum, row) => sum + row.takerSellVolume, 0), cvdProxy = buy - sell;
  const flowTotal = buy + sell, imbalancePct = flowTotal > 0 ? cvdProxy / flowTotal * 100 : null, cut = Math.floor(flow.length / 2);
  const firstRate = mean(flow.slice(0, cut).map((row) => row.takerBuyVolume - row.takerSellVolume)), secondRate = mean(flow.slice(cut).map((row) => row.takerBuyVolume - row.takerSellVolume));
  const thresholds = STATE_THRESHOLDS[timeframe];
  const divergence = flowCoverage.sufficient && priceChangePct >= thresholds.directionalPricePct && imbalancePct <= -2 ? "bearish_price_cvd"
    : flowCoverage.sufficient && priceChangePct <= -thresholds.directionalPricePct && imbalancePct >= 2 ? "bullish_price_cvd" : "none";
  return {
    status: "ok", samples: oiInside.length, expected, completenessPct: completeness.coveragePct, startAt: new Date(start.bucketAt).toISOString(), endAt: new Date(end.bucketAt).toISOString(),
    priceChangePct: round(priceChangePct), oiChangePct: round(oiChangePct), fundingRatePct: finite(fundingEnd) ? Number(fundingEnd) : null,
    fundingStartPct: round(fundingStart, 6), fundingEndPct: round(fundingEnd, 6), fundingChangePp: finite(fundingStart) && finite(fundingEnd) ? round(Number(fundingEnd) - Number(fundingStart), 6) : null,
    avgFundingPct: round(mean(fundingValues), 6), fundingState: !finite(fundingEnd) ? "unavailable" : Number(fundingEnd) >= 0.05 ? "positive_extreme" : Number(fundingEnd) <= -0.05 ? "negative_extreme" : Number(fundingEnd) > 0 ? "positive_normal" : Number(fundingEnd) < 0 ? "negative_normal" : "neutral",
    leverageState: classifyLeverage(priceChangePct, oiChangePct, fundingEnd, thresholds), stateThresholds: thresholds,
    // 单合约 5m taker 买卖量的累计差，是中频 CVD；不是逐笔成交方向重建，故保留 Proxy 命名。
    cvdProxy: flowCoverage.sufficient ? round(cvdProxy, 3) : null, cvd: flowCoverage.sufficient ? round(cvdProxy, 3) : null,
    cvdImbalancePct: flowCoverage.sufficient ? round(imbalancePct, 3) : null,
    takerBuySellRatio: flowCoverage.sufficient && sell > 0 ? round(buy / sell, 3) : null,
    cvdSlope: !flowCoverage.sufficient || !finite(firstRate) || !finite(secondRate) ? "insufficient" : secondRate > firstRate ? "rising" : secondRate < firstRate ? "falling" : "flat",
    divergence, flowCoveragePct: flowCoverage.coveragePct, flowScope: "OKX_CONTRACT_INSTRUMENT_5M"
  };
}

// 仅回填价格事实，供 24h/3d/7d BTC 相关性与 Beta 启动即用。
// 历史 K 线不含同频 OI/Funding/CVD，所以绝不拿这些行计算 OI 联合状态。
export function backfillMediumTermPriceHistory(db, symbol, candles = [], { observedAt = new Date().toISOString(), now = Date.now(), intervalMs = FIVE_MIN } = {}) {
  const normalizedSymbol = String(symbol || "").toUpperCase();
  if (!normalizedSymbol) return { status: "invalid", added: 0 };
  db.mediumTermSamples ||= [];
  const existing = new Map(db.mediumTermSamples.filter((row) => row.symbol === normalizedSymbol).map((row) => [Number(row.bucketAt), row]));
  let added = 0;
  for (const candle of candles) {
    // OKX candle.time 是 K 线开盘时刻，而该行 price 使用 close；事实时间应移到收盘时刻。
    // 未闭合或收盘时刻仍在未来的 K 线不能进入历史事实，避免事件统计前视。
    const bucket = bucketAt(Number(candle?.time) + intervalMs);
    const price = Number(candle?.close);
    if (candle?.confirmed === false || !Number.isFinite(bucket) || bucket > now || !Number.isFinite(price) || price <= 0 || existing.has(bucket)) continue;
    const row = {
      symbol: normalizedSymbol, bucketAt: bucket, at: new Date(bucket).toISOString(), source: "OKX_PUBLIC_API_HISTORY_CANDLES",
      price, priceObservedAt: new Date(bucket).toISOString(), openInterest: null, fundingRatePct: null, takerBuyVolume: null, takerSellVolume: null,
      flowBucketAt: null, flowScope: null, spreadBps: null, depthUsdt: null, observedAt, sourceAt: { candle: candle.time }, updatedAt: observedAt,
      persistPending: true
    };
    db.mediumTermSamples.push(row);
    existing.set(bucket, row);
    added += 1;
  }
  const cutoff = now - RETENTION_MS;
  db.mediumTermSamples = db.mediumTermSamples.filter((row) => row.bucketAt >= cutoff).sort((a, b) => b.bucketAt - a.bucketAt).slice(0, MAX_SAMPLE_ROWS);
  return { status: "ok", added };
}

export function mediumTermPriceHistoryReady(rows = [], symbol, { now = Date.now() } = {}) {
  const normalizedSymbol = String(symbol || "").toUpperCase();
  const buckets = [...new Set(rows
    .filter((row) => row.symbol === normalizedSymbol && finite(row.price) && Number(row.price) > 0 && finite(row.bucketAt) && observationFreshForBucket(row, "priceObservedAt"))
    .map((row) => Math.ceil(Number(timestamp(row.priceObservedAt) ?? row.bucketAt) / BETA_INTERVAL) * BETA_INTERVAL)
    .filter((at) => at <= now))].sort((a, b) => a - b);
  const latest = buckets.at(-1);
  const expected = Math.floor(7 * DAY / BETA_INTERVAL) + 1;
  const minimum = Math.ceil(expected * 0.8);
  return Boolean(Number.isFinite(latest)
    && now - latest <= BETA_INTERVAL + MAX_SAMPLE_STALENESS_MS
    && latest - buckets[0] >= 7 * DAY
    && buckets.length >= minimum);
}

export function mediumTermSymbolsForCollection(db = {}, mandate = null, maxSymbols = 12) {
  const positions = normalizePositionsForUi(db.positions || []).map((row) => row.symbol);
  const candidates = ["BTC/USDT", ...positions, ...(mandate?.allowedSymbols || []), ...(db.watchlist || []), "ETH/USDT"];
  const unique = [...new Set(candidates.map((value) => String(value || "").toUpperCase()).filter((value) => /^[A-Z0-9]+\/USDT$/.test(value)))];
  // 所有当前真实仓位都必须被覆盖；上限只裁剪额外自选/授权候选，不能裁掉持仓风险。
  return unique.slice(0, Math.max(Number(maxSymbols) || 12, 1 + positions.length));
}

function resampleLast(rows, interval) {
  const buckets = new Map();
  for (const row of rows) {
    if (!finite(row.price) || !finite(row.bucketAt)) continue;
    // 事实时间表示 close/观察时点：12:15 属于截至 12:15 的区间；12:20 属于
    // 截至 12:30 的未完成区间。ceil 后由调用方排除未来区间，避免 Beta 混入半根 K 线。
    const sourceBucketAt = timestamp(row.priceObservedAt) ?? Number(row.bucketAt);
    const at = Math.ceil(sourceBucketAt / interval) * interval;
    const prior = buckets.get(at);
    if (!prior || sourceBucketAt > Number(prior.sourceBucketAt)) buckets.set(at, { ...row, bucketAt: at, sourceBucketAt });
  }
  return [...buckets.values()].sort((a, b) => a.bucketAt - b.bucketAt);
}

function correlationBeta(assetRows, btcRows, duration, now) {
  assetRows = assetRows.filter((row) => observationFreshForBucket(row, "priceObservedAt"));
  btcRows = btcRows.filter((row) => observationFreshForBucket(row, "priceObservedAt"));
  const assetEnd = before(assetRows, now), btcEnd = before(btcRows, now);
  if (!assetEnd || !btcEnd) return { status: "insufficient", reason: "latest_pair_missing", pairedReturns: 0 };
  const latestPairAt = Math.min(assetEnd.bucketAt, btcEnd.bucketAt);
  if (now - latestPairAt > MAX_SAMPLE_STALENESS_MS) return { status: "insufficient", reason: "latest_pair_stale", pairedReturns: 0 };
  const assetSeries = resampleLast(assetRows, BETA_INTERVAL).filter((row) => row.bucketAt <= now), btcSeries = resampleLast(btcRows, BETA_INTERVAL).filter((row) => row.bucketAt <= now);
  const endAt = Math.min(before(assetSeries, now)?.bucketAt ?? -Infinity, before(btcSeries, now)?.bucketAt ?? -Infinity);
  if (!Number.isFinite(endAt)) return { status: "insufficient", reason: "resampled_pair_missing", pairedReturns: 0 };
  if (now - endAt > BETA_INTERVAL + MAX_SAMPLE_STALENESS_MS) return { status: "insufficient", reason: "completed_pair_stale", pairedReturns: 0 };
  const startAt = endAt - duration;
  const btcMap = new Map(btcSeries.filter((row) => row.bucketAt >= startAt && row.bucketAt <= endAt).map((row) => [row.bucketAt, row]));
  const pairs = assetSeries.filter((row) => row.bucketAt >= startAt && row.bucketAt <= endAt && btcMap.has(row.bucketAt)).map((row) => [row, btcMap.get(row.bucketAt)]).sort((a, b) => a[0].bucketAt - b[0].bucketAt);
  if (!pairs.length || pairs[0][0].bucketAt - startAt > BETA_INTERVAL * 1.5 || endAt - pairs.at(-1)[0].bucketAt > BETA_INTERVAL * 1.5) return { status: "insufficient", reason: "paired_window_boundary_missing", pairedReturns: 0 };
  const assetReturns = [], btcReturns = [];
  for (let index = 1; index < pairs.length; index += 1) {
    if (pairs[index][0].bucketAt - pairs[index - 1][0].bucketAt > BETA_INTERVAL * 1.5) continue;
    if (pairs[index][1].bucketAt - pairs[index - 1][1].bucketAt > BETA_INTERVAL * 1.5) continue;
    assetReturns.push(Math.log(pairs[index][0].price / pairs[index - 1][0].price));
    btcReturns.push(Math.log(pairs[index][1].price / pairs[index - 1][1].price));
  }
  const expectedReturns = Math.floor(duration / BETA_INTERVAL);
  const coverage = coverageStatus(assetReturns.length, expectedReturns, 0.8);
  if (!coverage.sufficient) return { status: "insufficient", reason: "paired_coverage_low", pairedReturns: assetReturns.length, expectedReturns, coveragePct: coverage.coveragePct };
  const assetMean = mean(assetReturns), btcMean = mean(btcReturns);
  const covariance = assetReturns.reduce((sum, value, index) => sum + (value - assetMean) * (btcReturns[index] - btcMean), 0) / (assetReturns.length - 1);
  const assetStdev = stdev(assetReturns), btcStdev = stdev(btcReturns);
  if (!assetStdev || !btcStdev) return { status: "insufficient", reason: "zero_return_variance", pairedReturns: assetReturns.length, expectedReturns, coveragePct: coverage.coveragePct };
  const correlation = Math.max(-1, Math.min(1, covariance / (assetStdev * btcStdev)));
  const beta = covariance / (btcStdev ** 2);
  return {
    status: "ok", pairedReturns: assetReturns.length, expectedReturns, coveragePct: coverage.coveragePct,
    startAt: new Date(startAt).toISOString(), endAt: new Date(endAt).toISOString(), correlation: round(correlation, 4), beta: round(beta, 4), returnInterval: "15m",
    riskFlag: Math.abs(correlation) < 0.4 ? "low_btc_linkage" : Math.abs(beta) >= 1.5 && Math.abs(correlation) >= 0.7 ? "high_beta" : correlation < -0.4 ? "inverse_linkage" : "normal_beta"
  };
}

function eventType(event) {
  const text = `${event.title || ""} ${event.shortTitle || ""}`.toLowerCase();
  return /fomc|federal open market|美联储.*利率/.test(text) ? "FOMC"
    : /\bcpi\b|consumer price index|消费者价格/.test(text) ? "CPI"
      : /non.?farm|\bnfp\b|employment situation|非农/.test(text) ? "NFP"
        : /\bppi\b|producer price index|生产者价格/.test(text) ? "PPI"
          : /\bpce\b|personal consumption expenditure|个人消费支出/.test(text) ? "PCE"
            : /\bgdp\b|gross domestic product|国内生产总值/.test(text) ? "GDP"
              : /\becb\b|european central bank|欧洲央行/.test(text) ? "ECB"
                : /\bboj\b|bank of japan|日本央行/.test(text) ? "BOJ"
                  : /jobless claims|initial claims|初请失业金/.test(text) ? "JOBLESS_CLAIMS" : "OTHER";
}
function realizedVolatility(rows, startAt, endAt) {
  const inside = rows.filter((row) => row.bucketAt >= startAt && row.bucketAt <= endAt);
  const logReturns = [];
  for (let index = 1; index < inside.length; index += 1) {
    if (inside[index].bucketAt - inside[index - 1].bucketAt > FIVE_MIN * 1.5) continue;
    logReturns.push(Math.log(inside[index].price / inside[index - 1].price));
  }
  const expected = Math.floor((endAt - startAt) / FIVE_MIN);
  const coverage = coverageStatus(logReturns.length, expected, 0.7);
  return { status: coverage.sufficient ? "ok" : "insufficient", samples: logReturns.length, expected, coveragePct: coverage.coveragePct, realizedVolPct: coverage.sufficient ? round(Math.sqrt(logReturns.reduce((sum, value) => sum + value ** 2, 0)) * 100, 4) : null };
}
function deriveEventObservations(db, now) {
  // 事件边界必须按交易所价格事实的真实观察时点，而不是落库用的 5 分钟桶。
  // 同一桶可能在事件发生后被更新；若仍按桶开始时刻排序，会把事后跳跃偷放进 pre 窗口。
  const samples = (db.mediumTermSamples || [])
    .filter((row) => row.symbol === "BTC/USDT" && finite(row.price) && observationFreshForBucket(row, "priceObservedAt"))
    .map((row) => ({ ...row, storageBucketAt: row.bucketAt, bucketAt: timestamp(row.priceObservedAt) }))
    .filter((row) => Number.isFinite(row.bucketAt))
    .sort((a, b) => a.bucketAt - b.bucketAt), observations = [];
  // 活动风险事件通常在 T+2d 清理，官方日历只保留约 T+1d；两处并集可覆盖
  // 定时捕获的正常时序。只接纳 minute 精度，手工事件也不能因来源是手工就绕过时间质量。
  const candidates = new Map();
  for (const row of [...(db.events || []), ...(db.marketCalendarEvents || [])]) {
    // 官方日历事件会再复制一份进 db.events 供风险闸使用，ID 不同但本质是同一事件。
    // 用“精确时点+标准事件类型”去重，避免 CPI/NFP 样本量被翻倍。
    const due = new Date(row.due || row.startAt || 0).getTime();
    const key = `${due}:${eventType(row)}`;
    if (!candidates.has(key)) candidates.set(key, row);
  }
  for (const event of [...candidates.values()].filter((row) => row.timePrecision === "minute" && (Number(row.impact || 0) >= 70 || row.importance === "high") && SUPPORTED_EVENT_TYPES.has(eventType(row)))) {
    const due = new Date(event.due || event.startAt || 0).getTime();
    if (!Number.isFinite(due) || due + WINDOWS["4h"] > now) continue;
    // 事件时点那一笔可能已经包含发布后的第一跳，绝不能放进 pre 窗口。
    // 以严格早于 due 的最后事实为基准，再追踪到不晚于各 T+N 边界的事实。
    const at = before(samples, due - 1);
    const pre = at ? before(samples, at.bucketAt - WINDOWS["1h"]) : null;
    const post15m = before(samples, due + WINDOWS["15m"]), post1h = before(samples, due + WINDOWS["1h"]), post4h = before(samples, due + WINDOWS["4h"]);
    const targets = [[at, due], [pre, at?.bucketAt - WINDOWS["1h"]], [post15m, due + WINDOWS["15m"]], [post1h, due + WINDOWS["1h"]], [post4h, due + WINDOWS["4h"]]];
    if (targets.some(([row, target]) => !row || !Number.isFinite(target) || target - row.bucketAt > MAX_POINT_DISTANCE_MS) || post15m.bucketAt <= at.bucketAt) continue;
    const preVol = realizedVolatility(samples, pre.bucketAt, at.bucketAt), post15mVol = realizedVolatility(samples, at.bucketAt, post15m.bucketAt), post1hVol = realizedVolatility(samples, at.bucketAt, post1h.bucketAt), post4hVol = realizedVolatility(samples, at.bucketAt, post4h.bucketAt);
    if ([preVol, post15mVol, post1hVol, post4hVol].some((row) => row.status !== "ok")) continue;
    const preRows = samples.filter((row) => row.bucketAt >= pre.bucketAt && row.bucketAt <= at.bucketAt), postRows = samples.filter((row) => row.bucketAt > at.bucketAt && row.bucketAt <= post1h.bucketAt);
    const preSpread = mean(preRows.map((row) => row.spreadBps).filter(finite)), postSpread = mean(postRows.map((row) => row.spreadBps).filter(finite));
    observations.push({
      eventId: event.id, eventKey: `${due}:${eventType(event)}`, type: eventType(event), title: event.title, due: new Date(due).toISOString(), symbol: "BTC/USDT", capturedAt: new Date(now).toISOString(),
      eventBaselineAt: new Date(at.bucketAt).toISOString(), eventBaselineLagMs: due - at.bucketAt,
      pre1hReturnPct: round(pct(pre.price, at.price)), post15mReturnPct: round(pct(at.price, post15m.price)), post1hReturnPct: round(pct(at.price, post1h.price)), post4hReturnPct: round(pct(at.price, post4h.price)),
      pre1hRealizedVolPct: preVol.realizedVolPct, post15mRealizedVolPct: post15mVol.realizedVolPct, post1hRealizedVolPct: post1hVol.realizedVolPct, post4hRealizedVolPct: post4hVol.realizedVolPct,
      post1hVolExpansionRatio: preVol.realizedVolPct > 0 ? round(post1hVol.realizedVolPct / preVol.realizedVolPct, 3) : null,
      volatilityReaction: preVol.realizedVolPct <= 0 ? "unavailable" : post1hVol.realizedVolPct / preVol.realizedVolPct >= 1.5 ? "expansion" : post1hVol.realizedVolPct / preVol.realizedVolPct <= 0.75 ? "compression" : "normal",
      pre1hAvgSpreadBps: round(preSpread), post1hAvgSpreadBps: round(postSpread), spreadExpansionBps: finite(preSpread) && finite(postSpread) ? round(postSpread - preSpread) : null,
      quality: { sampleInterval: "5m", strictPreEventBaseline: true, pre1hCoveragePct: preVol.coveragePct, post15mCoveragePct: post15mVol.coveragePct, post1hCoveragePct: post1hVol.coveragePct, post4hCoveragePct: post4hVol.coveragePct }
    });
  }
  return observations;
}

export function captureEventVolatilityObservations(db, { now = Date.now() } = {}) {
  db.eventVolatilityObservations ||= [];
  let added = 0;
  for (const observation of deriveEventObservations(db, now)) {
    const index = db.eventVolatilityObservations.findIndex((row) => (row.eventKey || `${new Date(row.due).getTime()}:${row.type}`) === observation.eventKey && row.symbol === observation.symbol);
    if (index >= 0) db.eventVolatilityObservations[index] = observation;
    else { db.eventVolatilityObservations.push(observation); added += 1; }
  }
  const cutoff = now - 3 * 365 * DAY;
  db.eventVolatilityObservations = db.eventVolatilityObservations.filter((row) => new Date(row.due).getTime() >= cutoff).sort((a, b) => new Date(a.due) - new Date(b.due)).slice(-500);
  return { status: "ok", added, total: db.eventVolatilityObservations.length };
}

export function buildEventVolatilityStats(db, { now = Date.now() } = {}) {
  const observationKey = (row) => `${row.eventKey || `${new Date(row.due).getTime()}:${row.type}`}:${row.symbol}`;
  const merged = new Map((db.eventVolatilityObservations || []).map((row) => [observationKey(row), row]));
  for (const row of deriveEventObservations(db, now)) merged.set(observationKey(row), row);
  const observations = [...merged.values()].sort((a, b) => new Date(a.due) - new Date(b.due));
  const byType = {};
  for (const type of new Set(observations.map((row) => row.type))) {
    const rows = observations.filter((row) => row.type === type), usable = rows.length >= MIN_EVENT_OBSERVATIONS;
    const post1hVol = rows.map((row) => row.post1hRealizedVolPct).filter(finite);
    const expansionRatios = rows.map((row) => row.post1hVolExpansionRatio).filter(finite);
    byType[type] = {
      samples: rows.length, minimumSamples: MIN_EVENT_OBSERVATIONS, status: usable ? "usable" : "insufficient", confidence: rows.length >= 12 ? "established" : usable ? "provisional" : "insufficient",
      avgPre1hRealizedVolPct: usable ? round(mean(rows.map((row) => row.pre1hRealizedVolPct).filter(finite))) : null,
      avgPost15mRealizedVolPct: usable ? round(mean(rows.map((row) => row.post15mRealizedVolPct).filter(finite))) : null,
      avgPost1hRealizedVolPct: usable ? round(mean(rows.map((row) => row.post1hRealizedVolPct).filter(finite))) : null,
      avgPost4hRealizedVolPct: usable ? round(mean(rows.map((row) => row.post4hRealizedVolPct).filter(finite))) : null,
      avgPost15mAbsReturnPct: usable ? round(mean(rows.map((row) => Math.abs(row.post15mReturnPct)).filter(finite))) : null,
      avgPost1hAbsReturnPct: usable ? round(mean(rows.map((row) => Math.abs(row.post1hReturnPct)).filter(finite))) : null,
      avgPost4hAbsReturnPct: usable ? round(mean(rows.map((row) => Math.abs(row.post4hReturnPct)).filter(finite))) : null,
      avgSpreadExpansionBps: usable ? round(mean(rows.map((row) => row.spreadExpansionBps).filter(finite))) : null,
      medianPost1hRealizedVolPct: usable ? round(quantile(post1hVol, 0.5)) : null,
      p90Post1hRealizedVolPct: usable ? round(quantile(post1hVol, 0.9)) : null,
      medianPost1hVolExpansionRatio: usable ? round(quantile(expansionRatios, 0.5), 3) : null,
      typicalReaction: !usable || !expansionRatios.length ? null : quantile(expansionRatios, 0.5) >= 1.5 ? "expansion" : quantile(expansionRatios, 0.5) <= 0.75 ? "compression" : "normal"
    };
  }
  return { observations: observations.slice(-100), byType };
}

export function buildMediumTermAnalytics(db, { now = Date.now() } = {}) {
  const bySymbol = new Map();
  for (const row of (db.mediumTermSamples || []).slice().sort((a, b) => a.bucketAt - b.bucketAt)) {
    if (!bySymbol.has(row.symbol)) bySymbol.set(row.symbol, []);
    bySymbol.get(row.symbol).push(row);
  }
  const btc = bySymbol.get("BTC/USDT") || [];
  const symbols = [...bySymbol].map(([symbol, rows]) => {
    return { symbol, latestAt: rows.at(-1)?.at || null, windows: Object.fromEntries(Object.entries(WINDOWS).map(([timeframe, duration]) => [timeframe, windowStats(rows, timeframe, duration, now)])), btcRisk: symbol === "BTC/USDT" ? null : { "24h": correlationBeta(rows, btc, DAY, now), "3d": correlationBeta(rows, btc, 3 * DAY, now), "7d": correlationBeta(rows, btc, 7 * DAY, now) } };
  });
  // 组合风险用 3d Beta（较 24h 稳定、又能反映近期状态）；不足时才回退 24h。
  const betaBySymbol = new Map(symbols.map((row) => [row.symbol, row.btcRisk?.["3d"]?.status === "ok" ? { ...row.btcRisk["3d"], window: "3d" } : row.btcRisk?.["24h"] ? { ...row.btcRisk["24h"], window: "24h" } : null]));
  const portfolioRows = [];
  for (const position of normalizePositionsForUi(db.positions || [])) {
    const symbol = String(position.symbol || "").toUpperCase();
    const size = Math.abs(Number(position.coinSize ?? position.size));
    const mark = Number(position.mark ?? position.entry);
    const multiplier = Number(position.coinSize != null ? 1 : (position.contractMultiplier ?? 1));
    const explicit = Number(position.notionalUsdt ?? position.notional);
    const notionalUsdt = Number.isFinite(explicit) && explicit > 0 ? Math.abs(explicit) : Number.isFinite(size * mark * multiplier) && size * mark * multiplier > 0 ? size * mark * multiplier : null;
    const btcRisk = symbol === "BTC/USDT" ? { status: "ok", beta: 1, correlation: 1, riskFlag: "btc" } : betaBySymbol.get(symbol);
    const short = /short|空|sell/i.test(String(position.direction ?? position.posSide));
    const beta = btcRisk?.status === "ok" ? Number(btcRisk.beta) : null;
    portfolioRows.push({ symbol, direction: short ? "short" : "long", notionalUsdt: round(notionalUsdt, 2), beta: round(beta, 4), betaWindow: symbol === "BTC/USDT" ? "benchmark" : btcRisk?.window || null, correlation: round(btcRisk?.correlation, 4), btcEquivalentUsdt: finite(notionalUsdt) && finite(beta) ? round((short ? -1 : 1) * notionalUsdt * beta, 2) : null, status: finite(notionalUsdt) && finite(beta) ? "ok" : "insufficient" });
  }
  const usablePortfolioRows = portfolioRows.filter((row) => finite(row.btcEquivalentUsdt));
  const netBtcEquivalentUsdt = usablePortfolioRows.reduce((sum, row) => sum + row.btcEquivalentUsdt, 0);
  const grossBtcBetaExposureUsdt = usablePortfolioRows.reduce((sum, row) => sum + Math.abs(row.btcEquivalentUsdt), 0);
  return {
    generatedAt: new Date(now).toISOString(), sampleInterval: "5m", retentionDays: 30,
    symbols,
    portfolioBtcRisk: !portfolioRows.length ? { status: "no_positions", positions: [] } : {
      status: usablePortfolioRows.length === portfolioRows.length ? "ok" : usablePortfolioRows.length ? "partial" : "insufficient",
      netBtcEquivalentUsdt: usablePortfolioRows.length ? round(netBtcEquivalentUsdt, 2) : null,
      grossBtcBetaExposureUsdt: usablePortfolioRows.length ? round(grossBtcBetaExposureUsdt, 2) : null,
      hedgeOffsetPct: grossBtcBetaExposureUsdt > 0 ? round((1 - Math.abs(netBtcEquivalentUsdt) / grossBtcBetaExposureUsdt) * 100, 1) : null,
      positions: portfolioRows
    },
    eventVolatility: buildEventVolatilityStats(db, { now })
  };
}
