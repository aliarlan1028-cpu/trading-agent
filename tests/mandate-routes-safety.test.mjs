import test from "node:test";
import assert from "node:assert/strict";
import { registerMandateRoutes } from "../server/routes/mandates.mjs";
import { activateMandate } from "../server/agentOrchestrator.mjs";
import { sanitizeMandatePayload } from "../server/mandatePolicy.mjs";

function validBody() {
  return {
    name: "Primary",
    exchanges: ["OKX"],
    marketTypes: ["perpetual_usdt"],
    allowedSymbols: ["BTC/USDT"],
    maxLeverage: 2,
    minLeverage: 1,
    maxLeverageBySymbol: { "BTC/USDT": 2 },
    maxSingleTradeRiskPct: 1,
    maxDailyLossPct: 2,
    maxWeeklyLossPct: 5,
    maxOrderNotionalUsdt: 20,
    maxSymbolNotionalUsdt: 20,
    maxPortfolioNotionalUsdt: 20,
    validUntil: "2027-08-15T00:00:00.000Z"
  };
}

function setup() {
  const routes = new Map();
  const app = {
    get(path, ...handlers) { routes.set(`GET ${path}`, handlers.at(-1)); },
    post(path, ...handlers) { routes.set(`POST ${path}`, handlers.at(-1)); },
    patch(path, ...handlers) { routes.set(`PATCH ${path}`, handlers.at(-1)); }
  };
  let sequence = 0;
  const db = { user: { name: "Owner" }, mandates: [], grayReleasePolicies: [], auditLogs: [], traces: [] };
  const ctx = {
    db,
    requirePermission: () => (_req, _res, next) => next(),
    parseMandateCommand: () => ({}),
    activateMandate,
    id: () => `mandate_${++sequence}`,
    nowIso: () => "2026-08-15T00:00:00.000Z",
    appendAudit: () => {},
    appendTrace: () => {},
    persist: (res, value) => res.json(value)
  };
  registerMandateRoutes(app, ctx);
  return { routes, db };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

test("mandate writes reject server-owned identity and lifecycle fields", () => {
  for (const body of [{ id: "shadow" }, { status: "active" }, { version: 99 }, { createdAt: "x" }]) {
    const result = sanitizeMandatePayload(body);
    assert.equal(result.ok, false);
    assert.equal(result.error, "mandate_fields_not_writable");
  }
});

test("mandate creation is draft-only and activation preserves a single active revision", () => {
  const { routes, db } = setup();
  const create = routes.get("POST /api/mandates");
  const injectedRes = response();
  create({ body: { ...validBody(), status: "active" } }, injectedRes);
  assert.equal(injectedRes.statusCode, 400);
  assert.equal(db.mandates.length, 0);

  const firstRes = response();
  create({ body: validBody() }, firstRes);
  assert.equal(firstRes.body.status, "draft");
  const first = firstRes.body;
  activateMandate(db, first.id);
  assert.equal(first.status, "active");

  const secondRes = response();
  create({ body: { ...validBody(), name: "Replacement" } }, secondRes);
  const second = secondRes.body;
  const oldVersion = first.version;
  activateMandate(db, second.id);
  assert.equal(db.mandates.filter((item) => ["active", "running"].includes(item.status)).length, 1);
  assert.equal(second.status, "active");
  assert.equal(first.status, "superseded");
  assert.equal(first.version, oldVersion + 1);
  assert.equal(first.supersededByMandateId, second.id);
});

test("mandate PATCH cannot activate or rewrite identity", () => {
  const { routes, db } = setup();
  db.mandates.push({ id: "m1", version: 1, status: "paused", createdAt: "2026-01-01T00:00:00.000Z", ...validBody() });
  const patch = routes.get("PATCH /api/mandates/:id");
  for (const body of [{ status: "active" }, { id: "replacement" }]) {
    const res = response();
    patch({ params: { id: "m1" }, body }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(db.mandates[0].status, "paused");
    assert.equal(db.mandates[0].id, "m1");
  }
});
