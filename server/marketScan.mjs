// 全市场异动扫描 + Gemini 消息面归因（借鉴 okx-ai-trading-journal 的 pump-gainers / pump-analysis）。
// 定位：给巡检提供"市场今天在发生什么"的环境感知（不是追涨信号），并给重大异动补上消息面归因，
// 补齐系统"消息面浅"的短板。全部真实数据；无 LLM 时只给行情异动、不编叙事。
import { llmComplete, activeProvider } from "./agentChat.mjs";
import { appendTrace, nowIso } from "./store.mjs";

const OKX_BASE = process.env.OKX_BASE_URL || "https://www.okx.com";

// 全量 SWAP tickers → 按当日(UTC0)涨幅 + 成交额门槛筛异动币。一个请求，确定性。
async function scanMarketMovers(options = {}) {
  const minChangePct = Number(options.minChangePct ?? 12);
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
    const parsed = JSON.parse(String(raw || "").slice(String(raw).indexOf("{"), String(raw).lastIndexOf("}") + 1));
    return { ...parsed, attributedAt: nowIso() };
  } catch {
    return null;
  }
}

// 直连 Gemini 的 generateContent（带 googleSearch 工具）——llmComplete 不带搜索能力，这里单独走。
async function geminiSearchComplete(prompt) {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-pro";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], tools: [{ googleSearch: {} }] })
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const json = await res.json();
    return (json.candidates?.[0]?.content?.parts || []).map((p) => p.text).join("");
  } finally {
    clearTimeout(timer);
  }
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
    const parsed = JSON.parse(String(raw || "").slice(String(raw).indexOf("{"), String(raw).lastIndexOf("}") + 1));
    db.positionEscort = { positions: payload, ...parsed, source: "gemini", at: nowIso() };
    // 高危告警落成风险事件（走既有告警链，仍不自动下单）。
    for (const a of (parsed.alerts || []).filter((x) => x.level === "danger")) {
      db.riskIncidents ||= [];
      db.riskIncidents.unshift({ id: `escort_${Date.now()}_${a.symbol}`, severity: "high", status: "open", title: `持仓护航告警 ${a.symbol}：${a.advice}`, source: "position_escort", createdAt: nowIso() });
    }
    appendTrace(db, "position_escort", `持仓护航(消息面) ${positions.length} 仓`, "ok", 0);
    return db.positionEscort;
  } catch (error) {
    db.positionEscort = { positions: payload, error: error.message, at: nowIso() };
    return db.positionEscort;
  }
}
