import { retrieveChunks } from "./knowledgePipeline.mjs";
import { selectActiveKnowledgeSkills } from "./knowledgeSkills.mjs";
import { id, nowIso } from "./store.mjs";
import { canUseKnowledgeRow, normalizeKnowledgePrincipal } from "./knowledgeScope.mjs";

// 真实证据包：从主人导入的知识库检索相关片段，结合已批准规则与事件，
// 生成有引用、可追溯的分析包（不再返回写死的模板结论）。
export function runExpertAnalysis(db, payload = {}) {
  const principal = normalizeKnowledgePrincipal(payload.principal || {});
  if (!principal.tenantId || !principal.userId) throw new Error("knowledge_analysis_explicit_principal_required");
  const usableKnowledge = (row) => canUseKnowledgeRow(row, principal);
  const symbol = payload.market_context?.symbol || payload.symbol || db.markets?.find((market) => market.price)?.symbol || "";
  const subject = symbol || "未指定交易对";
  const question = payload.question || `${subject} 当前是否允许自主交易？`;
  const highImpactEvents = (db.events || []).filter((event) => symbol && event.relatedSymbols?.includes(symbol) && event.impact >= 80);
  const rules = (db.knowledge?.ruleProposals || []).filter((rule) => usableKnowledge(rule) && rule.status === "已批准");
  const eligibleSkills = selectActiveKnowledgeSkills(db, {
    symbol,
    direction: payload.direction,
    timeframe: payload.timeframe,
    regime: payload.market_context?.regime || db.marketRegime?.regime || ""
  }, { principal });

  // 用问题 + 交易对做知识检索，作为决策依据。
  // 异步语义检索的调用方可通过 payload.retrieved 预先传入；否则同步词频检索。
  const retrieved = Array.isArray(payload.retrieved)
    ? payload.retrieved.filter(usableKnowledge)
    : retrieveChunks(db, `${question} ${symbol}`, 5, { chunks: (db.knowledge?.chunks || []).filter(usableKnowledge) });
  const knowledgeAvailable = (db.knowledge?.chunks || []).some(usableKnowledge);

  const knowledgeView = retrieved.length
    ? { domain: "知识库", view: `召回 ${retrieved.length} 段专业知识：${retrieved.map((chunk) => chunk.citationLocator).join("；")}。`, confidence: Number(Math.min(0.95, 0.5 + retrieved[0].score / 2).toFixed(2)) }
    : { domain: "知识库", view: knowledgeAvailable ? "本问题未在知识库召回强相关片段，依赖行情与风控判断。" : "主人尚未导入金融/交易知识，无法提供知识依据。", confidence: 0 };

  const evidenceSummary = retrieved.length
    ? `结合知识库 ${retrieved.length} 段依据（${retrieved.map((chunk, i) => `[[${i + 1}]] ${chunk.citationLocator}`).join("、")}）`
    : "暂无知识库依据";

  const bundle = {
    id: id("ab"),
    tenantId: principal.tenantId,
    ownerUserId: principal.userId,
    triggerType: payload.trigger_type || "user_question",
    question,
    summary: !symbol
      ? "尚未指定交易对，不能生成交易方向或价格计划。"
      : highImpactEvents.length > 0
        ? `${symbol} 当前受高影响事件约束（${highImpactEvents[0].title}），${evidenceSummary}，建议只允许低风险计划或等待事件落地后重评。`
        : `${symbol}：${evidenceSummary}，仍需真实行情、账户与风控检查确认后才可交易。`,
    tradingImplication: highImpactEvents.length > 0 ? "allow_small_position" : "normal_precheck",
    expertViews: [
      { domain: "宏观", view: highImpactEvents[0] ? `${highImpactEvents[0].title} 临近，跳跃风险上升。` : "暂无真实事件卡形成阻断。", confidence: symbol ? 0.7 : 0 },
      knowledgeView,
      { domain: "风控", view: "真实交易必须带止损，并满足 Mandate 与日亏损额度约束。", confidence: 0.9 },
      { domain: "反方质疑", view: "缺少真实数据或知识依据时不能生成可执行交易结论。", confidence: 0.8 }
    ],
    rulesTriggered: rules.map((rule) => ({ ruleId: rule.id, name: rule.name, level: rule.level, action: rule.action })),
    retrievedRefs: retrieved.map((chunk) => ({ chunkId: chunk.id, score: Number(chunk.score.toFixed(3)), citationLocator: chunk.citationLocator })),
    eligibleKnowledgeSkills: eligibleSkills.map((skill) => ({
      skillId: skill.id,
      version: skill.version,
      fingerprint: skill.fingerprint,
      name: skill.name,
      matchScore: skill.matchScore,
      citations: skill.citationRefs
    })),
    citations: retrieved.map((chunk) => chunk.citationLocator),
    createdAt: nowIso()
  };

  db.analysisBundles.unshift(bundle);
  return bundle;
}
