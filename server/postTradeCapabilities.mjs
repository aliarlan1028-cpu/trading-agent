import { buildExecutionQuality, buildStrategyDrift } from "./professionalAnalytics.mjs";
import { recordToolExecution } from "./toolUsage.mjs";

const MAX_SEEN_FILLS = 200;

export function recordPostTradeCapabilities(db, fill = {}) {
  if (fill.kind !== "close" || !fill.id) return { recorded: [], skipped: "not_a_closed_fill" };
  db.meta ||= {};
  db.meta.postTradeCapabilityFillIds ||= [];
  if (db.meta.postTradeCapabilityFillIds.includes(fill.id)) return { recorded: [], skipped: "already_recorded" };
  db.meta.postTradeCapabilityFillIds.unshift(fill.id);
  db.meta.postTradeCapabilityFillIds = db.meta.postTradeCapabilityFillIds.slice(0, MAX_SEEN_FILLS);

  const recorded = [];
  const executionMetrics = buildExecutionQuality(db);
  const executionResult = { status: executionMetrics.fills ? "ok" : "insufficient_sample", metrics: executionMetrics };
  recordToolExecution(db, {
    name: "execution_quality",
    args: { trigger: "closed_fill", fillId: fill.id },
    result: executionResult,
    summary: executionResult.status === "ok" ? `成交样本 ${executionMetrics.fills}，平均滑点 ${executionMetrics.avgSlippageBps ?? "-"} bps` : "成交样本不足",
    source: "system_post_trade"
  });
  recorded.push("execution_quality");

  const driftResult = buildStrategyDrift(db, { strategy: fill.strategy });
  if (driftResult.diagnosis.trades >= 20) {
    recordToolExecution(db, {
      name: "strategy_drift",
      args: { trigger: "closed_fill", fillId: fill.id, strategy: fill.strategy || null },
      result: driftResult,
      summary: driftResult.diagnosis.performanceDrift ? "检测到显著策略漂移" : `策略样本 ${driftResult.diagnosis.trades}，未检测到显著负向漂移`,
      source: "system_post_trade"
    });
    recorded.push("strategy_drift");
  }
  return { recorded, executionResult, driftResult };
}
