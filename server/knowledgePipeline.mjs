import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import mammoth from "mammoth";
import simpleGit from "simple-git";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

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

  const previousConceptIds = new Set((db.knowledge.conceptCards || []).filter((concept) => concept.sourceRefs?.includes(source.id)).map((concept) => concept.id));
  db.knowledge.documentNodes = (db.knowledge.documentNodes || []).filter((node) => node.sourceId !== source.id);
  db.knowledge.chunks = (db.knowledge.chunks || []).filter((chunk) => chunk.sourceId !== source.id);
  db.knowledge.conceptCards = (db.knowledge.conceptCards || []).filter((concept) => !concept.sourceRefs?.includes(source.id));
  db.knowledge.expertGraphNodes = (db.knowledge.expertGraphNodes || []).filter((node) => !previousConceptIds.has(node.refId));
  db.knowledge.expertGraphEdges = (db.knowledge.expertGraphEdges || []).filter((edge) => !edge.sourceRefs?.includes(source.id));

  const chunks = chunkText(text).map((chunk, index) => ({
    id: id("chunk"),
    sourceId: source.id,
    nodeId: `node_${source.id}`,
    text: chunk,
    embedding: embedText(chunk),
    citationLocator: `${source.title} #${index + 1}`,
    qualityScore: source.trustScore,
    createdAt: nowIso()
  }));
  if (!chunks.length) {
    source.status = "empty";
    appendAudit(db, "知识来源未解析出文本", source.id, "KnowledgePipeline", "warning");
    return { status: "empty", source, chunks: 0, concepts: 0, message: `${source.title} 没有解析出可用文本` };
  }
  db.knowledge.documentNodes.unshift({ id: `node_${source.id}`, sourceId: source.id, parentId: null, nodeType: "document", title: source.title, orderIndex: 1, pageRange: "N/A" });
  db.knowledge.chunks.unshift(...chunks);
  const concepts = extractConcepts(text).map((name) => ({
    id: id("concept"),
    name,
    domain: source.domain,
    sourceRefs: [source.id],
    indicators: [],
    tradingMeaning: `${name} 已从 ${source.title} 中抽取，等待专家复核。`,
    createdAt: nowIso()
  }));
  db.knowledge.conceptCards.unshift(...concepts);
  let ruleDraft = null;
  if (source.createRuleDraft) {
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
  for (const concept of concepts.slice(0, 8)) {
    const graphId = `graph_${concept.id}`;
    db.knowledge.expertGraphNodes.unshift({ id: graphId, nodeType: "concept", label: concept.name, refId: concept.id, weight: source.trustScore / 100 });
    db.knowledge.expertGraphEdges.unshift({ id: id("edge"), fromNode: graphId, toNode: "graph_rule_cpi_window", relationType: "related_to", confidence: 0.5, sourceRefs: [source.id] });
  }
  source.status = "parsed";
  source.parsedAt = nowIso();
  appendAudit(db, "解析并切片知识来源", source.id, "KnowledgePipeline");
  appendTrace(db, "knowledge_rag", `解析 ${source.title}`);
  return { status: "ok", source, chunks: chunks.length, concepts: concepts.length, ruleDraft, message: `已导入并解析 ${chunks.length} 个片段` };
}

// 纯检索：返回与 query 最相关的知识片段，不改动 db、不写审计。
// 供 Agent 决策上下文注入与专家分析复用。
export function retrieveChunks(db, query, topK = 5) {
  const text = String(query || "").trim();
  if (!text) return [];
  const queryEmbedding = embedText(text);
  return (db.knowledge?.chunks || [])
    .map((chunk) => ({ ...chunk, score: cosine(queryEmbedding, chunk.embedding || embedText(chunk.text || "")) }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Number(topK || 5));
}

export function ragQuery(db, query, options = {}) {
  const chunks = retrieveChunks(db, query, Number(options.topK || 5));
  const answer = chunks.length
    ? `召回 ${chunks.length} 个知识片段：${chunks.map((chunk) => chunk.citationLocator).join("、")}`
    : "未召回相关知识片段。";
  const bundle = {
    id: id("ab"),
    triggerType: "rag_query",
    question: query,
    summary: answer,
    retrievedRefs: chunks.map((chunk) => ({ chunkId: chunk.id, score: chunk.score, citationLocator: chunk.citationLocator })),
    citations: chunks.map((chunk) => chunk.id),
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
