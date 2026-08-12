import assert from "node:assert/strict";
import test from "node:test";
import { registerRiskRoutes } from "../server/routes/risk.mjs";
import { validateConditionSpec, validateDynamicRiskAction } from "../server/dynamicRiskRules.mjs";

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
}

function harness(rules = []) {
  const routes = new Map();
  const app = {};
  for (const method of ["get", "post", "patch", "delete"]) {
    app[method] = (path, ...handlers) => routes.set(`${method.toUpperCase()} ${path}`, handlers.at(-1));
  }
  const db = { user: { name: "Owner" }, system: {}, riskRules: rules, riskChecks: [], riskIncidents: [], positions: [], executionOrders: [], auditLogs: [], traces: [] };
  registerRiskRoutes(app, {
    db,
    persist(res, payload) { res.payload = payload; },
    requirePermission: () => (_req, _res, next) => next(),
    id: () => "risk_new",
    nowIso: () => "2026-08-13T00:00:00.000Z",
    appendAudit() {}, appendTrace() {}, evaluateTradePlan: () => ({}), userHasPermission: () => true,
    closeExecution: async () => ({}), notifyLark() {}, validateConditionSpec, validateDynamicRiskAction
  });
  return { routes, db };
}

test("新增风控规则必须有名称、受支持动作和可执行条件", () => {
  const { routes, db } = harness();
  const create = routes.get("POST /api/risk/rules");
  let res = response();
  create({ user: { name: "Owner" }, body: { name: "", action: "notify", conditionSpec: { field: "market.fundingRate", operator: "abs_gt", value: 0.1 } } }, res);
  assert.equal(res.statusCode, 400);
  res = response();
  create({ user: { name: "Owner" }, body: { name: "funding", action: "kill_switch", conditionSpec: { field: "market.fundingRate", operator: "abs_gt", value: 0.1 } } }, res);
  assert.equal(res.statusCode, 400);
  res = response();
  create({ user: { name: "Owner" }, body: { name: "funding", action: "reject_entry", conditionSpec: { field: "market.fundingRate", operator: "abs_gt", value: 0.1 } } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(db.riskRules[0].enforcementStatus, "entry_enforced");
});

test("系统内置风控规则不能从规则面板修改或停用", () => {
  const systemRule = { id: "risk_stop_required", name: "stop required", enabled: true, systemManaged: true, action: "reject_entry" };
  const { routes } = harness([systemRule]);
  const res = response();
  routes.get("PATCH /api/risk/rules/:id")({ params: { id: systemRule.id }, body: { enabled: false } }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(systemRule.enabled, true);
});
