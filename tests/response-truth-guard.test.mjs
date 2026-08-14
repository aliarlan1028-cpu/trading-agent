import assert from "node:assert/strict";
import test from "node:test";
import { appendTruthAuditText, enforceVerifiedOutput } from "../server/responseTruthGuard.mjs";

function runFixture(overrides = {}) {
  return {
    structureFacts: {
      "ADA/USDT": {
        evidenceRef: "structure:ADA:2026-08-14T00:00:00Z",
        bias: "SHORT", alignment: "aligned",
        frames: {
          "4h": {
            available: true,
            latestEvent: { kind: "BOS", direction: "down", level: 0.1815 },
            recentEvents: [{ kind: "BOS", direction: "down", level: 0.1815 }]
          }
        }
      }
    },
    ...overrides
  };
}

test("确定性结构方向和事件价位必须与真实计算回执一致", () => {
  const result = enforceVerifiedOutput({
    db: {}, run: runFixture(),
    content: "ADA/USDT 确定性结构：LONG，周期对齐=conflict\nADA/USDT 4H BOS down @0.19"
  });
  assert.equal(result.corrected, true);
  assert.equal(result.violations.length, 2);
  assert.match(result.text, /确定性结构为 SHORT，周期对齐=aligned/);
  assert.match(result.text, /4H 最近可核验结构事件为 BOS down @ 0\.1815/);
  assert.doesNotMatch(result.text, /@0\.19/);
});

test("真实结构陈述原样保留", () => {
  const text = "ADA/USDT 确定性结构：SHORT，周期对齐=aligned\nADA/USDT 4H BOS down @0.1815";
  const result = enforceVerifiedOutput({ db: {}, run: runFixture(), content: text });
  assert.equal(result.corrected, false);
  assert.equal(result.text, text);
});

test("没有真实计划、订单或成交回执时不能声称已完成动作", () => {
  const result = enforceVerifiedOutput({
    db: { tradePlans: [], executionOrders: [], fills: [], positions: [] },
    run: runFixture(),
    content: "已成功创建交易计划。\n已经向 OKX 下单并开仓。"
  });
  assert.equal(result.violations.length, 2);
  assert.match(result.text, /无 tradePlanId/);
  assert.match(result.text, /未发现可核验的成交\/持仓回执/);
  assert.doesNotMatch(result.text, /成功创建交易计划/);
});

test("计划状态和真实成交回执匹配时保留陈述", () => {
  const db = {
    tradePlans: [{ id: "plan_1", status: "awaiting_approval", executionOrderId: "order_1" }],
    executionOrders: [{ id: "order_1", planId: "plan_1", status: "entry_filled" }],
    fills: [{ kind: "entry", tradePlanId: "plan_1", executionOrderId: "order_1" }],
    positions: []
  };
  const text = "已成功创建交易计划，等待人工批准。\n订单已经成交并开仓。";
  const result = enforceVerifiedOutput({ db, run: runFixture({ tradePlanId: "plan_1" }), content: text });
  assert.equal(result.corrected, false);
  assert.equal(result.text, text);
});

test("历史和假设性内容不被当成当前动作陈述", () => {
  const text = "历史复盘：曾经成功创建交易计划。\n如果确认成立，预计再下单。\n半自动模式下，计划等待人工批准。\n只有订单已成交才算开仓。";
  const result = enforceVerifiedOutput({ db: {}, run: runFixture(), content: text });
  assert.equal(result.corrected, false);
  assert.equal(result.text, text);
});

test("策略草稿等系统动作也必须有成功工具回执", () => {
  const unsupported = enforceVerifiedOutput({
    db: {}, run: runFixture(), content: "已成功创建策略工作室草稿。"
  });
  assert.equal(unsupported.corrected, true);
  assert.match(unsupported.text, /没有 create_skill_from_idea 的成功工具回执/);

  const supportedRun = runFixture();
  supportedRun.toolReceipts = [{ name: "create_skill_from_idea", result: { status: "draft", strategyDraftId: "draft_1" } }];
  const text = "已成功创建策略工作室草稿。";
  const supported = enforceVerifiedOutput({ db: {}, run: supportedRun, content: text });
  assert.equal(supported.corrected, false);
  assert.equal(supported.text, text);
});

test("真实性摘要明确区分事实与推断", () => {
  const text = appendTruthAuditText("结论：不交易", {
    enabled: true, evidenceBundleId: "bundle_1", structureEvidenceCount: 1,
    toolReceiptCount: 8, correctionCount: 2
  }, "zh");
  assert.match(text, /真实性校验：证据包 bundle_1/);
  assert.match(text, /自动纠正无依据关键陈述 2 条/);
  assert.match(text, /推断属于分析判断/);
});
