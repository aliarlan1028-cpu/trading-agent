import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import mammoth from "mammoth";
import simpleGit from "simple-git";
import { denseCosine, embedBatch, embeddingProvider, embedOne } from "./embeddings.mjs";
import { llmComplete } from "./agentChat.mjs";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

// LLM 蒸馏：把交易资料提炼成"结构化、可交易的知识"，并按能否被证伪分成两类：
//   disciplineRules（纪律/风控/心理/禁止交易/仓位/杠杆/执行）—— 直接约束，不需回测；
//   strategies（价格行为/日内 setup，带入场/止损/止盈/参数）—— 只是"假设"，必须过回测才可实盘。
// 无 LLM key 时返回 null，退回高频词抽取。
async function distillWithLlm(text, source) {
  const system = "你是专业的交易知识蒸馏引擎，服务于一个交易加密货币永续合约（带杠杆、硬风控、短中周期）的自主交易 Agent。只输出 JSON，不要多余文字。\n\n关键原则：把书里的内容拆成两类——\n1) disciplineRules：纪律/风控/心理/禁止交易/仓位/杠杆/盘口执行 这类『避免亏损、保持一致性』的硬约束，可直接采用；\n2) strategies：价格行为规则、日内 setup 这类『预测方向、追求胜率』的可回测方法，带明确入场/止损/止盈/参数——这些只是待验证假设，绝不能直接实盘，必须先回测。\n资料若来自传统金融（股票/长期/无杠杆），在 assetScope/rationale 里注明适用边界，避免被误用到杠杆合约。宁缺毋滥：抽不出具体条件的就不要编。";
  const prompt = `资料标题：${source.title}\n领域：${source.domain || "未标注"}\n\n蒸馏为 JSON：\n{\n"summary":"一句话主旨",\n"assetScope":"适用资产/周期边界",\n"disciplineRules":[{"category":"风控|心理|仓位|杠杆|禁止交易|执行","rule":"规则(<=40字)","condition":"触发条件","action":"pause_opening|reduce|notify|none","rationale":"依据"}],\n"strategies":[{"name":"策略名","kind":"price_action|intraday_setup|breakout|mean_reversion|trend|other","symbolScope":"如BTC/ETH或通用","timeframe":"1m|5m|15m|1H|4H|1D","direction":"long|short|both","entry":"入场条件","stop":"止损条件","takeProfit":"止盈条件","sizing":"仓位管理","leverage":"杠杆建议","invalidation":"失效/禁止条件","rationale":"依据"}],\n"reviewTemplates":["复盘要点/模板条目"],\n"concepts":[{"name":"概念名(<=12字)","meaning":"含义与适用边界(<=70字)"}],\n"counterViews":["反方观点或适用边界"]\n}\n数量参考：disciplineRules 3-8 条、strategies 0-5 条（没有可执行 setup 就留空）、concepts 4-8 个。\n\n资料正文：\n${text}`;
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

export async function importKnowledge(db, payload = {}) {
  await fs.mkdir(importsDir, { recursive: true });
  const prepared = await preparePayload(payload);
  const source = {
    id: id("src"),
    title: payload.title || payload.url || payload.fileName || payload.filePath || "Knowledge Source",
    type: payload.type || inferType({ ...payload, filePath: prepared.filePath }),
    url: payload.url?.trim() || undefined,
    filePath: prepared.filePath || payload.filePath,
    originalFileName: prepared.originalFileName,
    summary: payload.summary || "",
    createRuleDraft: payload.createRuleDraft === true,
    permission: payload.permission || "仅个人使用",
    status: "imported",
    trustScore: Number(payload.trustScore || 70),
    domain: payload.domain || "综合",
    author: payload.author || undefined,
    bookFocus: payload.bookFocus || undefined,
    importedAt: nowIso()
  };
  db.knowledge.sources.unshift(source);
  appendAudit(db, "真实导入知识来源", source.id, "KnowledgePipeline");
  return source;
}

export async function parseKnowledgeSource(db, sourceId) {
  const source = db.knowledge.sources.find((item) => item.id === sourceId);
  if (!source) return { status: "missing_source" };
  let text = "";
  if (source.type === "book_title") text = await generateBookSynthesis(source);
  else if (source.url) text = await extractFromUrl(source.url);
  else if (source.filePath) text = await extractFromFile(source.filePath);
  else text = `${source.title}\n${source.summary || ""}`;
  if (source.type === "book_title" && !text) {
    source.status = "failed";
    source.error = source.error || "未配置 LLM，无法按书名蒸馏知识";
    return { status: "failed", source, message: source.error };
  }

  db.knowledge.documentNodes = (db.knowledge.documentNodes || []).filter((node) => node.sourceId !== source.id);
  db.knowledge.chunks = (db.knowledge.chunks || []).filter((chunk) => chunk.sourceId !== source.id);
  db.knowledge.conceptCards = (db.knowledge.conceptCards || []).filter((concept) => !concept.sourceRefs?.includes(source.id));

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
  db.knowledge.documentNodes.unshift({ id: `node_${source.id}`, sourceId: source.id, parentId: null, nodeType: "document", title: source.title, orderIndex: 1, pageRange: "N/A" });
  db.knowledge.chunks.unshift(...chunks);

  // 优先 LLM 蒸馏出真正的概念/规则/反方观点；无 LLM 时退回高频词抽取。
  const distilled = await distillWithLlm(text, source).catch(() => null);
  let concepts;
  if (distilled?.concepts?.length) {
    concepts = distilled.concepts.slice(0, 8).map((item) => ({
      id: id("concept"),
      name: String(item.name || "").slice(0, 24) || "概念",
      domain: source.domain,
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

  // B 路 · 可回测策略假设 —— 只入库、硬闸禁止实盘，必须先回测通过才能升级为已验证策略。
  const strategies = (distilled?.strategies || []).slice(0, 5);
  for (const s of strategies) {
    if (!s || (!s.entry && !s.name)) continue;
    db.knowledge.strategyHypotheses.unshift({
      id: id("hypo"),
      name: String(s.name || `${source.title} 策略`).slice(0, 40),
      kind: String(s.kind || "other").slice(0, 20),
      symbolScope: String(s.symbolScope || "通用").slice(0, 40),
      timeframe: String(s.timeframe || "1H").slice(0, 8),
      direction: ["long", "short", "both"].includes(s.direction) ? s.direction : "both",
      entry: String(s.entry || "").slice(0, 200),
      stop: String(s.stop || "").slice(0, 160),
      takeProfit: String(s.takeProfit || "").slice(0, 160),
      sizing: String(s.sizing || "").slice(0, 120),
      leverage: String(s.leverage || "").slice(0, 40),
      invalidation: String(s.invalidation || "").slice(0, 160),
      rationale: String(s.rationale || "").slice(0, 200),
      source: { id: source.id, title: source.title },
      status: "待回测",     // 待回测 → 已验证 / 未通过
      executable: false,     // 硬闸：未回测通过前绝不实盘
      backtest: null,
      createdAt: nowIso()
    });
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
  return { status: "ok", source, chunks: chunks.length, concepts: concepts.length, ruleDraft, message: `已导入并解析 ${chunks.length} 个片段` };
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
  const approved = rules.filter((r) => r.status === "已批准");
  const pending = rules.filter((r) => r.status !== "已批准");
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
  db.knowledge.ruleProposals = [...out, ...approved];
  const removed = Math.max(0, pending.length - out.length);
  appendAudit(db, `规则库智能去重：待审批 ${pending.length} → ${out.length} 条`, "rule_dedup", "KnowledgePipeline");
  return { removed, remaining: db.knowledge.ruleProposals.length, method: usedLlm ? "llm" : "keep" };
}

// 词频检索（同步，回退用）：无 embedding 服务或片段未向量化时使用。
export function retrieveChunks(db, query, topK = 5) {
  const text = String(query || "").trim();
  if (!text) return [];
  const queryEmbedding = embedText(text);
  return (db.knowledge?.chunks || [])
    .map((chunk) => ({ ...chunk, score: cosine(queryEmbedding, chunk.lexical || embedText(chunk.text || "")), retrieval: "lexical" }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Number(topK || 5));
}

// 语义检索（异步，首选）：用稠密向量做余弦相似度；无 provider 或片段未向量化时自动回退词频。
export async function retrieveChunksSemantic(db, query, topK = 5) {
  const text = String(query || "").trim();
  if (!text) return [];
  const provider = embeddingProvider();
  if (!provider) return retrieveChunks(db, text, topK);
  const embeddedChunks = (db.knowledge?.chunks || []).filter((chunk) => Array.isArray(chunk.embedding) && chunk.embeddingModel === provider.model);
  if (!embeddedChunks.length) return retrieveChunks(db, text, topK);
  let queryVector;
  try {
    queryVector = await embedOne(text);
  } catch {
    return retrieveChunks(db, text, topK);
  }
  if (!queryVector) return retrieveChunks(db, text, topK);
  return embeddedChunks
    .map((chunk) => ({ ...chunk, score: denseCosine(queryVector, chunk.embedding), retrieval: "semantic" }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Number(topK || 5));
}

// 回填/重建全部片段的语义向量（配置 embedding 服务后调用一次）。
export async function reembedAllChunks(db) {
  const provider = embeddingProvider();
  if (!provider) return { status: "no_provider", message: "未配置 OpenAI/Gemini embedding，无法语义向量化。" };
  const chunks = db.knowledge?.chunks || [];
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

export function embeddingStatus(db) {
  const provider = embeddingProvider();
  const chunks = db.knowledge?.chunks || [];
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
  const chunks = await retrieveChunksSemantic(db, query, Number(options.topK || 5));
  const mode = chunks[0]?.retrieval || (embeddingProvider() ? "semantic" : "lexical");
  const answer = chunks.length
    ? `${mode === "semantic" ? "语义" : "词频"}召回 ${chunks.length} 个知识片段：${chunks.map((chunk) => chunk.citationLocator).join("、")}`
    : "未召回相关知识片段。";
  const bundle = {
    id: id("ab"),
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

export async function importGithubKnowledge(db, repoUrl, subPath = "") {
  await fs.mkdir(importsDir, { recursive: true });
  const target = path.join(importsDir, id("repo"));
  await simpleGit().clone(repoUrl, target, ["--depth", "1"]);
  const base = path.join(target, subPath || "");
  const files = await listTextFiles(base);
  const source = await importKnowledge(db, { title: repoUrl, type: "github", url: repoUrl, permission: "用户授权仓库", domain: "代码/Skill" });
  const combined = [];
  for (const file of files.slice(0, 80)) combined.push(`\n# ${path.relative(base, file)}\n${await fs.readFile(file, "utf8")}`);
  const syntheticPath = path.join(importsDir, `${source.id}.md`);
  await fs.writeFile(syntheticPath, combined.join("\n"), "utf8");
  source.filePath = syntheticPath;
  return parseKnowledgeSource(db, source.id);
}

async function extractFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`URL fetch failed ${response.status}`);
  const html = await response.text();
  const $ = cheerio.load(html);
  $("script,style,noscript").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
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

// EPUB = zip 里一堆 XHTML。解压后按 spine 顺序（拿不到就按文件名）抽正文文本。
async function extractFromEpub(filePath) {
  const JSZip = (await import("jszip")).default;
  const buf = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(buf);
  // 尝试从 OPF spine 拿阅读顺序
  let ordered = [];
  try {
    const containerFile = zip.file("META-INF/container.xml");
    if (containerFile) {
      const container = await containerFile.async("string");
      const opfPath = cheerio.load(container, { xmlMode: true })("rootfile").attr("full-path");
      const opfFile = opfPath && zip.file(opfPath);
      if (opfFile) {
        const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
        const $opf = cheerio.load(await opfFile.async("string"), { xmlMode: true });
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
  for (const name of ordered.slice(0, 400)) {
    const entry = zip.file(name);
    if (!entry) continue;
    try {
      const html = await entry.async("string");
      const $ = cheerio.load(html);
      $("script,style,nav,head").remove();
      const text = $("body").text().replace(/\s+/g, " ").trim();
      if (text) parts.push(text);
    } catch { /* 跳过坏章节 */ }
  }
  return parts.join("\n\n");
}

async function preparePayload(payload = {}) {
  if (payload.fileBase64) {
    const originalFileName = safeFileName(payload.fileName || "uploaded-knowledge.bin");
    const target = path.join(importsDir, `${id("upload")}_${originalFileName}`);
    const base64 = String(payload.fileBase64).replace(/^data:[^;]+;base64,/, "");
    await fs.writeFile(target, Buffer.from(base64, "base64"));
    return { filePath: target, originalFileName };
  }
  if (payload.content) {
    const originalFileName = safeFileName(payload.fileName || `${payload.title || "pasted-note"}.md`);
    const target = path.join(importsDir, `${id("note")}_${originalFileName}`);
    await fs.writeFile(target, String(payload.content), "utf8");
    return { filePath: target, originalFileName };
  }
  return { filePath: payload.filePath, originalFileName: payload.fileName };
}

function safeFileName(value) {
  const cleaned = String(value || "knowledge.md").replace(/[/\\?%*:|"<>]/g, "-").trim();
  return cleaned || "knowledge.md";
}

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

async function listTextFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && ![".git", "node_modules", "dist"].includes(entry.name)) files.push(...await listTextFiles(full));
    if (entry.isFile() && /\.(md|txt|json|yaml|yml|js|ts|py)$/i.test(entry.name)) files.push(full);
  }
  return files;
}

function inferType(payload) {
  if (payload.url?.includes("github.com")) return "github";
  if (payload.url) return "web";
  return path.extname(payload.filePath || "").slice(1) || "text";
}
