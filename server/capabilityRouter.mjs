import { normalizeEvidenceSymbol } from "./evidenceBundle.mjs";

const ROLE_PACKS = Object.freeze({
  day_trader: Object.freeze({
    label: "日内",
    timeframes: Object.freeze({ context: "1h", structure: "15m", confirmation: "5m" }),
    required: Object.freeze(["closed_ohlcv", "deterministic_structure", "microstructure", "execution_cost", "account_capacity"]),
    optional: Object.freeze(["news_attribution", "token_profile", "support_resistance"])
  }),
  swing_trader: Object.freeze({
    label: "波段",
    timeframes: Object.freeze({ context: "1d", structure: "4h", confirmation: "1h" }),
    required: Object.freeze(["closed_ohlcv", "deterministic_structure", "microstructure", "funding_oi", "account_capacity"]),
    optional: Object.freeze(["macro_context", "daily_brief", "token_profile", "support_resistance"])
  })
});

const TRIGGER_PACKS = Object.freeze({
  scheduled_patrol: ["global_market", "market_scan", "events"],
  early_opportunity: ["short_window_momentum", "microstructure", "deterministic_structure"],
  fast_move: ["short_window_momentum", "microstructure", "news_attribution", "deterministic_structure"],
  watch_trigger: ["trigger_revalidation", "microstructure", "deterministic_structure"],
  news: ["source_verification", "market_reaction", "deterministic_structure"],
  manual: ["intent_specific"]
});

function normalizedRole(role, timeframe = "1h") {
  if (["day_trader", "swing_trader"].includes(role)) return role;
  return ["5m", "15m"].includes(String(timeframe).toLowerCase()) ? "day_trader" : "swing_trader";
}

export function buildCapabilityPlan(input = {}) {
  const trigger = TRIGGER_PACKS[input.trigger] ? input.trigger : "manual";
  const symbols = [...new Set((input.symbols || []).map(normalizeEvidenceSymbol).filter(Boolean))];
  return {
    version: 1,
    mode: "deterministic",
    trigger,
    symbols,
    commonRequired: ["fresh_ticker", "closed_ohlcv", "microstructure", "contract_spec", "account_facts", "global_context"],
    triggerRequired: TRIGGER_PACKS[trigger],
    rolePacks: ROLE_PACKS,
    routingPolicy: {
      shortlistBeforeDeepAnalysis: true,
      maxDeepCandidates: 3,
      parallelizeReadOnly: true,
      reuseFreshEvidence: true,
      llmMaySkipRequiredCapabilities: false,
      roleSuitabilityControlsExecution: false
    },
    createdAt: new Date().toISOString()
  };
}

export function capabilityPlanForPrompt(plan) {
  if (!plan) return null;
  const common = plan.commonRequired.join("/");
  const day = plan.rolePacks.day_trader, swing = plan.rolePacks.swing_trader;
  return [
    `触发=${plan.trigger}；候选=${plan.symbols.join("、") || "按本轮问题确定"}；公共必需=${common}`,
    `- Day Trader：${day.timeframes.context}背景 + ${day.timeframes.structure}结构 + ${day.timeframes.confirmation}确认；必需=${day.required.join("/")}`,
    `- Swing Trader：${swing.timeframes.context}背景 + ${swing.timeframes.structure}结构 + ${swing.timeframes.confirmation}确认；必需=${swing.required.join("/")}`,
    "- 路由边界：只规定证据覆盖与周期，不决定多空、不修改风险；不相关工具应跳过。"
  ].join("\n");
}

export function recordCapabilityResult(run, toolName, args = {}, result = {}) {
  if (!run || result?.error || result?.available === false) return;
  run.capabilityEvidence ||= [];
  const symbol = args.symbol ? normalizeEvidenceSymbol(args.symbol) : null;
  const base = { toolName, symbol, recordedAt: new Date().toISOString() };
  if (toolName === "analyze_market_structure") {
    run.roleSuitabilityShadow ||= {};
    run.structureFactRefs ||= {};
    run.roleSuitabilityShadow[symbol] = result.roleSuitability || null;
    run.structureFactRefs[symbol] = {
      symbol,
      version: result.version || null,
      deterministic: result.deterministic === true,
      source: result.source || null,
      analyzedAt: result.analyzedAt || base.recordedAt,
      selectedRole: result.selectedRole || null,
      bias: result.bias || null,
      quality: result.quality || null
    };
    run.capabilityEvidence.push({
      ...base,
      capability: "deterministic_structure",
      deterministic: result.deterministic === true,
      roles: Object.keys(result.roleViews || {}).filter((role) => result.roleViews[role]?.structure?.available),
      analyzedAt: result.analyzedAt || base.recordedAt,
      version: result.version || null
    });
  } else if (toolName === "get_microstructure") run.capabilityEvidence.push({ ...base, capability: "microstructure" });
  else if (toolName === "sync_market") run.capabilityEvidence.push({ ...base, capability: "closed_ohlcv", timeframe: result.timeframe || args.timeframe || "1h" });
  else if (toolName === "get_daily_market_brief") run.capabilityEvidence.push({ ...base, capability: "daily_brief" });
  else if (toolName === "get_events" || toolName === "get_market_intelligence") run.capabilityEvidence.push({ ...base, capability: "events" });
  run.capabilityEvidence = run.capabilityEvidence.slice(-80);
}

export function validateProposalCapabilityCoverage(run, args = {}, options = {}) {
  const symbol = normalizeEvidenceSymbol(args.symbol);
  const role = normalizedRole(args.traderRole, args.timeframe);
  const maxAgeMs = Number(options.maxAgeMs || process.env.STRUCTURE_ANALYSIS_MAX_AGE_MS || 5 * 60_000);
  const evidence = (run?.capabilityEvidence || []).filter((item) => item.capability === "deterministic_structure" && item.symbol === symbol);
  const matching = evidence.find((item) => item.deterministic && item.roles?.includes(role)
    && Date.now() - new Date(item.analyzedAt || item.recordedAt || 0).getTime() <= maxAgeMs);
  if (!matching) {
    const pack = ROLE_PACKS[role];
    return {
      ok: false,
      reason: "role_structure_capability_missing",
      role,
      symbol,
      missing: ["deterministic_structure"],
      instruction: `请先调用 analyze_market_structure(symbol=${symbol}, traderRole=${role})，核对 ${pack.timeframes.context}/${pack.timeframes.structure}/${pack.timeframes.confirmation} 闭合K线事实后再提交计划。`
    };
  }
  return { ok: true, role, symbol, evidence: matching };
}

export { ROLE_PACKS };
