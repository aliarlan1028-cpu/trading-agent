// AI 交易行为画像 · 量化引擎(确定性,不依赖 LLM)。
// 从真实持久数据(fills/plans)算"AI 自己的交易行为指标"——比 okx-journal 强在:我们有
// 亏损归因(策略/执行/市场)、真实杠杆(plan)、持仓时长(入场↔平仓时间差)、ROI(净盈亏÷保证金)。
// LLM 叙述层单独在别处用主模型(deepseek)基于本结果 + 入场理由/复盘生成"性格+致命习惯+纪律"。
import { id, nowIso, appendAudit } from "./store.mjs";
import { resolveClosedTradePosterBasis } from "./positionPoster.mjs";
import { findTradeEntryFill, groupClosedTradeLifecycles, resolveTradeContext } from "./tradeReviewQueue.mjs";

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const dirCanon = (d) => { const s = String(d ?? "").toLowerCase(); return (s.includes("short") || s.includes("空") || s === "sell") ? "short" : "long"; };
export const fmtMin = (m) => (m == null ? "—" : m < 60 ? `${Math.round(m)}m` : `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, "0")}m`);

// 抽出"每笔已平仓交易":join 入场fill(取持仓时长)、plan(取杠杆)、算 ROI。
export function buildClosedTrades(db) {
  const fills = db.fills || [];
  // 一次仓位生命周期可能有多次减仓；画像必须按完整交易聚合，否则胜率、杠杆习惯和样本量都会被部分平仓扭曲。
  const closes = groupClosedTradeLifecycles(fills);
  return closes.map((lifecycle) => {
    const c = lifecycle.representative;
    const { plan = {}, executionOrder = {} } = resolveTradeContext(db, lifecycle);
    const entry = findTradeEntryFill(fills, c);
    const costBasis = resolveClosedTradePosterBasis(db, lifecycle);
    const leverage = num(executionOrder?.leverage) ?? num(plan?.leverage) ?? num(c.leverage);
    const grossPnl = num(lifecycle.realizedPnl);
    const pnl = num(lifecycle.netRealizedPnl);
    const entryNotional = num(costBasis.entryNotionalUsdt);
    // ROI 分母只接受已记录保证金或完整入场名义额；平仓名义额随退出价变化，不能代表成本基础。
    const margin = num(costBasis.marginUsdt)
      ?? (entryNotional !== null && leverage !== null && leverage > 0 ? entryNotional / leverage : null);
    const roiPct = num(c.netRoiPct) ?? (pnl !== null && margin !== null && margin > 0 ? Number(((pnl / margin) * 100).toFixed(2)) : null);
    let holdMinutes = num(c.holdingMinutes);
    if (holdMinutes === null && entry?.createdAt && c.createdAt) {
      const ms = new Date(c.createdAt).getTime() - new Date(entry.createdAt).getTime();
      if (Number.isFinite(ms) && ms > 0) holdMinutes = Math.round(ms / 60000);
    }
    if (pnl === null) return null;
    return {
      symbol: c.symbol, direction: dirCanon(c.direction), grossPnl, pnl, win: pnl > 0,
      leverage, roiPct, holdMinutes, regime: c.regime || "未知",
      strategy: c.strategy || null, lossAttribution: c.lossAttribution || null,
      entryPrice: num(costBasis.entryPrice) ?? num(entry?.price), exitPrice: num(c.price),
      slippageBps: num(c.slippageBps),
      hasRationale: Boolean(c.entryRationale && c.entryRationale !== "未记录入场理由"),
      closedAt: c.createdAt
    };
  }).filter(Boolean);
}

export function computeBehaviorProfile(db) {
  const trades = buildClosedTrades(db);
  const n = trades.length;
  if (!n) return { trades: 0, note: "暂无已平仓交易——先建立交易闭环,行为画像会随成交累积。", computedAt: nowIso() };

  const wins = trades.filter((t) => t.win);
  const losses = trades.filter((t) => !t.win);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const levOf = (arr) => mean(arr.map((t) => t.leverage).filter((x) => x !== null));
  const holdOf = (arr) => mean(arr.map((t) => t.holdMinutes).filter((x) => x !== null));
  const avgLevWin = levOf(wins), avgLevLoss = levOf(losses);
  const avgHoldWin = holdOf(wins), avgHoldLoss = holdOf(losses);

  const groupBy = (key) => {
    const m = {};
    for (const t of trades) { const k = t[key] || "未知"; (m[k] ||= { n: 0, wins: 0, pnl: 0 }); m[k].n++; if (t.win) m[k].wins++; m[k].pnl += t.pnl; }
    return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { n: v.n, winRatePct: Math.round((v.wins / v.n) * 100), pnl: Number(v.pnl.toFixed(2)) }]));
  };
  const lossAttribution = {};
  for (const t of losses) { const k = t.lossAttribution || "未归因"; lossAttribution[k] = (lossAttribution[k] || 0) + 1; }

  // 致命习惯告警(证据驱动,确定性;需足够样本才判,避免小样本乱贴标签)
  const flags = [];
  if (wins.length >= 2 && losses.length >= 2) {
    if (avgLevWin !== null && avgLevLoss !== null && avgLevLoss > avgLevWin * 1.2)
      flags.push({ key: "gambler_leverage", severity: "bad", title: "越亏越加杠杆", detail: `亏损单均杠杆 ${avgLevLoss.toFixed(1)}× vs 盈利单 ${avgLevWin.toFixed(1)}×——重仓搏命倾向` });
    if (avgHoldWin !== null && avgHoldLoss !== null && avgHoldWin < avgHoldLoss * 0.7)
      flags.push({ key: "cant_hold_winners", severity: "bad", title: "拿不住盈利单", detail: `盈利单均持仓 ${fmtMin(avgHoldWin)} vs 亏损单 ${fmtMin(avgHoldLoss)}——赚就跑、亏死扛` });
  }

  return {
    trades: n,
    overall: {
      winRatePct: Math.round((wins.length / n) * 100),
      avgWin: wins.length ? Number((grossWin / wins.length).toFixed(2)) : null,
      avgLoss: losses.length ? Number((grossLoss / losses.length).toFixed(2)) : null,
      profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : (grossWin > 0 ? null : 0),
      expectancyUsdt: Number((trades.reduce((s, t) => s + t.pnl, 0) / n).toFixed(2)),
      avgHoldMinutes: holdOf(trades) !== null ? Math.round(holdOf(trades)) : null
    },
    leverage: { avgWin: avgLevWin, avgLoss: avgLevLoss },
    holdTime: { avgWinMinutes: avgHoldWin, avgLossMinutes: avgHoldLoss },
    byDirection: groupBy("direction"),
    byRegime: groupBy("regime"),
    lossAttribution,
    // 诊断图的悬浮信息和页面筛选全部使用同一笔真实平仓生命周期；
    // 只透传已由上方 join/聚合得到的事实，不在前端根据圆点位置反推交易属性。
    scatter: trades.map((t) => ({
      holdMinutes: t.holdMinutes, roiPct: t.roiPct, leverage: t.leverage, win: t.win,
      symbol: t.symbol, direction: t.direction, pnl: t.pnl, regime: t.regime,
      strategy: t.strategy, lossAttribution: t.lossAttribution, entryPrice: t.entryPrice,
      exitPrice: t.exitPrice, closedAt: t.closedAt
    })),
    flags,
    computedAt: nowIso()
  };
}

// LLM 叙述层(主模型 deepseek,不占 Gemini 配额):基于量化画像 + 近期成交(带入场理由/深度复盘)
// 生成"照镜子"式画像。只归纳给定事实、不编造;产出结构化 JSON 便于"喂回条令"。
export async function generateBehaviorNarrative(db, profile) {
  if (!profile || !profile.trades) return null;
  const { llmComplete } = await import("./agentChat.mjs");
  const recent = groupClosedTradeLifecycles(db.fills || [])
    .slice(0, 12)
    .map((item) => {
      const f = item.representative;
      return { symbol: f.symbol, dir: f.direction, grossPnl: item.realizedPnl, netPnl: item.netRealizedPnl, regime: f.regime, lossAttr: f.lossAttribution || null, rationale: String(f.entryRationale || "").slice(0, 160), deep: String(f.deepReflection || "").slice(0, 200) };
    });
  const sys = "你是严格的交易行为分析师 + 风控教练。只根据给定的量化画像与真实成交做归纳,绝不编造数字或习惯。输出必须具体、直指要害、可执行,禁止空话套话。样本少就在 blindSpots 里说明、不硬下结论。只输出 JSON。";
  const prompt = `给一个 AI 自主交易员做"照镜子"式行为画像。\n【量化画像】${JSON.stringify(profile)}\n【近期成交(含入场理由与深度复盘)】${JSON.stringify(recent)}\n输出纯 JSON:{"persona":"交易性格一句话(激进/赌徒/稳健/保守 + 依据)","fatalHabits":["致命习惯,每条带证据数字",最多3条],"blindSpots":"数据盲区/样本是否足够一句","disciplines":["下一步可执行纪律,具体到怎么做",正好3条]}。中文,纯 JSON。`;
  const raw = await llmComplete(prompt, sys);
  if (!raw) return null;
  try {
    return JSON.parse(String(raw).slice(String(raw).indexOf("{"), String(raw).lastIndexOf("}") + 1));
  } catch {
    return { persona: String(raw).slice(0, 400), fatalHabits: [], blindSpots: "", disciplines: [] };
  }
}

// 喂回闭环:把画像出的纪律固化为一条常驻"行为镜"透镜,注入决策提示词——让 AI 下次决策时看到自己的坏习惯。
// 手动触发(用户审后点),单条 upsert(替换旧的),避免 AI 自己反复给自己改条令跑偏。
export function adoptBehaviorDisciplines(db, disciplines, actor = "用户") {
  const clean = (disciplines || []).map((d) => String(d || "").trim()).filter(Boolean).slice(0, 5);
  if (!clean.length) return null;
  db.knowledge ||= {};
  db.knowledge.lenses ||= [];
  db.knowledge.lenses = db.knowledge.lenses.filter((l) => l.key !== "behavior_mirror");
  const lens = {
    id: id("lens"), key: "behavior_mirror", name: "行为镜 · 自我纪律",
    promptText: `【行为镜——基于你自己真实交易复盘得出的纪律,每次决策前必须自查】${clean.map((d, i) => `${i + 1}. ${d}`).join(" ")}`,
    active: true, provenance: "behavior_profile", createdAt: nowIso()
  };
  db.knowledge.lenses.unshift(lens);
  appendAudit(db, `采纳行为画像纪律为「行为镜」透镜(${clean.length} 条)`, lens.id, actor);
  return lens;
}
