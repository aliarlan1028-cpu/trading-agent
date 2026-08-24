const asArray = (value) => Array.isArray(value) ? value : [];

const finitePositive = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

export const CONFIGURATION_DESTINATIONS = Object.freeze({
  trading: "systemSettings:trading",
  risk: "systemSettings:risk",
  exchange: "systemSettings:exchange",
  eventSources: "systemSettings:event-sources",
  notifications: "systemSettings:notifications",
  models: "systemSettings:models",
  agents: "systemSettings:agents",
  security: "systemSettings:base:security",
  operations: "operationsCenter",
  audit: "auditSystem"
});

const recoveryRoute = (item = {}) => {
  const code = String(item.code || "").toLowerCase();
  const copy = `${item.label || ""} ${item.detail || ""} ${item.recovery || ""}`.toLowerCase();
  const source = `${code} ${copy}`;
  if (/model|llm|provider|模型/.test(source)) return CONFIGURATION_DESTINATIONS.models;
  if (/mandate|permission|acknowledg|live.trad|授权|权限|实盘风险/.test(source)) return CONFIGURATION_DESTINATIONS.trading;
  if (/exchange|okx|websocket|account.sync|position|withdraw|credential|交易所|账户同步|提币|凭证/.test(source)) return CONFIGURATION_DESTINATIONS.exchange;
  if (/event.source|calendar.source|事件源/.test(source)) return CONFIGURATION_DESTINATIONS.eventSources;
  if (/risk.rule|threshold|风险规则|阈值/.test(source)) return CONFIGURATION_DESTINATIONS.risk;
  if (/audit|审计/.test(source)) return CONFIGURATION_DESTINATIONS.audit;
  if (/reconcil|settlement|outbox|对账|结算/.test(source)) return CONFIGURATION_DESTINATIONS.operations;
  return CONFIGURATION_DESTINATIONS.operations;
};

export function resolveControlRecoveryRoute(item) {
  return recoveryRoute(item);
}

function activeMandateOf(data) {
  return data?.agentStatus?.activeMandate
    || asArray(data?.mandates).find((item) => ["active", "running"].includes(String(item?.status || "").toLowerCase()))
    || asArray(data?.mandates)[0]
    || {};
}

function maxLeverageOf(mandate) {
  const direct = mandate.maxLeverage ?? mandate.max_leverage;
  const bySymbol = Object.values(mandate.maxLeverageBySymbol || {}).map(Number).filter(Number.isFinite);
  return finitePositive(direct) ?? (bySymbol.length ? Math.max(...bySymbol) : null);
}

function readinessCheck(data, key) {
  return asArray(data?.readiness?.checks).find((item) => item.key === key) || null;
}

export function buildControlConfigurationView(data = {}) {
  const mandate = activeMandateOf(data);
  const automation = data.automationState || {};
  const live = data.config?.liveTrading || {};
  const system = data.system || {};
  const capacity = data.tradingCapacity || {};
  const requestedMode = automation.requestedMode
    || automation.selectedMode
    || system.requestedOperatingMode
    || (automation.mode === "full_auto_small" ? "full_auto" : automation.mode === "semi_auto" ? "semi_auto" : "observe");
  const mode = automation.mode || (system.killSwitch ? "halted" : requestedMode === "full_auto" ? "full_auto_small" : requestedMode);
  const targetIsEffective = (requestedMode === "full_auto" && mode === "full_auto_small")
    || (requestedMode === "semi_auto" && mode === "semi_auto")
    || (requestedMode === "observe" && mode === "observe");
  const blockers = (asArray(automation.blockerDetails).length
    ? asArray(automation.blockerDetails)
    : asArray(automation.blockers).map((label) => ({ label })))
    .map((item) => typeof item === "string" ? { label: item } : item)
    .map((item, index) => ({
      id: item.code || `blocker-${index}`,
      code: item.code || "",
      label: item.label || item.detail || "",
      detail: item.detail || "",
      recovery: item.recovery || "",
      route: recoveryRoute(item)
    }));

  const permissionLimit = finitePositive(mandate.maxOrderNotionalUsdt ?? mandate.max_notional_usdt);
  const liveLimit = requestedMode === "observe" ? null : finitePositive(live.maxNotionalUsdt);
  const capacityLimit = capacity.freshForExecution ? finitePositive(capacity.maxNotional) : null;
  const effectiveCandidates = [permissionLimit, liveLimit, capacityLimit].filter(Number.isFinite);
  const effectiveOrderLimit = effectiveCandidates.length ? Math.min(...effectiveCandidates) : null;

  const checks = [
    {
      id: "mandate",
      label: "交易权限已生效",
      labelEn: "Trading permissions active",
      ok: Boolean(mandate.id),
      route: CONFIGURATION_DESTINATIONS.trading
    },
    {
      id: "account",
      label: "OKX 账户已同步",
      labelEn: "OKX account synced",
      ok: readinessCheck(data, "private_rest_positions")?.configured === true,
      route: CONFIGURATION_DESTINATIONS.exchange
    },
    {
      id: "withdrawal",
      label: "API 禁止提现",
      labelEn: "API withdrawal disabled",
      ok: readinessCheck(data, "withdraw_permission_detection")?.configured === true,
      route: CONFIGURATION_DESTINATIONS.exchange
    },
    {
      id: "audit",
      label: "审计记录链完整",
      labelEn: "Audit chain healthy",
      ok: readinessCheck(data, "audit_chain")?.configured === true,
      route: CONFIGURATION_DESTINATIONS.audit
    },
    {
      id: "emergency",
      label: "紧急停止未触发",
      labelEn: "Emergency stop clear",
      ok: system.killSwitch !== true,
      route: "riskCenter"
    }
  ];

  const eventWindows = asArray(data.eventRiskWindows);
  const riskRules = asArray(data.riskRules);
  const incidents = asArray(data.riskIncidents);
  const openIncidents = incidents.filter((item) => item.status === "open");
  const enabledRules = riskRules.filter((item) => item.enabled !== false);

  return {
    runtime: {
      mode,
      requestedMode,
      targetIsEffective,
      blockers,
      runtimeStatus: automation.runtimeStatus || (system.killSwitch ? "emergency_stopped" : targetIsEffective ? "normal" : "opening_paused"),
      resumesAutomatically: automation.resumesAutomatically !== false && !system.killSwitch
    },
    mandate: {
      id: mandate.id || "",
      version: mandate.version || 1,
      status: mandate.status || "",
      allowedSymbols: asArray(mandate.allowedSymbols),
      maxLeverage: maxLeverageOf(mandate),
      perTradeRiskPct: mandate.maxSingleTradeRiskPct ?? null,
      dailyLossPct: mandate.maxDailyLossPct ?? null,
      weeklyLossPct: mandate.maxWeeklyLossPct ?? mandate.max_weekly_loss_pct ?? null,
      maxOrderNotionalUsdt: permissionLimit,
      maxSymbolNotionalUsdt: finitePositive(mandate.maxSymbolNotionalUsdt),
      maxPortfolioNotionalUsdt: finitePositive(mandate.maxPortfolioNotionalUsdt),
      validUntil: mandate.validUntil || mandate.valid_until || mandate.expiresAt || null,
      effectiveOrderLimitUsdt: effectiveOrderLimit
    },
    checks,
    checksPassed: checks.filter((item) => item.ok).length,
    rules: {
      total: riskRules.length,
      enabled: enabledRules.length,
      disabled: riskRules.length - enabledRules.length,
      recentHits: asArray(data.riskChecks).slice(0, 8)
    },
    events: {
      total: eventWindows.length,
      blocking: eventWindows.filter((item) => item.blocking).length,
      windows: eventWindows
    },
    incidents: {
      total: incidents.length,
      open: openIncidents.length,
      items: openIncidents
    },
    destinations: CONFIGURATION_DESTINATIONS
  };
}
