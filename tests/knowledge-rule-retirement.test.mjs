import test from "node:test";
import assert from "node:assert/strict";
import { registerKnowledgeRuleRoutes } from "../server/routes/knowledgeRules.mjs";

function harness() {
  const routes = new Map();
  const app = {
    post(path, ...handlers) { routes.set(`POST ${path}`, handlers.at(-1)); },
    delete(path, ...handlers) { routes.set(`DELETE ${path}`, handlers.at(-1)); }
  };
  const db = {
    user: { id: "owner", name: "Owner", role: "管理员" },
    roles: [
      { id: "role_admin", name: "管理员", permissions: ["*"] },
      { id: "role_trader", name: "交易用户", permissions: ["knowledge.read", "write:knowledge"] },
      { id: "role_approver", name: "风控审批员", permissions: ["knowledge.read", "approve:knowledge_skill"] }
    ],
    knowledge: { conceptCards: [], theoryFrameworks: [], ruleProposals: [{ id: "rule_1", name: "Loss cap", status: "已批准", createdByUserId: "writer" }] },
    riskRules: [{ id: "risk_from_rule_1", name: "Loss cap", enabled: true }]
  };
  registerKnowledgeRuleRoutes(app, {
    db,
    persist(res, payload) { res.payload = payload; return payload; },
    saveDb() {}, requirePermission() { return (_req, _res, next) => next(); },
    id: () => "id_new", nowIso: () => "2026-08-15T00:00:00.000Z", appendAudit() {}, appendTrace() {},
    compileNaturalRiskCondition: () => null, validateConditionSpec: () => ({ valid: false }), validateDynamicRiskAction: () => true,
    consolidateRuleProposals: async () => ({}), broadcastRaw() {}, runExpertAnalysis: () => ({})
  });
  return { db, routes };
}

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
}

test("a knowledge writer cannot delete an approved hard rule", () => {
  const { db, routes } = harness();
  const res = response();
  routes.get("DELETE /api/knowledge/rules/:id")({ params: { id: "rule_1" }, user: { id: "writer", name: "Writer", role: "交易用户", status: "active" } }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(db.knowledge.ruleProposals[0].status, "已批准");
  assert.equal(db.riskRules[0].enabled, true);
});

test("an independent approver retires rather than deletes the approved rule", () => {
  const { db, routes } = harness();
  const res = response();
  routes.get("DELETE /api/knowledge/rules/:id")({ params: { id: "rule_1" }, user: { id: "approver", name: "Approver", role: "风控审批员", status: "active" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(db.knowledge.ruleProposals.length, 1);
  assert.equal(db.knowledge.ruleProposals[0].status, "已退役");
  assert.equal(db.riskRules[0].enabled, false);
  assert.equal(db.riskRules[0].retiredBy, "Approver");
});
