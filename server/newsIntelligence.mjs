// P0 信息面智能:在已有 RSS 事件之上,加"来源可信度 + 多源交叉验证 + 去重聚类 + 情绪/影响币种/
// 影响时长/已计价程度/假消息风险"的结构化富化。只用现有 LLM,不需新 key。产出写到 event.intel,
// 供 get_events 与 buildSystemPrompt 使用,让 Agent 决策时"看得更广、不被单源假消息带偏"。
import { nowIso, appendTrace } from "./store.mjs";
import { llmComplete, activeProvider } from "./agentChat.mjs";

// 来源可信度分层(按类型/域名)。官方公告/交易所/监管最高,主流媒体次之,社媒/聚合最低。
function credibilityOf(source, ev) {
  const s = (String(source?.type || "") + " " + String(source?.name || "") + " " + String(ev?.sourceLink || source?.url || "")).toLowerCase();
  if (/regulat|sec\.gov|监管|cftc|federalreserve/.test(s)) return 0.95;
  if (/official|announcement|官方|okx\.com|binance\.com|coinbase\.com|kraken/.test(s)) return 0.9;
  if (/coindesk|cointelegraph|theblock|bloomberg|reuters|wsj/.test(s)) return 0.72;
  if (/twitter|x\.com|reddit|telegram|weibo|社交|kol/.test(s)) return 0.4;
  return 0.6; // 聚合/未知
}

const normTitle = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9一-龥]+/g, " ").trim();
function similar(a, b) {
  const A = new Set(normTitle(a).split(" ").filter(Boolean));
  const B = new Set(normTitle(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

const NEWS_SYSTEM = "你是加密市场信息面分析师。对给定新闻做结构化判断:只据事实、不编造、拿不准就标不确定。只输出纯 JSON。";

export async function enrichEvents(db, { max = 8 } = {}) {
  if (!activeProvider()) return { ok: false, reason: "未配置 LLM" };
  db.events ||= [];
  const sources = db.eventSources || [];
  const srcOf = (ev) => sources.find((s) => s.id === ev.sourceId);
  const fresh = db.events.filter((e) => e.kind !== "onchain_signal" && e.title && !e.intel).slice(0, max);
  if (!fresh.length) return { ok: true, enriched: 0 };

  // 多源交叉验证:统计每条被其它"来源"相似报道的次数(>0.5 视为同一事件)
  for (const e of fresh) {
    const seen = new Set();
    for (const other of db.events) {
      if (other === e || !other.title) continue;
      if (similar(e.title, other.title) > 0.5 && other.sourceId && other.sourceId !== e.sourceId) seen.add(other.sourceId);
    }
    e._corrob = seen.size;
  }
  // 先按启发式落默认 intel(即便 LLM 挂了也有可信度/交叉验证/假消息基线)
  for (const e of fresh) {
    const cred = credibilityOf(srcOf(e), e);
    e.intel = { credibility: Number(cred.toFixed(2)), corroboration: e._corrob, sentiment: "不确定", affectedSymbols: [], impactHorizon: "", pricedIn: null, fakeRisk: e._corrob >= 1 ? "low" : cred < 0.5 ? "high" : "med", oneLine: "", at: nowIso() };
  }

  const items = fresh.map((e, i) => ({ i, title: e.title, summary: String(e.summary || e.title).slice(0, 220), publishedAt: e.publishedAt || e.createdAt, source: srcOf(e)?.name || "", credibility: e.intel.credibility, corroboration: e._corrob }));
  const prompt = `逐条判断下列加密新闻,只输出纯 JSON:\n${JSON.stringify(items)}\n\n返回 {"intel":[{"i":序号,"sentiment":"利多|利空|中性|不确定","affectedSymbols":["BTC","ETH"],"impactHorizon":"即时|数小时|数天|数周","pricedIn":0到1的小数,"fakeRisk":"low|med|high","oneLine":"一句话判断+对交易的含义"}]}\n判据:①affectedSymbols 要具体到币,泛泛的写 ["BTC"];②pricedIn 越高=市场多半已消化(旧闻/已预期);③社媒或单源未经证实(corroboration=0)且影响大 → fakeRisk=high;④拿不准 sentiment 就写不确定。`;
  let parsed;
  try {
    const raw = await llmComplete(prompt, NEWS_SYSTEM);
    parsed = JSON.parse(String(raw).slice(String(raw).indexOf("{"), String(raw).lastIndexOf("}") + 1));
  } catch {
    for (const e of fresh) delete e._corrob;
    return { ok: false, reason: "信息面模型返回无法解析(已保留启发式基线)" };
  }
  for (const x of (parsed.intel || [])) {
    const e = fresh[x.i];
    if (!e || !e.intel) continue;
    Object.assign(e.intel, {
      sentiment: x.sentiment || e.intel.sentiment,
      affectedSymbols: Array.isArray(x.affectedSymbols) ? x.affectedSymbols.map((s) => String(s).toUpperCase()).slice(0, 6) : [],
      impactHorizon: x.impactHorizon || "",
      pricedIn: Number.isFinite(Number(x.pricedIn)) ? Number(x.pricedIn) : null,
      fakeRisk: x.fakeRisk || e.intel.fakeRisk,
      oneLine: String(x.oneLine || "").slice(0, 160)
    });
  }
  for (const e of fresh) delete e._corrob;
  appendTrace(db, "news_intel", `信息面富化 ${fresh.length} 条`, "ok");
  return { ok: true, enriched: fresh.length };
}

// 给 buildSystemPrompt 用:挑高可信度、未计价、非高假风险的关键新闻,压成决策可读的简报。
export function newsBriefForPrompt(db, { max = 5 } = {}) {
  const withIntel = (db.events || []).filter((e) => e.intel && e.intel.sentiment && e.intel.sentiment !== "中性");
  const scored = withIntel.map((e) => ({ e, score: (e.intel.credibility || 0.5) * (1 - (e.intel.pricedIn ?? 0.5)) * (e.intel.fakeRisk === "high" ? 0.3 : 1) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map(({ e }) => {
    const it = e.intel;
    const flags = [it.fakeRisk === "high" ? "⚠未证实" : it.corroboration >= 1 ? `${it.corroboration}源印证` : "单源", it.pricedIn != null ? `已计价${Math.round(it.pricedIn * 100)}%` : ""].filter(Boolean).join(" · ");
    return `- [${it.sentiment}${it.affectedSymbols.length ? " " + it.affectedSymbols.join("/") : ""}${it.impactHorizon ? " · " + it.impactHorizon : ""}] ${it.oneLine || e.title}（可信 ${Math.round((it.credibility || 0) * 100)}% · ${flags}）`;
  });
}
