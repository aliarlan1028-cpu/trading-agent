function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function freshAt(value, asOfMs, ttlMs) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) && time > 0 && time <= asOfMs && asOfMs - time <= ttlMs;
}

export function buildMacroRegimeContext(db, options = {}) {
  const asOf = options.asOf || new Date().toISOString();
  const asOfMs = new Date(asOf).getTime();
  const global = db.marketRegime?.global || null;
  const facts = [];
  const inferences = [];
  const unknowns = [];
  const scenarios = [];

  if (global && freshAt(global.fetchedAt, asOfMs, 10 * 60_000)) {
    facts.push({
      dimension: "crypto_risk_appetite",
      source: "OKX public market",
      asOf: global.fetchedAt,
      values: {
        breadthPct: finite(global.breadthPct),
        medianChangePct: finite(global.medianChangePct),
        btcChangePct: finite(global.btcChangePct)
      }
    });
    const bias = global.bias === "risk_on" ? "偏强" : global.bias === "risk_off" ? "偏弱" : global.bias === "mixed" ? "分化" : "未知";
    inferences.push({ dimension: "crypto_risk_appetite", label: bias, basis: "OKX 永续市场广度与24小时涨跌中位数", confidence: 0.72 });
  } else {
    unknowns.push("OKX 全市场风险偏好数据缺失或超过10分钟");
  }

  const macroFacts = (db.marketIntelligenceFacts || []).filter((fact) => {
    const dimension = String(fact.values?.macroDimension || "").toLowerCase();
    const published = new Date(fact.publishedAt || 0).getTime();
    return ["policy", "inflation", "growth", "liquidity"].includes(dimension)
      && published <= asOfMs
      && asOfMs - published <= 45 * 86_400_000
      && fact.values?.actual !== undefined;
  });
  const latestByDimension = new Map();
  for (const fact of macroFacts.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))) {
    const dimension = String(fact.values.macroDimension).toLowerCase();
    if (!latestByDimension.has(dimension)) latestByDimension.set(dimension, fact);
  }
  for (const dimension of ["policy", "inflation", "growth", "liquidity"]) {
    const fact = latestByDimension.get(dimension);
    if (fact) {
      facts.push({ dimension, source: fact.sourceName, asOf: fact.publishedAt, factId: fact.id, values: fact.values });
    } else {
      unknowns.push(`${dimension} 的最新实际值/前值/预期尚无可验证结构化数据`);
    }
  }

  const upcomingEvents = options.upcomingEvents || [];
  for (const event of upcomingEvents.slice(0, 6)) {
    const hours = (new Date(event.due).getTime() - asOfMs) / 3_600_000;
    if (hours >= 0 && hours <= 24 && event.importance === "high") {
      scenarios.push({
        type: "scheduled_event_risk",
        eventId: event.id,
        title: event.title,
        due: event.due,
        implication: "公布前降低对单一路径的确信；公布后必须用新行情与实际值重新判断。"
      });
    }
  }

  const macroDimensions = ["policy", "inflation", "growth", "liquidity"];
  const coverage = macroDimensions.filter((dimension) => latestByDimension.has(dimension)).length;
  const phaseResolved = coverage >= 3;
  const confidence = Number(Math.min(phaseResolved ? 0.75 : 0.45, (facts.length / 5) * 0.75).toFixed(2));
  return {
    asOf,
    role: "analysis_context_only",
    mayTriggerTradeDirectly: false,
    economicCyclePhase: phaseResolved ? "requires_model_synthesis" : "insufficient_verified_macro_data",
    cryptoRiskAppetite: inferences.find((item) => item.dimension === "crypto_risk_appetite")?.label || "未知",
    confidence,
    facts,
    inferences,
    unknowns,
    scenarios,
    guardrail: "宏观环境只能调整情景、仓位审慎度和事件准备，不能代替交易对结构、入场确认与硬风控。"
  };
}

export function macroRegimeForPrompt(context) {
  if (!context) return null;
  const lines = [
    `截至 ${context.asOf}；加密风险偏好=${context.cryptoRiskAppetite}；宏观周期=${context.economicCyclePhase}；置信度=${Math.round(context.confidence * 100)}%`,
    ...context.facts.filter((item) => item.dimension !== "crypto_risk_appetite").slice(0, 4).map((item) => `- 事实[${item.factId || item.source}] ${item.dimension}：${JSON.stringify(item.values).slice(0, 260)}（${item.asOf}）`),
    ...context.inferences.map((item) => `- 推断：${item.dimension}=${item.label}（依据：${item.basis}）`),
    ...context.unknowns.slice(0, 4).map((item) => `- 未知：${item}`),
    ...context.scenarios.slice(0, 3).map((item) => `- 事件情景：${item.title} ${item.due}；${item.implication}`),
    `- 边界：${context.guardrail}`
  ];
  return lines.join("\n");
}
