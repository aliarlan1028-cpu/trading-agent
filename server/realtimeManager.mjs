import crypto from "node:crypto";
import WebSocket from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";
import { appendAudit, appendTrace, findPendingOmsAmend, id, nowIso } from "./store.mjs";
import { okxSignedRequest, toOkxSymbol } from "./exchangeConnector.mjs";
import { canonicalPositionDirection } from "./positionIdentity.mjs";
import { finiteFinancialNumber, okxFeeCost } from "./financialValues.mjs";
import { okxEnvironmentConfig } from "./okxEnvironment.mjs";
import { applyTickerObservation } from "./marketObservation.mjs";
import { publicMarketSocketCount } from "./marketStream.mjs";
import { reconcileAmendOmsOrder } from "./omsRecovery.mjs";
import { buildExternalFillAttribution, classifyTradeFill, findAuthoritativeFillIdentityMatch, reconcilePendingTradeAttributions } from "./systemTradeProjection.mjs";

const financialNumber = (value) => finiteFinancialNumber(value) ? Number(value) : null;

// ws 库不走 undici 的全局代理；若环境配了代理（如本机 Clash），WS 需显式带 agent，否则直连被重置。
function wsOptions() {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
  return proxyUrl ? { agent: new HttpsProxyAgent(proxyUrl) } : undefined;
}

const BINANCE_USER_BASE = "wss://stream.binance.com:9443/ws";
const BINANCE_REST_BASE = "https://api.binance.com";
const runtime = {
  started: false,
  generation: 0,
  sockets: new Map(),
  reconnectTimers: new Map(),
  socketTimers: new Map()
};
let lastMsgSaveAt = 0; // 行情/私有 WS 消息触发的落盘全局节流时间戳（避免每条 tick 全库序列化）
const PRIVATE_STREAM_PERSIST_COLLECTIONS = Object.freeze([
  "realtimeConnections", "orders", "fills", "positions", "portfolio",
  "executionOrders", "exchangeOrders", "tradePlans", "armedSetups", "riskChecks",
  "riskIncidents", "notifications", "ownerImprovementItems", "reviews", "system"
]);

function persistPrivateStreamState(saveDb, db) {
  if (saveDb) saveDb(db, { collections: [...PRIVATE_STREAM_PERSIST_COLLECTIONS] });
}

function socketTimerState(connectionId) {
  let state = runtime.socketTimers.get(connectionId);
  if (!state) {
    state = { heartbeat: null, deadline: null, auth: null, subscribe: null, lastActivityAt: Date.now(), awaitingPong: false };
    runtime.socketTimers.set(connectionId, state);
  }
  return state;
}

function clearSocketTimers(connectionId) {
  const state = runtime.socketTimers.get(connectionId);
  if (!state) return;
  for (const timer of [state.heartbeat, state.deadline, state.auth, state.subscribe]) if (timer) clearTimeout(timer);
  runtime.socketTimers.delete(connectionId);
}

function closeProtocolSocket(connection, socket, generation, reason) {
  if (generation !== runtime.generation || runtime.sockets.get(connection.id) !== socket) return;
  connection.status = "error";
  connection.error = reason;
  try { socket.terminate?.(); } catch { try { socket.close?.(4000, reason); } catch { /* noop */ } }
}

function startHeartbeat(connection, socket, generation) {
  const state = socketTimerState(connection.id);
  state.lastActivityAt = Date.now();
  const intervalMs = Number(process.env.OKX_WS_HEARTBEAT_CHECK_MS || 5_000);
  const idleMs = Number(process.env.OKX_WS_PING_IDLE_MS || 22_000);
  const pongTimeoutMs = Number(process.env.OKX_WS_PONG_TIMEOUT_MS || 8_000);
  const tick = () => {
    if (generation !== runtime.generation || runtime.sockets.get(connection.id) !== socket || !runtime.started) return;
    const current = socketTimerState(connection.id);
    if (!current.awaitingPong && Date.now() - current.lastActivityAt >= idleMs) {
      try {
        socket.send("ping");
        current.awaitingPong = true;
        current.deadline = setTimeout(() => closeProtocolSocket(connection, socket, generation, "pong_timeout"), pongTimeoutMs);
      } catch {
        closeProtocolSocket(connection, socket, generation, "ping_send_failed");
        return;
      }
    }
    current.heartbeat = setTimeout(tick, intervalMs);
  };
  state.heartbeat = setTimeout(tick, intervalMs);
}

function noteSocketActivity(connectionId) {
  const state = socketTimerState(connectionId);
  state.lastActivityAt = Date.now();
  state.awaitingPong = false;
  if (state.deadline) clearTimeout(state.deadline);
  state.deadline = null;
}

export function startRealtimeManager(db, saveDb, options = {}) {
  if (runtime.started && !options.force) return realtimeStatus(db);
  if (options.force) resetRealtimeGeneration(db, "credentials_changed");
  else if (!runtime.started) runtime.generation += 1;
  runtime.started = true;
  const okxKeys = process.env.OKX_API_KEY && process.env.OKX_API_SECRET && process.env.OKX_API_PASSPHRASE;
  const binding = okxPrivateStreamBinding(db);
  if (okxKeys && binding.ok) connectPrivateUser(db, saveDb, "OKX");
  else {
    removeConnection(db, "OKX", "private_user");
    if (okxKeys && !binding.ok) {
      const connection = ensureConnection(db, "OKX", "private_user");
      connection.status = binding.reason;
      connection.accountId = null;
    }
  }
  removeConnection(db, "BINANCE", "private_user");
  return realtimeStatus(db);
}

export function okxPrivateStreamBinding(db, expected = {}) {
  const apiKey = process.env.OKX_API_KEY || "";
  const fingerprint = apiKey ? crypto.createHash("sha256").update(apiKey).digest("hex").slice(0, 16) : null;
  const accounts = (db.exchangeAccounts || []).filter((row) => row.exchange === "OKX" && row.readEnabled === true);
  if (!fingerprint) return { ok: false, reason: "missing_credentials" };
  if (accounts.length !== 1) return { ok: false, reason: "private_ws_account_binding_required", accountIds: accounts.map((row) => row.id) };
  const account = accounts[0];
  if (account.apiKeyFingerprint !== fingerprint) return { ok: false, reason: "private_ws_credential_mismatch", accountId: account.id };
  const environment = okxEnvironmentConfig().name;
  if (expected.accountId && expected.accountId !== account.id) return { ok: false, reason: "private_ws_account_binding_changed", accountId: account.id };
  if (expected.fingerprint && expected.fingerprint !== fingerprint) return { ok: false, reason: "private_ws_credential_mismatch", accountId: account.id };
  if (expected.environment && expected.environment !== environment) return { ok: false, reason: "private_ws_environment_mismatch", accountId: account.id };
  return { ok: true, account, fingerprint, environment };
}

// 去掉不适用的连接记录（未配置的交易所），避免显示成失败连接。
function removeConnection(db, exchange, streamType) {
  for (const connection of db.realtimeConnections || []) {
    if (connection.exchange !== exchange || connection.streamType !== streamType) continue;
    const timer = runtime.reconnectTimers.get(connection.id);
    if (timer) clearTimeout(timer);
    runtime.reconnectTimers.delete(connection.id);
    const socket = runtime.sockets.get(connection.id);
    clearSocketTimers(connection.id);
    runtime.sockets.delete(connection.id);
    try { socket?.close(1000, "connection_removed"); } catch { /* noop */ }
  }
  db.realtimeConnections = (db.realtimeConnections || []).filter((item) => !(item.exchange === exchange && item.streamType === streamType));
}

function resetRealtimeGeneration(db, reason) {
  runtime.generation += 1;
  for (const timer of runtime.reconnectTimers.values()) clearTimeout(timer);
  runtime.reconnectTimers.clear();
  for (const connectionId of runtime.socketTimers.keys()) clearSocketTimers(connectionId);
  const sockets = [...runtime.sockets.values()];
  runtime.sockets.clear();
  for (const socket of sockets) {
    try { socket.close(1000, reason); } catch { /* noop */ }
  }
  for (const connection of db.realtimeConnections || []) {
    if (connection.streamType !== "private_user") continue;
    connection.status = "restarting";
    connection.generation = runtime.generation;
    delete connection.authenticatedCredentialFingerprint;
  }
}

export function stopRealtimeManager(db, reason = "manual_stop") {
  for (const timer of runtime.reconnectTimers.values()) clearTimeout(timer);
  runtime.reconnectTimers.clear();
  for (const connectionId of runtime.socketTimers.keys()) clearSocketTimers(connectionId);
  for (const socket of runtime.sockets.values()) {
    try {
      socket.close(1000, reason);
    } catch {
      // ignore close errors
    }
  }
  runtime.sockets.clear();
  runtime.started = false;
  runtime.generation += 1;
  markPrivateStopped(db, reason);
  return realtimeStatus(db);
}

export function realtimeStatus(db) {
  return {
    started: runtime.started,
    socketCount: runtime.sockets.size + publicMarketSocketCount(),
    connections: db.realtimeConnections || []
  };
}

async function connectPrivateUser(db, saveDb, exchange = "BINANCE") {
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
  const binding = okxPrivateStreamBinding(db);
  if (!binding.ok) {
    connection.status = binding.reason;
    connection.accountId = null;
    return connection;
  }
  connection.status = "connecting";
  const generation = runtime.generation;
  const apiKey = process.env.OKX_API_KEY;
  const apiSecret = process.env.OKX_API_SECRET;
  const passphrase = process.env.OKX_API_PASSPHRASE;
  const credentialFingerprint = binding.fingerprint;
  const environment = okxEnvironmentConfig();
  connection.generation = generation;
  connection.url = environment.privateWs;
  connection.environment = environment.name;
  const socket = new WebSocket(environment.privateWs, wsOptions());
  runtime.sockets.set(connection.id, socket);
  connection.accountId = binding.account.id;
  socket.on("open", () => {
    if (generation !== runtime.generation) return;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const sign = crypto.createHmac("sha256", apiSecret).update(`${timestamp}GET/users/self/verify`).digest("base64");
    socket.send(JSON.stringify({ op: "login", args: [{ apiKey, passphrase, timestamp, sign }] }));
    const timers = socketTimerState(connection.id);
    timers.auth = setTimeout(() => closeProtocolSocket(connection, socket, generation, "login_timeout"), Number(process.env.OKX_WS_AUTH_TIMEOUT_MS || 10_000));
  });
  wireSocket(db, saveDb, connection, socket, (message) => {
    const currentBinding = okxPrivateStreamBinding(db, {
      accountId: connection.accountId,
      fingerprint: credentialFingerprint,
      environment: environment.name
    });
    if (!currentBinding.ok) {
      closeProtocolSocket(connection, socket, generation, currentBinding.reason);
      return;
    }
    const payload = JSON.parse(message.toString());
    if (payload.event === "login" && payload.code === "0") {
      const timers = socketTimerState(connection.id);
      if (timers.auth) clearTimeout(timers.auth);
      timers.auth = null;
      socket.send(JSON.stringify({ op: "subscribe", args: [{ channel: "orders", instType: "ANY" }, { channel: "positions", instType: "ANY" }, { channel: "account" }] }));
      connection.authenticatedAt = nowIso();
      connection.status = "subscribing";
      connection.pendingSubscriptions = ["orders", "positions", "account"];
      timers.subscribe = setTimeout(() => closeProtocolSocket(connection, socket, generation, "subscribe_timeout"), Number(process.env.OKX_WS_SUBSCRIBE_TIMEOUT_MS || 10_000));
      return;
    }
    if (payload.event === "login" && payload.code !== "0") return closeProtocolSocket(connection, socket, generation, `login_failed:${payload.code || "unknown"}`);
    if (payload.event === "error") return closeProtocolSocket(connection, socket, generation, `subscribe_failed:${payload.code || payload.msg || "unknown"}`);
    if (payload.event === "notice" && String(payload.code) === "64008") return closeProtocolSocket(connection, socket, generation, "service_upgrade_reconnect");
    if (payload.event === "subscribe") {
      const channel = payload.arg?.channel;
      connection.pendingSubscriptions = (connection.pendingSubscriptions || []).filter((item) => item !== channel);
      if (!connection.pendingSubscriptions.length) {
        const timers = socketTimerState(connection.id);
        if (timers.subscribe) clearTimeout(timers.subscribe);
        timers.subscribe = null;
        connection.subscribedAt = nowIso();
        connection.authenticatedCredentialFingerprint = credentialFingerprint;
        connection.status = "connected";
      }
      return;
    }
    if (payload.arg?.channel === "orders") for (const order of payload.data || []) upsertOkxOrder(db, order, { accountId: connection.accountId, apiKeyFingerprint: credentialFingerprint, environment: environment.name });
    if (payload.arg?.channel === "positions") updateOkxPositions(db, payload.data || [], { accountId: connection.accountId, connectionId: connection.id, apiKeyFingerprint: credentialFingerprint, environment: environment.name });
    if (payload.arg?.channel === "account") connection.lastAccountUpdateAt = nowIso();
  }, { generation, authenticatedRequired: true });
  return connection;
}

function wireSocket(db, saveDb, connection, socket, onMessage, options = {}) {
  const generation = options.generation ?? runtime.generation;
  socket.on("open", () => {
    if (generation !== runtime.generation) return;
    connection.status = options.authenticatedRequired ? "authenticating" : "connected";
    connection.connectedAt = nowIso();
    connection.error = null;
    appendAudit(db, "实时 WebSocket 已连接", connection.id, "RealtimeManager");
    appendTrace(db, "realtime_ws", `${connection.exchange} ${connection.streamType} connected`);
    startHeartbeat(connection, socket, generation);
    persistPrivateStreamState(saveDb, db);
  });
  socket.on("message", (message) => {
    if (generation !== runtime.generation) return;
    const raw = message.toString();
    noteSocketActivity(connection.id);
    if (raw === "pong") return;
    try {
      onMessage(message);
      connection.lastMessageAt = nowIso();
      if (!options.authenticatedRequired || connection.authenticatedCredentialFingerprint) connection.status = "connected";
      // 私有消息只持久化可能被该 WS 改写的交易对象，不能退回全库扫描。
      // 逐条更新先留在内存，落盘全局节流到最多每 8s 一次。
      const now = Date.now();
      if (saveDb && now - lastMsgSaveAt > 8000) {
        lastMsgSaveAt = now;
        persistPrivateStreamState(saveDb, db);
      }
    } catch (error) {
      connection.lastError = error.message;
    }
  });
  socket.on("error", (error) => {
    if (generation !== runtime.generation) return;
    connection.status = "error";
    connection.error = error.message;
    appendAudit(db, "实时 WebSocket 错误", connection.id, "RealtimeManager", "warning");
    appendTrace(db, "realtime_ws", `${connection.exchange} ${connection.streamType} error`, "error");
    persistPrivateStreamState(saveDb, db);
    try { socket.close(4001, "socket_error"); } catch { /* noop */ }
  });
  socket.on("close", () => {
    if (generation !== runtime.generation) return;
    clearSocketTimers(connection.id);
    runtime.sockets.delete(connection.id);
    if (!runtime.started) return;
    connection.status = "reconnecting";
    connection.reconnects = Number(connection.reconnects || 0) + 1;
    const delayMs = Math.min(30_000, 2_000 * connection.reconnects);
    const timer = setTimeout(() => {
      connectPrivateUser(db, saveDb, connection.exchange);
    }, delayMs);
    runtime.reconnectTimers.set(connection.id, timer);
    persistPrivateStreamState(saveDb, db);
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

export function updateMarketFromTicker(db, rawSymbol, ticker, options = {}) {
  const symbol = normalizeDisplaySymbol(rawSymbol);
  const market = db.markets.find((item) => item.symbol === symbol);
  if (!market) return { applied: false, reason: "market_not_found" };
  return applyTickerObservation(market, ticker, {
    ...options,
    realtime: true,
    formatVolume: compactNumber
  });
}

function markPrivateStopped(db, status) {
  for (const connection of db.realtimeConnections || []) {
    if (connection.streamType !== "private_user") continue;
    connection.status = status;
  }
}

function normalizeDisplaySymbol(rawSymbol) {
  const text = String(rawSymbol || "BTCUSDT").replace(/-SWAP$/i, "").replaceAll("-", "").toUpperCase();
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
    const fill = enrichRealtimeFill(db, order, {
      exchange: "BINANCE",
      price: Number(payload.L),
      quantity: Number(payload.l),
      feeUsdt: String(payload.N || "USDT").toUpperCase() === "USDT" ? financialNumber(payload.n) : null,
      side: order.side
    });
    // 同 OKX:映射到本引擎执行单的成交由引擎权威落账,WS 只补记外部/手动单,避免重复记账。
    if (!fill.executionOrderId) db.fills.unshift(fill);
  }
}

function cachedOkxCtVal(db, instId, executionOrder = null) {
  if (finiteFinancialNumber(executionOrder?.okxCtVal) > 0) return Number(executionOrder.okxCtVal);
  const symbol = okxDisplaySymbol(instId);
  const mirror = (db.positions || []).find((row) => row.exchange === "OKX" && row.symbol === symbol
    && finiteFinancialNumber(row.contractMultiplier) > 0);
  if (mirror) return Number(mirror.contractMultiplier);
  const evidence = (db.evidenceBundles || []).flatMap((bundle) => bundle.symbols || [])
    .find((row) => row.symbol === symbol && finiteFinancialNumber(row.contractSpec?.data?.ctVal) > 0);
  return evidence ? Number(evidence.contractSpec.data.ctVal) : null;
}

function identityValues(...items) {
  return [...new Set(items.flat(Infinity).map((value) => String(value || "").trim()).filter(Boolean))];
}

function okxOrderFillKind(order, payload = {}, executionOrder = null) {
  const closeByShape = trueLike(payload.reduceOnly ?? order.reduceOnly)
    || (String(payload.posSide ?? order.posSide).toLowerCase() === "long" && String(payload.side ?? order.side).toLowerCase() === "sell")
    || (String(payload.posSide ?? order.posSide).toLowerCase() === "short" && String(payload.side ?? order.side).toLowerCase() === "buy");
  return payload.kindHint || (closeByShape || executionOrder?.status === "protecting" ? "close" : "entry");
}

function okxExecutionOwnership(db, order, payload = {}) {
  if (order.exchange !== "OKX") return null;
  const attribution = classifyTradeFill(db, {
    kind: okxOrderFillKind(order, payload),
    exchange: "OKX",
    exchangeOrderId: order.exchangeOrderId,
    exchangeOrderIds: order.exchangeOrderIds,
    clientOrderId: order.clientOrderId,
    clientOrderIds: order.clientOrderIds,
    algoClientOrderId: order.algoClientOrderId,
    algoClientOrderIds: order.algoClientOrderIds,
    algoId: order.algoId,
    algoIds: order.algoIds,
    accountId: order.accountId,
    environment: order.environment,
    symbol: order.symbol,
    side: payload.side ?? order.side
  });
  if (attribution.scope !== "system" || attribution.exitMode === "manual_exit") return null;
  return (db.executionOrders || []).find((row) => row.id === attribution.executionOrderId) || null;
}

function duplicateOkxFillConflicts(existingFill, payload = {}, normalized = {}) {
  const tradeId = normalizeOkxTradeId(payload.tradeId);
  const evidence = (existingFill.exitBreakdown || []).find((row) => String(row?.exchangeTradeId ?? row?.tradeId ?? "") === tradeId)
    || existingFill;
  const numericPairs = [
    [evidence.price, financialNumber(payload.fillPx)],
    [evidence.quantity, normalized.coinQuantity],
    [evidence.realizedPnl, financialNumber(payload.fillPnl)],
    [evidence.feeUsdt ?? existingFill.feeCostUsdt, normalized.feeCostUsdt]
  ];
  if (numericPairs.some(([existing, incoming]) => existing !== null && existing !== undefined
    && incoming !== null && incoming !== undefined && Number(existing) !== Number(incoming))) return true;
  const identityPairs = [
    [evidence.exchangeOrderId ?? existingFill.exchangeOrderId, payload.ordId],
    [existingFill.clientOrderId, payload.clOrdId],
    [existingFill.algoClientOrderId, payload.algoClOrdId || payload.attachAlgoClOrdId],
    [existingFill.algoId, payload.algoId || payload.attachAlgoId],
    [existingFill.feeCurrency, payload.feeCcy],
    [evidence.closedAt ?? existingFill.exchangeFilledAt, validExchangeTime(payload.fillTime || payload.uTime)]
  ];
  return identityPairs.some(([existing, incoming]) => String(existing || "").trim()
    && String(incoming || "").trim() && String(existing).trim() !== String(incoming).trim());
}

function reopenConflictedSystemLifecycle(db, fill) {
  if (fill?.kind !== "close") return;
  const attribution = classifyTradeFill(db, fill);
  if (attribution.scope !== "system") return;
  const executionOrder = (db.executionOrders || []).find((row) => String(row?.id || "") === String(attribution.executionOrderId || ""));
  if (!executionOrder) return;
  executionOrder.status = "close_reconciliation_pending";
  executionOrder.closeReconciliationReason = "fill_evidence_conflict";
  executionOrder.financialEvidenceConflict = true;
  executionOrder.financialEvidenceConflictAt = nowIso();
  const plan = (db.tradePlans || []).find((row) => row.id === executionOrder.planId);
  if (plan?.status === "completed") plan.status = "executing";
}

export function upsertOkxOrder(db, payload, context = {}) {
  const exchangeOrderId = String(payload.ordId || "").trim();
  const clientOrderId = String(payload.clOrdId || "").trim();
  const existing = db.orders.find((order) => (exchangeOrderId && (String(order.exchangeOrderId || "") === exchangeOrderId
    || order.exchangeOrderIds?.includes(exchangeOrderId)))
    || (clientOrderId && (String(order.clientOrderId || "") === clientOrderId || order.clientOrderIds?.includes(clientOrderId))));
  const order = existing || {
    id: id("ord"),
    exchange: "OKX",
    exchangeOrderId: exchangeOrderId || null,
    clientOrderId: clientOrderId || null,
    createdAt: nowIso()
  };
  if (exchangeOrderId) {
    order.exchangeOrderId ||= exchangeOrderId;
    order.exchangeOrderIds = identityValues(order.exchangeOrderIds, order.exchangeOrderId, exchangeOrderId);
  }
  if (clientOrderId) {
    order.clientOrderId ||= clientOrderId;
    order.clientOrderIds = identityValues(order.clientOrderIds, order.clientOrderId, clientOrderId);
  }
  const attachedAlgoOrders = Array.isArray(payload.attachAlgoOrds) ? payload.attachAlgoOrds : [];
  const algoClientOrderIds = identityValues(payload.algoClOrdId, payload.attachAlgoClOrdId,
    attachedAlgoOrders.map((row) => row?.algoClOrdId || row?.attachAlgoClOrdId));
  const algoIds = identityValues(payload.algoId, payload.attachAlgoId,
    attachedAlgoOrders.map((row) => row?.algoId || row?.attachAlgoId));
  if (algoClientOrderIds.length) {
    order.algoClientOrderId ||= algoClientOrderIds[0];
    order.algoClientOrderIds = identityValues(order.algoClientOrderIds, order.algoClientOrderId, algoClientOrderIds);
  }
  if (algoIds.length) {
    order.algoId ||= algoIds[0];
    order.algoIds = identityValues(order.algoIds, order.algoId, algoIds);
  }
  // 与 REST/执行引擎同口径(去 -SWAP),否则 WS 订单/成交显示 "BTC/USDT-SWAP"、引擎显示 "BTC/USDT",
  // 同一永续被当成两个符号,用户误以为多了个"现货 BTC/USDT"(实锤截图)。
  if (payload.instId) order.symbol = okxDisplaySymbol(payload.instId);
  order.side = payload.side;
  order.posSide = payload.posSide || null;
  order.reduceOnly = payload.reduceOnly;
  order.type = payload.ordType;
  order.status = payload.state;
  order.price = financialNumber(payload.px);
  order.quantity = payload.sz;
  order.tradeId = normalizeOkxTradeId(payload.tradeId) || null;
  order.fillPnl = financialNumber(payload.fillPnl);
  order.fillTime = payload.fillTime || null;
  order.accountId = context.accountId || order.accountId || null;
  order.apiKeyFingerprint = context.apiKeyFingerprint || order.apiKeyFingerprint || null;
  order.environment = context.environment || order.environment || null;
  order.updatedAt = payload.uTime && Number.isFinite(Number(payload.uTime)) ? new Date(Number(payload.uTime)).toISOString() : nowIso();
  if (!existing) db.orders.unshift(order);
  if (payload.reqId && payload.amendResult !== undefined && payload.amendResult !== "") {
    const pendingAmend = findPendingOmsAmend({ reqId: payload.reqId, exchangeOrderId: payload.ordId, clientOrderId: payload.clOrdId });
    if (pendingAmend) reconcileAmendOmsOrder(db, pendingAmend, {
      exchangeOrderId: payload.ordId || null,
      contracts: financialNumber(payload.sz),
      price: financialNumber(payload.px),
      reqId: payload.reqId,
      amendResult: payload.amendResult,
      updatedAt: order.updatedAt
    });
  }
  // 成交去重以交易所 tradeId 为权威。系统入场仍由执行引擎轮询落账；系统平仓的 WS
  // 回报本身可能是唯一一份逐笔 PnL/费用证据，必须先原样持久化，后续对账复用该事实。
  const executionOrder = okxExecutionOwnership(db, order, payload);
  if (executionOrder) {
    order.executionOrderId ||= executionOrder.id;
    order.planId ||= executionOrder.planId;
  }
  const fillContracts = financialNumber(payload.fillSz);
  const tradeId = normalizeOkxTradeId(payload.tradeId);
  const systemCloseFill = Boolean(executionOrder && okxOrderFillKind(order, payload) === "close");
  const hadUnidentifiedFill = order.financialReconciliationStatus === "authoritative_trade_identity_missing";
  const ctVal = String(payload.instType || "SWAP").toUpperCase() === "SPOT" ? 1 : cachedOkxCtVal(db, payload.instId, executionOrder);
  const coinQuantity = finiteFinancialNumber(ctVal) > 0 ? Number(fillContracts) * Number(ctVal) : null;
  const fee = parseOkxFee(payload.fee, payload.feeCcy);
  const duplicateFill = tradeId && findAuthoritativeFillIdentityMatch(db, {
    kind: okxOrderFillKind(order, payload),
    exchange: "OKX",
    exchangeTradeId: tradeId,
    exchangeOrderId: order.exchangeOrderId,
    accountId: order.accountId,
    environment: order.environment,
    symbol: order.symbol,
    executionOrderId: executionOrder?.id,
    planId: executionOrder?.planId
  });
  const duplicate = Boolean(duplicateFill);
  if (duplicateFill && duplicateOkxFillConflicts(duplicateFill, payload, { coinQuantity, feeCostUsdt: fee.cost })) {
    duplicateFill.financialEvidenceConflict = true;
    duplicateFill.financialEvidenceConflictReason = "authoritative_trade_identity_payload_conflict";
    reopenConflictedSystemLifecycle(db, duplicateFill);
  }
  if (fillContracts > 0 && !executionOrder && !tradeId) {
    // OKX orders channel 是状态更新流；fillSz/accFillSz 可能在重复推送中再次出现。
    // 没有交易所 tradeId 时不能把快照当成新的财务事实，否则一次成交会被重复计入。
    // 保留订单及待回补状态，等待 fills-history 的权威成交身份，不发明组合 tradeId。
    order.financialReconciliationStatus = "authoritative_trade_identity_missing";
    order.financialReconciliationObservedAt = validExchangeTime(payload.fillTime || payload.uTime) || nowIso();
  } else if (tradeId && !hadUnidentifiedFill) {
    delete order.financialReconciliationStatus;
    delete order.financialReconciliationObservedAt;
  }
  // clOrdId 非空不代表本系统订单；只有真正匹配 executionOrder 的平仓才在此保存为 system_exit。
  if (fillContracts > 0 && tradeId && (!executionOrder || systemCloseFill) && !duplicate) {
    const fillPayload = {
      exchange: "OKX",
      price: financialNumber(payload.fillPx),
      quantity: coinQuantity,
      rawContracts: fillContracts,
      ctVal,
      feeCostUsdt: fee.cost,
      rawFee: fee.raw,
      feeCurrency: payload.feeCcy || null,
      side: order.side,
      posSide: payload.posSide,
      reduceOnly: payload.reduceOnly,
      realizedPnl: financialNumber(payload.fillPnl),
      exchangeTradeId: tradeId || null,
      exchangeFilledAt: validExchangeTime(payload.fillTime || payload.uTime),
      partial: systemCloseFill ? true : undefined
    };
    if (String(payload.posSide || "").toLowerCase() === "net") {
      const before = authoritativeNetPositionBeforeFill(db, order, context, ctVal);
      const components = classifyOkxNetFill({
        side: order.side,
        quantity: coinQuantity,
        realizedPnl: fillPayload.realizedPnl,
        positionDirection: before?.direction,
        positionQuantity: before?.quantity
      });
      for (const component of components.reverse()) {
        const ratio = coinQuantity > 0 ? component.quantity / coinQuantity : 1;
        insertExternalFill(db, enrichRealtimeFill(db, order, {
          ...fillPayload,
          kindHint: component.kind,
          quantity: component.quantity,
          rawContracts: fillContracts * ratio,
          feeCostUsdt: fillPayload.feeCostUsdt === null ? null : fillPayload.feeCostUsdt * ratio,
          rawFee: fillPayload.rawFee === null ? null : fillPayload.rawFee * ratio,
          realizedPnl: component.kind === "close" ? fillPayload.realizedPnl : null,
          reportedRealizedPnl: fillPayload.realizedPnl,
          netFillComponent: component.component
        }));
      }
    } else {
      insertExternalFill(db, enrichRealtimeFill(db, order, fillPayload));
    }
  }
  reconcilePendingTradeAttributions(db);
}

function insertExternalFill(db, fill) {
  fill.tradeAttribution = buildExternalFillAttribution(db, fill);
  db.fills.unshift(fill);
  return fill;
}

export async function reconcilePendingOkxFillIdentities(db, options = {}) {
  const request = options.request || okxSignedRequest;
  const resolveBinding = options.resolveBinding || okxPrivateStreamBinding;
  const limit = Math.max(1, Math.min(100, Number(options.limit || 100)));
  const maxPages = Math.max(1, Math.min(20, Number(options.maxPages || 20)));
  const candidates = (db.orders || []).filter((order) => order.exchange === "OKX"
    && order.exchangeOrderId
    && order.financialReconciliationStatus === "authoritative_trade_identity_missing");
  const results = [];
  let reconciled = 0;
  for (const order of candidates) {
    options.assertLease?.();
    if (options.signal?.aborted) throw options.signal.reason;
    const binding = resolveBinding(db, {
      accountId: order.accountId,
      fingerprint: order.apiKeyFingerprint,
      environment: order.environment
    });
    if (!binding?.ok) {
      results.push({ orderId: order.id, status: binding?.reason || "credential_binding_invalid" });
      continue;
    }
    const rows = [];
    let after = null;
    let complete = false;
    let failure = null;
    try {
      for (let page = 0; page < maxPages; page += 1) {
        options.assertLease?.();
        if (options.signal?.aborted) throw options.signal.reason;
        const query = new URLSearchParams({
          instType: "SWAP",
          instId: toOkxSymbol(order.symbol, "perpetual"),
          ordId: String(order.exchangeOrderId),
          limit: String(limit)
        });
        if (after) query.set("after", after);
        const raw = await request(`/api/v5/trade/fills-history?${query.toString()}`, "GET", "", { signal: options.signal });
        if (String(raw?.code ?? "") !== "0" || !Array.isArray(raw?.data)) {
          failure = "authoritative_fill_query_rejected";
          break;
        }
        rows.push(...raw.data);
        if (raw.data.length < limit) {
          complete = true;
          break;
        }
        const next = String(raw.data.at(-1)?.tradeId || "");
        if (!next || next === after) {
          failure = "authoritative_fill_pagination_unstable";
          break;
        }
        after = next;
      }
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      failure = String(error?.message || error).slice(0, 160) || "authoritative_fill_query_failed";
    }
    const authoritativeRows = rows.filter((row) => String(row?.ordId || "") === String(order.exchangeOrderId));
    if (!complete || !authoritativeRows.length || authoritativeRows.some((row) => !completeAuthoritativeOkxFill(row))) {
      results.push({ orderId: order.id, status: failure || "authoritative_trade_identity_pending" });
      continue;
    }
    const context = {
      accountId: binding.account?.id || order.accountId,
      apiKeyFingerprint: binding.fingerprint || order.apiKeyFingerprint,
      environment: binding.environment || order.environment
    };
    for (const row of authoritativeRows) {
      upsertOkxOrder(db, {
        ...row,
        ordId: order.exchangeOrderId,
        instId: row.instId || toOkxSymbol(order.symbol, "perpetual"),
        instType: row.instType || "SWAP",
        side: row.side || order.side,
        posSide: row.posSide || order.posSide,
        reduceOnly: row.reduceOnly ?? order.reduceOnly,
        ordType: row.ordType || order.type,
        state: row.state || order.status,
        px: row.px ?? order.price,
        sz: row.sz ?? order.quantity
      }, context);
    }
    delete order.financialReconciliationStatus;
    delete order.financialReconciliationObservedAt;
    reconciled += 1;
    results.push({ orderId: order.id, status: "reconciled", fills: authoritativeRows.length });
  }
  const attributions = reconcilePendingTradeAttributions(db);
  return { checked: candidates.length, reconciled, results, attributions };
}

function authoritativeNetPositionBeforeFill(db, order, context = {}, ctVal = null) {
  const candidates = (db.positions || []).filter((position) => position.exchange === "OKX"
    && position.symbol === order.symbol
    && (!context.accountId || position.accountId === context.accountId)
    && (position.positionMode === "net_mode" || position.rawPosSide === "net")
    && canonicalPositionDirection(position));
  const position = candidates.sort((a, b) => new Date(b.exchangeObservedAt || b.rawSyncedAt || b.updatedAt || 0)
    - new Date(a.exchangeObservedAt || a.rawSyncedAt || a.updatedAt || 0))[0];
  if (!position) return null;
  const coinSize = finiteFinancialNumber(position.coinSize) > 0 ? Number(position.coinSize)
    : finiteFinancialNumber(position.size) > 0 && finiteFinancialNumber(position.contractMultiplier ?? ctVal) > 0
      ? Number(position.size) * Number(position.contractMultiplier ?? ctVal)
      : null;
  return coinSize ? { direction: canonicalPositionDirection(position), quantity: coinSize } : null;
}

export function classifyOkxNetFill({ side, quantity, realizedPnl, positionDirection, positionQuantity } = {}) {
  const amount = financialNumber(quantity);
  if (!(amount > 0)) return [{ kind: "unknown", quantity: amount, component: "quantity_unavailable" }];
  const direction = String(positionDirection || "").toLowerCase();
  const closingShape = (direction === "long" && String(side).toLowerCase() === "sell")
    || (direction === "short" && String(side).toLowerCase() === "buy");
  const available = financialNumber(positionQuantity);
  if (!closingShape || !(available > 0)) {
    // Non-zero fillPnl is direct evidence that at least this fill closed exposure.
    // Zero is not evidence: a profitable/lossless close and an entry are both possible.
    if (finiteFinancialNumber(realizedPnl) && Number(realizedPnl) !== 0) {
      return [{ kind: "close", quantity: amount, component: "exchange_fill_pnl_close" }];
    }
    return [{ kind: "unknown", quantity: amount, component: "net_lifecycle_reconciliation_pending" }];
  }
  const closeQuantity = Math.min(amount, available);
  const entryQuantity = Math.max(0, amount - closeQuantity);
  const components = [{ kind: "close", quantity: closeQuantity, component: entryQuantity > 0 ? "reversal_close" : "position_reduction" }];
  if (entryQuantity > 1e-12) components.push({ kind: "entry", quantity: entryQuantity, component: "reversal_entry" });
  return components;
}

function enrichRealtimeFill(db, order, payload = {}) {
  const executionOrder = (db.executionOrders || []).find((item) => item.id === order.executionOrderId)
    || okxExecutionOwnership(db, order, payload)
    || (db.executionOrders || []).find((item) => item.exchangeOrderId === order.exchangeOrderId
      || item.clientOrderId === order.clientOrderId || item.planId === order.planId);
  const plan = (db.tradePlans || []).find((item) => item.id === executionOrder?.planId || item.id === order.planId) || {};
  const price = financialNumber(payload.price);
  const quantity = financialNumber(payload.quantity);
  const notional = price !== null && price > 0 && quantity !== null && quantity > 0 ? price * quantity : null;
  const expectedPrice = executionOrder?.entryPrice || order.price;
  const slippageBps = expectedPrice ? Number((((price - Number(expectedPrice)) / Number(expectedPrice)) * 10000).toFixed(2)) : null;
  const feeCostUsdt = financialNumber(payload.feeCostUsdt ?? payload.feeUsdt);
  const kind = okxOrderFillKind(order, payload, executionOrder);
  const exchangeFilledAt = payload.exchangeFilledAt || null;
  return {
    id: id("fill"),
    orderId: order.id,
    tenantId: executionOrder?.tenantId || plan.tenantId || plan.ownerTenantId || db.user?.tenantId || "tenant_owner",
    ownerUserId: executionOrder?.ownerUserId || plan.ownerUserId || plan.createdByUserId || plan.userId || db.user?.id || null,
    executionOrderId: executionOrder?.id,
    planId: executionOrder?.planId || order.planId,
    tradePlanId: executionOrder?.planId || order.planId,
    agentRunId: executionOrder?.agentRunId,
    riskCheckId: executionOrder?.riskCheckId,
    mandateId: executionOrder?.mandateId,
    symbol: order.symbol,
    exchange: payload.exchange || order.exchange,
    exchangeOrderId: order.exchangeOrderId || null,
    exchangeOrderIds: order.exchangeOrderIds,
    clientOrderId: order.clientOrderId || null,
    clientOrderIds: order.clientOrderIds,
    algoClientOrderId: order.algoClientOrderId || null,
    algoClientOrderIds: order.algoClientOrderIds,
    algoId: order.algoId || null,
    algoIds: order.algoIds,
    exchangeTradeId: payload.exchangeTradeId || null,
    accountId: order.accountId || null,
    apiKeyFingerprint: order.apiKeyFingerprint || null,
    environment: order.environment || null,
    side: payload.side,
    direction: executionOrder?.direction,
    strategy: executionOrder?.strategy || plan.strategy || plan.strategy_type || "manual_review",
    strategyRef: executionOrder?.strategyRef ? { ...executionOrder.strategyRef } : (plan.strategyRef ? { ...plan.strategyRef } : null),
    strategyBlueprintRef: executionOrder?.strategyBlueprintRef ? { ...executionOrder.strategyBlueprintRef } : (plan.strategyBlueprintRef ? { ...plan.strategyBlueprintRef } : null),
    strategyProductId: executionOrder?.strategyProductId || plan.strategyProductId || null,
    strategyVersion: executionOrder?.strategyVersion || plan.strategyVersion || null,
    strategyVersionId: executionOrder?.strategyVersionId || plan.strategyVersionId || null,
    strategyInstance: executionOrder?.strategyInstance ? structuredClone(executionOrder.strategyInstance) : (plan.strategyInstance ? structuredClone(plan.strategyInstance) : null),
    kind,
    price,
    size: quantity,
    quantity,
    notionalUsdt: notional,
    rawContracts: financialNumber(payload.rawContracts),
    okxCtVal: financialNumber(payload.ctVal),
    expectedPrice,
    slippageBps,
    realizedPnl: kind === "close" ? financialNumber(payload.realizedPnl) : null,
    reportedRealizedPnl: financialNumber(payload.reportedRealizedPnl),
    netFillComponent: payload.netFillComponent || null,
    feeUsdt: feeCostUsdt,
    feeCostUsdt,
    rawFee: financialNumber(payload.rawFee),
    feeCurrency: payload.feeCurrency || null,
    feeSource: payload.exchange === "OKX" ? "okx_private_ws" : "exchange_ws",
    feeSchemaVersion: 2,
    initialRiskUsdt: executionOrder?.initialRiskUsdt || plan.initialRiskUsdt || null,
    accountEquityAtEntryUsdt: executionOrder?.accountEquityAtEntryUsdt || plan.accountEquityAtEntryUsdt || null,
    fee: feeCostUsdt === null ? undefined : `${feeCostUsdt} USDT`,
    estimatedFee: false,
    fundingReconciled: kind === "close" ? false : undefined,
    financialBasisComplete: false,
    financialBasis: kind === "unknown" ? "net_lifecycle_reconciliation_pending" : "ws_signal_pending_rest_reconciliation",
    partial: payload.partial,
    // 同 executionEngine.entryRationale:plan 的推理在 reasoningSummary。executionOrder 已存的占位符
    // "未记录入场理由"不算真值,别让它短路掉 plan 的真实理由。
    entryRationale: (executionOrder?.entryRationale && executionOrder.entryRationale !== "未记录入场理由")
      ? executionOrder.entryRationale
      : (plan.reasoningSummary || plan.rationale || plan.analysis || "未记录入场理由"),
    exchangeFilledAt,
    createdAt: exchangeFilledAt || nowIso()
  };
}

function parseOkxFee(value, currency) {
  const raw = financialNumber(value);
  if (raw === null || !currency || String(currency).toUpperCase() !== "USDT") return { raw, cost: null };
  return { raw, cost: okxFeeCost(raw) };
}

function normalizeOkxTradeId(value) {
  const tradeId = String(value || "").trim();
  return tradeId && tradeId !== "0" ? tradeId : "";
}

function completeAuthoritativeOkxFill(row = {}) {
  return Boolean(normalizeOkxTradeId(row.tradeId)
    && financialNumber(row.fillSz) > 0
    && financialNumber(row.fillPx) > 0
    && validExchangeTime(row.fillTime || row.ts));
}

function trueLike(value) {
  return value === true || String(value).toLowerCase() === "true";
}

function validExchangeTime(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  const time = Number.isFinite(numeric) ? new Date(numeric).getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

// OKX 展示符号:与 exchangeConnector.normalizeOkxDisplaySymbol 同口径(去 -SWAP、首个 - 换 /)。
// 此前 WS 用 replace("-","/") 得到 "BTC/USDT-SWAP",REST 得到 "BTC/USDT",两者不匹配 → 同一仓被记成两条。
function okxDisplaySymbol(instId) {
  return String(instId || "").replace(/-SWAP$/i, "").replace("-", "/").toUpperCase();
}

export function updateOkxPositions(db, positions, context = {}) {
  for (const payload of positions) {
    if (!payload.instId) continue;
    const symbol = okxDisplaySymbol(payload.instId);
    const rawPosSide = String(payload.posSide || "").toLowerCase();
    const size = financialNumber(payload.pos);
    const direction = canonicalPositionDirection({ posSide: rawPosSide, pos: size });
    const positionMode = rawPosSide === "net" ? "net_mode" : "long_short_mode";
    const accountId = context.accountId || payload.accountId || null;
    const slotKey = `${accountId || context.connectionId || "unknown"}|${payload.instId}|${positionMode === "net_mode" ? "net" : direction || rawPosSide}`;
    db.realtimePositionWatermarks ||= {};
    const slotMatch = (position) => position.exchange === "OKX" && position.source === "exchange_ws"
      && position.symbol === symbol && (position.accountId || null) === accountId
      && (position.positionMode || (position.rawPosSide === "net" ? "net_mode" : "long_short_mode")) === positionMode
      && (positionMode === "net_mode" || canonicalPositionDirection(position) === direction);
    const existingRows = db.positions.filter(slotMatch);
    const observedAt = validExchangeTime(payload.uTime) || nowIso();
    const newestExistingAt = Math.max(...existingRows.map((row) => new Date(row.exchangeObservedAt || row.updatedAt || 0).getTime()), 0);
    const watermarkAt = new Date(db.realtimePositionWatermarks[slotKey] || 0).getTime();
    if (new Date(observedAt).getTime() < Math.max(newestExistingAt, watermarkAt)) continue;
    db.realtimePositionWatermarks[slotKey] = observedAt;
    // 仓位归零(平仓或双向持仓的空槽)→ 移除,别把 pos:"0" 当一条"持仓"留在面板
    // (实锤:BTC 幽灵持仓,size/entry/mark 全 0 却显示"持仓(1)")。
    if (size === null || size === 0) {
      db.positions = db.positions.filter((position) => !slotMatch(position));
      continue;
    }
    // net_mode 是单一净仓槽；翻向时更新同一槽并清掉旧方向镜像。
    let position = existingRows[0] || { id: id("pos"), exchange: "OKX", symbol, source: "exchange_ws", createdAt: nowIso() };
    if (positionMode === "net_mode") db.positions = db.positions.filter((row) => !slotMatch(row) || row.id === position.id);
    const alreadyStored = db.positions.includes(position);
    position.accountId = accountId;
    position.connectionId = context.connectionId || null;
    position.apiKeyFingerprint = context.apiKeyFingerprint || null;
    position.environment = context.environment || null;
    position.posSide = direction;
    position.direction = direction;
    position.rawPosSide = rawPosSide || null;
    position.rawSignedPosition = size;
    position.positionMode = positionMode;
    position.size = Math.abs(size);
    const restMirror = db.positions.find((row) => row.exchange === "OKX" && row.source === "exchange_rest"
      && row.symbol === symbol && canonicalPositionDirection(row) === direction);
    const multiplier = Number(position.contractMultiplier ?? restMirror?.contractMultiplier);
    position.contractMultiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : null;
    position.coinSize = position.contractMultiplier ? Math.abs(size) * position.contractMultiplier : null;
    position.entry = financialNumber(payload.avgPx);
    position.mark = financialNumber(payload.markPx);
    position.liqPx = financialNumber(payload.liqPx);
    position.pnl = financialNumber(payload.upl);
    position.leverage = financialNumber(payload.lever);
    position.exchangeObservedAt = observedAt;
    position.updatedAt = nowIso();
    if (!alreadyStored) db.positions.unshift(position);
  }
}
