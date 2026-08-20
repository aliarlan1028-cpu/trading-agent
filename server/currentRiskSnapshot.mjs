import { activeMandate } from "./store.mjs";
import { currentRiskThresholds } from "./riskThresholds.mjs";
import { evaluateProtections } from "./tradeProtections.mjs";
import { assessOperationalDegradation } from "./professionalRiskGate.mjs";

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

export function buildCurrentRiskSnapshot(db, now = Date.now(), options = {}) {
  const mandate = activeMandate(db) || {};
  const thresholds = currentRiskThresholds();
  const protections = evaluateProtections(db);
  const windowEndAt = new Date(now).toISOString();
  const windowStartAt = new Date(now - 7 * 24 * 60 * 60_000).toISOString();
  const weekPnl = finite(db.portfolio?.weekPnl) ? Number(db.portfolio.weekPnl) : null;
  const equity = finite(db.portfolio?.totalEquityUsdt) ? Number(db.portfolio.totalEquityUsdt) : null;
  // weekPnl 含当前浮动盈亏；亏损率分母若直接用当前权益，会在亏损后缩小并轻微放大百分比。
  // 使用窗口起点近似权益（当前权益 - 窗口盈亏），与“这168小时损失了起始资金的多少”一致。
  const rollingStartEquity = equity !== null && weekPnl !== null ? equity - weekPnl : null;
  const weeklyLossPct = rollingStartEquity > 0 && weekPnl !== null ? Number(Math.max(0, (-weekPnl / rollingStartEquity) * 100).toFixed(2)) : null;
  const maxWeeklyLossPct = finite(mandate.maxWeeklyLossPct ?? mandate.max_weekly_loss_pct)
    ? Number(mandate.maxWeeklyLossPct ?? mandate.max_weekly_loss_pct)
    : null;
  const degradation = assessOperationalDegradation(db, { auditStatus: options.auditStatus });
  return {
    schema: "trading.current-risk-snapshot", schemaVersion: 1, asOf: new Date(now).toISOString(),
    accountingAsOf: db.portfolio?.accountingUpdatedAt || null,
    mandate: { id: mandate.id || null, version: mandate.version ?? null, updatedAt: mandate.updatedAt || mandate.createdAt || null },
    rollingSevenDay: {
      semantics: "rolling_168_hours", windowStartAt, windowEndAt, pnlUsdt: weekPnl, startEquityUsdt: rollingStartEquity,
      lossPct: weeklyLossPct, limitPct: maxWeeklyLossPct,
      active: weeklyLossPct !== null && maxWeeklyLossPct !== null && weeklyLossPct >= maxWeeklyLossPct
    },
    consecutiveLosses: {
      count: protections.cooldown?.streak ?? 0, limit: protections.cooldown?.maxLosses ?? thresholds.protectMaxConsecLosses,
      active: protections.cooldown?.active === true, until: protections.cooldown?.until || null
    },
    drawdownProtection: {
      pct: protections.drawdown?.drawdownPct ?? null, limitPct: protections.drawdown?.maxDrawdownPct ?? thresholds.protectMaxDrawdownPct,
      active: protections.drawdown?.active === true, until: protections.drawdown?.until || null
    },
    controls: {
      killSwitch: db.system?.killSwitch === true, reduceOnly: db.system?.reduceOnlyMode === true,
      reduceOnlyBy: db.system?.reduceOnlyBy || null, riskStatus: db.system?.riskStatus || null
    },
    operationalDegradation: {
      degraded: degradation.degraded === true,
      mode: degradation.mode || (degradation.degraded ? "reduce_only" : "normal"),
      reasons: Array.isArray(degradation.reasons) ? degradation.reasons : [], assessedAt: degradation.assessedAt || null
    },
    thresholds
  };
}

export function currentRiskSnapshotForPrompt(snapshot) {
  const rolling = snapshot.rollingSevenDay, losses = snapshot.consecutiveLosses;
  const drawdown = snapshot.drawdownProtection, degradation = snapshot.operationalDegradation;
  return [
    `快照时间 ${snapshot.asOf}；交易权限 v${snapshot.mandate.version ?? "未设置"}`,
    `严格滚动168小时 ${rolling.windowStartAt} → ${rolling.windowEndAt}：盈亏 ${rolling.pnlUsdt ?? "未同步"} USDT，亏损率 ${rolling.lossPct ?? "未同步"}%，上限 ${rolling.limitPct ?? "未设置"}%`,
    `连续亏损 ${losses.count}/${losses.limit}，${losses.active ? `冷却中至 ${losses.until}` : "未触发"}`,
    `近期成交回撤 ${drawdown.pct ?? "样本不足"}% / 上限 ${drawdown.limitPct}%，${drawdown.active ? `锁仓至 ${drawdown.until}` : "未触发"}`,
    `紧急停止 ${snapshot.controls.killSwitch ? "开启" : "关闭"}；暂停新开仓 ${snapshot.controls.reduceOnly ? "是" : "否"}`,
    `运行降级 ${degradation.degraded ? `开启（${degradation.reasons.join("、") || "原因未知"}）` : "无"}`
  ].join("\n");
}

const HISTORICAL = /^\s*(?:[-*>#\d.]+\s*)?(?:历史|曾经|当时|复盘|假设|如果|若|计划|目标|预测|预计|可能)/i;
const DYNAMIC_RISK = /(近\s*7\s*日|周亏|连续亏损|连亏|回撤锁仓|只减仓|暂停新开仓|运行降级|WS\s*断|对账异常|审计异常)/i;

export function enforceCurrentRiskFacts(db, content = "") {
  const snapshot = buildCurrentRiskSnapshot(db), violations = [], kept = [];
  for (const line of String(content || "").split("\n")) {
    if (!DYNAMIC_RISK.test(line) || HISTORICAL.test(line)) { kept.push(line); continue; }
    let stale = false;
    const weekly = line.match(/(?:近\s*7\s*日|周)(?:亏损)?[^\d]{0,12}(\d+(?:\.\d+)?)\s*%/i);
    if (weekly && snapshot.rollingSevenDay.lossPct !== null && Math.abs(Number(weekly[1]) - snapshot.rollingSevenDay.lossPct) > 0.05) stale = true;
    const weeklyLimit = weekly ? line.match(/(?:上限|超)[^\d]{0,4}(\d+(?:\.\d+)?)\s*%/i) : null;
    if (weeklyLimit && snapshot.rollingSevenDay.limitPct !== null && Math.abs(Number(weeklyLimit[1]) - snapshot.rollingSevenDay.limitPct) > 0.01) stale = true;
    const streak = line.match(/(?:连续亏损|连亏)[^\d]{0,8}(\d+)\s*笔/i);
    if (streak && Number(streak[1]) !== snapshot.consecutiveLosses.count) stale = true;
    const streakLimit = streak ? line.match(/(?:上限|超过|超)[^\d]{0,5}(\d+)\s*笔/i) : null;
    if (streakLimit && Number(streakLimit[1]) !== snapshot.consecutiveLosses.limit) stale = true;
    if (/(?:处于|进入|当前|已经|已).{0,8}(?:只减仓|暂停新开仓)/i.test(line) && !snapshot.controls.reduceOnly) stale = true;
    if (/(WS\s*断|对账异常|审计异常|运行降级)/i.test(line) && !snapshot.operationalDegradation.degraded) stale = true;
    if (stale) { violations.push(line.slice(0, 260)); continue; }
    kept.push(line);
  }
  if (!violations.length) return { text: String(content || ""), corrected: false, violations: [], snapshot };
  kept.push("", "**当前风险事实（系统更正）**", currentRiskSnapshotForPrompt(snapshot));
  return { text: kept.join("\n").trim(), corrected: true, violations, snapshot };
}
