import assert from "node:assert/strict";
import test from "node:test";

import { unrealizedPnl } from "../server/accounting.mjs";
import { applyOkxSnapshot } from "../server/exchangeConnector.mjs";
import { dedupePositions } from "../server/positionView.mjs";
import { updateOkxPositions } from "../server/realtimeManager.mjs";

const now = Date.UTC(2026, 7, 22, 4, 0, 0);
const at = (offsetMs) => new Date(now + offsetMs).toISOString();

function appendWsPosition(db, accountId = "account-a") {
  updateOkxPositions(db, [{
    instId: "SUI-USDT-SWAP",
    posSide: "short",
    pos: "10",
    avgPx: "0.9",
    markPx: "0.8",
    upl: "-1",
    lever: "3",
    uTime: at(-10 * 60_000)
  }], {
    accountId,
    apiKeyFingerprint: `${accountId}-fingerprint`,
    environment: "production"
  });
}

function snapshot(accountId = "account-a", positions = [
  {
    instId: "SUI-USDT-SWAP",
    posSide: "short",
    pos: "10",
    ctVal: "0.1",
    avgPx: "0.9",
    markPx: "0.8",
    upl: "4.5",
    lever: "3",
    mgnMode: "cross"
  }
]) {
  return {
    id: `snapshot-${accountId}`,
    exchange: "OKX",
    accountId,
    apiKeyFingerprint: `${accountId}-fingerprint`,
    environment: "production",
    createdAt: at(-1_000),
    positions,
    openOrders: [],
    openOrdersComplete: true,
    balances: []
  };
}

test("a fresh REST snapshot keeps its account binding and supersedes the stale WS mirror", async () => {
  const db = { positions: [], orders: [], portfolio: {} };

  await applyOkxSnapshot(db, snapshot());
  appendWsPosition(db);

  const rest = db.positions.find((row) => row.source === "exchange_rest");
  assert.equal(rest.accountId, "account-a");
  assert.equal(rest.apiKeyFingerprint, "account-a-fingerprint");
  assert.equal(rest.environment, "production");
  assert.deepEqual(dedupePositions(db.positions).map((row) => row.source), ["exchange_rest"]);
  assert.deepEqual(unrealizedPnl(db, { now }), {
    knownTotal: 4.5,
    pendingPositions: [],
    complete: true
  });
});

test("a REST snapshot for another account cannot mask a stale WS position", async () => {
  const db = { positions: [], orders: [], portfolio: {} };

  await applyOkxSnapshot(db, snapshot("account-b"));
  appendWsPosition(db, "account-a");

  assert.deepEqual(dedupePositions(db.positions).map((row) => row.accountId).sort(), ["account-a", "account-b"]);
  const state = unrealizedPnl(db, { now });
  assert.equal(state.knownTotal, 4.5);
  assert.equal(state.complete, false);
  assert.equal(state.pendingPositions.length, 1);
  assert.equal(state.pendingPositions[0].identity, "account-a|OKX|SUI/USDT|short||");
});

test("REST snapshots for different accounts cannot overwrite each other", async () => {
  const db = { positions: [], orders: [], portfolio: {} };

  await applyOkxSnapshot(db, snapshot("account-a"));
  await applyOkxSnapshot(db, snapshot("account-b"));

  const restPositions = db.positions.filter((row) => row.source === "exchange_rest");
  assert.equal(restPositions.length, 2);
  assert.deepEqual(restPositions.map((row) => row.accountId).sort(), ["account-a", "account-b"]);
});

test("an empty REST snapshot only prunes mirrors owned by the same account", async () => {
  const db = { positions: [], orders: [], portfolio: {} };

  await applyOkxSnapshot(db, snapshot("account-a"));
  await applyOkxSnapshot(db, snapshot("account-b", []));

  assert.equal(db.positions.length, 1);
  assert.equal(db.positions[0].accountId, "account-a");
});

test("another account's empty REST snapshot preserves both REST and WS mirrors", async () => {
  const db = { positions: [], orders: [], portfolio: {} };

  await applyOkxSnapshot(db, snapshot("account-a"));
  appendWsPosition(db, "account-a");
  await applyOkxSnapshot(db, snapshot("account-b", []));

  assert.deepEqual(db.positions.map((row) => row.source).sort(), ["exchange_rest", "exchange_ws"]);
  assert.ok(db.positions.every((row) => row.accountId === "account-a"));
});

test("a bound snapshot migrates its matching legacy unbound REST mirror in place", async () => {
  const db = {
    positions: [{
      id: "legacy-rest",
      exchangePositionKey: "OKX:SUI/USDT:short",
      exchange: "OKX",
      source: "exchange_rest",
      symbol: "SUI/USDT",
      direction: "short"
    }],
    orders: [],
    portfolio: {}
  };

  await applyOkxSnapshot(db, snapshot("account-a"));

  assert.equal(db.positions.length, 1);
  assert.equal(db.positions[0].id, "legacy-rest");
  assert.equal(db.positions[0].accountId, "account-a");
  assert.equal(db.positions[0].exchangePositionKey, "OKX:account-a:SUI/USDT:short");
});

test("a first bound empty snapshot prunes legacy unbound REST mirrors", async () => {
  const db = {
    positions: [{
      id: "legacy-rest",
      exchangePositionKey: "OKX:SUI/USDT:short",
      exchange: "OKX",
      source: "exchange_rest",
      symbol: "SUI/USDT",
      direction: "short"
    }],
    orders: [],
    portfolio: {}
  };

  await applyOkxSnapshot(db, snapshot("account-a", []));

  assert.deepEqual(db.positions, []);
});

test("an empty authoritative REST snapshot still removes stale exchange mirrors", async () => {
  const db = { positions: [], orders: [], portfolio: {} };
  appendWsPosition(db);

  await applyOkxSnapshot(db, snapshot("account-a", []));

  assert.deepEqual(db.positions, []);
});

test("an empty authoritative REST snapshot removes its own bound REST mirror", async () => {
  const db = { positions: [], orders: [], portfolio: {} };

  await applyOkxSnapshot(db, snapshot("account-a"));
  await applyOkxSnapshot(db, snapshot("account-a", []));

  assert.deepEqual(db.positions, []);
});
