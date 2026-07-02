import crypto from "node:crypto";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

const BINANCE_TICKER_URL = "https://api.binance.com/api/v3/ticker/24hr";
const OKX_TICKER_URL = "https://www.okx.com/api/v5/market/ticker";
const BINANCE_SPOT_BASE = "https://api.binance.com";
const BINANCE_USDM_BASE = "https://fapi.binance.com";
const OKX_BASE = "https://www.okx.com";

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
    if (item.exchange === "BINANCE") {
      item.hasApiKey = Boolean(process.env.BINANCE_API_KEY);
      item.hasSecret = Boolean(process.env.BINANCE_API_SECRET);
    }
    if (item.exchange === "OKX") {
      item.hasApiKey = Boolean(process.env.OKX_API_KEY);
      item.hasSecret = Boolean(process.env.OKX_API_SECRET && process.env.OKX_API_PASSPHRASE);
    }
    item.withdrawPermission = false;
    item.secretInLogs = false;
    item.updatedAt = nowIso();
  }
  for (const account of db.exchangeAccounts || []) {
    const metadata = db.apiKeyMetadata.find((key) => key.accountId === account.id);
    account.readEnabled = Boolean(metadata?.hasApiKey);
    account.tradeEnabled = Boolean(metadata?.hasApiKey && metadata?.hasSecret);
    account.withdrawEnabled = false;
    account.status = account.readEnabled ? "configured" : "missing_credentials";
  }
  return db.apiKeyMetadata;
}

export async function fetchPublicTicker(exchange, symbol) {
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

export async function syncPublicMarket(db, exchange = "BINANCE", symbol = "BTC/USDT") {
  const ticker = await fetchPublicTicker(exchange, symbol);
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

export function reconcileAccount(db, accountId) {
  const account = db.exchangeAccounts.find((item) => item.id === accountId) || db.exchangeAccounts[0];
  if (!account) return { status: "missing_account", differences: [] };
  const differences = [];
  const stoplessPositions = db.positions.filter((position) => !position.stopLoss);
  for (const position of stoplessPositions) {
    differences.push({ type: "missing_stop_loss", symbol: position.symbol, severity: "high" });
  }
  account.lastReconciledAt = nowIso();
  account.reconcileStatus = differences.length ? "needs_attention" : "ok";
  const result = { id: id("reconcile"), accountId: account.id, status: account.reconcileStatus, differences, createdAt: nowIso() };
  if (differences.length) {
    db.riskIncidents.unshift({ id: id("incident"), severity: "high", status: "open", title: "账户对账发现异常", source: account.id, details: differences, createdAt: nowIso() });
  }
  appendAudit(db, "账户与持仓对账", account.id, "ExchangeConnector", differences.length ? "warning" : "info");
  appendTrace(db, "reconcile", `${account.exchange} 对账`, differences.length ? "warning" : "ok");
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
    error: result.error,
    createdAt: nowIso()
  };
  db.accountSnapshots.unshift(snapshot);
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
    const [account, openOrders, funding] = await Promise.all([
      binanceSignedRequest("/api/v3/account"),
      binanceSignedRequest("/api/v3/openOrders"),
      binancePublicRequest(`${BINANCE_USDM_BASE}/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1`)
    ]);
    return {
      status: "ok",
      balances: (account.balances || []).filter((item) => Number(item.free) || Number(item.locked)).slice(0, 50),
      positions: [],
      openOrders: Array.isArray(openOrders) ? openOrders.map(maskOrder).slice(0, 50) : [],
      fundingRates: Array.isArray(funding) ? funding.slice(0, 5) : []
    };
  } catch (error) {
    return { status: "request_failed", error: error.message };
  }
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
        "Content-Type": "application/json"
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
