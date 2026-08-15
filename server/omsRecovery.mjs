import { okxContractSpec, okxSignedRequest, toOkxSymbol } from "./exchangeConnector.mjs";
import { normalizeExchangeOrderState } from "./exchangeContract.mjs";
import { appendAudit, appendTrace, listOmsOrdersByState, nowIso, saveDb, transitionOmsOrder } from "./store.mjs";
import { closeExecution, reconcileExecutionOrderState } from "./executionEngine.mjs";
import { setReduceOnlyReason } from "./reduceOnlyState.mjs";
import { assertActiveLease, isLeaseLostError } from "./leaseSafety.mjs";

export async function recoverUncertainOrders(db, options = {}) {
  const minAgeMs = Number(options.minAgeMs || 30_000);
  const candidates = listOmsOrdersByState(["UNKNOWN", "SUBMITTING", "ACKNOWLEDGED"], options.limit || 100)
    .filter((order) => ["UNKNOWN", "SUBMITTING"].includes(String(order.state).toUpperCase()) || order.action === "amend_order")
    .filter((order) => Date.now() - new Date(order.updatedAt || order.createdAt).getTime() >= minAgeMs);
  const results = [];
  for (const order of candidates) {
    try {
      options.assertLease?.();
      const recoveredIntent = restoreExecutionIntentFromOms(db, order);
      if (recoveredIntent) saveDb(db);
      const remote = await (options.queryRemoteOrder || queryRemoteOrder)(order);
      options.assertLease?.();
      if (!remote) {
        results.push({ id: order.id, status: "not_found_keep_unknown" });
        continue;
      }
      if (order.action === "amend_order") {
        const amend = reconcileAmendOmsOrder(db, order, remote, options);
        options.assertLease?.();
        if (amend.changed) saveDb(db);
        results.push({ id: order.id, status: amend.status, compensation: amend });
        continue;
      }
      const state = normalizeExchangeOrderState(order.exchange, remote.state);
      transitionOmsOrder(order.id, state, {
        eventType: "oms_reconciled",
        exchangeOrderId: remote.exchangeOrderId,
        response: remote
      });
      const compensation = order.action === "place_order"
        ? await compensateRecoveredEntry(db, order, remote, state, options)
        : settleRecoveredExitIntent(db, order, state, remote);
      options.assertLease?.();
      if (recoveredIntent || compensation) saveDb(db);
      results.push({ id: order.id, status: state, compensation });
    } catch (error) {
      if (isLeaseLostError(error)) throw error;
      results.push({ id: order.id, status: "query_failed", error: error.message });
    }
  }
  if (candidates.length) appendTrace(db, "oms_recovery", `恢复检查 ${candidates.length} 单`, results.some((item) => item.status === "query_failed") ? "warning" : "ok", 0);
  return { checked: candidates.length, results };
}

function finiteTarget(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function targetMatches(expected, actual) {
  if (expected === null) return true;
  if (actual === null) return false;
  const tolerance = Math.max(1e-10, Math.abs(expected) * 1e-9);
  return Math.abs(expected - actual) <= tolerance;
}

export function reconcileAmendOmsOrder(db, order, remote, options = {}) {
  const request = order.request || {};
  const response = order.response || {};
  const expectedReqId = response.reqId || request.amendRequestId || request.actionAttemptId || null;
  const remoteReqId = remote.reqId || null;
  const desiredContracts = finiteTarget(request.preparedAmendContracts ?? response.desiredContracts);
  const desiredPrice = finiteTarget(request.preparedAmendPrice ?? response.desiredPrice);
  const actualContracts = finiteTarget(remote.contracts ?? remote.size);
  const actualPrice = finiteTarget(remote.price);
  const amendResult = remote.amendResult === null || remote.amendResult === undefined ? "" : String(remote.amendResult);
  const reqIdMatches = !expectedReqId || (remoteReqId && String(expectedReqId) === String(remoteReqId));
  const targetsMatch = targetMatches(desiredContracts, actualContracts) && targetMatches(desiredPrice, actualPrice);
  let nextState = null;
  let status = "amend_pending";
  let reason = null;
  if (["-1", "1"].includes(amendResult) && reqIdMatches) {
    nextState = "REJECTED";
    status = "amend_failed";
    reason = amendResult === "1" ? "amend_auto_canceled" : "amend_rejected_async";
  } else if (amendResult === "0" && reqIdMatches && targetsMatch) {
    nextState = "AMENDED";
    status = "amended";
  } else if (amendResult === "0" && (!reqIdMatches || !targetsMatch)) {
    nextState = "UNKNOWN";
    status = "amend_target_unconfirmed";
    reason = !reqIdMatches ? "amend_req_id_mismatch" : "amend_target_not_applied";
  } else {
    const timeoutMs = Number(options.amendTimeoutMs ?? process.env.OKX_AMEND_CONFIRM_TIMEOUT_MS ?? 60_000);
    const ageMs = Date.now() - new Date(order.updatedAt || order.createdAt || 0).getTime();
    if (ageMs >= timeoutMs) {
      nextState = "UNKNOWN";
      status = "amend_unknown";
      reason = "amend_confirmation_timeout";
    }
  }
  if (nextState) {
    transitionOmsOrder(order.id, nextState, {
      eventType: nextState === "AMENDED" ? "amend_confirmed" : nextState === "REJECTED" ? "amend_failed" : "amend_unconfirmed",
      exchangeOrderId: remote.exchangeOrderId || order.exchangeOrderId || null,
      response: { status, reason, reqId: remoteReqId, amendResult, contracts: actualContracts, price: actualPrice, desiredContracts, desiredPrice }
    });
  }
  const history = (db.orders || []).find((row) => row.omsOrderId === order.id || (row.type === "amend_order" && expectedReqId && row.amendRequestId === expectedReqId));
  if (history) {
    history.status = status;
    history.amendResult = amendResult || null;
    history.amendConfirmedAt = nextState ? nowIso() : history.amendConfirmedAt || null;
    history.amendFailureReason = reason;
  }
  if (["UNKNOWN", "REJECTED"].includes(nextState)) {
    db.system ||= {};
    db.system.reduceOnlyMode = true;
    db.system.reduceOnlyBy ||= "amend_reconciliation_pending";
    setReduceOnlyReason(db, "amend_reconciliation_pending", { sticky: false, sourceId: order.id });
  }
  return { status, changed: Boolean(nextState || history), nextState, reason, targetsMatch, reqIdMatches };
}

function executionForOmsRequest(db, order) {
  const request = order.request || {};
  return (db.executionOrders || []).find((row) => row.id === request.executionOrderId)
    || (db.executionOrders || []).find((row) => row.planId && row.planId === (request.tradePlanId || request.planId || order.planId))
    || null;
}

function restoreExecutionIntentFromOms(db, order) {
  if (!["close_position", "cancel_order"].includes(order.action)) return null;
  const execution = executionForOmsRequest(db, order);
  if (!execution) return null;
  const request = order.request || {};
  execution.events ||= [];
  if (order.action === "close_position") {
    execution.accountId ||= request.accountId || null;
    execution.closeClientOrderId ||= request.clientOrderId || null;
    execution.closeOmsOrderId ||= order.id;
    execution.closeExchangeOrderId ||= order.exchangeOrderId || null;
    execution.closeAttemptedAt ||= order.createdAt;
    execution.closeSubmittedAt ||= execution.closeAttemptedAt;
    execution.closeReconciliationSource ||= "manual_close";
    execution.closeReason ||= request.reason || request.exitIntent || "oms_recovery";
    if (!["closed", "group_closed"].includes(execution.status)) execution.status = "close_unknown_pending";
  } else {
    execution.cancelAttemptedAt ||= order.createdAt;
    execution.cancelSubmittedAt ||= execution.cancelAttemptedAt;
    execution.cancelDisposition ||= request.cancelDisposition || request.exitIntent || "cancel_entry";
    execution.cancelReason ||= request.cancelReason || request.reason || "oms_recovery";
    execution.cancelOmsOrderId ||= order.id;
    if (!["cancelled", "closed", "group_closed"].includes(execution.status)) {
      execution.status = execution.cancelDisposition === "emergency_close_if_filled" && request.protectionFailure
        ? "protection_failure_cancel_pending" : "cancel_unknown_pending";
    }
  }
  if (!execution.events.some((event) => event.event === "oms_intent_restored" && event.detail === order.id)) {
    execution.events.push({ at: nowIso(), event: "oms_intent_restored", detail: order.id });
  }
  db.system ||= {};
  db.system.reduceOnlyMode = true;
  db.system.reduceOnlyBy ||= "oms_recovery";
  setReduceOnlyReason(db, "oms_recovery", { sticky: false, sourceId: order.id });
  return execution;
}

function settleRecoveredExitIntent(db, order, state, remote) {
  const execution = executionForOmsRequest(db, order);
  if (!execution) return { status: "execution_not_found" };
  if (order.action === "cancel_order") {
    // queryRemoteOrder 查询的是原入场单：无论 canceled/partial/filled，都交给 execution poll
    // 依据真实累计成交量分流，恢复器不在这里猜测终态或数量。
    execution.status = execution.status === "protection_failure_cancel_pending" ? execution.status : "cancel_pending";
    execution.events.push({ at: nowIso(), event: "cancel_oms_recovered", detail: state });
    return { status: execution.status, remoteState: state };
  }
  if (order.action === "close_position") {
    execution.closeExchangeOrderId ||= remote.exchangeOrderId || null;
    execution.status = state === "FILLED" ? "close_reconciliation_pending" : "close_pending";
    execution.closeReconciliationSource ||= "manual_close";
    execution.events.push({ at: nowIso(), event: "close_oms_recovered", detail: state });
    return { status: execution.status, remoteState: state };
  }
  return null;
}

async function compensateRecoveredEntry(db, order, remote, state, options = {}) {
  const request = order.request || {};
  const execution = (db.executionOrders || []).find((item) => item.planId === order.planId || item.clientOrderId === request.clientOrderId);
  const plan = (db.tradePlans || []).find((item) => item.id === order.planId);
  if (!execution) return { status: "execution_not_found_no_external_action" };
  execution.events ||= [];
  execution.omsOrderId ||= order.id;
  execution.exchangeOrderId ||= remote.exchangeOrderId || null;
  execution.clientOrderId ||= request.clientOrderId || null;
  if (["closed", "cancelled", "group_closed", "failed", "protection_failed"].includes(execution.status)) {
    execution.events.push({ at: nowIso(), event: "stale_entry_oms_reconciled_without_action", detail: `${order.id}:${state}` });
    return { status: "terminal_execution_unchanged", executionStatus: execution.status };
  }
  if (["CANCELLED", "REJECTED"].includes(state)) {
    execution.status = `recovered_${state.toLowerCase()}`;
    if (plan) plan.status = state === "REJECTED" ? "failed" : "cancelled";
    return { status: "no_exposure", remoteState: state };
  }
  if (!["ACKNOWLEDGED", "PARTIAL", "FILLED"].includes(state)) {
    return { status: "kept_unknown", remoteState: state };
  }
  const ctVal = Number(execution.okxCtVal || remote.okxCtVal);
  if (!(ctVal > 0)) {
    execution.status = "entry_unknown_pending";
    db.system.reduceOnlyMode = true;
    db.system.reduceOnlyBy ||= "oms_recovery";
    setReduceOnlyReason(db, "oms_recovery", { sticky: false, sourceId: order.id });
    return { status: "contract_spec_pending_no_external_action" };
  }
  execution.okxCtVal = ctVal;
  execution.status = ["entry_unknown_pending", "created", "UNKNOWN"].includes(execution.status) ? "entry_unknown_pending" : execution.status;
  if (["PARTIAL", "FILLED"].includes(state)) {
    await reconcileExecutionOrderState(db, execution.id, {
      state: state === "PARTIAL" ? "partial" : "filled",
      filledContracts: remote.filledContracts,
      filledCoinQuantity: remote.filledCoinQuantity,
      avgPrice: remote.avgPrice
    }, { placeTakeProfits: async () => null, verifyEntryProtection: options.verifyEntryProtection, executeTradeAction: options.executeTradeAction });
  }
  const currentStatus = execution.status;
  const intent = ["entry_unknown_pending", "entry_pending", "entry_partial"].includes(currentStatus)
    ? "emergency_close_if_filled" : ["entry_filled", "protecting"].includes(currentStatus) ? "close_position" : null;
  if (!intent) return { status: "state_reconciled_without_exit", executionStatus: currentStatus };
  assertActiveLease(options);
  const exit = await closeExecution(db, execution.id, "oms_unknown_recovery", {
    intent,
    expectedStatus: currentStatus,
    internal: true,
    executeTradeAction: options.executeTradeAction,
    assertLease: options.assertLease,
    signal: options.signal,
    emergencyActionId: `emergency_oms_recovery_${String(execution.id).replace(/[^a-zA-Z0-9]/g, "").slice(-18)}`
  });
  if (plan) {
    plan.status = "recovery_pending_reconciliation";
    plan.failedReason = "UNKNOWN 入场正在通过标准退出状态机撤单/平仓并核算";
  }
  db.system.reduceOnlyMode = true;
  db.system.reduceOnlyBy = "oms_recovery";
  setReduceOnlyReason(db, "oms_recovery", { sticky: false, sourceId: order.id });
  db.system.riskStatus = "只减仓";
  appendAudit(db, "UNKNOWN 入场已交由标准退出状态机处理，等待真实终态", order.id, "OmsRecovery", "critical");
  return { status: exit.status, exit };
}

async function queryRemoteOrder(order) {
  const request = order.request || {};
  // 非 place 动作的预留键是「动作:原键」派生键，交易所侧要用请求载荷里的原始 clientOrderId 查询。
  const clOrdId = request.clientOrderId || order.clientOrderId;
  if (order.exchange !== "OKX" || !process.env.OKX_API_KEY) return null;
  const instId = toOkxSymbol(request.symbol, request.marketType || "perpetual");
  const orderId = request.authoritativeOrderId || request.orderId || order.exchangeOrderId || null;
  const identityQuery = orderId ? `ordId=${encodeURIComponent(orderId)}` : `clOrdId=${encodeURIComponent(clOrdId)}`;
  const raw = await okxSignedRequest(`/api/v5/trade/order?instId=${encodeURIComponent(instId)}&${identityQuery}`, "GET");
  const item = raw.data?.[0];
  if (!item) return null;
  const spec = await okxContractSpec(instId);
  const filledContracts = Number(item.accFillSz || 0);
  return {
    state: item.state,
    exchangeOrderId: item.ordId,
    filledContracts,
    filledCoinQuantity: spec?.ctVal ? filledContracts * Number(spec.ctVal) : null,
    avgPrice: Number(item.avgPx || 0),
    okxCtVal: spec?.ctVal || null,
    contracts: finiteTarget(item.sz),
    price: finiteTarget(item.px),
    reqId: item.reqId || null,
    amendResult: item.amendResult ?? null,
    updatedAt: item.uTime ? new Date(Number(item.uTime)).toISOString() : null
  };
}
