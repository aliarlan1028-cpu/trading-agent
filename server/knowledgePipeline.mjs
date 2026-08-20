import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import mammoth from "mammoth";
import { assertSafeExternalUrl, assertSafeGitHubRepositoryUrl, fetchExternalText, resolveContainedPath } from "./externalInputSafety.mjs";
import { denseCosine, embedBatch, embeddingProvider, embedOne } from "./embeddings.mjs";
import { activeProvider, llmComplete } from "./llmTextService.mjs";
import { compileTradingMethod, retireSkillsForSource } from "./knowledgeSkills.mjs";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

// LLM 蒸馏：把交易资料提炼成"结构化、可交易的知识"，并按能否被证伪分成两类：
//   disciplineRules（纪律/风控/心理/禁止交易/仓位/杠杆/执行）—— 直接约束，不需回测；
//   strategies（价格行为/日内 setup，带入场/止损/止盈/参数）—— 只是"假设"，必须过回测才可实盘。
// 无 LLM key 时返回 null，退回高频词抽取。
async function distillWithLlm(text, source) {
  const system = "你是专业的交易知识蒸馏引擎，服务于一个自主交易加密永续合约（带杠杆、硬风控、短中周期）的 AI 交易员。只输出 JSON，不要多余文字。\n\n把书里可用于实盘的内容拆成三类：\n1) tradingMethods（交易方法/进场 setup）——【正向】：什么行情、什么信号该进场、怎么设止损止盈。这是给 AI 决策时参考的专家方法，越具体、越可判断越好。这是重点，尽量多抽。\n2) disciplineRules（风控纪律）——【反向】：仓位/杠杆/止损/禁止交易/心理这类『避免亏损、保持一致』的硬约束。\n3) concepts（概念）——交易术语/框架，带类别与关联概念，用于知识图谱。\n资料若来自传统金融（股票/长期/无杠杆），在 rationale/assetScope 注明用到加密永续的适用边界。宁缺毋滥：抽不出具体条件的不要编。";
  const prompt = `资料标题：${source.title}\n领域：${source.domain || "未标注"}\n\n蒸馏为 JSON：\n{\n"summary":"一句话主旨",\n"assetScope":"适用资产/周期边界",\n"tradingMethods":[{"name":"方法名(<=24字)","marketRegime":"适用行情(如:上升趋势/区间震荡/突破放量/高波动/事件前后)","timeframe":"1m|5m|15m|1H|4H|1D","symbolScope":"如BTC/ETH或通用","direction":"long|short|both","entry":"进场条件(具体可判断)","confirmation":"确认信号","stop":"止损条件","takeProfit":"止盈/离场条件","invalidation":"失效/不做条件","rationale":"为什么有效/依据"}],\n"disciplineRules":[{"category":"风控|心理|仓位|杠杆|禁止交易|执行","rule":"规则(<=40字)","condition":"触发条件","action":"pause_opening|reduce|notify|none","rationale":"依据"}],\n"concepts":[{"name":"概念名(<=12字)","meaning":"含义与适用边界(<=70字)","category":"技术|风控|心理|宏观|结构|资金","relatedTo":["相关概念名(必须是本列表其它概念名)"]}],\n"reviewTemplates":["复盘要点/模板条目"],\n"counterViews":["反方观点或适用边界"]\n}\n数量参考：tradingMethods 2-6 条（书里有可操作 setup 就尽量抽全）、disciplineRules 3-8 条、concepts 4-8 个（尽量给 relatedTo 连边）。\n\n资料正文：\n${text}`;
  const raw = await llmComplete(prompt, system);
  if (!raw) return null;
  try {
    return JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
}

// 按书名蒸馏：让 LLM 基于它对这本书的理解，用自己的话写一份"可执行交易方法"综述（非照抄原文）。
// 适用于买不到 PDF 但属于经典公开著作的情况——模型本就熟悉其方法论。无 LLM key 时返回空串。
async function generateBookSynthesis(source) {
  const system = "你是精读过大量经典交易著作的资深交易员。基于你对该书的真实理解，用【你自己的话】把这本书里可用于实盘交易的方法讲清楚——写的是方法论综述/读书笔记，不是照搬原文，绝不逐段复制书里的句子。忠于原书的核心观点与逻辑，重在可操作。用中文。";
  const prompt = `书名：${source.title}${source.author ? `\n作者：${source.author}` : ""}${source.bookFocus ? `\n侧重：${source.bookFocus}` : ""}\n\n请写一份 1200-2200 字的结构化方法综述，用小标题分节，覆盖（该书有则写、没有则略）：\n- 核心理念与它对市场的基本假设\n- 具体的交易 setup 与识别方法（越具体越好）\n- 入场条件 / 止损条件 / 止盈或离场条件（尽量给可判断的标准）\n- 仓位管理与杠杆纪律\n- 盘口/执行要点\n- 交易心理与行为纪律\n- 风控规则\n- 复盘方法/模板\n- 明确的『不要交易』条件\n只写方法与判断标准，不要泛泛而谈，也不要照抄原书文字。若该书面向股票/无杠杆/长周期，请注明用到加密永续合约时的适用边界。`;
  try {
    const raw = await llmComplete(prompt, system);
    const text = String(raw || "").trim();
    if (!text) source.error = "LLM 未返回内容（可能未配置可用的 LLM，或额度不足）";
    return text;
  } catch (err) {
    source.error = `按书名蒸馏调用 LLM 失败：${err.message}`;
    return "";
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");
const rootDir = path.resolve(__dirname, "..");
const importsDir = path.join(rootDir, "data", "knowledge-imports");
const execFileAsync = promisify(execFile);
const MAX_PARSED_TEXT_CHARS = 2_000_000;
const EPUB_DEFAULT_LIMITS = Object.freeze({
  maxEntries: 400,
  maxEntryBytes: 4 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxTextChars: MAX_PARSED_TEXT_CHARS
});
const KNOWLEDGE_PARSE_GLOBAL_LIMIT = 2;
const KNOWLEDGE_PARSE_TENANT_LIMIT = 1;
let activeKnowledgeParses = 0;
const activeKnowledgeParsesByTenant = new Map();

export async function importKnowledge(db, payload = {}) {
  await fs.mkdir(importsDir, { recursive: true, mode: 0o700 });
  const prepared = await preparePayload(payload);
  const source = {
    id: id("src"),
    title: payload.title || payload.url || payload.fileName || payload.filePath || "Knowledge Source",
    type: payload.type || inferType({ ...payload, filePath: prepared.filePath }),
    url: payload.url?.trim() || undefined,
    filePath: prepared.filePath,
    originalFileName: prepared.originalFileName,
    summary: payload.summary || "",
    createRuleDraft: payload.createRuleDraft === true,
    permission: payload.permission || "仅个人使用",
    status: "imported",
    trustScore: Number(payload.trustScore || 70),
    domain: payload.domain || "综合",
    author: payload.author || undefined,
    bookFocus: payload.bookFocus || undefined,
    synthetic: payload.type === "book_title",
    tenantId: payload.tenantId || "tenant_owner",
    ownerUserId: payload.ownerUserId || null,
    crawlDepth: payload.crawlDepth != null ? clampInt(payload.crawlDepth, 0, 3, 1) : undefined,
    crawlMaxPages: payload.crawlMaxPages != null ? clampInt(payload.crawlMaxPages, 1, 40, 12) : undefined,
    importedAt: nowIso()
  };
  db.knowledge.sources.unshift(source);
  appendAudit(db, "真实导入知识来源", source.id, "KnowledgePipeline");
  return source;
}

export async function parseKnowledgeSource(db, sourceId) {
  const source = db.knowledge.sources.find((item) => item.id === sourceId);
  if (!source) return { status: "missing_source" };
  const tenantId = String(source.tenantId || "tenant_owner");
  const tenantActive = activeKnowledgeParsesByTenant.get(tenantId) || 0;
  if (activeKnowledgeParses >= KNOWLEDGE_PARSE_GLOBAL_LIMIT || tenantActive >= KNOWLEDGE_PARSE_TENANT_LIMIT) {
    const error = new Error("Knowledge parsing concurrency limit reached; retry later");
    error.code = "KNOWLEDGE_PARSE_BUSY";
    throw error;
  }
  activeKnowledgeParses += 1;
  activeKnowledgeParsesByTenant.set(tenantId, tenantActive + 1);
  try {
    return await parseKnowledgeSourceWithPermit(db, sourceId);
  } finally {
    activeKnowledgeParses = Math.max(0, activeKnowledgeParses - 1);
    const next = Math.max(0, (activeKnowledgeParsesByTenant.get(tenantId) || 1) - 1);
    if (next) activeKnowledgeParsesByTenant.set(tenantId, next);
    else activeKnowledgeParsesByTenant.delete(tenantId);
  }
}

async function parseKnowledgeSourceWithPermit(db, sourceId) {
  const source = db.knowledge.sources.find((item) => item.id === sourceId);
  if (!source) return { status: "missing_source" };
  let text;
  if (source.type === "book_title") text = await generateBookSynthesis(source);
  else if (source.url) text = await extractFromUrl(source.url, { maxDepth: source.crawlDepth, maxPages: source.crawlMaxPages });
  else if (source.filePath) text = await extractFromFile(source.filePath);
  else text = `${source.title}\n${source.summary || ""}`;
  if (String(text || "").length > MAX_PARSED_TEXT_CHARS) {
    const error = new Error(`Knowledge text exceeds ${MAX_PARSED_TEXT_CHARS} character safety limit`);
    error.code = "KNOWLEDGE_TEXT_TOO_LARGE";
    throw error;
  }
  if (source.type === "book_title" && !text) {
    source.status = "failed";
    source.error = source.error || "未配置 LLM，无法按书名蒸馏知识";
    return { status: "failed", source, message: source.error };
  }
  source.contentHash = crypto.createHash("sha256").update(String(text || "")).digest("hex");
  source.parsedTextLength = String(text || "").length;

  const chunks = chunkText(text).map((chunk, index) => ({
    id: id("chunk"),
    sourceId: source.id,
    nodeId: `node_${source.id}`,
    text: chunk,
    lexical: embedText(chunk),
    citationLocator: `${source.title} #${index + 1}`,
    qualityScore: source.trustScore,
    createdAt: nowIso()
  }));
  // 若配置了 embedding 服务，解析时顺带计算稠密语义向量。
  const provider = embeddingProvider();
  if (provider && chunks.length) {
    try {
      const vectors = await embedBatch(chunks.map((chunk) => chunk.text));
      if (vectors) {
        chunks.forEach((chunk, index) => {
          chunk.embedding = vectors[index];
          chunk.embeddingModel = provider.model;
        });
      }
    } catch (error) {
      appendAudit(db, `语义向量化失败，回退词频检索：${error.message}`, source.id, "KnowledgePipeline", "warning");
    }
  }
  if (!chunks.length) {
    source.status = "empty";
    appendAudit(db, "知识来源未解析出文本", source.id, "KnowledgePipeline", "warning");
    return { status: "empty", source, chunks: 0, concepts: 0, message: `${source.title} 没有解析出可用文本` };
  }

  // 优先 LLM 蒸馏出真正的概念/规则/反方观点；无 LLM 时退回高频词抽取。
  const distilled = await distillWithLlm(text, source).catch(() => null);
  // 两阶段替换(审计 P2):此前"先退役技能/删方法规则,后蒸馏"——LLM 瞬时故障会把该来源
  // 整条已验证流水线清空且无法恢复。现在:蒸馏失败且该来源已有派生数据时,中止重解析保持原状。
  const hadDerived = (db.knowledge.tradingMethods || []).some((m) => m.source?.id === source.id)
    || (db.knowledge.tradingSkills || []).some((k) => k.sourceId === source.id && !["retired", "superseded"].includes(k.status));
  if (!distilled && hadDerived && llmConfigured()) {
    source.status = "distill_failed";
    appendAudit(db, "蒸馏失败,已保留旧派生数据(两阶段保护)", source.id, "KnowledgePipeline", "warning");
    return { status: "distill_failed", source, message: `${source.title} 蒸馏失败,旧方法/技能/规则原样保留,稍后重试` };
  }

  // 蒸馏成功(或无 LLM 走确定性回退)后才替换旧数据。旧版本技能退役,不能继续以旧指纹自主交易。
  retireSkillsForSource(db, source.id, "KnowledgePipeline", "source_reparsed");
  db.knowledge.documentNodes = (db.knowledge.documentNodes || []).filter((node) => node.sourceId !== source.id);
  db.knowledge.chunks = (db.knowledge.chunks || []).filter((chunk) => chunk.sourceId !== source.id);
  db.knowledge.conceptCards = (db.knowledge.conceptCards || []).filter((concept) => !concept.sourceRefs?.includes(source.id));
  db.knowledge.tradingMethods = (db.knowledge.tradingMethods || []).filter((m) => m.source?.id !== source.id);
  // 多来源合并规则不整条删除,只摘掉本来源引用(仍被其它来源支撑的保留;已批准的一律保留)。
  db.knowledge.ruleProposals = (db.knowledge.ruleProposals || []).filter((r) => {
    if (r.status === "已批准" || !r.sourceRefs?.includes(source.id)) return true;
    if (r.sourceRefs.length > 1) { r.sourceRefs = r.sourceRefs.filter((x) => x !== source.id); return true; }
    return false;
  });
  db.knowledge.documentNodes.unshift({ id: `node_${source.id}`, sourceId: source.id, parentId: null, nodeType: "document", title: source.title, orderIndex: 1, pageRange: "N/A" });
  db.knowledge.chunks.unshift(...chunks);
  let concepts;
  if (distilled?.concepts?.length) {
    concepts = distilled.concepts.slice(0, 8).map((item) => ({
      id: id("concept"),
      name: String(item.name || "").slice(0, 24) || "概念",
      domain: source.domain,
      category: String(item.category || "").slice(0, 8) || "其他",
      relatedTo: Array.isArray(item.relatedTo) ? item.relatedTo.map((r) => String(r).slice(0, 24)).slice(0, 6) : [],
      sourceRefs: [source.id],
      indicators: [],
      tradingMeaning: String(item.meaning || "").slice(0, 220) || `来自 ${source.title}`,
      distilledBy: "llm",
      createdAt: nowIso()
    }));
    if (distilled.summary) source.distilledSummary = String(distilled.summary).slice(0, 300);
    if (Array.isArray(distilled.counterViews)) source.counterViews = distilled.counterViews.slice(0, 5);
  } else {
    concepts = extractConcepts(text).map((name) => ({
      id: id("concept"),
      name,
      domain: source.domain,
      sourceRefs: [source.id],
      indicators: [],
      tradingMeaning: `${name} 已从 ${source.title} 中抽取，等待专家复核。`,
      createdAt: nowIso()
    }));
  }
  db.knowledge.conceptCards.unshift(...concepts);

  db.knowledge.tradingMethods ||= [];
  db.knowledge.strategyHypotheses ||= [];
  db.knowledge.reviewTemplates ||= [];
  let ruleDraft = null;

  // A 路 · 纪律/风控/心理/禁止交易/仓位/杠杆/执行 —— 待批准规则，批准后进 Agent 提示词与风控证据。
  const disciplineRules = (distilled?.disciplineRules || distilled?.rules || []).slice(0, 8);
  for (const rule of disciplineRules) {
    const draft = {
      id: id("rule"),
      name: String(rule.rule || rule.name || `${source.title} 纪律`).slice(0, 40),
      kind: "discipline",
      category: String(rule.category || "风控").slice(0, 12),
      level: "L2",
      status: "待审批",
      action: ["pause_opening", "notify", "reduce", "none"].includes(rule.action) ? rule.action : "notify",
      condition: String(rule.condition || "").slice(0, 160),
      description: String(rule.rationale || rule.condition || `由《${source.title}》蒸馏，请人工复核后启用`).slice(0, 240),
      sourceRefs: [source.id],
      distilledBy: "llm",
      createdAt: nowIso()
    };
    db.knowledge.ruleProposals.unshift(draft);
    ruleDraft = ruleDraft || draft;
  }

  // B 路 · 交易方法/进场 setup —— 【正向】顾问知识：决策时注入 AI 推理，帮它判断"什么行情该怎么进"，
  // 提升准确率。AI 仍自主决策、风控闸门把关，不自动照搬；不再走假回测。
  const methods = (distilled?.tradingMethods || distilled?.strategies || []).slice(0, 6);
  const createdMethods = [];
  for (const m of methods) {
    if (!m || (!m.entry && !m.name)) continue;
    const method = {
      id: id("method"),
      name: String(m.name || `${source.title} 方法`).slice(0, 40),
      marketRegime: String(m.marketRegime || m.kind || "通用").slice(0, 40),
      symbolScope: String(m.symbolScope || "通用").slice(0, 40),
      timeframe: String(m.timeframe || "1H").slice(0, 8),
      direction: ["long", "short", "both"].includes(m.direction) ? m.direction : "both",
      entry: String(m.entry || "").slice(0, 220),
      confirmation: String(m.confirmation || "").slice(0, 160),
      stop: String(m.stop || "").slice(0, 160),
      takeProfit: String(m.takeProfit || "").slice(0, 160),
      invalidation: String(m.invalidation || "").slice(0, 160),
      rationale: String(m.rationale || "").slice(0, 220),
      source: { id: source.id, title: source.title },
      createdAt: nowIso()
    };
    db.knowledge.tradingMethods.unshift(method);
    createdMethods.push(method);
  }

  // 自动生成“编译草案”，但不自动验证、批准或启用。编译失败的方法仍保留为顾问知识。
  const compiledSkills = [];
  for (const method of createdMethods) {
    if (method.direction === "both") {
      compiledSkills.push(compileTradingMethod(db, method.id, { direction: "long" }));
      compiledSkills.push(compileTradingMethod(db, method.id, { direction: "short" }));
    } else {
      compiledSkills.push(compileTradingMethod(db, method.id));
    }
  }

  // 复盘模板
  const templates = (distilled?.reviewTemplates || []).slice(0, 10).map((t) => String(t).slice(0, 160)).filter(Boolean);
  if (templates.length) {
    db.knowledge.reviewTemplates.unshift({ id: id("rvtpl"), sourceId: source.id, sourceTitle: source.title, items: templates, createdAt: nowIso() });
  }

  if (!disciplineRules.length && source.createRuleDraft) {
    ruleDraft = {
      id: id("rule"),
      name: `${source.title} 规则草案`,
      kind: "discipline",
      category: "风控",
      level: "L2",
      status: "待审批",
      action: "notify",
      description: `由《${source.title}》自动生成的知识规则草案，请人工复核后再启用。`,
      sourceRefs: [source.id],
      createdAt: nowIso()
    };
    db.knowledge.ruleProposals.unshift(ruleDraft);
  }
  source.status = "parsed";
  source.parsedAt = nowIso();
  appendAudit(db, "解析并切片知识来源", source.id, "KnowledgePipeline");
  appendTrace(db, "knowledge_rag", `解析 ${source.title}`);
  return {
    status: "ok",
    source,
    chunks: chunks.length,
    concepts: concepts.length,
    methods: createdMethods.length,
    compiledSkills: compiledSkills.map((skill) => ({ id: skill.id, status: skill.status, errors: skill.compileErrors })),
    rules: disciplineRules.length,
    ruleDraft,
    message: `已导入并解析 ${chunks.length} 个片段，生成 ${createdMethods.length} 条交易方法与 ${compiledSkills.filter((skill) => skill.status === "compiled").length} 个可验证技能草案`
  };
}

// LLM 智能去重：把同类别下语义重复的规则草案合并成精简规范集（阈值冲突时取更严格的）。
// 只动"待审批"草案，已批准的一律保留；无 LLM 时原样返回不改动。
async function mergeCategoryRules(category, list) {
  const system = "你是交易风控规则整编专家。把同类多条规则去重合并成精简、不冗余的规范集：语义相同或相近的合并为一条；遇到不同阈值时保留【更严格/更保守】的那个（如单笔亏损 1% 与 2% 取 1%，杠杆 2 倍与 3 倍取 2 倍）。绝不发明新规则，只做合并与规范化。只输出 JSON 数组，不要多余文字。";
  const items = list.map((r, i) => `${i + 1}. ${r.name}｜条件:${r.condition || "-"}｜动作:${r.action || "notify"}｜依据:${r.description || "-"}`).join("\n");
  const prompt = `类别：${category}\n把下面 ${list.length} 条规则合并去重，输出精简后的规则数组 JSON：\n[{"name":"规则(<=40字)","condition":"触发条件","action":"pause_opening|reduce|notify|none","description":"依据/为什么(<=120字)"}]\n语义重复的必须合并，只保留真正不同的规则。\n\n规则清单：\n${items}`;
  const raw = await llmComplete(prompt, system);
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
    if (!Array.isArray(arr) || !arr.length) return null;
    const sourceRefs = [...new Set(list.flatMap((r) => r.sourceRefs || []))];
    return arr.slice(0, list.length).map((r) => ({
      id: id("rule"),
      name: String(r.name || "").slice(0, 40) || "规则",
      kind: "discipline",
      category,
      level: "L2",
      status: "待审批",
      action: ["pause_opening", "notify", "reduce", "none"].includes(r.action) ? r.action : "notify",
      condition: String(r.condition || "").slice(0, 160),
      description: String(r.description || "").slice(0, 240),
      sourceRefs,
      distilledBy: "llm_merge",
      createdAt: nowIso()
    }));
  } catch { return null; }
}

export async function consolidateRuleProposals(db) {
  const rules = db.knowledge.ruleProposals || [];
  const pending = rules.filter((r) => !r.status || r.status === "待审批" || r.status === "candidate");
  const untouched = rules.filter((r) => !pending.includes(r));
  if (pending.length < 2) return { removed: 0, remaining: rules.length, method: "none" };
  const byCat = {};
  for (const r of pending) (byCat[r.category || "其他"] ||= []).push(r);
  const out = [];
  let usedLlm = false;
  for (const [cat, list] of Object.entries(byCat)) {
    if (list.length < 2) { out.push(...list); continue; }
    const merged = await mergeCategoryRules(cat, list).catch(() => null);
    if (merged && merged.length) { out.push(...merged); usedLlm = true; } else out.push(...list);
  }
  // 已批准、已拒绝、已退役都是有审计意义的状态，绝不能被语义去重重新生成成待审批草案。
  db.knowledge.ruleProposals = [...out, ...untouched];
  const removed = Math.max(0, pending.length - out.length);
  appendAudit(db, `规则库智能去重：待审批 ${pending.length} → ${out.length} 条`, "rule_dedup", "KnowledgePipeline");
  return { removed, remaining: db.knowledge.ruleProposals.length, method: usedLlm ? "llm" : "keep" };
}

// 词频检索（同步，回退用）：无 embedding 服务或片段未向量化时使用。
export function retrieveChunks(db, query, topK = 5, options = {}) {
  const text = String(query || "").trim();
  if (!text) return [];
  const queryEmbedding = embedText(text);
  return (options.chunks || db.knowledge?.chunks || [])
    .map((chunk) => ({ ...chunk, score: cosine(queryEmbedding, chunk.lexical || embedText(chunk.text || "")), retrieval: "lexical" }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Number(topK || 5));
}

// 语义检索（异步，首选）：用稠密向量做余弦相似度；无 provider 或片段未向量化时自动回退词频。
export async function retrieveChunksSemantic(db, query, topK = 5, options = {}) {
  const text = String(query || "").trim();
  if (!text) return [];
  const provider = embeddingProvider();
  if (!provider) return retrieveChunks(db, text, topK, options);
  const embeddedChunks = (options.chunks || db.knowledge?.chunks || []).filter((chunk) => Array.isArray(chunk.embedding) && chunk.embeddingModel === provider.model);
  if (!embeddedChunks.length) return retrieveChunks(db, text, topK, options);
  let queryVector;
  try {
    queryVector = await embedOne(text);
  } catch {
    return retrieveChunks(db, text, topK, options);
  }
  if (!queryVector) return retrieveChunks(db, text, topK, options);
  return embeddedChunks
    .map((chunk) => ({ ...chunk, score: denseCosine(queryVector, chunk.embedding), retrieval: "semantic" }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Number(topK || 5));
}

// 回填/重建全部片段的语义向量（配置 embedding 服务后调用一次）。
export async function reembedAllChunks(db, options = {}) {
  const provider = embeddingProvider();
  if (!provider) return { status: "no_provider", message: "未配置 OpenAI/Gemini embedding，无法语义向量化。" };
  const chunks = options.chunks || db.knowledge?.chunks || [];
  const pending = chunks.filter((chunk) => !(Array.isArray(chunk.embedding) && chunk.embeddingModel === provider.model));
  if (!pending.length) return { status: "ok", model: provider.model, embedded: 0, total: chunks.length, message: "全部片段已是最新向量。" };
  let embedded = 0;
  const groupSize = 96;
  for (let i = 0; i < pending.length; i += groupSize) {
    const group = pending.slice(i, i + groupSize);
    const vectors = await embedBatch(group.map((chunk) => chunk.text));
    if (!vectors) break;
    group.forEach((chunk, index) => {
      chunk.embedding = vectors[index];
      chunk.embeddingModel = provider.model;
      embedded += 1;
    });
  }
  appendAudit(db, `语义向量化 ${embedded} 个知识片段（${provider.model}）`, "reembed", "KnowledgePipeline");
  appendTrace(db, "knowledge_embed", `reembed ${embedded}/${chunks.length}`, "ok");
  return { status: "ok", model: provider.model, embedded, total: chunks.length, message: `已向量化 ${embedded} 个片段` };
}

export function embeddingStatus(db, options = {}) {
  const provider = embeddingProvider();
  const chunks = options.chunks || db.knowledge?.chunks || [];
  const embedded = provider ? chunks.filter((chunk) => Array.isArray(chunk.embedding) && chunk.embeddingModel === provider.model).length : 0;
  return {
    provider: provider?.name || null,
    model: provider?.model || null,
    mode: provider ? "semantic" : "lexical",
    totalChunks: chunks.length,
    embeddedChunks: embedded,
    coveragePct: chunks.length ? Math.round((embedded / chunks.length) * 100) : 0
  };
}

export async function ragQuery(db, query, options = {}) {
  const principal = options.principal || {};
  const tenantId = principal.tenantId || null;
  const ownerUserId = principal.userId || principal.id || null;
  if (!tenantId || !ownerUserId) throw new Error("knowledge_rag_explicit_principal_required");
  const chunks = await retrieveChunksSemantic(db, query, Number(options.topK || 5), { chunks: options.chunks });
  const mode = chunks[0]?.retrieval || (embeddingProvider() ? "semantic" : "lexical");
  const answer = chunks.length
    ? `${mode === "semantic" ? "语义" : "词频"}召回 ${chunks.length} 个知识片段：${chunks.map((chunk) => chunk.citationLocator).join("、")}`
    : "未召回相关知识片段。";
  const bundle = {
    id: id("ab"),
    tenantId,
    ownerUserId,
    triggerType: "rag_query",
    question: query,
    summary: answer,
    retrievalMode: mode,
    retrievedRefs: chunks.map((chunk) => ({ chunkId: chunk.id, score: Number((chunk.score || 0).toFixed(3)), citationLocator: chunk.citationLocator })),
    citations: chunks.map((chunk) => chunk.citationLocator),
    createdAt: nowIso()
  };
  db.analysisBundles.unshift(bundle);
  appendAudit(db, "运行 RAG 查询", bundle.id, "KnowledgePipeline");
  return bundle;
}

const GITHUB_MAX_FILES = 300;             // 纳入的文本文件数上限(原为 80)
const GITHUB_MAX_FILE_BYTES = 256 * 1024; // 单文件字节上限,跳过超大/压缩产物
const GITHUB_MAX_TOTAL_CHARS = 400_000;   // 合并后总量上限,防炸 LLM 上下文

// 文档优先级:README/docs/纯文档先纳入,保证截断时留下的是知识密度最高的文件
function githubDocPriority(rel) {
  const l = rel.toLowerCase();
  if (/(^|\/)readme\.(md|mdx|markdown|rst|txt)$/.test(l)) return 0;
  if (/(^|\/)(docs?|guide|guides|wiki|handbook|manual|tutorial)\//.test(l)) return 1;
  if (/\.(md|mdx|markdown|rst|adoc)$/.test(l)) return 2;
  if (/(strategy|strategies|signal|indicator|research|backtest|trading)/.test(l)) return 3;
  return 5;
}

export async function importGithubKnowledge(db, repoUrl, subPath = "", options = {}) {
  await fs.mkdir(importsDir, { recursive: true, mode: 0o700 });
  await assertSafeGitHubRepositoryUrl(repoUrl);
  const target = path.join(importsDir, id("repo"));
  try {
    await cloneGithubRepositoryBounded(repoUrl, target);
    const base = resolveContainedPath(target, subPath);
    const scan = await listTextFilesBounded(base);
    const ranked = [];
    for (const full of scan.files) {
      let stat;
      try { stat = await fs.stat(full); } catch { continue; }
      if (stat.size > GITHUB_MAX_FILE_BYTES) continue;
      const rel = path.relative(base, full);
      ranked.push({ full, rel, pr: githubDocPriority(rel) });
    }
    ranked.sort((a, b) => a.pr - b.pr || a.rel.localeCompare(b.rel));
    const combined = [];
    let used = 0, totalChars = 0;
    for (const f of ranked) {
      if (used >= GITHUB_MAX_FILES || totalChars >= GITHUB_MAX_TOTAL_CHARS) break;
      let content;
      try { content = await fs.readFile(f.full, "utf8"); } catch { continue; }
      const block = `\n# ${f.rel}\n${content}`;
      if (totalChars + block.length > GITHUB_MAX_TOTAL_CHARS) break;
      combined.push(block);
      used += 1;
      totalChars += block.length;
    }
    const source = await importKnowledge(db, { title: repoUrl, type: "github", url: repoUrl, permission: "用户授权仓库", domain: "代码/Skill", tenantId: options.tenantId, ownerUserId: options.ownerUserId });
    const syntheticPath = path.join(importsDir, `${source.id}.md`);
    await fs.writeFile(syntheticPath, combined.join("\n"), { encoding: "utf8", mode: 0o600 });
    source.filePath = syntheticPath;
    source.githubStats = { totalFound: scan.files.length, visitedNodes: scan.visitedNodes, eligible: ranked.length, included: used, traversalTruncated: scan.truncated };
    const result = await parseKnowledgeSource(db, source.id);
    const note = scan.truncated || ranked.length > used
      ? `（仓库内容已触及安全上限，按 README/docs 优先纳入 ${used} 个文件）`
      : `（纳入 ${used} 个文本文件）`;
    return { ...result, githubStats: source.githubStats, message: `${result.message || "已导入 GitHub 知识"}${note}` };
  } finally {
    await fs.rm(target, { recursive: true, force: true }).catch(() => {});
  }
}

async function cloneGithubRepositoryBounded(repoUrl, target, options = {}) {
  await execFileAsync("git", [
    "-c", "core.askPass=", "-c", "credential.helper=", "clone", "--depth", "1", "--single-branch",
    "--filter=blob:limit=262144", "--no-tags", repoUrl, target
  ], {
    timeout: Number(options.timeoutMs || 30_000),
    maxBuffer: Number(options.maxOutputBytes || 1024 * 1024),
    killSignal: "SIGKILL",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" }
  });
}

// 抓取时跳过的二进制/资源后缀(避免把图片/压缩包当页面抓)
const CRAWL_SKIP_EXT = /\.(pdf|zip|gz|tar|rar|7z|png|jpe?g|gif|svg|webp|ico|mp4|mp3|wav|avi|mov|css|js|mjs|woff2?|ttf|eot|xml|rss|json|csv|xlsx?|docx?|pptx?)(\?|#|$)/i;
const CRAWL_TOTAL_CHARS = 200_000; // 多页合并后喂给 LLM 的总量上限,防炸上下文

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

// 从已加载的 cheerio 文档里收集同域、可抓的子链接(相对路径按 baseUrl 解析)
function collectSameOriginLinks($, baseUrl, seedHost) {
  const out = new Set();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let abs;
    try { abs = new URL(href, baseUrl); } catch { return; }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return;
    if (abs.hostname.toLowerCase() !== seedHost) return; // 只在同一域名内浅爬
    if (CRAWL_SKIP_EXT.test(abs.pathname)) return;
    abs.hash = "";
    out.add(abs.toString());
  });
  return [...out];
}

// URL 浅爬:从种子 URL 出发,按 BFS 顺着同域子链接抓最多 maxPages 页 / 最深 maxDepth 层。
// depth=0 只抓本页;depth=1 含直接子链接;复用 fetchExternalText 的 SSRF 防护与字节/超时限制。
async function extractFromUrl(url, options = {}) {
  const maxDepth = clampInt(options.maxDepth, 0, 3, 1);
  const maxPages = clampInt(options.maxPages, 1, 40, 12);
  const seed = await assertSafeExternalUrl(url); // 返回 URL 对象,内含 SSRF/私网校验
  const seedHost = seed.hostname.toLowerCase();
  const queue = [{ url: seed.toString(), depth: 0 }];
  const visited = new Set([seed.toString()]);
  const pages = [];
  let totalChars = 0;
  while (queue.length && pages.length < maxPages && totalChars < CRAWL_TOTAL_CHARS) {
    const { url: current, depth } = queue.shift();
    let html, finalUrl, ok, ctype;
    try {
      const r = await fetchExternalText(current, { maxBytes: 8 * 1024 * 1024, timeoutMs: 15_000 });
      ok = r.response.ok;
      ctype = r.response.headers.get("content-type") || "";
      html = r.text;
      finalUrl = r.finalUrl || current;
    } catch { continue; } // 单页失败不影响整体
    if (!ok) continue;
    if (ctype && !/html|xml|text\//i.test(ctype)) continue; // 只吃 HTML/文本
    const $ = cheerio.load(html);
    const links = depth < maxDepth ? collectSameOriginLinks($, finalUrl, seedHost) : [];
    $("script,style,noscript,nav,header,footer,aside,form,iframe,svg").remove();
    const body = ($("main").text() || $("article").text() || $("body").text() || "").replace(/\s+/g, " ").trim();
    if (body) { pages.push(`# ${finalUrl}\n${body}`); totalChars += body.length; }
    for (const link of links) {
      if (visited.has(link) || visited.size >= maxPages * 6) continue;
      visited.add(link);
      queue.push({ url: link, depth: depth + 1 });
    }
  }
  if (!pages.length) throw new Error(`URL 抓取未得到可用文本(可能是需要 JS 渲染的动态页面或需登录)：${url}`);
  return pages.join("\n\n");
}

async function extractFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }
  if (ext === ".pdf") {
    const data = await fs.readFile(filePath);
    const result = await pdfParse(data);
    return result.text;
  }
  if (ext === ".epub") {
    return extractFromEpub(filePath);
  }
  return fs.readFile(filePath, "utf8");
}

// EPUB = zip 里一堆 XHTML。解压前先用 central directory 做硬预算，解压时再次按实际字节计数。
export async function extractFromEpub(filePath, limitOverrides = {}) {
  const JSZip = (await import("jszip")).default;
  const buf = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(buf);
  const limits = { ...EPUB_DEFAULT_LIMITS, ...limitOverrides };
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > limits.maxEntries) throw new Error(`EPUB contains too many entries (${entries.length})`);
  let declaredTotal = 0;
  for (const entry of entries) {
    const name = String(entry.unsafeOriginalName || entry.name || "");
    if (!name || path.posix.isAbsolute(name) || name.split("/").includes("..")) throw new Error("EPUB contains an unsafe path");
    const uncompressed = Number(entry?._data?.uncompressedSize);
    const compressed = Number(entry?._data?.compressedSize);
    if (!Number.isFinite(uncompressed) || uncompressed < 0) throw new Error(`EPUB entry size is unavailable: ${name}`);
    if (uncompressed > limits.maxEntryBytes) throw new Error(`EPUB entry exceeds size limit: ${name}`);
    declaredTotal += uncompressed;
    if (declaredTotal > limits.maxTotalBytes) throw new Error("EPUB total uncompressed size exceeds safety limit");
    if (uncompressed > 4096 && (!Number.isFinite(compressed) || compressed <= 0 || uncompressed / compressed > limits.maxCompressionRatio)) {
      throw new Error(`EPUB compression ratio exceeds safety limit: ${name}`);
    }
  }
  const extraction = { bytes: 0, names: new Set() };
  const readEntryText = async (entry) => {
    if (!entry || extraction.names.has(entry.name)) return "";
    extraction.names.add(entry.name);
    const bytes = await entry.async("uint8array");
    extraction.bytes += bytes.byteLength;
    if (bytes.byteLength > limits.maxEntryBytes || extraction.bytes > limits.maxTotalBytes) throw new Error("EPUB exceeded extraction byte limit");
    return Buffer.from(bytes).toString("utf8");
  };
  // 尝试从 OPF spine 拿阅读顺序
  let ordered = [];
  try {
    const containerFile = zip.file("META-INF/container.xml");
    if (containerFile) {
      const container = await readEntryText(containerFile);
      const opfPath = cheerio.load(container, { xmlMode: true })("rootfile").attr("full-path");
      const opfFile = opfPath && zip.file(opfPath);
      if (opfFile) {
        const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
        const $opf = cheerio.load(await readEntryText(opfFile), { xmlMode: true });
        const manifest = {};
        $opf("manifest > item").each((_, el) => { manifest[$opf(el).attr("id")] = $opf(el).attr("href"); });
        $opf("spine > itemref").each((_, el) => {
          const href = manifest[$opf(el).attr("idref")];
          if (href) ordered.push(opfDir + href.replace(/^\.\//, ""));
        });
      }
    }
  } catch { /* 解析失败则退回按文件名 */ }
  if (!ordered.length) {
    ordered = Object.keys(zip.files).filter((name) => /\.(xhtml|html?|htm)$/i.test(name)).sort();
  }
  const parts = [];
  let parsedChars = 0;
  for (const name of ordered.slice(0, limits.maxEntries)) {
    const entry = zip.file(name);
    if (!entry) continue;
    try {
      const html = await readEntryText(entry);
      const $ = cheerio.load(html);
      $("script,style,nav,head").remove();
      const text = $("body").text().replace(/\s+/g, " ").trim();
      if (text) {
        parsedChars += text.length;
        if (parsedChars > limits.maxTextChars) throw new Error("EPUB parsed text exceeds safety limit");
        parts.push(text);
      }
    } catch (error) {
      if (/safety limit|size limit|too many|unsafe path/i.test(error.message)) throw error;
      /* 跳过单个格式损坏章节 */
    }
  }
  return parts.join("\n\n");
}

async function preparePayload(payload = {}) {
  if (payload.fileBase64) {
    const originalFileName = safeFileName(payload.fileName || "uploaded-knowledge.bin");
    const target = path.join(importsDir, `${id("upload")}_${originalFileName}`);
    const base64 = String(payload.fileBase64).replace(/^data:[^;]+;base64,/, "");
    await fs.writeFile(target, Buffer.from(base64, "base64"), { mode: 0o600 });
    return { filePath: target, originalFileName };
  }
  if (payload.content) {
    const originalFileName = safeFileName(payload.fileName || `${payload.title || "pasted-note"}.md`);
    const target = path.join(importsDir, `${id("note")}_${originalFileName}`);
    await fs.writeFile(target, String(payload.content), { encoding: "utf8", mode: 0o600 });
    return { filePath: target, originalFileName };
  }
  if (payload.filePath) {
    // 本地路径导入已停用(2026-07):服务器无法访问用户设备文件,且客户端传服务器路径有越权风险。
    throw new Error("本地路径导入已停用，请改用『上传文件』(PDF/EPUB/DOCX/MD/TXT)或『网页链接』导入");
  }
  return { filePath: null, originalFileName: payload.fileName };
}

function safeFileName(value) {
  const cleaned = String(value || "knowledge.md").replace(/[/\\?%*:|"<>]/g, "-").trim();
  return cleaned || "knowledge.md";
}

function llmConfigured() { return Boolean(activeProvider()); }

function chunkText(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  const chunks = [];
  for (let i = 0; i < normalized.length; i += 1200) chunks.push(normalized.slice(i, i + 1400));
  return chunks.filter((chunk) => chunk.length > 30);
}

function embedText(text) {
  const tokens = tokenize(text);
  const vector = {};
  for (const token of tokens) vector[token] = (vector[token] || 0) + 1;
  return vector;
}

function cosine(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  let dot = 0, na = 0, nb = 0;
  for (const key of keys) {
    dot += (a[key] || 0) * (b[key] || 0);
    na += (a[key] || 0) ** 2;
    nb += (b[key] || 0) ** 2;
  }
  return dot / (Math.sqrt(na || 1) * Math.sqrt(nb || 1));
}

function tokenize(text) {
  return String(text || "").toLowerCase().match(/[a-z0-9_\u4e00-\u9fa5]{2,}/g) || [];
}

function extractConcepts(text) {
  const tokens = tokenize(text).filter((token) => token.length >= 3);
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([token]) => token);
}

const GITHUB_SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "out", "vendor", ".next", ".nuxt", "coverage", "__pycache__", ".venv", "venv", "target", ".cache", ".idea", ".vscode"]);
const GITHUB_TEXT_EXT = /\.(md|mdx|markdown|rst|adoc|txt|json|ya?ml|toml|ini|js|jsx|ts|tsx|py|go|rs|java|kt|c|cpp|h|hpp|cs|rb|php|sol|sh|ipynb)$/i;
const GITHUB_SKIP_FILE = /(\.min\.(js|css)$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|go\.sum|Cargo\.lock|composer\.lock)$)/i;

export async function listTextFilesBounded(dir, options = {}) {
  const limits = {
    maxNodes: Number(options.maxNodes || 5_000),
    maxFiles: Number(options.maxFiles || 1_500),
    maxObservedBytes: Number(options.maxObservedBytes || 64 * 1024 * 1024)
  };
  const files = [];
  let visitedNodes = 0;
  let observedBytes = 0;
  let truncated = false;
  const queue = [dir];
  while (queue.length && !truncated) {
    const current = queue.shift();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      visitedNodes += 1;
      if (visitedNodes > limits.maxNodes) { truncated = true; break; }
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!GITHUB_SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) queue.push(full);
      } else if (entry.isFile()) {
        let stat;
        try { stat = await fs.stat(full); } catch { continue; }
        observedBytes += Number(stat.size || 0);
        if (observedBytes > limits.maxObservedBytes) { truncated = true; break; }
        if (GITHUB_TEXT_EXT.test(entry.name) && !GITHUB_SKIP_FILE.test(entry.name)) files.push(full);
        if (files.length >= limits.maxFiles) { truncated = true; break; }
      }
    }
  }
  return { files, visitedNodes, observedBytes, truncated };
}

export async function removeManagedKnowledgeFile(source) {
  if (!source?.filePath) return false;
  const absolute = path.resolve(source.filePath);
  const root = path.resolve(importsDir);
  if (absolute === root || !absolute.startsWith(`${root}${path.sep}`)) return false;
  await fs.rm(absolute, { recursive: true, force: true });
  source.filePath = null;
  source.fileRemovedAt = nowIso();
  return true;
}

function inferType(payload) {
  if (payload.url?.includes("github.com")) return "github";
  if (payload.url) return "web";
  return path.extname(payload.filePath || "").slice(1) || "text";
}
