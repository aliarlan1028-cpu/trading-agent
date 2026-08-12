import { fetchExternalText } from "./externalInputSafety.mjs";
import { recordSourceHealth, upsertIntelligenceFact } from "./marketIntelligence.mjs";
import { createNotification } from "./notificationStore.mjs";
import { appendAudit, nowIso } from "./store.mjs";

export const ME_NEWS_FLASH_URL = "https://api.me.news/getArticleList";
const TEN_MINUTES = 10 * 60_000;

const SYMBOL_PATTERNS = [
  ["BTC/USDT", /bitcoin|比特币|\bbtc\b/i], ["ETH/USDT", /ethereum|以太坊|\beth\b/i],
  ["SOL/USDT", /solana|\bsol\b/i], ["ADA/USDT", /cardano|\bada\b/i],
  ["SUI/USDT", /\bsui\b/i], ["XRP/USDT", /ripple|\bxrp\b/i],
  ["BNB/USDT", /binance coin|币安币|\bbnb\b/i], ["DOGE/USDT", /dogecoin|狗狗币|\bdoge\b/i]
];

// 只把“对加密市场有明确传导路径”的重要快讯唤起 AI。ME 的 important 标签覆盖股票、
// 科技等大量泛财经新闻，不能把它直接等同于交易信号，否则既浪费 LLM，也会放大噪声。
const MARKET_RELEVANT = /比特币|以太坊|加密|数字资产|稳定币|交易所|币安|coinbase|bitcoin|ethereum|crypto|stablecoin|\betf\b|美联储|联储|fomc|通胀|\bcpi\b|\bpce\b|非农|就业|失业|降息|加息|利率|流动性|美元|美债|关税|制裁|战争|停火|地缘|原油|oil|federal reserve|interest rate|inflation|tariff|sanction|liquidity|treasury/i;

export function parseMeNewsFlashPayload(payload = {}) {
  const rows = payload?.data?.list;
  if (!Array.isArray(rows)) throw new Error("ME News 响应缺少 data.list");
  return rows.map((row) => {
    const text = `${row.title || ""} ${row.content || ""}`;
    const timestamp = Number(row.release_time_stamp);
    const publishedAt = Number.isFinite(timestamp) && timestamp > 0
      ? new Date(timestamp * 1000).toISOString()
      : parseChinaTime(row.release_time || row.create_date);
    const symbols = SYMBOL_PATTERNS.filter(([, regex]) => regex.test(text)).map(([symbol]) => symbol);
    const important = Number(row.is_important_flash) === 1;
    const marketRelevant = MARKET_RELEVANT.test(text) || symbols.length > 0;
    return {
      externalId: String(row.id || ""),
      title: String(row.title || "").trim(),
      summary: String(row.content || "").replace(/^ME News 消息，/i, "").trim().slice(0, 1200),
      sourceUrl: row.url || `https://www.me.news/news/${row.id}`,
      publishedAt,
      symbols,
      important,
      marketRelevant,
      impact: important && marketRelevant ? 82 : important ? 60 : marketRelevant ? 50 : 25,
      categoryId: row.category_id ?? null
    };
  }).filter((row) => row.externalId && row.title && row.publishedAt);
}
function parseChinaTime(value) {
  const text = String(value || "").trim();
  if (!text) return nowIso();
  const normalized = text.includes("T") ? text : text.replace(" ", "T");
  const parsed = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(normalized) ? normalized : `${normalized}+08:00`);
  return Number.isNaN(parsed.getTime()) ? nowIso() : parsed.toISOString();
}

async function fetchMeNewsPayload() {
  const { response, text } = await fetchExternalText(ME_NEWS_FLASH_URL, {
    method: "POST",
    timeoutMs: 10_000,
    maxBytes: 2 * 1024 * 1024,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ category_id: 0, type: 2, page: 1, size: 30 })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error("ME News 响应不是有效 JSON"); }
  if (Number(payload?.code) !== 200) throw new Error(`ME News API ${payload?.code || "unknown"}`);
  return payload;
}

export async function refreshMeNewsFlash(db, options = {}) {
  const startedAt = Date.now();
  const observedAt = nowIso();
  try {
    const payload = options.payload || await (options.fetchPayload || fetchMeNewsPayload)();
    const rows = parseMeNewsFlashPayload(payload);
    const existingIds = new Set((db.marketIntelligenceFacts || [])
      .filter((fact) => fact.sourceId === "me_news_flash")
      .map((fact) => String(fact.externalId || "")));
    const initialized = db.meta?.meNewsFlashInitialized === true;
    const freshCutoff = Date.now() - TEN_MINUTES;
    const added = [];
    const urgent = [];

    for (const row of rows) {
      const isNew = !existingIds.has(row.externalId);
      const fact = upsertIntelligenceFact(db, {
        type: "news", category: "flash_news", sourceId: "me_news_flash", sourceName: "ME News 快讯",
        sourceUrl: row.sourceUrl, externalId: row.externalId, title: row.title, summary: row.summary,
        symbols: row.symbols, confidence: row.important ? 0.72 : 0.58, publishedAt: row.publishedAt,
        observedAt, ttlMs: 36 * 60 * 60_000,
        values: {
          impact: row.impact, important: row.important, marketRelevant: row.marketRelevant,
          categoryId: row.categoryId, receivedLatencyMs: Math.max(0, Date.now() - new Date(row.publishedAt).getTime()),
          aggregator: true, analysisContextOnly: true, mayTriggerTradeDirectly: false
        }
      });
      if (isNew) added.push(fact);
      // 首次接入只建立基线，不把列表里已有的 30 条历史快讯一起唤醒 Agent。
      if (initialized && isNew && row.important && row.marketRelevant && new Date(row.publishedAt).getTime() >= freshCutoff) urgent.push(fact);
    }

    db.meta ||= {};
    db.meta.meNewsFlashInitialized = true;
    db.meta.meNewsFlashLastPollAt = observedAt;
    db.system ||= {};
    if (urgent.length) {
      const pending = db.system.pendingNewsSignals || [];
      const known = new Set(pending.map((item) => item.factId));
      for (const fact of urgent) {
        if (known.has(fact.id)) continue;
        pending.push({
          kind: "breaking_news", factId: fact.id, title: fact.title, summary: fact.summary,
          sourceName: fact.sourceName, sourceUrl: fact.sourceUrl, symbols: fact.symbols,
          impact: fact.values?.impact, publishedAt: fact.publishedAt, queuedAt: observedAt,
          analysisContextOnly: true, mayTriggerTradeDirectly: false
        });
        createNotification(db, {
          eventType: "important_news", severity: "warning", title: "重要快讯进入 AI 复核",
          body: `${fact.title}。只触发分析复核，不会仅凭新闻直接下单。`
        });
      }
      db.system.pendingNewsSignals = pending.slice(-20);
      appendAudit(db, `重要快讯进入分析复核队列：${urgent.length} 条`, "me_news_flash", "NewsFlashFeed", "warning");
    }
    recordSourceHealth(db, {
      id: "me_news_flash", name: "ME News 7×24 快讯", url: ME_NEWS_FLASH_URL,
      category: "news_fast", required: false, staleAfterMs: 3 * 60_000
    }, { status: "ok", checkedAt: observedAt, lastDataAt: rows[0]?.publishedAt, itemCount: rows.length, latencyMs: Date.now() - startedAt });
    return { status: "ok", fetched: rows.length, added: added.length, urgent, initialized, latencyMs: Date.now() - startedAt };
  } catch (error) {
    recordSourceHealth(db, {
      id: "me_news_flash", name: "ME News 7×24 快讯", url: ME_NEWS_FLASH_URL,
      category: "news_fast", required: false, staleAfterMs: 3 * 60_000
    }, { status: "failed", checkedAt: observedAt, error: String(error.message || error), latencyMs: Date.now() - startedAt });
    return { status: "failed", error: String(error.message || error), added: 0, urgent: [], latencyMs: Date.now() - startedAt };
  }
}
