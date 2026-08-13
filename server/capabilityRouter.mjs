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
  const focusSymbols = [...new Set((input.focusSymbols || symbols).map(normalizeEvidenceSymbol).filter(Boolean))];
  return {
    version: 1,
    mode: "deterministic",
    trigger,
    symbols,
    focusSymbols,
    marketAnalysis: input.marketAnalysis === true,
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

function addCall(calls, available, name, args = {}, reason = "") {
  const key = `${name}:${normalizeEvidenceSymbol(args.symbol || "")}:${JSON.stringify(args.symbols || [])}`;
  if (!calls.some((item) => item.key === key)) calls.push({ key, name, args, reason, available: available.has(name) });
}

// “充分使用能力”不等于把整个目录每轮全跑一遍。这里按触发场景确定必须使用的
// 最小能力集合，并在 LLM 开始前由系统执行，避免模型看见工具却偶发忘记调用。
export function requiredCapabilityCalls(plan, availableToolNames = []) {
  if (!plan) return [];
  const available = new Set(availableToolNames);
  const calls = [];
  const allSymbols = plan.symbols.slice(0, 8);
  const focusSymbols = (plan.focusSymbols.length ? plan.focusSymbols : allSymbols).slice(0, 4);
  const deepSymbols = plan.trigger === "scheduled_patrol" ? allSymbols : focusSymbols;
  const needsMarketAnalysis = plan.trigger !== "manual" || plan.marketAnalysis;
  if (!needsMarketAnalysis) return [];

  if (["scheduled_patrol", "manual"].includes(plan.trigger)) {
    addCall(calls, available, "get_global_market", {}, "大盘环境");
  }
  if (plan.trigger === "scheduled_patrol") {
    addCall(calls, available, "scan_market_opportunities", { limit: 8, direction: "both", minQuoteVolUsdt: 5_000_000 }, "全市场机会漏斗");
  }
  if (plan.trigger === "news") {
    addCall(calls, available, "get_market_intelligence", { symbols: focusSymbols, horizonHours: 48, limit: 30 }, "核验信息面");
    addCall(calls, available, "get_event_calendar", { importance: "high" }, "核验高影响日程");
  }
  for (const symbol of deepSymbols) {
    addCall(calls, available, "analyze_market_structure", { symbol }, "确定性多周期结构");
    addCall(calls, available, "get_microstructure", { symbol, exchange: "OKX" }, "微观结构与聪明钱");
    if (["watch_trigger", "early_opportunity", "fast_move", "manual"].includes(plan.trigger)) {
      addCall(calls, available, "support_resistance_levels", { symbol, timeframe: "4h" }, "关键支撑阻力");
    }
    if (plan.trigger === "fast_move") {
      addCall(calls, available, "assess_abnormal_volatility", { symbol, thresholdPct: 5 }, "异常波动确认");
      addCall(calls, available, "explain_market_move", { symbol }, "异动原因归因");
    }
  }
  if (plan.trigger === "scheduled_patrol") {
    addCall(calls, available, "funding_extremes_scanner", { symbols: allSymbols }, "白名单拥挤度横向扫描");
    addCall(calls, available, "relative_strength", { symbols: allSymbols, days: 14 }, "白名单相对强弱排序");
  }
  return calls.map(({ key: _key, ...call }) => call);
}

function successfulTrace(trace = {}) {
  return !/^(?:失败|阻断|拒绝)[:：]|不可用|未完成|error|failed|blocked/i.test(String(trace.summary || ""));
}

export function auditRequiredCapabilityCoverage(requiredCalls = [], toolTrace = []) {
  const covered = [], missing = [];
  for (const required of requiredCalls) {
    const wantedSymbol = normalizeEvidenceSymbol(required.args?.symbol || "");
    const trace = toolTrace.find((item) => item.name === required.name
      && (!wantedSymbol || normalizeEvidenceSymbol(item.args?.symbol || "") === wantedSymbol)
      && successfulTrace(item));
    (trace ? covered : missing).push({ name: required.name, symbol: wantedSymbol || null, reason: required.reason, unavailable: required.available === false });
  }
  return {
    ok: missing.length === 0,
    required: requiredCalls.length,
    covered: covered.length,
    missing,
    checkedAt: new Date().toISOString()
  };
}

export function capabilityPlanForPrompt(plan) {
  if (!plan) return null;
  const common = plan.commonRequired.join("/");
  const day = plan.rolePacks.day_trader, swing = plan.rolePacks.swing_trader;
  const preflight = plan.preflightCoverage
    ? `- 系统预执行覆盖：${plan.preflightCoverage.covered}/${plan.preflightCoverage.required}${plan.preflightCoverage.ok ? "，必需能力已完成" : `，缺失=${plan.preflightCoverage.missing.map((item) => `${item.name}${item.symbol ? `(${item.symbol})` : ""}`).join("/")}`}`
    : "- 系统预执行覆盖：尚未检查";
  const summaries = plan.preflightSummaries?.length
    ? `- 已完成结果（直接用于本轮判断，不要无意义重复调用）：\n${plan.preflightSummaries.map((item) => `  - ${item.name}${item.symbol ? `(${item.symbol})` : ""}：${item.summary}`).join("\n")}`
    : "";
  return [
    `触发=${plan.trigger}；候选=${plan.symbols.join("、") || "按本轮问题确定"}；公共必需=${common}`,
    `- Day Trader：${day.timeframes.context}背景 + ${day.timeframes.structure}结构 + ${day.timeframes.confirmation}确认；必需=${day.required.join("/")}`,
    `- Swing Trader：${swing.timeframes.context}背景 + ${swing.timeframes.structure}结构 + ${swing.timeframes.confirmation}确认；必需=${swing.required.join("/")}`,
    preflight,
    summaries,
    "- 路由边界：只规定证据覆盖与周期，不决定多空、不修改风险；不相关工具应跳过。"
  ].filter(Boolean).join("\n");
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
    // 给聊天展示层保存一份小型、确定性的多周期快照。它来自闭合 K 线计算，
    // 不从 LLM 正文反向猜状态；只保留 15m/1h/4h 所需字段，避免把完整 K 线塞进消息。
    run.presentationFacts ||= {};
    run.presentationFacts.structures ||= {};
    run.presentationFacts.structures[symbol] = {
      symbol,
      analyzedAt: result.analyzedAt || base.recordedAt,
      selectedRole: result.selectedRole || null,
      bias: result.bias || null,
      quality: result.quality || null,
      frames: Object.fromEntries(["15m", "1h", "4h"].map((timeframe) => {
        const frame = result.frames?.[timeframe];
        return [timeframe, frame?.available ? {
          available: true,
          timeframe,
          lastClosedAt: frame.lastClosedAt || null,
          trend: frame.trend || null,
          phase: frame.phase || null,
          latestEvent: frame.latestEvent ? {
            kind: frame.latestEvent.kind || null,
            direction: frame.latestEvent.direction || null,
            level: frame.latestEvent.level ?? null
          } : null,
          volume: frame.volume ? { state: frame.volume.state || null } : null
        } : { available: false, timeframe, reason: frame?.reason || "unavailable" }];
      }))
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
