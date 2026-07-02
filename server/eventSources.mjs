import * as cheerio from "cheerio";
import Parser from "rss-parser";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

const rssParser = new Parser();

export async function refreshEventSources(db) {
  const results = [];
  for (const source of (db.eventSources || []).filter((item) => item.enabled)) {
    try {
      const result = source.type === "rss" ? await parseRssSource(source) : await parseHtmlSource(source);
      results.push(result);
      for (const item of result.items.slice(0, 5)) upsertEventFromItem(db, source, item);
      source.lastStatus = "ok";
      source.lastFetchedAt = nowIso();
    } catch (error) {
      source.lastStatus = "failed";
      source.lastError = error.message;
      results.push({ sourceId: source.id, status: "failed", error: error.message, items: [] });
    }
  }
  appendAudit(db, "刷新真实事件源", "event_sources", "EventSourceManager", results.some((r) => r.status === "failed") ? "warning" : "info");
  appendTrace(db, "event_sources", "refresh event sources", results.some((r) => r.status === "failed") ? "warning" : "ok");
  return { status: "ok", results };
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
  db.events.unshift({
    id: id("event"),
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
    createdAt: nowIso()
  });
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
  if ((db.events || []).some((event) => event.sourceLink === item.link || event.title === item.title)) return;
  db.events.unshift({
    id: id("event"),
    title: item.title,
    summary: item.summary,
    sourceLink: item.link,
    category: source.name.includes("Fed") ? "宏观事件" : "交易所事件",
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
