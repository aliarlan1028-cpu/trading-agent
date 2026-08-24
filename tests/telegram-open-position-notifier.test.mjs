import assert from "node:assert/strict";
import test from "node:test";

process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.TELEGRAM_CHAT_ID = "test-chat";
process.env.TELEGRAM_PROFIT_POSTER_ENABLED = "true";
process.env.TELEGRAM_PROFIT_POSTER_MIN_PNL_USDT = "0";
process.env.TELEGRAM_PROFIT_POSTER_MIN_ROI_PCT = "0";

const { publishProfitablePositionPosters } = await import("../server/telegramNotifier.mjs");
const { getConfigStatus } = await import("../server/runtimeConfig.mjs");

function baseDb() {
  return {
    system: {},
    positions: [],
    fills: [],
    executionOrders: [],
    tradePlans: [],
    notifications: [],
    auditLogs: []
  };
}

function addManagedPosition(db, { authoritativeQuantity = 1 } = {}) {
  const now = new Date().toISOString();
  const execution = {
    id: "exec-system", planId: "plan-system", status: "protecting",
    exchange: "OKX", accountId: "account-a", environment: "production",
    symbol: "BTC/USDT", direction: "long", filledQuantity: 1, entryFilledAt: now,
    leverage: 2
  };
  db.executionOrders.push(execution);
  db.tradePlans.push({
    id: execution.planId, exchange: execution.exchange, accountId: execution.accountId,
    environment: execution.environment, symbol: execution.symbol, direction: execution.direction
  });
  db.fills.push({
    id: "entry-system", kind: "entry", executionOrderId: execution.id,
    planId: execution.planId, tradePlanId: execution.planId,
    exchange: execution.exchange, accountId: execution.accountId, environment: execution.environment,
    symbol: execution.symbol, direction: execution.direction, quantity: 1, price: 100,
    exchangeFilledAt: now, createdAt: now,
    tradeAttribution: {
      schemaVersion: 1, scope: "system", origin: "execution_engine",
      executionOrderId: execution.id, planId: execution.planId, method: "execution_writer",
      evidence: { accountId: execution.accountId, environment: execution.environment, attributedQuantity: 1 }
    }
  });
  db.positions.push(
    {
      id: "engine-position", source: "execution_engine", executionOrderId: execution.id,
      exchange: execution.exchange, accountId: execution.accountId, environment: execution.environment,
      symbol: execution.symbol, direction: execution.direction, quantity: 1, size: 1,
      entry: 100, leverage: 2, createdAt: now, updatedAt: now
    },
    {
      id: "exchange-position", source: "exchange_rest", exchange: execution.exchange,
      accountId: execution.accountId, environment: execution.environment,
      symbol: execution.symbol, direction: execution.direction, coinSize: authoritativeQuantity,
      size: authoritativeQuantity, entry: 100, mark: 110, pnl: 10, roiPct: 20,
      leverage: 2, exchangeObservedAt: now, updatedAt: now
    }
  );
}

test("pure manual profitable positions do not produce system profit posters", async () => {
  const db = baseDb();
  const now = new Date().toISOString();
  db.positions.push({
    id: "manual-position", source: "exchange_rest", exchange: "OKX",
    accountId: "account-a", environment: "production", symbol: "ETH/USDT",
    direction: "long", coinSize: 1, size: 1, entry: 100, mark: 120,
    pnl: 20, roiPct: 40, exchangeObservedAt: now, updatedAt: now
  });
  const originalFetch = global.fetch;
  let requests = 0;
  global.fetch = async () => { requests += 1; throw new Error("network must not be reached"); };
  try {
    const result = await publishProfitablePositionPosters(db);
    assert.equal(requests, 0);
    assert.equal(result.actions.length, 0);
    assert.equal(result.reasonCounts.manual_position_excluded, 1);
    assert.equal(db.notifications.length, 0);
    assert.equal(
      getConfigStatus(db).integrations.telegram.profitPosterStatus.open.reasonCounts.manual_position_excluded,
      1
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("an exactly attributed managed position can still send one open-profit poster", async () => {
  const db = baseDb();
  addManagedPosition(db);
  const originalFetch = global.fetch;
  let requests = 0;
  global.fetch = async () => {
    requests += 1;
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 7 } }) };
  };
  try {
    const result = await publishProfitablePositionPosters(db);
    assert.equal(requests, 1);
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].status, "sent");
    assert.equal(result.reasonCounts.sent, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("the newest authoritative WS mirror can send a managed-position poster when REST also exists", async () => {
  const db = baseDb();
  addManagedPosition(db);
  const now = Date.now();
  const rest = db.positions.find((row) => row.source === "exchange_rest");
  Object.assign(rest, {
    exchangeObservedAt: new Date(now - 2_000).toISOString(),
    updatedAt: new Date(now - 2_000).toISOString(),
    mark: 109,
    pnl: 9,
    roiPct: 18
  });
  db.positions.push({
    ...rest,
    id: "exchange-ws-position",
    source: "exchange_ws",
    exchangeObservedAt: new Date(now - 1_000).toISOString(),
    updatedAt: new Date(now - 1_000).toISOString(),
    mark: 110,
    pnl: 10,
    roiPct: 20
  });
  const originalFetch = global.fetch;
  let requests = 0;
  global.fetch = async () => {
    requests += 1;
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 8 } }) };
  };
  try {
    const result = await publishProfitablePositionPosters(db);
    assert.equal(requests, 1);
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].status, "sent");
    assert.equal(result.actions[0].pnl, 10);
    assert.equal(result.reasonCounts.manual_position_excluded, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});

test("the newest authoritative REST mirror remains eligible when an older WS mirror exists", async () => {
  const db = baseDb();
  addManagedPosition(db);
  const now = Date.now();
  const rest = db.positions.find((row) => row.source === "exchange_rest");
  Object.assign(rest, {
    exchangeObservedAt: new Date(now - 1_000).toISOString(),
    updatedAt: new Date(now - 1_000).toISOString()
  });
  db.positions.push({
    ...rest,
    id: "older-exchange-ws-position",
    source: "exchange_ws",
    exchangeObservedAt: new Date(now - 2_000).toISOString(),
    updatedAt: new Date(now - 2_000).toISOString(),
    mark: 108,
    pnl: 8,
    roiPct: 16
  });
  const originalFetch = global.fetch;
  let requests = 0;
  global.fetch = async () => {
    requests += 1;
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 9 } }) };
  };
  try {
    const result = await publishProfitablePositionPosters(db);
    assert.equal(requests, 1);
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].pnl, 10);
  } finally {
    global.fetch = originalFetch;
  }
});

test("a mixed manual and managed quantity fails the open-profit poster closed", async () => {
  const db = baseDb();
  addManagedPosition(db, { authoritativeQuantity: 2 });
  const originalFetch = global.fetch;
  let requests = 0;
  global.fetch = async () => { requests += 1; throw new Error("network must not be reached"); };
  try {
    const result = await publishProfitablePositionPosters(db);
    assert.equal(requests, 0);
    assert.equal(result.actions.length, 0);
    assert.equal(result.reasonCounts.managed_position_quantity_mismatch, 1);
    assert.equal(db.notifications.length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});
