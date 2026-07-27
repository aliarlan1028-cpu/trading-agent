// 执行前 SRTL 结构化审核（借鉴 okx-ai-trading-journal 的 SRTL V1.0 审核清单 + "盈利目标反推波动"）。
// 定位：在 propose_trade_plan 产出计划、硬风控通过之后，真实下单之前，加一道 LLM 结构化审核——
// 喂真实 4H+1H K 线，按 SMC 清单逐项 PASS/FAIL，不满足即拒绝。这是"质量闸"，与"风控闸"互补：
// 风控管"能不能亏得起"，SRTL 管"这笔 setup 结构上够不够格"。
import { getHistoricalKlines } from "./exchangeConnector.mjs";
import { llmComplete, activeProvider } from "./agentChat.mjs";
import { appendAudit, appendTrace, nowIso } from "./store.mjs";

// 借鉴"提线木偶"：从授权单笔风险% + 计划的止损距离，反推这笔交易的真实盈亏比与所需波动，
// 作为 SRTL 的一条硬门槛（R 不达标直接不用喂 LLM，省 token 也更诚实）。
// 入场价归一:执行引擎传数字,但 Agent 原始计划里 entry 是对象({type,range,riskPercent})、
// 区间在 entry_range/entryLow+entryHigh——Number(对象) 是 NaN,曾导致 2R 硬门槛被静默跳过(外审 P0)。
function resolveEntryPrice(plan) {
  const direct = Number(plan.entry);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const lo = Number(plan.entryLow ?? plan.entry_range?.[0]);
  const hi = Number(plan.entryHigh ?? plan.entry_range?.[plan.entry_range?.length - 1]);
  if (Number.isFinite(lo) && Number.isFinite(hi) && lo > 0) return (lo + hi) / 2;
  const price = Number(plan.price);
  return Number.isFinite(price) && price > 0 ? price : NaN;
}

function computeRewardRisk(plan) {
  const entry = resolveEntryPrice(plan);
  const stop = Number(plan.stopLoss ?? plan.stop_loss);
  const rawTps = plan.takeProfit ?? plan.take_profit;
  const tps = (Array.isArray(rawTps) ? rawTps : [rawTps]).map(Number).filter(Number.isFinite);
  const tp = tps.length ? (plan.direction === "short" ? Math.max(...tps) : Math.min(...tps)) : null; // 取最近的止盈算保守 R
  if (!Number.isFinite(entry) || !Number.isFinite(stop) || tp == null || entry <= 0) return { r: null, riskPct: null, rewardPct: null };
  const riskDist = Math.abs(entry - stop);
  const rewardDist = Math.abs(tp - entry);
  if (riskDist <= 0) return { r: null, riskPct: null, rewardPct: null };
  return {
    r: Number((rewardDist / riskDist).toFixed(2)),
    riskPct: Number((riskDist / entry * 100).toFixed(3)),
    rewardPct: Number((rewardDist / entry * 100).toFixed(3))
  };
}

const SYSTEM = "你是顶级加密永续合约技术分析审核系统，严格执行 SRTL V1.0：顺大周期结构(4H BOS 定方向)，只在价格回到导致该 BOS 的高质量供需区、且触发周期(1H)出现流动性扫荡+结构转换(CHoCH)确认时才放行。震荡市不交易。只输出 JSON，逐项给 checklist 与 PASS/FAIL，宁可错杀不可放过。";

export async function reviewTradeSetup(db, plan, options = {}) {
  const minR = Number(options.minR ?? process.env.SRTL_MIN_R ?? 2.0);
  const rr = computeRewardRisk(plan);
  // 算不出盈亏比(缺入场/止损/止盈) → 实盘 fail-closed:此前 r=null 会静默跳过 2R 门槛(外审 P0)。
  if (rr.r == null && db.system?.liveTradingEnabled) {
    const verdict = { verdict: "FAIL", reason: "无法计算盈亏比（入场/止损/止盈缺失或非法），实盘拒绝执行", rewardRisk: rr, checklist: [{ item: "盈亏比达标", passed: false, reason: "盈亏比不可计算" }] };
    appendAudit(db, "SRTL 审核拒绝（盈亏比不可计算）", plan.id, "SetupReview", "warning");
    return verdict;
  }
  // 盈亏比硬门槛（木偶式反推）：R 不达标直接判 FAIL，不浪费 LLM 调用。
  if (rr.r != null && rr.r < minR) {
    const verdict = { verdict: "FAIL", reason: `盈亏比 ${rr.r}R < 门槛 ${minR}R（止损距离 ${rr.riskPct}% / 止盈距离 ${rr.rewardPct}%）`, rewardRisk: rr, checklist: [{ item: "盈亏比达标", passed: false, reason: `${rr.r}R < ${minR}R` }] };
    appendAudit(db, `SRTL 审核拒绝（盈亏比不足 ${rr.r}R）`, plan.id, "SetupReview", "warning");
    return verdict;
  }
  // 无 LLM 时不做假审核：放行但标注"未做结构审核"，让审计如实记录。
  if (!activeProvider()) {
    return { verdict: "SKIP", reason: "未配置 LLM，跳过结构审核（仅盈亏比已校验）", rewardRisk: rr, checklist: [] };
  }

  const symbol = plan.symbol || "BTC/USDT";
  let h4 = [], h1 = [];
  try {
    [h4, h1] = await Promise.all([
      getHistoricalKlines(symbol, "4h", 40),
      getHistoricalKlines(symbol, "1h", 50)
    ]);
  } catch { /* 拉不到 K 线则下方判空 */ }
  if (!h4?.length || !h1?.length) {
    appendAudit(db, "SRTL 审核跳过：无法获取 K 线", plan.id, "SetupReview", "warning");
    return { verdict: "SKIP", reason: "无法获取真实 K 线，跳过结构审核", rewardRisk: rr, checklist: [] };
  }
  const fmt = (rows) => rows.slice(-15).map((c) => ({ t: new Date(c.time).toISOString().slice(5, 16), o: c.open, h: c.high, l: c.low, c: c.close }));

  const prompt = `资产：${symbol}（永续）\n计划方向：${plan.direction}\n入场：${plan.entry ?? `${plan.entryLow}-${plan.entryHigh}`}｜止损：${plan.stopLoss ?? plan.stop_loss}｜止盈：${JSON.stringify(plan.takeProfit)}\n已算盈亏比：${rr.r}R（止损${rr.riskPct}%/止盈${rr.rewardPct}%）\n\n=== 近 15 根 4H（最新在后）===\n${JSON.stringify(fmt(h4))}\n=== 近 15 根 1H（用于找流动性扫荡与 CHoCH）===\n${JSON.stringify(fmt(h1))}\n\n按 SRTL 逐项审核，只返回纯 JSON：\n{"direction":"LONG|SHORT|NEUTRAL","zoneCheck":true,"triggerLevel":"S|A|NONE","verdict":"PASS|FAIL","reason":"一句话结论","marketContext":"结构与流动性简述","checklist":[{"item":"顺应4H方向(BOS)","passed":true,"reason":""},{"item":"回到有效供需区","passed":true,"reason":""},{"item":"1H流动性扫荡","passed":true,"reason":""},{"item":"CHoCH结构转换确认","passed":true,"reason":""},{"item":"盈亏比达标","passed":true,"reason":"${rr.r}R"}]}\n规则：计划方向必须与 4H BOS 一致；必须已回到供需区；1H 必须有 S 级(扫荡+收回+CHoCH)或 A 级(强反应+CHoCH)触发，否则 verdict=FAIL。`;

  let parsed = null;
  try {
    const raw = await llmComplete(prompt, SYSTEM);
    parsed = JSON.parse(String(raw || "").slice(String(raw).indexOf("{"), String(raw).lastIndexOf("}") + 1));
  } catch {
    appendAudit(db, "SRTL 审核 LLM 解析失败，保守放行但标注", plan.id, "SetupReview", "warning");
    return { verdict: "SKIP", reason: "结构审核模型异常，未拦截（请人工留意）", rewardRisk: rr, checklist: [] };
  }
  const verdict = parsed.verdict === "PASS" ? "PASS" : "FAIL";
  const result = { ...parsed, verdict, rewardRisk: rr };
  appendTrace(db, "setup_review", `SRTL ${symbol} ${verdict}`, verdict === "PASS" ? "ok" : "warning", 0);
  appendAudit(db, `SRTL 结构审核：${verdict}（${parsed.reason || ""}）`, plan.id, "SetupReview", verdict === "PASS" ? "info" : "warning");
  return result;
}
