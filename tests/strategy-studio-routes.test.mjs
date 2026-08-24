import assert from "node:assert/strict";
import test from "node:test";

import { registerStrategyRoutes } from "../server/routes/strategy.mjs";
import { seedDatabase } from "../server/store.mjs";

function routeHarness({ completion = null } = {}) {
  const db = seedDatabase();
  db.strategyStudioDrafts = [];
  db.strategyBlueprintVersions = [];
  db.strategyStudioBacktests = [];
  db.strategyMarketplaceListings = [];
  db.strategyAssignments = [];
  const routes = new Map();
  const app = {
    get(path, ...handlers) { routes.set(`GET ${path}`, handlers.at(-1)); },
    post(path, ...handlers) { routes.set(`POST ${path}`, handlers.at(-1)); }
  };
  const persist = (res, payload) => res.json(payload);
  registerStrategyRoutes(app, {
    db,
    persist,
    requirePermission: () => (_req, _res, next) => next(),
    activeStrategyProfiles: () => [],
    runStrategyResearch: async () => ({}),
    buildStrategyBoard: () => ({}),
    buildStrategyCatalog: () => ({}),
    STRATEGIES: {},
    appendAudit: () => {},
    activeProvider: () => completion ? { name: "test" } : null,
    llmComplete: completion || (async () => null)
  });
  return { db, routes };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return value; }
  };
}

function ownerRequest(prompt) {
  return {
    body: { prompt },
    tenantId: "tenant_owner",
    user: { id: "user_owner", tenantId: "tenant_owner", name: "Owner", isOwner: true }
  };
}

test("authenticated Strategy Studio POST persists compiler provenance when LLM output cannot be used", async () => {
  const { db, routes } = routeHarness({ completion: async () => "not-json" });
  db.user = { id: "user_owner", tenantId: "tenant_owner", name: "Owner", isOwner: true };
  const res = response();
  await routes.get("POST /api/strategy/studio/drafts")(
    ownerRequest("BTC/USDT 1h 10和30均线金叉做多，止损2%，止盈2R"),
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.draft.compiler, "deterministic_fallback");
  assert.equal(res.body.draft.compilationReport.status, "compiled_with_fallback");
  assert.ok(res.body.draft.compilationReport.warnings.includes("llm_no_structured_output"));
  assert.equal(res.body.suite.status, "passed");
  assert.equal(db.strategyStudioDrafts.length, 1);
});

test("Strategy Studio LLM completion may name a draft but cannot inject executable fields", async () => {
  const { db, routes } = routeHarness({
    completion: async () => JSON.stringify({
      name: "模型命名",
      description: "模型摘要",
      params: { fast: 2, slow: 300 },
      exitPolicy: { atrStop: true, atrMult: 7, atrPeriod: 99 }
    })
  });
  db.user = { id: "user_owner", tenantId: "tenant_owner", name: "Owner", isOwner: true };
  const res = response();
  await routes.get("POST /api/strategy/studio/drafts")(
    ownerRequest("BTC/USDT 1h 10和30均线金叉做多，止损2%，止盈2R"),
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.draft.compiler, "llm_metadata_only");
  assert.ok(res.body.draft.compilationReport.warnings.includes("llm_executable_fields_ignored"));
  assert.deepEqual(res.body.draft.blueprint.params, { fast: 10, slow: 30 });
  assert.equal(res.body.draft.blueprint.exitPolicy.atrStop, false);
});

test("Strategy Studio POST returns an actionable 422 contract without persisting unsupported semantics", async () => {
  const { db, routes } = routeHarness();
  db.user = { id: "user_owner", tenantId: "tenant_owner", name: "Owner", isOwner: true };
  const res = response();
  await routes.get("POST /api/strategy/studio/drafts")(
    ownerRequest("BTC/USDT 1h 突破VWAP且订单簿买盘增强时做多，止损2%，止盈2R"),
    res
  );
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, "strategy_unsupported_semantics");
  assert.deepEqual(res.body.details.unsupported.sort(), ["order_book", "vwap"]);
  assert.equal(db.strategyStudioDrafts.length, 0);
});
