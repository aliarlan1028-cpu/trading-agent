import { id, nowIso } from "./store.mjs";

export function runExpertAnalysis(db, payload = {}) {
  const symbol = payload.market_context?.symbol || payload.symbol || db.markets?.find((market) => market.price)?.symbol || "";
  const subject = symbol || "未指定交易对";
  const question = payload.question || `${subject} 当前是否允许自主交易？`;
  const highImpactEvents = (db.events || []).filter((event) => symbol && event.relatedSymbols?.includes(symbol) && event.impact >= 80);
  const rules = (db.knowledge?.ruleProposals || []).filter((rule) => rule.status === "已批准");
  const concepts = (db.knowledge?.conceptCards || []).slice(0, 3);

  const bundle = {
    id: id("ab"),
    triggerType: payload.trigger_type || "user_question",
    question,
    summary: !symbol
      ? "尚未指定交易对，不能生成交易方向或价格计划。"
      : highImpactEvents.length > 0
        ? `${symbol} 当前受高影响事件约束，建议只允许低风险计划或等待事件落地后重评。`
        : `${symbol} 尚未发现已导入知识规则形成的阻断条件，仍需真实行情、账户与风控检查确认。`,
    tradingImplication: highImpactEvents.length > 0 ? "allow_small_position" : "normal_precheck",
    expertViews: [
      { domain: "宏观", view: highImpactEvents[0] ? `${highImpactEvents[0].title} 临近，跳跃风险上升。` : "暂无真实事件卡形成阻断。", confidence: symbol ? 0.76 : 0 },
      { domain: "市场结构", view: "趋势信号需要与真实行情、资金费率、OI、订单簿深度共同确认。", confidence: symbol ? 0.73 : 0 },
      { domain: "风控", view: "真实交易必须带止损，并满足 Mandate 与日亏损额度约束。", confidence: 0.91 },
      { domain: "反方质疑", view: "缺少真实数据时不能生成可执行交易结论。", confidence: 0.82 }
    ],
    rulesTriggered: rules.map((rule) => ({ ruleId: rule.id, name: rule.name, level: rule.level, action: rule.action })),
    citations: concepts.map((concept) => concept.id),
    createdAt: nowIso()
  };

  db.analysisBundles.unshift(bundle);
  return bundle;
}

export function importKnowledgeSource(db, payload = {}) {
  const source = {
    id: id("src"),
    title: payload.title || "新导入资料",
    type: payload.type || "手动笔记",
    permission: payload.permission || "仅个人使用",
    status: "待解析",
    trustScore: Number(payload.trustScore || 70),
    domain: payload.domain || "综合",
    importedAt: nowIso()
  };
  db.knowledge.sources.unshift(source);
  return source;
}
