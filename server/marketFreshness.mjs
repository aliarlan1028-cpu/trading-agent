import { strictFiniteFact } from "./factValues.mjs";
import { timestampEvidence } from "./marketObservation.mjs";

function combinedTimestampFact(sourceValue, receivedValue, options) {
  const source = timestampEvidence(sourceValue, options);
  const received = timestampEvidence(receivedValue, options);
  const failed = !source.ok ? source : !received.ok ? received : null;
  return {
    ok: !failed,
    reason: failed?.reason || null,
    observedAt: source.observedAt,
    receivedAt: received.observedAt,
    source,
    received,
    ageMs: Math.max(source.ageMs, received.ageMs)
  };
}

export function marketFactFreshness(market = {}, options = {}) {
  const now = Number(options.now ?? Date.now());
  const maxFutureSkewMs = Number(options.maxFutureSkewMs ?? process.env.MAX_MARKET_FUTURE_SKEW_MS ?? 30_000);
  const tickerMaxAgeMs = Number(options.tickerMaxAgeMs ?? process.env.MAX_TICKER_AGE_MS ?? 30_000);
  const microMaxAgeMs = Number(options.microMaxAgeMs ?? process.env.MAX_MICROSTRUCTURE_AGE_MS ?? 180_000);
  const openInterestMaxAgeMs = Number(options.openInterestMaxAgeMs ?? process.env.MAX_OPEN_INTEREST_AGE_MS ?? 300_000);
  // 资金费率是按资金费周期更新的低频事实，不应机械套用盘口的秒级 TTL。
  const fundingMaxAgeMs = Number(options.fundingMaxAgeMs ?? process.env.MAX_FUNDING_FACT_AGE_MS ?? 9 * 60 * 60_000);
  const candleMaxAgeMs = Number(options.candleMaxAgeMs ?? process.env.MAX_CANDLE_AGE_MS ?? 7_200_000);
  const price = strictFiniteFact(market.price);
  // ticker、盘口/OI/资金费、K 线是独立事实链；本机刚收到不能洗白交易所旧数据。
  const ticker = combinedTimestampFact(
    market.tickerSourceAt,
    market.tickerReceivedAt || market.lastRealtimeAt || market.tickerSyncedAt,
    { now, maxAgeMs: tickerMaxAgeMs, maxFutureSkewMs }
  );
  const microReceivedAt = market.microReceivedAt || market.microSyncedAt;
  const book = combinedTimestampFact(market.bookSourceAt || market.microSourceTimestamps?.book, market.bookReceivedAt || microReceivedAt, { now, maxAgeMs: microMaxAgeMs, maxFutureSkewMs });
  const openInterest = combinedTimestampFact(market.openInterestSourceAt || market.microSourceTimestamps?.openInterest, market.openInterestReceivedAt || microReceivedAt, { now, maxAgeMs: openInterestMaxAgeMs, maxFutureSkewMs });
  const funding = combinedTimestampFact(market.fundingSourceAt || market.microSourceTimestamps?.funding, market.fundingReceivedAt || microReceivedAt, { now, maxAgeMs: fundingMaxAgeMs, maxFutureSkewMs });
  const failedMicro = [book, openInterest, funding].find((fact) => !fact.ok);
  const micro = {
    ok: !failedMicro,
    reason: failedMicro?.reason || null,
    ageMs: Math.max(book.ageMs, openInterest.ageMs, funding.ageMs),
    book,
    openInterest,
    funding
  };
  const candleObservedAt = market.candlesByTf?.["1h"]?.syncedAt || market.candlesSyncedAt || null;
  const candles = timestampEvidence(candleObservedAt, { now, maxAgeMs: candleMaxAgeMs, maxFutureSkewMs });
  return {
    ok: Number.isFinite(price) && price > 0 && ticker.ok && micro.ok,
    price: Number.isFinite(price) && price > 0 ? price : null,
    ticker: Number.isFinite(price) && price > 0 ? ticker : { ...ticker, ok: false, reason: "price_unavailable" },
    micro,
    candles
  };
}

export function currentEvidenceReadiness(bundle, symbol, options = {}) {
  if (!bundle) return { ok: false, reason: "evidence_bundle_not_found" };
  const row = (bundle.symbols || []).find((item) => item.symbol === symbol);
  const declared = bundle.readiness?.[symbol];
  if (!row || declared?.ready !== true) return { ok: false, reason: "evidence_symbol_not_ready", blockers: declared?.blockers || [] };
  const now = Number(options.now ?? Date.now());
  const maxFutureSkewMs = Number(options.maxFutureSkewMs ?? process.env.MAX_MARKET_FUTURE_SKEW_MS ?? 30_000);
  const checks = [
    ["ticker", row.ticker, Number(process.env.MAX_TICKER_AGE_MS || 30_000)],
    ["microstructure", row.microstructure, Number(process.env.MAX_MICROSTRUCTURE_AGE_MS || 180_000)],
    ["candles", row.candles, Number(process.env.MAX_CANDLE_AGE_MS || 7_200_000)]
  ];
  for (const [name, evidence, maxAgeMs] of checks) {
    const fresh = timestampEvidence(evidence?.fetchedAt, { now, maxAgeMs, maxFutureSkewMs });
    const sourceFresh = name === "ticker"
      ? timestampEvidence(evidence?.sourceAt || evidence?.data?.sourceAt, { now, maxAgeMs, maxFutureSkewMs })
      : { ok: true };
    if (evidence?.status !== "fresh" || evidence?.quality !== "passed" || !fresh.ok || !sourceFresh.ok) {
      return { ok: false, reason: `${name}_evidence_not_current`, detail: fresh };
    }
  }
  return { ok: true, row };
}
