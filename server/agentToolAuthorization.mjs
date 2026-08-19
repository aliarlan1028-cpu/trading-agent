import { SKILL_TOOLS } from "./skillTools.mjs";
import { isMcpTool, resolveMcpAgentToolPolicy } from "./mcpClient.mjs";
import { pendingActionCapabilities, PENDING_ACTION_CAPABILITIES } from "./capabilityPolicy.mjs";

const BUILTIN_TOOL_PERMISSIONS = Object.freeze({
  sync_market: ["market.read"],
  get_microstructure: ["market.read"],
  analyze_market_structure: ["market.read"],
  get_token_profile: ["market.read"],
  get_global_market: ["market.read"],
  get_account: ["account.read"],
  get_events: ["market.read"],
  get_market_intelligence: ["market.read"],
  get_daily_market_brief: ["market.read"],
  get_event_calendar: ["market.read"],
  get_flow_snapshot: ["market.read"],
  get_source_health: ["market.read"],
  query_knowledge: ["knowledge.read"],
  run_backtest: ["knowledge.read"],
  research_strategy: ["write:review"],
  explain_market_move: ["market.read"],
  assess_abnormal_volatility: ["market.read"],
  scan_market_opportunities: ["market.read"],
  screen_by_profit_target: ["market.read", "account.read"],
  create_mandate_draft: ["write:mandate"],
  remember: ["write:knowledge"],
  explain_system: ["assistant.use"],
  create_task: ["write:task"],
  refresh_events: ["write:event"],
  sync_exchange_account: ["write:exchange"],
  query_review_lessons: ["write:review"],
  record_review_application: ["write:review"],
  propose_trade_plan: ["write:trade_plan"],
  create_skill_from_idea: ["write:review"],
  record_watch_review: ["write:realtime"],
  register_watch: ["write:realtime"],
  cancel_watch: ["write:realtime"],
  list_risk_incidents: ["risk.check"],
  resolve_risk_incidents: ["write:risk"]
});

const REQUEST_ACTION_PERMISSIONS = PENDING_ACTION_CAPABILITIES;

function normalizedPermissions(invocation) {
  return new Set((invocation?.permissions || []).map(String));
}

function hasAllPermissions(invocation, requiredPermissions) {
  const available = normalizedPermissions(invocation);
  return available.has("*") || requiredPermissions.every((permission) => available.has(permission));
}

function requestActionPolicy(args = {}, exposure = false) {
  if (!args.type && exposure) {
    return {
      alternatives: Object.values(REQUEST_ACTION_PERMISSIONS),
      requiredPermissions: []
    };
  }
  const known = REQUEST_ACTION_PERMISSIONS[String(args.type || "")] || null;
  const requiredPermissions = known ? pendingActionCapabilities(String(args.type || ""), args) : null;
  return requiredPermissions ? { requiredPermissions } : null;
}

export function agentToolPolicy(db, name, args = {}, { exposure = false } = {}) {
  const toolName = String(name || "");
  if (toolName === "request_action") return requestActionPolicy(args, exposure);

  const skill = SKILL_TOOLS.find((item) => item.toolName === toolName);
  if (skill) return { requiredPermissions: [...new Set(skill.permissions || [])], kind: "native_skill" };

  if (isMcpTool(toolName)) {
    const policy = resolveMcpAgentToolPolicy(db, toolName);
    return policy?.allowed ? { ...policy, kind: "mcp" } : null;
  }

  const requiredPermissions = BUILTIN_TOOL_PERMISSIONS[toolName];
  return requiredPermissions ? { requiredPermissions, kind: "builtin" } : null;
}

export function authorizeAgentTool(db, invocation, name, args = {}, options = {}) {
  const policy = agentToolPolicy(db, name, args, options);
  if (!policy) {
    return {
      allowed: false,
      status: 403,
      error: "tool_not_authorized",
      tool: String(name || ""),
      reason: "tool_has_no_approved_capability_policy"
    };
  }
  if (policy.alternatives) {
    const allowed = policy.alternatives.some((required) => hasAllPermissions(invocation, required));
    return allowed
      ? { allowed: true, tool: String(name || ""), requiredPermissions: [] }
      : { allowed: false, status: 403, error: "tool_not_authorized", tool: String(name || ""), reason: "missing_required_permission" };
  }
  const requiredPermissions = policy.requiredPermissions || [];
  if (!requiredPermissions.length || !hasAllPermissions(invocation, requiredPermissions)) {
    return {
      allowed: false,
      status: 403,
      error: "tool_not_authorized",
      tool: String(name || ""),
      requiredPermissions,
      reason: requiredPermissions.length ? "missing_required_permission" : "tool_has_no_approved_capability_policy"
    };
  }
  return { allowed: true, tool: String(name || ""), requiredPermissions, policy };
}

export function filterAgentToolsForInvocation(db, invocation, tools = []) {
  return tools.filter((tool) => authorizeAgentTool(db, invocation, tool.name, {}, { exposure: true }).allowed);
}
