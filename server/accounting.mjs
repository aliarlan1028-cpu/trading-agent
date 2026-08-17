import { currentEquityUsdt } from "./executionEngine.mjs";
import { activeMandate, appendAudit, appendTrace, id, nowIso } from "./store.mjs";
import { groupClosedTradeLifecycles } from "./tradeReviewQueue.mjs";
import { OPEN_EXECUTION_STATES } from "./executionStates.mjs";
import { syncReduceOnlyState } from "./reduceOnlyState.mjs";
import { businessDateKey, businessDayStartMs, DEFAULT_BUSINESS_TIME_ZONE } from "./businessTime.mjs";
import { recordedFeeCost } from "./financialValues.mjs";
import { groupPositionMirrors, newestAuthoritativePosition, positionFactObservedMs, positionMirrorKey } from "./positionView.mjs";
import { marketFactFreshness } from "./marketFreshness.mjs";
import { okxEnvironmentConfig } from "./okxEnvironment.mjs";
import { validateOkxCredentialBinding } from "./exchangeConnector.mjs";
import { backfillOkxRollingAccountingBaseline, rollingAccountingBoundary } from "./accountingHistory.mjs";

// ---------------------------------------------------------------------------
// 真实盈亏核算：从成交记录和持仓计算当日盈亏，动态维护日亏损预算。
// 预算耗尽时自动暂停自主推进并记录风险事件。
// ---------------------------------------------------------------------------

export function todayStart(at = Date.now(), timeZone = DEFAULT_BUSINESS_TIME_ZONE) {
  return businessDayStartMs(at, timeZone);
}

export function realizedPnlSince(db, sinceMs, untilMs = Date.now()) {
  let knownTotal = 0;
  let knownFacts = 0;
  let pending = 0;
  let total = 0;
  for (const fill of db.fills || []) {
    if (!['entry', 'close'].includes(fill?.kind)) continue;
    const at = new Date(fill.exchangeFilledAt || fill.createdAt || fill.closedAt || 0).getTime();
    if (!Number.isFinite(at) || at < sinceMs || at > untilMs) continue;
    total += 1;
    const fee = recordedFeeCost(fill);
    const feeKnown = fee !== null && fill.estimatedFee !== true;
    if (fill.kind === 'entry') {
      if (feeKnown) { knownTotal -= fee; knownFacts += 1; }
      else pending += 1;
      continue;
    }
    const grossKnown = fill.realizedPnl !== null && fill.realizedPnl !== undefined && fill.realizedPnl !== '' && Number.isFinite(Number(fill.realizedPnl));
    if (grossKnown) { knownTotal += Number(fill.realizedPnl); knownFacts += 1; }
    else pending += 1;
    if (feeKnown) { knownTotal -= fee; knownFacts += 1; }
    else pending += 1;
    if (fill.fundingReconciled === true && fill.fundingFeeUsdt !== null && fill.fundingFeeUsdt !== undefined && fill.fundingFeeUsdt !== '' && Number.isFinite(Number(fill.fundingFeeUsdt))) {
      knownTotal += Number(fill.fundingFeeUsdt);
      knownFacts += 1;
    } else {
      pending += 1;
    }
  }
  return { value: knownTotal, knownTotal, reconciled: knownFacts, pending, total };
}

// 同一真实仓位可能有两条记录(execution_engine + exchange_rest 快照)。
// 核算按 symbol+direction 去重,优先交易所快照(权威 upl/张数)。
export function dedupePositions(positions = []) {
  const selected = [];
  for (const rows of groupPositionMirrors(positions).values()) {
    const exchangeRows = rows.filter((row) => ["exchange_rest", "exchange_ws"].includes(row.source));
    const candidates = exchangeRows.length ? exchangeRows : rows;
    selected.push(candidates.slice().sort((a, b) => positionFactObservedMs(b) - positionFactObservedMs(a))[0]);
  }
  return selected;
}

export function unrealizedPnl(db, options = {}) {
  let knownTotal = 0;
  const pendingPositions = [];
  const now = Number(options.now ?? Date.now());
  for (const [identity, rows] of groupPositionMirrors(db.positions).entries()) {
    const authority = newestAuthoritativePosition(rows, { now, maxAgeMs: options.maxAgeMs });
    const engine = rows.filter((row) => row.source === "execution_engine")
      .sort((a, b) => positionFactObservedMs(b) - positionFactObservedMs(a))[0] || null;
    const position = authority.row || engine || rows[0];
    const rawSize = position.coinSize ?? position.quantity ?? position.size;
    const hasOpenSize = rawSize !== null && rawSize !== undefined && rawSize !== '' && Number.isFinite(Number(rawSize)) && Math.abs(Number(rawSize)) > 0;
    if (!hasOpenSize) continue;
    if (authority.row && !authority.fresh) {
      pendingPositions.push({ identity, reason: authority.reason, positionId: position.id || null });
      continue;
    }
    const authoritativePnl = position.pnl ?? position.unrealizedPnl;
    if (authoritativePnl !== null && authoritativePnl !== undefined && authoritativePnl !== '' && Number.isFinite(Number(authoritativePnl))) {
      knownTotal += Number(authoritativePnl);
      continue;
    }
    const market = db.markets?.find((item) => item.symbol === position.symbol);
    const marketFacts = marketFactFreshness(market || {}, { now });
    const markValue = market?.price ?? position.mark;
    const mark = markValue !== null && markValue !== undefined && markValue !== '' ? Number(markValue) : null;
    const entry = position.entry !== null && position.entry !== undefined && position.entry !== '' ? Number(position.entry) : null;
    // OKX SWAP 的 size 是"张数"，必须乘合约面值 ctVal 才是币数量；面值未知时不做本地重算，
    // 保留交易所快照给的权威 upl（此前无乘数硬算会把 BTC 浮盈放大 100 倍）。
    const coinSize = position.coinSize !== null && position.coinSize !== undefined && position.coinSize !== '' && Number.isFinite(Number(position.coinSize))
      ? Math.abs(Number(position.coinSize))
      : position.source === 'execution_engine' && Number.isFinite(Number(position.quantity ?? position.size)) ? Math.abs(Number(position.quantity ?? position.size)) : null;
    const sign = position.direction === "空" || position.direction === "short" ? -1 : 1;
    if (!marketFacts.ticker.ok || !(Number.isFinite(mark) && mark > 0 && Number.isFinite(entry) && entry > 0 && coinSize !== null)) {
      pendingPositions.push({ identity: positionMirrorKey(position) || identity, reason: !marketFacts.ticker.ok ? `ticker_${marketFacts.ticker.reason}` : "position_pnl_inputs_incomplete", positionId: position.id || null });
      continue;
    }
    const pnl = (mark - entry) * coinSize * sign;
    position.mark = mark;
    position.pnl = Number(pnl.toFixed(2));
    knownTotal += pnl;
  }
  return { knownTotal, pendingPositions, complete: pendingPositions.length === 0 };
}

function strictNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function snapshotEquity(snapshot) {
  return strictNumber(snapshot?.totalEquityUsdt ?? snapshot?.balances?.[0]?.totalEq);
}

function snapshotUnrealized(snapshot) {
  const compactValue = strictNumber(snapshot?.unrealizedPnlUsdt);
  if (compactValue !== null) return { complete: true, value: compactValue, reason: null };
  let total = 0;
  for (const position of snapshot?.positions || []) {
    const size = strictNumber(position.coinSize ?? position.pos ?? position.size ?? position.quantity);
    if (size === null || Math.abs(size) === 0) continue;
    const pnl = strictNumber(position.pnl ?? position.upl ?? position.unrealizedPnl);
    if (pnl === null) return { complete: false, value: null, reason: "baseline_position_upl_missing" };
    total += pnl;
  }
  return { complete: true, value: total, reason: null };
}

const ACCOUNTING_ANCHOR_BUCKET_MS = 5 * 60_000;
// 14 天缓冲覆盖滚动 7 日风控窗口、短期停机和部署恢复；5 分钟一条约 4032 条。
const ACCOUNTING_ANCHOR_MAX = 4500;

function accountingAnchorFromSnapshot(snapshot) {
  const equity = snapshotEquity(snapshot);
  const upl = snapshotUnrealized(snapshot);
  const observedMs = new Date(snapshot?.createdAt || 0).getTime();
  if (snapshot?.status !== "ok" || !(equity > 0) || !upl.complete || !Number.isFinite(observedMs)) return null;
  return {
    id: `accounting_anchor_${snapshot.accountId || "okx"}_${snapshot.apiKeyFingerprint || "missing"}_${snapshot.environment || "missing"}_${Math.floor(observedMs / ACCOUNTING_ANCHOR_BUCKET_MS)}`,
    status: "ok",
    exchange: snapshot.exchange || "OKX",
    accountId: snapshot.accountId || null,
    apiKeyFingerprint: snapshot.apiKeyFingerprint || null,
    environment: snapshot.environment || null,
    sourceSnapshotId: snapshot.id || null,
    createdAt: new Date(observedMs).toISOString(),
    totalEquityUsdt: equity,
    unrealizedPnlUsdt: upl.value
  };
}

export function retainAccountingAnchors(db) {
  db.accountingAnchors ||= [];
  const existing = new Set(db.accountingAnchors.map((anchor) => anchor.id));
  // Seed all still-retained full snapshots on first migration, then add only one
  // compact immutable observation per five-minute bucket.
  const snapshots = (db.accountSnapshots || []).slice().sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  for (const snapshot of snapshots) {
    const anchor = accountingAnchorFromSnapshot(snapshot);
    if (!anchor || existing.has(anchor.id)) continue;
    db.accountingAnchors.push(anchor);
    existing.add(anchor.id);
  }
  db.accountingAnchors = db.accountingAnchors
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, ACCOUNTING_ANCHOR_MAX);
  return db.accountingAnchors;
}

function sameAccountingBinding(row, binding) {
  return Boolean(row && binding
    && row.accountId === binding.accountId
    && row.apiKeyFingerprint === binding.apiKeyFingerprint
    && row.environment === binding.environment);
}

function resolveCurrentAccountingBinding(db) {
  const currentSnapshot = (db.accountSnapshots || [])
    .filter((snapshot) => snapshot?.status === "ok" && (!snapshot.exchange || snapshot.exchange === "OKX"))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || null;
  if (!currentSnapshot) return { ok: false, reason: "current_account_snapshot_missing" };

  const credentialBinding = validateOkxCredentialBinding(db, {
    accountId: currentSnapshot.accountId,
    snapshot: currentSnapshot,
    requiredCapability: "read"
  });
  if (!credentialBinding.ok) {
    return { ok: false, reason: credentialBinding.reason || "current_account_binding_unavailable", credentialBinding };
  }
  const account = credentialBinding.account;
  const binding = {
    accountId: account.id,
    apiKeyFingerprint: credentialBinding.currentFingerprint,
    environment: okxEnvironmentConfig().name
  };
  if (!binding.accountId || !binding.apiKeyFingerprint || !binding.environment) {
    return { ok: false, reason: "current_account_binding_incomplete", binding };
  }
  if (!sameAccountingBinding(currentSnapshot, binding)) {
    return { ok: false, reason: "current_account_snapshot_binding_mismatch", binding, snapshotId: currentSnapshot.id || null };
  }
  return { ok: true, binding, currentSnapshot };
}

function accountingEvidenceProgress(db, binding, nowMs = Date.now()) {
  const matching = [...(db.accountSnapshots || []), ...(db.accountingAnchors || [])].filter((row) => (
    row?.status === "ok" && sameAccountingBinding(row, binding)
    && Number.isFinite(new Date(row.createdAt || 0).getTime())
  )).sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  const oldestAt = matching[0]?.createdAt || null;
  const oldestMs = oldestAt ? new Date(oldestAt).getTime() : null;
  const accumulatedMs = Number.isFinite(oldestMs) ? Math.max(0, nowMs - oldestMs) : 0;
  const naturalReadyMs = Number.isFinite(oldestMs) ? oldestMs + 7 * 24 * 60 * 60_000 : null;
  return {
    oldestEvidenceAt: oldestAt,
    accumulatedHours: Number((accumulatedMs / 3_600_000).toFixed(1)),
    progressPct: Number(Math.min(100, (accumulatedMs / (7 * 24 * 60 * 60_000)) * 100).toFixed(1)),
    naturalReadyAt: Number.isFinite(naturalReadyMs) ? new Date(naturalReadyMs).toISOString() : null
  };
}

function baselineSnapshot(db, boundaryMs, binding, options = {}) {
  const maxGapMs = Number(options.maxGapMs ?? process.env.MAX_ACCOUNTING_BASELINE_GAP_MS ?? 15 * 60_000);
  return [...(db.accountSnapshots || []), ...(db.accountingAnchors || [])].filter((snapshot) => {
    if (snapshot?.status !== "ok") return false;
    if (snapshot.exchange && snapshot.exchange !== "OKX") return false;
    if (!sameAccountingBinding(snapshot, binding)) return false;
    const at = new Date(snapshot.createdAt || 0).getTime();
    return Number.isFinite(at) && at <= boundaryMs && boundaryMs - at <= maxGapMs;
  }).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || null;
}

function resolveAccountingBaseline(db, kind, boundaryMs, options = {}) {
  db.portfolio ||= {};
  db.portfolio.accountingBaselines ||= {};
  const current = resolveCurrentAccountingBinding(db);
  if (!current.ok) return current;
  const binding = current.binding;
  const boundaryAt = new Date(boundaryMs).toISOString();
  const existing = db.portfolio.accountingBaselines[kind];
  if (existing?.boundaryAt === boundaryAt
    && sameAccountingBinding(existing, binding)
    && strictNumber(existing.equityUsdt) > 0
    && strictNumber(existing.unrealizedPnlUsdt) !== null) return { ok: true, baseline: existing };

  const snapshot = baselineSnapshot(db, boundaryMs, binding, options);
  const equity = snapshotEquity(snapshot);
  const upl = snapshotUnrealized(snapshot);
  if (!snapshot || !(equity > 0) || !upl.complete) {
    return { ok: false, reason: !snapshot ? "period_start_snapshot_missing" : !(equity > 0) ? "period_start_equity_missing" : upl.reason };
  }
  const baseline = {
    kind,
    boundaryAt,
    snapshotId: snapshot.id || null,
    observedAt: snapshot.createdAt,
    accountId: snapshot.accountId || null,
    apiKeyFingerprint: snapshot.apiKeyFingerprint || null,
    environment: snapshot.environment || null,
    equityUsdt: equity,
    unrealizedPnlUsdt: upl.value,
    netExternalCashFlowUsdt: 0,
    pnlMethod: "reconciled_fills_plus_upl_change",
    createdAt: nowIso()
  };
  db.portfolio.accountingBaselines[kind] = baseline;
  return { ok: true, baseline };
}

export function refreshAccounting(db, options = {}) {
  const nowMs = Number(options.nowMs ?? Date.now());
  retainAccountingAnchors(db);
  const timeZone = db.system?.businessTimeZone || DEFAULT_BUSINESS_TIME_ZONE;
  const equity = currentEquityUsdt(db);
  const dayStartMs = todayStart(nowMs, timeZone);
  const realizedTodayState = realizedPnlSince(db, dayStartMs, nowMs);
  const realizedToday = realizedTodayState.value;
  const unrealizedState = unrealizedPnl(db, { now: nowMs });
  const unrealized = unrealizedState.knownTotal;
  const dailyBaseline = resolveAccountingBaseline(db, "daily", dayStartMs, options);
  const todayPnl = realizedTodayState.pending || !unrealizedState.complete || !dailyBaseline.ok
    ? null
    : realizedToday + unrealized - Number(dailyBaseline.baseline.unrealizedPnlUsdt);

  db.portfolio ||= {};
  if (equity) db.portfolio.totalEquityUsdt = equity;
  db.portfolio.todayPnl = todayPnl === null ? null : Number(todayPnl.toFixed(2));
  db.portfolio.todayPnlPct = equity && todayPnl !== null ? Number(((todayPnl / equity) * 100).toFixed(2)) : null;
  db.portfolio.realizedPnlToday = realizedTodayState.pending ? null : Number(realizedToday.toFixed(2));
  db.portfolio.knownReconciledRealizedPnlToday = Number(realizedToday.toFixed(2));
  db.portfolio.pendingFinancialReconciliationToday = realizedTodayState.pending + unrealizedState.pendingPositions.length + (dailyBaseline.ok ? 0 : 1);
  db.portfolio.unrealizedPnl = unrealizedState.complete ? Number(unrealized.toFixed(2)) : null;
  db.portfolio.knownUnrealizedPnl = Number(unrealized.toFixed(2));
  db.portfolio.pendingUnrealizedPositions = unrealizedState.pendingPositions;
  // 近 7 日盈亏（真实计算）：此前 weekPnl 是从不写入的死字段，导致 riskEngine 的"周亏损熔断"
  // 永远拿到 null → 实盘下每一笔计划都被这条死风控挡死。这里用 fills 真实计算补上。
  const weekEndMs = nowMs;
  // 风险窗口起点按五分钟桶对齐，与不可变会计锚点的采样粒度一致。
  // 这样基线不会每毫秒失效，同时窗口只会比 168h 多 0~5 分钟，偏保守而不会漏算亏损。
  const weekStartMs = rollingAccountingBoundary(weekEndMs);
  const realizedWeekState = realizedPnlSince(db, weekStartMs, weekEndMs);
  const realizedWeek = realizedWeekState.value;
  const weeklyBaseline = resolveAccountingBaseline(db, "rolling_168h", weekStartMs, options);
  const weekPnl = realizedWeekState.pending || !unrealizedState.complete || !weeklyBaseline.ok
    ? null
    : realizedWeek + unrealized - Number(weeklyBaseline.baseline.unrealizedPnlUsdt);
  db.portfolio.weekPnl = weekPnl === null ? null : Number(weekPnl.toFixed(2));
  db.portfolio.weekPnlPct = equity && weekPnl !== null ? Number(((weekPnl / equity) * 100).toFixed(2)) : null;
  db.portfolio.knownReconciledRealizedPnlWeek = Number(realizedWeek.toFixed(2));
  db.portfolio.pendingFinancialReconciliationWeek = realizedWeekState.pending + unrealizedState.pendingPositions.length + (weeklyBaseline.ok ? 0 : 1);
  db.portfolio.pendingTradeFinancialFactsToday = realizedTodayState.pending + unrealizedState.pendingPositions.length;
  db.portfolio.pendingTradeFinancialFactsWeek = realizedWeekState.pending + unrealizedState.pendingPositions.length;
  db.portfolio.pendingDailyBaseline = dailyBaseline.ok ? 0 : 1;
  db.portfolio.pendingWeekBaseline = weeklyBaseline.ok ? 0 : 1;
  db.portfolio.weekWindowStartAt = new Date(weekStartMs).toISOString();
  db.portfolio.weekWindowEndAt = new Date(weekEndMs).toISOString();
  db.portfolio.weekWindowSemantics = "rolling_168_hours";
  db.portfolio.dailyWindowStartAt = new Date(dayStartMs).toISOString();
  db.portfolio.dailyWindowTimeZone = timeZone;
  db.portfolio.dailyStartEquityUsdt = dailyBaseline.ok ? Number(dailyBaseline.baseline.equityUsdt) : null;
  db.portfolio.dailyStartUnrealizedPnlUsdt = dailyBaseline.ok ? Number(dailyBaseline.baseline.unrealizedPnlUsdt) : null;
  db.portfolio.dailyBaselineStatus = dailyBaseline.ok ? "reconciled" : dailyBaseline.reason;
  db.portfolio.weekBaselineStatus = weeklyBaseline.ok ? "reconciled" : weeklyBaseline.reason;
  db.portfolio.accountingUpdatedAt = nowIso();

  const mandate = activeMandate(db);
  if (mandate && equity) {
    const dailyRiskEquity = dailyBaseline.ok ? Number(dailyBaseline.baseline.equityUsdt) : null;
    const dailyLossCap = dailyRiskEquity ? dailyRiskEquity * (Number(mandate.maxDailyLossPct || 1) / 100) : null;
    if (todayPnl === null) {
      db.system.remainingDailyLossUsdt = null;
      db.system.dailyLossCapUsdt = dailyLossCap === null ? null : Number(dailyLossCap.toFixed(2));
      db.system.dailyLossBudgetStatus = "pending_financial_reconciliation";
      db.system.reduceOnlyMode = true;
      db.system.reduceOnlyBy ||= "financial_reconciliation_pending";
      syncReduceOnlyState(db);
      return {
        equity,
        todayPnl: null,
        realizedToday: null,
        unrealized: db.portfolio.unrealizedPnl,
        remainingDailyLossUsdt: null,
        pendingFinancialReconciliation: realizedTodayState.pending + unrealizedState.pendingPositions.length + (dailyBaseline.ok ? 0 : 1),
        knownRealizedToday: Number(realizedToday.toFixed(2)),
        pendingUnrealizedPositions: unrealizedState.pendingPositions.length
      };
    }
    const budgetWasExhausted = db.system.dailyLossBudgetStatus === "exhausted";
    db.system.dailyLossBudgetStatus = "reconciled";
    const lossSoFar = Math.max(0, -todayPnl);
    const remaining = Math.max(0, dailyLossCap - lossSoFar);
    db.system.remainingDailyLossUsdt = Number(remaining.toFixed(2));
    db.system.dailyLossCapUsdt = Number(dailyLossCap.toFixed(2));

    if (remaining <= 0) {
      // Exhausting a loss budget blocks new entries but must not disable the AI
      // analysis loop or overwrite the saved operating mode. The next business
      // window can therefore recover automatically after authoritative accounting.
      db.system.dailyLossBudgetStatus = "exhausted";
      db.system.riskStatus = "暂停新开仓";
      db.system.latestAction = "日亏损预算耗尽，暂停新开仓";
      if (!budgetWasExhausted) {
        db.riskIncidents.unshift({
          id: id("incident"),
          severity: "critical",
          status: "open",
          title: `日亏损预算耗尽（上限 ${dailyLossCap.toFixed(2)} USDT），已暂停新开仓`,
          source: "accounting",
          createdAt: nowIso()
        });
        appendAudit(db, "日亏损预算耗尽，暂停新开仓", "accounting", "Accounting", "critical");
        appendTrace(db, "risk_check", "日亏损预算耗尽", "blocked");
      }
    }
  } else if (!mandate) {
    db.system.remainingDailyLossUsdt = null;
    db.system.dailyLossCapUsdt = null;
  }

  syncReduceOnlyState(db);

  return {
    equity,
    todayPnl: db.portfolio.todayPnl,
    realizedToday: db.portfolio.realizedPnlToday,
    unrealized: db.portfolio.unrealizedPnl,
    remainingDailyLossUsdt: db.system.remainingDailyLossUsdt
  };
}

// 核算任务的权威入口：先按本地不可变快照计算；仅当唯一缺口是滚动 168h
// 起点快照时，才尝试用当前 Key 读取的 OKX 账单、仓位历史与边界标记价格重建。
// 回补失败保留原 fail-closed 状态，绝不写 0、复用旧 Key 基线或清除暂停原因。
export async function refreshAccountingAuthoritatively(db, options = {}) {
  options.assertLease?.();
  const nowMs = Number(options.nowMs ?? Date.now());
  let result = refreshAccounting(db, { ...options, nowMs });
  const boundaryMs = rollingAccountingBoundary(nowMs);
  if (db.portfolio?.weekBaselineStatus !== "period_start_snapshot_missing") {
    if (db.portfolio?.accountingHistoryBackfill?.status === "reconciled") {
      db.portfolio.accountingHistoryBackfill = {
        ...db.portfolio.accountingHistoryBackfill,
        status: "not_required",
        reason: "immutable_period_start_anchor_available",
        updatedAt: nowIso()
      };
    }
    return result;
  }

  const current = resolveCurrentAccountingBinding(db);
  if (!current.ok) {
    db.portfolio.accountingHistoryBackfill = {
      status: "blocked",
      reason: current.reason || "current_account_binding_unavailable",
      boundaryAt: new Date(boundaryMs).toISOString(),
      attemptedAt: nowIso()
    };
    return result;
  }
  const localFactsComplete = Number(db.portfolio?.pendingTradeFinancialFactsToday || 0) === 0
    && Number(db.portfolio?.pendingTradeFinancialFactsWeek || 0) === 0
    && db.portfolio?.dailyBaselineStatus === "reconciled";
  if (!localFactsComplete) {
    db.portfolio.accountingHistoryBackfill = {
      ...db.portfolio.accountingHistoryBackfill,
      status: "waiting",
      reason: "local_financial_facts_incomplete",
      boundaryAt: new Date(boundaryMs).toISOString(),
      attemptedAt: nowIso()
    };
    return result;
  }
  const progress = accountingEvidenceProgress(db, current.binding, nowMs);
  const snapshotAtMs = new Date(current.currentSnapshot?.createdAt || 0).getTime();
  const snapshotMaxAgeMs = Number(options.snapshotMaxAgeMs ?? process.env.MAX_ACCOUNT_SNAPSHOT_AGE_MS ?? 10 * 60_000);
  if (!Number.isFinite(snapshotAtMs) || snapshotAtMs < boundaryMs || nowMs - snapshotAtMs > snapshotMaxAgeMs || snapshotAtMs > nowMs + 30_000) {
    db.portfolio.accountingHistoryBackfill = {
      status: "waiting",
      reason: "fresh_authoritative_account_snapshot_required",
      boundaryAt: new Date(boundaryMs).toISOString(),
      attemptedAt: nowIso(),
      ...progress
    };
    return result;
  }

  const previous = db.portfolio.accountingHistoryBackfill || {};
  const retryMs = Number(options.historyBackfillRetryMs ?? process.env.ACCOUNTING_HISTORY_BACKFILL_RETRY_MS ?? 5 * 60_000);
  const previousAttemptMs = new Date(previous.attemptedAt || 0).getTime();
  if (options.forceHistoryBackfill !== true && previous.status === "failed"
    && previous.boundaryAt === new Date(boundaryMs).toISOString()
    && Number.isFinite(previousAttemptMs) && nowMs - previousAttemptMs < retryMs) return result;

  db.portfolio.accountingHistoryBackfill = {
    status: "running",
    reason: null,
    boundaryAt: new Date(boundaryMs).toISOString(),
    attemptedAt: nowIso(),
    ...progress
  };
  const localRealizedState = realizedPnlSince(db, boundaryMs, snapshotAtMs);
  options.assertLease?.();
  const backfill = await backfillOkxRollingAccountingBaseline({
    boundaryMs,
    endMs: snapshotAtMs,
    currentEquity: snapshotEquity(current.currentSnapshot),
    currentSnapshot: current.currentSnapshot,
    binding: current.binding,
    localRealizedState
  }, options);
  options.assertLease?.();
  if (!backfill.ok) {
    db.portfolio.accountingHistoryBackfill = {
      lastSuccessfulAt: previous.lastSuccessfulAt || null,
      status: "failed",
      reason: backfill.reason || "okx_history_evidence_incomplete",
      boundaryAt: new Date(boundaryMs).toISOString(),
      attemptedAt: nowIso(),
      error: backfill.error || null,
      ...progress
    };
    appendTrace(db, "accounting_backfill", `近 7 日核算历史回补未完成：${backfill.reason || "unknown"}`, "blocked");
    return result;
  }

  db.portfolio.accountingBaselines ||= {};
  db.portfolio.accountingBaselines.rolling_168h = backfill.baseline;
  const firstRecovery = !previous.lastSuccessfulAt;
  db.portfolio.accountingHistoryBackfill = {
    status: "reconciled",
    reason: null,
    boundaryAt: backfill.baseline.boundaryAt,
    verifiedThroughAt: backfill.baseline.verifiedThroughAt,
    attemptedAt: nowIso(),
    lastSuccessfulAt: nowIso(),
    evidenceHash: backfill.baseline.evidenceHash,
    billCount: backfill.summary.billCount,
    spanningPositionCount: backfill.summary.spanningPositionCount,
    reconstructedWeekPnlUsdt: backfill.summary.reconstructedWeekPnlUsdt,
    ...progress
  };
  if (firstRecovery) {
    appendAudit(db, `用 OKX 权威历史重建近 7 日核算基线：账单 ${backfill.summary.billCount} 条，跨期仓位 ${backfill.summary.spanningPositionCount} 个`, "rolling_168h_accounting_baseline", "Accounting", "info");
  }
  appendTrace(db, "accounting_backfill", "近 7 日核算历史回补完成", "ok");
  result = refreshAccounting(db, { ...options, nowMs });
  return { ...result, historyBackfill: db.portfolio.accountingHistoryBackfill };
}

// ---------------------------------------------------------------------------
// 绩效统计：按平仓成交聚合。
// ---------------------------------------------------------------------------
export function performanceReport(db) {
  // 部分平仓属于同一个仓位生命周期，绩效笔数/胜率/回撤必须先聚合，不能把三次减仓算成三笔交易。
  const lifecycles = groupClosedTradeLifecycles(db.fills || []);
  const reconciled = lifecycles.filter((item) => item.netRealizedPnl !== null && item.netRealizedPnl !== undefined && item.netRealizedPnl !== "" && Number.isFinite(Number(item.netRealizedPnl)));
  const closes = reconciled.map((item) => ({ ...item.representative, realizedPnl: item.netRealizedPnl, grossRealizedPnl: item.realizedPnl }));
  const wins = closes.filter((fill) => Number(fill.realizedPnl) > 0);
  const losses = closes.filter((fill) => Number(fill.realizedPnl) < 0);
  const totalPnl = closes.reduce((sum, fill) => sum + Number(fill.realizedPnl), 0);
  const grossWin = wins.reduce((sum, fill) => sum + Number(fill.realizedPnl), 0);
  const grossLoss = Math.abs(losses.reduce((sum, fill) => sum + Number(fill.realizedPnl), 0));

  const daily = new Map();
  for (const fill of closes) {
    const day = businessDateKey(fill.createdAt, db.system?.businessTimeZone || DEFAULT_BUSINESS_TIME_ZONE);
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
    financiallyReconciledTrades: closes.length,
    pendingFinancialReconciliation: lifecycles.length - closes.length,
    grossClosedTradeLifecycles: lifecycles.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: closes.length ? Number(((wins.length / closes.length) * 100).toFixed(1)) : null,
    totalPnlUsdt: Number(totalPnl.toFixed(2)),
    pnlBasis: "net_after_recorded_entry_and_close_fees_and_funding",
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
    openExecutions: (db.executionOrders || []).filter((item) => OPEN_EXECUTION_STATES.has(String(item.status || "").toLowerCase())).length,
    generatedAt: nowIso()
  };
}
