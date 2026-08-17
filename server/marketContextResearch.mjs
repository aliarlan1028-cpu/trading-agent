import crypto from "node:crypto";
import { completeGeminiWebSearch, primaryModelRoute } from "./llmGateway.mjs";

const CONFIDENCE = new Set(["high", "medium", "low"]);
const MATERIALITY = new Set(["high", "medium", "low", "none"]);
const EVENT_TYPES = new Set([
  "macro_data_release", "central_bank_decision", "fiscal_policy", "trade_policy",
  "regulatory_action", "enforcement_action", "etf_flow", "token_listing",
  "protocol_upgrade", "project_partnership", "security_breach", "token_unlock",
  "market_liquidation", "institutional_activity", "geopolitical_event", "rumor", "other"
]);
const IMPACT_CHANNELS = new Set([
  "usd_rates", "global_liquidity", "risk_appetite", "regulation", "exchange_access",
  "token_supply", "network_usage", "security_trust", "institutional_demand",
  "derivatives_positioning", "spot_flow"
]);
const DRIVER_TYPES = new Set([
  "macro", "regulation", "etf_flow", "token_supply", "network", "security",
  "exchange", "institutional", "liquidation", "positioning", "sentiment", "none"
]);
const ANNOUNCEMENT = new Set(["announced", "proposed", "effective", "cancelled", "reported", "alleged", "unknown"]);
const DEFAULT_RESEARCH_TTL_MS = 60 * 60_000;
const MIN_RESEARCH_TTL_MS = 15 * 60_000;

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseJson(content) {
  const text = String(content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("market_context_json_missing");
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!parsed || typeof parsed !== "object" || !parsed.global || !Array.isArray(parsed.assets)) throw new Error("market_context_schema_invalid");
  return parsed;
}

function enums(values, allowed, max = 5) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => allowed.has(value)))].slice(0, max);
}

function normalizeItem(value = {}) {
  const sentiment = Number(value.sentimentScore);
  return {
    sentiment: Number.isFinite(sentiment) ? Math.max(0, Math.min(100, sentiment)) : null,
    confidence: CONFIDENCE.has(value.confidence) ? value.confidence : "low",
    materiality: MATERIALITY.has(value.materiality) ? value.materiality : "none",
    driverTypes: enums(value.driverTypes, DRIVER_TYPES),
    eventTypes: enums(value.eventTypes, EVENT_TYPES),
    impactChannels: enums(value.impactChannels, IMPACT_CHANNELS),
    announcementStatuses: enums(value.announcementStatuses, ANNOUNCEMENT)
  };
}

function finiteDuration(value, fallback, minimum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function normalizedItemShape(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && (value.sentiment === null || Number.isFinite(Number(value.sentiment)))
    && CONFIDENCE.has(value.confidence)
    && MATERIALITY.has(value.materiality)
    && Array.isArray(value.driverTypes)
    && Array.isArray(value.eventTypes)
    && Array.isArray(value.impactChannels)
    && Array.isArray(value.announcementStatuses));
}

export function validMarketResearchContext(context) {
  if (!context || typeof context !== "object" || Array.isArray(context)) return false;
  const researchedAt = new Date(context.researchedAt || 0).getTime();
  const expiresAt = new Date(context.expiresAt || 0).getTime();
  return typeof context.id === "string" && context.id.length > 0
    && typeof context.scopeHash === "string" && context.scopeHash.length > 0
    && Array.isArray(context.symbols)
    && Number.isFinite(researchedAt) && Number.isFinite(expiresAt) && expiresAt > researchedAt
    && normalizedItemShape(context.global)
    && Array.isArray(context.assets) && context.assets.every((row) => typeof row?.symbol === "string" && normalizedItemShape(row));
}

function citations(annotations = []) {
  const seen = new Set();
  const output = [];
  for (const annotation of Array.isArray(annotations) ? annotations : []) {
    const raw = annotation?.url_citation || annotation?.urlCitation || annotation;
    try {
      const url = new URL(String(raw?.url || raw?.uri || ""));
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      url.username = ""; url.password = ""; url.hash = "";
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      output.push({ url: url.href, source: url.hostname.replace(/^www\./, "") });
      if (output.length >= 12) break;
    } catch { /* invalid citation */ }
  }
  return output;
}

function researchSymbols(db, options = {}) {
  const mandate = (db.mandates || []).find((row) => ["active", "running"].includes(row.status));
  const whitelist = options.symbols || mandate?.allowedSymbols || [];
  const movers = (db.marketMovers?.movers || []).slice(0, 4).map((row) => row.symbol);
  return [...new Set([...whitelist, ...movers].map((value) => String(value || "").toUpperCase()).filter((value) => /^[A-Z0-9]{2,15}\/USDT$/.test(value)))].slice(0, 10);
}

export async function refreshMarketContextResearch(db, options = {}) {
  const requestedNow = Number(options.now ?? Date.now());
  const now = Number.isFinite(requestedNow) ? requestedNow : Date.now();
  const ttlMs = finiteDuration(
    options.ttlMs ?? process.env.MARKET_CONTEXT_RESEARCH_TTL_MS,
    DEFAULT_RESEARCH_TTL_MS,
    MIN_RESEARCH_TTL_MS
  );
  const symbols = researchSymbols(db, options);
  const scopeHash = hash(symbols);
  const cached = db.marketResearchContext;
  const cachedAt = new Date(cached?.researchedAt || 0).getTime();
  const cachedExpiresAt = new Date(cached?.expiresAt || 0).getTime();
  if (!options.force && validMarketResearchContext(cached) && cached.scopeHash === scopeHash
    && Number.isFinite(cachedAt) && Number.isFinite(cachedExpiresAt)
    && now - cachedAt >= 0 && now - cachedAt < ttlMs && now <= cachedExpiresAt) {
    return { status: "cached", context: cached, searchCalls: 0 };
  }
  if (!symbols.length) return { status: "skipped", reason: "no_research_symbols", searchCalls: 0 };
  if (!options.search && !primaryModelRoute()) return { status: "skipped", reason: "primary_model_not_configured", searchCalls: 0 };

  const movers = (db.marketMovers?.movers || []).slice(0, 6).map((row) => ({ symbol: row.symbol, changePct: row.changePct, quoteVolUsdt: row.quoteVolUsdt }));
  const global = db.marketRegime?.global || null;
  const prompt = [
    "你是数字货币市场背景研究器。用联网搜索一次性研究最近正在影响整体加密市场的事件，并分别检查给定币种近期独立利好/利空因素。不要给交易建议，不要输出叙事文字，只输出受控 JSON 枚举与数字。",
    "同一批次必须一次完成，不要为每个币启动独立搜索。只关注最近 24 小时仍可能影响市场的事实。",
    '{"global":{"sentimentScore":0,"confidence":"high|medium|low","materiality":"high|medium|low|none","driverTypes":["macro|regulation|etf_flow|token_supply|network|security|exchange|institutional|liquidation|positioning|sentiment|none"],"eventTypes":["macro_data_release|central_bank_decision|fiscal_policy|trade_policy|regulatory_action|enforcement_action|etf_flow|token_listing|protocol_upgrade|project_partnership|security_breach|token_unlock|market_liquidation|institutional_activity|geopolitical_event|rumor|other"],"impactChannels":["usd_rates|global_liquidity|risk_appetite|regulation|exchange_access|token_supply|network_usage|security_trust|institutional_demand|derivatives_positioning|spot_flow"],"announcementStatuses":["announced|proposed|effective|cancelled|reported|alleged|unknown"]},"assets":[{"symbol":"BTC/USDT","sentimentScore":0,"confidence":"high|medium|low","materiality":"high|medium|low|none","driverTypes":[],"eventTypes":[],"impactChannels":[],"announcementStatuses":[]}]}',
    `RESEARCH_SCOPE=${JSON.stringify({ symbols, deterministicMarketSnapshot: { global, movers } })}`
  ].join("\n");

  try {
    const search = options.search || completeGeminiWebSearch;
    const result = await search(prompt, { signal: options.signal });
    const parsed = parseJson(result.content);
    const allowed = new Set(symbols);
    const assets = parsed.assets.map((row) => ({ symbol: String(row.symbol || "").toUpperCase(), ...normalizeItem(row) }))
      .filter((row) => allowed.has(row.symbol)).slice(0, symbols.length);
    const normalizedGlobal = normalizeItem(parsed.global);
    const researchedAt = new Date(now).toISOString();
    const sourceCitations = citations(result.annotations);
    const normalizedOutput = { global: normalizedGlobal, assets, citations: sourceCitations };
    const context = {
      id: `market_context_${now}`,
      version: 1,
      scopeHash,
      symbols,
      researchedAt,
      expiresAt: new Date(now + ttlMs).toISOString(),
      inputHash: hash(prompt),
      outputHash: hash(normalizedOutput),
      global: normalizedGlobal,
      assets,
      citations: sourceCitations,
      citationCount: sourceCitations.length,
      provider: {
        model: result.metadata?.actualModel || result.metadata?.requestedModel || null,
        provider: result.metadata?.actualProvider || null,
        attributionVerified: result.metadata?.providerAttributionVerified === true,
        responseId: result.metadata?.responseId || null
      },
      trust: "untrusted_external_research",
      mayTriggerTradeDirectly: false
    };
    db.marketResearchContext = context;
    return { status: "ok", context, searchCalls: 1 };
  } catch (error) {
    return { status: "failed", error: String(error?.message || error).slice(0, 180), context: cached || null, searchCalls: 1 };
  }
}

export function marketContextForAgent(db, options = {}) {
  const context = db.marketResearchContext;
  if (!validMarketResearchContext(context)) return null;
  const requestedNow = Number(options.now ?? Date.now());
  const now = Number.isFinite(requestedNow) ? requestedNow : Date.now();
  const ageMs = now - new Date(context.researchedAt || 0).getTime();
  const stale = !Number.isFinite(ageMs) || ageMs < 0 || now > new Date(context.expiresAt || 0).getTime();
  const wanted = new Set((options.symbols || context.symbols || []).map((value) => String(value).toUpperCase()));
  return {
    id: context.id,
    researchedAt: context.researchedAt,
    status: stale ? "stale" : "fresh",
    global: context.global,
    assets: (context.assets || []).filter((row) => !wanted.size || wanted.has(row.symbol)),
    citationCount: Number(context.citationCount || 0),
    inputHash: /^[a-f0-9]{64}$/.test(String(context.inputHash || "")) ? context.inputHash : null,
    outputHash: /^[a-f0-9]{64}$/.test(String(context.outputHash || "")) ? context.outputHash : null,
    model: context.provider?.model || null,
    provider: context.provider?.provider || null,
    providerAttributionVerified: context.provider?.attributionVerified === true,
    mayTriggerTradeDirectly: false
  };
}

export function marketResearchAuditEvidence(db, options = {}) {
  const context = marketContextForAgent(db, options);
  if (!context) return null;
  return {
    version: 1,
    contextId: context.id,
    status: context.status,
    researchedAt: context.researchedAt,
    inputHash: context.inputHash,
    outputHash: context.outputHash,
    model: context.model,
    provider: context.provider,
    providerAttributionVerified: context.providerAttributionVerified === true,
    mayTriggerTradeDirectly: false
  };
}

export function marketContextForPrompt(db, options = {}) {
  const context = marketContextForAgent(db, options);
  if (!context) return null;
  const lines = [
    `缓存=${context.id}｜状态=${context.status}｜研究时间=${context.researchedAt}｜引用数=${context.citationCount}｜模型=${context.model || "unknown"}｜Provider=${context.provider || "unknown"}｜Provider归因=${context.providerAttributionVerified}｜输入哈希=${context.inputHash || "none"}｜输出哈希=${context.outputHash || "none"}`,
    `- 全局：情绪=${context.global.sentiment ?? "unknown"}｜重要性=${context.global.materiality}｜置信=${context.global.confidence}｜驱动=${context.global.driverTypes.join(",") || "none"}｜事件=${context.global.eventTypes.join(",") || "none"}｜渠道=${context.global.impactChannels.join(",") || "none"}`,
    ...(context.assets || []).map((row) => `- ${row.symbol}：情绪=${row.sentiment ?? "unknown"}｜重要性=${row.materiality}｜置信=${row.confidence}｜驱动=${row.driverTypes.join(",") || "none"}｜事件=${row.eventTypes.join(",") || "none"}｜渠道=${row.impactChannels.join(",") || "none"}`),
    "边界：这是低频批量联网研究的受控投影，不是订单信号；交易方向仍必须由本轮 OKX 结构、微观数据和硬风控独立支持。状态 stale 时只能说明历史背景，不能当当前催化剂。"
  ];
  return lines.join("\n");
}
