import assert from "node:assert/strict";
import test from "node:test";

import { buildAiDomainModel, missionStagePresentation } from "../src/kordynV2/domains/ai/aiModel.js";

const expectedStages = Object.freeze({
  intent: ["正在理解任务", "working"],
  sense: ["正在检查市场", "working"],
  recall: ["正在核对相关证据", "working"],
  plan: ["正在形成下一步计划", "working"],
  guard: ["正在验证风险边界", "attention"],
  approval: ["需要你确认", "approval"],
  execute: ["正在等待权威执行结果", "working"],
  monitor: ["正在监控结果", "monitoring"],
  review: ["正在整理复盘证据", "reviewing"]
});

test("AI model preserves mission identity and uses product-language stages", () => {
  const run = {
    id: "run-1",
    status: "waiting_approval",
    stage: "guard",
    title: "BTC 计划复核",
    evidenceIds: ["market-btc", "risk-btc"],
    nextActions: ["等待主人批准或拒绝"]
  };
  const plan = {
    id: "plan-1",
    agentRunId: "run-1",
    status: "awaiting_approval",
    symbol: "BTC/USDT"
  };

  const model = buildAiDomainModel({ agentRuns: [run], tradePlans: [plan] });

  assert.equal(model.missions[0].id, "run-1");
  assert.equal(model.missions[0].source, run);
  assert.equal(model.missions[0].stage.id, "guard");
  assert.equal(model.missions[0].stage.label, "正在验证风险边界");
  assert.equal(model.missions[0].approval.planId, "plan-1");
  assert.equal(model.missions[0].evidenceCount, 2);
  assert.equal(model.missions[0].nextAction, "等待主人批准或拒绝");
  assert.doesNotMatch(model.missions[0].stage.label, /Guard|Sense|Recall/i);
});

test("every technical mission stage maps to the exact primary product language", () => {
  for (const [technicalStage, [label, tone]] of Object.entries(expectedStages)) {
    assert.deepEqual(missionStagePresentation(technicalStage.toUpperCase()), {
      id: technicalStage,
      label,
      tone
    });
  }
});

test("missing and malformed mission facts remain unavailable", () => {
  const model = buildAiDomainModel({
    agentRuns: [
      { id: "run-missing" },
      { id: "run-malformed", stage: { name: "guard" }, evidenceCount: "0", nextAction: { label: "approve" } },
      { id: "run-negative", evidenceCount: -1 },
      { id: "run-bad-evidence", evidenceIds: [" evidence-with-whitespace "] },
      { id: " run-spaced " },
      { id: "" },
      null
    ]
  });

  assert.equal(model.missions.length, 4);
  for (const mission of model.missions) {
    assert.equal(mission.stage.label, "Unavailable");
    assert.equal(mission.evidenceCount, "Unavailable");
    assert.equal(mission.nextAction, "Unavailable");
  }
  assert.equal(model.missions.some((mission) => mission.id === ""), false);
});

test("AI model reuses patrol and event truth selectors without inventing unavailable rows", () => {
  const model = buildAiDomainModel({
    chatMessages: [{
      id: "message-patrol",
      sessionId: "chat_autocycle",
      capabilityCoverage: {
        ok: true,
        checkedAt: "2026-08-28T03:00:00.000Z",
        covered: 2,
        required: 2,
        missing: [],
        whitelist: { analyzed: 1, expected: 1, symbols: ["BTC/USDT"] },
        watches: { analyzed: 0, expected: 0, symbols: [] },
        marketScan: { completed: true, universe: 100, candidates: 3 },
        externalCandidates: []
      },
      presentation: {
        headline: "本轮证据齐备",
        nextAction: { code: "analysis_only", detail: null },
        linked: {}
      },
      toolTrace: [],
      toolCallSummary: { totalCalls: 0, modelCalls: 0, preflightCalls: 0 }
    }],
    events: [{ id: "event-1", title: "CPI", due: "2026-09-01T12:30:00.000Z", impact: 80 }],
    marketCalendarEvents: [{
      id: "official-1",
      title: "FOMC",
      startAt: "2026-09-02T18:00:00.000Z",
      importance: "high",
      sourceName: "Federal Reserve",
      symbols: ["BTC/USDT"],
      timePrecision: "datetime"
    }]
  });

  assert.equal(model.patrols.length, 1);
  assert.equal(model.patrols[0].kind, "autonomous_patrol");
  assert.equal(model.patrols[0].scope.evidence.value, 2);
  assert.deepEqual(model.events.map((event) => event.id), ["event-1", "official-1"]);
  assert.equal(model.events[1].source, "Federal Reserve");
});
