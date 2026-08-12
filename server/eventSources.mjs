import * as cheerio from "cheerio";
import crypto from "node:crypto";
import Parser from "rss-parser";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";
import { fetchExternalText } from "./externalInputSafety.mjs";

const rssParser = new Parser();

// 精选、可靠、无需密钥的事件源。交易所公告页是 JS 动态渲染、抓不到，
// 用币圈新闻 RSS（会覆盖上下架/安全/监管）+ 美联储宏观来替代。
const DEFAULT_EVENT_SOURCES = [
  { id: "src_fed_press", name: "Federal Reserve Press Releases", type: "rss", url: "https://www.federalreserve.gov/feeds/press_all.xml", category: "宏观", enabled: true, trustScore: 92 },
  { id: "src_coindesk", name: "CoinDesk", type: "rss", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", category: "币圈", enabled: true, trustScore: 80 },
  { id: "src_cointelegraph", name: "Cointelegraph", type: "rss", url: "https://cointelegraph.com/rss", category: "币圈", enabled: true, trustScore: 76 },
  { id: "src_theblock", name: "The Block", type: "rss", url: "https://www.theblock.co/rss.xml", category: "币圈", enabled: true, trustScore: 80 },
  { id: "src_decrypt", name: "Decrypt", type: "rss", url: "https://decrypt.co/feed", category: "币圈", enabled: true, trustScore: 72 }
];

export function ensureDefaultEventSources(db) {
  db.eventSources ||= [];
  db.meta ||= {};
  // 清理冒烟测试残留的占位源。
  db.eventSources = db.eventSources.filter((source) => !/smoke/i.test(source.name || "") && !/smoke/i.test(source.id || ""));
  // 默认启用内置 RSS 消息源（用户 2026-07-31 要求"开箱即用消息面"）：
  // 只补种一次，尊重用户之后的手动删除（删了不会再回来）。
  if (!db.meta.defaultSourcesRestored) {
    const have = new Set((db.eventSources || []).map((s) => s.id));
    for (const src of DEFAULT_EVENT_SOURCES) if (!have.has(src.id)) db.eventSources.push({ ...src, createdAt: nowIso() });
    db.meta.defaultSourcesRestored = true;
  }
  return db.eventSources;
}

// 给升级前的"扁平"事件补上 timeline/topic 字段，让它们也能在情报视图里正常渲染。
function backfillEventTimelines(db) {
  for (const event of db.events || []) {
    if (!event.timeline) {
      event.timeline = [{ at: event.due && event.due !== "即时" && event.due !== "新近" ? event.due : event.createdAt, title: event.shortTitle || event.title, source: (event.progress?.[0] || "").replace("来源：", "") || "历史", link: event.sourceLink }];
      event.updateCount = event.updateCount || 1;
      event.lastUpdatedAt = event.lastUpdatedAt || event.createdAt;
      if (!event.topicTags) {
        const { tags } = extractEntities(`${event.rawTitle || event.title} ${event.summary || ""}`);
        event.topicTags = tags;
        event.topicKey = tags.length ? topicKeyOf(tags) : "";
      }
    }
  }
}

export async function refreshEventSources(db, { force = false } = {}) {
  ensureDefaultEventSources(db);
  backfillEventTimelines(db);
  pruneStaleEvents(db);
  const configuredSources = (db.eventSources || []).filter((item) => item.enabled);
  const enabledSources = configuredSources.filter((item) => force || !item.nextRetryAt || new Date(item.nextRetryAt).getTime() <= Date.now());
  if (!enabledSources.length) {
    return {
      status: "skipped",
      reason: configuredSources.length ? "all_sources_in_backoff" : "no_enabled_sources",
      attempted: 0,
      results: [],
      ingested: 0,
      skipPersist: true
    };
  }
  const results = await Promise.all(enabledSources.map(async (source) => {
    const attemptedAt = nowIso();
    source.lastAttemptAt = attemptedAt;
    try {
      const result = await fetchSourceWithRetry(source);
      source.lastStatus = "ok";
      source.lastFetchedAt = nowIso();
      source.lastSuccessAt = source.lastFetchedAt;
      source.lastItemCount = (result.items || []).length;
      source.lastError = null;
      source.consecutiveFailures = 0;
      source.nextRetryAt = null;
      return result;
    } catch (error) {
      source.lastStatus = "failed";
      source.lastError = String(error.message || error).slice(0, 180);
      source.consecutiveFailures = Number(source.consecutiveFailures || 0) + 1;
      const backoffMs = Math.min(6 * 60 * 60_000, 5 * 60_000 * (2 ** Math.min(6, source.consecutiveFailures - 1)));
      source.nextRetryAt = new Date(Date.now() + backoffMs).toISOString();
      return { sourceId: source.id, status: "failed", error: source.lastError, items: [] };
    }
  }));
  // 网络请求并发、落库串行：避免异步写入导致同一专题合并顺序不确定。
  for (const result of results) {
    if (result.status !== "ok") continue;
    const source = enabledSources.find((item) => item.id === result.sourceId);
    for (const item of recentItems(result.items).slice(0, 5)) upsertEventFromItem(db, source, item);
  }
  consolidateEvents(db);
  sortEventsByRecency(db);
  // 信息面智能:对新拉取的新闻做可信度/交叉验证/情绪/影响币种/计价程度/假消息 富化(用现有 LLM,失败不阻断)。
  try { const { enrichEvents } = await import("./newsIntelligence.mjs"); await enrichEvents(db); } catch { /* 信息面富化失败不影响事件刷新 */ }
  const failed = results.filter((item) => item.status === "failed").length;
  const status = failed === results.length ? "failed" : failed ? "partial" : "ok";
  appendAudit(db, `刷新真实事件源：${results.length - failed}/${results.length} 成功`, "event_sources", "EventSourceManager", failed ? "warning" : "info");
  appendTrace(db, "event_sources", `refresh event sources ${results.length - failed}/${results.length}`, status === "failed" ? "error" : status === "partial" ? "warning" : "ok");
  return { status, attempted: results.length, succeeded: results.length - failed, failed, results, ingested: results.reduce((sum, r) => sum + (r.items?.length || 0), 0) };
}

export async function testEventSource(source) {
  const result = await fetchSourceWithRetry(source);
  return {
    status: "ok",
    sourceId: source.id,
    attempts: result.attempts,
    itemCount: result.items?.length || 0,
    preview: (result.items || []).slice(0, 3).map((item) => ({
      title: String(item.title || "").slice(0, 160),
      link: item.link,
      publishedAt: item.publishedAt || null
    }))
  };
}

async function fetchSourceWithRetry(source) {
  const retries = Math.max(0, Math.min(3, Number(process.env.EVENT_SOURCE_RETRIES ?? 1)));
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = source.type === "rss" ? await parseRssSource(source) : await parseHtmlSource(source);
      return { ...result, attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError || new Error("事件源刷新失败");
}

// 按事件时间倒序：最新的排最前；无法解析日期的（即时/新近）排在有日期项之后但保持相对新。
function eventTime(event) {
  const raw = event.due || event.createdAt;
  if (!raw || raw === "即时" || raw === "新近") return new Date(event.createdAt || 0).getTime();
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? new Date(event.createdAt || 0).getTime() : t;
}

function sortEventsByRecency(db) {
  db.events = (db.events || []).sort((a, b) => eventTime(b) - eventTime(a));
}

function recentItems(items = []) {
  const cutoff = Date.now() - 10 * 24 * 3600 * 1000;
  return (items || []).filter((item) => {
    if (!item.publishedAt) return true;
    const time = new Date(item.publishedAt).getTime();
    return Number.isNaN(time) || time >= cutoff;
  });
}

function pruneStaleEvents(db) {
  const cutoff = Date.now() - 14 * 24 * 3600 * 1000;
  db.events = (db.events || []).filter((event) => {
    const raw = event.due || event.createdAt;
    if (!raw || raw === "即时" || raw === "新近") return true;
    const time = new Date(raw).getTime();
    return Number.isNaN(time) || time >= cutoff;
  });
}

export async function refreshOnchainSignals(db) {
  const signals = [];
  let onchain = null;
  // 真实链上基本面(DefiLlama 免费源:全网 TVL / 稳定币供应)。付费维度(巨鲸/净流/解锁)如实标未接。
  try {
    const { fetchOnchainFundamentals } = await import("./onchainFundamentals.mjs");
    onchain = await fetchOnchainFundamentals(db);
    if (onchain.totalTvlUsd) signals.push({ source: "defillama_tvl", status: "ok", totalTvlUsd: onchain.totalTvlUsd });
    if (onchain.stableMcapUsd) signals.push({ source: "defillama_stablecoins", status: "ok", stableMcapUsd: onchain.stableMcapUsd });
    signals.push({ source: "advanced_onchain", ...(onchain.advanced || {}) });
  } catch (error) {
    signals.push({ source: "onchain", status: "error", error: String(error.message || error).slice(0, 80) });
  }
  // 链上信号是一个"持续更新"的实时事件，而不是每次刷新都新建一条——否则事件列表会被
  // 无限重复的"链上信号刷新"淹没，且 due="即时" 永不被 pruneStaleEvents 清理。
  db.events ||= [];
  const isOnchain = (event) => event.kind === "onchain_signal" || event.title === "链上信号刷新";
  const existing = db.events.find(isOnchain);
  // 自愈：折叠历史上累积的重复"链上信号刷新"事件，只保留第一条继续更新。
  if (existing) db.events = db.events.filter((event) => event === existing || !isOnchain(event));
  const snapshot = {
    kind: "onchain_signal",
    title: "链上信号刷新",
    category: "链上事件",
    status: "已刷新",
    confidence: onchain?.available ? 75 : 40,
    impact: 35,
    impactLabel: "低影响",
    due: "即时",
    relatedSymbols: ["BTC/USDT", "ETH/USDT"],
    action: onchain?.available ? `链上资金面：TVL $${((onchain.totalTvlUsd || 0) / 1e9).toFixed(1)}B · 稳定币 $${((onchain.stableMcapUsd || 0) / 1e9).toFixed(1)}B` : "链上数据源未接入",
    progress: [JSON.stringify(signals).slice(0, 300)],
    updatedAt: nowIso()
  };
  if (existing) {
    Object.assign(existing, snapshot);
  } else {
    db.events.unshift({ id: id("event"), ...snapshot, createdAt: nowIso() });
  }
  appendAudit(db, "刷新链上信号", "onchain", "EventSourceManager");
  return { status: "ok", signals };
}

async function parseRssSource(source) {
  const { text } = await fetchExternalText(source.url, { timeoutMs: 12_000, maxBytes: 2 * 1024 * 1024 });
  const feed = await rssParser.parseString(text);
  return {
    sourceId: source.id,
    status: "ok",
    items: (feed.items || []).map((item) => ({ title: item.title, link: item.link, summary: item.contentSnippet || item.content || "", publishedAt: item.isoDate || item.pubDate }))
  };
}

async function parseHtmlSource(source) {
  const { response, text: html } = await fetchExternalText(source.url, { timeoutMs: 12_000, maxBytes: 2 * 1024 * 1024 });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const $ = cheerio.load(html);
  const items = [];
  $("a").each((_idx, el) => {
    const title = $(el).text().replace(/\s+/g, " ").trim();
    const href = $(el).attr("href");
    if (title.length > 12 && href) items.push({ title, link: new URL(href, source.url).toString(), summary: title });
  });
  return { sourceId: source.id, status: "ok", items: dedupe(items).slice(0, 20) };
}

// ---------------------------------------------------------------------------
// 事件情报：把零散报道聚合成"专题"，用时间线持续跟进，并做确定性影响评估。
// 有 salient 实体（BTC/ETH/美联储/ETF/俄乌…）就按实体聚类；同一专题的新报道
// 归并进已有事件的 timeline，而不是新建一条。
// ---------------------------------------------------------------------------
const ENTITY_MAP = [
  { re: /bitcoin|\bbtc\b|比特币/i, tag: "BTC", symbols: ["BTC/USDT"] },
  { re: /ethereum|\beth\b|以太/i, tag: "ETH", symbols: ["ETH/USDT"] },
  { re: /solana|\bsol\b/i, tag: "SOL", symbols: ["SOL/USDT"] },
  { re: /\bxrp\b|ripple/i, tag: "XRP", symbols: ["XRP/USDT"] },
  { re: /\bbnb\b|binance coin/i, tag: "BNB", symbols: ["BNB/USDT"] },
  { re: /\betf/i, tag: "ETF", symbols: [] },
  { re: /\bsec\b|证监会/i, tag: "SEC", symbols: [] },
  { re: /federal reserve|\bfed\b|fomc|美联储/i, tag: "美联储", symbols: [] },
  { re: /\bcpi\b|inflation|通胀/i, tag: "CPI", symbols: [] },
  { re: /rate cut|interest rate|降息|利率/i, tag: "利率", symbols: [] },
  { re: /trump|特朗普/i, tag: "Trump", symbols: [] },
  { re: /russia|ukraine|俄|乌克兰|停战|ceasefire/i, tag: "俄乌", symbols: [] },
  { re: /hack|exploit|breach|被盗|漏洞/i, tag: "安全事件", symbols: [] },
  { re: /binance|币安/i, tag: "币安", symbols: [] },
  { re: /coinbase/i, tag: "Coinbase", symbols: [] },
  { re: /stablecoin|tether|\busdt\b|circle|\busdc\b|稳定币/i, tag: "稳定币", symbols: [] },
  { re: /strategy|microstrategy|saylor/i, tag: "Strategy", symbols: ["BTC/USDT"] },
  { re: /grayscale|灰度/i, tag: "灰度", symbols: [] },
  { re: /unlock|vesting|解锁/i, tag: "代币解锁", symbols: [] },
  { re: /listing|上线/i, tag: "上新", symbols: [] },
  { re: /delist|下架/i, tag: "下架", symbols: [] }
];

const BULLISH = /approv|adopt|buy|inflow|cut|surge|rally|上涨|流入|批准|利好|停战|降息/i;
const BEARISH = /hack|exploit|ban|delist|sell|outflow|crash|dump|下跌|抛售|流出|禁止|下架|升级风险/i;

function extractEntities(text = "") {
  const tags = [];
  const symbols = [];
  for (const entity of ENTITY_MAP) {
    if (entity.re.test(text)) { tags.push(entity.tag); symbols.push(...entity.symbols); }
  }
  return { tags: [...new Set(tags)], symbols: [...new Set(symbols)] };
}

function topicKeyOf(tags) {
  return tags.slice().sort().join("+");
}

// 与已有事件的匹配度：共享 ≥2 个实体，或共享 1 个实体且同专题键 → 同一专题
function findTopicEvent(db, tags, topicKey) {
  const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
  return (db.events || []).find((event) => {
    if (!event.topicKey) return false;
    const t = new Date(event.lastUpdatedAt || event.createdAt || 0).getTime();
    if (!Number.isNaN(t) && t < cutoff) return false;
    if (event.topicKey === topicKey) return true;
    const shared = (event.topicTags || []).filter((x) => tags.includes(x));
    return shared.length >= 2;
  });
}

function directionHint(text) {
  if (BEARISH.test(text) && !BULLISH.test(text)) return "偏空信号";
  if (BULLISH.test(text) && !BEARISH.test(text)) return "偏多信号";
  return "方向待观察";
}

function buildAssessment(event) {
  const syms = (event.relatedSymbols || []).filter((s) => s !== "BTC/USDT").length ? event.relatedSymbols.join("/") : (event.relatedSymbols?.[0] || "大盘情绪");
  return `已聚合 ${event.updateCount || 1} 条报道，${event.impactLabel}。涉及 ${syms}，${event.directionHint || "方向待观察"}。`;
}

function upsertEventFromItem(db, source, item) {
  db.events ||= [];
  // 去重：同一链接/标题不重复计入
  if ((db.events || []).some((event) => (event.timeline || []).some((u) => u.link && u.link === item.link) || event.rawTitle === item.title)) return;
  const localized = localizeTitle(item.title, source);
  const { tags, symbols } = extractEntities(`${item.title} ${item.summary || ""}`);
  const impact = estimateImpact(item.title);
  const at = item.publishedAt || nowIso();
  const update = { at, title: localized, source: source.name, link: item.link };

  const topicKey = tags.length ? topicKeyOf(tags) : "";
  const existing = topicKey ? findTopicEvent(db, tags, topicKey) : null;

  if (existing) {
    existing.timeline = [update, ...(existing.timeline || [])].slice(0, 12);
    existing.updateCount = (existing.updateCount || 1) + 1;
    existing.impact = Math.max(existing.impact || 0, impact);
    existing.impactLabel = existing.impact >= 80 ? "高影响" : existing.impact >= 50 ? "中影响" : "低影响";
    existing.relatedSymbols = [...new Set([...(existing.relatedSymbols || []), ...symbols])].slice(0, 5);
    existing.topicTags = [...new Set([...(existing.topicTags || []), ...tags])];
    existing.due = at;
    existing.lastUpdatedAt = nowIso();
    existing.directionHint = directionHint(`${item.title} ${existing.title}`);
    existing.title = existing.topicTags.length ? existing.topicTags.slice(0, 3).join(" · ") + " 专题" : existing.title;
    existing.shortTitle = shortTitle(existing.title);
    existing.action = buildAssessment(existing);
    return;
  }

  const title = tags.length ? `${tags.slice(0, 3).join(" · ")} 专题` : localized;
  const event = {
    id: id("event"),
    sourceId: source.id,
    title,
    rawTitle: item.title,
    shortTitle: shortTitle(title),
    summary: item.summary,
    sourceLink: item.link,
    topicKey,
    topicTags: tags,
    category: source.category === "宏观" || source.name.includes("Fed") ? "宏观事件" : source.category === "币圈" ? "币圈事件" : "交易所事件",
    status: "跟进中",
    confidence: source.trustScore || 70,
    impact,
    impactLabel: impact >= 80 ? "高影响" : impact >= 50 ? "中影响" : "低影响",
    due: at,
    relatedSymbols: symbols.length ? symbols : inferSymbols(item.title),
    updateCount: 1,
    timeline: [update],
    directionHint: directionHint(item.title),
    lastUpdatedAt: nowIso(),
    createdAt: nowIso()
  };
  event.action = buildAssessment(event);
  db.events.unshift(event);
}

// 把已存在的同专题事件合并成一条（共享 ≥2 实体或同专题键），合并时间线、去重、
// 取最高影响。让"一件事的多条报道"聚成一个持续跟进的专题。
function mergeInto(target, event) {
  const merged = [...(target.timeline || []), ...(event.timeline || [])];
  const seen = new Set();
  target.timeline = merged.filter((u) => { const key = u.link || `${u.at}|${u.title}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0)).slice(0, 12);
  target.updateCount = target.timeline.length;
  target.impact = Math.max(target.impact || 0, event.impact || 0);
  target.impactLabel = target.impact >= 80 ? "高影响" : target.impact >= 50 ? "中影响" : "低影响";
  target.relatedSymbols = [...new Set([...(target.relatedSymbols || []), ...(event.relatedSymbols || [])])].slice(0, 5);
  target.topicTags = [...new Set([...(target.topicTags || []), ...(event.topicTags || [])])];
  target.topicKey = topicKeyOf(target.topicTags);
  target.lastUpdatedAt = new Date(Math.max(new Date(target.lastUpdatedAt || 0), new Date(event.lastUpdatedAt || 0))).toISOString();
  target.title = `${target.topicTags.slice(0, 3).join(" · ")} 专题`;
  target.shortTitle = shortTitle(target.title);
  target.directionHint = target.directionHint || event.directionHint;
  target.action = buildAssessment(target);
}

function consolidateEvents(db) {
  const kept = [];
  for (const event of db.events || []) {
    if (!event.topicTags || event.topicTags.length === 0) { kept.push(event); continue; }
    const target = kept.find((k) => k.topicKey && (k.topicKey === event.topicKey || (k.topicTags || []).filter((t) => event.topicTags.includes(t)).length >= 2));
    if (target) {
      mergeInto(target, event);
    } else {
      event.title = `${event.topicTags.slice(0, 3).join(" · ")} 专题`;
      event.shortTitle = shortTitle(event.title);
      event.updateCount = (event.timeline || []).length || 1;
      event.action = buildAssessment(event);
      kept.push(event);
    }
  }
  db.events = kept;
}

// ---------------------------------------------------------------------------
// 通用 Agent 任务：给 Agent 派一个开放式长期任务（如"追踪俄乌停战进展"），定时
// 执行时刷新情报、匹配相关事件专题、产出简报。无 LLM key 也能跑（确定性匹配）。
// ---------------------------------------------------------------------------
function escapeRe(text = "") {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function runAgentMission(db, task = {}) {
  const mission = String(task.mission || task.name || "").trim();
  if (!mission) return { status: "skipped", reason: "no_mission" };
  let refreshResult;
  try { refreshResult = await refreshEventSources(db); }
  catch (error) { refreshResult = { status: "failed", error: String(error?.message || error).slice(0, 180) }; }
  const refreshLine = refreshResult.status === "failed"
    ? `数据刷新：失败（${refreshResult.error || `${refreshResult.failed || 0}/${refreshResult.attempted || 0} 个来源失败`}），以下仅基于已存证据。`
    : refreshResult.status === "partial"
      ? `数据刷新：部分成功（${refreshResult.succeeded || 0}/${refreshResult.attempted || 0} 个来源成功）。`
      : refreshResult.status === "skipped"
        ? `数据刷新：未执行（${refreshResult.reason === "no_enabled_sources" ? "没有启用的事件源" : "所有来源都在失败退避期"}），以下基于已存证据。`
        : "数据刷新：成功。";
  const { tags } = extractEntities(mission);
  const words = mission.split(/\s+|、|，|,/).map((w) => w.trim()).filter((w) => w.length > 1).slice(0, 8);
  const missionRe = words.length ? new RegExp(words.map(escapeRe).join("|"), "i") : null;
  const ranked = rankEvents(db, {});
  const matches = ranked.filter((event) =>
    (event.topicTags || []).some((t) => tags.includes(t))
    || (missionRe && missionRe.test(event.title || ""))
    || (missionRe && (event.timeline || []).some((u) => missionRe.test(u.title || "")))
  ).slice(0, 4);
  const lines = matches.length
    ? matches.map((event) => `· ${event.title}（${event.updateCount || 1}条报道 · ${event.impactLabel} · ${event.directionHint || "方向待观察"}）：${event.action || ""}`)
    : ["暂无匹配的事件专题；已刷新情报源，出现相关新闻会自动归入并在下次简报体现。"];
  const evidence = matches.map((event) => ({
    id: event.id,
    title: event.title,
    impact: event.impact,
    impactLabel: event.impactLabel,
    directionHint: event.directionHint || "方向待观察",
    assessment: event.action || "",
    sources: (event.timeline || []).slice(0, 4).map((item) => ({ at: item.at, source: item.source, title: item.title, link: item.link }))
  }));
  const evidenceSignature = crypto.createHash("sha256").update(JSON.stringify(evidence.map((item) => ({
    id: item.id, impact: item.impact, latest: item.sources[0]?.at || null, reports: item.sources.length, assessment: item.assessment
  })).concat([{ refreshStatus: refreshResult.status, refreshReason: refreshResult.reason || null }]))).digest("hex");
  task.lastCheckedAt = nowIso();
  task.lastMatched = matches.length;
  if (task.lastEvidenceSignature === evidenceSignature && task.lastBriefing) {
    return { status: refreshResult.status === "failed" ? "failed" : "unchanged", error: refreshResult.status === "failed" ? "event_source_refresh_failed" : undefined, matched: matches.length, briefing: task.lastBriefing, evidenceIds: task.lastEvidenceIds || evidence.map((item) => item.id), mode: task.lastBriefingMode || "deterministic" };
  }
  let llmSummary = null;
  if (evidence.length) {
    const system = "你是市场情报编辑。只能使用给定证据，严格区分事实、推断和未知；不得给出下单指令；输出不超过500字中文纯文本，并在每个事实后标注[事件ID]。";
    const prompt = `任务：${mission}\n证据：${JSON.stringify(evidence)}\n请输出：最新变化、可能影响、仍未知、接下来关注什么。`;
    try {
      const { activeProvider, llmComplete } = await import("./agentChat.mjs");
      if (activeProvider()) llmSummary = String(await llmComplete(prompt, system) || "").trim().slice(0, 2000) || null;
    } catch { llmSummary = null; }
  }
  const updatedAt = nowIso();
  const briefing = `【情报任务简报】${mission}\n更新时间：${updatedAt}\n${refreshLine}\n${llmSummary || lines.join("\n")}`;

  task.lastBriefing = briefing;
  task.lastBriefingAt = updatedAt;
  task.lastMatched = matches.length;
  task.lastEvidenceIds = evidence.map((item) => item.id);
  task.lastEvidenceSignature = evidenceSignature;
  task.lastBriefingMode = llmSummary ? "evidence_bound_llm" : "deterministic";
  db.notifications ||= [];
  db.notifications.unshift({
    id: id("notif"),
    type: "mission",
    severity: refreshResult.status === "failed" || matches.some((m) => m.impact >= 80) ? "warning" : "info",
    title: `情报任务：${mission.slice(0, 22)}`,
    body: briefing.slice(0, 2000),
    evidenceIds: task.lastEvidenceIds,
    briefingMode: task.lastBriefingMode,
    read: false,
    createdAt: nowIso()
  });
  appendAudit(db, `执行情报任务：${mission.slice(0, 30)}`, task.id || "mission", "AgentMission");
  return { status: refreshResult.status === "failed" ? "failed" : ["partial", "skipped"].includes(refreshResult.status) ? "partial" : "ok", error: refreshResult.status === "failed" ? "event_source_refresh_failed" : undefined, matched: matches.length, briefing, evidenceIds: task.lastEvidenceIds, mode: task.lastBriefingMode, refresh: refreshResult };
}

// 热点排序：影响度 + 报道热度（更新条数）+ 时效 + 与持仓/关注标的相关性
export function rankEvents(db, { watchSymbols = [] } = {}) {
  const now = Date.now();
  const watch = new Set(watchSymbols.map((s) => String(s).toUpperCase()));
  return (db.events || []).map((event) => {
    const t = new Date(event.lastUpdatedAt || event.due || event.createdAt || 0).getTime();
    const ageHours = Number.isNaN(t) ? 999 : Math.max(0, (now - t) / 3.6e6);
    const recency = Math.max(0, 48 - ageHours) / 48;           // 48h 内线性衰减
    const heat = Math.min(40, (event.updateCount || 1) * 8);    // 报道越多越热
    const relevant = (event.relatedSymbols || []).some((s) => watch.has(String(s).toUpperCase())) ? 30 : 0;
    const score = Number(event.impact || 0) + heat + recency * 25 + relevant;
    return { ...event, hotScore: Math.round(score) };
  }).sort((a, b) => b.hotScore - a.hotScore);
}

function localizeTitle(title = "", source = {}) {
  const raw = String(title || "").replace(/\s+/g, " ").trim();
  const rules = [
    [/federal reserve|fed/i, "美联储"],
    [/press release/i, "新闻稿"],
    [/interest rate|rates/i, "利率"],
    [/cpi/i, "CPI"],
    [/fomc/i, "FOMC"],
    [/maintenance/i, "维护"],
    [/delist/i, "下架"],
    [/listing/i, "上线"],
    [/upgrade/i, "升级"],
    [/suspend/i, "暂停"],
    [/security/i, "安全"],
    [/wallet/i, "钱包"],
    [/deposit/i, "充值"],
    [/withdrawal|withdraw/i, "提现"]
  ];
  let translated = raw;
  for (const [pattern, label] of rules) translated = translated.replace(pattern, label);
  if (!/[\u4e00-\u9fa5]/.test(translated)) {
    const prefix = source.name?.includes("Fed") || source.name?.includes("Federal")
      ? "美联储公告"
      : source.name?.includes("OKX")
        ? "OKX公告"
        : source.name?.includes("Binance")
          ? "币安公告"
          : "市场事件";
    translated = `${prefix}：${translated}`;
  }
  return translated;
}

function shortTitle(title = "") {
  const value = String(title || "").replace(/\s+/g, " ").trim();
  return value.length > 34 ? `${value.slice(0, 34)}...` : value;
}

function estimateImpact(title = "") {
  if (/hack|exploit|security|delist|suspend|fomc|rate|cpi|etf/i.test(title)) return 85;
  if (/listing|upgrade|maintenance|airdrop/i.test(title)) return 58;
  return 35;
}

function inferSymbols(title = "") {
  const symbols = [];
  for (const symbol of ["BTC", "ETH", "SOL", "BNB", "ARB"]) if (title.toUpperCase().includes(symbol)) symbols.push(`${symbol}/USDT`);
  return symbols.length ? symbols : ["BTC/USDT"];
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.link || item.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
