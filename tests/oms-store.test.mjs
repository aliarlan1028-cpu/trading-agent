import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "trading-agent-oms-test-"));
process.env.DATA_DIR = dataDir;
const {
  reserveOmsOrder,
  transitionOmsOrder,
  getOmsOrder,
  pendingOutboxEvents,
  markOutboxPublished,
  acquireExecutionLease,
  releaseExecutionLease,
  appendAudit,
  readAuditSinkBatch,
  commitAuditSinkCursor,
  putTenantResource,
  listTenantResources,
  getTenantResource,
  deleteTenantResource,
  seedDatabase,
  saveDb,
  loadDb
} = await import("../server/store.mjs");

test("OMS reserves idempotency keys and rejects payload conflicts", () => {
  const first = reserveOmsOrder({
    tenantId: "t1",
    exchange: "OKX",
    clientOrderId: "client-1",
    action: "place_order",
    planId: "p1",
    payload: { symbol: "BTC/USDT", quantity: 1 }
  });
  assert.equal(first.status, "reserved");

  const replay = reserveOmsOrder({
    tenantId: "t1",
    exchange: "OKX",
    clientOrderId: "client-1",
    action: "place_order",
    planId: "p1",
    payload: { symbol: "BTC/USDT", quantity: 1 }
  });
  assert.equal(replay.status, "replay");

  const conflict = reserveOmsOrder({
    tenantId: "t1",
    exchange: "OKX",
    clientOrderId: "client-1",
    action: "place_order",
    planId: "p1",
    payload: { symbol: "BTC/USDT", quantity: 2 }
  });
  assert.equal(conflict.status, "conflict");
});

test("core trading entities recover one row per entity after restart-style reload", () => {
  const db = seedDatabase();
  db.positions = [
    { id: "pos-a", tenantId: "tenant-a", symbol: "BTC/USDT", status: "open", size: 1 },
    { id: "pos-b", tenantId: "tenant-b", symbol: "ETH/USDT", status: "open", size: 2 }
  ];
  db.fills = [{ id: "fill-a", tenantId: "tenant-a", symbol: "BTC/USDT", kind: "entry", price: 100 }];
  saveDb(db);
  db.positions[0].size = 999;
  const recovered = loadDb();
  assert.equal(recovered.positions.find((item) => item.id === "pos-a").size, 1);
  assert.equal(recovered.positions.find((item) => item.id === "pos-b").tenantId, "tenant-b");
  assert.equal(recovered.fills[0].id, "fill-a");
});

test("tenant resource repository enforces physical tenant keys", () => {
  putTenantResource("tenant-a", "orders", { id: "same-id", symbol: "BTC/USDT" });
  putTenantResource("tenant-b", "orders", { id: "same-id", symbol: "ETH/USDT" });
  assert.equal(getTenantResource("tenant-a", "orders", "same-id").symbol, "BTC/USDT");
  assert.equal(getTenantResource("tenant-b", "orders", "same-id").symbol, "ETH/USDT");
  assert.equal(listTenantResources("tenant-a", "orders").length, 1);
  assert.equal(deleteTenantResource("tenant-a", "orders", "same-id"), true);
  assert.equal(getTenantResource("tenant-a", "orders", "same-id"), null);
  assert.equal(getTenantResource("tenant-b", "orders", "same-id").symbol, "ETH/USDT");
});

test("WORM audit cursor advances only after explicit commit", () => {
  reserveOmsOrder({
    tenantId: "t1", exchange: "OKX", clientOrderId: "audit-init",
    action: "place_order", payload: { symbol: "BTC/USDT", quantity: 1 }
  });
  const db = { meta: {}, auditLogs: [] };
  appendAudit(db, "test audit", "target", "tester");
  const beforeCommit = readAuditSinkBatch("test-sink");
  assert.ok(beforeCommit.length >= 1);
  const cursor = beforeCommit.at(-1).cursor;
  assert.equal(readAuditSinkBatch("test-sink").at(-1).cursor, cursor);
  commitAuditSinkCursor("test-sink", cursor);
  assert.equal(readAuditSinkBatch("test-sink").length, 0);
});

test("stale process snapshots cannot fork the SQLite audit chain", () => {
  const processA = loadDb();
  const processB = loadDb();
  const first = appendAudit(processA, "process A append", "audit-a", "process-a");
  const second = appendAudit(processB, "process B append", "audit-b", "process-b");
  saveDb(processA);
  saveDb(processB);
  assert.equal(second.prevHash, first.hash);
  assert.equal(loadDb().meta.auditChainBroken, false);
});

test("execution leases provide fencing across competing instances", () => {
  const first = acquireExecutionLease("plan:p1", "instance-a", 30_000);
  assert.equal(first.acquired, true);
  const blocked = acquireExecutionLease("plan:p1", "instance-b", 30_000);
  assert.equal(blocked.acquired, false);
  assert.equal(releaseExecutionLease("plan:p1", "instance-a", first.fencingToken), true);
  const second = acquireExecutionLease("plan:p1", "instance-b", 30_000);
  assert.equal(second.acquired, true);
  assert.ok(second.fencingToken > first.fencingToken);
});

test("OMS transition and outbox commit atomically", () => {
  const reservation = reserveOmsOrder({
    tenantId: "t1",
    exchange: "BINANCE",
    clientOrderId: "client-2",
    action: "place_order",
    planId: "p2",
    payload: { symbol: "ETH/USDT", quantity: 1 }
  });
  transitionOmsOrder(reservation.order.id, "ACKNOWLEDGED", {
    eventType: "exchange_acknowledged",
    exchangeOrderId: "remote-2",
    response: { status: "ok" }
  });
  const order = getOmsOrder(reservation.order.id);
  assert.equal(order.state, "ACKNOWLEDGED");
  assert.equal(order.exchangeOrderId, "remote-2");
  const events = pendingOutboxEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].aggregateId, reservation.order.id);
  assert.equal(markOutboxPublished(events[0].id), true);
  assert.equal(pendingOutboxEvents().length, 0);
});
