// W4:知识库转换引擎——把书里的金融/心理/交易知识"读懂",产出可直接使用的三类产物:
//   strategy 交易策略(映射到受支持模板,可回测/可下单)、lens 分析提示词(塑造分析,不下单)、
//   workflow 工作流(有序分析步骤)。逐条采纳、采纳即用(去掉历史验证/模拟前向/待批准/小额试用
//   四道预闸)、在用中按真实成绩留/退。所有候选带来源引用,杜绝编造依据。
import { id, nowIso, appendAudit, appendTrace } from "./store.mjs";
import { llmComplete, activeProvider } from "./agentChat.mjs";
import { createSkillFromIdea } from "./knowledgeSkills.mjs";

const TEMPLATES = "trend/meanrev/breakout/macd/bollinger/death_cross/rsi_short/breakdown/supertrend/vol_breakout/squeeze/rsi_bull_div/rsi_bear_div";
const CONVERT_SYSTEM = "你是把交易/金融/心理知识转成【可执行产物】的引擎。读给定的书籍知识,产出三类候选:\n1) strategy 交易策略——必须映射到受支持模板之一,给出方向/周期/入场/止损/止盈,能直接回测与下单;\n2) lens 分析提示词——一条决策时提醒 AI 的纪律/视角(如行为金融偏差守卫、心理面纪律),只塑造分析不下单;\n3) workflow 工作流——一串有序的分析步骤。\n只从给定知识里提炼,不得编造;每个候选必须带来源引用(章节或页)。只输出纯 JSON,不要解释。";

export async function generateCandidates(db, sourceId, { max = 6 } = {}) {
  if (!activeProvider()) return { ok: false, error: "未配置 LLM，无法转换知识" };
  db.knowledge ||= {};
  const source = (db.knowledge.sources || []).find((s) => s.id === sourceId);
  if (!source) return { ok: false, error: "知识源不存在" };
  const methods = (db.knowledge.tradingMethods || []).filter((m) => m.source?.id === sourceId).slice(0, 8);
  const concepts = (db.knowledge.conceptCards || []).filter((c) => c.source?.id === sourceId || c.sourceId === sourceId).slice(0, 12);
  const chunks = (db.knowledge.chunks || []).filter((c) => c.sourceId === sourceId).slice(0, 6);
  const brief = [
    `书名:${source.title}`,
    methods.length ? `已蒸馏方法:${methods.map((m) => m.name).filter(Boolean).join("、")}` : "",
    concepts.length ? `关键概念:${concepts.map((c) => c.term || c.name).filter(Boolean).slice(0, 12).join("、")}` : "",
    chunks.length ? `原文摘录:\n${chunks.map((c) => String(c.text || "").slice(0, 280)).join("\n———\n")}` : ""
  ].filter(Boolean).join("\n\n");
  const prompt = `${brief}\n\n受支持模板:${TEMPLATES}\n\n从上面知识里产出最多 ${max} 个候选(尽量三类都覆盖),只返回纯 JSON:\n{"candidates":[{"type":"strategy","name":"","summary":"一句话逻辑","templateId":"上面模板之一","direction":"long|short","timeframe":"15m|1h|4h|1d","entry":"入场条件","stop":"止损描述(如 2%/2ATR)","takeProfit":"2R","sourceRef":"章节或页"},{"type":"lens","name":"","summary":"","promptText":"决策时提醒 AI 的一句纪律","trigger":"何时适用","sourceRef":""},{"type":"workflow","name":"","summary":"","steps":["步骤1","步骤2"],"sourceRef":""}]}`;
  let parsed;
  try {
    const raw = await llmComplete(prompt, CONVERT_SYSTEM);
    parsed = JSON.parse(String(raw).slice(String(raw).indexOf("{"), String(raw).lastIndexOf("}") + 1));
  } catch {
    return { ok: false, error: "转换模型返回无法解析" };
  }
  const list = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  db.knowledge.candidates ||= [];
  const created = [];
  for (const c of list.slice(0, max)) {
    if (!c || !["strategy", "lens", "workflow"].includes(c.type) || !c.name) continue;
    const cand = {
      id: id("cand"),
      type: c.type,
      name: String(c.name).slice(0, 80),
      summary: String(c.summary || "").slice(0, 240),
      sourceId,
      sourceTitle: source.title,
      sourceRef: String(c.sourceRef || "").slice(0, 60),
      payload: c.type === "strategy"
        ? { templateId: c.templateId, direction: c.direction === "short" ? "short" : "long", timeframe: c.timeframe, entry: c.entry, stop: c.stop, takeProfit: c.takeProfit || "2R" }
        : c.type === "lens"
          ? { promptText: String(c.promptText || c.summary || "").slice(0, 400), trigger: String(c.trigger || "").slice(0, 120) }
          : { steps: (Array.isArray(c.steps) ? c.steps : []).map((s) => String(s).slice(0, 120)).slice(0, 8) },
      status: "candidate",
      createdAt: nowIso()
    };
    db.knowledge.candidates.unshift(cand);
    created.push(cand);
  }
  appendTrace(db, "knowledge_convert", `《${source.title}》产出 ${created.length} 个候选`, "ok");
  appendAudit(db, `知识转换《${source.title}》产出 ${created.length} 个候选`, sourceId, "KnowledgeConverter");
  return { ok: true, created: created.length, candidates: created };
}

export function adoptCandidate(db, candidateId, actor = "用户") {
  db.knowledge ||= {};
  const cand = (db.knowledge.candidates || []).find((c) => c.id === candidateId);
  if (!cand) return { ok: false, error: "候选不存在" };
  if (cand.status !== "candidate") return { ok: false, error: `该候选已${cand.status === "adopted" ? "采纳" : "忽略"}，不能重复操作` };
  if (cand.type === "strategy") {
    const p = cand.payload || {};
    const res = createSkillFromIdea(db, { name: cand.name, direction: p.direction, timeframe: p.timeframe, entry: p.entry, stop: p.stop, takeProfit: p.takeProfit, templateId: p.templateId, marketRegime: "" }, actor);
    if (!res.ok) return { ok: false, error: res.error };
    // 采纳只进入标准策略生命周期；知识来源不能绕过编译、模拟前向和小额试用直接实盘激活。
    res.skill.provenance = "knowledge_adopted";
    res.skill.validated = false;
    res.skill.adoptedAt = nowIso();
    res.skill.sourceTitle = cand.sourceTitle;
    cand.adoptedArtifactId = res.skill.id;
    cand.adoptedKind = "skill";
  } else if (cand.type === "lens") {
    db.knowledge.lenses ||= [];
    const lens = { id: id("lens"), name: cand.name, summary: cand.summary, promptText: cand.payload?.promptText || cand.summary, trigger: cand.payload?.trigger || "", sourceTitle: cand.sourceTitle, sourceRef: cand.sourceRef, active: true, provenance: "knowledge_adopted", createdAt: nowIso() };
    db.knowledge.lenses.unshift(lens);
    cand.adoptedArtifactId = lens.id;
    cand.adoptedKind = "lens";
  } else if (cand.type === "workflow") {
    db.knowledge.workflows ||= [];
    const wf = { id: id("wf"), name: cand.name, summary: cand.summary, steps: cand.payload?.steps || [], sourceTitle: cand.sourceTitle, sourceRef: cand.sourceRef, active: true, provenance: "knowledge_adopted", createdAt: nowIso() };
    db.knowledge.workflows.unshift(wf);
    cand.adoptedArtifactId = wf.id;
    cand.adoptedKind = "workflow";
  }
  cand.status = "adopted";
  cand.adoptedAt = nowIso();
  appendAudit(db, `采纳知识候选「${cand.name}」(${cand.type}，采纳即用)`, cand.id, actor);
  return { ok: true, candidate: cand };
}

export function ignoreCandidate(db, candidateId) {
  const cand = (db.knowledge?.candidates || []).find((c) => c.id === candidateId);
  if (!cand) return { ok: false, error: "候选不存在" };
  cand.status = "ignored";
  cand.ignoredAt = nowIso();
  return { ok: true, candidate: cand };
}

// 撤销一个已采纳的分析透镜/工作流(策略走技能退役,不在此处)。
export function retireLensOrWorkflow(db, kind, artifactId) {
  const coll = kind === "lens" ? db.knowledge?.lenses : db.knowledge?.workflows;
  const item = (coll || []).find((x) => x.id === artifactId);
  if (!item) return { ok: false, error: "未找到" };
  item.active = false;
  item.retiredAt = nowIso();
  return { ok: true, item };
}
