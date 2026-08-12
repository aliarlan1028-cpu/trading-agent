import { groupClosedTradeLifecycles } from "./tradeReviewQueue.mjs";

function finite(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function stats(rows) {
  const wins = rows.filter((row) => row.pnl > 0);
  const grossWin = wins.reduce((sum, row) => sum + row.pnl, 0);
  const grossLoss = Math.abs(rows.filter((row) => row.pnl < 0).reduce((sum, row) => sum + row.pnl, 0));
  let cumulative = 0, peak = 0, maxDrawdownUsdt = 0;
  for (const row of rows.slice().sort((a, b) => new Date(a.closedAt || 0) - new Date(b.closedAt || 0))) {
    cumulative += row.pnl;
    peak = Math.max(peak, cumulative);
    maxDrawdownUsdt = Math.max(maxDrawdownUsdt, peak - cumulative);
  }
  return {
    trades: rows.length,
    wins: wins.length,
    winRatePct: rows.length ? Number(((wins.length / rows.length) * 100).toFixed(1)) : null,
    pnlUsdt: Number(rows.reduce((sum, row) => sum + row.pnl, 0).toFixed(2)),
    avgPnlUsdt: rows.length ? Number((rows.reduce((sum, row) => sum + row.pnl, 0) / rows.length).toFixed(2)) : null,
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : null,
    maxDrawdownUsdt: Number(maxDrawdownUsdt.toFixed(2))
  };
}

export function buildDecisionCalibrationReport(db, options = {}) {
  const minTrades = Math.max(10, Number(options.minTrades || process.env.DECISION_CALIBRATION_MIN_TRADES || 20));
  const rows = [];
  for (const lifecycle of groupClosedTradeLifecycles(db.fills || [])) {
    const fill = lifecycle.representative;
    const plan = (db.tradePlans || []).find((item) => item.id === (fill.tradePlanId || fill.planId) || item.id === fill.executionOrderId);
    const context = plan?.decisionContext;
    if (!context?.setupType) continue;
    rows.push({
      tradeLifecycleKey: lifecycle.key,
      symbol: fill.symbol || plan.symbol || "unknown",
      timeframe: plan.timeframe || "unknown",
      regime: context.deterministicSetupSnapshot?.marketRegime?.label || fill.regime || "unknown",
      setupType: context.setupType,
      direction: plan.direction || fill.direction || "unknown",
      pnl: Number(lifecycle.realizedPnl),
      closedAt: lifecycle.lastClosedAt,
      supportingFactors: context.supportingFactors || [],
      conflictingFactors: context.conflictingFactors || []
    });
  }

  const groups = new Map();
  for (const row of rows) {
    const key = `${row.symbol}|${row.timeframe}|${row.regime}|${row.setupType}|${row.direction}`;
    const bucket = groups.get(key) || [];
    bucket.push(row);
    groups.set(key, bucket);
  }
  const segments = [...groups.entries()].map(([key, segmentRows]) => {
    const metrics = stats(segmentRows);
    const eligible = metrics.trades >= minTrades;
    const pf = metrics.profitFactor ?? (metrics.pnlUsdt > 0 ? 1.1 : 0.9);
    const winRate = metrics.winRatePct == null ? 0.5 : metrics.winRatePct / 100;
    // 只生成影子候选乘数，不接入实时方向/下单；晋升必须另走样本外验证和显式版本发布。
    const shadowMultiplier = eligible
      ? Number(Math.max(0.85, Math.min(1.15, 1 + 0.2 * (winRate - 0.5) + 0.08 * (pf - 1))).toFixed(3))
      : 1;
    return {
      key,
      symbol: segmentRows[0].symbol,
      timeframe: segmentRows[0].timeframe,
      regime: segmentRows[0].regime,
      setupType: segmentRows[0].setupType,
      direction: segmentRows[0].direction,
      ...metrics,
      status: eligible ? "eligible_for_shadow_calibration" : "collecting",
      sampleProgress: `${metrics.trades}/${minTrades}`,
      shadowMultiplier,
      appliedToLiveDecision: false
    };
  }).sort((a, b) => b.trades - a.trades || Math.abs(b.pnlUsdt) - Math.abs(a.pnlUsdt));

  const factorRows = new Map();
  for (const row of rows) {
    for (const factor of [...new Set(row.supportingFactors.map(String))]) {
      const bucket = factorRows.get(factor) || [];
      bucket.push(row);
      factorRows.set(factor, bucket);
    }
  }
  const factorAssociations = [...factorRows.entries()].map(([factor, factorTrades]) => ({
    factor,
    ...stats(factorTrades),
    attribution: "declared_association_not_causal"
  })).sort((a, b) => b.trades - a.trades).slice(0, 50);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    tradesWithDecisionContext: rows.length,
    minTradesPerSegment: minTrades,
    automaticWeightMutation: false,
    promotionPolicy: "shadow_only_until_out_of_sample_validation_and_explicit_version_release",
    segments,
    factorAssociations,
    note: "复盘只生成分场景影子乘数；不会让 LLM 或少量盈亏直接改写实盘权重。"
  };
}
