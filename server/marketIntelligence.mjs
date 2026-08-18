import crypto from "node:crypto";
import * as cheerio from "cheerio";
import { fetchExternalText } from "./externalInputSafety.mjs";
import { createNotification } from "./notificationStore.mjs";
import { appendAudit, appendTrace, nowIso } from "./store.mjs";
import { getOfficialCalendar, refreshOfficialCalendar } from "./officialCalendar.mjs";
import { buildMacroRegimeContext, macroRegimeForPrompt } from "./macroRegime.mjs";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FNG_URL = "https://api.alternative.me/fng/?limit=2";
const FARSIDE_BTC_URL = "https://farside.co.uk/bitcoin-etf-flow-all-data/";
const FARSIDE_ETH_URL = "https://farside.co.uk/ethereum-etf-flow-all-data/";

function enabled(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

export function recordSourceHealth(db, source, result = {}) {
  db.marketIntelligenceSourceHealth ||= {};
  const sourceId = String(source.id || source.sourceId);
  const previous = db.marketIntelligenceSourceHealth[sourceId] || {};
  const checkedAt = result.checkedAt || nowIso();
  const ok = result.status === "ok";
  const hasUsableData = ok || result.status === "partial";
  const isNewAttempt = previous.lastAttemptAt !== checkedAt;
  const next = {
    ...previous,
    sourceId,
    name: source.name || source.sourceName || previous.name || sourceId,
    url: source.url || source.sourceUrl || previous.url || null,
    category: source.category || previous.category || "supplemental",
    required: source.required ?? previous.required ?? false,
    configured: result.status !== "unconfigured",
    status: result.status || "unknown",
    checkedAt,
    lastAttemptAt: checkedAt,
    latencyMs: finite(result.latencyMs),
    itemCount: finite(result.itemCount ?? result.events?.length),
    staleAfterMs: Number(source.staleAfterMs || previous.staleAfterMs || 2 * HOUR),
    consecutiveFailures: ok ? 0 : result.status === "unconfigured" ? 0 : isNewAttempt ? Number(previous.consecutiveFailures || 0) + 1 : Number(previous.consecutiveFailures || 0),
    lastError: ok ? null : String(result.error || result.reason || result.status || "unknown").slice(0, 180)
  };
  if (ok) {
    next.lastSuccessAt = checkedAt;
  }
  if (hasUsableData) next.lastDataAt = result.lastDataAt || result.dataAt || checkedAt;
  db.marketIntelligenceSourceHealth[sourceId] = next;
  return next;
}

export function syncEventSourceHealth(db) {
  for (const source of db.eventSources || []) {
    const status = source.lastStatus === "ok" ? "ok" : source.lastStatus === "failed" ? "failed" : "unknown";
    recordSourceHealth(db, {
      id: source.id, name: source.name, url: source.url, category: "news", required: true, staleAfterMs: 60 * 60_000
    }, {
      status,
      checkedAt: source.lastAttemptAt || source.lastFetchedAt || source.createdAt || nowIso(),
      lastDataAt: source.lastSuccessAt || source.lastFetchedAt,
      itemCount: source.lastItemCount,
      error: source.lastError
    });
  }
}

export function sourceHealthSummary(db, now = Date.now()) {
  syncEventSourceHealth(db);
  return Object.values(db.marketIntelligenceSourceHealth || {}).map((item) => {
    const successAt = new Date(item.lastSuccessAt || item.lastDataAt || 0).getTime();
    const ageMs = Number.isFinite(successAt) && successAt > 0 ? Math.max(0, now - successAt) : null;
    let health = item.status === "unconfigured" ? "unconfigured" : ["failed", "partial"].includes(item.status) ? "degraded" : "healthy";
    if (item.configured !== false && (ageMs === null || ageMs > Number(item.staleAfterMs || 2 * HOUR))) health = "stale";
    return { ...item, ageMs, health };
  }).sort((a, b) => String(a.category).localeCompare(String(b.category)) || String(a.name).localeCompare(String(b.name)));
}

function maybeAlertStaleNews(db) {
  const core = sourceHealthSummary(db).filter((source) => source.category === "news" && source.required);
  if (!core.length || core.some((source) => source.health === "healthy" || source.health === "degraded")) return;
  db.meta ||= {};
  const last = new Date(db.meta.lastStaleNewsAlertAt || 0).getTime();
  if (Date.now() - last < 6 * HOUR) return;
  createNotification(db, {
    eventType: "market_intelligence_stale", severity: "warning", title: "信息面数据已陈旧",
    body: `核心新闻源均未在新鲜度窗口内成功更新；Agent 将把新闻视为陈旧背景，不得当作当前催化剂。`
  });
  db.meta.lastStaleNewsAlertAt = nowIso();
  appendAudit(db, "核心新闻源全部陈旧，已降级信息面并告警", "market_intelligence", "MarketIntelligence", "warning");
}

export function upsertIntelligenceFact(db, input = {}) {
  db.marketIntelligenceFacts ||= [];
  const observedAt = input.observedAt || nowIso();
  const publishedAt = input.publishedAt || observedAt;
  const identity = input.externalId || input.sourceUrl || `${input.type}|${input.title}|${publishedAt}`;
  const factId = input.id || `fact_${stableHash([input.sourceId, identity])}`;
  const existing = db.marketIntelligenceFacts.find((fact) => fact.id === factId);
  const fact = {
    id: factId,
    type: input.type || "news",
    category: input.category || input.type || "news",
    sourceId: input.sourceId || "unknown",
    sourceName: input.sourceName || input.sourceId || "unknown",
    sourceUrl: input.sourceUrl || null,
    externalId: input.externalId || null,
    title: String(input.title || "").slice(0, 240),
    summary: String(input.summary || "").slice(0, 1200),
    symbols: [...new Set((input.symbols || []).map((symbol) => String(symbol).toUpperCase()))].slice(0, 12),
    values: input.values || {},
    confidence: Math.max(0, Math.min(1, Number(input.confidence ?? 0.6))),
    status: input.status || "observed",
    publishedAt,
    observedAt,
    validUntil: input.validUntil || new Date(new Date(publishedAt).getTime() + Number(input.ttlMs || 24 * HOUR)).toISOString(),
    evidence: { sourceId: input.sourceId || "unknown", sourceUrl: input.sourceUrl || null, retrievedAt: observedAt },
    updatedAt: nowIso(),
    createdAt: existing?.createdAt || nowIso()
  };
  if (existing) Object.assign(existing, fact);
  else db.marketIntelligenceFacts.unshift(fact);
  return existing || fact;
}

function ingestEventFacts(db) {
  let count = 0;
  for (const event of (db.events || []).filter((item) => item.kind !== "onchain_signal").slice(0, 120)) {
    const latest = event.timeline?.[0];
    const source = (db.eventSources || []).find((item) => item.id === event.sourceId || item.name === latest?.source);
    const publishedAt = latest?.at || event.due || event.createdAt || nowIso();
    upsertIntelligenceFact(db, {
      type: "news", category: event.category || "news", sourceId: source?.id || event.sourceId || "event_pipeline",
      sourceName: latest?.source || source?.name || "Event Pipeline", sourceUrl: latest?.link || event.sourceLink,
      externalId: event.id, title: event.rawTitle || event.title, summary: event.intel?.oneLine || event.summary || event.action,
      symbols: event.intel?.affectedSymbols?.map((symbol) => `${symbol}/USDT`) || event.relatedSymbols || [],
      confidence: event.intel?.credibility ?? Number(event.confidence || 60) / 100,
      publishedAt, observedAt: event.lastUpdatedAt || event.createdAt, ttlMs: 36 * HOUR,
      values: {
        impact: event.impact,
        sentiment: event.intel?.sentiment,
        pricedIn: event.intel?.pricedIn,
        fakeRisk: event.intel?.fakeRisk,
        // 复盘只能消费服务端已验证的来源身份；不能把“没有 verified 字段”误当作已验证。
        trustTier: event.intel?.trustTier || event.provenance?.trustTier || "unknown",
        verifiedOrigin: event.intel?.verifiedOrigin === true && event.provenance?.verifiedOrigin !== false,
        autoTradingEligible: event.autoTradingEligible === true
      }
    });
    count += 1;
  }
  return count;
}

async function fetchJson(url, options = {}) {
  const startedAt = Date.now();
  const { response, text } = await fetchExternalText(url, {
    timeoutMs: options.timeoutMs || 12_000, maxBytes: options.maxBytes || 2 * 1024 * 1024, headers: options.headers
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  let json;
  try { json = JSON.parse(text); } catch { throw new Error("响应不是有效 JSON"); }
  return { json, latencyMs: Date.now() - startedAt };
}

async function refreshFearGreed(db) {
  const startedAt = Date.now();
  try {
    const { json } = await fetchJson(FNG_URL);
    const latest = json?.data?.[0];
    if (!latest || finite(latest.value) === null) throw new Error("Fear & Greed 响应缺少最新值");
    const publishedAt = new Date(Number(latest.timestamp) * 1000).toISOString();
    upsertIntelligenceFact(db, {
      type: "sentiment", category: "sentiment", sourceId: "alternative_fng", sourceName: "Alternative.me",
      sourceUrl: FNG_URL, externalId: String(latest.timestamp), title: "Bitcoin Fear & Greed Index",
      summary: `${latest.value} · ${latest.value_classification || "unknown"}`, symbols: ["BTC/USDT"],
      confidence: 0.55, publishedAt, ttlMs: 36 * HOUR,
      values: { value: finite(latest.value), classification: latest.value_classification || null, supplementalOnly: true }
    });
    return { status: "ok", itemCount: 1, lastDataAt: publishedAt, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { status: "failed", error: String(error.message || error), latencyMs: Date.now() - startedAt };
  }
}

function parseFlowMillions(text) {
  const raw = String(text || "").replace(/[$,*\s]/g, "");
  if (!raw || raw === "-" || /^n\/?a$/i.test(raw)) return null;
  const negative = raw.startsWith("(") && raw.endsWith(")");
  const value = Number(raw.replace(/[()]/g, ""));
  return Number.isFinite(value) ? (negative ? -value : value) : null;
}

function parseEnglishDate(text) {
  const match = String(text || "").trim().match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(20\d{2})$/);
  if (!match) return null;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const month = months.indexOf(match[2].toLowerCase());
  if (month < 0) return null;
  return new Date(Date.UTC(Number(match[3]), month, Number(match[1]), 12)).toISOString();
}

export function parseFarsideEtfHtml(html) {
  const $ = cheerio.load(html || "");
  const byDate = new Map();
  $("tr").each((_index, row) => {
    const cells = $(row).find("th,td").map((_cell, element) => $(element).text().replace(/\s+/g, " ").trim()).get();
    if (cells.length < 2) return;
    const date = parseEnglishDate(cells[0]);
    const totalMillions = parseFlowMillions(cells.at(-1));
    if (!date || totalMillions === null) return;
    byDate.set(date, { date, totalMillions });
  });
  return [...byDate.values()].sort((a, b) => new Date(b.date) - new Date(a.date));
}

async function refreshFarsideAsset(db, asset, url) {
  const startedAt = Date.now();
  try {
    const { response, text } = await fetchExternalText(url, { timeoutMs: 15_000, maxBytes: 3 * 1024 * 1024 });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = parseFarsideEtfHtml(text);
    if (!rows.length) throw new Error("公开 ETF 页面没有可解析的日流量表");
    const latest = rows[0];
    if (Date.now() - new Date(latest.date).getTime() > 5 * DAY) throw new Error(`最新 ETF 数据已陈旧：${latest.date.slice(0, 10)}`);
    const weeklyNetUsd = rows.slice(0, 7).reduce((sum, row) => sum + row.totalMillions * 1_000_000, 0);
    upsertIntelligenceFact(db, {
      type: "flow", category: "etf_flow", sourceId: `farside_${asset.toLowerCase()}_etf`, sourceName: "Farside Investors",
      sourceUrl: url, externalId: latest.date.slice(0, 10), title: `${asset} spot ETF flows`,
      summary: `${asset} 美国现货 ETF 日净流量（公开网页，非实时盘中数据）`, symbols: [`${asset}/USDT`],
      confidence: 0.7, publishedAt: latest.date, ttlMs: 5 * DAY,
      values: { dailyNetUsd: latest.totalMillions * 1_000_000, weeklyNetUsd, timePrecision: "date", units: "USD", publicHtmlSource: true }
    });
    return { status: "ok", itemCount: rows.length, lastDataAt: latest.date, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { status: "failed", error: String(error.message || error), latencyMs: Date.now() - startedAt };
  }
}

async function refreshPublicEtfFlows(db) {
  if (!enabled(process.env.FARSIDE_ETF_ENABLED, true)) return { status: "unconfigured", reason: "disabled" };
  const previous = db.marketIntelligenceSourceHealth?.farside_etf_flows;
  if (previous?.lastAttemptAt && Date.now() - new Date(previous.lastAttemptAt).getTime() < 6 * HOUR) {
    return { status: "not_due", cachedStatus: previous.status, lastDataAt: previous.lastDataAt };
  }
  const [btc, eth] = await Promise.all([
    refreshFarsideAsset(db, "BTC", FARSIDE_BTC_URL),
    refreshFarsideAsset(db, "ETH", FARSIDE_ETH_URL)
  ]);
  const ok = [btc, eth].filter((item) => item.status === "ok");
  return {
    status: ok.length === 2 ? "ok" : ok.length ? "partial" : "failed",
    itemCount: ok.reduce((sum, item) => sum + Number(item.itemCount || 0), 0),
    lastDataAt: ok.map((item) => item.lastDataAt).sort().at(-1) || null,
    error: ok.length === 2 ? null : [btc.error, eth.error].filter(Boolean).join(" | ").slice(0, 180),
    assets: { btc, eth }
  };
}

export function ingestOkxLiquidationActivity(db) {
  const smart = db.marketRegime?.smartMoney;
  const liquidation = smart?.liquidations;
  const fetchedAt = smart?.fetchedAt || db.marketRegime?.fetchedAt || db.marketRegime?.updatedAt;
  if (!liquidation || !fetchedAt || Date.now() - new Date(fetchedAt).getTime() > 30 * 60_000) return null;
  return upsertIntelligenceFact(db, {
    type: "flow", category: "okx_liquidation_activity", sourceId: "okx_public_liquidations", sourceName: "OKX",
    sourceUrl: "https://www.okx.com/docs-v5/en/#public-data-websocket-liquidation-orders-channel", externalId: `${smart.symbol || "market"}:${Math.floor(new Date(fetchedAt).getTime() / 300_000)}`,
    title: `${smart.symbol || "OKX"} liquidation activity`, summary: "OKX 公开 WebSocket 连续窗口内的多空强平事件数量；不是全市场美元强平总额",
    symbols: smart.symbol ? [smart.symbol] : [], confidence: 0.9, publishedAt: fetchedAt, ttlMs: 30 * 60_000,
    values: {
      scope: "OKX", metric: "event_count", totalCount: Number(liquidation.total || 0),
      longLiquidationCount: Number(liquidation.longLiqCount || 0), shortLiquidationCount: Number(liquidation.shortLiqCount || 0),
      dominantSide: liquidation.dominantSide, windowMs: liquidation.windowMs, coverageMs: liquidation.coverageMs,
      completeWindow: liquidation.completeWindow === true, sourceTransport: liquidation.source,
      usdNotional: null, globalMarketTotal: false
    }
  });
}

function recordCalendarHealth(db, refresh) {
  for (const result of refresh.results || []) {
    recordSourceHealth(db, {
      id: result.sourceId, name: result.sourceName, url: result.sourceUrl, category: "calendar", required: result.sourceId === "official_fomc_calendar", staleAfterMs: 7 * DAY
    }, { ...result, itemCount: result.events?.length, lastDataAt: result.status === "ok" ? nowIso() : null });
  }
}

function pruneFacts(db) {
  const cutoff = Date.now() - 30 * DAY;
  db.marketIntelligenceFacts = (db.marketIntelligenceFacts || []).filter((fact) => new Date(fact.publishedAt || fact.createdAt || 0).getTime() >= cutoff).slice(0, 2000);
}

export function removeLegacyPaidFlowData(db) {
  const removedFactIds = new Set();
  db.marketIntelligenceFacts = (db.marketIntelligenceFacts || []).filter((fact) => {
    const sourceId = String(fact.sourceId || "").toLowerCase();
    const isLegacy = sourceId.startsWith("coinglass") || sourceId === "me_news_crypto" || fact.category === "global_liquidation";
    if (isLegacy) removedFactIds.add(fact.id);
    return !isLegacy;
  });
  db.marketIntelligenceSourceHealth ||= {};
  for (const [sourceId, source] of Object.entries(db.marketIntelligenceSourceHealth)) {
    const identity = `${sourceId} ${source?.name || ""}`.toLowerCase();
    if (identity.includes("coinglass") || sourceId === "me_news_crypto") delete db.marketIntelligenceSourceHealth[sourceId];
  }
  for (const brief of db.dailyBriefs || []) {
    brief.topNews = (brief.topNews || []).filter((item) => !removedFactIds.has(item.factId));
    brief.evidenceFactIds = (brief.evidenceFactIds || []).filter((factId) => !removedFactIds.has(factId));
    if (brief.dataQuality) {
      brief.dataQuality.unconfiguredSources = (brief.dataQuality.unconfiguredSources || []).filter((sourceId) => sourceId !== "me_news_crypto");
      brief.dataQuality.healthySources = (brief.dataQuality.healthySources || []).filter((sourceId) => sourceId !== "me_news_crypto");
      brief.dataQuality.staleRequiredSources = (brief.dataQuality.staleRequiredSources || []).filter((sourceId) => sourceId !== "me_news_crypto");
    }
    if (!brief.flow) continue;
    delete brief.flow.globalLiquidation;
    if (String(brief.flow.btcEtf?.sourceId || "").toLowerCase().startsWith("coinglass")) brief.flow.btcEtf = null;
    if (String(brief.flow.ethEtf?.sourceId || "").toLowerCase().startsWith("coinglass")) brief.flow.ethEtf = null;
    brief.flow.unavailable = (brief.flow.unavailable || []).filter((name) => name !== "global_liquidation");
  }
}

function cnDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function getMarketIntelligence(db, { symbols = [], horizonHours = 48, categories = [], limit = 30, asOf = Date.now() } = {}) {
  const now = new Date(asOf).getTime();
  const cutoff = now - Math.max(1, Number(horizonHours || 48)) * HOUR;
  const wantedSymbols = new Set((symbols || []).map((symbol) => String(symbol).toUpperCase()));
  const wantedCategories = new Set((categories || []).map(String));
  return (db.marketIntelligenceFacts || []).filter((fact) => {
    const published = new Date(fact.publishedAt || 0).getTime();
    const notExpired = !fact.validUntil || new Date(fact.validUntil).getTime() >= now;
    const symbolMatch = !wantedSymbols.size || (fact.symbols || []).some((symbol) => wantedSymbols.has(symbol));
    const categoryMatch = !wantedCategories.size || wantedCategories.has(fact.category) || wantedCategories.has(fact.type);
    return published >= cutoff && published <= now && notExpired && symbolMatch && categoryMatch;
  }).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)).slice(0, Math.min(100, Math.max(1, Number(limit || 30))));
}

const AGENT_FACT_VALUE_KEYS = new Set([
  "impact", "important", "marketRelevant", "categoryId", "receivedLatencyMs", "aggregator",
  "analysisContextOnly", "mayTriggerTradeDirectly", "sentiment", "pricedIn", "fakeRisk",
  "value", "supplementalOnly", "dailyNetUsd", "weeklyNetUsd", "timePrecision", "units",
  "publicHtmlSource", "scope", "metric", "totalCount", "longLiquidationCount",
  "shortLiquidationCount", "dominantSide", "windowMs", "coverageMs", "completeWindow",
  "sourceTransport", "usdNotional", "globalMarketTotal"
]);

function safeFactScalar(value) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value || "");
  if (/^[a-z0-9_.:+/-]{1,64}$/i.test(text)) return text;
  if (["利多", "利空", "中性", "无", "多", "空", "平衡"].includes(text)) return text;
  return undefined;
}

function safeFactId(value, fallback = "") {
  const text = String(value || "").replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 120);
  return text || fallback;
}

function safeIsoTimestamp(value) {
  if (!value) return null;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
}

function safeSourceIds(values = []) {
  return (Array.isArray(values) ? values : []).map((value) => safeFactId(value)).filter(Boolean).slice(0, 40);
}

function factValuesForAgent(values = {}) {
  const projected = {};
  for (const [key, value] of Object.entries(values || {})) {
    if (!AGENT_FACT_VALUE_KEYS.has(key)) continue;
    const safe = safeFactScalar(value);
    if (safe !== undefined) projected[key] = safe;
  }
  const verification = values?.newsVerification;
  if (verification && typeof verification === "object") {
    projected.newsVerification = {
      verificationStatus: safeFactScalar(verification.verificationStatus) || "search_unavailable",
      category: safeFactScalar(verification.category) || "unknown",
      sentiment: Number.isFinite(Number(verification.sentiment)) ? Number(verification.sentiment) : null,
      confidence: safeFactScalar(verification.confidence) || "low",
      materiality: safeFactScalar(verification.materiality) || "none",
      eventType: safeFactScalar(verification.eventType) || "other",
      impactChannels: (verification.impactChannels || []).map(safeFactScalar).filter(Boolean).slice(0, 4),
      scope: safeFactScalar(verification.scope) || "unknown",
      announcementStatus: safeFactScalar(verification.announcementStatus) || "unknown",
      citationCount: Number.isFinite(Number(verification.citationCount)) ? Number(verification.citationCount) : 0,
      providerAttributionVerified: verification.providerAttributionVerified === true,
      evidenceId: safeFactScalar(verification.evidenceId) || null,
      verifiedAt: verification.verifiedAt || null,
      mayTriggerTradeDirectly: false
    };
  }
  return projected;
}

export function marketIntelligenceFactForAgent(fact = {}) {
  return {
    factId: safeFactId(fact.id || fact.factId),
    type: safeFactScalar(fact.type) || "unknown",
    category: safeFactScalar(fact.category) || "unknown",
    sourceId: safeFactId(fact.sourceId, "unknown"),
    symbols: [...new Set((fact.symbols || []).map((symbol) => String(symbol).toUpperCase()).filter((symbol) => /^[A-Z0-9]{2,15}\/USDT$/.test(symbol)))].slice(0, 12),
    confidence: Number.isFinite(Number(fact.confidence)) ? Math.max(0, Math.min(1, Number(fact.confidence))) : null,
    status: safeFactScalar(fact.status) || "unknown",
    publishedAt: safeIsoTimestamp(fact.publishedAt),
    validUntil: safeIsoTimestamp(fact.validUntil),
    values: factValuesForAgent(fact.values)
  };
}

export function getMarketIntelligenceForAgent(db, options = {}) {
  return getMarketIntelligence(db, options).map(marketIntelligenceFactForAgent);
}

export function getFlowSnapshot(db) {
  const facts = getMarketIntelligence(db, { categories: ["okx_liquidation_activity", "etf_flow", "sentiment"], horizonHours: 120, limit: 20 });
  return {
    asOf: nowIso(),
    okxLiquidationActivity: facts.find((fact) => fact.category === "okx_liquidation_activity") || null,
    btcEtf: facts.find((fact) => fact.category === "etf_flow" && fact.symbols?.includes("BTC/USDT")) || null,
    ethEtf: facts.find((fact) => fact.category === "etf_flow" && fact.symbols?.includes("ETH/USDT")) || null,
    sentiment: facts.find((fact) => fact.category === "sentiment") || null,
    unavailable: [
      !facts.some((fact) => fact.category === "okx_liquidation_activity") ? "okx_liquidation_activity" : null,
      !facts.some((fact) => fact.category === "etf_flow") ? "etf_flow" : null
    ].filter(Boolean)
  };
}

export function getFlowSnapshotForAgent(db) {
  const flow = getFlowSnapshot(db);
  return {
    asOf: flow.asOf,
    okxLiquidationActivity: flow.okxLiquidationActivity ? marketIntelligenceFactForAgent(flow.okxLiquidationActivity) : null,
    btcEtf: flow.btcEtf ? marketIntelligenceFactForAgent(flow.btcEtf) : null,
    ethEtf: flow.ethEtf ? marketIntelligenceFactForAgent(flow.ethEtf) : null,
    sentiment: flow.sentiment ? marketIntelligenceFactForAgent(flow.sentiment) : null,
    unavailable: flow.unavailable
  };
}

export function officialCalendarEventForAgent(event = {}) {
  return {
    eventId: safeFactId(event.id || event.eventId),
    category: safeFactScalar(event.category) || "unknown",
    due: safeIsoTimestamp(event.due || event.startAt),
    timePrecision: ["minute", "date"].includes(event.timePrecision) ? event.timePrecision : "unknown",
    importance: Number.isFinite(Number(event.importance ?? event.impact)) ? Number(event.importance ?? event.impact) : null,
    verifiedOrigin: event.verifiedOrigin === true,
    mayTriggerTradeDirectly: false
  };
}

export function buildDailyBrief(db, options = {}) {
  const asOf = options.asOf || nowIso();
  const asOfMs = new Date(asOf).getTime();
  const date = options.date || cnDateKey(new Date(asOf));
  const news = getMarketIntelligence(db, { categories: ["news", "flash_news", "币圈事件", "宏观事件"], horizonHours: 36, limit: 16, asOf: asOfMs })
    .sort((a, b) => (Number(b.values?.impact || 0) - Number(a.values?.impact || 0)) || (Number(b.confidence || 0) - Number(a.confidence || 0))).slice(0, 8);
  const calendar = getOfficialCalendar(db, { from: asOfMs, to: asOfMs + 72 * HOUR });
  const flow = getFlowSnapshot(db);
  const health = sourceHealthSummary(db);
  const staleRequired = health.filter((source) => source.required && source.health !== "healthy").map((source) => source.sourceId);
  const exactEventSoon = calendar.find((event) => event.timePrecision === "minute" && new Date(event.due).getTime() - asOfMs <= 90 * 60_000);
  const constraints = [];
  if (exactEventSoon) constraints.push({
    type: "event_blackout_attention",
    severity: "high",
    eventId: exactEventSoon.id,
    due: exactEventSoon.due,
    reasonCode: "official_minute_event_within_90m"
  });
  if (calendar.some((event) => event.timePrecision === "date" && new Date(event.due).getTime() - asOfMs <= 24 * HOUR)) {
    constraints.push({ type: "date_only_event_attention", severity: "medium", reason: "未来 24 小时存在仅确认日期、未确认精确时刻的官方事件；不得据此伪造分钟级静默窗口。" });
  }
  if (staleRequired.length) constraints.push({ type: "stale_information", severity: "medium", reason: `部分必要信息源陈旧或失败：${staleRequired.join(", ")}；不得把旧内容当作当前催化剂。` });
  const macroContext = buildMacroRegimeContext(db, { asOf, upcomingEvents: calendar });
  const brief = {
    id: `daily_brief_${date}`,
    date, timeZone: "Asia/Shanghai", asOf,
    dataCutoff: asOf,
    version: 1,
    role: "analysis_context_only",
    mayTriggerTradeDirectly: false,
    topNews: news.map((fact) => ({ factId: fact.id, title: fact.title, summary: fact.summary, symbols: fact.symbols, publishedAt: fact.publishedAt, confidence: fact.confidence, values: fact.values })),
    upcomingEvents: calendar.slice(0, 12),
    macroContext,
    flow,
    market: {
      regime: db.marketRegime ? { fetchedAt: db.marketRegime.fetchedAt || db.marketRegime.updatedAt, global: db.marketRegime.global || null, smartMoney: db.marketRegime.smartMoney || null } : null,
      // Daily Brief can be returned as an Agent tool result. Keep only
      // deterministic market facts and normalized attribution fields here;
      // search/web prose stays in the UI-only marketMovers store.
      movers: (db.marketMovers?.movers || []).slice(0, 8).map((mover) => ({
        symbol: mover.symbol,
        changePct: mover.changePct,
        quoteVolUsdt: mover.quoteVolUsdt,
        high24h: mover.high24h,
        low24h: mover.low24h,
        attribution: mover.narrative ? {
          evidenceId: mover.narrative.evidenceId,
          sourceType: mover.narrative.sourceType,
          trust: "untrusted_external_data",
          mayTriggerTradeDirectly: false,
          category: mover.narrative.category,
          sentiment: mover.narrative.sentiment,
          confidence: mover.narrative.confidence,
          attributedAt: mover.narrative.attributedAt
        } : null
      })),
      moversAsOf: db.marketMovers?.scannedAt || null
    },
    riskContext: {
      activePositions: (db.positions || []).filter((position) => Number(position.size ?? position.pos ?? 0) !== 0).map((position) => ({ symbol: position.symbol || position.instId, side: position.direction || position.side, updatedAt: position.updatedAt })),
      activeWatches: (db.watchTriggers || []).filter((watch) => watch.status === "active").map((watch) => ({ id: watch.id, symbol: watch.symbol, kind: watch.kind, level: watch.level, levelLow: watch.levelLow, levelHigh: watch.levelHigh, expiresAt: watch.expiresAt })),
      riskStatus: db.system?.riskStatus || null,
      killSwitch: db.system?.killSwitch === true
    },
    constraints,
    dataQuality: {
      staleRequiredSources: staleRequired,
      healthySources: health.filter((source) => source.health === "healthy").map((source) => source.sourceId),
      unconfiguredSources: health.filter((source) => source.health === "unconfigured").map((source) => source.sourceId)
    },
    evidenceFactIds: [...new Set([...news.map((fact) => fact.id), flow.okxLiquidationActivity?.id, flow.btcEtf?.id, flow.ethEtf?.id, flow.sentiment?.id].filter(Boolean))],
    updatedAt: nowIso(), createdAt: nowIso()
  };
  db.dailyBriefs ||= [];
  const existing = db.dailyBriefs.find((item) => item.id === brief.id);
  if (existing) {
    brief.version = Number(existing.version || 1) + 1;
    brief.createdAt = existing.createdAt;
    Object.assign(existing, brief);
  } else db.dailyBriefs.unshift(brief);
  db.dailyBriefs = db.dailyBriefs.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 90);
  return existing || brief;
}

export function getDailyBrief(db, date = cnDateKey()) {
  return (db.dailyBriefs || []).find((brief) => brief.date === date) || null;
}

export function getDailyBriefForAgent(db, date = cnDateKey()) {
  const brief = getDailyBrief(db, date);
  if (!brief) return null;
  return {
    id: safeFactId(brief.id),
    date: brief.date,
    timeZone: brief.timeZone,
    asOf: safeIsoTimestamp(brief.asOf),
    role: "analysis_context_only",
    mayTriggerTradeDirectly: false,
    topNews: (brief.topNews || []).map((fact) => marketIntelligenceFactForAgent({
      ...fact,
      id: fact.factId,
      type: "news",
      category: fact.category || "news"
    })),
    upcomingEvents: (brief.upcomingEvents || []).map(officialCalendarEventForAgent),
    flow: getFlowSnapshotForAgent(db),
    market: brief.market ? {
      movers: (brief.market.movers || []).slice(0, 8).map((mover) => ({
        symbol: /^[A-Z0-9]{2,15}\/USDT$/.test(String(mover.symbol || "").toUpperCase()) ? String(mover.symbol).toUpperCase() : null,
        changePct: Number.isFinite(Number(mover.changePct)) ? Number(mover.changePct) : null,
        quoteVolUsdt: Number.isFinite(Number(mover.quoteVolUsdt)) ? Number(mover.quoteVolUsdt) : null,
        high24h: Number.isFinite(Number(mover.high24h)) ? Number(mover.high24h) : null,
        low24h: Number.isFinite(Number(mover.low24h)) ? Number(mover.low24h) : null,
        attribution: mover.attribution ? {
          evidenceId: safeFactId(mover.attribution.evidenceId),
          category: safeFactScalar(mover.attribution.category) || "unknown",
          sentiment: Number.isFinite(Number(mover.attribution.sentiment)) ? Number(mover.attribution.sentiment) : null,
          confidence: safeFactScalar(mover.attribution.confidence) || "low",
          mayTriggerTradeDirectly: false
        } : null
      })),
      moversAsOf: safeIsoTimestamp(brief.market.moversAsOf)
    } : null,
    riskContext: brief.riskContext ? {
      activePositions: (brief.riskContext.activePositions || []).slice(0, 20).map((position) => ({
        symbol: /^[A-Z0-9]{2,15}\/USDT$/.test(String(position.symbol || "").toUpperCase()) ? String(position.symbol).toUpperCase() : null,
        side: ["long", "short"].includes(String(position.side || "").toLowerCase()) ? String(position.side).toLowerCase() : "unknown",
        updatedAt: safeIsoTimestamp(position.updatedAt)
      })),
      activeWatches: (brief.riskContext.activeWatches || []).slice(0, 40).map((watch) => ({
        id: safeFactId(watch.id),
        symbol: /^[A-Z0-9]{2,15}\/USDT$/.test(String(watch.symbol || "").toUpperCase()) ? String(watch.symbol).toUpperCase() : null,
        kind: safeFactScalar(watch.kind) || "unknown",
        level: Number.isFinite(Number(watch.level)) ? Number(watch.level) : null,
        levelLow: Number.isFinite(Number(watch.levelLow)) ? Number(watch.levelLow) : null,
        levelHigh: Number.isFinite(Number(watch.levelHigh)) ? Number(watch.levelHigh) : null,
        expiresAt: safeIsoTimestamp(watch.expiresAt)
      })),
      riskStatus: safeFactScalar(brief.riskContext.riskStatus) || "unknown",
      killSwitch: brief.riskContext.killSwitch === true
    } : null,
    constraints: (brief.constraints || []).map((row) => ({
      type: safeFactScalar(row.type) || "unknown",
      severity: safeFactScalar(row.severity) || "unknown",
      eventId: safeFactScalar(row.eventId) || null,
      due: safeIsoTimestamp(row.due),
      reasonCode: safeFactScalar(row.reasonCode) || null
    })),
    dataQuality: brief.dataQuality ? {
      staleRequiredSources: safeSourceIds(brief.dataQuality.staleRequiredSources),
      healthySources: safeSourceIds(brief.dataQuality.healthySources),
      unconfiguredSources: safeSourceIds(brief.dataQuality.unconfiguredSources)
    } : null,
    evidenceFactIds: safeSourceIds(brief.evidenceFactIds)
  };
}

export function dailyBriefForPrompt(db) {
  const brief = getDailyBrief(db);
  if (!brief) return null;
  const ageMs = Date.now() - new Date(brief.asOf || 0).getTime();
  if (!Number.isFinite(ageMs) || ageMs > 2 * HOUR) return `今日情报简报已过期（截至 ${brief.asOf || "未知"}），不得当作当前事实；请调用 get_daily_market_brief/refresh_events。`;
  const lines = [
    `截至 ${brief.asOf}；用途=分析背景，禁止直接作为下单信号；版本 ${brief.version}`,
    ...brief.topNews.slice(0, 5).map((item) => `- 新闻事实ID=${item.factId}（${item.publishedAt}，可信 ${Math.round(Number(item.confidence || 0) * 100)}%；原始自由文本未进入系统提示）`),
    ...brief.upcomingEvents.slice(0, 5).map((event) => `- 日程ID=${event.eventId || event.factId || "unknown"}：${event.due}（精度=${event.timePrecision}；原始标题未进入系统提示）`),
    ...(brief.macroContext ? [`- 宏观环境：${macroRegimeForPrompt(brief.macroContext).replace(/\n/g, "；")}`] : []),
    ...brief.constraints.map((item) => {
      if (item.type === "event_blackout_attention") return `- 约束提示：官方分钟级高影响事件 eventId=${item.eventId || "unknown"} 将在 90 分钟内发布；由硬风控决定是否禁止开仓。`;
      if (item.type === "date_only_event_attention") return "- 约束提示：未来 24 小时存在仅确认日期的官方事件；不得伪造分钟级静默窗口。";
      if (item.type === "stale_information") return "- 约束提示：至少一项必要信息源陈旧或失败；不得把旧内容当作当前催化剂。";
      return `- 约束提示：type=${String(item.type || "unknown").replace(/[^a-z0-9_-]/gi, "").slice(0, 48)}`;
    })
  ];
  if (brief.flow.unavailable?.length) lines.push(`- 未配置/无新鲜数据：${brief.flow.unavailable.join("、")}；禁止猜测数值。`);
  return lines.join("\n");
}

export async function refreshMarketIntelligence(db, options = {}) {
  const startedAt = Date.now();
  removeLegacyPaidFlowData(db);
  syncEventSourceHealth(db);
  const ingestedEvents = ingestEventFacts(db);
  const okxLiquidation = ingestOkxLiquidationActivity(db);
  const calendar = options.skipCalendar ? null : await refreshOfficialCalendar(db);
  if (calendar) recordCalendarHealth(db, calendar);
  const [sentiment, farside] = await Promise.all([refreshFearGreed(db), refreshPublicEtfFlows(db)]);
  recordSourceHealth(db, { id: "alternative_fng", name: "Alternative.me Fear & Greed", url: FNG_URL, category: "sentiment", staleAfterMs: 36 * HOUR }, sentiment);
  if (farside.status !== "not_due") {
    recordSourceHealth(db, { id: "farside_etf_flows", name: "Farside ETF public tables", url: FARSIDE_BTC_URL, category: "flow", staleAfterMs: 6 * DAY }, farside);
  }
  recordSourceHealth(db, {
    id: "okx_public_liquidations", name: "OKX public liquidation activity",
    url: "https://www.okx.com/docs-v5/en/#public-data-websocket-liquidation-orders-channel", category: "flow", staleAfterMs: 30 * 60_000
  }, okxLiquidation
    ? { status: "ok", itemCount: 1, lastDataAt: okxLiquidation.publishedAt }
    : { status: "failed", error: "no fresh OKX liquidation activity" });
  pruneFacts(db);
  maybeAlertStaleNews(db);
  const dailyBrief = buildDailyBrief(db);
  appendTrace(db, "market_intelligence", `情报刷新：事件 ${ingestedEvents} · 情绪 ${sentiment.status} · ETF ${farside.status} · OKX强平 ${okxLiquidation ? "ok" : "unavailable"}`, "ok", Date.now() - startedAt);
  return {
    status: "ok", ingestedEvents, facts: db.marketIntelligenceFacts.length, calendarEvents: db.marketCalendarEvents.length,
    dailyBrief: { id: dailyBrief.id, version: dailyBrief.version, asOf: dailyBrief.asOf },
    sources: { sentiment, farside, okxLiquidation: Boolean(okxLiquidation), calendar: calendar?.results || [] },
    latencyMs: Date.now() - startedAt
  };
}

export function intelligenceStatus(db) {
  const brief = getDailyBrief(db);
  return {
    facts: (db.marketIntelligenceFacts || []).length,
    calendarEvents: (db.marketCalendarEvents || []).length,
    dailyBrief: brief ? { id: brief.id, version: brief.version, asOf: brief.asOf } : null,
    sources: sourceHealthSummary(db),
    flow: getFlowSnapshot(db)
  };
}
