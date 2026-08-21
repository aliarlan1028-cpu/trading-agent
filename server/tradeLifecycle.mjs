import { recordedFeeCost } from "./financialValues.mjs";

function finite(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

export function tradeLifecycleKey(fill = {}) {
  return String(fill.executionOrderId || fill.tradePlanId || fill.planId || fill.positionId || fill.id || "");
}

function identityValues(row = {}, fields = []) {
  return fields.map((field) => row?.[field]).filter((value) => value !== null && value !== undefined && value !== "").map(String);
}

// 生命周期关联必须只比较双方都真实存在的键。不能让 undefined === undefined
// 把两个旧计划的 entry/close 串成同一笔交易；高优先级键双方都有但不相等时也不得降级碰撞。
export function sameTradeLifecycle(left = {}, right = {}) {
  for (const fields of [["executionOrderId"], ["tradePlanId", "planId"], ["positionId"]]) {
    const leftValues = identityValues(left, fields);
    const rightValues = identityValues(right, fields);
    if (!leftValues.length || !rightValues.length) continue;
    return leftValues.some((value) => rightValues.includes(value));
  }
  return false;
}

export function findTradeEntryFill(fills = [], reference = {}) {
  return (fills || []).find((fill) => fill?.kind === "entry" && sameTradeLifecycle(fill, reference)) || null;
}

// 生命周期消费者统一通过执行单解析计划。历史成交常只有 executionOrderId，
// 不能把执行单 ID 当计划 ID，也不能让各模块复制不同的 OR 规则。
export function resolveTradeContext(db = {}, source = {}) {
  const fill = source?.representative || source || {};
  const executionOrderId = fill.executionOrderId === null || fill.executionOrderId === undefined || fill.executionOrderId === ""
    ? null : String(fill.executionOrderId);
  const executionOrder = executionOrderId
    ? (db.executionOrders || []).find((row) => String(row?.id || "") === executionOrderId) || null
    : null;
  const rawPlanId = fill.tradePlanId || fill.planId || executionOrder?.planId || null;
  const planId = rawPlanId === null || rawPlanId === undefined || rawPlanId === "" ? null : String(rawPlanId);
  const plan = planId
    ? (db.tradePlans || []).find((row) => String(row?.id || "") === planId) || null
    : null;
  return { fill, executionOrder, plan, executionOrderId, planId };
}

export function groupClosedTradeLifecycles(fills = [], options = {}) {
  const onlyUnreflected = options.onlyUnreflected === true;
  const groups = new Map();
  const entryCostsByKey = new Map();
  for (const fill of fills || []) {
    if (fill?.kind !== "entry") continue;
    const key = tradeLifecycleKey(fill);
    if (!key) continue;
    const current = entryCostsByKey.get(key) || { count: 0, feeUsdt: 0, complete: true };
    current.count += 1;
    const feeCost = recordedFeeCost(fill);
    if (feeCost !== null) current.feeUsdt += feeCost;
    else current.complete = false;
    if (fill.estimatedFee === true) current.complete = false;
    entryCostsByKey.set(key, current);
  }
  for (const fill of fills || []) {
    if (fill?.kind !== "close" || !finite(fill.realizedPnl)) continue;
    if (onlyUnreflected && fill.reflectedAt) continue;
    const key = tradeLifecycleKey(fill);
    if (!key) continue;
    const current = groups.get(key) || {
      key,
      fills: [],
      realizedPnl: 0,
      feeUsdt: 0,
      fundingFeeUsdt: 0,
      notionalUsdt: 0,
      quantity: 0,
      firstClosedAt: null,
      lastClosedAt: null,
      financialBasisComplete: true,
      financialBasisIssues: []
    };
    current.fills.push(fill);
    current.realizedPnl += Number(fill.realizedPnl);
    const feeCost = recordedFeeCost(fill);
    if (feeCost !== null) current.feeUsdt += feeCost;
    else {
      current.financialBasisComplete = false;
      current.financialBasisIssues.push("close_fee_unreconciled");
    }
    if (fill.estimatedFee === true) {
      current.financialBasisComplete = false;
      current.financialBasisIssues.push("estimated_fee_unreconciled");
    }
    if (finite(fill.fundingFeeUsdt)) current.fundingFeeUsdt += Number(fill.fundingFeeUsdt);
    if (fill.fundingReconciled !== true || !finite(fill.fundingFeeUsdt)) {
      current.financialBasisComplete = false;
      current.financialBasisIssues.push("funding_unreconciled");
    }
    if (finite(fill.notionalUsdt)) current.notionalUsdt += Math.abs(Number(fill.notionalUsdt));
    if (finite(fill.quantity ?? fill.size)) current.quantity += Number(fill.quantity ?? fill.size);
    const at = fill.createdAt || fill.closedAt || null;
    if (at && (!current.firstClosedAt || new Date(at) < new Date(current.firstClosedAt))) current.firstClosedAt = at;
    if (at && (!current.lastClosedAt || new Date(at) > new Date(current.lastClosedAt))) current.lastClosedAt = at;
    groups.set(key, current);
  }
  return [...groups.values()].filter((group) => options.completedOnly === false || group.fills.some((fill) => fill.partial !== true)).map((group) => {
    const representative = group.fills.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || {};
    const entryCosts = entryCostsByKey.get(group.key) || { count: 0, feeUsdt: 0, complete: false };
    if (!entryCosts.count || !entryCosts.complete) {
      group.financialBasisComplete = false;
      group.financialBasisIssues.push(entryCosts.count ? "entry_fee_unreconciled" : "entry_fill_unavailable");
    }
    group.financialBasisIssues = [...new Set(group.financialBasisIssues)];
    const entryFeeUsdt = entryCosts.feeUsdt;
    const netRealizedPnl = group.financialBasisComplete
      ? group.realizedPnl - group.feeUsdt - entryFeeUsdt + group.fundingFeeUsdt
      : null;
    return {
      ...group,
      // realizedPnl 是交易所价格盈亏；绩效、连亏保护和复盘应按记录成本后的
      // 实得结果判断。费用仍单列保留，避免 UI 看不到成本。
      entryFeeUsdt: Number(entryFeeUsdt.toFixed(8)),
      netRealizedPnl: netRealizedPnl === null ? null : Number(netRealizedPnl.toFixed(8)),
      financialBasis: group.financialBasisComplete ? "recorded_costs" : group.financialBasisIssues.join("+") || "financial_basis_unreconciled",
      representative: {
        ...representative,
        realizedPnl: Number(group.realizedPnl.toFixed(8)),
        netRealizedPnl: netRealizedPnl === null ? null : Number(netRealizedPnl.toFixed(8)),
        financialBasis: group.financialBasisComplete ? "recorded_costs" : group.financialBasisIssues.join("+") || "financial_basis_unreconciled",
        entryFeeUsdt: Number(entryFeeUsdt.toFixed(8)),
        feeUsdt: Number(group.feeUsdt.toFixed(8)),
        fundingFeeUsdt: Number(group.fundingFeeUsdt.toFixed(8)),
        notionalUsdt: Number(group.notionalUsdt.toFixed(8)),
        quantity: Number(group.quantity.toFixed(8)),
        createdAt: group.lastClosedAt || representative.createdAt
      }
    };
  }).sort((a, b) => new Date(b.lastClosedAt || 0) - new Date(a.lastClosedAt || 0));
}

export function isFinanciallyReconciledLifecycle(lifecycle = {}) {
  return lifecycle.financialBasisComplete !== false
    && lifecycle.netRealizedPnl !== null
    && lifecycle.netRealizedPnl !== undefined
    && lifecycle.netRealizedPnl !== ""
    && Number.isFinite(Number(lifecycle.netRealizedPnl));
}
