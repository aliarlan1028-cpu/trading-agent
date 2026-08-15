import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "lease-side-effects-"));
delete process.env.LARK_WEBHOOK_URL;
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHAT_ID;

const { reconcileExecutionOrderState, pollExecutionOrders } = await import("../server/executionEngine.mjs");
const { monitorPositions } = await import("../server/positionManager.mjs");
const { dispatchOutbox } = await import("../server/outboxDispatcher.mjs");
const { reserveOmsOrder, transitionOmsOrder } = await import("../server/store.mjs");

test("lease lost after authoritative read prevents TP exchange write", async () => {
  let writes = 0;
  const execution = {
    id: "exec-filled", exchange: "TEST", status: "entry_pending", symbol: "BTC/USDT",
    direction: "long", quantity: 1, entryPrice: 100, filledQuantity: 0,
    protection: "attached", takeProfits: [110], events: [], createdAt: new Date().toISOString()
  };
  const db = {
    executionOrders: [execution], tradePlans: [], fills: [], positions: [], riskIncidents: [],
    auditLogs: [], traces: [], notifications: [], system: {}, markets: []
  };
  await assert.rejects(() => reconcileExecutionOrderState(db, execution.id, {
    state: "filled", filledQuantity: 1, avgPrice: 100
  }, {
    assertLease() { throw new Error("scheduler_lease_lost"); },
    placeTakeProfits: async () => { writes += 1; }
  }), /scheduler_lease_lost/);
  assert.equal(writes, 0);
});

test("poll loop rethrows lease loss and does not process the next execution", async () => {
  const first = { id: "member-1", status: "group_close_pending", groupCloseExecutionId: "missing-1", events: [] };
  const second = { id: "member-2", status: "group_close_pending", groupCloseExecutionId: "missing-2", events: [] };
  const db = { executionOrders: [first, second], tradePlans: [], fills: [], positions: [], riskIncidents: [], auditLogs: [], traces: [], system: {} };
  let checks = 0;
  await assert.rejects(() => pollExecutionOrders(db, {
    assertLease() {
      checks += 1;
      if (checks >= 3) throw new Error("scheduler_lease_lost");
    }
  }), /scheduler_lease_lost/);
  assert.equal(first.status, "entry_filled");
  assert.equal(second.status, "group_close_pending");
});

test("position monitor rechecks fencing immediately before move_stop", async () => {
  const at = new Date().toISOString();
  const managed = {
    id: "pos-1", source: "execution_engine", executionOrderId: "exec-1", symbol: "BTC/USDT",
    direction: "long", entry: 100, size: 1, stopLoss: 90, takeProfits: [110], openedAt: new Date(Date.now() - 60_000).toISOString()
  };
  const rest = { id: "rest-1", source: "exchange_rest", exchange: "OKX", symbol: "BTC/USDT", direction: "long", pnl: 20, mark: 110, rawSyncedAt: at };
  const db = {
    positions: [managed, rest], executionOrders: [{ id: "exec-1", exchange: "OKX", direction: "long", stopClientOrderId: "stop-1" }],
    markets: [{ symbol: "BTC/USDT", price: 110, fundingRate: 0, lastRealtimeAt: at, microSyncedAt: at }],
    accountSnapshots: [{ id: "snap", exchange: "OKX", status: "ok", createdAt: at, algoOrdersComplete: true, algoOrders: [{ instId: "BTC-USDT-SWAP", algoClOrdId: "stop-1", slTriggerPx: "90" }] }],
    system: {}, portfolio: {}, auditLogs: [], traces: [], notifications: [], riskIncidents: [], fills: [], meta: {}
  };
  let outerChecks = 0;
  let writes = 0;
  await assert.rejects(() => monitorPositions(db, {
    monitorOwnerId: `test-${Date.now()}`,
    assertLease() {
      outerChecks += 1;
      if (outerChecks >= 3) throw new Error("scheduler_lease_lost");
    },
    executeTradeAction: async () => { writes += 1; return { status: "ok" }; },
    saveDb() {}
  }), /scheduler_lease_lost/);
  assert.equal(writes, 0);
});

test("outbox replay uses a stable idempotency key after publish-side lease loss", async () => {
  const reserved = reserveOmsOrder({ tenantId: "tenant_owner", exchange: "OKX", clientOrderId: "outboxcase1", action: "cancel_order", payload: { symbol: "BTC/USDT" } });
  transitionOmsOrder(reserved.order.id, "ACKNOWLEDGED", { eventType: "test_publish" });
  const effects = new Set();
  let attempts = 0;
  const publish = async (_event, context) => {
    attempts += 1;
    effects.add(context.idempotencyKey);
  };
  let checks = 0;
  await assert.rejects(() => dispatchOutbox({ traces: [] }, {
    limit: 1,
    publish,
    assertLease() {
      checks += 1;
      if (checks === 2) throw new Error("scheduler_lease_lost");
    }
  }), /scheduler_lease_lost/);
  const retried = await dispatchOutbox({ traces: [] }, { limit: 1, publish, assertLease() {} });
  assert.equal(retried.published, 1);
  assert.equal(attempts, 2);
  assert.equal(effects.size, 1);
});
