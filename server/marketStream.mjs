// ---------------------------------------------------------------------------
// 真·实时行情流：连 OKX 公有 WebSocket，订阅 tickers/资金费率/未平仓量，
// 逐笔更新内存中的 db.markets，并把每次更新广播给 SSE 订阅者（前端）。
//   - 只更新内存，不每 tick 落盘（避免磁盘抖动；定时任务会定期持久化）。
//   - 公有行情无需密钥，boot 即启动；断线自动重连、定时心跳保活。
// 账户余额/持仓的实时推送需要私有 WS（要 API 凭证），待配置交易所后再接。
// ---------------------------------------------------------------------------
import WebSocket from "ws";
import { toOkxSymbol } from "./exchangeConnector.mjs";
import { nowIso } from "./store.mjs";

const OKX_WS = "wss://ws.okx.com:8443/ws/v5/public";
const listeners = new Set();

let ws = null;
let pingTimer = null;
let reconnectTimer = null;
let resubTimer = null;
let dbRef = null;
let currentSymbols = [];
let connected = false;

function instToSymbol(instId) {
  return String(instId).replace("-SWAP", "").replace("-", "/");
}

function trackedSymbols(db) {
  const mandate = (db.mandates || []).find((m) => ["active", "running"].includes(m.status));
  return [...new Set(["BTC/USDT", "ETH/USDT", ...((mandate && mandate.allowedSymbols) || [])])].slice(0, 6);
}

function ensureMarket(db, symbol) {
  let market = (db.markets = db.markets || []).find((item) => item.symbol === symbol);
  if (!market) {
    market = { id: `mkt_${symbol.replace("/", "_").toLowerCase()}`, symbol, price: null, status: "synced" };
    db.markets.push(market);
  }
  return market;
}

export function startMarketStream(db) {
  dbRef = db;
  connect();
  // 定时检查授权交易对是否变化，变了就重订阅。
  if (!resubTimer) resubTimer = setInterval(() => resubscribe(), 120000);
}

function connect() {
  try {
    ws = new WebSocket(OKX_WS);
  } catch {
    scheduleReconnect();
    return;
  }
  ws.on("open", () => {
    connected = true;
    subscribe();
    startPing();
  });
  ws.on("message", (raw) => handleMessage(raw));
  ws.on("close", () => {
    connected = false;
    stopPing();
    scheduleReconnect();
  });
  ws.on("error", () => {
    try { ws.close(); } catch { /* noop */ }
  });
}

function subscribe() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  currentSymbols = trackedSymbols(dbRef);
  const args = [];
  for (const symbol of currentSymbols) {
    const instId = toOkxSymbol(symbol, "perpetual");
    args.push({ channel: "tickers", instId });
    args.push({ channel: "funding-rate", instId });
    args.push({ channel: "open-interest", instId });
  }
  try { ws.send(JSON.stringify({ op: "subscribe", args })); } catch { /* noop */ }
}

function resubscribe() {
  const next = trackedSymbols(dbRef);
  if (next.join(",") !== currentSymbols.join(",")) subscribe();
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
function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 3000);
}

function handleMessage(raw) {
  const text = raw.toString();
  if (text === "pong") return;
  let msg;
  try { msg = JSON.parse(text); } catch { return; }
  if (msg.event) return; // 订阅确认/错误回执
  const channel = msg.arg && msg.arg.channel;
  const d = msg.data && msg.data[0];
  if (!channel || !d) return;
  const symbol = instToSymbol(msg.arg.instId);
  const market = ensureMarket(dbRef, symbol);
  const update = { symbol };
  if (channel === "tickers") {
    const last = Number(d.last);
    const open = Number(d.open24h);
    if (Number.isFinite(last)) { market.price = last; update.price = last; }
    if (open > 0 && Number.isFinite(last)) { market.changePct = Number((((last - open) / open) * 100).toFixed(3)); update.changePct = market.changePct; }
    if (d.high24h) market.high24h = Number(d.high24h);
    if (d.low24h) market.low24h = Number(d.low24h);
    market.lastRealtimeAt = nowIso();
    market.lastRealtimeSource = "OKX_WS";
    market.status = "synced";
  } else if (channel === "funding-rate") {
    market.fundingRate = Number(d.fundingRate) * 100;
    update.fundingRate = market.fundingRate;
  } else if (channel === "open-interest") {
    market.openInterest = Number(d.oiCcy || d.oi);
    update.openInterest = market.openInterest;
  }
  broadcast(update);
}

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
