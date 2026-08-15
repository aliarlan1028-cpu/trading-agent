import assert from "node:assert/strict";
import test from "node:test";

import { executeTool } from "../server/agentChat.mjs";
import { agentInvocationPolicy, systemAgentInvocation, userAgentInvocation } from "../server/agentInvocation.mjs";
import { authorizeAgentTool, filterAgentToolsForInvocation } from "../server/agentToolAuthorization.mjs";
import { enabledMcpTools } from "../server/mcpClient.mjs";
import { seedDatabase } from "../server/store.mjs";

function runWith(permissions) {
  return {
    id: "run-authz",
    role: "AI 交易员",
    steps: [],
    invocation: agentInvocationPolicy(userAgentInvocation({ userId: "actor", permissions }))
  };
}

test("write:mandate alone cannot borrow unrelated built-in Agent tools", async () => {
  const db = seedDatabase();
  db.riskIncidents = [{ id: "risk-1", status: "open", title: "keep open" }];
  const run = runWith(["write:mandate"]);
  const cases = [
    ["resolve_risk_incidents", { all: true }],
    ["create_task", { name: "unauthorized", type: "Every", schedule: "Every 1h" }],
    ["sync_exchange_account", { exchange: "OKX" }],
    ["create_skill_from_idea", { name: "x" }],
    ["register_watch", { symbol: "BTC/USDT" }],
    ["propose_trade_plan", { symbol: "BTC/USDT" }]
  ];
  for (const [name, args] of cases) {
    const result = await executeTool(db, run, name, args);
    assert.equal(result.status, 403, name);
    assert.equal(result.error, "tool_not_authorized", name);
  }
  assert.equal(db.riskIncidents[0].status, "open");
  assert.equal((db.tasks || []).some((item) => item.name === "unauthorized"), false);
});

test("authorized capabilities pass while a forged or unknown tool remains default-denied", async () => {
  const db = seedDatabase();
  db.riskIncidents = [{ id: "risk-1", status: "open", title: "resolve me" }];
  const run = runWith(["write:risk"]);
  const result = await executeTool(db, run, "resolve_risk_incidents", { all: true, note: "verified" });
  assert.equal(result.closed, 1);
  assert.equal(db.riskIncidents[0].status, "resolved");

  const forged = await executeTool(db, run, "admin_rotate_credentials", {});
  assert.equal(forged.status, 403);
  assert.equal(forged.reason, "tool_has_no_approved_capability_policy");
});

test("request_action authorization is checked against the requested operation", () => {
  const db = seedDatabase();
  const invocation = runWith(["write:mandate"]).invocation;
  assert.equal(authorizeAgentTool(db, invocation, "request_action", { type: "mandate" }).allowed, true);
  assert.equal(authorizeAgentTool(db, invocation, "request_action", { type: "set_live_gate" }).allowed, false);
  assert.equal(authorizeAgentTool(db, invocation, "request_action", { type: "approve_plan" }).allowed, false);
});

test("MCP tools require an administrator-approved per-tool capability policy", async () => {
  const db = seedDatabase();
  db.mcpServers = [{
    id: "external",
    name: "External writer",
    status: "connected",
    enabled: true,
    tools: [{ name: "write_record", description: "writes", inputSchema: { type: "object" } }],
    allowedTools: ["write_record"],
    agentPolicyApproved: true,
    agentToolPolicies: {
      write_record: { approved: true, effect: "write", requiredPermissions: ["write:mcp"] }
    }
  }];
  const toolName = "mcp__external__write_record";
  assert.equal(enabledMcpTools(db).length, 1);
  const restricted = runWith(["write:mandate"]);
  assert.equal(authorizeAgentTool(db, restricted.invocation, toolName).allowed, false);
  assert.deepEqual(filterAgentToolsForInvocation(db, restricted.invocation, enabledMcpTools(db)), []);
  const direct = await executeTool(db, restricted, toolName, { value: 1 });
  assert.equal(direct.status, 403);
  assert.equal(direct.error, "tool_not_authorized");

  const permitted = runWith(["write:mcp"]);
  assert.equal(authorizeAgentTool(db, permitted.invocation, toolName).allowed, true);
});

test("unapproved MCP tools and system Agent excess capabilities are not exposed", () => {
  const db = seedDatabase();
  db.mcpServers = [{
    id: "external",
    name: "Unapproved",
    status: "connected",
    enabled: true,
    tools: [{ name: "danger", inputSchema: { type: "object" } }],
    allowedTools: ["danger"]
  }];
  const system = agentInvocationPolicy(systemAgentInvocation("scheduler:test"));
  assert.equal(authorizeAgentTool(db, system, "create_task", {}).allowed, false);
  assert.equal(authorizeAgentTool(db, system, "request_action", { type: "set_live_gate" }).allowed, false);
  assert.equal(authorizeAgentTool(db, system, "mcp__external__danger", {}).allowed, false);
});

test("database labels cannot forge an official read-only MCP trust root", () => {
  const db = seedDatabase();
  db.mcpServers = [{
    id: "mcp_coingecko",
    name: "forged",
    source: "official",
    autoAllowAll: true,
    status: "connected",
    enabled: true,
    tools: [{ name: "write_anything", inputSchema: { type: "object" } }],
    allowedTools: ["write_anything"]
  }];
  const invocation = runWith(["market.read"]).invocation;
  assert.equal(authorizeAgentTool(db, invocation, "mcp__mcp_coingecko__write_anything").allowed, false);
});
