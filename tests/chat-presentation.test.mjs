import assert from "node:assert/strict";
import test from "node:test";
import { buildChatPresentation } from "../server/chatPresentation.mjs";
import { financiallyReconciledFills } from "./financial-fixtures.mjs";

function evidenceBundle() {
  const windows = Object.fromEntries(["15m", "1h", "4h"].map((timeframe, index) => [timeframe, {
    status: "ok",
    priceChangePct: 0.3 + index,
    oiChangePct: 1.2 + index,
    fundingEndPct: 0.01,
    fundingChangePp: 0.002,
    leverageState: "long_build",
    cvd: 120 + index,
    cvdImbalancePct: 3.5,
    flowCoveragePct: 100,
    divergence: "none"
  }]));
  const passed = (quality = "passed") => ({ quality, status: "fresh" });
  return {
    id: "evb_1",
    generatedAt: "2026-08-13T02:00:00.000Z",
    criticalReady: true,
    symbols: [{
      symbol: "BTC/USDT",
      ticker: passed(), candles: passed(), microstructure: passed(), contractSpec: passed(), smartMoney: passed(),
      mediumTerm: { ...passed(), data: { windows, btcRisk: { "7d": { status: "ok", correlation: 0.91, beta: 1.08 } } } }
    }],
    account: passed(),
    mediumTermEventVolatility: { byType: { CPI: { status: "usable", samples: 8, avgPost1hRealizedVolPct: 1.1, medianPost1hVolExpansionRatio: 2.2, typicalReaction: "expansion", confidence: "provisional" } } }
  };
}

function structureFacts() {
  return {
    structures: {
      "BTC/USDT": {
        symbol: "BTC/USDT",
        analyzedAt: "2026-08-13T02:01:00.000Z",
        selectedRole: "day_trader",
        bias: "LONG",
        quality: "A",
        frames: Object.fromEntries(["15m", "1h", "4h"].map((timeframe) => [timeframe, {
          available: true,
          timeframe,
          lastClosedAt: "2026-08-13T02:00:00.000Z",
          trend: { direction: "up", sequence: "HH/HL" },
          phase: timeframe === "15m" ? "pullback" : "continuation",
          latestEvent: { kind: "BOS", direction: "up", level: 63000 },
          volume: { state: "normal" }
        }]))
      }
    }
  };
}

test("交易回复生成结构化决策简报，而不是从正文猜订单状态", () => {
  const plan = {
    id: "plan_1", symbol: "BTC/USDT", direction: "long", status: "awaiting_approval", traderRole: "day_trader", timeframe: "1h",
    decisionContext: { supportingFactors: ["1H 结构保持 HH/HL"], conflictingFactors: ["15m CVD 尚未放量"] },
    lastRiskCheck: { passed: true, summary: "36/36 通过" }
  };
  const db = { tradePlans: [plan], executionOrders: [], positions: [], watchTriggers: [] };
  const run = { id: "run_1", tradePlanId: plan.id, presentationFacts: structureFacts(), completedAt: "2026-08-13T02:02:00.000Z" };
  const result = buildChatPresentation({ db, run, evidenceBundle: evidenceBundle(), content: "### 结论\n等待回踩确认，不追多。" });
  assert.equal(result.layout, "decision_brief");
  assert.equal(result.kind, "trade_plan");
  assert.equal(result.decision.state, "awaiting_approval");
  assert.equal(result.decision.hasOrder, false);
  assert.equal(result.headline, "等待回踩确认，不追多。");
  assert.deepEqual(result.timeframes.map((row) => row.timeframe), ["15m", "1h", "4h"]);
  assert.equal(result.timeframes[0].structure.sequence, "HH/HL");
  assert.equal(result.timeframes[1].flow.oiChangePct, 2.2);
  assert.equal(result.evidence.btcRisk.beta, 1.08);
  assert.equal(result.evidence.coverage.passed, 7);
  assert.equal(result.evidence.coverage.criticalReady, true);
  assert.deepEqual(result.symbols, ["BTC/USDT"]);
  assert.equal(result.nextAction.code, "approve_or_reject");
});

test("真实执行单状态覆盖计划状态，避免把已挂单说成仍待批准", () => {
  const db = {
    tradePlans: [{ id: "plan_1", symbol: "BTC/USDT", direction: "long", status: "approved" }],
    executionOrders: [{ id: "eo_1", planId: "plan_1", status: "entry_pending", entryPrice: 62000 }],
    positions: [], watchTriggers: []
  };
  const result = buildChatPresentation({ db, run: { id: "run_1", tradePlanId: "plan_1" }, evidenceBundle: evidenceBundle(), content: "计划正在处理。" });
  assert.equal(result.kind, "execution_update");
  assert.equal(result.decision.state, "entry_pending");
  assert.equal(result.decision.hasOrder, true);
  assert.equal(result.execution.status, "entry_pending");
  assert.equal(result.execution.filledPrice, null);
  assert.equal(result.execution.plannedEntryPrice, 62000);
  assert.equal(result.nextAction.code, "wait_for_fill");
});

test("执行快照使用真实成交加权均价和已平仓记录，不把计划价格伪装成成交价", () => {
  const db = {
    tradePlans: [{ id: "plan_1", symbol: "BTC/USDT", direction: "long", status: "closed" }],
    executionOrders: [{ id: "eo_1", planId: "plan_1", status: "closed", entryPrice: 62000, quantity: 0.03 }],
    fills: financiallyReconciledFills([
      { executionOrderId: "eo_1", kind: "entry", price: 62100, quantity: 0.01 },
      { executionOrderId: "eo_1", kind: "entry", price: 62400, quantity: 0.02 },
      { executionOrderId: "eo_1", kind: "close", realizedPnl: 3.2 },
      { executionOrderId: "eo_1", kind: "close", realizedPnl: -0.4 }
    ]),
    positions: [], watchTriggers: []
  };
  const result = buildChatPresentation({ db, run: { id: "run_1", tradePlanId: "plan_1" }, evidenceBundle: evidenceBundle(), content: "交易已平仓。" });
  assert.equal(result.execution.filledPrice, 62300);
  assert.equal(result.execution.plannedEntryPrice, 62000);
  assert.ok(Math.abs(result.execution.realizedPnl - 2.8) < 1e-9);
  assert.ok(Math.abs(result.execution.netRealizedPnl - 2.8) < 1e-9);
  assert.ok(Math.abs(result.execution.grossRealizedPnl - 2.8) < 1e-9);
});

test("execution presentation labels lifecycle gross separately and exposes net after entry/close fees", () => {
  const db = {
    tradePlans: [{ id: "plan-fee", symbol: "BTC/USDT" }],
    executionOrders: [{ id: "eo-fee", planId: "plan-fee", status: "closed" }],
    fills: financiallyReconciledFills([
      { id: "entry-fee", executionOrderId: "eo-fee", kind: "entry", feeUsdt: 0.8 },
      { id: "close-fee", executionOrderId: "eo-fee", kind: "close", realizedPnl: 1, feeUsdt: 0.4 }
    ]), positions: []
  };
  const result = buildChatPresentation({ db, run: { tradePlanId: "plan-fee" }, content: "完成" });
  assert.equal(result.execution.grossRealizedPnl, 1);
  assert.ok(Math.abs(result.execution.netRealizedPnl + 0.2) < 1e-9);
  assert.ok(Math.abs(result.execution.realizedPnl + 0.2) < 1e-9);
});

test("多币种分析缺少主币结构时保持样本不足，不借用其他币种结构", () => {
  const bundle = evidenceBundle();
  bundle.symbols[0].symbol = "ETH/USDT";
  const run = {
    id: "run_1",
    decisionContext: { symbols: ["ETH/USDT", "BTC/USDT"] },
    presentationFacts: { structures: { "BTC/USDT": structureFacts().structures["BTC/USDT"] } }
  };
  const result = buildChatPresentation({ db: { watchTriggers: [] }, run, evidenceBundle: bundle, content: "对比 ETH 与 BTC。" });
  assert.equal(result.symbol, "ETH/USDT");
  assert.equal(result.timeframes[0].structure, null);
  assert.deepEqual(result.symbols, ["ETH/USDT", "BTC/USDT"]);
});

test("计划币种缺席时不借用证据包内另一个币种的中频数据", () => {
  const bundle = evidenceBundle();
  bundle.symbols[0].symbol = "ETH/USDT";
  const db = {
    tradePlans: [{ id: "plan_sol", symbol: "SOL/USDT", direction: "long", status: "awaiting_approval" }],
    executionOrders: [], positions: [], watchTriggers: []
  };
  const result = buildChatPresentation({ db, run: { id: "run_1", tradePlanId: "plan_sol" }, evidenceBundle: bundle, content: "SOL 计划待确认。" });
  assert.equal(result.symbol, "SOL/USDT");
  assert.equal(result.timeframes[0].flow, null);
  assert.equal(result.evidence.btcRisk.status, "insufficient");
});

test("补充证据缺失会降低覆盖率，但不会冒充核心交易证据失败", () => {
  const bundle = evidenceBundle();
  bundle.symbols[0].smartMoney = { quality: "unavailable", status: "fresh" };
  const db = {
    tradePlans: [{ id: "plan_1", symbol: "BTC/USDT", direction: "long", status: "awaiting_approval" }],
    executionOrders: [], positions: [], watchTriggers: []
  };
  const result = buildChatPresentation({ db, run: { id: "run_1", tradePlanId: "plan_1" }, evidenceBundle: bundle, content: "BTC 计划。" });
  assert.equal(result.evidence.coverage.passed, 6);
  assert.equal(result.evidence.coverage.total, 7);
  assert.equal(result.evidence.coverage.complete, false);
  assert.equal(result.evidence.coverage.criticalReady, true);
});

test("普通非交易问答继续使用叙事布局，不强塞空决策卡", () => {
  const result = buildChatPresentation({ db: {}, run: { id: "run_1" }, content: "这是系统功能说明。" });
  assert.equal(result.layout, "narrative");
  assert.equal(result.symbol, null);
  assert.equal(result.kind, "market_analysis");
});

test("系统说明即使后台预取市场证据也保持叙事布局", () => {
  const result = buildChatPresentation({ db: {}, run: { id: "run_1", decisionContext: { trigger: "manual" } }, evidenceBundle: evidenceBundle(), content: "### 结论\n> 本轮使用 KORDYN 内置系统说明回答，不依赖外部知识库。\n状态：本地说明模式" });
  assert.equal(result.layout, "narrative");
  assert.equal(result.symbol, null);
});

test("核心判断按完整句提炼，不在半句话中硬截断", () => {
  const content = "### 结论\n本轮无交易计划。大盘偏空分化，但四个白名单币均贴近区间低位，不在当前位置追空。若价格反弹至供给区，再等待结构转弱确认。";
  const result = buildChatPresentation({ db: { watchTriggers: [{ id: "w", symbol: "BTC/USDT", status: "active", priority: "primary", kind: "price_above", level: 70000 }] }, run: { id: "run_1" }, content });
  assert.equal(result.headline, "本轮无交易计划。大盘偏空分化，但四个白名单币均贴近区间低位，不在当前位置追空。");
  assert.doesNotMatch(result.headline, /…$/);
});
