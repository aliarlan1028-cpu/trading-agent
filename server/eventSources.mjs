import * as cheerio from "cheerio";
import Parser from "rss-parser";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

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
  // 清理冒烟测试残留的占位源，避免污染事件源列表。
  db.eventSources = db.eventSources.filter((source) => !/smoke/i.test(source.name || "") && !/smoke/i.test(source.id || ""));
  // 停用抓不到内容的交易所 HTML 源，避免每次刷新都失败刷屏。
  for (const source of db.eventSources) {
    if ((source.id === "src_binance_ann" || source.id === "src_okx_ann") && source.type === "html") source.enabled = false;
  }
  for (const preset of DEFAULT_EVENT_SOURCES) {
    const existing = db.eventSources.find((item) => item.id === preset.id);
    if (existing) {
      // 补齐缺失字段，但尊重用户手动 enabled 设置。
      existing.url = preset.url; existing.type = preset.type; existing.name ||= preset.name; existing.category ||= preset.category;
    } else {
      db.eventSources.push({ ...preset });
    }
  }
  return db.eventSources;
}

export async function refreshEventSources(db) {
  const results = [];
  ensureDefaultEventSources(db);
  pruneStaleEvents(db);
  for (const source of (db.eventSources || []).filter((item) => item.enabled)) {
    try {
      const result = source.type === "rss" ? await parseRssSource(source) : await parseHtmlSource(source);
      results.push(result);
      for (const item of recentItems(result.items).slice(0, 5)) upsertEventFromItem(db, source, item);
      source.lastStatus = "ok";
      source.lastFetchedAt = nowIso();
    } catch (error) {
      source.lastStatus = "failed";
      source.lastError = error.message;
      results.push({ sourceId: source.id, status: "failed", error: error.message, items: [] });
    }
  }
  sortEventsByRecency(db);
  appendAudit(db, "刷新真实事件源", "event_sources", "EventSourceManager", results.some((r) => r.status === "failed") ? "warning" : "info");
  appendTrace(db, "event_sources", "refresh event sources", results.some((r) => r.status === "failed") ? "warning" : "ok");
  return { status: "ok", results, ingested: results.reduce((sum, r) => sum + (r.items?.length || 0), 0) };
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
  if (process.env.ETHERSCAN_API_KEY) {
    const url = `https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=${process.env.ETHERSCAN_API_KEY}`;
    const response = await fetch(url);
    const json = await response.json();
    signals.push({ source: "etherscan_gas", status: json.status, result: json.result });
  } else {
    signals.push({ source: "etherscan_gas", status: "missing_api_key" });
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
    confidence: process.env.ETHERSCAN_API_KEY ? 80 : 40,
    impact: 35,
    impactLabel: "低影响",
    due: "即时",
    relatedSymbols: ["ETH/USDT"],
    action: "观察链上拥堵与 Gas 异常",
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
  const feed = await rssParser.parseURL(source.url);
  return {
    sourceId: source.id,
    status: "ok",
    items: (feed.items || []).map((item) => ({ title: item.title, link: item.link, summary: item.contentSnippet || item.content || "", publishedAt: item.isoDate || item.pubDate }))
  };
}

async function parseHtmlSource(source) {
  const response = await fetch(source.url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  const $ = cheerio.load(html);
  const items = [];
  $("a").each((_idx, el) => {
    const title = $(el).text().replace(/\s+/g, " ").trim();
    const href = $(el).attr("href");
    if (title.length > 12 && href) items.push({ title, link: new URL(href, source.url).toString(), summary: title });
  });
  return { sourceId: source.id, status: "ok", items: dedupe(items).slice(0, 20) };
}

function upsertEventFromItem(db, source, item) {
  if ((db.events || []).some((event) => event.sourceLink === item.link || event.rawTitle === item.title || event.title === item.title)) return;
  const title = localizeTitle(item.title, source);
  db.events.unshift({
    id: id("event"),
    title,
    rawTitle: item.title,
    shortTitle: shortTitle(title),
    summary: item.summary,
    sourceLink: item.link,
    category: source.category === "宏观" || source.name.includes("Fed") ? "宏观事件" : source.category === "币圈" ? "币圈事件" : "交易所事件",
    status: "待确认",
    confidence: source.trustScore || 70,
    impact: estimateImpact(item.title),
    impactLabel: estimateImpact(item.title) >= 80 ? "高影响" : estimateImpact(item.title) >= 50 ? "中影响" : "低影响",
    due: item.publishedAt || "新近",
    relatedSymbols: inferSymbols(item.title),
    action: "事件分析员待评估",
    progress: [`来源：${source.name}`],
    createdAt: nowIso()
  });
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
