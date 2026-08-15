const SYSTEM_INVOCATION = Symbol("kordyn.system_agent_invocation");

// 内部自主循环同样使用最小能力集；它不是 Owner，也不能借系统身份管理
// 密钥、MCP、任务、实盘总开关或授权状态。
const SYSTEM_AGENT_PERMISSIONS = Object.freeze([
  "market.read",
  "account.read",
  "risk.check",
  "knowledge.read",
  "write:trade_plan",
  "write:realtime",
  "write:review",
  "write:risk",
  "write:event",
  "write:exchange"
]);

export function systemAgentInvocation(source = "scheduler", permissions = SYSTEM_AGENT_PERMISSIONS) {
  return Object.freeze({
    [SYSTEM_INVOCATION]: true,
    principal: "system_agent",
    source: String(source || "scheduler"),
    permissions: [...new Set((permissions || []).map(String))]
  });
}

export function userAgentInvocation({ userId = null, userName = null, permissions = [] } = {}) {
  return Object.freeze({
    principal: "user",
    userId,
    userName,
    permissions: [...new Set((permissions || []).map(String))]
  });
}

export function agentInvocationPolicy(value) {
  const system = Boolean(value?.[SYSTEM_INVOCATION]);
  const permissions = new Set(value?.permissions || []);
  const delegatedExecution = permissions.has("approve:trade_plan") && permissions.has("critical:trade_execution");
  return {
    principal: system ? "system_agent" : "user",
    source: system ? value.source : "user_request",
    initiatorUserId: system ? null : value?.userId || null,
    initiatorName: system ? null : value?.userName || null,
    permissions: [...permissions],
    canAutoApproveAndExecute: system || delegatedExecution,
    effectivePrincipal: system ? "system_agent" : delegatedExecution ? "delegated_user_agent" : "user_agent_restricted"
  };
}
