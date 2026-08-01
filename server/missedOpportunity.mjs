// 错过机会复盘(#5):系统只复盘"做过的单",从不复盘"该做没做/没看到"的大行情。
// 这里补上:拿全市场异动扫描(db.marketMovers)里的大波动当候选,凡是我们【近窗口内没交易】的,
// 就算一次潜在错过——尤其白名单内或我们分析过却放弃的,更值得学。对优先项调 LLM 复盘"该不该做、
// 错过了什么信号、下次怎么抓",沉淀进长期记忆让 agent 学会别老错过。纯真实数据,不编造行情。
import { activeMandate, appendAudit, appendTrace, id, nowIso } from "./store.mjs";

const fillTime = (f) => new Date(f.at || f.closedAt || f.filledAt || f.openedAt || f.createdAt || 0).getTime();

async function llmMissedLesson(mover, ctx) {
  try {
    const { llmComplete } = await import("./agentChat.mjs");
    const sys = "你是加密永续交易复盘专家。只根据给定事实复盘错过的机会，不编造行情。输出具体、可执行、直指'下次如何抓住'，禁止空话。";
    const prompt = [
      `复盘一个我【没有交易】的大波动：`,
      `- 品种：${mover.symbol}（OKX 永续）`,
      `- 近 24h 涨跌：${mover.changePct >= 0 ? "+" : ""}${mover.changePct}%｜成交额约 $${(mover.quoteVolUsdt / 1e6).toFixed(0)}M`,
      mover.narrative?.narrative ? `- 异动叙事：${mover.narrative.narrative}` : "",
      `- 是否在授权白名单内：${ctx.inWhitelist ? "是（本可交易）" : "否（需加白才能交易）"}`,
      `- 我是否分析过它：${ctx.analyzed ? "分析过但没做" : "根本没关注到"}`,
      "",
      "回答三点，每点一句：①这波是否是我【本该抓住】的机会（结合方向/结构/我的授权边界判断，别硬说都该做）；②我错过的根因（没扫到？分析了却过度保守观望？不在白名单？）；③下次要抓住这类机会，具体应该建立什么信号或调整（如加白、放宽某条过严的观望条件、挂突破观察哨）。"
    ].filter(Boolean).join("\n");
    const out = await llmComplete(prompt, sys);
    return out ? String(out).replace(/\s+\n/g, "\n").trim().slice(0, 600) : null;
  } catch { return null; }
}

export async function reviewMissedOpportunities(db) {
  const movers = db.marketMovers?.movers || [];
  if (!movers.length) return { reviewed: 0, missed: 0, items: [] };
  const minMove = Number(process.env.MISSED_OPP_MIN_MOVE_PCT || 10);
  const windowMs = Number(process.env.MISSED_OPP_WINDOW_MS || 24 * 3600 * 1000);
  let llmBudget = Number(process.env.MISSED_OPP_LLM_MAX_PER_RUN || 4);
  const now = Date.now();
  const mandate = activeMandate(db);
  const whitelist = new Set((mandate?.allowedSymbols || []).map((s) => String(s).toUpperCase()));

  // 近窗口内"交易过"的品种(有成交或持仓)——做了就不算错过。
  const traded = new Set();
  for (const f of db.fills || []) { if (now - fillTime(f) < windowMs) traded.add(String(f.symbol).toUpperCase()); }
  for (const p of db.positions || []) { if (Number(p.size ?? p.pos ?? 0) !== 0) traded.add(String(p.symbol).toUpperCase()); }

  db.missedOpportunities ||= [];
  const seen = new Set(db.missedOpportunities.map((m) => m.key));
  const today = new Date().toISOString().slice(0, 10);
  db.memoryItems ||= [];

  const items = [];
  for (const m of movers) {
    if (Math.abs(Number(m.changePct)) < minMove) continue;
    const sym = String(m.symbol).toUpperCase();
    if (traded.has(sym)) continue;
    const key = `${sym}|${today}`; // 同一品种同一天只复盘一次
    if (seen.has(key)) continue;
    seen.add(key);
    // 是否分析过它(近窗口的巡检/对话里提到过)
    const analyzed = (db.agentRuns || []).some((r) => now - new Date(r.createdAt || 0).getTime() < windowMs && JSON.stringify(r.steps || "").includes(m.symbol));
    const inWhitelist = whitelist.has(sym);
    const entry = {
      key,
      symbol: m.symbol,
      changePct: Number(m.changePct),
      quoteVolUsdtM: Number((Number(m.quoteVolUsdt || 0) / 1e6).toFixed(1)),
      inWhitelist,
      analyzed,
      narrative: m.narrative?.narrative || null,
      lesson: null,
      createdAt: nowIso()
    };
    // 优先给"白名单内"或"分析过却放弃"的调 LLM 深度复盘(这些最该学),其余只记录不调 LLM。
    if (llmBudget > 0 && (inWhitelist || analyzed)) {
      const lesson = await llmMissedLesson(m, { inWhitelist, analyzed });
      if (lesson) {
        entry.lesson = lesson;
        llmBudget -= 1;
        db.memoryItems.unshift({
          id: id("mem"),
          layer: "episodic",
          title: `错过复盘 ${m.symbol} ${m.changePct >= 0 ? "+" : ""}${m.changePct}%`,
          content: `错过机会复盘：${m.symbol} 近24h ${m.changePct >= 0 ? "+" : ""}${m.changePct}%${inWhitelist ? "（白名单内）" : ""}${analyzed ? "（分析过却没做）" : ""}。\n\n【复盘】${lesson}`,
          tags: ["missed_opportunity", inWhitelist ? "in_whitelist" : "off_whitelist", analyzed ? "analyzed" : "unseen"],
          source: "missed_opportunity_review",
          createdAt: nowIso()
        });
      }
    }
    db.missedOpportunities.unshift(entry);
    items.push(entry);
  }
  if (db.missedOpportunities.length > 100) db.missedOpportunities = db.missedOpportunities.slice(0, 100);
  if (db.memoryItems.length > 200) db.memoryItems = db.memoryItems.slice(0, 200);

  if (items.length) {
    appendAudit(db, `错过机会复盘 ${items.length} 个大波动（${items.map((i) => i.symbol).slice(0, 5).join("、")}）`, "missed_opportunity", "MissedOppReview", "info");
    appendTrace(db, "review", `错过机会复盘 ${items.length} 个`, "ok");
    // 白名单内错过的更值得提醒(本可交易却没做)
    const wlMissed = items.filter((i) => i.inWhitelist);
    if (wlMissed.length) {
      try {
        const { notifyLark } = await import("./larkNotifier.mjs");
        await notifyLark(db, {
          severity: "info",
          title: "🎯 错过机会复盘",
          body: `白名单内有 ${wlMissed.length} 个大波动本可交易但未做：${wlMissed.map((i) => `${i.symbol} ${i.changePct >= 0 ? "+" : ""}${i.changePct}%`).join("、")}。已沉淀复盘进记忆。`
        });
      } catch { /* 通知失败不阻断 */ }
    }
  }
  return { reviewed: movers.length, missed: items.length, items };
}
