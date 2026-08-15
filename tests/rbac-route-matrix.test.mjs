import test from "node:test";
import assert from "node:assert/strict";
import { requirePermission as realRequirePermission } from "../server/auth.mjs";
import { registerTradingDataRoutes } from "../server/routes/tradingData.mjs";
import { registerExecutionOrderRoutes } from "../server/routes/executionOrders.mjs";
import { registerTradePlanRoutes } from "../server/routes/tradePlans.mjs";
import { registerAgentRunRoutes } from "../server/routes/agentRuns.mjs";
import { registerExchangeRoutes } from "../server/routes/exchange.mjs";
import { registerSecurityConfigRoutes } from "../server/routes/securityConfig.mjs";
import { registerSystemRoutes } from "../server/routes/system.mjs";
import { registerBehaviorProfileRoutes } from "../server/routes/behaviorProfile.mjs";
import { registerAssistantRoutes } from "../server/routes/assistant.mjs";
import { registerReviewRoutes } from "../server/routes/review.mjs";
import { registerPaperRoutes } from "../server/routes/paper.mjs";
import { registerPosterRoutes } from "../server/routes/posters.mjs";
import { registerStrategyRoutes } from "../server/routes/strategy.mjs";
import { registerKnowledgeImportRoutes } from "../server/routes/knowledgeImport.mjs";
import { registerKnowledgeSkillRoutes } from "../server/routes/knowledgeSkills.mjs";
import { registerMcpRoutes } from "../server/routes/mcp.mjs";
import { registerEventSourceRoutes } from "../server/routes/eventSources.mjs";
import { registerMarketIntelligenceRoutes } from "../server/routes/marketIntelligence.mjs";
import { registerTaskRoutes } from "../server/routes/tasks.mjs";
import { registerObservabilityRoutes } from "../server/routes/observability.mjs";

function routeMatrix() {
  const routes = new Map();
  const app = {};
  for (const method of ["get", "post", "patch", "delete"]) {
    app[method] = (path, ...handlers) => routes.set(`${method.toUpperCase()} ${path}`, handlers);
  }
  const requirePermission = (permission) => {
    const middleware = (_req, _res, next) => next();
    middleware.permission = permission;
    return middleware;
  };
  const ctx = { db: {}, requirePermission };
  for (const register of [
    registerTradingDataRoutes, registerExecutionOrderRoutes, registerTradePlanRoutes, registerAgentRunRoutes,
    registerExchangeRoutes, registerSecurityConfigRoutes, registerSystemRoutes, registerBehaviorProfileRoutes,
    registerAssistantRoutes, registerReviewRoutes, registerPaperRoutes, registerPosterRoutes, registerStrategyRoutes,
    registerKnowledgeImportRoutes, registerKnowledgeSkillRoutes, registerMcpRoutes, registerEventSourceRoutes,
    registerMarketIntelligenceRoutes, registerTaskRoutes, registerObservabilityRoutes
  ]) register(app, ctx);
  return {
    permission(method, path) { return routes.get(`${method} ${path}`)?.[0]?.permission || null; },
    permissions(method, path) { return (routes.get(`${method} ${path}`) || []).map((handler) => handler.permission).filter(Boolean); }
  };
}

test("sensitive trading, configuration and paid-model routes declare explicit RBAC", () => {
  const matrix = routeMatrix();
  const expected = new Map([
    ["GET /api/positions", "account.read"], ["GET /api/orders", "account.read"], ["GET /api/fills", "account.read"],
    ["GET /api/performance", "account.read"], ["GET /api/execution-orders", "account.read"],
    ["GET /api/trade-plans", "account.read"], ["GET /api/agent/runs", "account.read"],
    ["GET /api/agent/memory", "knowledge.read"], ["GET /api/exchange/accounts", "admin:security"],
    ["GET /api/exchange/api-key-metadata", "admin:security"], ["GET /api/security/vault", "admin:security"],
    ["GET /api/config", "admin:security"], ["POST /api/system/goals", "approve:live_config"],
    ["POST /api/behavior-profile/narrative", "assistant.use"], ["POST /api/behavior-profile/adopt-discipline", "write:knowledge"],
    ["POST /api/assistant/summarize", "assistant.use"], ["POST /api/assistant/chat", "assistant.use"]
    , ["GET /api/reviews", "account.read"], ["GET /api/review/analytics", "account.read"],
    ["GET /api/paper/sessions", "account.read"], ["GET /api/posters/trades/:id", "account.read"],
    ["POST /api/posters/translate", "assistant.use"], ["GET /api/strategy/profiles", "knowledge.read"],
    ["GET /api/strategy-board", "account.read"], ["GET /api/strategy/catalog", "knowledge.read"],
    ["GET /api/strategy/products", "account.read"], ["GET /api/strategy/studio", "knowledge.read"],
    ["GET /api/strategy/products/:id", "account.read"], ["GET /api/knowledge/skills", "knowledge.read"],
    ["GET /api/knowledge/embedding-status", "knowledge.read"], ["GET /api/mcp", "admin:security"],
    ["GET /api/event-sources", "market.read"], ["GET /api/tasks", "write:task"],
    ["GET /api/job-runs", "admin:system"], ["GET /api/reconciler/reports", "account.read"],
    ["GET /api/scheduler/status", "admin:system"], ["GET /api/security/audit-chain", "admin:system"],
    ["GET /api/market-intelligence/status", "market.read"], ["GET /api/market-intelligence/facts", "market.read"],
    ["GET /api/market-intelligence/daily", "market.read"], ["GET /api/market-intelligence/calendar", "market.read"],
    ["GET /api/market-intelligence/flows", "market.read"]
  ]);
  for (const [route, permission] of expected) {
    const [method, path] = route.split(" ");
    assert.equal(matrix.permission(method, path), permission, route);
  }
  assert.deepEqual(matrix.permissions("POST", "/api/knowledge/rag-query"), ["knowledge.read", "assistant.use"]);
});

test("the default auditor role cannot read accounts/config or invoke paid assistant", () => {
  const oldAuth = process.env.AUTH_REQUIRED;
  const oldPassword = process.env.ADMIN_PASSWORD;
  process.env.AUTH_REQUIRED = "true";
  process.env.ADMIN_PASSWORD = "configured-for-test";
  const db = { roles: [{ id: "role_auditor", name: "审计员", permissions: ["audit.read", "trace.read"] }] };
  const user = { id: "auditor", role: "审计员", status: "active" };
  try {
    for (const permission of ["account.read", "admin:security", "assistant.use", "approve:live_config"]) {
      let nextCalled = false;
      const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
      realRequirePermission(permission)({ app: { locals: { db } }, user }, response, () => { nextCalled = true; });
      assert.equal(nextCalled, false, permission);
      assert.equal(response.statusCode, 403, permission);
    }
  } finally {
    if (oldAuth === undefined) delete process.env.AUTH_REQUIRED; else process.env.AUTH_REQUIRED = oldAuth;
    if (oldPassword === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = oldPassword;
  }
});
