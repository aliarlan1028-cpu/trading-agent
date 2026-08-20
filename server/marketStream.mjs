// ---------------------------------------------------------------------------
// 真·实时行情流：连 OKX 公有 WebSocket，订阅 tickers/资金费率/未平仓量，
// 逐笔更新内存中的 db.markets，并把每次更新广播给 SSE 订阅者（前端）。
//   - 只更新内存，不每 tick 落盘（避免磁盘抖动；定时任务会定期持久化）。
//   - 公有行情无需密钥，boot 即启动；断线自动重连、定时心跳保活。
// 账户余额/持仓的实时推送需要私有 WS（要 API 凭证），待配置交易所后再接。
// ---------------------------------------------------------------------------
import WebSocket from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";
import { toOkxSymbol } from "./exchangeConnector.mjs";
import { activeMandate, appendAudit, appendTrace, id, nowIso } from "./store.mjs";
import { markOkxLiquidationStreamConnected, recordOkxLiquidationMessage } from "./okxLiquidationStream.mjs";
import { okxEnvironmentConfig } from "./okxEnvironment.mjs";
import { applyScalarMarketObservation, applyTickerObservation } from "./marketObservation.mjs";

// ws 库不走 undici 全局代理；有代理环境（如本机 Clash）需显式带 agent，否则实时行情 WS 直连被重置。
function wsOptions() {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
  return proxyUrl ? { agent: new HttpsProxyAgent(proxyUrl) } : undefined;
}

const listeners = new Set();
let tickHook = null;
// 注册"每个价格 tick"回调（index.mjs 用它实时重算浮盈亏/组合并推前端 + 实时止盈止损）。
export function setMarketTickHook(fn) { tickHook = fn; }
// 直接向 SSE 订阅者广播任意对象（如组合/持仓实时更新）。
export function broadcastRaw(obj) { for (const fn of listeners) { try { fn(obj); } catch { /* noop */ } } }

let ws = null;
let pingTimer = null;
let reconnectTimer = null;
let resubTimer = null;
let dbRef = null;
let saveDbRef = null;
let connectionRef = null;
let currentSymbols = [];
let connected = false;
let running = false;
let generation = 0;
let lastMsgSaveAt = 0;

function instToSymbol(instId) {
  return String(instId).replace("-SWAP", "").replace("-", "/");
}

function trackedSymbols(db) {
  const mandate = activeMandate(db);
  const watchlist = (db.watchlist && db.watchlist.length) ? db.watchlist : ["BTC/USDT", "ETH/USDT", "SOL/USDT"];
  // 授权白名单是自主交易的真实工作集，必须优先于普通自选；否则自选较多时允许交易的币反而被 slice 掉。
  return [...new Set(["BTC/USDT", "ETH/USDT", ...((mandate && mandate.allowedSymbols) || []), ...watchlist])].slice(0, 24);
}

function ensureMarket(db, symbol) {
  let market = (db.markets = db.markets || []).find((item) => item.symbol === symbol);
  if (!market) {
    market = { id: `mkt_${symbol.replace("/", "_").toLowerCase()}`, symbol, price: null, status: "synced" };
    db.markets.push(market);
  }
  return market;
}

function ensurePublicConnection(db) {
  db.realtimeConnections ||= [];
  db.realtimeConnections = db.realtimeConnections.filter((item) => !(item.exchange === "BINANCE" && item.streamType === "public_market"));
  let connection = db.realtimeConnections.find((item) => item.exchange === "OKX" && item.streamType === "public_market");
  if (!connection) {
    connection = {
      id: id("rt"),
      exchange: "OKX",
      streamType: "public_market",
      status: "stopped",
      symbols: ["BTC/USDT", "ETH/USDT", "SOL/USDT"],
      lastMessageAt: null,
      reconnects: 0
    };
    db.realtimeConnections.unshift(connection);
  }
  return connection;
}

function saveConnection(options) {
  if (saveDbRef) saveDbRef(dbRef, options);
}

export function startMarketStream(db, saveDb) {
  dbRef = db;
  if (saveDb) saveDbRef = saveDb;
  connectionRef = ensurePublicConnection(db);
  if (running) return marketStreamStatus();
  running = true;
  generation += 1;
  connect(generation);
  // 定时检查授权交易对是否变化，变了就重订阅。
  if (!resubTimer) resubTimer = setInterval(() => { if (running) resubscribe(); }, 120000);
  return marketStreamStatus();
}

function connect(expectedGeneration = generation) {
  if (!running || expectedGeneration !== generation || ws) return;
  connectionRef ||= ensurePublicConnection(dbRef);
  connectionRef.status = "connecting";
  connectionRef.url = okxEnvironmentConfig().publicWs;
  connectionRef.environment = okxEnvironmentConfig().name;
  let socket;
  try {
    socket = new WebSocket(connectionRef.url, wsOptions());
    ws = socket;
  } catch (error) {
    ws = null;
    connectionRef.status = "error";
    connectionRef.error = error.message;
    saveConnection();
    scheduleReconnect(expectedGeneration);
    return;
  }
  socket.on("open", () => {
    if (!running || expectedGeneration !== generation || ws !== socket) return;
    connected = true;
    connectionRef.status = "connected";
    connectionRef.connectedAt = nowIso();
    connectionRef.error = null;
    appendAudit(dbRef, "实时 WebSocket 已连接", connectionRef.id, "RealtimeManager");
    appendTrace(dbRef, "realtime_ws", "OKX public_market connected");
    subscribe();
    startPing();
    saveConnection();
  });
  socket.on("message", (raw) => {
    if (!running || expectedGeneration !== generation || ws !== socket) return;
    handleMessage(raw);
    connectionRef.lastMessageAt = nowIso();
    connectionRef.status = "connected";
    const now = Date.now();
    if (saveDbRef && now - lastMsgSaveAt > 8000) {
      lastMsgSaveAt = now;
      saveConnection({ lightweight: true });
    }
  });
  socket.on("close", () => {
    if (expectedGeneration !== generation || ws !== socket) return;
    ws = null;
    connected = false;
    markOkxLiquidationStreamConnected(false);
    stopPing();
    if (!running) return;
    connectionRef.status = "reconnecting";
    connectionRef.reconnects = Number(connectionRef.reconnects || 0) + 1;
    scheduleReconnect(expectedGeneration);
    saveConnection();
  });
  socket.on("error", (error) => {
    if (!running || expectedGeneration !== generation || ws !== socket) return;
    connectionRef.status = "error";
    connectionRef.error = error.message;
    appendAudit(dbRef, "实时 WebSocket 错误", connectionRef.id, "RealtimeManager", "warning");
    appendTrace(dbRef, "realtime_ws", "OKX public_market error", "error");
    saveConnection();
    try { socket.close(4001, "socket_error"); } catch { /* noop */ }
  });
}

function subscribe() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  currentSymbols = trackedSymbols(dbRef);
  if (connectionRef) connectionRef.symbols = currentSymbols.slice();
  sendSubscription("subscribe", currentSymbols);
  try {
    ws.send(JSON.stringify({ op: "subscribe", args: [{ channel: "liquidation-orders", instType: "SWAP" }] }));
  } catch { /* noop */ }
}

function sendSubscription(op, symbols) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !symbols.length) return;
  const args = [];
  for (const symbol of symbols) {
    const instId = toOkxSymbol(symbol, "perpetual");
    args.push({ channel: "tickers", instId });
    args.push({ channel: "funding-rate", instId });
    args.push({ channel: "open-interest", instId });
  }
  try { ws.send(JSON.stringify({ op, args })); } catch { /* noop */ }
}

function resubscribe() {
  const next = trackedSymbols(dbRef);
  if (next.join(",") === currentSymbols.join(",")) return;
  const previous = new Set(currentSymbols);
  const wanted = new Set(next);
  sendSubscription("unsubscribe", currentSymbols.filter((symbol) => !wanted.has(symbol)));
  sendSubscription("subscribe", next.filter((symbol) => !previous.has(symbol)));
  currentSymbols = next;
  if (connectionRef) connectionRef.symbols = currentSymbols.slice();
}

function startPing() {
  stopPing();
  pingTimer = setInterval(() => {
    try { ws.send("ping"); } catch { /* noop */ }
  }, 20000);
}
function stopPing() {
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
}
function scheduleReconnect(expectedGeneration = generation) {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!running || expectedGeneration !== generation) return;
    connect(expectedGeneration);
  }, 3000);
}

export function stopMarketStream(db = dbRef, reason = "manual_stop") {
  running = false;
  generation += 1;
  if (pingTimer) clearInterval(pingTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (resubTimer) clearInterval(resubTimer);
  pingTimer = null;
  reconnectTimer = null;
  resubTimer = null;
  connected = false;
  markOkxLiquidationStreamConnected(false);
  const socket = ws;
  ws = null;
  try { socket?.close(1000, reason); } catch { /* noop */ }
  const connection = db?.realtimeConnections?.find((item) => item.exchange === "OKX" && item.streamType === "public_market");
  if (connection) connection.status = reason;
  return marketStreamStatus();
}

export function publicMarketSocketCount() {
  return ws ? 1 : 0;
}

export function handleMarketStreamMessage(raw, options = {}) {
  const text = raw.toString();
  if (text === "pong") return;
  let msg;
  try { msg = JSON.parse(text); } catch { return; }
  if (msg.event) {
    if (msg.event === "subscribe" && msg.arg?.channel === "liquidation-orders") markOkxLiquidationStreamConnected(true);
    if (msg.event === "error" && msg.arg?.channel === "liquidation-orders") markOkxLiquidationStreamConnected(false);
    return; // 订阅确认/错误回执
  }
  const channel = msg.arg && msg.arg.channel;
  if (channel === "liquidation-orders") {
    recordOkxLiquidationMessage(msg);
    return;
  }
  const d = msg.data && msg.data[0];
  if (!channel || !d) return;
  const symbol = instToSymbol(msg.arg.instId);
  const targetDb = options.db || dbRef;
  if (!targetDb) return;
  const market = ensureMarket(targetDb, symbol);
  const update = { symbol };
  if (channel === "tickers") {
    const last = Number(d.last);
    const open = Number(d.open24h);
    const result = applyTickerObservation(market, {
      price: last,
      changePct: open > 0 && Number.isFinite(last) ? Number((((last - open) / open) * 100).toFixed(3)) : null,
      high24h: d.high24h,
      low24h: d.low24h,
      streamVolume24h: d.volCcy24h,
      source: "OKX_WS",
      sourceAt: d.ts
    }, { realtime: true, receivedAt: options.receivedAt, now: options.now });
    if (!result.applied) return result;
    Object.assign(update, { price: market.price, changePct: market.changePct, high24h: market.high24h, low24h: market.low24h, streamVolume24h: market.streamVolume24h, sourceAt: market.tickerSourceAt, receivedAt: market.tickerReceivedAt });
    // 每个价格 tick 触发实时浮盈亏/组合重算 + 实时止盈止损检查（交易所条件单之外的安全网）。
    if (tickHook && Number.isFinite(last)) { try { tickHook(targetDb, symbol, last); } catch { /* noop */ } }
  } else if (channel === "funding-rate") {
    const result = applyScalarMarketObservation(market, "fundingRate", Number(d.fundingRate) * 100, { prefix: "funding", sourceAt: d.ts, receivedAt: options.receivedAt, now: options.now });
    if (!result.applied) return result;
    update.fundingRate = market.fundingRate;
  } else if (channel === "open-interest") {
    const result = applyScalarMarketObservation(market, "openInterest", Number(d.oiCcy || d.oi), { prefix: "openInterest", sourceAt: d.ts, receivedAt: options.receivedAt, now: options.now });
    if (!result.applied) return result;
    update.openInterest = market.openInterest;
  }
  if (options.broadcast !== false) broadcast(update);
  return { applied: true, update };
}

function handleMessage(raw) { return handleMarketStreamMessage(raw); }

function broadcast(update) {
  for (const fn of listeners) {
    try { fn(update); } catch { /* 单订阅者失败不影响其他 */ }
  }
}

export function addStreamListener(fn) { listeners.add(fn); }
export function removeStreamListener(fn) { listeners.delete(fn); }
export function marketStreamStatus() {
  return { connected, symbols: currentSymbols, clients: listeners.size };
}
