import { executeTradeAction } from "./tradeActions.mjs";
import { syncPublicMarket } from "./exchangeConnector.mjs";
import { notifyLarkThrottled } from "./larkNotifier.mjs";
import { publishProfitablePositionPosters } from "./telegramNotifier.mjs";
import { reconcileRiskIncidentLifecycle } from "./riskIncidentLifecycle.mjs";
import { acquireExecutionLease, appendAudit, appendTrace, id, latestSuccessfulAccountSnapshot, nowIso, releaseExecutionLease, renewExecutionLease, saveDb } from "./store.mjs";
import { canonicalPositionDirection } from "./positionIdentity.mjs";
import { closeExecution } from "./executionEngine.mjs";
import { clearReduceOnlyReason, setReduceOnlyReason } from "./reduceOnlyState.mjs";
import { marketFactFreshness } from "./marketFreshness.mjs";
import { strictFiniteFact } from "./factValues.mjs";
import { assertActiveLease, isLeaseLostError, LeaseLostError } from "./leaseSafety.mjs";
import { refreshOwnerImprovementRegistry } from "./ownerReviewLoop.mjs";

// 调用时读(而非加载时),这样「风控设置」运行时改 TRAIL_* 立即生效、不用重启。
const trailPct = () => Math.max(0.001, Number(process.env.TRAIL_PCT || 0.012));            // 跟踪止损距离(小数,默认 0.012=1.2%)
const trailActivatePct = () => Math.max(0, Number(process.env.TRAIL_ACTIVATE_PCT || 1.5)) / 100; // 盈利达此(默认 1.5%)即启动追踪(freqtrade trailing_stop_positive)

// move_stop 成功判定:只有交易所真正接受(或幂等重放)才算"止损已移动"。
// 【修复谎报保本】OKX 降级态 unsupported_move_stop_okx 的 status !== "blocked",旧代码据此误判为成功 →
// 回写本地 stopLoss + 标 breakevenMoved + 推"✅已保本",但交易所侧止损纹丝未动,持仓实际在裸奔。
// 这里收窄为显式白名单:白名单外(含 OKX 降级、交易所拒单、缺凭证)一律视为"未移动",绝不回写、绝不谎报。
export const STOP_MOVE_SUCCESS = new Set(["ok", "submitted", "idempotent_replay"]);
export const moveStopSucceeded = (result) => STOP_MOVE_SUCCESS.has(result?.status);

export function exchangeStopEvidence(db, position, exchangePosition, at = Date.now()) {
  if (!position.stopLoss) return { verified: true, present: false, reason: "local_stop_missing", stopPrice: null };
  const executionOrder = (db.executionOrders || []).find((item) => item.id === position.executionOrderId);
  if (!executionOrder?.stopClientOrderId) return { verified: true, present: false, reason: "stop_identity_missing", stopPrice: null };
  const latestOkxSnapshot = latestSuccessfulAccountSnapshot(db, { exchange: "OKX" });
  const snapshotAt = new Date(latestOkxSnapshot?.createdAt || 0).getTime();
  const openedAt = new Date(position.openedAt || 0).getTime();
  const snapshotAfterOpen = latestOkxSnapshot && snapshotAt >= openedAt && at - snapshotAt <= 2 * 60_000;
  const snapshotOwnsMirror = snapshotAfterOpen && exchangePosition?.rawSyncedAt === latestOkxSnapshot.createdAt;
  if (!snapshotOwnsMirror || !Array.isArray(latestOkxSnapshot.algoOrders) || latestOkxSnapshot.algoOrdersComplete !== true) {
    return { verified: false, present: null, reason: "exchange_stop_snapshot_unverified", stopPrice: null };
  }
  const baseInstId = String(position.symbol).replace("/", "-").toUpperCase();
  const instId = baseInstId.endsWith("-SWAP") ? baseInstId : `${baseInstId}-SWAP`;
  const remoteStop = latestOkxSnapshot.algoOrders.find((order) => order.algoClOrdId === executionOrder.stopClientOrderId
    && String(order.instId || "").toUpperCase() === instId
    && Number(order.slTriggerPx || 0) > 0);
  return remoteStop
    ? { verified: true, present: true, reason: null, stopPrice: Number(remoteStop.slTriggerPx), snapshotAt: latestOkxSnapshot.createdAt }
    : { verified: true, present: false, reason: "exchange_stop_missing", stopPrice: null, snapshotAt: latestOkxSnapshot.createdAt };
}

// 每日目标只作为“已经盈利后的降风险阈值”，绝不参与开仓方向、频率或仓位大小。
// 触发依据必须是 OKX 权威浮盈；止损是否已更优也必须由 OKX 算法单快照证明。
export function dailyGoalBreakevenDecision(db, position, exchangePosition, at = Date.now()) {
  if (db.system?.dailyGoalBreakevenEnabled !== true) return { action: "none", reason: "disabled" };
  const targetUsdt = Number(db.system?.dailyGoalUsdt);
  if (!Number.isFinite(targetUsdt) || targetUsdt <= 0) return { action: "none", reason: "daily_goal_unconfigured" };
  if (!exchangePosition || exchangePosition.source !== "exchange_rest" || exchangePosition.exchange !== "OKX") {
    return { action: "wait", reason: "authoritative_position_unavailable", targetUsdt };
  }
  const unrealizedPnlUsdt = Number(exchangePosition.pnl);
  if (!Number.isFinite(unrealizedPnlUsdt)) return { action: "wait", reason: "authoritative_pnl_unavailable", targetUsdt };
  if (unrealizedPnlUsdt < targetUsdt) return { action: "wait", reason: "target_not_reached", targetUsdt, unrealizedPnlUsdt };
  const entryPrice = Number(position.entry ?? position.entryPrice ?? exchangePosition.entry);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return { action: "wait", reason: "entry_price_unavailable", targetUsdt, unrealizedPnlUsdt };
  const evidence = exchangeStopEvidence(db, position, exchangePosition, at);
  if (!evidence.verified) return { action: "wait", reason: evidence.reason, targetUsdt, unrealizedPnlUsdt, entryPrice };
  if (!evidence.present) return { action: "wait", reason: evidence.reason, targetUsdt, unrealizedPnlUsdt, entryPrice };
  const short = position.direction === "空" || position.direction === "short";
  const alreadyProtected = short ? evidence.stopPrice <= entryPrice : evidence.stopPrice >= entryPrice;
  return alreadyProtected
    ? { action: "none", reason: "already_protected", targetUsdt, unrealizedPnlUsdt, entryPrice, currentStopPrice: evidence.stopPrice }
    : { action: "move_to_entry", reason: "target_reached", targetUsdt, unrealizedPnlUsdt, entryPrice, currentStopPrice: evidence.stopPrice };
}

export function stopProtectionFailureReason(db, position, exchangePosition, at = Date.now()) {
  const evidence = exchangeStopEvidence(db, position, exchangePosition, at);
  if (!evidence.verified) return null;
  return evidence.present ? null : evidence.reason;
}

async function moveStopTo(db, position, newStop, label, executeAction = executeTradeAction) {
  const executionOrder = (db.executionOrders || []).find((item) => item.id === position.executionOrderId);
  const result = await executeAction(db, "move_stop", {
    exchange: executionOrder?.exchange || "OKX",
    marketType: "perpetual_usdt",
    symbol: position.symbol,
    stopPrice: newStop,
    stopClientOrderId: executionOrder?.stopClientOrderId,
    requestId: `movestop${String(executionOrder?.id || position.id || "position").replace(/[^a-zA-Z0-9]/g, "").slice(-16)}${String(label || "risk").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}`,
    quantity: position.size,
    reduceOnly: true,
    agentRunId: executionOrder?.agentRunId,
    analysisBundleId: executionOrder?.analysisBundleId,
    tradePlanId: executionOrder?.planId,
    riskCheckId: executionOrder?.riskCheckId,
    mandateId: executionOrder?.mandateId,
    manualApproval: true
  });
  return result;
}

// ---------------------------------------------------------------------------
// 持仓管理循环：刷新标记价、TP1 触达后移动止损到保本、风险告警。
// 由调度器周期驱动；所有真实写操作仍经 tradeActions 安全闸。
// ---------------------------------------------------------------------------

export async function monitorPositions(db, options = {}) {
  const ownerId = options.monitorOwnerId || `${process.env.INSTANCE_ID || `pid-${process.pid}`}:position-monitor:${id("owner")}`;
  const leaseTtlMs = Number(options.leaseTtlMs || 30_000);
  const lease = acquireExecutionLease("position-monitor", ownerId, leaseTtlMs);
  if (!lease.acquired) return { monitored: 0, actions: [], status: "monitor_lease_held", lease };
  let localLeaseLost = false;
  const assertMonitorLease = () => {
    assertActiveLease(options);
    if (localLeaseLost) throw new LeaseLostError();
    const renewed = renewExecutionLease("position-monitor", ownerId, lease.fencingToken, leaseTtlMs);
    if (!renewed?.renewed) {
      localLeaseLost = true;
      throw new LeaseLostError();
    }
    return true;
  };
  const heartbeat = setInterval(() => {
    try {
      const renewed = renewExecutionLease("position-monitor", ownerId, lease.fencingToken, leaseTtlMs);
      if (!renewed?.renewed) localLeaseLost = true;
    } catch { localLeaseLost = true; }
  }, Math.max(1_000, Math.floor(leaseTtlMs / 3)));
  heartbeat.unref?.();
  try {
    assertMonitorLease();
    return await monitorPositionsLeased(db, { ...options, assertLease: assertMonitorLease });
  } finally {
    clearInterval(heartbeat);
    // 只有仍持有 fencing token 的 owner 才可把本轮内存状态落盘。
    try { assertMonitorLease(); (options.saveDb || saveDb)(db); } catch { /* 失租时禁止旧 owner 落盘 */ }
    try { releaseExecutionLease("position-monitor", ownerId, lease.fencingToken); } catch { /* TTL 兜底 */ }
  }
}

async function monitorPositionsLeased(db, options = {}) {
  const managed = (db.positions || []).filter((position) => position.source === "execution_engine");
  const actions = [];
  const stopAction = options.executeTradeAction || executeTradeAction;

  for (const position of managed) {
    try {
      options.assertLease?.();
      // 优先用实时 WS 价（marketStream 持续更新 db.markets）；无实时价时才回退 REST。
      let market = db.markets?.find((item) => item.symbol === position.symbol);
      let tickerFacts = marketFactFreshness(market || {});
      if (!tickerFacts.ticker.ok) {
        await syncPublicMarket(db, "OKX", position.symbol).catch(() => {});
        assertActiveLease(options);
        market = db.markets?.find((item) => item.symbol === position.symbol);
        tickerFacts = marketFactFreshness(market || {});
      }
      const mark = tickerFacts.ticker.ok ? tickerFacts.price : null;
      if (!Number.isFinite(mark) || mark <= 0) {
        setReduceOnlyReason(db, "position_price_fact_unavailable", { sourceId: position.executionOrderId || position.id, sticky: false });
        raiseIncident(db, position, "high", `${position.symbol} 实时价格事实缺失或过期，系统已暂停新开仓`);
        continue;
      }
      clearReduceOnlyReason(db, "position_price_fact_unavailable", { sourceId: position.executionOrderId || position.id, resolvedBy: "PositionManager", resolution: "fresh_ticker_restored" });
      position.mark = mark;
      const direction = canonicalPositionDirection(position);
      const exchangePosition = (db.positions || []).find((item) => item.source === "exchange_rest"
        && item.exchange === "OKX" && item.symbol === position.symbol
        && canonicalPositionDirection(item) === direction);
      if (exchangePosition) {
        const liq = strictFiniteFact(exchangePosition.liqPx);
        if (Number.isFinite(liq) && liq > 0) position.liqPx = liq;
        const leverage = strictFiniteFact(exchangePosition.leverage);
        if (Number.isFinite(leverage) && leverage > 0) position.leverage = leverage;
      }
      updateExcursion(db, position, mark);

      // 真实止损存活核验：本地 stopLoss 只是“期望值”，不能证明 OKX 仍有未触发止损。
      // 只有新于开仓、且同时包含该真实持仓和策略委托的 REST 快照，才作为缺失证据；
      // 一旦确认保护单消失，系统自主整仓退出，绝不把裸仓留给人工发现。
      const executionOrder = (db.executionOrders || []).find((item) => item.id === position.executionOrderId);
      const stopEvidence = exchangeStopEvidence(db, position, exchangePosition);
      const missingProtectionReason = stopEvidence.verified && !stopEvidence.present ? stopEvidence.reason : null;
      if (stopEvidence.verified && stopEvidence.present && executionOrder) {
        clearReduceOnlyReason(db, "protection_emergency", { sourceId: executionOrder.id, resolvedBy: "PositionManager", resolution: "authoritative_stop_restored" });
      }
      if (!stopEvidence.verified) {
        position.stopEvidenceUnavailableAt ||= nowIso();
        appendTrace(db, "position_manager", `${position.symbol} 止损证据快照不可验证，保持既有保护状态`, "warning");
      } else {
        position.stopEvidenceUnavailableAt = null;
      }
      if (missingProtectionReason && !position.protectionEmergencySubmittedAt) {
        const emergencyActionId = `emergency_protection_${String(position.executionOrderId || position.id).replace(/[^a-zA-Z0-9_-]/g, "").slice(-28)}`;
        const emergencyExecution = ensureEmergencyExecution(db, position, executionOrder, direction, emergencyActionId);
        assertActiveLease(options);
        const result = await (options.closeExecution || closeExecution)(db, emergencyExecution.id, missingProtectionReason, {
          intent: "close_position",
          expectedStatus: emergencyExecution.status,
          internal: true,
          emergencyActionId,
          executeTradeAction: options.executeTradeAction,
          assertLease: options.assertLease,
          signal: options.signal
        });
        if (/pending/.test(String(result.status))) {
          position.protectionEmergencySubmittedAt = nowIso();
          db.system.reduceOnlyMode = true;
          db.system.reduceOnlyBy = "protection_emergency";
          setReduceOnlyReason(db, "protection_emergency", { sticky: true, sourceId: emergencyExecution.id });
          db.system.riskStatus = "暂停新开仓";
          raiseIncident(db, position, "critical", `${position.symbol} 的 OKX 止损保护缺失，已自主提交整仓退出`);
          appendAudit(db, `止损保护核验失败(${missingProtectionReason})，已自主提交整仓退出`, position.id, "PositionManager", "critical");
          actions.push({ symbol: position.symbol, action: "missing_protection_emergency_close", emergencyActionId, status: result.status });
        } else {
          position.protectionEmergencyFailedAt = nowIso();
          db.system.killSwitch = true;
          db.system.reduceOnlyMode = true;
          db.system.reduceOnlyBy = "protection_emergency";
          setReduceOnlyReason(db, "protection_emergency", { sticky: true, sourceId: emergencyExecution.id });
          raiseIncident(db, position, "critical", `${position.symbol} 止损保护缺失且紧急退出失败(${result.status})，已熔断`);
          actions.push({ symbol: position.symbol, action: "missing_protection_emergency_failed", status: result.status });
        }
        continue;
      }

      const goalProtection = dailyGoalBreakevenDecision(db, position, exchangePosition);
      if (goalProtection.reason === "already_protected" && !position.dailyGoalBreakevenSatisfiedAt) {
        position.dailyGoalBreakevenSatisfiedAt = nowIso();
        position.dailyGoalBreakevenGoalUsdt = goalProtection.targetUsdt;
        position.dailyGoalBreakevenStatus = "already_protected";
        db.system.dailyGoalProtectionLastEvent = {
          symbol: position.symbol,
          status: "already_protected",
          targetUsdt: goalProtection.targetUsdt,
          unrealizedPnlUsdt: goalProtection.unrealizedPnlUsdt,
          stopPrice: goalProtection.currentStopPrice,
          at: position.dailyGoalBreakevenSatisfiedAt
        };
      }
      if (goalProtection.action === "move_to_entry") {
        const lastAttemptAt = new Date(position.dailyGoalBreakevenAttemptAt || 0).getTime();
        if (!Number.isFinite(lastAttemptAt) || Date.now() - lastAttemptAt >= 60_000) {
          position.dailyGoalBreakevenAttemptAt = nowIso();
          assertActiveLease(options);
          const result = await moveStopTo(db, position, goalProtection.entryPrice, "daily_goal_breakeven", stopAction);
          if (moveStopSucceeded(result)) {
            const confirmedStop = Number(result.stopPrice || goalProtection.entryPrice);
            position.stopLoss = Number.isFinite(confirmedStop) ? confirmedStop : goalProtection.entryPrice;
            position.dailyGoalBreakevenSatisfiedAt = nowIso();
            position.dailyGoalBreakevenGoalUsdt = goalProtection.targetUsdt;
            position.dailyGoalBreakevenStatus = "confirmed";
            position.dailyGoalBreakevenLastError = null;
            db.system.dailyGoalProtectionLastEvent = {
              symbol: position.symbol,
              status: "confirmed",
              targetUsdt: goalProtection.targetUsdt,
              unrealizedPnlUsdt: goalProtection.unrealizedPnlUsdt,
              stopPrice: position.stopLoss,
              at: position.dailyGoalBreakevenSatisfiedAt
            };
            appendAudit(db, `${position.symbol} 单笔浮盈 ${goalProtection.unrealizedPnlUsdt.toFixed(2)}U 达到每日目标 ${goalProtection.targetUsdt}U，OKX 止损已确认保护到开仓价 ${position.stopLoss}`, position.id, "PositionManager", "warning");
            appendTrace(db, "position_manager", `${position.symbol} 每日目标保本已由 OKX 确认`, "ok");
            assertActiveLease(options);
            await notifyLarkThrottled(db, `daily_goal_breakeven:${position.id}`, 60 * 60 * 1000, {
              severity: "success",
              title: "✅ 单笔达标，止损已保护到开仓价",
              body: `**${position.symbol}** 当前浮盈 **${goalProtection.unrealizedPnlUsdt.toFixed(2)} USDT**，达到每日目标 ${goalProtection.targetUsdt} USDT；OKX 止损已确认移动到 ${position.stopLoss}。`,
              fields: [{ label: "开仓价", value: String(goalProtection.entryPrice) }, { label: "原止损", value: String(goalProtection.currentStopPrice) }]
            });
            actions.push({ symbol: position.symbol, action: "daily_goal_breakeven_confirmed", stopPrice: position.stopLoss, targetUsdt: goalProtection.targetUsdt });
          } else {
            position.dailyGoalBreakevenStatus = "move_failed";
            position.dailyGoalBreakevenLastError = result.status || "unknown";
            db.system.dailyGoalProtectionLastEvent = {
              symbol: position.symbol,
              status: "move_failed",
              targetUsdt: goalProtection.targetUsdt,
              unrealizedPnlUsdt: goalProtection.unrealizedPnlUsdt,
              error: result.status || "unknown",
              at: nowIso()
            };
            appendAudit(db, `${position.symbol} 已达到每日盈利目标，但 OKX 止损未能移动到开仓价（${result.status || "unknown"}）；原止损保持不变`, position.id, "PositionManager", "warning");
            assertActiveLease(options);
            await notifyLarkThrottled(db, `daily_goal_breakeven_fail:${position.id}`, 15 * 60 * 1000, {
              severity: "warning",
              title: "⚠ 达标保本改单未成功",
              body: `**${position.symbol}** 已达到每日盈利目标，但 OKX 未确认止损移动（${result.status || "unknown"}）。原止损保持有效，系统会继续重试。`,
              fields: [{ label: "目标保本价", value: String(goalProtection.entryPrice) }, { label: "当前已确认止损", value: String(goalProtection.currentStopPrice) }]
            });
            actions.push({ symbol: position.symbol, action: "daily_goal_breakeven_failed", reason: result.status || "unknown" });
          }
        }
      }

      // 强平距离盯盘(交易员命门):杠杆永续在两次巡检之间就可能触及强平。逼近 → 严重告警 + 建议减仓/加保证金。
      const markTtlMs = Number(process.env.MAX_LIQUIDATION_MARK_AGE_MS || 15_000);
      const futureSkewMs = Number(process.env.MAX_MARKET_FUTURE_SKEW_MS || 30_000);
      const markMirrors = (db.positions || []).filter((item) => ["exchange_ws", "exchange_rest"].includes(item.source)
        && item.exchange === "OKX" && item.symbol === position.symbol && canonicalPositionDirection(item) === direction)
        .map((item) => ({ row: item, value: strictFiniteFact(item.mark), at: new Date(item.exchangeObservedAt || item.rawSyncedAt || item.updatedAt || 0).getTime(), priority: item.source === "exchange_ws" ? 2 : 1 }))
        .filter((item) => Number.isFinite(item.value) && item.value > 0 && Number.isFinite(item.at)
          && Date.now() - item.at <= markTtlMs && Date.now() - item.at >= -futureSkewMs)
        .sort((a, b) => b.priority - a.priority || b.at - a.at);
      const liquidationMark = markMirrors[0]?.value ?? null;
      const liqPx = strictFiniteFact(position.liqPx ?? position.liquidationPrice);
      const liqDirectionValid = Number.isFinite(liqPx) && liqPx > 0 && Number.isFinite(liquidationMark)
        && (direction === "short" ? liqPx > liquidationMark : liqPx < liquidationMark);
      if (!liqDirectionValid) {
        setReduceOnlyReason(db, "liquidation_fact_unavailable", { sourceId: position.executionOrderId || position.id, sticky: false });
        raiseIncident(db, position, "high", `${position.symbol} 强平价或新鲜标记价不可验证，禁止以未知强平距离继续开仓`);
      } else {
        clearReduceOnlyReason(db, "liquidation_fact_unavailable", { sourceId: position.executionOrderId || position.id, resolvedBy: "PositionManager", resolution: "fresh_liquidation_facts_restored" });
        const liqDistPct = Math.abs(liquidationMark - liqPx) / liquidationMark * 100;
        const liqThreshold = Number(process.env.LIQ_DISTANCE_ALERT_PCT || 8);
        position.liqDistancePct = Number(liqDistPct.toFixed(2));
        if (liqDistPct < liqThreshold) {
          raiseIncident(db, position, "critical", `${position.symbol} 逼近强平：现价 ${mark} 距强平 ${liqPx} 仅 ${liqDistPct.toFixed(1)}%（<${liqThreshold}%），建议立即减仓或加保证金`);
          assertActiveLease(options);
          await notifyLarkThrottled(db, `liq_near:${position.id}`, 10 * 60 * 1000, {
            severity: "critical",
            title: "🚨 持仓逼近强平",
            body: `**${position.symbol}** ${position.direction || ""} 现价距强平仅 **${liqDistPct.toFixed(1)}%**，请立即减仓或加保证金。`,
              fields: [{ label: "标记价", value: String(liquidationMark) }, { label: "强平价", value: String(liqPx) }]
          });
          actions.push({ symbol: position.symbol, action: "near_liquidation_alert", liqDistancePct: position.liqDistancePct });
        }
        const autoCloseThreshold = Math.min(liqThreshold, Number(process.env.LIQ_DISTANCE_AUTO_CLOSE_PCT || 4));
        if (liqDistPct < autoCloseThreshold && !position.liquidationEmergencySubmittedAt) {
          const emergencyActionId = `emergency_liquidation_${String(position.executionOrderId || position.id).replace(/[^a-zA-Z0-9_-]/g, "").slice(-28)}`;
          const emergencyExecution = ensureEmergencyExecution(db, position, executionOrder, direction, emergencyActionId);
          assertActiveLease(options);
          const result = await (options.closeExecution || closeExecution)(db, emergencyExecution.id, "liquidation_distance_critical", {
            intent: "close_position",
            expectedStatus: emergencyExecution.status,
            internal: true,
            emergencyActionId,
            executeTradeAction: options.executeTradeAction,
            assertLease: options.assertLease,
            signal: options.signal
          });
          if (/pending/.test(String(result.status))) {
            position.liquidationEmergencySubmittedAt = nowIso();
            db.system.reduceOnlyMode = true;
            db.system.reduceOnlyBy = "liquidation_emergency";
            setReduceOnlyReason(db, "liquidation_emergency", { sticky: true, sourceId: emergencyExecution.id });
            db.system.riskStatus = "暂停新开仓";
            appendAudit(db, `强平距离仅 ${liqDistPct.toFixed(2)}%，已自主提交整仓退出`, position.id, "PositionManager", "critical");
            actions.push({ symbol: position.symbol, action: "liquidation_emergency_close", emergencyActionId, status: result.status });
          } else {
            db.system.killSwitch = true;
            db.system.reduceOnlyMode = true;
            db.system.reduceOnlyBy = "liquidation_emergency";
            setReduceOnlyReason(db, "liquidation_emergency", { sticky: true, sourceId: emergencyExecution.id });
            raiseIncident(db, position, "critical", `${position.symbol} 强平紧急退出失败(${result.status})，已熔断`);
            actions.push({ symbol: position.symbol, action: "liquidation_emergency_failed", status: result.status });
          }
          continue;
        }
      }

      // 持仓论点重评:开仓后不能只盯价格——资金费转为强烈不利、或出现高可信度反向即时新闻,
      // 说明"当初开仓的逻辑可能已变",提示复核/减仓(只建议+告警,不自动平)。
      {
        const base = String(position.symbol).split(/[/-]/)[0].toUpperCase();
        const isShort = position.direction === "空" || position.direction === "short";
        const funding = Number(market?.fundingRate);
        const fundingAgainst = Number.isFinite(funding) && Math.abs(funding) > 0.05 && ((isShort && funding < -0.05) || (!isShort && funding > 0.05));
        const news = (db.events || []).find((e) => {
          const it = e.intel; if (!it || it.fakeRisk === "high") return false;
          const hits = (it.affectedSymbols || []).some((s) => { const u = String(s).toUpperCase(); return u.includes(base) || base.includes(u); });
          const against = isShort ? it.sentiment === "利多" : it.sentiment === "利空";
          return hits && against && /即时|数小时/.test(it.impactHorizon || "") && (it.credibility || 0) >= 0.6;
        });
        if ((fundingAgainst || news) && !position.thesisFlaggedAt) {
          position.thesisFlaggedAt = nowIso();
          const why = [fundingAgainst ? `资金费 ${funding}% 强烈不利于当前方向(拥挤/反向挤压)` : "", news ? `反向新闻：${news.intel.oneLine || news.title}` : ""].filter(Boolean).join("；");
          raiseIncident(db, position, "high", `${position.symbol} 开仓论点可能已变化，建议复核/减仓：${why}`);
          assertActiveLease(options);
          await notifyLarkThrottled(db, `thesis:${position.id}`, 30 * 60 * 1000, { severity: "warning", title: "🔎 持仓论点复核", body: `**${position.symbol}** ${position.direction || ""} 开仓逻辑出现反向信号，建议复核是否减仓。\n${why}` });
          actions.push({ symbol: position.symbol, action: "thesis_review", why });
        }
        if (!fundingAgainst && !news) position.thesisFlaggedAt = null;
      }

      if (!position.stopLoss) {
        raiseIncident(db, position, "critical", `${position.symbol} 持仓缺少止损，必须立即补挂`);
        assertActiveLease(options);
        await notifyLarkThrottled(db, `missing_stop:${position.id}`, 30 * 60 * 1000, {
          severity: "critical",
          title: "⚠️ 持仓缺少止损",
          body: `**${position.symbol}** 当前持仓没有止损，风险敞口不受控，请立即补挂。`,
          fields: [{ label: "标记价", value: String(mark) }, { label: "方向", value: position.direction || "-" }]
        });
        actions.push({ symbol: position.symbol, action: "missing_stop_alert" });
        continue;
      }

      const isShort = position.direction === "空" || position.direction === "short";
      const entry = Number(position.entry);
      const stop = Number(position.stopLoss);
      const tp1 = Number((position.takeProfits || [])[0]);

      // TP1 触达且止损仍劣于保本 → 移动止损到保本价
      const tp1Reached = Number.isFinite(tp1) && (isShort ? mark <= tp1 : mark >= tp1);
      const stopBelowBreakeven = isShort ? stop > entry : stop < entry;
      if (tp1Reached && stopBelowBreakeven && !position.breakevenMoved) {
        assertActiveLease(options);
        const result = await moveStopTo(db, position, entry, "breakeven", stopAction);
        if (moveStopSucceeded(result)) {
          position.stopLoss = entry;
          position.breakevenMoved = true;
          appendAudit(db, `TP1 触达，止损已移动到保本 ${entry}`, position.id, "PositionManager");
          appendTrace(db, "position_manager", `${position.symbol} 止损移动到保本`, "ok");
          assertActiveLease(options);
          await notifyLarkThrottled(db, `breakeven:${position.id}`, 60 * 60 * 1000, {
            severity: "success",
            title: "✅ 已移动止损到保本",
            body: `**${position.symbol}** 触达 TP1，止损已上移到保本价，本单已无亏损风险。`,
            fields: [{ label: "保本价", value: String(entry) }, { label: "标记价", value: String(mark) }]
          });
          actions.push({ symbol: position.symbol, action: "breakeven_moved" });
        } else {
          // 未真正移动:绝不回写本地止损、绝不标 breakevenMoved、绝不谎报"已保本"。
          const blocked = result.status === "blocked"; // blocked=实盘关/闸拦(预期);其余=尝试了但交易所侧没移动(真实保护缺口)
          appendAudit(db, `止损未能移动到保本 ${entry}（${result.status}${result.reason ? `：${result.reason}` : ""}）——本地止损保持原值，交易所侧保护未更新`, position.id, "PositionManager", "warning");
          if (!blocked) {
            // 交易所侧确实没移动止损(如 OKX 附加止损不支持改单),用户可能误以为已保本 → 明确告警 + 建单,提示手动处理。
            raiseIncident(db, position, "high", `${position.symbol} TP1 触达但止损无法移动到保本(${result.status})，交易所侧保护未更新，需手动处理`);
            assertActiveLease(options);
            await notifyLarkThrottled(db, `breakeven_fail:${position.id}`, 60 * 60 * 1000, {
              severity: "warning",
              title: "⚠ 止损未能自动移到保本(需手动)",
              body: `**${position.symbol}** 触达 TP1，但系统未能在交易所把止损移到保本（${result.status}）。本单仍按原止损运行、并未保本，请手动处理。`,
              fields: [{ label: "建议保本价", value: String(entry) }, { label: "原止损", value: String(position.stopLoss) }, { label: "原因", value: String(result.status) }]
            });
          }
          actions.push({ symbol: position.symbol, action: "breakeven_recommended", reason: result.status });
        }
      }

      // 跟踪止损:盈利达激活阈值(默认 1.5%)即启动,不必等 TP1(freqtrade trailing_stop_positive)。
      // 之后随盈利推进只进不退;stillProfitable 保证永不把止损移进亏损区,只锁真实利润。
      const profitPct = entry > 0 ? (isShort ? (entry - mark) / entry : (mark - entry) / entry) : 0;
      if (position.breakevenMoved || position.trailingActive || profitPct >= trailActivatePct()) {
        const tp = trailPct();
        const trailStop = isShort ? mark * (1 + tp) : mark * (1 - tp);
        const improves = isShort ? trailStop < Number(position.stopLoss) : trailStop > Number(position.stopLoss);
        const stillProfitable = isShort ? trailStop < entry : trailStop > entry;
        if (improves && stillProfitable) {
          const rounded = Number(trailStop.toFixed(mark > 1000 ? 1 : mark > 1 ? 3 : 5));
          assertActiveLease(options);
          const result = await moveStopTo(db, position, rounded, "trailing", stopAction);
          if (moveStopSucceeded(result)) {
            position.stopLoss = rounded;
            position.trailingActive = true;
            appendAudit(db, `跟踪止损上移到 ${rounded}`, position.id, "PositionManager");
            appendTrace(db, "position_manager", `${position.symbol} 跟踪止损 ${rounded}`, "ok");
            actions.push({ symbol: position.symbol, action: "trailing_moved", stop: rounded });
          } else {
            // 未真正移动(含 OKX 降级/拒单):绝不回写本地止损、绝不标 trailingActive,否则本地会记一个交易所上不存在的止损。
            appendTrace(db, "position_manager", `${position.symbol} 跟踪止损未生效（${result.status}）——保持原止损`, result.status === "blocked" ? "ok" : "warning");
            actions.push({ symbol: position.symbol, action: "trailing_recommended", stop: rounded, reason: result.status });
          }
        }
      }

      // 临近止盈保护(收紧止损锁利):价格曾逼近止盈(峰值进度≥trigger)后回吐,把止损上移锁住大部分已实现进度。
      // 只收紧、绝不主动平仓;与追踪止损互补——追踪按"当前价 1.2% 距离",这里按"距 TP 的峰值进度"锁得更靠前,
      // 专治"差一点到止盈又反向跑回来"。所有写操作仍经 moveStopTo → tradeActions 安全闸(reduceOnly)。
      if (Number.isFinite(tp1) && tp1 !== entry) {
        const tpProgress = isShort ? (entry - mark) / (entry - tp1) : (mark - entry) / (tp1 - entry);
        position.peakTpProgress = Math.max(Number(position.peakTpProgress || 0), tpProgress);
        const trigger = Math.min(0.99, Math.max(0.5, Number(process.env.NEAR_TP_TRIGGER || 0.9)));       // 峰值进度达此(默认 90%)才武装
        const giveback = Math.max(0.02, Number(process.env.NEAR_TP_GIVEBACK || 0.2));                    // 从峰值回吐此比例(默认 20% 进度)才动作
        const lockFraction = Math.min(0.95, Math.max(0.1, Number(process.env.NEAR_TP_LOCK_FRACTION || 0.55))); // 锁住峰值进度的此比例(默认 55%)
        if (position.peakTpProgress >= trigger && tpProgress > 0 && tpProgress <= position.peakTpProgress - giveback) {
          const lockProgress = lockFraction * position.peakTpProgress;
          const lockStop = entry + (isShort ? -1 : 1) * lockProgress * Math.abs(tp1 - entry);
          const improves = isShort ? lockStop < Number(position.stopLoss) : lockStop > Number(position.stopLoss);
          const stillProfitable = isShort ? lockStop < entry : lockStop > entry;
          if (improves && stillProfitable) {
            const rounded = Number(lockStop.toFixed(mark > 1000 ? 1 : mark > 1 ? 3 : 5));
            assertActiveLease(options);
            const result = await moveStopTo(db, position, rounded, "near_tp_protect", stopAction);
            if (moveStopSucceeded(result)) {
              position.stopLoss = rounded;
              position.trailingActive = true;
              appendAudit(db, `临近止盈回吐(峰值进度 ${(position.peakTpProgress * 100).toFixed(0)}% → 当前 ${(tpProgress * 100).toFixed(0)}%),止损上移锁利到 ${rounded}`, position.id, "PositionManager");
              appendTrace(db, "position_manager", `${position.symbol} 临近止盈锁利 止损→${rounded}`, "ok");
              assertActiveLease(options);
              await notifyLarkThrottled(db, `near_tp:${position.id}`, 30 * 60 * 1000, {
                severity: "success",
                title: "🎯 临近止盈回吐 · 已收紧止损锁利",
                body: `**${position.symbol}** 价格曾逼近止盈(进度 ${(position.peakTpProgress * 100).toFixed(0)}%)后回落,已把止损上移到 **${rounded}** 锁住利润;继续反转则带利离场,再冲高仍能吃到止盈。`,
                fields: [{ label: "锁利止损", value: String(rounded) }, { label: "标记价", value: String(mark) }, { label: "止盈", value: String(tp1) }]
              });
              actions.push({ symbol: position.symbol, action: "near_tp_locked", stop: rounded });
            } else {
              // 未真正移动(含 OKX 附加止损不支持改单):不回写、明确告警,提示手动处理(与保本/追踪同口径)。
              appendTrace(db, "position_manager", `${position.symbol} 临近止盈锁利未生效（${result.status}）`, result.status === "blocked" ? "ok" : "warning");
              actions.push({ symbol: position.symbol, action: "near_tp_lock_recommended", stop: rounded, reason: result.status });
            }
          }
        }
      }

      // 止损距离告警：价格距止损 < 0.3% 时提示
      const stopDistancePct = Math.abs((mark - Number(position.stopLoss)) / mark) * 100;
      if (stopDistancePct < 0.3 && !position.nearStopAlerted) {
        position.nearStopAlerted = true;
        raiseIncident(db, position, "high", `${position.symbol} 价格距止损仅 ${stopDistancePct.toFixed(2)}%，可能即将触发`);
        assertActiveLease(options);
        await notifyLarkThrottled(db, `near_stop:${position.id}`, 20 * 60 * 1000, {
          severity: "warning",
          title: "🔔 价格逼近止损",
          body: `**${position.symbol}** 标记价距止损仅 ${stopDistancePct.toFixed(2)}%，可能即将触发止损离场。`,
          fields: [{ label: "标记价", value: String(mark) }, { label: "止损", value: String(position.stopLoss) }]
        });
        actions.push({ symbol: position.symbol, action: "near_stop_alert" });
      }
      if (stopDistancePct >= 0.5) position.nearStopAlerted = false;

      position.monitoredAt = nowIso();
    } catch (error) {
      if (isLeaseLostError(error)) throw error;
      actions.push({ symbol: position.symbol, action: "monitor_error", error: error.message });
    }
  }

  assertActiveLease(options);
  const posterResult = await publishProfitablePositionPosters(db);
  assertActiveLease(options);
  actions.push(...posterResult.actions);

  // 仓位退出后自动关闭该仓位曾触发的动态风险事件，避免历史告警继续污染 AI 判断。
  reconcileRiskIncidentLifecycle(db);

  return { monitored: managed.length, actions };
}

function ensureEmergencyExecution(db, position, existing, direction, emergencyActionId) {
  if (existing) return existing;
  const stableId = `exec_${String(emergencyActionId).replace(/[^a-zA-Z0-9]/g, "").slice(-28)}`;
  const found = (db.executionOrders || []).find((row) => row.id === stableId);
  if (found) return found;
  const quantity = Number(position.coinSize ?? position.quantity ?? position.size);
  const execution = {
    id: stableId,
    exchange: "OKX",
    accountId: position.accountId || null,
    apiKeyFingerprint: position.apiKeyFingerprint || null,
    symbol: position.symbol,
    direction,
    quantity: Number.isFinite(quantity) ? quantity : null,
    filledQuantity: Number.isFinite(quantity) ? quantity : null,
    okxCtVal: position.contractMultiplier || null,
    status: "entry_filled",
    syntheticEmergency: true,
    events: [{ at: nowIso(), event: "synthetic_emergency_execution_created", detail: emergencyActionId }],
    createdAt: nowIso()
  };
  db.executionOrders ||= [];
  db.executionOrders.unshift(execution);
  position.executionOrderId = execution.id;
  return execution;
}

function updateExcursion(db, position, mark) {
  const entry = Number(position.entry);
  const size = Number(position.size);
  if (!Number.isFinite(entry) || !Number.isFinite(size)) return;
  const isShort = position.direction === "空" || position.direction === "short";
  const sign = isShort ? -1 : 1;
  const unrealized = Number(((Number(mark) - entry) * size * sign).toFixed(2));
  // 记录极值的同时留下【时间戳与价格】,供平仓复盘重建"何时冲到最高浮盈/最深浮亏"的轨迹(#4)。
  if (unrealized > Number(position.mfeUsdt || 0)) {
    position.mfeUsdt = unrealized; position.mfeAt = nowIso(); position.mfePrice = Number(mark);
  } else if (position.mfeUsdt == null) {
    position.mfeUsdt = 0;
  }
  if (unrealized < Number(position.maeUsdt || 0)) {
    position.maeUsdt = unrealized; position.maeAt = nowIso(); position.maePrice = Number(mark);
  } else if (position.maeUsdt == null) {
    position.maeUsdt = 0;
  }
  const executionOrder = (db.executionOrders || []).find((item) => item.id === position.executionOrderId);
  if (executionOrder) {
    executionOrder.lastMark = Number(mark);
    executionOrder.maeUsdt = Math.min(Number(executionOrder.maeUsdt || 0), position.maeUsdt);
    executionOrder.mfeUsdt = Math.max(Number(executionOrder.mfeUsdt || 0), position.mfeUsdt);
    if (position.mfeAt) executionOrder.mfeAt = position.mfeAt;
    if (position.maeAt) executionOrder.maeAt = position.maeAt;
    if (position.mfePrice != null) executionOrder.mfePrice = position.mfePrice;
    if (position.maePrice != null) executionOrder.maePrice = position.maePrice;
  }
}

function raiseIncident(db, position, severity, title) {
  const existing = (db.riskIncidents || []).find((item) => item.status === "open" && item.title === title);
  if (existing) return;
  db.riskIncidents.unshift({
    id: id("incident"),
    severity,
    status: "open",
    title,
    source: position.id,
    tenantId: position.tenantId || db.user?.tenantId || "tenant_owner",
    ownerUserId: position.ownerUserId || db.user?.id || null,
    createdAt: nowIso()
  });
  refreshOwnerImprovementRegistry(db);
  appendAudit(db, title, position.id, "PositionManager", severity === "critical" ? "critical" : "warning");
}
