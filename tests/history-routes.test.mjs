import assert from "node:assert/strict";
import test from "node:test";

import { registerHistoryRoutes } from "../server/routes/history.mjs";
import { registerTradingDataRoutes } from "../server/routes/tradingData.mjs";

function response() {
  return {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

function routeHarness(db) {
  const routes = new Map();
  const app = {
    get(path, ...handlers) { routes.set(`GET ${path}`, handlers); },
    post(path, ...handlers) { routes.set(`POST ${path}`, handlers); }
  };
  const requirePermission = (permission) => {
    const middleware = (req, res, next) => req.user?.permissions?.includes(permission)
      ? next()
      : res.status(403).json({ error: "forbidden" });
    middleware.permission = permission;
    return middleware;
  };
  registerHistoryRoutes(app, { db, requirePermission });
  registerTradingDataRoutes(app, {
    db, requirePermission, persist() {}, activeMandate() {}, listStrategies: () => [],
    buildPortfolioRisk: () => ({}), runBacktest: async () => ({}), performanceReport: () => ({}), refreshAccounting: () => ({})
  });
  const invoke = (path, req = {}) => {
    const res = response();
    const handlers = routes.get(`GET ${path}`);
    const run = (index) => handlers[index]?.(req, res, () => run(index + 1));
    run(0);
    return res;
  };
  return { routes, invoke };
}

function systemAttribution(execution, exitMode = null) {
  return {
    schemaVersion: 1,
    scope: "system",
    origin: exitMode ? "external_exchange" : "execution_engine",
    exitMode,
    executionOrderId: execution.id,
    planId: execution.planId,
    method: exitMode ? "deterministic_manual_exit" : "execution_writer",
    evidence: { accountId: execution.accountId, environment: execution.environment }
  };
}

function historyDb() {
  const normal = { id: "exec-normal", planId: "plan-normal", exchange: "OKX", accountId: "account-a", environment: "production", symbol: "BTC/USDT", direction: "long", status: "closed" };
  const manualExit = { id: "exec-manual-exit", planId: "plan-manual-exit", exchange: "OKX", accountId: "account-a", environment: "production", symbol: "ETH/USDT", direction: "short", status: "closed" };
  const plans = [normal, manualExit].map((execution) => ({
    id: execution.planId, exchange: execution.exchange, accountId: execution.accountId,
    environment: execution.environment, symbol: execution.symbol, direction: execution.direction
  }));
  const fill = (id, kind, execution, createdAt, exitMode = null) => ({
    id, kind, executionOrderId: execution.id, planId: execution.planId, tradePlanId: execution.planId,
    exchange: execution.exchange, accountId: execution.accountId, environment: execution.environment,
    symbol: execution.symbol, direction: execution.direction, quantity: 1, price: 100, createdAt,
    tradeAttribution: systemAttribution(execution, exitMode)
  });
  return {
    executionOrders: [normal, manualExit],
    tradePlans: plans,
    fills: [
      { id: "pending-newest", kind: "close", createdAt: "2026-08-01T06:00:00Z", tradeAttribution: { schemaVersion: 1, scope: "attribution_pending", origin: "external_exchange", reason: "mixed_position_attribution" } },
      { id: "manual-new", kind: "close", positionId: "manual", symbol: "SOL/USDT", createdAt: "2026-08-01T05:00:00Z" },
      fill("manual-exit-close", "close", manualExit, "2026-08-01T04:00:00Z", "manual_exit"),
      fill("manual-exit-entry", "entry", manualExit, "2026-08-01T03:00:00Z"),
      fill("normal-close", "close", normal, "2026-08-01T02:00:00Z", "system_exit"),
      fill("normal-entry", "entry", normal, "2026-08-01T01:00:00Z")
    ]
  };
}

test("history fills is authenticated system history and paginates after projection", () => {
  const db = historyDb();
  const { routes, invoke } = routeHarness(db);
  const historyHandlers = routes.get("GET /api/history/fills");
  assert.equal(historyHandlers[0].permission, "account.read");

  const denied = invoke("/api/history/fills", { user: { permissions: [] }, query: {} });
  assert.equal(denied.statusCode, 403);

  const first = invoke("/api/history/fills", {
    user: { permissions: ["account.read"] }, query: { limit: "2" }
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers["Cache-Control"], "no-store");
  assert.deepEqual(first.payload.items.map((row) => row.id), ["manual-exit-close", "manual-exit-entry"]);
  assert.equal(first.payload.summary.total, 4);
  assert.equal(first.payload.summary.terminalTotal, 4);
  assert.equal(first.payload.limit, 2);
  assert.equal(first.payload.hasMore, true);
  assert.equal(typeof first.payload.nextCursor, "string");

  const second = invoke("/api/history/fills", {
    user: { permissions: ["account.read"] }, query: { limit: "2", cursor: first.payload.nextCursor }
  });
  assert.deepEqual(second.payload.items.map((row) => row.id), ["normal-close", "normal-entry"]);
  assert.equal(second.payload.hasMore, false);
  assert.equal(second.payload.nextCursor, null);
});

test("raw fills route remains an authenticated forensic account feed", () => {
  const db = historyDb();
  const { routes, invoke } = routeHarness(db);
  assert.equal(routes.get("GET /api/fills")[0].permission, "account.read");

  const res = invoke("/api/fills", { user: { permissions: ["account.read"] }, query: {} });

  assert.deepEqual(res.payload.map((row) => row.id), db.fills.map((row) => row.id));
  assert.equal(res.payload.some((row) => row.id === "manual-new"), true);
  assert.equal(res.payload.some((row) => row.id === "pending-newest"), true);
});
