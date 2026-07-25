import crypto from "node:crypto";
import WebSocket from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

// ws 库不走 undici 的全局代理；若环境配了代理（如本机 Clash），WS 需显式带 agent，否则直连被重置。
function wsOptions() {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
  return proxyUrl ? { agent: new HttpsProxyAgent(proxyUrl) } : undefined;
}

const BINANCE_PUBLIC_BASE = "wss://stream.binance.com:9443/stream";
const BINANCE_USER_BASE = "wss://stream.binance.com:9443/ws";
const BINANCE_REST_BASE = "https://api.binance.com";
const OKX_PUBLIC_WS = "wss://ws.okx.com:8443/ws/v5/public";
const OKX_PRIVATE_WS = "wss://ws.okx.com:8443/ws/v5/private";
const runtime = {
  started: false,
  sockets: new Map(),
  reconnectTimers: new Map()
};
let lastMsgSaveAt = 0; // 行情/私有 WS 消息触发的落盘全局节流时间戳（避免每条 tick 全库序列化）

export function startRealtimeManager(db, saveDb, options = {}) {
  if (runtime.started && !options.force) return realtimeStatus(db);
  runtime.started = true;
  const okxKeys = process.env.OKX_API_KEY && process.env.OKX_API_SECRET && process.env.OKX_API_PASSPHRASE;
  const binanceKeys = process.env.BINANCE_API_KEY;
  // 公有行情 WS：OKX 免密钥、可用，一直连；Binance 会被地区屏蔽，仅在已配置密钥（说明能连）时才连，
  // 避免凭空产生一堆连不上的失败连接、把「WebSocket X/Y」拉成 0。
  connectPublicMarket(db, saveDb, "OKX");
  if (binanceKeys) connectPublicMarket(db, saveDb, "BINANCE");
  else removeConnection(db, "BINANCE", "public_market");
  // 私有用户 WS：只有配了对应交易所密钥才连（否则本就 missing_credentials）。
  if (okxKeys) connectPrivateUser(db, saveDb, "OKX"); else removeConnection(db, "OKX", "private_user");
  if (binanceKeys) connectPrivateUser(db, saveDb, "BINANCE"); else removeConnection(db, "BINANCE", "private_user");
  return realtimeStatus(db);
}

// 去掉不适用的连接记录（未配置的交易所），避免显示成失败连接。
function removeConnection(db, exchange, streamType) {
  db.realtimeConnections = (db.realtimeConnections || []).filter((item) => !(item.exchange === exchange && item.streamType === streamType));
}

export function stopRealtimeManager(db, reason = "manual_stop") {
  for (const timer of runtime.reconnectTimers.values()) clearTimeout(timer);
  runtime.reconnectTimers.clear();
  for (const socket of runtime.sockets.values()) {
    try {
      socket.close(1000, reason);
    } catch {
      // ignore close errors
    }
  }
  runtime.sockets.clear();
  runtime.started = false;
  markAllStopped(db, reason);
  return realtimeStatus(db);
}

export function realtimeStatus(db) {
  return {
    started: runtime.started,
    socketCount: runtime.sockets.size,
    connections: db.realtimeConnections || []
  };
}

export function connectPublicMarket(db, saveDb, exchange = "BINANCE") {
  const normalized = String(exchange).toUpperCase();
  const connection = ensureConnection(db, normalized, "public_market");
  if (runtime.sockets.has(connection.id)) return connection;

  if (normalized === "OKX") return connectOkxPublic(db, saveDb, connection);
  return connectBinancePublic(db, saveDb, connection);
}

export async function connectPrivateUser(db, saveDb, exchange = "BINANCE") {
  const normalized = String(exchange).toUpperCase();
  const connection = ensureConnection(db, normalized, "private_user");
  if (runtime.sockets.has(connection.id)) return connection;
  if (normalized === "OKX") return connectOkxPrivate(db, saveDb, connection);
  return connectBinancePrivate(db, saveDb, connection);
}

async function connectBinancePrivate(db, saveDb, connection) {
  if (!process.env.BINANCE_API_KEY) {
    connection.status = "missing_credentials";
    return connection;
  }
  try {
    connection.status = "creating_listen_key";
    const response = await fetch(`${BINANCE_REST_BASE}/api/v3/userDataStream`, {
      method: "POST",
      headers: { "X-MBX-APIKEY": process.env.BINANCE_API_KEY }
    });
    if (!response.ok) throw new Error(`listenKey HTTP ${response.status}`);
    const { listenKey } = await response.json();
    connection.url = `${BINANCE_USER_BASE}/***`;
    connection.listenKeyCreatedAt = nowIso();
    const socket = new WebSocket(`${BINANCE_USER_BASE}/${listenKey}`, wsOptions());
    runtime.sockets.set(connection.id, socket);
    wireSocket(db, saveDb, connection, socket, (message) => {
      const payload = JSON.parse(message.toString());
      connection.lastEventType = payload.e;
      if (payload.e === "executionReport") upsertBinanceExecution(db, payload);
      if (payload.e === "outboundAccountPosition") connection.lastAccountUpdateAt = nowIso();
    });
  } catch (error) {
    connection.status = "error";
    connection.error = error.message;
  }
  return connection;
}

function connectOkxPrivate(db, saveDb, connection) {
  if (!process.env.OKX_API_KEY || !process.env.OKX_API_SECRET || !process.env.OKX_API_PASSPHRASE) {
    connection.status = "missing_credentials";
    return connection;
  }
  connection.status = "connecting";
  connection.url = OKX_PRIVATE_WS;
  const socket = new WebSocket(OKX_PRIVATE_WS, wsOptions());
  runtime.sockets.set(connection.id, socket);
  socket.on("open", () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const sign = crypto.createHmac("sha256", process.env.OKX_API_SECRET).update(`${timestamp}GET/users/self/verify`).digest("base64");
    socket.send(JSON.stringify({ op: "login", args: [{ apiKey: process.env.OKX_API_KEY, passphrase: process.env.OKX_API_PASSPHRASE, timestamp, sign }] }));
  });
  wireSocket(db, saveDb, connection, socket, (message) => {
    const payload = JSON.parse(message.toString());
    if (payload.event === "login" && payload.code === "0") {
      socket.send(JSON.stringify({ op: "subscribe", args: [{ channel: "orders", instType: "ANY" }, { channel: "positions", instType: "ANY" }, { channel: "account" }] }));
      connection.authenticatedAt = nowIso();
    }
    if (payload.arg?.channel === "orders") for (const order of payload.data || []) upsertOkxOrder(db, order);
    if (payload.arg?.channel === "positions") updateOkxPositions(db, payload.data || []);
    if (payload.arg?.channel === "account") connection.lastAccountUpdateAt = nowIso();
  });
  return connection;
}

function connectBinancePublic(db, saveDb, connection) {
  const streams = (connection.symbols || ["BTC/USDT"]).map((symbol) => `${toBinanceSymbol(symbol).toLowerCase()}@ticker`).join("/");
  const url = `${BINANCE_PUBLIC_BASE}?streams=${streams}`;
  connection.status = "connecting";
  connection.url = redactUrl(url);
  const socket = new WebSocket(url, wsOptions());
  runtime.sockets.set(connection.id, socket);
  wireSocket(db, saveDb, connection, socket, (message) => {
    const payload = JSON.parse(message.toString());
    const ticker = payload.data || payload;
    if (!ticker.s) return;
    updateMarketFromTicker(db, ticker.s, {
      price: Number(ticker.c),
      high24h: Number(ticker.h),
      low24h: Number(ticker.l),
      changePct: Number(ticker.P),
      volume24h: ticker.q,
      source: "BINANCE_WS"
    });
  });
  return connection;
}

function connectOkxPublic(db, saveDb, connection) {
  connection.status = "connecting";
  connection.url = OKX_PUBLIC_WS;
  const socket = new WebSocket(OKX_PUBLIC_WS, wsOptions());
  runtime.sockets.set(connection.id, socket);
  socket.on("open", () => {
    socket.send(JSON.stringify({
      op: "subscribe",
      args: (connection.symbols || ["BTC/USDT"]).map((symbol) => ({ channel: "tickers", instId: toOkxSymbol(symbol) }))
    }));
  });
  wireSocket(db, saveDb, connection, socket, (message) => {
    const payload = JSON.parse(message.toString());
    const ticker = payload.data?.[0];
    if (!ticker?.instId) return;
    updateMarketFromTicker(db, ticker.instId, {
      price: Number(ticker.last),
      high24h: Number(ticker.high24h),
      low24h: Number(ticker.low24h),
      volume24h: ticker.volCcy24h,
      source: "OKX_WS"
    });
  });
  return connection;
}

export function preparePrivateStreams(db) {
  const binance = ensureConnection(db, "BINANCE", "private_user");
  binance.status = process.env.BINANCE_API_KEY ? "ready_requires_listen_key" : "missing_credentials";
  binance.note = "Binance private user stream requires a user data stream session/listen key. REST read-only sync is active separately.";

  const okx = ensureConnection(db, "OKX", "private_user");
  okx.status = process.env.OKX_API_KEY && process.env.OKX_API_SECRET && process.env.OKX_API_PASSPHRASE ? "ready_for_login" : "missing_credentials";
  okx.note = "OKX private stream login is prepared; account/orders/positions are still reconciled through signed REST until private WS is enabled.";
  okx.loginPreview = okx.status === "ready_for_login" ? buildOkxLoginPreview() : null;
  return { binance, okx };
}

function wireSocket(db, saveDb, connection, socket, onMessage) {
  socket.on("open", () => {
    connection.status = "connected";
    connection.connectedAt = nowIso();
    connection.error = null;
    appendAudit(db, "实时 WebSocket 已连接", connection.id, "RealtimeManager");
    appendTrace(db, "realtime_ws", `${connection.exchange} ${connection.streamType} connected`);
    if (saveDb) saveDb(db);
  });
  socket.on("message", (message) => {
    try {
      onMessage(message);
      connection.lastMessageAt = nowIso();
      connection.status = "connected";
      // 关键：公有行情 WS 每秒推 10-40 条，绝不能每条都 saveDb（每次都全库序列化落盘→100% CPU）。
      // 逐条更新只留在内存（API 从内存读），落盘全局节流到最多每 8s 一次，足够重启后恢复连接状态/私有仓位。
      const now = Date.now();
      if (saveDb && now - lastMsgSaveAt > 8000) { lastMsgSaveAt = now; saveDb(db); }
    } catch (error) {
      connection.lastError = error.message;
    }
  });
  socket.on("error", (error) => {
    connection.status = "error";
    connection.error = error.message;
    appendAudit(db, "实时 WebSocket 错误", connection.id, "RealtimeManager", "warning");
    appendTrace(db, "realtime_ws", `${connection.exchange} ${connection.streamType} error`, "error");
    if (saveDb) saveDb(db);
  });
  socket.on("close", () => {
    runtime.sockets.delete(connection.id);
    if (!runtime.started) return;
    connection.status = "reconnecting";
    connection.reconnects = Number(connection.reconnects || 0) + 1;
    const delayMs = Math.min(30_000, 2_000 * connection.reconnects);
    const timer = setTimeout(() => {
      if (connection.streamType === "private_user") connectPrivateUser(db, saveDb, connection.exchange);
      else if (connection.exchange === "OKX") connectOkxPublic(db, saveDb, connection);
      else connectBinancePublic(db, saveDb, connection);
    }, delayMs);
    runtime.reconnectTimers.set(connection.id, timer);
    if (saveDb) saveDb(db);
  });
}

function ensureConnection(db, exchange, streamType) {
  db.realtimeConnections ||= [];
  let connection = db.realtimeConnections.find((item) => item.exchange === exchange && item.streamType === streamType);
  if (!connection) {
    connection = { id: id("rt"), exchange, streamType, status: "stopped", symbols: ["BTC/USDT", "ETH/USDT", "SOL/USDT"], lastMessageAt: null, reconnects: 0 };
    db.realtimeConnections.unshift(connection);
  }
  return connection;
}

function updateMarketFromTicker(db, rawSymbol, ticker) {
  const symbol = normalizeDisplaySymbol(rawSymbol);
  const market = db.markets.find((item) => item.symbol === symbol);
  if (!market) return;
  if (Number.isFinite(ticker.price)) market.price = ticker.price;
  if (Number.isFinite(ticker.high24h)) market.high24h = ticker.high24h;
  if (Number.isFinite(ticker.low24h)) market.low24h = ticker.low24h;
  if (Number.isFinite(ticker.changePct)) market.changePct = ticker.changePct;
  if (ticker.volume24h) market.volume24h = compactNumber(ticker.volume24h);
  market.lastRealtimeSource = ticker.source;
  market.lastRealtimeAt = nowIso();
}

function markAllStopped(db, status) {
  for (const connection of db.realtimeConnections || []) {
    connection.status = status;
  }
}

function toBinanceSymbol(symbol) {
  return String(symbol || "BTC/USDT").replace("/", "").replace("-", "").toUpperCase();
}

function toOkxSymbol(symbol) {
  return String(symbol || "BTC/USDT").replace("/", "-").toUpperCase();
}

function normalizeDisplaySymbol(rawSymbol) {
  const text = String(rawSymbol || "BTCUSDT").replace("-", "").toUpperCase();
  if (text.endsWith("USDT")) return `${text.slice(0, -4)}/USDT`;
  return text;
}

function compactNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  if (numeric >= 1_000_000_000) return `${(numeric / 1_000_000_000).toFixed(2)}B`;
  if (numeric >= 1_000_000) return `${(numeric / 1_000_000).toFixed(2)}M`;
  return numeric.toFixed(2);
}

function redactUrl(url) {
  return url.replace(/listenKey=[^&]+/i, "listenKey=***");
}

function buildOkxLoginPreview() {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sign = crypto.createHmac("sha256", process.env.OKX_API_SECRET || "").update(`${timestamp}GET/users/self/verify`).digest("base64");
  return { op: "login", args: [{ apiKey: "***", passphrase: "***", timestamp, sign: sign ? "***" : "" }], ws: OKX_PRIVATE_WS };
}

function upsertBinanceExecution(db, payload) {
  const orderId = String(payload.i || payload.c || id("ord"));
  const existing = db.orders.find((order) => order.exchangeOrderId === orderId || order.clientOrderId === payload.c);
  const order = existing || { id: id("ord"), exchange: "BINANCE", exchangeOrderId: orderId, clientOrderId: payload.c, createdAt: nowIso() };
  order.symbol = normalizeDisplaySymbol(payload.s);
  order.side = payload.S;
  order.type = payload.o;
  order.status = payload.X;
  order.price = Number(payload.p);
  order.quantity = payload.q;
  order.lastExecutionType = payload.x;
  order.updatedAt = nowIso();
  if (!existing) db.orders.unshift(order);
  if (payload.x === "TRADE") {
    db.fills.unshift(enrichRealtimeFill(db, order, {
      exchange: "BINANCE",
      price: Number(payload.L),
      quantity: Number(payload.l),
      feeUsdt: parseFee(payload.n, payload.N),
      side: order.side
    }));
  }
}

function upsertOkxOrder(db, payload) {
  const existing = db.orders.find((order) => order.exchangeOrderId === payload.ordId || order.clientOrderId === payload.clOrdId);
  const order = existing || { id: id("ord"), exchange: "OKX", exchangeOrderId: payload.ordId, clientOrderId: payload.clOrdId, createdAt: nowIso() };
  order.symbol = payload.instId?.replace("-", "/");
  order.side = payload.side;
  order.type = payload.ordType;
  order.status = payload.state;
  order.price = Number(payload.px || 0);
  order.quantity = payload.sz;
  order.updatedAt = nowIso();
  if (!existing) db.orders.unshift(order);
  if (payload.fillSz && Number(payload.fillSz) > 0) {
    db.fills.unshift(enrichRealtimeFill(db, order, {
      exchange: "OKX",
      price: Number(payload.fillPx || 0),
      quantity: Number(payload.fillSz),
      feeUsdt: parseFee(payload.fee, payload.feeCcy),
      side: order.side
    }));
  }
}

function enrichRealtimeFill(db, order, payload = {}) {
  const executionOrder = (db.executionOrders || []).find((item) =>
    item.exchangeOrderId === order.exchangeOrderId ||
    item.clientOrderId === order.clientOrderId ||
    item.planId === order.planId
  );
  const plan = (db.tradePlans || []).find((item) => item.id === executionOrder?.planId || item.id === order.planId) || {};
  const price = Number(payload.price || 0);
  const quantity = Number(payload.quantity || 0);
  const notional = price * quantity;
  const expectedPrice = executionOrder?.entryPrice || order.price;
  const slippageBps = expectedPrice ? Number((((price - Number(expectedPrice)) / Number(expectedPrice)) * 10000).toFixed(2)) : null;
  const feeUsdt = payload.feeUsdt ?? Number((Math.abs(notional) * 0.0004).toFixed(6));
  return {
    id: id("fill"),
    orderId: order.id,
    executionOrderId: executionOrder?.id,
    planId: executionOrder?.planId || order.planId,
    tradePlanId: executionOrder?.planId || order.planId,
    agentRunId: executionOrder?.agentRunId,
    riskCheckId: executionOrder?.riskCheckId,
    mandateId: executionOrder?.mandateId,
    symbol: order.symbol,
    side: payload.side,
    direction: executionOrder?.direction,
    strategy: executionOrder?.strategy || plan.strategy || plan.strategy_type || "manual_review",
    kind: order.reduceOnly || /sell|buy/i.test(String(payload.side || "")) && executionOrder?.status === "protecting" ? "close" : "entry",
    price,
    size: quantity,
    quantity,
    notionalUsdt: notional,
    expectedPrice,
    slippageBps,
    feeUsdt,
    fee: feeUsdt === null ? undefined : `${feeUsdt} USDT`,
    estimatedFee: payload.feeUsdt === undefined,
    entryRationale: executionOrder?.entryRationale || plan.rationale || plan.analysis || "未记录入场理由",
    createdAt: nowIso()
  };
}

function parseFee(value, currency) {
  const amount = Math.abs(Number(value));
  if (!Number.isFinite(amount)) return null;
  if (!currency || String(currency).toUpperCase() === "USDT") return amount;
  return null;
}

function updateOkxPositions(db, positions) {
  for (const payload of positions) {
    const symbol = payload.instId?.replace("-", "/");
    if (!symbol) continue;
    const existing = db.positions.find((position) => position.exchange === "OKX" && position.symbol === symbol && position.posSide === payload.posSide);
    const position = existing || { id: id("pos"), exchange: "OKX", symbol, posSide: payload.posSide, createdAt: nowIso() };
    position.size = payload.pos;
    position.entry = Number(payload.avgPx || 0);
    position.mark = Number(payload.markPx || 0);
    position.pnl = Number(payload.upl || 0);
    position.leverage = Number(payload.lever || 0);
    position.updatedAt = nowIso();
    if (!existing) db.positions.unshift(position);
  }
}
