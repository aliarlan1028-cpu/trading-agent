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

// LLM 蒸馏：把资料提炼成"概念 + 规则 + 反方观点"，而不是取高频词。无 LLM key 时返回 null。
async function distillWithLlm(text, source) {
  const system = "你是专业的金融/交易知识蒸馏助手，服务于一个交易加密货币永续合约（带杠杆、硬风控、短中周期）的 Agent。只输出 JSON，不要多余文字。资料可能来自传统金融——若涉及股票、长期持有、无杠杆等，请在 meaning 里注明其资产类别与时间周期的适用边界，避免被误用到杠杆合约。";
  const prompt = `资料标题：${source.title}\n领域：${source.domain || "未标注"}\n\n蒸馏为 JSON（概念 5-8 个、规则 2-4 条）：\n{"summary":"一句话主旨","concepts":[{"name":"概念名(<=12字)","meaning":"在交易/风控中的含义与用法及适用边界(<=70字)"}],"rules":[{"name":"规则名","condition":"触发条件","action":"pause_opening|notify|reduce|none","rationale":"依据"}],"counterViews":["需警惕的反方观点或适用边界"]}\n\n资料正文：\n${text}`;
  const raw = await llmComplete(prompt, system);
  if (!raw) return null;
  try {
    return JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch {
    return null;
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
  if (source.url) text = await extractFromUrl(source.url);
  else if (source.filePath) text = await extractFromFile(source.filePath);
  else text = `${source.title}\n${source.summary || ""}`;

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

  let ruleDraft = null;
  const distilledRules = (distilled?.rules || []).slice(0, 4);
  if (distilledRules.length) {
    for (const rule of distilledRules) {
      const draft = {
        id: id("rule"),
        name: String(rule.name || `${source.title} 规则`).slice(0, 40),
        level: "L2",
        status: "待审批",
        action: ["pause_opening", "notify", "reduce", "none"].includes(rule.action) ? rule.action : "notify",
        condition: String(rule.condition || "").slice(0, 160),
        description: String(rule.rationale || rule.condition || `由 ${source.title} 蒸馏，请人工复核后启用`).slice(0, 240),
        sourceRefs: [source.id],
        distilledBy: "llm",
        createdAt: nowIso()
      };
      db.knowledge.ruleProposals.unshift(draft);
      ruleDraft = ruleDraft || draft;
    }
  } else if (source.createRuleDraft) {
    ruleDraft = {
      id: id("rule"),
      name: `${source.title} 规则草案`,
      level: "L2",
      status: "待审批",
      action: "notify",
      description: `由 ${source.title} 自动生成的知识规则草案，请人工复核后再启用。`,
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
  return fs.readFile(filePath, "utf8");
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
