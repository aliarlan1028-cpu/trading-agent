import assert from "node:assert/strict";
import test from "node:test";
import { buildDecisionCalibrationReport } from "../server/decisionCalibration.mjs";
import { financiallyReconciledFills } from "./financial-fixtures.mjs";

function fixture(count) {
  const fills = [];
  const tradePlans = [];
  for (let index = 0; index < count; index += 1) {
    const planId = `plan-${index}`;
    tradePlans.push({
      id: planId,
      symbol: "ADA/USDT",
      timeframe: "15m",
      direction: "long",
      decisionContext: {
        setupType: "reversal_reclaim",
        supportingFactors: ["failed_breakdown_reclaim", "momentum_flip"],
        conflictingFactors: ["higher_timeframe_downtrend"],
        deterministicSetupSnapshot: { marketRegime: { label: "downtrend" } }
      }
    });
    fills.push({
      id: `fill-${index}`,
      kind: "close",
      tradePlanId: planId,
      executionOrderId: `exec-${index}`,
      symbol: "ADA/USDT",
      direction: "long",
      realizedPnl: index % 3 === 0 ? -2 : 3,
      createdAt: new Date(Date.UTC(2026, 7, 1, 0, index)).toISOString()
    });
  }
  return { fills: financiallyReconciledFills(fills), tradePlans };
}

test("决策校准按品种×周期×regime×setup归因，但只生成影子乘数", () => {
  const report = buildDecisionCalibrationReport(fixture(20), { minTrades: 20 });
  assert.equal(report.tradesWithDecisionContext, 20);
  assert.equal(report.automaticWeightMutation, false);
  assert.equal(report.segments.length, 1);
  assert.equal(report.segments[0].status, "eligible_for_shadow_calibration");
  assert.equal(report.segments[0].appliedToLiveDecision, false);
  assert.ok(report.segments[0].shadowMultiplier >= 0.85 && report.segments[0].shadowMultiplier <= 1.15);
  assert.equal(report.factorAssociations[0].attribution, "declared_association_not_causal");
});

test("小样本只能继续收集，不能改变实盘权重", () => {
  const report = buildDecisionCalibrationReport(fixture(5), { minTrades: 20 });
  assert.equal(report.segments[0].status, "collecting");
  assert.equal(report.segments[0].shadowMultiplier, 1);
  assert.equal(report.segments[0].appliedToLiveDecision, false);
});

test("校准报告按净值识别费用翻转，不把毛盈利报告为100%胜率", () => {
  const db = fixture(10);
  for (let index = 0; index < 10; index += 1) {
    const close = db.fills.find((fill) => fill.kind === "close" && fill.executionOrderId === `exec-${index}`);
    const entry = db.fills.find((fill) => fill.kind === "entry" && fill.executionOrderId === `exec-${index}`);
    close.realizedPnl = 1;
    close.feeUsdt = 1.2;
    entry.feeUsdt = 0.8;
  }
  const segment = buildDecisionCalibrationReport(db, { minTrades: 10 }).segments[0];
  assert.equal(segment.winRatePct, 0);
  assert.equal(segment.pnlUsdt, -10);
  assert.ok(segment.shadowMultiplier < 1);
});
