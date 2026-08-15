import test from "node:test";
import assert from "node:assert/strict";
import { agentInvocationPolicy, systemAgentInvocation, userAgentInvocation } from "../server/agentInvocation.mjs";

test("a trading user cannot borrow the system agent auto-execution principal", () => {
  const trader = userAgentInvocation({
    userId: "trader-1",
    permissions: ["write:mandate", "write:trade_plan"]
  });
  const policy = agentInvocationPolicy(trader);
  assert.equal(policy.principal, "user");
  assert.equal(policy.effectivePrincipal, "user_agent_restricted");
  assert.equal(policy.canAutoApproveAndExecute, false);
});

test("only an unforgeable internal invocation or a fully delegated user may auto execute", () => {
  const scheduler = agentInvocationPolicy(systemAgentInvocation("scheduler:test"));
  assert.equal(scheduler.principal, "system_agent");
  assert.equal(scheduler.canAutoApproveAndExecute, true);

  const delegated = agentInvocationPolicy(userAgentInvocation({
    userId: "owner",
    permissions: ["approve:trade_plan", "critical:trade_execution"]
  }));
  assert.equal(delegated.effectivePrincipal, "delegated_user_agent");
  assert.equal(delegated.canAutoApproveAndExecute, true);

  // JSON/user payload cannot reproduce the module-private Symbol capability.
  const forged = agentInvocationPolicy({ principal: "system_agent", source: "scheduler", permissions: [] });
  assert.equal(forged.principal, "user");
  assert.equal(forged.canAutoApproveAndExecute, false);
});
