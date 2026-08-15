// 全市场异动扫描 + Gemini 消息面归因（借鉴 okx-ai-trading-journal 的 pump-gainers / pump-analysis）。
// 定位：给巡检提供"市场今天在发生什么"的环境感知（不是追涨信号），并给重大异动补上消息面归因，
// 补齐系统"消息面浅"的短板。全部真实数据；无 LLM 时只给行情异动、不编叙事。
import { activeProvider } from "./agentChat.mjs";
import { appendTrace, id, nowIso } from "./store.mjs";
import { containsLikelySecret, scrubSecrets } from "./secretRedaction.mjs";

const OKX_BASE = process.env.OKX_BASE_URL || "https://www.okx.com";
const ATTRIBUTION_CATEGORIES = new Map([
  ["宏观政策", "macro_policy"], ["macro_policy", "macro_policy"],
  ["监管合规", "regulation"], ["regulation", "regulation"],
  ["项目动态", "project_update"], ["project_update", "project_update"],
  ["资金动向", "capital_flow"], ["capital_flow", "capital_flow"],
  ["安全事件", "security_incident"], ["security_incident", "security_incident"],
  ["市场情绪", "market_sentiment"], ["market_sentiment", "market_sentiment"]
]);
const ATTRIBUTION_CONFIDENCE = new Set(["high", "medium", "low"]);

function boundedUntrustedText(value, maxChars) {
  const text = String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxChars);
  return text && !containsLikelySecret(text) ? scrubSecrets(text) : null;
}

function parseSearchJson(raw) {
  const text = String(raw || "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("search attribution returned no JSON object");
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("search attribution must be an object");
  return parsed;
}

// Search-grounded model output remains tainted even when it is valid JSON. Only
// enums/numbers/IDs may enter Agent context; prose is retained solely for UI.
export function normalizeSearchAttribution(input = {}, options = {}) {
  const category = ATTRIBUTION_CATEGORIES.get(String(input.category || "").trim()) || "unknown";
  const sentimentValue = input.sentimentScore ?? input.sentiment;
  const sentiment = sentimentValue !== null && sentimentValue !== undefined && sentimentValue !== ""
    && Number.isFinite(Number(sentimentValue))
    ? Math.max(0, Math.min(100, Number(sentimentValue)))
    : null;
  const confidence = ATTRIBUTION_CONFIDENCE.has(String(input.confidence || "").toLowerCase())
    ? String(input.confidence).toLowerCase()
    : "low";
  return {
    evidenceId: options.evidenceId || id("moverev"),
    sourceType: "untrusted_web_search_attribution",
    trust: "untrusted_external_data",
    mayTriggerTradeDirectly: false,
    category,
    sentiment,
    confidence,
    attributedAt: options.attributedAt || nowIso(),
    untrustedDisplay: {
      narrative: boundedUntrustedText(input.narrative, 500),
      risk: boundedUntrustedText(input.risk, 300)
    }
  };
}

export function marketMoversForAgent(db) {
  return (db.marketMovers?.movers || []).slice(0, 8).map((mover) => ({
    symbol: String(mover.symbol || ""),
    changePct: Number.isFinite(Number(mover.changePct)) ? Number(mover.changePct) : null,
    quoteVolUsdt: Number.isFinite(Number(mover.quoteVolUsdt)) ? Number(mover.quoteVolUsdt) : null,
    high24h: Number.isFinite(Number(mover.high24h)) ? Number(mover.high24h) : null,
    low24h: Number.isFinite(Number(mover.low24h)) ? Number(mover.low24h) : null,
    attribution: mover.narrative ? {
      evidenceId: mover.narrative.evidenceId,
      sourceType: mover.narrative.sourceType,
      trust: mover.narrative.trust,
      mayTriggerTradeDirectly: false,
      category: mover.narrative.category,
      sentiment: mover.narrative.sentiment,
      confidence: mover.narrative.confidence,
      attributedAt: mover.narrative.attributedAt
    } : null
  }));
}

// 全量 SWAP tickers → 按当日(UTC0)涨幅 + 成交额门槛筛异动币。一个请求，确定性。
async function scanMarketMovers(options = {}) {
  // 阈值 12% 太高:平静日无币达标 → marketMovers 常年空,环境感知失效(用户实锤)。
  // 降到 7% 让它更常surface异动;成交额门槛保留,滤掉不流动的小币。
  const minChangePct = Number(options.minChangePct ?? process.env.MOVER_MIN_CHANGE_PCT ?? 7);
  const minQuoteVol = Number(options.minQuoteVolUsdt ?? 3_000_000);
  const limit = Math.max(1, Math.min(20, Number(options.limit ?? 8)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const raw = await fetch(`${OKX_BASE}/api/v5/market/tickers?instType=SWAP`, { signal: controller.signal }).then((r) => r.json());
    if (raw.code !== "0" || !Array.isArray(raw.data)) return { movers: [], scannedAt: nowIso(), error: raw.msg || "tickers 拉取失败" };
    const movers = raw.data
      .filter((t) => String(t.instId).endsWith("-USDT-SWAP"))
      .map((t) => {
        const last = Number(t.last), sod = Number(t.sodUtc0), high = Number(t.high24h), low = Number(t.low24h);
        const quoteVol = Number(t.volCcy24h) * last; // volCcy24h 是币本位，×价 ≈ USDT 成交额
        return { symbol: String(t.instId).replace("-SWAP", "").replace("-", "/"), instId: t.instId, last, changePct: sod > 0 ? Number((((last - sod) / sod) * 100).toFixed(2)) : 0, quoteVolUsdt: Math.round(quoteVol), high24h: high, low24h: low };
      })
      .filter((t) => Math.abs(t.changePct) >= minChangePct && t.quoteVolUsdt >= minQuoteVol)
      .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
      .slice(0, limit);
    return { movers, scannedAt: nowIso() };
  } catch (error) {
    return { movers: [], scannedAt: nowIso(), error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

// Gemini + Google 搜索给某标的的异动做消息面归因（叙事/催化剂）。无 Gemini 则返回 null（不编）。
// 只用 Gemini（联网搜索能力），其它 provider 无搜索工具时退回纯行情推演。
async function attributeMoverNarrative(mover) {
  if (!process.env.GEMINI_API_KEY) return null;
  const prompt = `请查询并归因 ${mover.symbol}（OKX 永续）今天的异动。当前价 $${mover.last}，24h 涨跌 ${mover.changePct}%，成交额约 $${(mover.quoteVolUsdt / 1e6).toFixed(1)}M。\n用内置搜索查最新突发新闻/催化剂，只输出 JSON：{"narrative":"推动异动的核心叙事或催化剂(没查到就写'未见明确催化，疑似情绪/资金驱动')","category":"宏观政策|监管合规|项目动态|资金动向|安全事件","sentiment":0到100的情绪分,"risk":"主要风险一句话"}。中文，纯 JSON。`;
  try {
    const raw = await geminiSearchComplete(prompt);
    return normalizeSearchAttribution(parseSearchJson(raw));
  } catch {
    return null;
  }
}

// 直连 Gemini 的 generateContent（带 googleSearch 工具）——llmComplete 不带搜索能力，这里单独走。
// 搜索归因是辅助事实源，不应因免费额度 429 把整轮交易决策拖慢几十秒。
const geminiCircuit = {
  openUntil: 0,
  consecutiveFailures: 0,
  lastError: null,
  lastFailureAt: null,
  lastSuccessAt: null
};

function openGeminiCircuit(error, durationMs) {
  geminiCircuit.consecutiveFailures += 1;
  geminiCircuit.lastError = String(error?.message || error).slice(0, 160);
  geminiCircuit.lastFailureAt = nowIso();
  geminiCircuit.openUntil = Math.max(geminiCircuit.openUntil, Date.now() + durationMs);
}

export function geminiSearchCircuitStatus(now = Date.now()) {
  return {
    state: geminiCircuit.openUntil > now ? "open" : "closed",
    openUntil: geminiCircuit.openUntil ? new Date(geminiCircuit.openUntil).toISOString() : null,
    consecutiveFailures: geminiCircuit.consecutiveFailures,
    lastError: geminiCircuit.lastError,
    lastFailureAt: geminiCircuit.lastFailureAt,
    lastSuccessAt: geminiCircuit.lastSuccessAt
  };
}

export function resetGeminiSearchCircuit() {
  Object.assign(geminiCircuit, { openUntil: 0, consecutiveFailures: 0, lastError: null, lastFailureAt: null, lastSuccessAt: null });
}

export async function geminiSearchComplete(prompt) {
  if (geminiCircuit.openUntil > Date.now()) {
    throw new Error(`Gemini circuit open until ${new Date(geminiCircuit.openUntil).toISOString()}`);
  }
  // 搜索归因用 Gemini 模型:由设置里的 GEMINI_MODEL 字段控制(默认 flash——pro 免费档仅 5RPM/~50次每天
  // 会 429,flash ~1500/天够用)。GEMINI_SEARCH_MODEL 是可选的高级单独覆盖。
  const model = process.env.GEMINI_SEARCH_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";
  // 默认只试一次。429 立即熔断，后台下一轮再试；不在交易关键路径内 sleep 重试。
  const MAX_TRIES = Math.max(1, Math.min(2, Number(process.env.GEMINI_RETRY_MAX || 1)));
  for (let attempt = 1; attempt <= MAX_TRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], tools: [{ googleSearch: {} }] })
      });
      if (res.status === 429) {
        const body = await res.text().catch(() => "");
        const suggested = Number((body.match(/retry in ([\d.]+)s/i) || [])[1]);
        const configured = Number(process.env.GEMINI_CIRCUIT_429_MS || 5 * 60_000);
        const duration = Math.max(configured, Number.isFinite(suggested) ? Math.ceil(suggested * 1000) : 0);
        const error = new Error("Gemini 429 rate limited");
        openGeminiCircuit(error, duration);
        throw error;
      }
      if (!res.ok) {
        const error = new Error(`Gemini ${res.status}`);
        if (attempt < MAX_TRIES) continue;
        throw error;
      }
      const json = await res.json();
      geminiCircuit.openUntil = 0;
      geminiCircuit.consecutiveFailures = 0;
      geminiCircuit.lastError = null;
      geminiCircuit.lastSuccessAt = nowIso();
      return (json.candidates?.[0]?.content?.parts || []).map((p) => p.text).join("");
    } catch (error) {
      if (!String(error.message || error).includes("429") && !String(error.message || error).includes("circuit open")) {
        geminiCircuit.consecutiveFailures += 1;
        geminiCircuit.lastError = String(error.message || error).slice(0, 160);
        geminiCircuit.lastFailureAt = nowIso();
        if (geminiCircuit.consecutiveFailures >= 3) {
          geminiCircuit.openUntil = Math.max(geminiCircuit.openUntil, Date.now() + Number(process.env.GEMINI_CIRCUIT_ERROR_MS || 60_000));
        }
      }
      if (attempt >= MAX_TRIES || geminiCircuit.openUntil > Date.now()) throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Gemini search unavailable");
}

// 按需归因【某个币这波为什么涨/跌】——给 agent 的 explain_market_move 工具用,也给急动评估用。
// 结合 24h 涨跌 + 近15分钟短窗口动幅 + 区间位 + 成交额,用 Gemini+Google 搜索查催化剂。
// 无 GEMINI_API_KEY 则诚实返回"纯行情推演"(不编消息面)。
export async function explainMarketMove(db, symbol) {
  const sym = String(symbol || "").includes("/") ? symbol : String(symbol || "").replace(/USDT$/i, "/USDT");
  const market = (db.markets || []).find((m) => m.symbol === sym)
    || (db.markets || []).find((m) => String(m.symbol).split("/")[0] === String(sym).split("/")[0]);
  if (!market) return { symbol: sym, source: "no_market", narrative: `尚未同步 ${sym} 行情，请先 sync_market 再归因。`, technical: null };
  const last = Number(market.price);
  const chg = Number(market.changePct);
  const vol = Number(market.volume24h ?? market.quoteVolUsdt ?? 0);
  const high = Number(market.high24h), low = Number(market.low24h);
  const rangePos = (Number.isFinite(high) && Number.isFinite(low) && high > low && Number.isFinite(last)) ? Math.round((last - low) / (high - low) * 100) : null;
  // 近 15 分钟短窗口动幅(从快速异动价格缓冲算,有就带上让归因更贴"这波")
  let shortWin = null;
  const buf = (db.system?.priceBuffer?.[sym] || []).filter((s) => Date.now() - s.t <= 15 * 60_000);
  if (buf.length >= 2 && Number.isFinite(last)) {
    const hi = Math.max(...buf.map((s) => s.p)), lo = Math.min(...buf.map((s) => s.p));
    const drop = hi > 0 ? (hi - last) / hi * 100 : 0, rise = lo > 0 ? (last - lo) / lo * 100 : 0;
    if (Math.max(drop, rise) >= 0.5) shortWin = drop >= rise ? { dir: "down", pct: Number(drop.toFixed(2)) } : { dir: "up", pct: Number(rise.toFixed(2)) };
  }
  const technical = { last, changePct24h: Number.isFinite(chg) ? chg : null, rangePosition24h: rangePos, shortWindow: shortWin, quoteVolUsdtM: Number.isFinite(vol) ? Number((vol / 1e6).toFixed(1)) : null };
  db.marketNarratives ||= {};
  const cached = db.marketNarratives[sym];
  const narrativeTtlMs = Number(process.env.MARKET_NARRATIVE_CACHE_MS || 15 * 60_000);
  if (cached?.attributedAt && Date.now() - new Date(cached.attributedAt).getTime() <= narrativeTtlMs) {
    return attributionForAgent(cached, { symbol: sym, source: "gemini_cache", technical, cacheHit: true });
  }
  if (!process.env.GEMINI_API_KEY) {
    return { symbol: sym, source: "quote_only", attribution: null, technical, mayTriggerTradeDirectly: false, status: "search_not_configured" };
  }
  const prompt = `请归因 ${sym}（加密永续）当前这波行情【为什么会这样涨/跌】。现价 $${last}，24h ${chg >= 0 ? "+" : ""}${chg}%${shortWin ? `，近15分钟${shortWin.dir === "down" ? "急跌" : "急涨"}${shortWin.pct}%` : ""}${rangePos != null ? `，处于24h区间${rangePos}%位` : ""}，24h成交额约 $${(vol / 1e6).toFixed(0)}M。用内置搜索查最近的突发新闻/催化剂/宏观事件/连锁清算/市场情绪，解释这波涨跌的原因。只输出 JSON：{"narrative":"核心原因或催化剂,一到两句(确实查不到就写'未见明确催化,疑似情绪/资金/杠杆连锁清算驱动')","category":"宏观政策|监管合规|项目动态|资金动向|安全事件|市场情绪","sentiment":0到100的情绪分,"risk":"主要风险一句话","confidence":"high|medium|low"}。中文，纯 JSON。`;
  try {
    const raw = await geminiSearchComplete(prompt);
    const attribution = normalizeSearchAttribution(parseSearchJson(raw));
    const result = { symbol: sym, source: "gemini", ...attribution, technical, cacheHit: false };
    db.marketNarratives[sym] = result;
    return attributionForAgent(result, { symbol: sym, source: "gemini", technical, cacheHit: false });
  } catch (error) {
    return { symbol: sym, source: "gemini_failed", attribution: null, technical, mayTriggerTradeDirectly: false, status: "search_failed" };
  }
}

function attributionForAgent(stored = {}, overrides = {}) {
  return {
    ...overrides,
    attribution: {
      evidenceId: stored.evidenceId,
      sourceType: stored.sourceType,
      trust: "untrusted_external_data",
      mayTriggerTradeDirectly: false,
      category: ATTRIBUTION_CATEGORIES.has(stored.category) ? stored.category : "unknown",
      sentiment: stored.sentiment !== null && Number.isFinite(Number(stored.sentiment)) ? Number(stored.sentiment) : null,
      confidence: ATTRIBUTION_CONFIDENCE.has(stored.confidence) ? stored.confidence : "low",
      attributedAt: stored.attributedAt || null
    },
    mayTriggerTradeDirectly: false
  };
}

// 复盘用:查某币在【开仓→平仓时间窗内】的真实消息面(新闻/催化剂/宏观),强制反幻觉。
// 借鉴 okx-journal 单笔诊断:用"世界当时发生了什么"给盈亏归因,而非只看K线。无 Gemini 则返回 null。
export async function fetchTradeWindowNews(symbol, fromIso, toIso) {
  if (!process.env.GEMINI_API_KEY) return null;
  const sym = String(symbol || "").includes("/") ? symbol : String(symbol || "").replace(/USDT$/i, "/USDT");
  const win = `${String(fromIso || "").slice(0, 16)} → ${String(toIso || "").slice(0, 16)} (UTC)`;
  const prompt = `用内置搜索查加密货币 ${sym} 在这个时间窗内【${win}】是否发生过重大新闻/催化剂/宏观事件/交易所动态/连锁清算,用来复盘一笔在此期间的交易。\n【硬性要求·反幻觉】只报你真的检索到、且时间确实落在该窗内的事件;确实没有就直接回"该窗内未见明确催化,疑似情绪/资金/杠杆驱动",绝对不要编造或假设新闻,不要把窗外的旧闻算进来。\n只输出 JSON:{"news":"一到两句话概括窗内真实消息面或明确写无","sentiment":"利多|利空|中性|无","confidence":"high|medium|low"}。中文,纯 JSON。`;
  try {
    const raw = await geminiSearchComplete(prompt);
    const parsed = parseSearchJson(raw);
    const sentiment = ["利多", "利空", "中性", "无"].includes(parsed.sentiment) ? parsed.sentiment : "无";
    const confidence = ATTRIBUTION_CONFIDENCE.has(String(parsed.confidence || "").toLowerCase()) ? String(parsed.confidence).toLowerCase() : "low";
    return {
      evidenceId: id("tradewinev"),
      sourceType: "untrusted_web_search_attribution",
      trust: "untrusted_external_data",
      mayTriggerTradeDirectly: false,
      sentiment,
      confidence,
      window: win,
      at: nowIso()
    };
  } catch { return null; }
}

// 巡检用：扫异动 + 给最猛的前 N 个补归因，写入 db.marketMovers 供决策上下文与事件引擎引用。
export async function refreshMarketMovers(db, options = {}) {
  const scan = await scanMarketMovers(options);
  const attributeTop = Math.max(0, Math.min(3, Number(options.attributeTop ?? (activeProvider() ? 2 : 0))));
  for (let i = 0; i < Math.min(attributeTop, scan.movers.length); i += 1) {
    const narr = await attributeMoverNarrative(scan.movers[i]);
    if (narr) scan.movers[i].narrative = narr;
  }
  db.marketMovers = { ...scan, updatedAt: nowIso() };
  appendTrace(db, "market_scan", `异动扫描 ${scan.movers.length} 个${scan.error ? "（含错误）" : ""}`, scan.error ? "warning" : "ok", 0);
  return db.marketMovers;
}

// 带消息面的持仓护航（借鉴"提线木偶护航哨兵"）：对当前持仓做"实时新闻 + 防守/进攻"复检。
// 关键区别：只产出【建议/告警】，绝不自动裸下单——减仓/平仓仍走风控与人工/授权流程。
export async function escortPositions(db) {
  const positions = (db.positions || []).filter((p) => Number(p.size ?? p.pos ?? 0) !== 0);
  if (!positions.length) { db.positionEscort = { note: "当前无持仓，护航休眠", positions: [], at: nowIso() }; return db.positionEscort; }
  const payload = positions.map((p) => ({ symbol: p.symbol, dir: p.direction, size: p.size ?? p.pos, entry: p.entry ?? p.avgPx, mark: p.mark, upl: p.pnl ?? p.upl, roiPct: p.roiPct, lev: p.leverage }));
  if (!process.env.GEMINI_API_KEY) {
    // 无 Gemini：给纯行情级护航（浮亏超阈值提示），不编消息面。
    const alerts = payload.filter((p) => Number(p.roiPct) <= -8).map((p) => ({ symbol: p.symbol, level: "warn", advice: `${p.symbol} 浮亏 ${p.roiPct}%，关注止损纪律` }));
    db.positionEscort = { positions: payload, alerts, source: "quote_only", at: nowIso() };
    appendTrace(db, "position_escort", `持仓护航(纯行情) ${positions.length} 仓`, "ok", 0);
    return db.positionEscort;
  }
  const prompt = `你是持仓护航哨兵。用内置搜索查这些币/加密市场最新突发新闻，对每个持仓给【15分钟级】防守/进攻短评与消息面影响；风险高就明确建议减仓或平仓。当前持仓：\n${JSON.stringify(payload)}\n只输出 JSON：{"overall":"整体一句话","alerts":[{"symbol":"","level":"info|warn|danger","advice":"具体建议","newsImpact":"相关消息面影响或'无'"}]}。中文，纯 JSON。`;
  try {
    const raw = await geminiSearchComplete(prompt);
    const parsed = parseSearchJson(raw);
    const knownSymbols = new Set(payload.map((item) => item.symbol));
    const alerts = (Array.isArray(parsed.alerts) ? parsed.alerts : []).slice(0, payload.length * 2).map((item) => ({
      symbol: knownSymbols.has(String(item?.symbol || "")) ? String(item.symbol) : null,
      level: ["info", "warn", "danger"].includes(item?.level) ? item.level : "info",
      advice: boundedUntrustedText(item?.advice, 300),
      newsImpact: boundedUntrustedText(item?.newsImpact, 300),
      trust: "untrusted_external_data",
      mayTriggerTradeDirectly: false
    })).filter((item) => item.symbol);
    db.positionEscort = {
      positions: payload,
      overall: boundedUntrustedText(parsed.overall, 400),
      alerts,
      source: "gemini",
      trust: "untrusted_external_data",
      mayTriggerTradeDirectly: false,
      at: nowIso()
    };
    // 高危告警落成风险事件（走既有告警链，仍不自动下单）。
    for (const a of alerts.filter((x) => x.level === "danger")) {
      db.riskIncidents ||= [];
      // 同 symbol 的 open 护航告警合并滚动更新(此前每 2 分钟无脑 unshift,30 条/小时挤爆事件列表)
      const existing = db.riskIncidents.find((i) => i.status === "open" && i.source === "position_escort" && i.symbol === a.symbol);
      if (existing) {
        existing.title = `持仓护航外部风险信号 ${a.symbol}（需确定性复核）`;
        existing.untrustedDisplay = { advice: a.advice, newsImpact: a.newsImpact };
        existing.count = Number(existing.count || 1) + 1;
        existing.updatedAt = nowIso();
      } else {
        db.riskIncidents.unshift({ id: `escort_${Date.now()}_${a.symbol}`, symbol: a.symbol, severity: "high", status: "open", title: `持仓护航外部风险信号 ${a.symbol}（需确定性复核）`, source: "position_escort", trust: "untrusted_external_data", mayTriggerTradeDirectly: false, untrustedDisplay: { advice: a.advice, newsImpact: a.newsImpact }, count: 1, createdAt: nowIso() });
      }
    }
    appendTrace(db, "position_escort", `持仓护航(消息面) ${positions.length} 仓`, "ok", 0);
    return db.positionEscort;
  } catch (error) {
    db.positionEscort = { positions: payload, error: error.message, at: nowIso() };
    return db.positionEscort;
  }
}
