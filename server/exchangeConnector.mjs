import crypto from "node:crypto";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

const BINANCE_SPOT_BASE = process.env.BINANCE_SPOT_BASE_URL
  || (process.env.BINANCE_TESTNET === "true" ? "https://testnet.binance.vision" : "https://api.binance.com");
const BINANCE_USDM_BASE = process.env.BINANCE_USDM_BASE_URL
  || (process.env.BINANCE_TESTNET === "true" ? "https://testnet.binancefuture.com" : "https://fapi.binance.com");
const OKX_BASE = process.env.OKX_BASE_URL || "https://www.okx.com";
const BINANCE_TICKER_URL = `${BINANCE_SPOT_BASE}/api/v3/ticker/24hr`;
const OKX_TICKER_URL = `${OKX_BASE}/api/v5/market/ticker`;

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

function timeoutSignal(ms = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
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
    const fingerprint = apiKey ? crypto.createHash("sha256").update(apiKey).digest("hex").slice(0, 16) : null;
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
    account.readEnabled = Boolean(metadata?.hasApiKey && metadata?.hasSecret);
    account.tradeEnabled = Boolean(metadata?.hasApiKey && metadata?.hasSecret);
    account.withdrawEnabled = false;
    account.status = account.readEnabled ? "configured" : "missing_credentials";
  }
  return db.apiKeyMetadata;
}

async function fetchPublicTicker(exchange, symbol) {
  const normalizedExchange = String(exchange || "BINANCE").toUpperCase();
  const timer = timeoutSignal();
  try {
    if (normalizedExchange === "OKX") {
      const response = await fetch(`${OKX_TICKER_URL}?instId=${encodeURIComponent(toOkxSymbol(symbol))}`, { signal: timer.signal });
      if (!response.ok) throw new Error(`OKX ticker HTTP ${response.status}`);
      const payload = await response.json();
      const ticker = payload.data?.[0];
      if (!ticker) throw new Error("OKX ticker missing data");
      return {
        exchange: "OKX",
        symbol: toOkxSymbol(symbol),
        price: Number(ticker.last),
        high24h: Number(ticker.high24h),
        low24h: Number(ticker.low24h),
        volume24h: ticker.volCcy24h,
        rawTime: ticker.ts
      };
    }

    const response = await fetch(`${BINANCE_TICKER_URL}?symbol=${encodeURIComponent(toBinanceSymbol(symbol))}`, { signal: timer.signal });
    if (!response.ok) throw new Error(`Binance ticker HTTP ${response.status}`);
    const ticker = await response.json();
    if (!Number.isFinite(Number(ticker.lastPrice))) throw new Error(ticker?.msg || "Binance ticker unavailable");
    return {
      exchange: "BINANCE",
      symbol: toBinanceSymbol(symbol),
      price: Number(ticker.lastPrice),
      high24h: Number(ticker.highPrice),
      low24h: Number(ticker.lowPrice),
      changePct: Number(ticker.priceChangePercent),
      volume24h: ticker.quoteVolume,
      rawTime: ticker.closeTime
    };
  } finally {
    timer.cancel();
  }
}

// 高频只读场景（观察哨每分钟核对）用：拉一次 ticker，不写审计/trace，不动 db。
export async function fetchTickerQuiet(symbol, exchange = "OKX") {
  const { result } = await withExchangeFailover(exchange, (name) => fetchPublicTicker(name, symbol));
  return result;
}

// 拉 OKX 资金费率历史，返回 |资金费率%| 的第 pct 百分位——给"资金费率极端"做该币自适应阈值
// （BTC 和小币的"极端"不是一个量级）。失败/样本不足返回 null，由调用方回落固定阈值。
export async function fetchFundingPercentile(symbol, pct = 85) {
  try {
    const instId = toOkxSymbol(symbol, "swap"); // 资金费率是永续专属,必须用 -SWAP instId(现货无资金费率)
    const res = await fetch(`${OKX_BASE}/api/v5/public/funding-rate-history?instId=${encodeURIComponent(instId)}&limit=100`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const j = await res.json();
    const vals = (j?.data || []).map((d) => Math.abs(Number(d.fundingRate) * 100)).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (vals.length < 10) return null;
    return vals[Math.min(vals.length - 1, Math.floor((pct / 100) * vals.length))];
  } catch { return null; }
}

export async function syncPublicMarket(db, exchange = "BINANCE", symbol = "BTC/USDT") {
  const { result: ticker, failedOver, exchange: usedExchange } = await withExchangeFailover(exchange, (name) => fetchPublicTicker(name, symbol));
  if (failedOver) appendTrace(db, "exchange_market", `${fallbackExchange(usedExchange)} 不可用，已切换 ${usedExchange}`, "warning");
  const displaySymbol = symbol.includes("/") ? symbol : symbol.replace("USDT", "/USDT");
  db.markets ||= [];
  let market = db.markets.find((item) => item.symbol === displaySymbol);
  if (!market) {
    market = { symbol: displaySymbol, candles: [], status: "not_synced" };
    db.markets.push(market);
  }
  if (market) {
    market.price = ticker.price || market.price;
    market.high24h = ticker.high24h || market.high24h;
    market.low24h = ticker.low24h || market.low24h;
    market.changePct = Number.isFinite(ticker.changePct) ? ticker.changePct : market.changePct;
    market.volume24h = ticker.volume24h ? compactNumber(ticker.volume24h) : market.volume24h;
    market.lastSyncedExchange = ticker.exchange;
    market.lastSyncedAt = nowIso();
    market.status = "synced";
  }
  appendAudit(db, "同步公开行情", `${exchange}:${symbol}`, "ExchangeConnector");
  appendTrace(db, "exchange_market", `同步 ${exchange} ${symbol}`);
  return ticker;
}

const BINANCE_INTERVALS = { "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d" };
const OKX_BARS = { "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D" };

async function fetchPublicKlines(exchange, symbol, timeframe = "1h", limit = 200) {
  const normalizedExchange = String(exchange || "BINANCE").toUpperCase();
  const tf = BINANCE_INTERVALS[timeframe] ? timeframe : "1h";
  const timer = timeoutSignal(8000);
  try {
    if (normalizedExchange === "OKX") {
      const url = `${OKX_BASE}/api/v5/market/candles?instId=${encodeURIComponent(toOkxSymbol(symbol))}&bar=${OKX_BARS[tf]}&limit=${Math.min(limit, 300)}`;
      const response = await fetch(url, { signal: timer.signal });
      if (!response.ok) throw new Error(`OKX klines HTTP ${response.status}`);
      const payload = await response.json();
      return (payload.data || []).map((row) => ({
        time: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5])
      })).reverse();
    }
    const url = `${BINANCE_SPOT_BASE}/api/v3/klines?symbol=${encodeURIComponent(toBinanceSymbol(symbol))}&interval=${BINANCE_INTERVALS[tf]}&limit=${Math.min(limit, 500)}`;
    const response = await fetch(url, { signal: timer.signal });
    if (!response.ok) throw new Error(`Binance klines HTTP ${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error(rows?.msg || "Binance klines unavailable");
    return rows.map((row) => ({
      time: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5])
    }));
  } finally {
    timer.cancel();
  }
}

// ---------------------------------------------------------------------------
// 市场微观结构：资金费率 / 未平仓量(OI) / 订单簿深度不平衡。
// 给 Agent 提供合约交易真正需要的"眼睛"。默认 OKX（本机可用），失败回退 Binance。
// ---------------------------------------------------------------------------
async function fetchMicrostructureRaw(exchange, symbol) {
  const normalized = String(exchange || "OKX").toUpperCase();
  const timer = timeoutSignal(8000);
  try {
    if (normalized === "OKX") {
      const instId = toOkxSymbol(symbol, "perpetual");
      const [funding, oi, books] = await Promise.all([
        fetch(`${OKX_BASE}/api/v5/public/funding-rate?instId=${encodeURIComponent(instId)}`, { signal: timer.signal }).then((r) => r.json()),
        fetch(`${OKX_BASE}/api/v5/public/open-interest?instId=${encodeURIComponent(instId)}`, { signal: timer.signal }).then((r) => r.json()),
        fetch(`${OKX_BASE}/api/v5/market/books?instId=${encodeURIComponent(instId)}&sz=20`, { signal: timer.signal }).then((r) => r.json())
      ]);
      const book = books.data?.[0] || {};
      return {
        exchange: "OKX",
        symbol: instId,
        fundingRatePct: funding.data?.[0]?.fundingRate !== undefined ? Number(funding.data[0].fundingRate) * 100 : null,
        nextFundingRatePct: funding.data?.[0]?.nextFundingRate !== undefined ? Number(funding.data[0].nextFundingRate) * 100 : null,
        openInterest: oi.data?.[0]?.oiCcy !== undefined ? Number(oi.data[0].oiCcy) : (oi.data?.[0]?.oi !== undefined ? Number(oi.data[0].oi) : null),
        ...bookImbalance(book.bids, book.asks)
      };
    }
    const bSymbol = toBinanceSymbol(symbol);
    const [premium, oi, depth] = await Promise.all([
      fetch(`${BINANCE_USDM_BASE}/fapi/v1/premiumIndex?symbol=${bSymbol}`, { signal: timer.signal }).then((r) => r.json()),
      fetch(`${BINANCE_USDM_BASE}/fapi/v1/openInterest?symbol=${bSymbol}`, { signal: timer.signal }).then((r) => r.json()),
      fetch(`${BINANCE_USDM_BASE}/fapi/v1/depth?symbol=${bSymbol}&limit=20`, { signal: timer.signal }).then((r) => r.json())
    ]);
    return {
      exchange: "BINANCE",
      symbol: bSymbol,
      fundingRatePct: premium?.lastFundingRate !== undefined ? Number(premium.lastFundingRate) * 100 : null,
      nextFundingRatePct: null,
      openInterest: oi?.openInterest !== undefined ? Number(oi.openInterest) : null,
      ...bookImbalance(depth?.bids, depth?.asks)
    };
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
export async function syncMicrostructure(db, exchange = "OKX", symbol = "BTC/USDT") {
  const { result, failedOver, exchange: usedExchange } = await withExchangeFailover(exchange === "BINANCE" ? "BINANCE" : "OKX", (name) => fetchMicrostructureRaw(name, symbol));
  if (failedOver) appendTrace(db, "exchange_micro", `${fallbackExchange(usedExchange)} 微观数据不可用，切换 ${usedExchange}`, "warning");
  const displaySymbol = symbol.includes("/") ? symbol : symbol.replace("USDT", "/USDT");
  db.markets ||= [];
  let market = db.markets.find((item) => item.symbol === displaySymbol);
  if (!market) {
    market = { symbol: displaySymbol, candles: [], status: "not_synced" };
    db.markets.push(market);
  }
  market.fundingRate = result.fundingRatePct;
  market.openInterest = result.openInterest;
  market.bookImbalancePct = result.bookImbalancePct;
  market.bidVolume = result.bidVolume;
  market.askVolume = result.askVolume;
  market.depthUsdt = result.depthUsdt;
  market.spreadBps = result.spreadBps;
  market.microSyncedAt = nowIso();
  appendTrace(db, "exchange_micro", `微观结构 ${usedExchange} ${symbol}`);
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
  return { ...result, interpretation: interpretation.join("；") || "微观结构数据不足" };
}

function fallbackExchange(exchange) {
  return String(exchange).toUpperCase() === "OKX" ? "BINANCE" : "OKX";
}

async function withExchangeFailover(exchange, fetcher) {
  const primary = String(exchange || "BINANCE").toUpperCase();
  try {
    return { exchange: primary, result: await fetcher(primary) };
  } catch (primaryError) {
    const secondary = fallbackExchange(primary);
    try {
      return { exchange: secondary, result: await fetcher(secondary), failedOver: true, primaryError: primaryError.message };
    } catch {
      throw primaryError;
    }
  }
}

// OKX 分页取数：先取最近 300，再用 history-candles 用 after 往回翻，直到 target 根。
async function fetchOkxKlinesPaged(symbol, timeframe, target) {
  const tf = OKX_BARS[timeframe] ? timeframe : "1h";
  const bar = OKX_BARS[tf];
  const inst = toOkxSymbol(symbol);
  const raw = [];
  const recentTimer = timeoutSignal(8000);
  try {
    const response = await fetch(`${OKX_BASE}/api/v5/market/candles?instId=${encodeURIComponent(inst)}&bar=${bar}&limit=300`, { signal: recentTimer.signal });
    if (!response.ok) throw new Error(`OKX candles HTTP ${response.status}`);
    const payload = await response.json();
    raw.push(...(payload.data || []));
  } finally {
    recentTimer.cancel();
  }
  let guard = 0;
  while (raw.length < target && guard < 32) {
    guard += 1;
    const oldest = raw[raw.length - 1]?.[0]; // data 为最新在前，末位最旧
    if (!oldest) break;
    const pageTimer = timeoutSignal(8000);
    let batch = [];
    try {
      const response = await fetch(`${OKX_BASE}/api/v5/market/history-candles?instId=${encodeURIComponent(inst)}&bar=${bar}&after=${oldest}&limit=100`, { signal: pageTimer.signal });
      if (!response.ok) break;
      const payload = await response.json();
      batch = payload.data || [];
    } catch {
      break;
    } finally {
      pageTimer.cancel();
    }
    if (!batch.length) break;
    raw.push(...batch);
    if (batch.length < 100) break;
  }
  return raw.slice(0, target).map((row) => ({
    time: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5])
  })).reverse();
}

// 回测用：拉取历史 K 线（OKX 主、Binance 备），不改动 db 状态。
// limit>300 时对 OKX 走分页，凑足样本（专业回测需要足够 bar）。
export async function getHistoricalKlines(symbol, timeframe = "1h", limit = 300, exchange = "OKX") {
  if (String(exchange).toUpperCase() === "OKX" && limit > 300) {
    try {
      const paged = await fetchOkxKlinesPaged(symbol, timeframe, limit);
      if (paged.length >= 300) return paged;
    } catch {
      /* 分页失败则回退单页 */
    }
  }
  const { result } = await withExchangeFailover(exchange, (name) => fetchPublicKlines(name, symbol, timeframe, limit));
  return result;
}

export async function syncPublicKlines(db, exchange = "BINANCE", symbol = "BTC/USDT", timeframe = "1h", options = {}) {
  const { exchange: usedExchange, result: candles, failedOver } = await withExchangeFailover(exchange, (name) => fetchPublicKlines(name, symbol, timeframe));
  exchange = usedExchange;
  if (failedOver) appendTrace(db, "exchange_market", `${fallbackExchange(usedExchange)} 不可用，已切换 ${usedExchange}`, "warning");
  const displaySymbol = symbol.includes("/") ? symbol : symbol.replace("USDT", "/USDT");
  db.markets ||= [];
  let market = db.markets.find((item) => item.symbol === displaySymbol);
  if (!market) {
    market = { symbol: displaySymbol, candles: [], status: "not_synced" };
    db.markets.push(market);
  }
  // sharedSlot=false 时只写 candlesByTf,不动共享 1h 槽(审计 #13:4h/1d 补拉曾把
  // 前端图表与相关性计算用的 candles 反复翻转成混合周期,跨频率相关性统计无效)。
  if (options.sharedSlot !== false) {
    market.candles = candles;
    market.candlesTimeframe = timeframe;
    market.candlesSyncedAt = nowIso();
  }
  // 按周期各存一份（截尾 200 根）：知识技能可能声明 4h/1d 等非默认周期，
  // 若只有单一 candlesTimeframe，非 1h 技能会永远 candle_timeframe_mismatch 而静默失效。
  market.candlesByTf ||= {};
  market.candlesByTf[String(timeframe).toLowerCase()] = { candles: candles.slice(-200), syncedAt: nowIso() };
  if (candles.length) {
    const last = candles[candles.length - 1];
    market.price = last.close;
    market.status = "synced";
    market.lastSyncedExchange = String(exchange).toUpperCase();
    market.lastSyncedAt = nowIso();
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
function reconSnapshotPositions(snap) {
  const map = new Map();
  for (const p of (snap.positions || [])) {
    const qty = Math.abs(Number(p.pos ?? p.positionAmt ?? p.size));
    if (!Number.isFinite(qty) || qty === 0) continue;
    const base = reconBase(p.instId || p.symbol || p.sym || "");
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

  const snap = (db.accountSnapshots || []).find((s) => s.accountId === account.id && s.status === "ok")
    || (db.accountSnapshots || []).find((s) => s.status === "ok");
  if (!snap) {
    account.reconcileNote = "无交易所只读快照,无法账实比对(仅本地检查)";
  } else {
    const exMap = reconSnapshotPositions(snap);
    const engineBases = new Set();
    // 引擎托管仓 vs 交易所真实持仓(逐仓比对数量,2% 容差)
    for (const p of (db.positions || []).filter((x) => x.source === "execution_engine")) {
      const base = reconBase(p.symbol); engineBases.add(base);
      const localQty = Math.abs(Number(p.size) || 0);
      const exQty = exMap.get(base) || 0;
      if (exQty < 1e-9) differences.push({ type: "missing_on_exchange", symbol: p.symbol, severity: "high", localQty, exchangeQty: 0 });
      else if (Math.abs(localQty - exQty) > Math.max(1e-6, localQty * 0.02)) differences.push({ type: "size_mismatch", symbol: p.symbol, severity: "high", localQty, exchangeQty: exQty });
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
    db.riskIncidents.unshift({ id: id("incident"), severity: "high", status: "open", title: "账户对账发现账实不符", source: account.id, details: differences.filter((d) => d.severity === "high"), createdAt: nowIso() });
  }
  appendAudit(db, `账户与持仓对账:${differences.length ? differences.length + " 项差异" : "账实一致"}`, account.id, "ExchangeConnector", hasHigh ? "warning" : "info");
  appendTrace(db, "reconcile", `${account.exchange} 对账${snap ? "" : "(无快照)"}`, hasHigh ? "warning" : "ok");
  return result;
}

export async function syncPrivateReadOnly(db, accountId) {
  const account = db.exchangeAccounts.find((item) => item.id === accountId);
  if (!account) return { status: "missing_account", accountId };
  const exchange = String(account.exchange).toUpperCase();
  let result;
  if (exchange === "BINANCE") result = await syncBinanceReadOnly();
  else if (exchange === "OKX") result = await syncOkxReadOnly();
  else result = { status: "unsupported_exchange", exchange };

  const snapshot = {
    id: id("snap"),
    accountId: account.id,
    exchange,
    status: result.status,
    balances: result.balances || [],
    positions: result.positions || [],
    openOrders: result.openOrders || [],
    fundingRates: result.fundingRates || [],
    apiPermissions: result.apiPermissions,
    error: result.error,
    createdAt: nowIso()
  };
  db.accountSnapshots.unshift(snapshot);
  if (snapshot.status === "ok") await applyPrivateSnapshotToState(db, snapshot);
  account.lastReadSyncAt = snapshot.createdAt;
  account.readSyncStatus = snapshot.status;
  appendAudit(db, `私有只读同步：${snapshot.status}`, account.id, "ExchangeConnector", snapshot.status === "ok" ? "info" : "warning");
  appendTrace(db, "exchange_private_read", `${exchange} 私有只读同步`, snapshot.status === "ok" ? "ok" : "warning");
  return snapshot;
}

async function syncBinanceReadOnly() {
  if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_API_SECRET) {
    return { status: "missing_credentials", error: "BINANCE_API_KEY or BINANCE_API_SECRET is missing" };
  }
  try {
    const [accountResult, positionResult, openOrdersResult, fundingResult, permissionResult] = await Promise.allSettled([
      binanceSignedRequest("/api/v3/account"),
      binanceSignedRequest("/fapi/v3/positionRisk"),
      binanceSignedRequest("/fapi/v1/openOrders"),
      binancePublicRequest(`${BINANCE_USDM_BASE}/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1`),
      binanceSignedRequest("/sapi/v1/account/apiRestrictions")
    ]);
    const account = accountResult.status === "fulfilled" ? accountResult.value : {};
    const positions = positionResult.status === "fulfilled" ? positionResult.value : [];
    const openOrders = openOrdersResult.status === "fulfilled" ? openOrdersResult.value : [];
    const funding = fundingResult.status === "fulfilled" ? fundingResult.value : [];
    const apiPermissions = permissionResult.status === "fulfilled" ? permissionResult.value : { status: "unavailable", error: permissionResult.reason?.message };
    return {
      status: "ok",
      balances: (account.balances || []).filter((item) => Number(item.free) || Number(item.locked)).slice(0, 50),
      positions: Array.isArray(positions) ? positions.filter((item) => Number(item.positionAmt || 0) !== 0) : [],
      openOrders: Array.isArray(openOrders) ? openOrders.map(maskOrder).slice(0, 50) : [],
      fundingRates: Array.isArray(funding) ? funding.slice(0, 5) : [],
      apiPermissions
    };
  } catch (error) {
    return { status: "request_failed", error: error.message };
  }
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
        createdAt: nowIso()
      });
      appendAudit(db, "检测到 Binance API Key 提现权限，触发熔断", item.id, "ExchangeConnector", "critical");
    }
  }
  if (snapshot.exchange === "OKX") {
    item.permissionVerificationStatus = "manual_required";
    item.permissionVerificationNote = "OKX 公开交易 API 未提供等价的当前 Key 权限查询接口；需在 OKX API 管理页面确认未勾选 Withdraw。";
  }
}

function upsertExchangePosition(db, key, fields) {
  const existing = db.positions.find((item) => item.exchangePositionKey === key);
  const position = existing || { id: id("pos"), exchangePositionKey: key, source: "exchange_rest", createdAt: nowIso() };
  Object.assign(position, fields, { updatedAt: nowIso() });
  if (!existing) db.positions.unshift(position);
  return position;
}

function pruneExchangePositions(db, exchange, seenKeys) {
  // 权威 REST 快照应用后:剪掉该交易所里"快照没有"的非引擎持仓——不止 exchange_rest,
  // 也含 WS 补记的 exchange_ws 外部/手动仓(否则漏收平仓回执的 WS 仓会成幽灵仓,size≠0 逃过空槽清扫)。
  // 引擎托管仓(execution_engine)不在此剪,由 reconcileAccount 逐仓比对告警。
  db.positions = (db.positions || []).filter((position) => {
    if (position.exchange !== exchange) return true;
    if (position.source !== "exchange_rest" && position.source !== "exchange_ws") return true;
    return seenKeys.has(position.exchangePositionKey);
  });
}

function upsertOpenOrders(db, exchange, orders = []) {
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
  db.orders = (db.orders || []).filter((order) => {
    if (order.source !== "exchange_rest" || order.exchange !== exchange) return true;
    return seen.has(order.exchangeOrderKey);
  });
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
  if (okxSpecCache.has(instId)) return okxSpecCache.get(instId);
  try {
    const timer = timeoutSignal();
    const raw = await fetch(`${OKX_BASE}/api/v5/public/instruments?instType=SWAP&instId=${encodeURIComponent(instId)}`, { signal: timer.signal }).then((r) => r.json());
    const row = raw.data?.[0];
    // tickSz=价格最小变动(px/止损/止盈价必须是它的整数倍),lotSz=张数步长,minSz=最小张数,ctVal=每张面值。
    const spec = row ? { ctVal: Number(row.ctVal), lotSz: Number(row.lotSz) || 1, minSz: Number(row.minSz) || 1, tickSz: Number(row.tickSz) || null } : null;
    if (spec && Number.isFinite(spec.ctVal) && spec.ctVal > 0) { okxSpecCache.set(instId, spec); okxCtValCache.set(instId, spec.ctVal); return spec; }
  } catch { /* 拿不到规格返回 null,下单侧 fail-closed */ }
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
let okxPosModeCache = { mode: null, at: 0 };
export async function okxPositionMode() {
  if (okxPosModeCache.mode && Date.now() - okxPosModeCache.at < 600000) return okxPosModeCache.mode;
  try {
    const raw = await okxSignedRequest("/api/v5/account/config", "GET");
    const mode = raw?.data?.[0]?.posMode || null;
    if (mode) okxPosModeCache = { mode, at: Date.now() };
    return mode;
  } catch { return okxPosModeCache.mode; }
}

export async function applyOkxSnapshot(db, snapshot) {
  const seen = new Set();
  for (const payload of snapshot.positions || []) {
    const size = Number(payload.pos || 0);
    if (!Number.isFinite(size) || size === 0) continue;
    const symbol = normalizeOkxDisplaySymbol(payload.instId);
    const posSide = payload.posSide || (size < 0 ? "short" : "long");
    const key = `OKX:${symbol}:${posSide}`;
    seen.add(key);
    const ctVal = await okxContractValue(payload.instId);
    upsertExchangePosition(db, key, {
      exchange: "OKX",
      symbol,
      posSide,
      direction: posSide === "short" ? "short" : "long",
      size: Math.abs(size),                          // 合约张数（OKX 原始口径）
      contractMultiplier: ctVal,                     // 面值：币数量 = 张数 × ctVal
      coinSize: ctVal ? Math.abs(size) * ctVal : null, // 币数量（展示用，真实换算）
      entry: Number(payload.avgPx || 0),
      mark: Number(payload.markPx || 0),             // 标记价（交易所强平/浮盈基准）
      liqPx: Number(payload.liqPx) || null,          // 真实预估强平价
      pnl: Number(payload.upl || 0),                 // 交易所权威浮盈，不用本地公式冒充
      leverage: Number(payload.lever || 0),
      marginMode: payload.mgnMode,
      rawSyncedAt: snapshot.createdAt
    });
  }
  pruneExchangePositions(db, "OKX", seen);
  upsertOpenOrders(db, "OKX", snapshot.openOrders);
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
    const [balance, positions, openOrders] = await Promise.all([
      okxSignedRequest("/api/v5/account/balance"),
      okxSignedRequest("/api/v5/account/positions"),
      okxSignedRequest("/api/v5/trade/orders-pending")
    ]);
    return {
      status: "ok",
      balances: balance.data || [],
      positions: positions.data || [],
      openOrders: (openOrders.data || []).map(maskOrder).slice(0, 50),
      fundingRates: []
    };
  } catch (error) {
    return { status: "request_failed", error: error.message };
  }
}

async function binancePublicRequest(url) {
  const timer = timeoutSignal();
  try {
    const response = await fetch(url, { signal: timer.signal });
    if (!response.ok) throw new Error(`Binance public HTTP ${response.status}`);
    return response.json();
  } finally {
    timer.cancel();
  }
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

export async function okxSignedRequest(pathname, method = "GET", body = "") {
  const timestamp = new Date().toISOString();
  const prehash = `${timestamp}${method}${pathname}${body}`;
  const sign = crypto.createHmac("sha256", process.env.OKX_API_SECRET).update(prehash).digest("base64");
  const timer = timeoutSignal();
  try {
    const response = await fetch(`${OKX_BASE}${pathname}`, {
      method,
      signal: timer.signal,
      headers: {
        "OK-ACCESS-KEY": process.env.OKX_API_KEY,
        "OK-ACCESS-SIGN": sign,
        "OK-ACCESS-TIMESTAMP": timestamp,
        "OK-ACCESS-PASSPHRASE": process.env.OKX_API_PASSPHRASE,
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
  const safe = { ...payload };
  delete safe.apiSecret;
  delete safe.secret;
  delete safe.passphrase;
  delete safe.password;
  return safe;
}
