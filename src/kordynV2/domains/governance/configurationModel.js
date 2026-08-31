import { buildControlConfigurationView } from "../../../controlConfigurationView.js";

const unavailable = "Unavailable";
const list = (value) => Array.isArray(value) ? value : [];
const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const valueOrUnavailable = (value) => value === null || value === undefined || value === "" ? unavailable : value;

export const GOVERNANCE_CONFIGURATION_SCOPES = Object.freeze([
  Object.freeze({ id: "operating-mode", group: "trading", label: "运行模式", capabilityId: "configuration.operating-mode" }),
  Object.freeze({ id: "mandate", group: "trading", label: "交易授权", capabilityId: "configuration.mandate" }),
  Object.freeze({ id: "risk-rules", group: "risk", label: "风险规则", capabilityId: "configuration.risk-rules" }),
  Object.freeze({ id: "environment", group: "environment", label: "环境", capabilityId: "configuration.environment" }),
  Object.freeze({ id: "network", group: "network", label: "网络", capabilityId: "configuration.network" }),
  Object.freeze({ id: "backup", group: "backup", label: "备份", capabilityId: "configuration.backup" }),
  Object.freeze({ id: "security", group: "security", label: "安全", capabilityId: "configuration.security" }),
  Object.freeze({ id: "exchange", group: "exchange", label: "交易所", capabilityId: "configuration.exchange" }),
  Object.freeze({ id: "event-sources", group: "event-sources", label: "事件源", capabilityId: "configuration.event-sources" }),
  Object.freeze({ id: "notifications", group: "notifications", label: "通知", capabilityId: "configuration.notifications" }),
  Object.freeze({ id: "models", group: "models", label: "模型与密钥", capabilityId: "configuration.models" }),
  Object.freeze({ id: "agents", group: "agents", label: "AI 交易员", capabilityId: "configuration.agents" }),
  Object.freeze({ id: "users", group: "users", label: "用户与权限", capabilityId: "configuration.users" }),
  Object.freeze({ id: "subscriptions", group: "users", label: "订阅", capabilityId: "configuration.subscriptions" }),
  Object.freeze({ id: "account-profile", group: "account", label: "账户资料", capabilityId: "configuration.account-profile" })
]);

function loadedKind(data, section, collections = []) {
  const explicit = data.resourceState?.[section];
  if (explicit && explicit !== "loaded" && explicit !== "ready") return String(explicit);
  if (explicit) return "ready";
  return collections.some((key) => Array.isArray(data[key]) || (data[key] && typeof data[key] === "object")) ? "ready" : "not_loaded";
}

export function buildConfigurationModel(input = {}) {
  const data = record(input);
  let control = {};
  try { control = buildControlConfigurationView(data); } catch { control = {}; }
  const system = record(data.system);
  const automation = record(data.automationState);
  const config = record(data.config);
  const live = record(config.liveTrading);
  const mandate = record(data.agentStatus?.activeMandate) || {};
  const activeMandate = Object.keys(mandate).length
    ? mandate
    : record(list(data.mandates).find((row) => ["active", "running"].includes(String(row?.status || "").toLowerCase())) || list(data.mandates)[0]);
  const selectedMode = valueOrUnavailable(system.executionMode ?? automation.requestedMode ?? automation.selectedMode ?? control.runtime?.requestedMode);
  const effectiveMode = valueOrUnavailable(system.effectiveMode ?? automation.effectiveMode ?? automation.mode ?? control.runtime?.mode);
  const auditKind = loadedKind(data, "operationsCenter", ["auditLogs"]);
  const auditRows = auditKind === "ready" ? list(data.auditLogs) : [];

  return {
    scopes: GOVERNANCE_CONFIGURATION_SCOPES,
    trading: {
      mode: { selected: selectedMode, effective: effectiveMode },
      maxNotionalUsdt: {
        selected: valueOrUnavailable(live.maxNotionalUsdt),
        effective: valueOrUnavailable(activeMandate.maxOrderNotionalUsdt ?? activeMandate.max_notional_usdt ?? control.mandate?.effectiveOrderLimitUsdt)
      },
      mandate: activeMandate,
      selected: live,
      effective: record(control.mandate)
    },
    risk: { rules: list(data.riskRules), checks: list(data.riskChecks) },
    environment: record(config.environment),
    network: record(config.network ?? config.proxy),
    backup: record(data.backupStatus ?? config.backup),
    security: record(data.security ?? config.security),
    exchange: { accounts: list(data.exchangeAccounts), keys: list(data.exchangeApiKeyMetadata) },
    eventSources: list(data.eventSources),
    notifications: record(data.integrations ?? config.notifications),
    models: { providers: list(data.llmModels), selected: record(config.models ?? config.llm) },
    agents: list(data.agentProfiles),
    users: list(data.users),
    subscriptions: list(data.subscriptions),
    account: record(data.user),
    permission: {
      owner: data.user?.isOwner === true,
      role: valueOrUnavailable(data.user?.role ?? data.user?.roleId),
      canEdit: data.user?.isOwner === true
    },
    audit: {
      kind: auditKind,
      total: auditKind === "ready" ? auditRows.length : unavailable,
      latest: auditRows[0] || null
    }
  };
}

