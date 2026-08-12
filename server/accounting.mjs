import { currentEquityUsdt } from "./executionEngine.mjs";
import { activeMandate, appendAudit, appendTrace, id, nowIso } from "./store.mjs";
import { groupClosedTradeLifecycles } from "./tradeReviewQueue.mjs";

// ---------------------------------------------------------------------------
// 真实盈亏核算：从成交记录和持仓计算当日盈亏，动态维护日亏损预算。
// 预算耗尽时自动暂停自主推进并记录风险事件。
// ---------------------------------------------------------------------------

function todayStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function realizedPnlSince(db, sinceMs) {
  return (db.fills || [])
    .filter((fill) => fill.realizedPnl !== null && fill.realizedPnl !== undefined && new Date(fill.createdAt).getTime() >= sinceMs)
    .reduce((sum, fill) => sum + Number(fill.realizedPnl || 0), 0);
}

// 同一真实仓位可能有两条记录(execution_engine + exchange_rest 快照)。
// 核算按 symbol+direction 去重,优先交易所快照(权威 upl/张数)。
export function dedupePositions(positions = []) {
  const byKey = new Map();
  for (const p of positions) {
    const key = `${p.symbol}|${String(p.direction || "long").toLowerCase().replace("空", "short").replace("多", "long")}`;
    const prev = byKey.get(key);
    if (!prev || (p.source === "exchange_rest" && prev.source !== "exchange_rest")) byKey.set(key, p);
  }
  return [...byKey.values()];
}

function unrealizedPnl(db) {
  let total = 0;
  for (const position of dedupePositions(db.positions)) {
    const market = db.markets?.find((item) => item.symbol === position.symbol);
    const mark = Number(market?.price || position.mark);
    const entry = Number(position.entry);
    const size = Number(position.size);
    if (!Number.isFinite(mark) || !Number.isFinite(entry) || !Number.isFinite(size)) continue;
    // OKX SWAP 的 size 是"张数"，必须乘合约面值 ctVal 才是币数量；面值未知时不做本地重算，
    // 保留交易所快照给的权威 upl（此前无乘数硬算会把 BTC 浮盈放大 100 倍）。
    const multiplier = position.contractMultiplier != null ? Number(position.contractMultiplier) : (position.exchange === "OKX" ? null : 1);
    const sign = position.direction === "空" || position.direction === "short" ? -1 : 1;
    if (multiplier == null) { total += Number(position.pnl || 0); continue; }
    const pnl = (mark - entry) * size * multiplier * sign;
    position.mark = mark;
    position.pnl = Number(pnl.toFixed(2));
    total += pnl;
  }
  return total;
}

export function refreshAccounting(db) {
  const equity = currentEquityUsdt(db);
  const realizedToday = realizedPnlSince(db, todayStart());
  const unrealized = unrealizedPnl(db);
  const todayPnl = realizedToday + unrealized;

  db.portfolio ||= {};
  if (equity) db.portfolio.totalEquityUsdt = equity;
  db.portfolio.todayPnl = Number(todayPnl.toFixed(2));
  db.portfolio.todayPnlPct = equity ? Number(((todayPnl / equity) * 100).toFixed(2)) : null;
  db.portfolio.realizedPnlToday = Number(realizedToday.toFixed(2));
  db.portfolio.unrealizedPnl = Number(unrealized.toFixed(2));
  // 近 7 日盈亏（真实计算）：此前 weekPnl 是从不写入的死字段，导致 riskEngine 的"周亏损熔断"
  // 永远拿到 null → 实盘下每一笔计划都被这条死风控挡死。这里用 fills 真实计算补上。
  const weekEndMs = Date.now();
  const weekStartMs = weekEndMs - 7 * 24 * 60 * 60_000;
  const realizedWeek = realizedPnlSince(db, weekStartMs);
  const weekPnl = realizedWeek + unrealized;
  db.portfolio.weekPnl = Number(weekPnl.toFixed(2));
  db.portfolio.weekPnlPct = equity ? Number(((weekPnl / equity) * 100).toFixed(2)) : null;
  db.portfolio.weekWindowStartAt = new Date(weekStartMs).toISOString();
  db.portfolio.weekWindowEndAt = new Date(weekEndMs).toISOString();
  db.portfolio.weekWindowSemantics = "rolling_168_hours";
  db.portfolio.accountingUpdatedAt = nowIso();

  const mandate = activeMandate(db);
  if (mandate && equity) {
    const dailyLossCap = equity * (Number(mandate.maxDailyLossPct || 1) / 100);
    const lossSoFar = Math.max(0, -todayPnl);
    const remaining = Math.max(0, dailyLossCap - lossSoFar);
    db.system.remainingDailyLossUsdt = Number(remaining.toFixed(2));
    db.system.dailyLossCapUsdt = Number(dailyLossCap.toFixed(2));

    if (remaining <= 0 && db.system.autonomyEnabled) {
      db.system.autonomyEnabled = false;
      db.system.riskStatus = "风控暂停";
      db.system.latestAction = "日亏损预算耗尽，自动暂停自主交易";
      db.riskIncidents.unshift({
        id: id("incident"),
        severity: "critical",
        status: "open",
        title: `日亏损预算耗尽（上限 ${dailyLossCap.toFixed(2)} USDT），已自动暂停自主交易`,
        source: "accounting",
        createdAt: nowIso()
      });
      appendAudit(db, "日亏损预算耗尽，自动暂停自主交易", "accounting", "Accounting", "critical");
      appendTrace(db, "risk_check", "日亏损预算耗尽", "blocked");
    }
  } else if (!mandate) {
    db.system.remainingDailyLossUsdt = null;
    db.system.dailyLossCapUsdt = null;
  }

  return {
    equity,
    todayPnl: db.portfolio.todayPnl,
    realizedToday: db.portfolio.realizedPnlToday,
    unrealized: db.portfolio.unrealizedPnl,
    remainingDailyLossUsdt: db.system.remainingDailyLossUsdt
  };
}

// ---------------------------------------------------------------------------
// 绩效统计：按平仓成交聚合。
// ---------------------------------------------------------------------------
export function performanceReport(db) {
  // 部分平仓属于同一个仓位生命周期，绩效笔数/胜率/回撤必须先聚合，不能把三次减仓算成三笔交易。
  const lifecycles = groupClosedTradeLifecycles(db.fills || []);
  const closes = lifecycles.map((item) => item.representative);
  const wins = closes.filter((fill) => Number(fill.realizedPnl) > 0);
  const losses = closes.filter((fill) => Number(fill.realizedPnl) < 0);
  const totalPnl = closes.reduce((sum, fill) => sum + Number(fill.realizedPnl), 0);
  const grossWin = wins.reduce((sum, fill) => sum + Number(fill.realizedPnl), 0);
  const grossLoss = Math.abs(losses.reduce((sum, fill) => sum + Number(fill.realizedPnl), 0));

  const daily = new Map();
  for (const fill of closes) {
    const day = String(fill.createdAt).slice(0, 10);
    daily.set(day, (daily.get(day) || 0) + Number(fill.realizedPnl));
  }
  const dailySeries = [...daily.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, pnl]) => ({ date, pnl: Number(pnl.toFixed(2)) }));

  // 已实现交易曲线的峰谷回撤：USDT 口径是精确值；百分比明确以“当前账户权益”为分母，
  // 不冒充缺少完整充值/提现现金流时无法重建的全历史账户权益回撤。
  let cumulative = 0;
  let peak = 0;
  let maxDrawdownUsdt = 0;
  for (const fill of closes.slice().sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))) {
    cumulative += Number(fill.realizedPnl);
    peak = Math.max(peak, cumulative);
    maxDrawdownUsdt = Math.max(maxDrawdownUsdt, peak - cumulative);
  }
  const currentEquity = Number(db.portfolio?.totalEquityUsdt);
  const maxDrawdownPctOfCurrentEquity = Number.isFinite(currentEquity) && currentEquity > 0
    ? Number(((maxDrawdownUsdt / currentEquity) * 100).toFixed(2))
    : null;

  return {
    trades: closes.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: closes.length ? Number(((wins.length / closes.length) * 100).toFixed(1)) : null,
    totalPnlUsdt: Number(totalPnl.toFixed(2)),
    avgPnlUsdt: closes.length ? Number((totalPnl / closes.length).toFixed(2)) : null,
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : null,
    bestTrade: closes.length ? Math.max(...closes.map((fill) => Number(fill.realizedPnl))) : null,
    worstTrade: closes.length ? Math.min(...closes.map((fill) => Number(fill.realizedPnl))) : null,
    realizedMaxDrawdownUsdt: Number(maxDrawdownUsdt.toFixed(2)),
    realizedMaxDrawdownPctOfCurrentEquity: maxDrawdownPctOfCurrentEquity,
    maxDrawdownBasis: "closed_trade_pnl_curve/current_equity",
    partialCloseFills: lifecycles.reduce((sum, item) => sum + Math.max(0, item.fills.length - 1), 0),
    dailySeries,
    // 与执行引擎的权威在途集合一致（此前漏 entry_partial/submitted，会少计部分成交的在途单）。
    openExecutions: (db.executionOrders || []).filter((item) => ["submitted", "entry_pending", "entry_partial", "entry_filled", "protecting"].includes(item.status)).length,
    generatedAt: nowIso()
  };
}
