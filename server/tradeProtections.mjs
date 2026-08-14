// freqtrade 式交易保护:连亏冷却 + 回撤锁仓。
// 都从完整平仓生命周期的净结果（开/平仓费 + 资金费）【无状态】计算,自动到期解除——
// 不引入需持久化的锁状态,避免运行时抢写/漂移。只拦"新开仓",不影响平仓/减仓。
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";
import { groupClosedTradeLifecycles } from "./tradeReviewQueue.mjs";
import { reconcileRiskIncidentLifecycle } from "./riskIncidentLifecycle.mjs";

const HOUR_MS = 3600000;
const envNum = (key, def) => { const n = Number(process.env[key]); return Number.isFinite(n) ? n : def; };

// 已平仓成交按时间正序 → { pnl, at }
function closedTrades(db) {
  // 部分平仓属于同一交易生命周期，必须合并后再计算连亏和回撤，避免一次分批退出被算成多笔亏损。
  // 极旧数据可能没有任何订单/计划/fill id；给它仅在本次计算内使用的稳定索引，不能静默漏算。
  const normalized = (db.fills || []).map((fill, index) => (
    fill?.executionOrderId || fill?.tradePlanId || fill?.planId || fill?.positionId || fill?.id
      ? fill
      : { ...fill, id: `legacy_unkeyed_close_${index}` }
  ));
  return groupClosedTradeLifecycles(normalized)
    .map((lifecycle) => ({ pnl: Number(lifecycle.netRealizedPnl), at: new Date(lifecycle.lastClosedAt || 0).getTime() }))
    .filter((t) => Number.isFinite(t.at) && t.at > 0)
    .sort((a, b) => a.at - b.at);
}

// 连亏冷却:尾部连续亏损 ≥ N 笔,且距最后一笔亏损 < 冷却时长 → 锁新开仓(到期自动解除)。
export function consecutiveLossCooldown(db) {
  const maxLosses = Math.max(1, envNum("PROTECT_MAX_CONSEC_LOSSES", 3));
  const cooldownMs = Math.max(0, envNum("PROTECT_COOLDOWN_HOURS", 4)) * HOUR_MS;
  const trades = closedTrades(db);
  let streak = 0;
  let lastLossAt = 0;
  for (let i = trades.length - 1; i >= 0; i -= 1) {
    if (trades[i].pnl < 0) { streak += 1; if (!lastLossAt) lastLossAt = trades[i].at; }
    else break; // 一笔盈利即打断连亏
  }
  const active = streak >= maxLosses && lastLossAt > 0 && (Date.now() - lastLossAt) < cooldownMs;
  return { active, streak, maxLosses, until: active ? new Date(lastLossAt + cooldownMs).toISOString() : null, cooldownHours: cooldownMs / HOUR_MS };
}

// 回撤锁仓:近 lookback 笔实现盈亏曲线从峰值的当前回撤 ≥ 权益的 X% → 锁新开仓,
// 锁定窗口从最后一笔平仓时刻起算(到期自动解除)。等价 freqtrade MaxDrawdown(基于成交盈亏)。
export function drawdownLockout(db) {
  const maxDdPct = Math.max(0, envNum("PROTECT_MAX_DRAWDOWN_PCT", 10));
  const lockMs = Math.max(0, envNum("PROTECT_DRAWDOWN_LOCK_HOURS", 12)) * HOUR_MS;
  const lookback = Math.max(3, envNum("PROTECT_DRAWDOWN_LOOKBACK", 20));
  const equity = Number(db.portfolio?.totalEquityUsdt);
  const trades = closedTrades(db).slice(-lookback);
  if (!Number.isFinite(equity) || equity <= 0 || trades.length < 3) {
    return { active: false, drawdownPct: null, maxDrawdownPct: maxDdPct };
  }
  let cum = 0;
  let peak = 0;
  for (const t of trades) { cum += t.pnl; if (cum > peak) peak = cum; }
  const currentDdUsdt = Math.max(0, peak - cum);          // 当前相对峰值的回撤(USDT)
  const ddPct = (currentDdUsdt / equity) * 100;           // 占权益百分比
  const lastCloseAt = trades[trades.length - 1].at;
  const active = ddPct >= maxDdPct && (Date.now() - lastCloseAt) < lockMs;
  return { active, drawdownPct: Number(ddPct.toFixed(2)), maxDrawdownPct: maxDdPct, drawdownUsdt: Number(currentDdUsdt.toFixed(2)), until: active ? new Date(lastCloseAt + lockMs).toISOString() : null, lockHours: lockMs / HOUR_MS };
}

// 综合评估(默认开启;db.system.protectionsEnabled===false 可关)。
export function evaluateProtections(db) {
  const enabled = db.system?.protectionsEnabled !== false;
  if (!enabled) return { enabled: false, blocked: false, cooldown: { active: false }, drawdown: { active: false } };
  const cooldown = consecutiveLossCooldown(db);
  const drawdown = drawdownLockout(db);
  return { enabled: true, blocked: cooldown.active || drawdown.active, cooldown, drawdown, assessedAt: nowIso() };
}

// 持久化最新评估到 db.system.tradeProtections(供状态展示),并在【新触发】时抬一次风险事件。
export function applyProtections(db, actor = "TradeProtections") {
  const prot = evaluateProtections(db);
  db.system ||= {};
  const prev = db.system.tradeProtections || {};
  db.system.tradeProtections = prot;
  if (!prot.enabled) return prot;
  const raise = (key, title) => {
    const openExists = (db.riskIncidents || []).some((i) => i.status === "open" && i.protectionKey === key);
    if (openExists) return;
    db.riskIncidents ||= [];
    db.riskIncidents.unshift({ id: id("incident"), severity: "high", status: "open", title, protectionKey: key, source: "trade_protections", createdAt: nowIso() });
    appendAudit(db, title, "trade_protections", actor, "warning");
    appendTrace(db, "trade_protections", title, "blocked");
  };
  if (prot.cooldown.active && !prev?.cooldown?.active) {
    raise("cooldown", `连亏冷却触发:连续 ${prot.cooldown.streak} 笔亏损,暂停新开仓至 ${prot.cooldown.until}`);
  }
  if (prot.drawdown.active && !prev?.drawdown?.active) {
    raise("drawdown", `回撤锁仓触发:回撤 ${prot.drawdown.drawdownPct}% ≥ ${prot.drawdown.maxDrawdownPct}%,暂停新开仓至 ${prot.drawdown.until}`);
  }
  reconcileRiskIncidentLifecycle(db, { protections: prot });
  return prot;
}
