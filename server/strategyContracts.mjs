import { buildStrategyProductCatalog } from "./strategyProducts.mjs";
import { isFinanciallyReconciledLifecycle } from "./tradeReviewQueue.mjs";
import { groupSystemClosedTradeLifecycles } from "./systemTradeProjection.mjs";

const CONTRACT_VERSION = "1.0.0";
const VALID_DIRECTIONS = new Set(["long", "short", "both"]);
const VALID_FAMILIES = new Set(["trend", "meanrev", "event", "volatility"]);

const FAMILY_REGIMES = {
  trend: ["温和上行", "温和下行", "高波动上行", "高波动下行"],
  meanrev: ["震荡", "低波动区间"],
  volatility: ["波动率压缩", "波动率扩张", "高波动上行", "高波动下行"],
  event: ["事件前准备", "事件后确认"]
};

const FAMILY_ENTRY_MODEL = {
  trend: "趋势确认后进入，禁止在区间极值追单",
  meanrev: "仅在区间边缘等待反转确认，不把下跌本身当作做多理由",
  volatility: "波动率扩张与成交量确认后进入，失败突破立即失效",
  event: "预先登记事件窗口，事件结果与价格确认后才允许进入"
};

export function buildNativeStrategyContract(strategy = {}) {
  const family = VALID_FAMILIES.has(strategy.family) ? strategy.family : "trend";
  return {
    schema: "trading.strategy.contract",
    contractVersion: CONTRACT_VERSION,
    id: strategy.id,
    name: strategy.label,
    owner: "native_strategy_engine",
    engine: "deterministic_signal",
    exchangeScope: ["OKX"],
    marketScope: ["perpetual_usdt"],
    symbolScope: ["*/USDT"],
    timeframes: ["15m", "1h", "4h"],
    family,
    direction: strategy.direction || "long",
    regimes: FAMILY_REGIMES[family],
    entryModel: FAMILY_ENTRY_MODEL[family],
    parameters: strategy.defaultParams || {},
    dataRequirements: [
      { source: "OKX", dataset: "ohlcv", closedBarsOnly: true, required: true },
      { source: "OKX", dataset: "instrument_metadata", required: true },
      { source: "OKX", dataset: "account_and_positions", liveOnly: true, required: true }
    ],
    exitPolicy: {
      stopLossRequired: true,
      takeProfitOrTrailingRequired: true,
      liquidationBufferRequired: true,
      owner: "risk_and_execution_engine"
    },
    validationPolicy: {
      purgedWalkForwardRequired: true,
      deflatedSharpeRequired: true,
      paperForwardRequired: true,
      liveProbationRequired: true,
      minOosTrades: 8,
      minLiveJudgementTrades: 10
    },
    executionPolicy: {
      llmMayPropose: true,
      llmMayBypassContract: false,
      hardRiskGateRequired: true,
      mandateRequired: true,
      evidenceBundleRequired: true
    }
  };
}

export function validateStrategyContract(contract = {}) {
  const errors = [];
  if (contract.schema !== "trading.strategy.contract") errors.push("schema 非法");
  if (!contract.id || !/^[a-z0-9_]+$/.test(String(contract.id))) errors.push("id 缺失或格式非法");
  if (!contract.name) errors.push("name 缺失");
  if (!VALID_DIRECTIONS.has(contract.direction)) errors.push("direction 非法");
  if (!VALID_FAMILIES.has(contract.family)) errors.push("family 非法");
  if (!Array.isArray(contract.exchangeScope) || contract.exchangeScope.length !== 1 || contract.exchangeScope[0] !== "OKX") errors.push("策略必须使用 OKX 单一行情/执行口径");
  if (!Array.isArray(contract.timeframes) || !contract.timeframes.length) errors.push("timeframes 缺失");
  if (!contract.exitPolicy?.stopLossRequired) errors.push("必须声明强制止损");
  if (!contract.validationPolicy?.purgedWalkForwardRequired || !contract.validationPolicy?.paperForwardRequired) errors.push("必须经过样本外和纯前向验证");
  if (!contract.executionPolicy?.hardRiskGateRequired || !contract.executionPolicy?.mandateRequired) errors.push("必须绑定确定性风控与 Mandate");
  return { valid: errors.length === 0, errors, normalized: errors.length ? null : contract };
}

export function assertNativeStrategyContracts(strategies = []) {
  for (const strategy of strategies) {
    const checked = validateStrategyContract(buildNativeStrategyContract(strategy));
    if (!checked.valid) throw new Error(`内置策略合同 ${strategy?.id || "unknown"} 非法：${checked.errors.join("；")}`);
  }
  return true;
}

function latest(items = []) {
  return items.slice().sort((a, b) => new Date(b.updatedAt || b.gradedAt || b.chosenAt || b.createdAt || 0) - new Date(a.updatedAt || a.gradedAt || a.chosenAt || a.createdAt || 0))[0] || null;
}

function liveMetrics(db, strategyId) {
  const rows = [];
  for (const lifecycle of groupSystemClosedTradeLifecycles(db)) {
    if (!isFinanciallyReconciledLifecycle(lifecycle)) continue;
    const fill = lifecycle.representative;
    const executionOrder = (db.executionOrders || []).find((item) => item.id === fill.executionOrderId);
    const plan = (db.tradePlans || []).find((item) => item.id === (fill.tradePlanId || fill.planId || executionOrder?.planId));
    const attributed = fill.strategy || executionOrder?.strategy || plan?.strategy || plan?.strategy_type;
    if (attributed !== strategyId) continue;
    rows.push({
      grossPnl: Number(lifecycle.realizedPnl || 0),
      netPnl: Number(lifecycle.netRealizedPnl || 0),
      entryFees: Number(lifecycle.entryFeeUsdt || 0),
      closeFees: Number(lifecycle.feeUsdt || 0),
      funding: Number(lifecycle.fundingFeeUsdt || 0),
      lastAt: lifecycle.lastClosedAt || null
    });
  }
  rows.sort((a, b) => new Date(a.lastAt || 0) - new Date(b.lastAt || 0));
  const wins = rows.filter((row) => row.netPnl > 0);
  const grossWin = wins.reduce((sum, row) => sum + row.netPnl, 0);
  const grossLoss = Math.abs(rows.filter((row) => row.netPnl < 0).reduce((sum, row) => sum + row.netPnl, 0));
  let consecutiveLosses = 0;
  for (let index = rows.length - 1; index >= 0 && rows[index].netPnl < 0; index -= 1) consecutiveLosses += 1;
  const grossRealizedPnlUsdt = rows.reduce((sum, row) => sum + row.grossPnl, 0);
  const netRealizedPnlUsdt = rows.reduce((sum, row) => sum + row.netPnl, 0);
  const entryFeesUsdt = rows.reduce((sum, row) => sum + row.entryFees, 0);
  const closeFeesUsdt = rows.reduce((sum, row) => sum + row.closeFees, 0);
  const fundingUsdt = rows.reduce((sum, row) => sum + row.funding, 0);
  return {
    trades: rows.length,
    wins: wins.length,
    winRatePct: rows.length ? Number((wins.length / rows.length * 100).toFixed(1)) : null,
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : null,
    grossRealizedPnlUsdt: Number(grossRealizedPnlUsdt.toFixed(4)),
    realizedPnlUsdt: Number(netRealizedPnlUsdt.toFixed(4)),
    recordedEntryFeesUsdt: Number(entryFeesUsdt.toFixed(4)),
    recordedCloseFeesUsdt: Number(closeFeesUsdt.toFixed(4)),
    recordedFeesUsdt: Number((entryFeesUsdt + closeFeesUsdt).toFixed(4)),
    recordedFundingUsdt: Number(fundingUsdt.toFixed(4)),
    netAfterRecordedCostsUsdt: Number(netRealizedPnlUsdt.toFixed(4)),
    consecutiveLosses,
    basis: "closed_trade_lifecycle/recorded_costs"
  };
}

export function deriveStrategyLifecycle(db, strategyId) {
  const profile = latest((db.strategyProfiles || []).filter((item) => item.strategyId === strategyId));
  const paper = latest((db.paperSessions || []).filter((item) => item.strategyId === strategyId));
  const live = liveMetrics(db, strategyId);
  let stage = "draft";
  let reason = "尚未产生合格样本外画像";

  if (profile) {
    stage = profile.confidence === "validated" ? "historical_validated" : profile.confidence === "none" || profile.confidence === "low" ? "historical_rejected" : "historical_validating";
    reason = `样本外置信度 ${profile.confidence || "未知"}，期望 ${profile.oosScore ?? "—"}R`;
  }
  if (paper?.status === "running") { stage = "forward_validating"; reason = `纯前向模拟累计 ${paper.metrics?.trades || 0} 笔`; }
  if (paper?.status === "passed") { stage = "forward_validated"; reason = `纯前向模拟已通过，共 ${paper.metrics?.trades || 0} 笔`; }
  if (["failed", "rejected"].includes(paper?.status)) { stage = "degraded"; reason = "纯前向模拟未通过"; }
  const forwardValidated = paper?.status === "passed";
  if (live.trades > 0 && !forwardValidated) {
    stage = "unverified_live_sample";
    reason = `存在 ${live.trades} 笔历史真实归因，但未完成纯前向验证，不得作为晋级依据`;
  } else if (live.trades > 0 && live.trades < 10) {
    stage = "live_probation";
    reason = `真实闭环 ${live.trades}/10 笔，样本不足不晋级`;
  }
  if (live.trades >= 10 && forwardValidated) {
    const poor = (live.profitFactor !== null && live.profitFactor < 0.8) || live.consecutiveLosses >= 5;
    const good = live.netAfterRecordedCostsUsdt > 0 && (live.profitFactor === null || live.profitFactor >= 1.2) && live.consecutiveLosses < 3;
    if (poor) { stage = "degraded"; reason = `真实表现触发降级：PF ${live.profitFactor ?? "—"}，连亏 ${live.consecutiveLosses}`; }
    else if (good) { stage = "active"; reason = `真实闭环 ${live.trades} 笔且净成本后表现达标`; }
    else { stage = "live_probation"; reason = `真实闭环 ${live.trades} 笔，尚未达到转正门槛`; }
  }

  const executionEligibility = stage === "active" ? "active"
    : stage === "forward_validated" ? "eligible_for_small_live_probation"
      : stage === "live_probation" ? "probation_only"
        : stage === "degraded" || stage === "historical_rejected" || stage === "unverified_live_sample" ? "blocked"
          : "research_only";
  return { stage, reason, executionEligibility, profile, paper, live };
}

export function buildStrategyCatalog(db, strategies = []) {
  const items = strategies.map((strategy) => {
    const contract = buildNativeStrategyContract(strategy);
    const validation = validateStrategyContract(contract);
    const lifecycle = deriveStrategyLifecycle(db, strategy.id);
    return { id: strategy.id, name: strategy.label, contract, contractValid: validation.valid, contractErrors: validation.errors, lifecycle };
  });
  const productCatalog = buildStrategyProductCatalog(db);
  return {
    schema: "trading.strategy.catalog",
    generatedAt: new Date().toISOString(),
    // products 是 AI 实盘计划使用的版本化策略合同；strategies 是指标研究模型。
    // 两者刻意分开，禁止把“能回测的信号”直接冒充“已验证实盘策略”。
    products: productCatalog.products,
    productSummary: productCatalog.summary,
    strategies: items,
    summary: {
      total: items.length,
      contractValid: items.filter((item) => item.contractValid).length,
      active: items.filter((item) => item.lifecycle.stage === "active").length,
      validating: items.filter((item) => /validating|validated|probation/.test(item.lifecycle.stage)).length,
      blocked: items.filter((item) => item.lifecycle.executionEligibility === "blocked").length
    }
  };
}
