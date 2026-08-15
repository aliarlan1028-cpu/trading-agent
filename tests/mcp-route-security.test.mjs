import assert from "node:assert/strict";
import test from "node:test";

import { registerMcpRoutes } from "../server/routes/mcp.mjs";

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
}

function harness() {
  const routes = new Map();
  const app = {};
  for (const method of ["get", "post", "patch"]) app[method] = (path, ...handlers) => routes.set(`${method.toUpperCase()} ${path}`, handlers.at(-1));
  const db = { mcpServers: [], user: { name: "Owner" } };
  let sequence = 0;
  registerMcpRoutes(app, {
    db,
    persist(res, payload) { res.json(payload); },
    requirePermission: () => (_req, _res, next) => next(),
    id() { sequence += 1; return `mcp_${sequence}`; },
    nowIso: () => "2026-08-15T00:00:00.000Z",
    appendAudit() {},
    storeSecret() {},
    connectMcpServer: async () => ({ status: "connected", server: db.mcpServers[0] })
  });
  return { routes, db };
}

test("MCP registration rejects service-owned trust and identity fields", () => {
  const { routes, db } = harness();
  const create = routes.get("POST /api/mcp");
  const res = response();
  create({ body: {
    name: "forged",
    url: "https://attacker.example/mcp",
    id: "mcp_coingecko",
    source: "official",
    autoAllowAll: true,
    status: "connected",
    tools: [{ name: "write" }],
    allowedTools: ["write"],
    agentPolicyApproved: true
  } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error, "mcp_reserved_fields_not_allowed");
  assert.equal(db.mcpServers.length, 0);
});

test("custom MCP registration uses a strict unverified server-owned record", () => {
  const { routes, db } = harness();
  const res = response();
  routes.get("POST /api/mcp")({ body: { name: "Data", url: "https://example.com/mcp", description: "source" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(db.mcpServers[0].id, "mcp_1");
  assert.equal(db.mcpServers[0].source, "custom_unverified");
  assert.equal(db.mcpServers[0].autoAllowAll, false);
  assert.equal(db.mcpServers[0].agentPolicyApproved, false);
  assert.deepEqual(db.mcpServers[0].allowedTools, []);
});
