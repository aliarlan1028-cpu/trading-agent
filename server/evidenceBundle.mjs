import { okxContractSpec, syncMicrostructure, syncPrivateReadOnly, syncPublicKlines, syncPublicMarket } from "./exchangeConnector.mjs";
import { fetchGlobalMarket, fetchSmartMoney } from "./marketSignals.mjs";
import { latestSuccessfulAccountSnapshot, nowIso } from "./store.mjs";
import { refreshAccounting } from "./accounting.mjs";
import { buildMediumTermAnalytics } from "./mediumTermAnalytics.mjs";

export const EVIDENCE_TTL_MS = Object.freeze({
  ticker: 10_000,
  candles: 120_000,
  microstructure: 15_000,
  account: 60_000,
  global: 120_000,
  smartMoney: 60_000,
  contractSpec: 3_600_000
});

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const ageMs = (value, at = Date.now()) => {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, at - timestamp) : null;
};
const newestTimestamp = (...values) => values.filter(Boolean).sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;
const expired = (value, ttlMs, at = Date.now()) => {
  const age = ageMs(value, at);
  return age == null || age > ttlMs;
};
export const normalizeEvidenceSymbol = (value) => {
  const raw = String(value || "").toUpperCase().replace(/-SWAP$/, "");
  if (raw.includes("/")) return raw;
  if (raw.includes("-")) return raw.replace("-", "/");
  return raw.endsWith("USDT") ? `${raw.slice(0, -4)}/USDT` : raw;
};

export function explicitSymbolsForEvidence(text = "", maxSymbols = 8) {
  const found = [];
  const push = (symbol) => {
    const normalized = normalizeEvidenceSymbol(symbol);
    if (!/^[A-Z0-9]{2,15}\/USDT$/.test(normalized) || found.includes(normalized)) return;
    found.push(normalized);
  };
  const source = String(text || "").toUpperCase();
  for (const match of source.matchAll(/\b([A-Z0-9]{2,15})(?:\/USDT|-USDT(?:-SWAP)?|USDT)\b/g)) push(`${match[1]}/USDT`);
  return found.slice(0, Math.max(0, Number(maxSymbols || 0)));
}

export function symbolsForEvidence(text = "", mandate = null, maxSymbols = 3) {
  const found = explicitSymbolsForEvidence(text, maxSymbols);
  const push = (symbol) => {
    const normalized = normalizeEvidenceSymbol(symbol);
    if (!/^[A-Z0-9]{2,15}\/USDT$/.test(normalized) || found.includes(normalized)) return;
    found.push(normalized);
  };
  for (const symbol of mandate?.allowedSymbols || []) push(symbol);
  if (!found.length) push("BTC/USDT");
  return found.slice(0, Math.max(1, Number(maxSymbols || 3)));
}

function freshness(fetchedAt, ttlMs, now) {
  const age = ageMs(fetchedAt, now);
  return { fetchedAt: fetchedAt || null, ageMs: age, status: age == null ? "missing" : age <= ttlMs ? "fresh" : "stale" };
}

function evidenceId(kind, symbol, fetchedAt) {
  return `ev:${kind}:${symbol || "account"}:${fetchedAt || "missing"}`;
}

function compactAccount(db, snapshot, now) {
  const fresh = freshness(snapshot?.createdAt, EVIDENCE_TTL_MS.account, now);
  const balance = snapshot?.balances?.[0] || {};
  const usdt = (balance.details || []).find((row) => row.ccy === "USDT") || {};
  const positions = (snapshot?.positions || []).filter((row) => Number(row.pos ?? row.size ?? 0) !== 0);
  const totalEquityUsdt = finite(snapshot?.totalEquityUsdt ?? balance.totalEq) ? Number(snapshot?.totalEquityUsdt ?? balance.totalEq) : null;
  const availableMarginUsdt = finite(usdt.availEq ?? usdt.availBal) ? Number(usdt.availEq ?? usdt.availBal) : null;
  const valid = snapshot?.status === "ok" && totalEquityUsdt != null && availableMarginUsdt != null;
  return {
    evidenceId: evidenceId("account", "OKX", snapshot?.createdAt),
    source: "OKX_PRIVATE_API",
    endpoint: "account/balance+positions+orders",
    ...fresh,
    quality: valid ? "passed" : "failed",
    data: snapshot?.status === "ok" ? {
      totalEquityUsdt,
      availableMarginUsdt,
      positionCount: positions.length,
      openOrderCount: (snapshot.openOrders || []).length,
      positions: positions.slice(0, 8).map((row) => ({
        symbol: normalizeEvidenceSymbol(row.instId || row.symbol),
        direction: row.posSide || (Number(row.pos) < 0 ? "short" : "long"),
        contracts: Math.abs(Number(row.pos ?? row.size ?? 0)),
        entryPrice: finite(row.avgPx ?? row.entryPrice) ? Number(row.avgPx ?? row.entryPrice) : null,
        unrealizedPnl: finite(row.upl ?? row.unrealizedPnl) ? Number(row.upl ?? row.unrealizedPnl) : null
      }))
    } : null
  };
}

function compactAccounting(db, snapshot, now) {
  const fresh = freshness(snapshot?.createdAt, EVIDENCE_TTL_MS.account, now);
  return {
    evidenceId: evidenceId("accounting", "OKX", snapshot?.createdAt),
    source: "SYSTEM_ACCOUNTING_DERIVED_FROM_OKX",
    endpoint: "refreshAccounting(latest OKX private snapshot+fills)",
    ...fresh,
    quality: snapshot?.status === "ok" ? "passed" : "failed",
    data: snapshot?.status === "ok" ? {
      todayPnlUsdt: finite(db.portfolio?.todayPnl) ? Number(db.portfolio.todayPnl) : null,
      unrealizedPnlUsdt: finite(db.portfolio?.unrealizedPnl) ? Number(db.portfolio.unrealizedPnl) : null,
      remainingDailyLossUsdt: finite(db.system?.remainingDailyLossUsdt) ? Number(db.system.remainingDailyLossUsdt) : null,
      dailyLossCapUsdt: finite(db.system?.dailyLossCapUsdt) ? Number(db.system.dailyLossCapUsdt) : null
    } : null
  };
}

function compactSymbolEvidence(db, symbol, spec, smartMoney, now, analytics = null) {
  const market = (db.markets || []).find((row) => row.symbol === symbol) || {};
  const candleSlot = market.candlesByTf?.["1h"] || {};
  const candleQuality = market.candleQualityByTf?.["1h"] || (market.candleQuality?.timeframe === "1h" ? market.candleQuality : null);
  const tickerFetchedAt = newestTimestamp(market.lastRealtimeAt, market.tickerSyncedAt, market.lastSyncedAt);
  const streamIsNewest = tickerFetchedAt && market.lastRealtimeAt === tickerFetchedAt;
  const tickerFresh = freshness(tickerFetchedAt, EVIDENCE_TTL_MS.ticker, now);
  const candleFresh = freshness(candleSlot.syncedAt || market.candlesSyncedAt, EVIDENCE_TTL_MS.candles, now);
  const microFresh = freshness(market.microSyncedAt, EVIDENCE_TTL_MS.microstructure, now);
  const smartFresh = freshness(smartMoney?.fetchedAt, EVIDENCE_TTL_MS.smartMoney, now);
  const specFresh = freshness(spec?.fetchedAt, EVIDENCE_TTL_MS.contractSpec, now);
  const lastCandle = (candleSlot.candles || market.candles || []).at(-1);
  const specValid = finite(spec?.ctVal) && Number(spec.ctVal) > 0
    && finite(spec?.minSz) && Number(spec.minSz) > 0
    && finite(spec?.lotSz) && Number(spec.lotSz) > 0
    && finite(spec?.tickSz) && Number(spec.tickSz) > 0;
  const mediumTerm = (analytics || buildMediumTermAnalytics(db, { now })).symbols.find((row) => row.symbol === symbol) || null;
  return {
    symbol,
    ticker: {
      evidenceId: evidenceId("ticker", symbol, tickerFresh.fetchedAt), source: streamIsNewest ? "OKX_PUBLIC_STREAM" : "OKX_PUBLIC_API", endpoint: streamIsNewest ? "tickers channel" : "/api/v5/market/ticker",
      ...tickerFresh, quality: finite(market.price) && Number(market.price) > 0 ? "passed" : "failed",
      data: finite(market.price) ? { price: Number(market.price), high24h: finite(market.high24h) ? Number(market.high24h) : null, low24h: finite(market.low24h) ? Number(market.low24h) : null, change24hPct: finite(market.changePct) ? Number(market.changePct) : null, sourceAt: streamIsNewest ? null : market.tickerSourceAt || null } : null
    },
    candles: {
      evidenceId: evidenceId("candles", symbol, candleFresh.fetchedAt), source: "OKX_PUBLIC_API", endpoint: "/api/v5/market/candles",
      ...candleFresh, quality: candleQuality?.status === "passed" ? "passed" : candleQuality?.status || "missing",
      data: lastCandle ? { timeframe: "1h", closedBars: (candleSlot.candles || market.candles || []).length, lastClosedAt: new Date(lastCandle.time).toISOString(), lastClosedPrice: Number(lastCandle.close) } : null
    },
    microstructure: {
      evidenceId: evidenceId("micro", symbol, microFresh.fetchedAt), source: "OKX_PUBLIC_API", endpoint: "funding-rate+open-interest+books",
      ...microFresh, quality: finite(market.spreadBps) && Number(market.spreadBps) >= 0 && finite(market.depthUsdt) && Number(market.depthUsdt) > 0 && finite(market.fundingRate) && finite(market.openInterest) ? "passed" : "failed",
      data: { fundingRatePct: finite(market.fundingRate) ? Number(market.fundingRate) : null, openInterest: finite(market.openInterest) ? Number(market.openInterest) : null, spreadBps: finite(market.spreadBps) ? Number(market.spreadBps) : null, depthUsdt: finite(market.depthUsdt) ? Number(market.depthUsdt) : null, bookImbalancePct: finite(market.bookImbalancePct) ? Number(market.bookImbalancePct) : null, sourceTimestamps: market.microSourceTimestamps || null }
    },
    contractSpec: {
      evidenceId: evidenceId("contract_spec", symbol, spec?.fetchedAt), source: "OKX_PUBLIC_API", endpoint: "/api/v5/public/instruments",
      ...specFresh, quality: specValid ? "passed" : "failed",
      data: specValid ? { ctVal: Number(spec.ctVal), minSz: Number(spec.minSz), lotSz: Number(spec.lotSz), tickSz: Number(spec.tickSz) } : null
    },
    smartMoney: {
      evidenceId: evidenceId("smart_money", symbol, smartFresh.fetchedAt), source: "OKX_RUBIK_API+PUBLIC_WS", endpoint: "top-trader-ratio+taker-volume+liquidation-orders-channel",
      ...smartFresh, quality: smartMoney?.ok ? "passed" : "unavailable",
      data: smartMoney?.ok ? { topTraderLongShortRatio: smartMoney.topTraderLongShortRatio ?? null, retailLongShortRatio: smartMoney.retailLongShortRatio ?? null, takerBuySellRatio: smartMoney.takerBuySellRatio ?? null, takerScope: smartMoney.takerScope ?? null, takerInstrument: smartMoney.takerInstrument ?? null } : null
    },
    mediumTerm: {
      evidenceId: evidenceId("medium_term", symbol, mediumTerm?.latestAt), source: "SYSTEM_DERIVED_FROM_OKX_5M_FACTS", endpoint: "mediumTermAnalytics",
      ...freshness(mediumTerm?.latestAt, 10 * 60_000, now),
      quality: mediumTerm?.windows?.["15m"]?.status === "ok" ? "passed" : "insufficient",
      data: mediumTerm
    }
  };
}

export function evaluateEvidenceReadiness(bundle, symbol, { live = true } = {}) {
  const row = bundle?.symbols?.find((item) => item.symbol === normalizeEvidenceSymbol(symbol));
  const blockers = [];
  if (!row || row.ticker.status !== "fresh" || row.ticker.quality !== "passed") blockers.push("ticker_not_fresh");
  if (!row || row.candles.status !== "fresh" || row.candles.quality !== "passed") blockers.push("closed_candles_not_fresh_or_invalid");
  if (!row || row.microstructure.status !== "fresh" || row.microstructure.quality !== "passed") blockers.push("microstructure_not_fresh");
  if (!row || row.contractSpec.status !== "fresh" || row.contractSpec.quality !== "passed") blockers.push("contract_spec_unavailable");
  if (live && (!bundle.account || bundle.account.status !== "fresh" || bundle.account.quality !== "passed")) blockers.push("account_snapshot_not_fresh");
  return { ready: blockers.length === 0, blockers };
}

export async function buildForcedEvidenceBundle(db, options = {}) {
  const startedAt = Date.now();
  const now = Date.now();
  const mandate = options.mandate || (db.mandates || []).find((row) => ["active", "running"].includes(row.status));
  const symbols = (options.symbols?.length ? options.symbols : symbolsForEvidence(options.text, mandate, options.maxSymbols || 3)).map(normalizeEvidenceSymbol);
  const refreshErrors = [];
  const smartResults = new Map();
  const specResults = new Map();
  const jobs = [];
  const shouldRefresh = options.refresh !== false;
  const baseBundle = options.baseBundle || db.evidenceBundles?.[0] || null;

  for (const symbol of symbols) {
    const market = (db.markets || []).find((row) => row.symbol === symbol) || {};
    if (shouldRefresh && (expired(newestTimestamp(market.lastRealtimeAt, market.tickerSyncedAt, market.lastSyncedAt), EVIDENCE_TTL_MS.ticker, now) || !finite(market.price) || Number(market.price) <= 0)) {
      jobs.push(syncPublicMarket(db, "OKX", symbol).catch((error) => refreshErrors.push({ scope: symbol, kind: "ticker", error: error.message })));
    }
    const candleAt = market.candlesByTf?.["1h"]?.syncedAt || market.candlesSyncedAt;
    const oneHourQuality = market.candleQualityByTf?.["1h"] || (market.candleQuality?.timeframe === "1h" ? market.candleQuality : null);
    if (shouldRefresh && (expired(candleAt, EVIDENCE_TTL_MS.candles, now) || oneHourQuality?.status !== "passed")) {
      jobs.push(syncPublicKlines(db, "OKX", symbol, "1h").catch((error) => refreshErrors.push({ scope: symbol, kind: "candles", error: error.message })));
    }
    if (shouldRefresh && (expired(market.microSyncedAt, EVIDENCE_TTL_MS.microstructure, now) || !finite(market.spreadBps))) {
      jobs.push(syncMicrostructure(db, "OKX", symbol).catch((error) => refreshErrors.push({ scope: symbol, kind: "microstructure", error: error.message })));
    }
    const previous = baseBundle?.symbols?.find((row) => row.symbol === symbol);
    if (shouldRefresh && expired(previous?.contractSpec?.fetchedAt, EVIDENCE_TTL_MS.contractSpec, now)) {
      jobs.push(okxContractSpec(`${symbol.replace("/", "-")}-SWAP`)
        .then((spec) => specResults.set(symbol, spec || null))
        .catch((error) => refreshErrors.push({ scope: symbol, kind: "contract_spec", error: error.message })));
    }
    if (shouldRefresh && expired(previous?.smartMoney?.fetchedAt, EVIDENCE_TTL_MS.smartMoney, now)) {
      jobs.push(fetchSmartMoney(symbol)
        .then((result) => smartResults.set(symbol, result))
        .catch((error) => refreshErrors.push({ scope: symbol, kind: "smart_money", error: error.message })));
    }
  }

  const globalAt = db.marketRegime?.global?.fetchedAt;
  if (shouldRefresh && expired(globalAt, EVIDENCE_TTL_MS.global, now)) {
    jobs.push(fetchGlobalMarket().then((global) => { db.marketRegime = { ...(db.marketRegime || {}), global, updatedAt: nowIso() }; })
      .catch((error) => refreshErrors.push({ scope: "global", kind: "market_breadth", error: error.message })));
  }

  const live = options.live ?? db.system?.liveTradingEnabled === true;
  const accountRequired = live || options.requireAccount === true || /(账户|余额|净值|保证金|持仓|仓位|盈亏)/i.test(String(options.text || ""));
  const account = (db.exchangeAccounts || []).find((row) => row.exchange === "OKX" && row.readEnabled);
  const currentSnapshot = latestSuccessfulAccountSnapshot(db, { exchange: "OKX" });
  if (shouldRefresh && accountRequired && account && expired(currentSnapshot?.createdAt, EVIDENCE_TTL_MS.account, now)) {
    jobs.push(syncPrivateReadOnly(db, account.id).catch((error) => refreshErrors.push({ scope: "account", kind: "private_snapshot", error: error.message })));
  }

  await Promise.all(jobs);
  try { refreshAccounting(db); } catch { /* Evidence still records missing accounting fields honestly. */ }
  const generatedAt = nowIso();
  const snapshot = latestSuccessfulAccountSnapshot(db, { exchange: "OKX" });
  const mediumTermAnalytics = buildMediumTermAnalytics(db);
  const bundle = {
    id: `evb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    version: 1,
    generatedAt,
    sourcePolicy: "OKX_ONLY_FOR_MARKET_ACCOUNT_EXECUTION",
    mode: "forced_prefetch_with_ttl",
    symbols: symbols.map((symbol) => {
      const previous = baseBundle?.symbols?.find((row) => row.symbol === symbol);
      const priorSpec = previous?.contractSpec?.data ? { ...previous.contractSpec.data, fetchedAt: previous.contractSpec.fetchedAt } : null;
      const priorSmart = previous?.smartMoney?.data ? { ...previous.smartMoney.data, fetchedAt: previous.smartMoney.fetchedAt, ok: previous.smartMoney.quality === "passed" } : null;
      return compactSymbolEvidence(db, symbol, specResults.get(symbol) || priorSpec, smartResults.get(symbol) || priorSmart, Date.now(), mediumTermAnalytics);
    }),
    account: compactAccount(db, snapshot, Date.now()),
    accounting: compactAccounting(db, snapshot, Date.now()),
    global: db.marketRegime?.global ? {
      evidenceId: evidenceId("global", "OKX", db.marketRegime.global.fetchedAt), source: "OKX_PUBLIC_API", endpoint: "/api/v5/market/tickers?instType=SWAP",
      ...freshness(db.marketRegime.global.fetchedAt, EVIDENCE_TTL_MS.global, Date.now()), quality: db.marketRegime.global.ok ? "passed" : "failed",
      data: { breadthPct: db.marketRegime.global.breadthPct ?? null, medianChangePct: db.marketRegime.global.medianChangePct ?? null, btcChangePct: db.marketRegime.global.btcChangePct ?? null }
    } : null,
    refreshErrors,
    mediumTermEventVolatility: mediumTermAnalytics.eventVolatility,
    mediumTermPortfolioBtcRisk: mediumTermAnalytics.portfolioBtcRisk,
    latencyMs: Date.now() - startedAt
  };
  bundle.readiness = Object.fromEntries(symbols.map((symbol) => [symbol, evaluateEvidenceReadiness(bundle, symbol, { live })]));
  bundle.criticalReady = Object.values(bundle.readiness).every((row) => row.ready);
  bundle.blockers = [...new Set(Object.values(bundle.readiness).flatMap((row) => row.blockers))];
  bundle.supplementalWarnings = bundle.symbols.flatMap((row) => [
    ...(row.smartMoney.quality === "passed" ? [] : [`${row.symbol}:smart_money_unavailable`]),
    ...(row.mediumTerm.quality === "passed" ? [] : [`${row.symbol}:medium_term_window_insufficient`]),
    ...(row.mediumTerm.data?.windows?.["1h"]?.cvd != null ? [] : [`${row.symbol}:medium_term_cvd_insufficient`])
  ]);
  db.evidenceBundles ||= [];
  db.evidenceBundles.unshift(bundle);
  if (db.evidenceBundles.length > 50) db.evidenceBundles = db.evidenceBundles.slice(0, 50);
  return bundle;
}

export function snapshotEvidenceFromState(db, baseBundle) {
  if (!baseBundle) return null;
  const generatedAt = nowIso();
  const mediumTermAnalytics = buildMediumTermAnalytics(db);
  const symbols = (baseBundle.symbols || []).map((previous) => {
    const spec = previous.contractSpec?.data ? { ...previous.contractSpec.data, fetchedAt: previous.contractSpec.fetchedAt } : null;
    const smart = previous.smartMoney?.data ? { ...previous.smartMoney.data, fetchedAt: previous.smartMoney.fetchedAt, ok: previous.smartMoney.quality === "passed" } : null;
    return compactSymbolEvidence(db, previous.symbol, spec, smart, Date.now(), mediumTermAnalytics);
  });
  const bundle = {
    ...baseBundle,
    generatedAt,
    symbols,
    account: compactAccount(db, latestSuccessfulAccountSnapshot(db, { exchange: "OKX" }), Date.now()),
    accounting: compactAccounting(db, latestSuccessfulAccountSnapshot(db, { exchange: "OKX" }), Date.now()),
    mediumTermEventVolatility: mediumTermAnalytics.eventVolatility,
    mediumTermPortfolioBtcRisk: mediumTermAnalytics.portfolioBtcRisk,
    global: db.marketRegime?.global ? {
      evidenceId: evidenceId("global", "OKX", db.marketRegime.global.fetchedAt), source: "OKX_PUBLIC_API", endpoint: "/api/v5/market/tickers?instType=SWAP",
      ...freshness(db.marketRegime.global.fetchedAt, EVIDENCE_TTL_MS.global, Date.now()), quality: db.marketRegime.global.ok ? "passed" : "failed",
      data: { breadthPct: db.marketRegime.global.breadthPct ?? null, medianChangePct: db.marketRegime.global.medianChangePct ?? null, btcChangePct: db.marketRegime.global.btcChangePct ?? null }
    } : null
  };
  const live = db.system?.liveTradingEnabled === true;
  bundle.readiness = Object.fromEntries(symbols.map((row) => [row.symbol, evaluateEvidenceReadiness(bundle, row.symbol, { live })]));
  bundle.criticalReady = Object.values(bundle.readiness).every((row) => row.ready);
  bundle.blockers = [...new Set(Object.values(bundle.readiness).flatMap((row) => row.blockers))];
  bundle.supplementalWarnings = bundle.symbols.flatMap((row) => [
    ...(row.smartMoney.quality === "passed" ? [] : [`${row.symbol}:smart_money_unavailable`]),
    ...(row.mediumTerm.quality === "passed" ? [] : [`${row.symbol}:medium_term_window_insufficient`]),
    ...(row.mediumTerm.data?.windows?.["1h"]?.cvd != null ? [] : [`${row.symbol}:medium_term_cvd_insufficient`])
  ]);
  return bundle;
}

export function compactEvidenceForPrompt(bundle) {
  if (!bundle) return "证据包不可用。";
  const lines = [`证据包 ${bundle.id}｜生成 ${bundle.generatedAt}｜关键证据 ${bundle.criticalReady ? "齐全" : `不齐全(${bundle.blockers.join(",")})`}`];
  for (const row of bundle.symbols || []) {
    lines.push(`- ${row.symbol}：现价 ${row.ticker.data?.price ?? "不可用"}[${row.ticker.status}·${row.ticker.evidenceId}]；1H闭合K线 ${row.candles.data?.closedBars ?? "不可用"}${row.candles.data?.closedBars == null ? "" : " 根"}[${row.candles.status}/${row.candles.quality}·${row.candles.evidenceId}]；点差 ${row.microstructure.data?.spreadBps ?? "不可用"}${row.microstructure.data?.spreadBps == null ? "" : "bps"}/深度 ${row.microstructure.data?.depthUsdt ?? "不可用"}[${row.microstructure.status}·${row.microstructure.evidenceId}]；合约规格 ${row.contractSpec.quality}[${row.contractSpec.evidenceId}]；聪明钱 ${row.smartMoney.quality}[${row.smartMoney.evidenceId}]`);
    const mt = row.mediumTerm?.data;
    if (mt) {
      const parts = ["15m", "1h", "4h"].map((tf) => {
        const w = mt.windows?.[tf];
        return !w || w.status !== "ok" ? `${tf}=样本不足` : `${tf}:价${w.priceChangePct}%/OI${w.oiChangePct}%/Funding${w.fundingEndPct ?? "不足"}%(${w.fundingChangePp ?? "变化不足"}pp)/${w.leverageState}/CVD净量${w.cvd ?? "不足"}(失衡${w.cvdImbalancePct ?? "不足"}%,覆盖${w.flowCoveragePct ?? 0}%)/${w.divergence}`;
      });
      const betaParts = ["24h", "3d", "7d"].map((window) => {
        const value = mt.btcRisk?.[window];
        return value?.status === "ok" ? `${window}相关${value.correlation}/Beta${value.beta}` : `${window}样本不足`;
      });
      lines.push(`  中频事实[${row.mediumTerm.status}/${row.mediumTerm.quality}·${row.mediumTerm.evidenceId}]：${parts.join("；")}${mt.btcRisk ? `；BTC风险 ${betaParts.join("、")}` : ""}`);
    }
  }
  const eventStats = bundle.mediumTermEventVolatility;
  if (eventStats) {
    const summary = Object.entries(eventStats.byType || {}).map(([type, value]) => value.status === "usable"
      ? `${type}:n=${value.samples},前1h RV=${value.avgPre1hRealizedVolPct}%,后15m/1h/4h RV=${value.avgPost15mRealizedVolPct}/${value.avgPost1hRealizedVolPct}/${value.avgPost4hRealizedVolPct}%,1h波动倍数中位=${value.medianPost1hVolExpansionRatio}(${value.typicalReaction},${value.confidence})`
      : `${type}:n=${value.samples},样本不足`).join("；");
    if (summary) lines.push(`- BTC宏观事件波动统计：${summary}`);
  }
  const portfolioBtcRisk = bundle.mediumTermPortfolioBtcRisk;
  if (portfolioBtcRisk && !["no_positions", "insufficient"].includes(portfolioBtcRisk.status)) {
    lines.push(`- 组合BTC Beta敞口[${portfolioBtcRisk.status}]：净等效 ${portfolioBtcRisk.netBtcEquivalentUsdt} USDT，毛等效 ${portfolioBtcRisk.grossBtcBetaExposureUsdt} USDT，对冲抵消 ${portfolioBtcRisk.hedgeOffsetPct ?? "不可用"}%`);
  }
  const account = bundle.account;
  lines.push(`- 账户：${account.status}/${account.quality}[${account.evidenceId}]，净值 ${account.data?.totalEquityUsdt ?? "不可用"}，可用保证金 ${account.data?.availableMarginUsdt ?? "不可用"}，持仓 ${account.data?.positionCount ?? "不可确认"}`);
  const accounting = bundle.accounting;
  if (accounting) lines.push(`- 账户派生核算：${accounting.status}/${accounting.quality}[${accounting.evidenceId}]，今日盈亏 ${accounting.data?.todayPnlUsdt ?? "不可用"}，未实现盈亏 ${accounting.data?.unrealizedPnlUsdt ?? "不可用"}，剩余日亏容忍额 ${accounting.data?.remainingDailyLossUsdt ?? "不可用"}`);
  lines.push("纪律：方括号内为事实证据 ID。只能把 fresh/passed 数据写成当前事实；stale/missing/error 必须写不可确认。方向、因果、支撑阻力属于推断，必须明确标为判断而不是 API 事实。");
  return lines.join("\n");
}
