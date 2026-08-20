import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "realtime-public-owner-"));
process.env.DATA_DIR = testDataDir;

const require = createRequire(import.meta.url);
const websocketImplementationPath = path.join(path.dirname(require.resolve("ws")), "lib/websocket.js");
const originalWebSocketModule = require.cache[websocketImplementationPath];

class FakeWebSocket extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    super();
    this.url = String(url);
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    this.closeCalls = [];
    FakeWebSocket.instances.push(this);
  }

  open() {
    assert.equal(this.readyState, FakeWebSocket.CONNECTING);
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open");
  }

  send(payload) {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error("socket_not_open");
    this.sent.push(String(payload));
  }

  receive(payload) {
    this.emit("message", Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload)));
  }

  fail(message = "socket failed") {
    this.emit("error", new Error(message));
  }

  close(code = 1000, reason = "") {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.closeCalls.push({ code, reason });
    this.readyState = FakeWebSocket.CLOSING;
  }

  terminate() {
    this.close(4000, "terminated");
  }

  finishClose() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close");
  }

  remoteClose() {
    this.finishClose();
  }

  static reset() {
    FakeWebSocket.instances = [];
  }
}

require.cache[websocketImplementationPath] = {
  id: websocketImplementationPath,
  filename: websocketImplementationPath,
  loaded: true,
  exports: FakeWebSocket,
  children: [],
  paths: []
};

class FakeClock {
  constructor() {
    this.now = 0;
    this.nextId = 1;
    this.tasks = new Map();
    this.originals = null;
  }

  install() {
    this.originals = {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval
    };
    globalThis.setTimeout = (callback, delay = 0, ...args) => this.schedule(callback, delay, 0, args);
    globalThis.clearTimeout = (id) => this.tasks.delete(id);
    globalThis.setInterval = (callback, delay = 0, ...args) => this.schedule(callback, delay, Math.max(1, Number(delay) || 1), args);
    globalThis.clearInterval = (id) => this.tasks.delete(id);
  }

  schedule(callback, delay, interval, args) {
    const id = this.nextId++;
    this.tasks.set(id, { callback, args, due: this.now + Math.max(0, Number(delay) || 0), interval });
    return id;
  }

  advance(milliseconds) {
    const target = this.now + milliseconds;
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.due <= target)
        .sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!next) break;
      const [id, task] = next;
      this.now = task.due;
      if (task.interval) task.due += task.interval;
      else this.tasks.delete(id);
      task.callback(...task.args);
    }
    this.now = target;
  }

  activeCount() {
    return this.tasks.size;
  }

  restore() {
    if (!this.originals) return;
    Object.assign(globalThis, this.originals);
    this.originals = null;
    this.tasks.clear();
  }
}

const marketStream = await import("../server/marketStream.mjs");
const realtimeManager = await import("../server/realtimeManager.mjs");
const { registerRealtimeRoutes } = await import("../server/routes/realtime.mjs");
const {
  okxLiquidationStreamStatus,
  resetOkxLiquidationStreamForTest
} = await import("../server/okxLiquidationStream.mjs");

const originalCredentials = {
  key: process.env.OKX_API_KEY,
  secret: process.env.OKX_API_SECRET,
  passphrase: process.env.OKX_API_PASSPHRASE
};

test.after(() => {
  if (originalWebSocketModule) require.cache[websocketImplementationPath] = originalWebSocketModule;
  else delete require.cache[websocketImplementationPath];
  for (const [name, value] of Object.entries({
    OKX_API_KEY: originalCredentials.key,
    OKX_API_SECRET: originalCredentials.secret,
    OKX_API_PASSPHRASE: originalCredentials.passphrase
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

function publicSockets() {
  return FakeWebSocket.instances.filter((socket) => socket.url.includes("/public"));
}

function privateSockets() {
  return FakeWebSocket.instances.filter((socket) => socket.url.includes("/private"));
}

function activeSockets(sockets = FakeWebSocket.instances) {
  return sockets.filter((socket) => [FakeWebSocket.CONNECTING, FakeWebSocket.OPEN].includes(socket.readyState));
}

function dbFixture() {
  return {
    meta: {},
    auditLogs: [],
    traces: [],
    markets: [{ symbol: "BTC/USDT", price: 1 }],
    mandates: [{ id: "mandate", status: "active", allowedSymbols: ["BTC/USDT"] }],
    watchlist: ["BTC/USDT"],
    realtimeConnections: [],
    exchangeAccounts: [],
    orders: [],
    fills: [],
    executionOrders: [],
    tradePlans: [],
    positions: [],
    evidenceBundles: []
  };
}

function withoutCredentials() {
  delete process.env.OKX_API_KEY;
  delete process.env.OKX_API_SECRET;
  delete process.env.OKX_API_PASSPHRASE;
}

function cleanup(db, clock) {
  try { marketStream.stopMarketStream?.(db, "test_cleanup"); } catch { /* cleanup only */ }
  try { realtimeManager.stopRealtimeManager(db, "test_cleanup"); } catch { /* cleanup only */ }
  clock?.restore();
  FakeWebSocket.reset();
}

test("system startup creates exactly one OKX public WebSocket owner", () => {
  const clock = new FakeClock();
  clock.install();
  const db = dbFixture();
  withoutCredentials();
  try {
    realtimeManager.startRealtimeManager(db, () => {});
    marketStream.startMarketStream(db, () => {});
    assert.equal(publicSockets().length, 1);
    assert.equal(activeSockets(publicSockets()).length, 1);
  } finally {
    cleanup(db, clock);
  }
});

test("repeated market stream start is idempotent", () => {
  const clock = new FakeClock();
  clock.install();
  const db = dbFixture();
  try {
    marketStream.startMarketStream(db, () => {});
    marketStream.startMarketStream(db, () => {});
    assert.equal(publicSockets().length, 1);
    assert.equal(activeSockets(publicSockets()).length, 1);
  } finally {
    cleanup(db, clock);
  }
});

test("a close schedules one reconnect and never overlaps active public sockets", () => {
  const clock = new FakeClock();
  clock.install();
  const db = dbFixture();
  try {
    marketStream.startMarketStream(db, () => {});
    const first = publicSockets()[0];
    first.open();
    assert.equal(activeSockets(publicSockets()).length, 1);
    const subscriptions = first.sent.map((payload) => JSON.parse(payload));
    assert.deepEqual(
      subscriptions[0].args.map((row) => row.channel),
      ["tickers", "funding-rate", "open-interest", "tickers", "funding-rate", "open-interest"]
    );
    assert.deepEqual(subscriptions[1], { op: "subscribe", args: [{ channel: "liquidation-orders", instType: "SWAP" }] });

    first.remoteClose();
    first.emit("close");
    assert.equal(activeSockets(publicSockets()).length, 0);
    clock.advance(2_999);
    assert.equal(activeSockets(publicSockets()).length, 0);
    clock.advance(1);
    assert.equal(publicSockets().length, 2);
    assert.equal(activeSockets(publicSockets()).length, 1);
  } finally {
    cleanup(db, clock);
  }
});

test("stop clears socket and every timer, prevents resurrection, and permits a clean restart", () => {
  assert.equal(typeof marketStream.stopMarketStream, "function", "marketStream must expose an owned stop lifecycle");
  const clock = new FakeClock();
  clock.install();
  const db = dbFixture();
  try {
    marketStream.startMarketStream(db, () => {});
    const first = publicSockets()[0];
    first.open();
    assert.equal(clock.activeCount(), 2, "ping and resubscribe timers should be active");

    marketStream.stopMarketStream(db, "manual_stop");
    assert.equal(first.closeCalls.length, 1, "stop should close an active public socket");
    assert.equal(clock.activeCount(), 0);
    first.finishClose();
    clock.advance(60_000);
    assert.equal(publicSockets().length, 1, "a stopped socket close must not schedule reconnect");

    marketStream.startMarketStream(db, () => {});
    const second = publicSockets()[1];
    second.open();
    second.remoteClose();
    assert.equal(clock.activeCount(), 2, "resubscribe and reconnect timers should remain");
    marketStream.stopMarketStream(db, "manual_stop");
    assert.equal(clock.activeCount(), 0);
    assert.equal(activeSockets(publicSockets()).length, 0);

    clock.advance(60_000);
    assert.equal(publicSockets().length, 2, "a delayed reconnect must not revive a stopped stream");

    marketStream.startMarketStream(db, () => {});
    assert.equal(publicSockets().length, 3);
    assert.equal(activeSockets(publicSockets()).length, 1);
  } finally {
    cleanup(db, clock);
  }
});

test("ticker, funding, open interest, liquidation, SSE, and tick-hook behavior stays single-delivery", () => {
  resetOkxLiquidationStreamForTest();
  const db = dbFixture();
  const updates = [];
  const ticks = [];
  const now = Date.now();
  const listener = (update) => updates.push(update);
  marketStream.addStreamListener(listener);
  marketStream.setMarketTickHook((_db, symbol, price) => ticks.push({ symbol, price }));
  try {
    marketStream.handleMarketStreamMessage(Buffer.from(JSON.stringify({
      arg: { channel: "tickers", instId: "BTC-USDT-SWAP" },
      data: [{ last: "61000", open24h: "60000", high24h: "62000", low24h: "59000", volCcy24h: "42", ts: String(now) }]
    })), { db, now: now + 1, receivedAt: now + 1 });
    marketStream.handleMarketStreamMessage(Buffer.from(JSON.stringify({
      arg: { channel: "funding-rate", instId: "BTC-USDT-SWAP" },
      data: [{ fundingRate: "0.0001", ts: String(now + 2) }]
    })), { db, now: now + 3, receivedAt: now + 3 });
    marketStream.handleMarketStreamMessage(Buffer.from(JSON.stringify({
      arg: { channel: "open-interest", instId: "BTC-USDT-SWAP" },
      data: [{ oiCcy: "123.5", ts: String(now + 4) }]
    })), { db, now: now + 5, receivedAt: now + 5 });
    marketStream.handleMarketStreamMessage(Buffer.from(JSON.stringify({
      event: "subscribe", arg: { channel: "liquidation-orders" }
    })));
    marketStream.handleMarketStreamMessage(Buffer.from(JSON.stringify({
      arg: { channel: "liquidation-orders" },
      data: [{ instId: "BTC-USDT-SWAP", details: [{ ts: String(now), posSide: "long", side: "sell", sz: "1", bkPx: "60000" }] }]
    })));

    assert.equal(db.markets[0].price, 61_000);
    assert.equal(db.markets[0].fundingRate, 0.01);
    assert.equal(db.markets[0].openInterest, 123.5);
    assert.equal(okxLiquidationStreamStatus().events, 1);
    assert.equal(updates.length, 3, "each market update should be broadcast once");
    assert.deepEqual(ticks, [{ symbol: "BTC/USDT", price: 61_000 }]);
  } finally {
    marketStream.removeStreamListener(listener);
    marketStream.setMarketTickHook(null);
    resetOkxLiquidationStreamForTest();
  }
});

test("public connection state preserves connecting, connected, error, and reconnecting semantics", () => {
  const clock = new FakeClock();
  clock.install();
  const db = dbFixture();
  const saves = [];
  try {
    marketStream.startMarketStream(db, (_db, options) => saves.push(options || null));
    const connection = db.realtimeConnections.find((row) => row.exchange === "OKX" && row.streamType === "public_market");
    assert.ok(connection);
    assert.equal(connection.status, "connecting");

    const socket = publicSockets()[0];
    socket.open();
    assert.equal(connection.status, "connected");

    socket.receive({
      arg: { channel: "tickers", instId: "BTC-USDT-SWAP" },
      data: [{ last: "62000", open24h: "60000", high24h: "63000", low24h: "59000", ts: String(Date.now()) }]
    });
    assert.ok(connection.lastMessageAt);
    assert.ok(saves.some((options) => options?.lightweight === true));

    socket.fail("transport_down");
    assert.equal(connection.status, "error");
    assert.equal(connection.error, "transport_down");
    socket.finishClose();
    assert.equal(connection.status, "reconnecting");
  } finally {
    cleanup(db, clock);
  }
});

test("private start, authentication, subscriptions, and stop keep their protocol behavior", () => {
  const clock = new FakeClock();
  clock.install();
  const db = dbFixture();
  process.env.OKX_API_KEY = "private-key";
  process.env.OKX_API_SECRET = "private-secret";
  process.env.OKX_API_PASSPHRASE = "private-passphrase";
  db.exchangeAccounts = [{
    id: "account-a",
    exchange: "OKX",
    readEnabled: true,
    apiKeyFingerprint: crypto.createHash("sha256").update("private-key").digest("hex").slice(0, 16)
  }];
  try {
    realtimeManager.startRealtimeManager(db, () => {});
    assert.equal(privateSockets().length, 1);
    const socket = privateSockets()[0];
    socket.open();
    assert.equal(JSON.parse(socket.sent[0]).op, "login");
    socket.receive({ event: "login", code: "0" });
    const subscription = JSON.parse(socket.sent[1]);
    assert.equal(subscription.op, "subscribe");
    assert.deepEqual(subscription.args.map((row) => row.channel), ["orders", "positions", "account"]);
    for (const channel of ["orders", "positions", "account"]) socket.receive({ event: "subscribe", arg: { channel } });
    assert.equal(db.realtimeConnections.find((row) => row.streamType === "private_user").status, "connected");

    realtimeManager.stopRealtimeManager(db, "manual_stop");
    assert.equal(socket.closeCalls.length, 1);
    assert.equal(db.realtimeConnections.find((row) => row.streamType === "private_user").status, "manual_stop");
  } finally {
    cleanup(db, clock);
  }
});

test("private credential rotation and private stop never restart or close the public owner", () => {
  const clock = new FakeClock();
  clock.install();
  const db = dbFixture();
  process.env.OKX_API_KEY = "key-a";
  process.env.OKX_API_SECRET = "secret-a";
  process.env.OKX_API_PASSPHRASE = "pass-a";
  db.exchangeAccounts = [{
    id: "account-a",
    exchange: "OKX",
    readEnabled: true,
    apiKeyFingerprint: crypto.createHash("sha256").update("key-a").digest("hex").slice(0, 16)
  }];
  try {
    marketStream.startMarketStream(db, () => {});
    const publicSocket = publicSockets()[0];
    const publicConnection = db.realtimeConnections.find((row) => row.streamType === "public_market");
    realtimeManager.startRealtimeManager(db, () => {});
    const firstPrivate = privateSockets()[0];

    process.env.OKX_API_KEY = "key-b";
    process.env.OKX_API_SECRET = "secret-b";
    process.env.OKX_API_PASSPHRASE = "pass-b";
    db.exchangeAccounts[0].apiKeyFingerprint = crypto.createHash("sha256").update("key-b").digest("hex").slice(0, 16);
    realtimeManager.startRealtimeManager(db, () => {}, { force: true });

    assert.equal(publicSockets().length, 1);
    assert.equal(publicSocket.closeCalls.length, 0);
    assert.equal(publicConnection.status, "connecting");
    assert.equal(privateSockets().length, 2);
    assert.equal(firstPrivate.closeCalls.length, 1);

    const secondPrivate = privateSockets()[1];
    realtimeManager.stopRealtimeManager(db, "private_stop");
    assert.equal(secondPrivate.closeCalls.length, 1);
    assert.equal(publicSocket.closeCalls.length, 0);
    assert.equal(activeSockets(publicSockets()).length, 1);
    assert.equal(publicConnection.status, "connecting");
  } finally {
    cleanup(db, clock);
  }
});

test("realtime routes coordinate public and private lifecycles without changing response shape", () => {
  const routes = new Map();
  const app = {};
  for (const method of ["get", "post"]) app[method] = (route, ...handlers) => routes.set(`${method.toUpperCase()} ${route}`, handlers.at(-1));
  const db = { realtimeConnections: [] };
  const calls = [];
  const started = { started: true, socketCount: 1, connections: db.realtimeConnections };
  const stopped = { started: false, socketCount: 0, connections: db.realtimeConnections };
  registerRealtimeRoutes(app, {
    db,
    saveDb() {},
    persist(res, payload) { res.payload = payload; },
    requirePermission: () => (_req, _res, next) => next(),
    realtimeStatus: () => started,
    startMarketStream() { calls.push("public:start"); },
    startRealtimeManager() { calls.push("private:start"); return started; },
    stopMarketStream(_db, reason) { calls.push(`public:stop:${reason}`); },
    stopRealtimeManager(_db, reason) { calls.push(`private:stop:${reason}`); return stopped; }
  });

  const startResponse = {};
  routes.get("POST /api/realtime/start")({}, startResponse);
  assert.deepEqual(calls, ["public:start", "private:start"]);
  assert.deepEqual(startResponse.payload, started);

  calls.length = 0;
  const stopResponse = {};
  routes.get("POST /api/realtime/stop")({ body: { reason: "manual_stop" } }, stopResponse);
  assert.deepEqual(calls, ["public:stop:manual_stop", "private:stop:manual_stop"]);
  assert.deepEqual(stopResponse.payload, stopped);
});
