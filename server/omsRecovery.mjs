import { okxSignedRequest, toOkxSymbol } from "./exchangeConnector.mjs";
import { normalizeExchangeOrderState } from "./exchangeContract.mjs";
import { executeTradeAction } from "./tradeActions.mjs";
import { applyOperationalDegradation } from "./professionalRiskGate.mjs";
import { appendAudit, appendTrace, id, listOmsOrdersByState, nowIso, transitionOmsOrder } from "./store.mjs";

export async function recoverUncertainOrders(db, options = {}) {
  const minAgeMs = Number(options.minAgeMs || 30_000);
  const candidates = listOmsOrdersByState(["UNKNOWN", "SUBMITTING"], options.limit || 50)
    .filter((order) => Date.now() - new Date(order.updatedAt || order.createdAt).getTime() >= minAgeMs);
  const results = [];
  for (const order of candidates) {
    try {
      const remote = await queryRemoteOrder(order);
      if (!remote) {
        results.push({ id: order.id, status: "not_found_keep_unknown" });
        continue;
      }
      const state = normalizeExchangeOrderState(order.exchange, remote.state);
      transitionOmsOrder(order.id, state, {
        eventType: "oms_reconciled",
        exchangeOrderId: remote.exchangeOrderId,
        response: remote
      });
      const compensation = order.action === "place_order"
        ? await compensateRecoveredEntry(db, order, remote, state)
        : null;
      results.push({ id: order.id, status: state, compensation });
    } catch (error) {
      results.push({ id: order.id, status: "query_failed", error: error.message });
    }
  }
  if (candidates.length) appendTrace(db, "oms_recovery", `恢复检查 ${candidates.length} 单`, results.some((item) => item.status === "query_failed") ? "warning" : "ok", 0);
  return { checked: candidates.length, results };
}

// 对“请求超时但交易所可能已接单”的新开仓，恢复任务不能只改 OMS 标签后继续运行。
// 保守策略：挂单先撤；部分成交先撤余量再整仓平；已成交直接整仓平。所有补偿均走独立
// EmergencyAction 来源链，完成后仍等待下一轮账户快照/对账确认，期间专业风险闸保持只减仓。
async function compensateRecoveredEntry(db, order, remote, state) {
  const request = order.request || {};
  const execution = (db.executionOrders || []).find((item) => item.planId === order.planId || item.clientOrderId === request.clientOrderId);
  const plan = (db.tradePlans || []).find((item) => item.id === order.planId);
  if (execution) {
    execution.status = "UNKNOWN";
    execution.events ||= [];
    execution.events.push({ at: nowIso(), event: "oms_recovered", detail: `交易所状态 ${state}，启动自动风险补偿` });
  }
  applyOperationalDegradation(db, "OmsRecovery");

  if (["CANCELLED", "REJECTED"].includes(state)) {
    if (execution) execution.status = `recovered_${state.toLowerCase()}`;
    if (plan) plan.status = state === "REJECTED" ? "failed" : "cancelled";
    applyOperationalDegradation(db, "OmsRecovery");
    return { status: "no_exposure", remoteState: state };
  }
  if (!["ACKNOWLEDGED", "PARTIAL", "FILLED"].includes(state)) {
    return { status: "kept_unknown", remoteState: state };
  }

  const emergencyActionId = id("emergency");
  const base = {
    exchange: "OKX",
    marketType: request.marketType || "perpetual_usdt",
    symbol: request.symbol,
    emergencyActionId,
    reason: "oms_unknown_recovery"
  };
  let cancelResult = null;
  let closeResult = null;
  try {
    if (["ACKNOWLEDGED", "PARTIAL"].includes(state)) {
      cancelResult = await executeTradeAction(db, "cancel_order", {
        ...base,
        orderId: remote.exchangeOrderId,
        clientOrderId: request.clientOrderId
      });
      if (!["ok", "submitted", "idempotent_replay"].includes(cancelResult.status)) {
        throw new Error(`自动撤单失败:${cancelResult.status}`);
      }
    }
    if (["PARTIAL", "FILLED"].includes(state)) {
      closeResult = await executeTradeAction(db, "close_position", {
        ...base,
        closePosition: true,
        posSide: request.posSide || request.positionSide || (String(request.side).toUpperCase() === "SELL" ? "short" : "long"),
        positionSide: request.posSide || request.positionSide || (String(request.side).toUpperCase() === "SELL" ? "short" : "long")
      });
      if (!["ok", "submitted", "idempotent_replay"].includes(closeResult.status)) {
        throw new Error(`自动平仓失败:${closeResult.status}`);
      }
    }
    if (execution) {
      execution.status = "recovery_pending_reconciliation";
      execution.events.push({ at: nowIso(), event: "emergency_compensation_submitted", detail: emergencyActionId });
    }
    if (plan) {
      plan.status = "recovery_pending_reconciliation";
      plan.failedReason = "UNKNOWN 入场已自动撤单/平仓，等待账户对账确认";
    }
    appendAudit(db, "UNKNOWN 入场已提交自动撤单/平仓补偿，等待对账", order.id, "OmsRecovery", "critical");
    // 交易所 ACK 不等于账实已确认：显式锁定只减仓，只有后续成功对账才能解除。
    db.system.reduceOnlyMode = true;
    db.system.reduceOnlyBy = "oms_recovery";
    db.system.riskStatus = "只减仓";
    db.system.latestAction = "UNKNOWN 入场已自动补偿，等待 OKX 账户对账确认";
    return { status: "compensation_submitted", emergencyActionId, cancelStatus: cancelResult?.status, closeStatus: closeResult?.status };
  } catch (error) {
    transitionOmsOrder(order.id, "UNKNOWN", { eventType: "oms_compensation_failed", response: { remote, error: error.message } });
    if (execution) {
      execution.status = "UNKNOWN";
      execution.events.push({ at: nowIso(), event: "emergency_compensation_failed", detail: error.message });
    }
    db.system.killSwitch = true;
    db.system.reduceOnlyMode = true;
    db.system.reduceOnlyBy = "oms_recovery";
    db.riskIncidents ||= [];
    db.riskIncidents.unshift({ id: id("incident"), severity: "critical", status: "open", title: "UNKNOWN 订单自动补偿失败，已熔断", source: order.id, detail: error.message, createdAt: nowIso() });
    appendAudit(db, `UNKNOWN 订单自动补偿失败：${error.message}`, order.id, "OmsRecovery", "critical");
    return { status: "compensation_failed", emergencyActionId, error: error.message };
  }
}

async function queryRemoteOrder(order) {
  const request = order.request || {};
  // 非 place 动作的预留键是「动作:原键」派生键，交易所侧要用请求载荷里的原始 clientOrderId 查询。
  const clOrdId = request.clientOrderId || order.clientOrderId;
  if (order.exchange !== "OKX" || !process.env.OKX_API_KEY) return null;
  const instId = toOkxSymbol(request.symbol, request.marketType || "perpetual");
  const raw = await okxSignedRequest(`/api/v5/trade/order?instId=${encodeURIComponent(instId)}&clOrdId=${encodeURIComponent(clOrdId)}`, "GET");
  const item = raw.data?.[0];
  if (!item) return null;
  return { state: item.state, exchangeOrderId: item.ordId, filledQuantity: Number(item.accFillSz || 0), avgPrice: Number(item.avgPx || 0) };
}
