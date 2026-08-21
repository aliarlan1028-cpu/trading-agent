import crypto from "node:crypto";
import { appendAudit, appendTrace, id, latestSuccessfulAccountSnapshot, nowIso } from "./store.mjs";
import { canonicalPositionDirection } from "./positionIdentity.mjs";
import { enforceOhlcvQuality } from "./ohlcvQuality.mjs";
import { okxEnvironmentConfig, okxRestUrl } from "./okxEnvironment.mjs";
import { scrubSecrets } from "./secretRedaction.mjs";
import { applyTickerObservation, timestampEvidence } from "./marketObservation.mjs";
import { refreshOwnerImprovementRegistry } from "./ownerReviewLoop.mjs";
import { awaitAbortableOperation } from "./abortableOperation.mjs";

const BINANCE_SPOT_BASE = process.env.BINANCE_SPOT_BASE_URL
  || (process.env.BINANCE_TESTNET === "true" ? "https://testnet.binance.vision" : "https://api.binance.com");
const BINANCE_USDM_BASE = process.env.BINANCE_USDM_BASE_URL
  || (process.env.BINANCE_TESTNET === "true" ? "https://testnet.binancefuture.com" : "https://fapi.binance.com");
const okxTickerUrl = () => okxRestUrl("/api/v5/market/ticker");

export function currentOkxCredentialFingerprint() {
  const apiKey = process.env.OKX_API_KEY || "";
  return apiKey ? crypto.createHash("sha256").update(apiKey).digest("hex").slice(0, 16) : null;
}

export function enabledOkxAccounts(db = {}) {
  return (db.exchangeAccounts || []).filter((account) => account.exchange === "OKX" && (account.readEnabled || account.tradeEnabled));
}

export function readableOkxAccounts(db = {}) {
  return (db.exchangeAccounts || []).filter((account) => account.exchange === "OKX" && account.readEnabled === true);
}

export function tradableOkxAccounts(db = {}) {
  return (db.exchangeAccounts || []).filter((account) => account.exchange === "OKX" && account.tradeEnabled === true);
}

export function validateOkxCredentialBinding(db = {}, options = {}) {
  const currentFingerprint = currentOkxCredentialFingerprint();
  const enabled = enabledOkxAccounts(db);
  if (!currentFingerprint) return { ok: false, reason: "okx_credential_fingerprint_unavailable" };
  if (enabled.length !== 1) return { ok: false, reason: "single_okx_account_required", enabledAccountIds: enabled.map((row) => row.id) };
  const account = enabled[0];
  const capability = options.requiredCapability || "read";
  if (capability === "read" && account.readEnabled !== true) return { ok: false, reason: "okx_account_read_disabled", accountId: account.id };
  if (capability === "trade" && account.tradeEnabled !== true) return { ok: false, reason: "okx_account_trade_disabled", accountId: account.id };
  if (capability === "emergency_reduce" && account.tradeEnabled !== true && account.readEnabled !== true) {
    return { ok: false, reason: "okx_account_emergency_write_not_authorized", accountId: account.id };
  }
  if (options.accountId && options.accountId !== account.id) return { ok: false, reason: "okx_account_binding_mismatch", accountId: account.id };
  if (!account.apiKeyFingerprint || account.apiKeyFingerprint !== currentFingerprint) {
    return { ok: false, reason: "okx_account_credential_fingerprint_mismatch", accountId: account.id };
  }
  if (options.snapshot && options.snapshot.apiKeyFingerprint !== currentFingerprint) {
    return { ok: false, reason: "okx_snapshot_credential_fingerprint_mismatch", snapshotId: options.snapshot.id || null };
  }
  if (options.executionFingerprint && options.executionFingerprint !== currentFingerprint) {
    return { ok: false, reason: "okx_execution_credential_fingerprint_mismatch" };
  }
  return { ok: true, account, currentFingerprint };
}

export function toBinanceSymbol(symbol) {
  return String(symbol || "BTC/USDT").replace("/", "").replace("-", "").toUpperCase();
}

export function toOkxSymbol(symbol, marketType = "") {
  const instId = String(symbol || "BTC/USDT").replace("/", "-").toUpperCase();
  const normalizedMarket = String(marketType || "").toLowerCase();
  if ((normalizedMarket.includes("perpetual") || normalizedMarket.includes("swap")) && !instId.endsWith("-SWAP")) {
    return `${instId}-SWAP`;
  }
  return instId;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error(String(signal.reason || "outbound_aborted"));
}

function timeoutSignal(ms = 6000, parentSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const relayAbort = () => controller.abort(parentSignal.reason);
  if (parentSignal?.aborted) relayAbort();
  else parentSignal?.addEventListener("abort", relayAbort, { once: true });
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", relayAbort);
    }
  };
}

export function refreshApiKeyMetadata(db) {
  for (const item of db.apiKeyMetadata || []) {
    const previousFingerprint = item.apiKeyFingerprint || null;
    let apiKey = "";
    if (item.exchange === "BINANCE") {
      apiKey = process.env.BINANCE_API_KEY || "";
      item.hasApiKey = Boolean(process.env.BINANCE_API_KEY);
      item.hasSecret = Boolean(process.env.BINANCE_API_SECRET);
    }
    if (item.exchange === "OKX") {
      apiKey = process.env.OKX_API_KEY || "";
      item.hasApiKey = Boolean(process.env.OKX_API_KEY);
      item.hasSecret = Boolean(process.env.OKX_API_SECRET && process.env.OKX_API_PASSPHRASE);
    }
    const fingerprint = item.exchange === "OKX" ? currentOkxCredentialFingerprint()
      : apiKey ? crypto.createHash("sha256").update(apiKey).digest("hex").slice(0, 16) : null;
    item.apiKeyFingerprint = fingerprint;
    if (!fingerprint || previousFingerprint !== fingerprint) {
      item.withdrawPermission = false;
      delete item.permissionVerifiedAt;
      delete item.permissionVerificationStatus;
      delete item.permissionVerificationNote;
      delete item.manualWithdrawPermissionConfirmedAt;
      delete item.manualWithdrawPermissionConfirmedBy;
      delete item.ipRestrict;
      delete item.enableReading;
      delete item.enableFutures;
      delete item.enableSpotAndMarginTrading;
    }
    item.secretInLogs = false;
    item.updatedAt = nowIso();
  }
  for (const account of db.exchangeAccounts || []) {
    const metadata = db.apiKeyMetadata.find((key) => key.accountId === account.id);
    const previousFingerprint = account.apiKeyFingerprint || null;
    const nextFingerprint = metadata?.apiKeyFingerprint || null;
    // 凭证是否存在与管理员是否授权是两个独立事实。这里只刷新凭证状态，
    // 绝不能因为一次 GET/启动刷新而把用户明确关闭的读写权限重新打开。
    account.credentialPresent = Boolean(metadata?.hasApiKey && metadata?.hasSecret);
    account.apiKeyFingerprint = nextFingerprint;
    if (previousFingerprint && nextFingerprint && previousFingerprint !== nextFingerprint) {
      account.readEnabled = false;
      account.tradeEnabled = false;
      account.authorizationResetReason = "credential_fingerprint_changed";
      account.authorizationResetAt = nowIso();
    }
    if (!account.credentialPresent) {
      account.readEnabled = false;
      account.tradeEnabled = false;
    }
    account.withdrawEnabled = false;
    account.status = account.credentialPresent
      ? (account.readEnabled || account.tradeEnabled ? "configured" : "authorization_disabled")
      : "missing_credentials";
  }
  return db.apiKeyMetadata;
}

async function fetchPublicTicker(symbol, signal) {
  const timer = timeoutSignal(6000, signal);
  try {
    const instId = toOkxSymbol(symbol, "perpetual");
    const response = await awaitAbortableOperation(
      () => fetch(`${okxTickerUrl()}?instId=${encodeURIComponent(instId)}`, { signal: timer.signal }),
      timer.signal
    );
    if (!response.ok) throw new Error(`OKX ticker HTTP ${response.status}`);
    const payload = await awaitAbortableOperation(() => response.json(), timer.signal);
    if (String(payload?.code ?? "0") !== "0") throw new Error(`OKX ticker API ${payload?.code}: ${payload?.msg || "unknown error"}`);
    const ticker = payload.data?.[0];
    if (!ticker) throw new Error("OKX ticker missing data");
    const last = Number(ticker.last);
    const open24h = Number(ticker.open24h);
    if (!Number.isFinite(last) || last <= 0) throw new Error("OKX ticker invalid last price");
    return {
      exchange: "OKX",
      symbol: instId,
      price: last,
      high24h: Number(ticker.high24h),
      low24h: Number(ticker.low24h),
      changePct: Number.isFinite(last) && Number.isFinite(open24h) && open24h > 0
        ? Number((((last - open24h) / open24h) * 100).toFixed(2))
        : null,
      volume24h: ticker.volCcy24h,
      rawTime: ticker.ts
    };
  } finally {
    timer.cancel();
  }
}

// 高频只读场景（观察哨每分钟核对）用：拉一次 ticker，不写审计/trace，不动 db。
export async function fetchTickerQuiet(symbol, exchange = "OKX", options = {}) {
  return fetchPublicTicker(symbol, options.signal);
}

// 中频采样专用：复用公开 ticker 但不写审计/trace，避免每2分钟每币制造运维噪声。
export async function syncPublicMarketQuiet(db, symbol = "BTC/USDT", options = {}) {
  const ticker = await fetchPublicTicker(symbol, options.signal);
  const displaySymbol = symbol.includes("/") ? symbol : symbol.replace("USDT", "/USDT");
  db.markets ||= [];
  let market = db.markets.find((item) => item.symbol === displaySymbol);
  if (!market) { market = { symbol: displaySymbol, candles: [], status: "not_synced" }; db.markets.push(market); }
  const applied = applyTickerObservation(market, { ...ticker, source: "OKX_REST", sourceAt: ticker.rawTime });
  // 公有 WS 与 REST 同时更新 ticker 时，REST 响应很容易比刚收到的 WS tick 更旧。
  // 这是正常的防乱序 no-op，不是行情刷新失败；若在这里抛错，调用方会跳过同一币种
  // 后续独立的订单簿/OI/资金费率刷新，最终把微观结构饿死并触发全局暂停新开仓。
  if (!applied.applied && applied.reason === "out_of_order") {
    return {
      ...ticker,
      price: market.price,
      rawTime: market.tickerSourceAt,
      observationApplied: false,
      observationReason: applied.reason
    };
  }
  if (!applied.applied) throw new Error(`ticker_observation_rejected:${applied.reason}`);
  market.lastSyncedExchange = ticker.exchange;
  market.lastSyncedAt = market.tickerReceivedAt;
  return { ...ticker, observationApplied: true, observationReason: null };
}

// 拉 OKX 资金费率历史，返回 |资金费率%| 的第 pct 百分位——给"资金费率极端"做该币自适应阈值
// （BTC 和小币的"极端"不是一个量级）。失败/样本不足返回 null，由调用方回落固定阈值。
export async function fetchFundingPercentile(symbol, pct = 85) {
  try {
    const instId = toOkxSymbol(symbol, "swap"); // 资金费率是永续专属,必须用 -SWAP instId(现货无资金费率)
    const res = await fetch(okxRestUrl(`/api/v5/public/funding-rate-history?instId=${encodeURIComponent(instId)}&limit=100`), { signal: globalThis.AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const j = await res.json();
    const vals = (j?.data || []).map((d) => Math.abs(Number(d.fundingRate) * 100)).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (vals.length < 10) return null;
    return vals[Math.min(vals.length - 1, Math.floor((pct / 100) * vals.length))];
  } catch { return null; }
}

export async function syncPublicMarket(db, exchange = "OKX", symbol = "BTC/USDT") {
  exchange = "OKX";
  const ticker = await fetchPublicTicker(symbol);
  const displaySymbol = symbol.includes("/") ? symbol : symbol.replace("USDT", "/USDT");
  db.markets ||= [];
  let market = db.markets.find((item) => item.symbol === displaySymbol);
  if (!market) {
    market = { symbol: displaySymbol, candles: [], status: "not_synced" };
    db.markets.push(market);
  }
  if (market) {
    const applied = applyTickerObservation(market, { ...ticker, source: "OKX_REST", sourceAt: ticker.rawTime }, { formatVolume: compactNumber });
    if (!applied.applied) throw new Error(`ticker_observation_rejected:${applied.reason}`);
    market.lastSyncedExchange = ticker.exchange;
    market.lastSyncedAt = market.tickerReceivedAt;
  }
  appendAudit(db, "同步公开行情", `${exchange}:${symbol}`, "ExchangeConnector");
  appendTrace(db, "exchange_market", `同步 ${exchange} ${symbol}`);
  return ticker;
}

const OKX_BARS = { "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D" };

async function fetchPublicKlines(exchange, symbol, timeframe = "1h", limit = 200, options = {}) {
  const tf = OKX_BARS[timeframe] ? timeframe : "1h";
  const timer = timeoutSignal(8000, options.signal);
  try {
    const url = okxRestUrl(`/api/v5/market/candles?instId=${encodeURIComponent(toOkxSymbol(symbol, "perpetual"))}&bar=${OKX_BARS[tf]}&limit=${Math.min(limit, 300)}`);
    const response = await awaitAbortableOperation(() => fetch(url, { signal: timer.signal }), timer.signal);
    if (!response.ok) throw new Error(`OKX klines HTTP ${response.status}`);
    const payload = await awaitAbortableOperation(() => response.json(), timer.signal);
    if (String(payload?.code ?? "0") !== "0") throw new Error(`OKX klines API ${payload?.code}: ${payload?.msg || "unknown error"}`);
    const rows = (payload.data || []).map((row) => ({
      time: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
      confirmed: row[8] == null ? undefined : String(row[8]) === "1"
    })).reverse();
    return enforceOhlcvQuality(rows, { timeframe: tf }).candles;
  } finally {
    timer.cancel();
  }
}

// ---------------------------------------------------------------------------
// 市场微观结构：资金费率 / 未平仓量(OI) / 订单簿深度不平衡。
// 给 Agent 提供合约交易真正需要的"眼睛"。行情、盘口和实际执行必须来自同一 OKX 市场。
// ---------------------------------------------------------------------------
async function fetchMicrostructureRaw(exchange, symbol, options = {}) {
  const timer = timeoutSignal(8000, options.signal);
  try {
    const instId = toOkxSymbol(symbol, "perpetual");
    const getOkx = async (url, label) => {
      const response = await awaitAbortableOperation(() => fetch(url, { signal: timer.signal }), timer.signal);
      if (!response.ok) throw new Error(`OKX ${label} HTTP ${response.status}`);
      const payload = await awaitAbortableOperation(() => response.json(), timer.signal);
      if (String(payload?.code ?? "0") !== "0") throw new Error(`OKX ${label} API ${payload?.code}: ${payload?.msg || "unknown error"}`);
      if (!Array.isArray(payload?.data) || !payload.data.length) throw new Error(`OKX ${label} missing data`);
      return payload;
    };
    const [funding, oi, books] = await Promise.all([
      getOkx(okxRestUrl(`/api/v5/public/funding-rate?instId=${encodeURIComponent(instId)}`), "funding-rate"),
      getOkx(okxRestUrl(`/api/v5/public/open-interest?instId=${encodeURIComponent(instId)}`), "open-interest"),
      getOkx(okxRestUrl(`/api/v5/market/books?instId=${encodeURIComponent(instId)}&sz=20`), "books")
    ]);
    const book = books.data?.[0] || {};
    const result = {
      exchange: "OKX",
      symbol: instId,
      fundingRatePct: funding.data?.[0]?.fundingRate !== undefined ? Number(funding.data[0].fundingRate) * 100 : null,
      nextFundingRatePct: funding.data?.[0]?.nextFundingRate !== undefined ? Number(funding.data[0].nextFundingRate) * 100 : null,
      openInterest: oi.data?.[0]?.oiCcy !== undefined ? Number(oi.data[0].oiCcy) : (oi.data?.[0]?.oi !== undefined ? Number(oi.data[0].oi) : null),
      sourceTimestamps: {
        funding: funding.data?.[0]?.ts || funding.data?.[0]?.fundingTime || null,
        openInterest: oi.data?.[0]?.ts || null,
        book: book.ts || null
      },
      ...bookImbalance(book.bids, book.asks)
    };
    if (!Number.isFinite(result.fundingRatePct) || !Number.isFinite(result.openInterest) || result.openInterest < 0
      || !Number.isFinite(result.spreadBps) || result.spreadBps < 0
      || !Number.isFinite(result.depthUsdt) || result.depthUsdt <= 0) {
      throw new Error("OKX microstructure contains non-finite critical fields");
    }
    return result;
  } finally {
    timer.cancel();
  }
}

function bookImbalance(bids = [], asks = []) {
  const sum = (rows) => (rows || []).reduce((total, row) => total + Number(row[1] || 0), 0);
  const notional = (rows) => (rows || []).reduce((total, row) => total + Number(row[0] || 0) * Number(row[1] || 0), 0);
  const bidVol = sum(bids);
  const askVol = sum(asks);
  const total = bidVol + askVol;
  const bestBid = bids?.[0] ? Number(bids[0][0]) : null;
  const bestAsk = asks?.[0] ? Number(asks[0][0]) : null;
  return {
    bidVolume: Number(bidVol.toFixed(2)),
    askVolume: Number(askVol.toFixed(2)),
    depthUsdt: Number((notional(bids) + notional(asks)).toFixed(2)),
    bookImbalancePct: total > 0 ? Number(((bidVol / total) * 100).toFixed(1)) : null,
    bestBid,
    bestAsk,
    spreadBps: bestBid && bestAsk ? Number((((bestAsk - bestBid) / bestAsk) * 10000).toFixed(2)) : null
  };
}

// 同步微观结构并缓存到 market 对象，返回带解读的摘要。
export async function syncMicrostructure(db, exchange = "OKX", symbol = "BTC/USDT", options = {}) {
  const result = await fetchMicrostructureRaw("OKX", symbol, options);
  const usedExchange = "OKX";
  const displaySymbol = symbol.includes("/") ? symbol : symbol.replace("USDT", "/USDT");
  db.markets ||= [];
  let market = db.markets.find((item) => item.symbol === displaySymbol);
  if (!market) {
    market = { symbol: displaySymbol, candles: [], status: "not_synced" };
    db.markets.push(market);
  }
  const receivedAt = nowIso();
  const maxFutureSkewMs = Number(process.env.MAX_MARKET_FUTURE_SKEW_MS || 30_000);
  const sourceFacts = Object.fromEntries(Object.entries(result.sourceTimestamps || {}).map(([name, value]) => [name, timestampEvidence(value, { maxAgeMs: Infinity, maxFutureSkewMs })]));
  const invalidSource = Object.entries(sourceFacts).find(([, fact]) => !fact.ok);
  if (invalidSource) throw new Error(`microstructure_${invalidSource[0]}_source_${invalidSource[1].reason}`);
  const priorBookMs = new Date(market.bookSourceAt || market.microSourceTimestamps?.book || 0).getTime();
  if (Number.isFinite(priorBookMs) && priorBookMs > new Date(sourceFacts.book.observedAt).getTime()) throw new Error("microstructure_out_of_order");
  market.fundingRate = result.fundingRatePct;
  market.openInterest = result.openInterest;
  market.bookImbalancePct = result.bookImbalancePct;
  market.bidVolume = result.bidVolume;
  market.askVolume = result.askVolume;
  market.depthUsdt = result.depthUsdt;
  market.spreadBps = result.spreadBps;
  market.microSyncedAt = receivedAt;
  market.microReceivedAt = receivedAt;
  market.fundingSourceAt = sourceFacts.funding.observedAt;
  market.fundingReceivedAt = receivedAt;
  market.openInterestSourceAt = sourceFacts.openInterest.observedAt;
  market.openInterestReceivedAt = receivedAt;
  market.bookSourceAt = sourceFacts.book.observedAt;
  market.bookReceivedAt = receivedAt;
  market.microSourceTimestamps = {
    funding: sourceFacts.funding.observedAt,
    openInterest: sourceFacts.openInterest.observedAt,
    book: sourceFacts.book.observedAt
  };
  if (options.quiet !== true) appendTrace(db, "exchange_micro", `微观结构 ${usedExchange} ${symbol}`);
  const funding = result.fundingRatePct;
  const interpretation = [];
  if (Number.isFinite(funding)) {
    interpretation.push(Math.abs(funding) >= 0.05
      ? `资金费率 ${funding.toFixed(4)}% 偏高，${funding > 0 ? "多头" : "空头"}拥挤，反向挤压风险上升`
      : `资金费率 ${funding.toFixed(4)}% 中性`);
  }
  if (Number.isFinite(result.bookImbalancePct)) {
    interpretation.push(result.bookImbalancePct >= 58 ? "订单簿买盘占优" : result.bookImbalancePct <= 42 ? "订单簿卖盘占优" : "订单簿买卖均衡");
  }
  return { ...result, observedAt: market.microSyncedAt, interpretation: interpretation.join("；") || "微观结构数据不足" };
}

// OKX 分页取数：先取最近 300，再用 history-candles 用 after 往回翻，直到 target 根。
async function fetchOkxKlinesPaged(symbol, timeframe, target, options = {}) {
  const tf = OKX_BARS[timeframe] ? timeframe : "1h";
  const bar = OKX_BARS[tf];
  const inst = toOkxSymbol(symbol, "perpetual");
  const raw = [];
  const recentTimer = timeoutSignal(8000, options.signal);
  try {
    const response = await awaitAbortableOperation(() => fetch(okxRestUrl(`/api/v5/market/candles?instId=${encodeURIComponent(inst)}&bar=${bar}&limit=300`), { signal: recentTimer.signal }), recentTimer.signal);
    if (!response.ok) throw new Error(`OKX candles HTTP ${response.status}`);
    const payload = await awaitAbortableOperation(() => response.json(), recentTimer.signal);
    if (String(payload?.code ?? "0") !== "0") throw new Error(`OKX candles API ${payload?.code}: ${payload?.msg || "unknown error"}`);
    raw.push(...(payload.data || []));
  } finally {
    recentTimer.cancel();
  }
  let guard = 0;
  while (raw.length < target && guard < 32) {
    guard += 1;
    const oldest = raw[raw.length - 1]?.[0]; // data 为最新在前，末位最旧
    if (!oldest) break;
    const pageTimer = timeoutSignal(8000, options.signal);
    let batch;
    try {
      const response = await awaitAbortableOperation(() => fetch(okxRestUrl(`/api/v5/market/history-candles?instId=${encodeURIComponent(inst)}&bar=${bar}&after=${oldest}&limit=100`), { signal: pageTimer.signal }), pageTimer.signal);
      if (!response.ok) break;
      const payload = await awaitAbortableOperation(() => response.json(), pageTimer.signal);
      if (String(payload?.code ?? "0") !== "0") break;
      batch = payload.data || [];
    } catch {
      throwIfAborted(options.signal);
      break;
    } finally {
      pageTimer.cancel();
    }
    if (!batch.length) break;
    raw.push(...batch);
    if (batch.length < 100) break;
  }
  const rows = raw.slice(0, target).map((row) => ({
    time: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    confirmed: row[8] == null ? undefined : String(row[8]) === "1"
  })).reverse();
  return enforceOhlcvQuality(rows, { timeframe: tf }).candles;
}

// 回测用：只拉 OKX 历史 K 线，不允许用另一交易所数据替代执行市场。
// limit>300 时对 OKX 走分页，凑足样本（专业回测需要足够 bar）。
export async function getHistoricalKlines(symbol, timeframe = "1h", limit = 300, exchange = "OKX", options = {}) {
  if (limit > 300) {
    try {
      const paged = await fetchOkxKlinesPaged(symbol, timeframe, limit, options);
      if (paged.length >= 300) return paged;
    } catch {
      throwIfAborted(options.signal);
      /* 分页失败则回退单页 */
    }
  }
  return fetchPublicKlines("OKX", symbol, timeframe, limit, options);
}

export async function syncPublicKlines(db, exchange = "OKX", symbol = "BTC/USDT", timeframe = "1h", options = {}) {
  const displaySymbol = symbol.includes("/") ? symbol : symbol.replace("USDT", "/USDT");
  db.markets ||= [];
  let market = db.markets.find((item) => item.symbol === displaySymbol);
  if (!market) {
    market = { symbol: displaySymbol, candles: [], status: "not_synced" };
    db.markets.push(market);
  }
  let candles;
  try {
    candles = await fetchPublicKlines("OKX", symbol, timeframe, 200, options);
  } catch (error) {
    market.candleQuality = error?.report || { status: "failed", timeframe, issues: [{ type: error?.code || "fetch_failed" }], checkedAt: nowIso() };
    market.candleQualityByTf ||= {};
    market.candleQualityByTf[String(timeframe).toLowerCase()] = market.candleQuality;
    appendTrace(db, "exchange_market", `OKX ${symbol} ${timeframe} K线质量失败：${String(error?.message || error).slice(0, 160)}`, "blocked");
    throw error;
  }
  // sharedSlot=false 时只写 candlesByTf,不动共享 1h 槽(审计 #13:4h/1d 补拉曾把
  // 前端图表与相关性计算用的 candles 反复翻转成混合周期,跨频率相关性统计无效)。
  if (options.sharedSlot !== false) {
    market.candles = candles;
    market.candlesTimeframe = timeframe;
    market.candlesSyncedAt = nowIso();
  }
  market.candleQuality = { status: "passed", timeframe, accepted: candles.length, checkedAt: nowIso() };
  market.candleQualityByTf ||= {};
  market.candleQualityByTf[String(timeframe).toLowerCase()] = market.candleQuality;
  // 按周期各存一份（截尾 200 根）：知识技能可能声明 4h/1d 等非默认周期，
  // 若只有单一 candlesTimeframe，非 1h 技能会永远 candle_timeframe_mismatch 而静默失效。
  market.candlesByTf ||= {};
  market.candlesByTf[String(timeframe).toLowerCase()] = { candles: candles.slice(-200), syncedAt: nowIso() };
  if (candles.length) {
    const last = candles[candles.length - 1];
    // 闭合 K 线收盘价不是实时 ticker。并发 sync_market 时绝不能让 K 线请求
    // 覆盖刚取得的现价，或把 ticker 新鲜度伪装成刚更新。
    market.lastClosedPrice = last.close;
    if (!Number.isFinite(Number(market.price))) market.price = last.close;
    market.status = "synced";
    if (options.sharedSlot !== false) market.candlesSyncedAt = market.candlesByTf[String(timeframe).toLowerCase()].syncedAt;
  }
  appendTrace(db, "exchange_market", `同步 ${exchange} ${symbol} K线 ${timeframe}`);
  return { symbol: displaySymbol, timeframe, count: candles.length, latestClose: candles.at(-1)?.close };
}

// base 币种提取:BTC/USDT | BTCUSDT | BTC-USDT-SWAP → BTC
function reconBase(sym) {
  const s = String(sym || "").toUpperCase();
  if (/[-/]/.test(s)) return s.split(/[-/]/)[0];
  return s.replace(/(USDT|USDC|BUSD|USD)$/, "") || s;
}
// 交易所只读快照的真实持仓归一:OKX pos=张、Binance positionAmt=币,均与引擎 size 同口径
function reconSnapshotPositions(snap, db) {
  const map = new Map();
  for (const p of (snap.positions || [])) {
    const base = reconBase(p.instId || p.symbol || p.sym || "");
    // OKX SWAP 的 pos 是张数，而引擎 size 是币数量。必须使用 applyOkxSnapshot 已按 ctVal
    // 换算的 coinSize；拿不到合约面值时不能假装可比较。
    const normalized = snap.exchange === "OKX"
      ? (db.positions || []).find((item) => item.source === "exchange_rest" && item.exchange === "OKX"
          && reconBase(item.symbol) === base && item.rawSyncedAt === snap.createdAt)
      : null;
    const qty = snap.exchange === "OKX"
      ? Number(normalized?.coinSize)
      : Math.abs(Number(p.positionAmt ?? p.size));
    if (!Number.isFinite(qty)) {
      if (snap.exchange === "OKX") map.set(base, null);
      continue;
    }
    if (qty === 0) continue;
    map.set(base, (map.get(base) || 0) + qty);
  }
  return map;
}

// 真对账:引擎托管仓 vs 交易所权威快照逐仓比对数量;外部/手动仓信息级;缺止损按托管/手动分级。
export function reconcileAccount(db, accountId) {
  const account = db.exchangeAccounts.find((item) => item.id === accountId) || db.exchangeAccounts[0];
  if (!account) return { status: "missing_account", differences: [] };
  const differences = [];

  // 缺止损:引擎托管仓=风控高危;手动/外部仓=信息级(用户自管,不逼 AI 去补)
  for (const position of (db.positions || []).filter((p) => !p.stopLoss)) {
    const managed = position.source === "execution_engine";
    differences.push({ type: "missing_stop_loss", symbol: position.symbol, severity: managed ? "high" : "info", managed });
  }

  const snap = latestSuccessfulAccountSnapshot(db, { accountId: account.id })
    || latestSuccessfulAccountSnapshot(db, { exchange: "OKX" });
  if (!snap) {
    account.reconcileNote = "无交易所只读快照,无法账实比对(仅本地检查)";
  } else {
    const exMap = reconSnapshotPositions(snap, db);
    const engineBases = new Set();
    // 引擎托管仓 vs 交易所真实持仓(逐仓比对数量,2% 容差)
    for (const p of (db.positions || []).filter((x) => x.source === "execution_engine")) {
      const base = reconBase(p.symbol); engineBases.add(base);
      const localQty = Math.abs(Number(p.size) || 0);
      const exQty = exMap.get(base);
      if (exQty === null) {
        differences.push({ type: "contract_value_unavailable", symbol: p.symbol, severity: "high", localQty, message: "无法取得 OKX ctVal，数量对账已按 fail-closed 处理" });
        continue;
      }
      const comparableQty = exQty || 0;
      if (comparableQty < 1e-9) differences.push({ type: "missing_on_exchange", symbol: p.symbol, severity: "high", localQty, exchangeQty: 0 });
      else if (Math.abs(localQty - comparableQty) > Math.max(1e-6, localQty * 0.02)) differences.push({ type: "size_mismatch", symbol: p.symbol, severity: "high", localQty, exchangeQty: comparableQty });
    }
    // 交易所有、引擎未托管 → 外部/手动仓(信息级,不当异常)
    for (const [base, qty] of exMap) {
      const trackedManual = (db.positions || []).some((x) => x.source !== "execution_engine" && reconBase(x.symbol) === base);
      if (!engineBases.has(base) && !trackedManual) differences.push({ type: "untracked_on_exchange", symbol: base, severity: "info", exchangeQty: qty });
    }
    account.reconcileSnapshotAt = snap.createdAt;
  }

  account.lastReconciledAt = nowIso();
  const hasHigh = differences.some((d) => d.severity === "high");
  account.reconcileStatus = hasHigh ? "needs_attention" : (differences.length ? "info" : "ok");
  const result = { id: id("reconcile"), accountId: account.id, status: account.reconcileStatus, differences, snapshotAt: snap?.createdAt || null, createdAt: nowIso() };
  if (hasHigh) {
    db.riskIncidents.unshift({ id: id("incident"), severity: "high", status: "open", title: "账户对账发现账实不符", source: account.id, details: differences.filter((d) => d.severity === "high"), tenantId: db.user?.tenantId || "tenant_owner", ownerUserId: db.user?.id || null, createdAt: nowIso() });
    refreshOwnerImprovementRegistry(db);
  }
  appendAudit(db, `账户与持仓对账:${differences.length ? differences.length + " 项差异" : "账实一致"}`, account.id, "ExchangeConnector", hasHigh ? "warning" : "info");
  appendTrace(db, "reconcile", `${account.exchange} 对账${snap ? "" : "(无快照)"}`, hasHigh ? "warning" : "ok");
  return result;
}

export async function syncPrivateReadOnly(db, accountId) {
  const account = db.exchangeAccounts.find((item) => item.id === accountId);
  if (!account) return { status: "missing_account", accountId };
  const exchange = String(account.exchange).toUpperCase();
  const enabled = enabledOkxAccounts(db);
  if (exchange === "OKX" && (enabled.length !== 1 || enabled[0].id !== account.id)) {
    return { status: "account_configuration_conflict", accountId, enabledAccountIds: enabled.map((row) => row.id), error: "当前单凭证架构只允许一个启用的 OKX 账户" };
  }
  const apiKeyFingerprint = exchange === "OKX" ? currentOkxCredentialFingerprint() : null;
  if (exchange === "OKX" && (!apiKeyFingerprint || account.apiKeyFingerprint !== apiKeyFingerprint)) {
    return { status: "credential_fingerprint_mismatch", accountId, error: "当前 OKX Key 与账户元数据指纹不一致；请先重新核验 Key 后再同步" };
  }
  const result = exchange === "OKX"
    ? await syncOkxReadOnly()
    : { status: "unsupported_exchange", exchange, error: "Autonomous trading supports OKX only" };

  const normalizedPositions = exchange === "OKX"
    ? await normalizeOkxSnapshotPositions(result.positions || [])
    : (result.positions || []);
  const snapshot = {
    id: id("snap"),
    accountId: account.id,
    exchange,
    status: result.status,
    balances: result.balances || [],
    positions: normalizedPositions,
    openOrders: result.openOrders || [],
    algoOrders: result.algoOrders || [],
    openOrdersComplete: result.openOrdersComplete === true,
    algoOrdersComplete: result.algoOrdersComplete === true,
    fundingRates: result.fundingRates || [],
    apiPermissions: result.apiPermissions,
    apiKeyFingerprint,
    environment: exchange === "OKX" ? okxEnvironmentConfig().name : null,
    error: result.error,
    createdAt: nowIso()
  };
  db.accountSnapshots.unshift(snapshot);
  if (snapshot.status === "ok") await applyPrivateSnapshotToState(db, snapshot);
  account.lastReadSyncAt = snapshot.createdAt;
  account.readSyncStatus = snapshot.status;
  account.apiKeyFingerprint = apiKeyFingerprint;
  appendAudit(db, `私有只读同步：${snapshot.status}`, account.id, "ExchangeConnector", snapshot.status === "ok" ? "info" : "warning");
  appendTrace(db, "exchange_private_read", `${exchange} 私有只读同步`, snapshot.status === "ok" ? "ok" : "warning");
  return snapshot;
}

export async function normalizeOkxSnapshotPositions(rows = [], options = {}) {
  const resolveContractValue = options.resolveContractValue || okxContractValue;
  return Promise.all((rows || []).map(async (row) => {
    const rawPosition = row?.pos !== null && row?.pos !== undefined && row?.pos !== "" && Number.isFinite(Number(row.pos))
      ? Number(row.pos)
      : null;
    const contractSize = rawPosition === null ? null : Math.abs(rawPosition);
    const suppliedCtVal = row?.ctVal ?? row?.contractMultiplier;
    const suppliedFinite = suppliedCtVal !== null && suppliedCtVal !== undefined && suppliedCtVal !== ""
      && Number.isFinite(Number(suppliedCtVal)) && Number(suppliedCtVal) > 0;
    const lookedUp = suppliedFinite ? Number(suppliedCtVal) : await resolveContractValue(row.instId);
    const ctVal = Number.isFinite(Number(lookedUp)) && Number(lookedUp) > 0 ? Number(lookedUp) : null;
    const direction = rawPosition === null ? null : canonicalPositionDirection(row, rawPosition);
    return {
      ...row,
      symbol: normalizeOkxDisplaySymbol(row.instId || row.symbol),
      canonicalDirection: direction,
      rawSignedPosition: rawPosition,
      contractSize,
      contractSizeUnit: "contracts",
      ctVal,
      contractMultiplier: ctVal,
      coinSize: contractSize !== null && ctVal !== null ? contractSize * ctVal : null,
      quantityUnit: "coin",
      positionQuantityComplete: contractSize === 0 || ctVal !== null,
      positionQuantityBasis: ctVal !== null ? "okx_contracts_times_ctVal" : "contract_spec_unavailable"
    };
  }));
}

async function applyPrivateSnapshotToState(db, snapshot) {
  db.positions ||= [];
  db.orders ||= [];
  updateApiPermissionMetadata(db, snapshot);
  if (snapshot.exchange === "OKX") await applyOkxSnapshot(db, snapshot);
  if (snapshot.exchange === "BINANCE") applyBinanceSnapshot(db, snapshot);
  // 兜底清扫:丢弃任何 size=0/非法 的空持仓(OKX WS/REST 都可能推 pos:0 的空槽,历史脏数据也在此清)。
  // 空槽不是持仓,不该占"持仓(N)"。真实持仓的 size 恒为正。
  db.positions = (db.positions || []).filter((p) => { const s = Number(p.size); return Number.isFinite(s) && s !== 0; });
}

function updateApiPermissionMetadata(db, snapshot) {
  const item = (db.apiKeyMetadata || []).find((key) => key.exchange === snapshot.exchange);
  if (!item) return;
  if (snapshot.exchange === "BINANCE" && snapshot.apiPermissions && snapshot.apiPermissions.status !== "unavailable") {
    item.withdrawPermission = Boolean(snapshot.apiPermissions.enableWithdrawals);
    item.permissionVerifiedAt = nowIso();
    item.ipRestrict = Boolean(snapshot.apiPermissions.ipRestrict);
    item.enableReading = Boolean(snapshot.apiPermissions.enableReading);
    item.enableFutures = Boolean(snapshot.apiPermissions.enableFutures);
    item.enableSpotAndMarginTrading = Boolean(snapshot.apiPermissions.enableSpotAndMarginTrading);
    if (item.withdrawPermission) {
      db.system.killSwitch = true;
      db.system.riskStatus = "API 权限异常";
      db.riskIncidents ||= [];
      db.riskIncidents.unshift({
        id: id("incident"),
        severity: "critical",
        status: "open",
        title: "Binance API Key 检测到提现权限，已触发熔断",
        source: item.id,
        tenantId: db.user?.tenantId || "tenant_owner",
        ownerUserId: db.user?.id || null,
        createdAt: nowIso()
      });
      refreshOwnerImprovementRegistry(db);
      appendAudit(db, "检测到 Binance API Key 提现权限，触发熔断", item.id, "ExchangeConnector", "critical");
    }
  }
  if (snapshot.exchange === "OKX") {
    item.permissionVerificationStatus = "manual_required";
    item.permissionVerificationNote = "OKX 公开交易 API 未提供等价的当前 Key 权限查询接口；需在 OKX API 管理页面确认未勾选 Withdraw。";
  }
}

function upsertExchangePosition(db, key, fields, options = {}) {
  const existing = db.positions.find((item) => item.exchangePositionKey === key)
    || (options.legacyKey
      ? db.positions.find((item) => !item.accountId && item.exchangePositionKey === options.legacyKey)
      : null);
  const position = existing || { id: id("pos"), exchangePositionKey: key, source: "exchange_rest", createdAt: nowIso() };
  Object.assign(position, fields, { exchangePositionKey: key, updatedAt: nowIso() });
  if (!existing) db.positions.unshift(position);
  return position;
}

function pruneExchangePositions(db, exchange, seenKeys, options = {}) {
  // 权威 REST 快照应用后:剪掉该交易所里"快照没有"的非引擎持仓——不止 exchange_rest,
  // 也含 WS 补记的 exchange_ws 外部/手动仓(否则漏收平仓回执的 WS 仓会成幽灵仓,size≠0 逃过空槽清扫)。
  // 引擎托管仓(execution_engine)不在此剪,由 reconcileAccount 逐仓比对告警。
  db.positions = (db.positions || []).filter((position) => {
    if (position.exchange !== exchange) return true;
    if (position.source !== "exchange_rest" && position.source !== "exchange_ws") return true;
    if (Object.hasOwn(options, "accountId") && (position.accountId || null) !== (options.accountId || null)) {
      if (options.pruneLegacyUnboundRest && !position.accountId && position.source === "exchange_rest") return false;
      return true;
    }
    return seenKeys.has(position.exchangePositionKey);
  });
}

function upsertOpenOrders(db, exchange, orders = [], options = {}) {
  const seen = new Set();
  for (const payload of orders || []) {
    const exchangeOrderId = String(payload.orderId || payload.ordId || "");
    const clientOrderId = String(payload.clientOrderId || payload.origClientOrderId || payload.clOrdId || "");
    const key = `${exchange}:${exchangeOrderId || clientOrderId}`;
    if (!exchangeOrderId && !clientOrderId) continue;
    seen.add(key);
    const existing = db.orders.find((order) => order.exchangeOrderKey === key || (exchangeOrderId && String(order.exchangeOrderId) === exchangeOrderId));
    const order = existing || { id: id("ord"), exchange, exchangeOrderKey: key, source: "exchange_rest", createdAt: nowIso() };
    Object.assign(order, normalizeOpenOrder(exchange, payload), { updatedAt: nowIso() });
    if (!existing) db.orders.unshift(order);
  }
  if (options.complete !== false) {
    db.orders = (db.orders || []).filter((order) => {
      if (order.source !== "exchange_rest" || order.exchange !== exchange) return true;
      return seen.has(order.exchangeOrderKey);
    });
  }
}

function normalizeOpenOrder(exchange, payload = {}) {
  if (exchange === "OKX") {
    return {
      exchange,
      exchangeOrderId: payload.ordId,
      clientOrderId: payload.clOrdId,
      symbol: normalizeOkxDisplaySymbol(payload.instId),
      side: payload.side,
      type: payload.ordType,
      price: Number(payload.px || 0),
      quantity: payload.sz,
      status: payload.state || "open",
      reduceOnly: payload.reduceOnly === "true" || payload.reduceOnly === true
    };
  }
  return {
    exchange,
    exchangeOrderId: payload.orderId,
    clientOrderId: payload.clientOrderId,
    symbol: normalizeBinanceDisplaySymbol(payload.symbol),
    side: payload.side,
    type: payload.type,
    price: Number(payload.price || payload.stopPrice || 0),
    quantity: payload.origQty || payload.quantity,
    status: payload.status || "open",
    reduceOnly: payload.reduceOnly === true || payload.reduceOnly === "true"
  };
}

// OKX 合约面值缓存：SWAP 的 pos 字段是"张数"，换算成币数量/盈亏必须乘 ctVal
// （如 BTC-USDT-SWAP ctVal=0.01——不乘会把浮盈放大 100 倍）。
const okxCtValCache = new Map();
const okxSpecCache = new Map();
// 完整合约规格(下单换算用):sz 是"张数",币数量必须除以 ctVal;张数需对齐 lotSz 且 ≥ minSz。
export async function okxContractSpec(instId) {
  const cached = okxSpecCache.get(instId);
  if (cached && Date.now() - cached.at < 3_600_000) return cached.spec;
  const timer = timeoutSignal();
  try {
    const response = await fetch(okxRestUrl(`/api/v5/public/instruments?instType=SWAP&instId=${encodeURIComponent(instId)}`), { signal: timer.signal });
    if (!response.ok) throw new Error(`OKX instruments HTTP ${response.status}`);
    const raw = await response.json();
    if (String(raw?.code ?? "0") !== "0") throw new Error(`OKX instruments API ${raw?.code}`);
    const row = raw.data?.[0];
    // tickSz=价格最小变动(px/止损/止盈价必须是它的整数倍),lotSz=张数步长,minSz=最小张数,ctVal=每张面值。
    const spec = row ? {
      ctVal: Number(row.ctVal),
      lotSz: Number(row.lotSz),
      minSz: Number(row.minSz),
      tickSz: Number(row.tickSz),
      ctType: row.ctType || null,
      ctValCcy: row.ctValCcy || null,
      settleCcy: row.settleCcy || null,
      fetchedAt: nowIso()
    } : null;
    const valid = spec && [spec.ctVal, spec.lotSz, spec.minSz, spec.tickSz].every((value) => Number.isFinite(value) && value > 0);
    if (valid) { okxSpecCache.set(instId, { spec, at: Date.now() }); okxCtValCache.set(instId, spec.ctVal); return spec; }
  } catch { /* 拿不到规格返回 null,下单侧 fail-closed */ }
  finally { timer.cancel(); }
  return null;
}
async function okxContractValue(instId) {
  if (okxCtValCache.has(instId)) return okxCtValCache.get(instId);
  const spec = await okxContractSpec(instId);
  return spec?.ctVal ?? null;
}

// 币安下单精度:价格必须是 tickSize 整数倍、数量必须是 stepSize 整数倍且 ≥ minQty、名义额 ≥ minNotional。
// 从 exchangeInfo 的 PRICE_FILTER/LOT_SIZE/(MIN_)NOTIONAL 读取。缓存 1 小时(规格极少变)。
const binanceFilterCache = new Map();
export async function binanceSymbolFilters(symbol, futures = true) {
  const sym = toBinanceSymbol(symbol);
  const key = `${futures ? "F" : "S"}:${sym}`;
  const cached = binanceFilterCache.get(key);
  if (cached && Date.now() - cached.at < 3_600_000) return cached.spec;
  try {
    const base = futures ? BINANCE_USDM_BASE : BINANCE_SPOT_BASE;
    const infoPath = futures ? "/fapi/v1/exchangeInfo" : "/api/v3/exchangeInfo";
    const timer = timeoutSignal();
    const j = await fetch(`${base}${infoPath}?symbol=${encodeURIComponent(sym)}`, { signal: timer.signal }).then((r) => r.json());
    const row = (j?.symbols || []).find((s) => s.symbol === sym);
    if (!row) return null;
    const f = (t) => (row.filters || []).find((x) => x.filterType === t) || {};
    const price = f("PRICE_FILTER"), lot = f("LOT_SIZE"), notional = f("MIN_NOTIONAL").notional ? f("MIN_NOTIONAL") : f("NOTIONAL");
    const spec = {
      tickSize: Number(price.tickSize) || null,
      stepSize: Number(lot.stepSize) || null,
      minQty: Number(lot.minQty) || 0,
      minNotional: Number(notional.minNotional || notional.notional) || 0
    };
    binanceFilterCache.set(key, { spec, at: Date.now() });
    return spec;
  } catch { return null; }
}

// OKX 持仓模式:long_short_mode(双向/对冲)下每单必须带 posSide;net_mode(单向)下不能带。
// 不知道模式就瞎带/不带都会被 51000「Parameter posSide error」拒。缓存 10 分钟(模式极少变)。
const okxPosModeCache = new Map();
export function invalidateOkxCredentialCaches() {
  okxPosModeCache.clear();
  okxCtValCache.clear();
  okxSpecCache.clear();
}
export async function okxPositionMode(accountId = null) {
  const fingerprint = currentOkxCredentialFingerprint();
  if (!fingerprint) return null;
  const cacheKey = `${fingerprint}:${accountId || "single"}`;
  const cached = okxPosModeCache.get(cacheKey);
  if (cached?.mode && Date.now() - cached.at < 600000) return cached.mode;
  try {
    const raw = await okxSignedRequest("/api/v5/account/config", "GET");
    const mode = raw?.data?.[0]?.posMode || null;
    if (mode) okxPosModeCache.set(cacheKey, { mode, at: Date.now() });
    return mode;
  } catch { return null; }
}

export async function applyOkxSnapshot(db, snapshot) {
  const seen = new Set();
  for (const payload of snapshot.positions || []) {
    const size = Number(payload.pos || 0);
    if (!Number.isFinite(size) || size === 0) continue;
    const symbol = normalizeOkxDisplaySymbol(payload.instId);
    const rawPosSide = String(payload.posSide || "").toLowerCase();
    const direction = canonicalPositionDirection({ posSide: rawPosSide, pos: size });
    if (!direction) continue;
    const legacyKey = `OKX:${symbol}:${direction}`;
    const key = snapshot.accountId ? `OKX:${snapshot.accountId}:${symbol}:${direction}` : legacyKey;
    seen.add(key);
    const payloadCtVal = payload.ctVal ?? payload.contractMultiplier;
    const ctVal = payloadCtVal !== null && payloadCtVal !== undefined && payloadCtVal !== ""
      && Number.isFinite(Number(payloadCtVal)) && Number(payloadCtVal) > 0
      ? Number(payloadCtVal)
      : await okxContractValue(payload.instId);
    upsertExchangePosition(db, key, {
      exchange: "OKX",
      accountId: snapshot.accountId || null,
      apiKeyFingerprint: snapshot.apiKeyFingerprint || null,
      environment: snapshot.environment || null,
      symbol,
      posSide: direction,
      direction,
      positionMode: rawPosSide === "net" ? "net_mode" : "long_short_mode",
      rawPosSide: rawPosSide || null,
      rawPos: size,
      size: Math.abs(size),                          // 合约张数（OKX 原始口径）
      contractMultiplier: ctVal,                     // 面值：币数量 = 张数 × ctVal
      coinSize: ctVal ? Math.abs(size) * ctVal : null, // 币数量（展示用，真实换算）
      entry: payload.avgPx !== null && payload.avgPx !== undefined && payload.avgPx !== "" && Number.isFinite(Number(payload.avgPx)) ? Number(payload.avgPx) : null,
      mark: payload.markPx !== null && payload.markPx !== undefined && payload.markPx !== "" && Number.isFinite(Number(payload.markPx)) ? Number(payload.markPx) : null,
      liqPx: payload.liqPx !== null && payload.liqPx !== undefined && payload.liqPx !== "" && Number.isFinite(Number(payload.liqPx)) ? Number(payload.liqPx) : null,
      pnl: payload.upl !== null && payload.upl !== undefined && payload.upl !== "" && Number.isFinite(Number(payload.upl)) ? Number(payload.upl) : null,
      leverage: payload.lever !== null && payload.lever !== undefined && payload.lever !== "" && Number.isFinite(Number(payload.lever)) ? Number(payload.lever) : null,
      marginMode: payload.mgnMode,
      rawSyncedAt: snapshot.createdAt
    }, { legacyKey: snapshot.accountId ? legacyKey : null });
  }
  pruneExchangePositions(db, "OKX", seen, {
    accountId: snapshot.accountId || null,
    pruneLegacyUnboundRest: Boolean(snapshot.accountId)
  });
  upsertOpenOrders(db, "OKX", snapshot.openOrders, { complete: snapshot.openOrdersComplete === true });
  const account = snapshot.balances?.[0] || {};
  const totalEq = Number(account.totalEq);
  if (Number.isFinite(totalEq) && totalEq > 0) {
    db.portfolio.totalEquityUsdt = totalEq;
    snapshot.totalEquityUsdt = totalEq; // 盖到快照(时间序列)上:持仓盈亏曲线读的是每条快照的净值,此前只写 portfolio 最新值→曲线永远空
  }
  // 真实可用/冻结：来自 OKX balance details 的 USDT 明细（此前从未写入，前端一直显示假的 0.00）。
  const usdtDetail = (account.details || []).find((d) => d.ccy === "USDT") || {};
  const availEq = Number(usdtDetail.availEq ?? usdtDetail.availBal);
  // OKX 账户级 totalEq 与币种级 availEq 口径/取整不同,availEq 可能微超 totalEq(实测 10.108>10.099)。
  // 可用保证金物理上不可能超过总权益,按不变量夹取,避免"可用>总资产"的荒谬展示。
  if (Number.isFinite(availEq)) {
    db.portfolio.availableMarginUsdt = Number.isFinite(totalEq) && totalEq > 0 ? Math.min(availEq, totalEq) : availEq;
  }
  const frozen = Number(usdtDetail.frozenBal ?? usdtDetail.ordFrozen);
  if (Number.isFinite(frozen)) db.portfolio.frozenMarginUsdt = frozen;
  db.portfolio.marginSyncedAt = snapshot.createdAt;
}

export function applyBinanceSnapshot(db, snapshot) {
  const seen = new Set();
  for (const payload of snapshot.positions || []) {
    const amount = Number(payload.positionAmt || 0);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const symbol = normalizeBinanceDisplaySymbol(payload.symbol);
    const positionSide = payload.positionSide || (amount < 0 ? "SHORT" : "LONG");
    const direction = String(positionSide).toUpperCase() === "SHORT" || amount < 0 ? "short" : "long";
    const key = `BINANCE:${symbol}:${positionSide}`;
    seen.add(key);
    upsertExchangePosition(db, key, {
      exchange: "BINANCE",
      symbol,
      positionSide,
      direction,
      size: Math.abs(amount),
      entry: Number(payload.entryPrice || 0),
      mark: Number(payload.markPrice || 0),
      pnl: Number(payload.unRealizedProfit || payload.unrealizedProfit || 0),
      leverage: Number(payload.leverage || 0),
      marginMode: payload.marginType,
      rawSyncedAt: snapshot.createdAt
    });
  }
  pruneExchangePositions(db, "BINANCE", seen);
  upsertOpenOrders(db, "BINANCE", snapshot.openOrders);
  const usdt = (snapshot.balances || []).find((item) => item.asset === "USDT");
  const total = Number(usdt?.free || 0) + Number(usdt?.locked || 0);
  if (Number.isFinite(total) && total > 0) {
    db.portfolio.totalEquityUsdt = total;
    snapshot.totalEquityUsdt = total; // 同 OKX:盖到快照上,曲线才有历史点可画
  }
}

function normalizeBinanceDisplaySymbol(symbol) {
  const text = String(symbol || "").toUpperCase();
  if (text.endsWith("USDT")) return `${text.slice(0, -4)}/USDT`;
  return text;
}

function normalizeOkxDisplaySymbol(instId) {
  return String(instId || "")
    .replace(/-SWAP$/i, "")
    .replace("-", "/")
    .toUpperCase();
}

async function syncOkxReadOnly() {
  if (!process.env.OKX_API_KEY || !process.env.OKX_API_SECRET || !process.env.OKX_API_PASSPHRASE) {
    return { status: "missing_credentials", error: "OKX_API_KEY, OKX_API_SECRET or OKX_API_PASSPHRASE is missing" };
  }
  try {
    const [balance, positions, openOrders, algoOrders] = await Promise.all([
      okxSignedRequest("/api/v5/account/balance"),
      okxSignedRequest("/api/v5/account/positions"),
      fetchOkxPendingPages("/api/v5/trade/orders-pending", { idField: "ordId" }),
      // 附加止损在主单完全成交后成为 conditional algo order；必须从交易所核验，
      // 不能只凭本地 stopLoss 字段假定仓位仍受保护。
      fetchOkxPendingPages("/api/v5/trade/orders-algo-pending", { idField: "algoId", query: { ordType: "conditional" } })
    ]);
    for (const [label, response] of [["balance", balance], ["positions", positions]]) {
      if (String(response?.code) !== "0") throw new Error(`OKX ${label} rejected: ${response?.code || "unknown"} ${response?.msg || ""}`.trim());
    }
    return {
      status: "ok",
      balances: balance.data || [],
      positions: positions.data || [],
      openOrders: (openOrders.rows || []).map(maskOrder),
      algoOrders: (algoOrders.rows || []).map(maskOrder),
      openOrdersComplete: openOrders.complete === true,
      algoOrdersComplete: algoOrders.complete === true,
      fundingRates: []
    };
  } catch (error) {
    return { status: "request_failed", error: error.message };
  }
}

export async function fetchOkxPendingPages(path, options = {}) {
  const request = options.request || okxSignedRequest;
  const idField = options.idField || "ordId";
  const limit = Math.max(1, Math.min(100, Number(options.limit || 100)));
  const maxPages = Math.max(1, Number(options.maxPages || 20));
  const rows = [];
  let after = null;
  for (let page = 0; page < maxPages; page += 1) {
    const query = new URLSearchParams({ ...(options.query || {}), limit: String(limit) });
    if (after) query.set("after", after);
    const raw = await request(`${path}?${query.toString()}`, "GET");
    if (String(raw?.code) !== "0") return { rows, complete: false, reason: "okx_pending_query_rejected", code: raw?.code || null };
    const pageRows = Array.isArray(raw.data) ? raw.data : [];
    rows.push(...pageRows);
    if (pageRows.length < limit) return { rows, complete: true, pages: page + 1 };
    const next = String(pageRows.at(-1)?.[idField] || "");
    if (!next || next === after) return { rows, complete: false, reason: "okx_pending_pagination_unstable", pages: page + 1 };
    after = next;
  }
  return { rows, complete: false, reason: "okx_pending_pagination_limit", pages: maxPages };
}

export async function binanceSignedRequest(pathname, params = {}, options = {}) {
  const timestamp = Date.now();
  const cleanParams = Object.fromEntries(Object.entries(params || {}).filter(([, value]) => value !== undefined && value !== null && value !== ""));
  const query = new URLSearchParams({ ...cleanParams, timestamp: String(timestamp), recvWindow: "5000" });
  const signature = crypto.createHmac("sha256", process.env.BINANCE_API_SECRET).update(query.toString()).digest("hex");
  query.set("signature", signature);
  const baseUrl = options.baseUrl || (pathname.startsWith("/fapi") ? BINANCE_USDM_BASE : BINANCE_SPOT_BASE);
  const timer = timeoutSignal();
  try {
    const response = await fetch(`${baseUrl}${pathname}?${query.toString()}`, {
      method: options.method || "GET",
      signal: timer.signal,
      headers: { "X-MBX-APIKEY": process.env.BINANCE_API_KEY }
    });
    if (!response.ok) throw new Error(`Binance signed HTTP ${response.status}`);
    return response.json();
  } finally {
    timer.cancel();
  }
}

export async function okxSignedRequest(pathname, method = "GET", body = "", options = {}) {
  const credentials = options.credentials || {
    apiKey: process.env.OKX_API_KEY,
    apiSecret: process.env.OKX_API_SECRET,
    passphrase: process.env.OKX_API_PASSPHRASE
  };
  if (!credentials.apiKey || !credentials.apiSecret || !credentials.passphrase) throw new Error("OKX credentials incomplete");
  const timestamp = new Date().toISOString();
  const prehash = `${timestamp}${method}${pathname}${body}`;
  const sign = crypto.createHmac("sha256", credentials.apiSecret).update(prehash).digest("base64");
  const timer = timeoutSignal(Number(options.timeoutMs || 6000));
  const signal = options.signal && typeof globalThis.AbortSignal.any === "function"
    ? globalThis.AbortSignal.any([options.signal, timer.signal])
    : options.signal || timer.signal;
  try {
    const response = await fetch(okxRestUrl(pathname), {
      method,
      signal,
      headers: {
        "OK-ACCESS-KEY": credentials.apiKey,
        "OK-ACCESS-SIGN": sign,
        "OK-ACCESS-TIMESTAMP": timestamp,
        "OK-ACCESS-PASSPHRASE": credentials.passphrase,
        "Content-Type": "application/json",
        ...(process.env.OKX_DEMO_TRADING === "true" ? { "x-simulated-trading": "1" } : {})
      },
      body: body || undefined
    });
    if (!response.ok) throw new Error(`OKX signed HTTP ${response.status}`);
    return response.json();
  } finally {
    timer.cancel();
  }
}

export async function validateOkxCredentialCandidate(credentials = {}) {
  const apiKey = String(credentials.apiKey || "");
  const apiSecret = String(credentials.apiSecret || "");
  const passphrase = String(credentials.passphrase || "");
  if (!apiKey || !apiSecret || !passphrase) return { ok: false, status: "incomplete_credentials" };
  try {
    const raw = await okxSignedRequest("/api/v5/account/config", "GET", "", { credentials: { apiKey, apiSecret, passphrase } });
    if (String(raw?.code ?? "0") !== "0" || !raw?.data?.[0]) return { ok: false, status: "credential_validation_failed", code: raw?.code || null };
    const config = raw.data[0];
    return {
      ok: true,
      status: "validated",
      posMode: config.posMode || null,
      permissions: String(config.perm || config.permissions || "").split(",").map((item) => item.trim()).filter(Boolean)
    };
  } catch (error) {
    return { ok: false, status: "credential_validation_failed", error: String(error.message || error).slice(0, 160) };
  }
}

function maskOrder(order = {}) {
  const { apiKey, secret, passphrase, ...safe } = order;
  return safe;
}

export function guardedPrivateExchangeAction(db, action, payload = {}) {
  if (!db.system.liveTradingEnabled) {
    return {
      status: "blocked_by_live_guard",
      action,
      payloadSummary: summarizePayload(payload),
      message: "真实交易写操作未开启，私有交易请求被安全闸门拦截。"
    };
  }
  if (db.system.killSwitch) {
    return {
      status: "blocked_by_kill_switch",
      action,
      payloadSummary: summarizePayload(payload),
      message: "一键熔断已启用，私有交易请求被拒绝。"
    };
  }
  return {
    status: "ready_for_connector",
    action,
    payloadSummary: summarizePayload(payload),
    message: "请求已通过本地安全闸门，可交给真实交易所 SDK。"
  };
}

function compactNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  if (numeric >= 1_000_000_000) return `${(numeric / 1_000_000_000).toFixed(2)}B`;
  if (numeric >= 1_000_000) return `${(numeric / 1_000_000).toFixed(2)}M`;
  return numeric.toFixed(2);
}

function summarizePayload(payload) {
  return scrubSecrets(payload);
}
