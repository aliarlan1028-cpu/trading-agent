import assert from "node:assert/strict";
import test from "node:test";
import { buildCurrentRiskSnapshot, enforceCurrentRiskFacts } from "../server/currentRiskSnapshot.mjs";
import { reconcileRiskIncidentLifecycle } from "../server/riskIncidentLifecycle.mjs";
import { sanitizeHistoricalAccountClaims } from "../server/agentChat.mjs";

function fixture() {
  return {
    system: { killSwitch: false, reduceOnlyMode: false, remainingDailyLossUsdt: 10, tradeProtections: { cooldown: { active: false, streak: 0 }, drawdown: { active: false } } },
    portfolio: { totalEquityUsdt: 100, weekPnl: -1, accountingUpdatedAt: new Date().toISOString() },
    mandates: [{ id: "m1", version: 4, status: "active", maxWeeklyLossPct: 20 }],
    fills: [], positions: [], tradePlans: [], executionOrders: [], events: [], realtimeConnections: [], exchangeAccounts: [], markets: [], riskIncidents: []
  };
}

test("当前风险快照使用严格滚动168小时与最新授权阈值", () => {
  const now = Date.parse("2026-08-12T12:00:00.000Z"), snapshot = buildCurrentRiskSnapshot(fixture(), now);
  assert.equal(snapshot.rollingSevenDay.semantics, "rolling_168_hours");
  assert.equal(snapshot.rollingSevenDay.windowStartAt, "2026-08-05T12:00:00.000Z");
  assert.equal(snapshot.rollingSevenDay.limitPct, 20);
  assert.equal(snapshot.consecutiveLosses.count, 0);
  assert.equal(snapshot.controls.reduceOnly, false);
});

test("模型复述旧周亏损、连亏与只减仓时由确定性守卫替换", () => {
  const guarded = enforceCurrentRiskFacts(fixture(), "🔴 周亏损 7.49%，上限 5%\n🔴 连续亏损 5 笔，上限 4 笔\n系统当前处于只减仓模式");
  assert.equal(guarded.corrected, true);
  assert.doesNotMatch(guarded.text, /7\.49|5\s*笔|处于只减仓/);
  assert.match(guarded.text, /当前风险事实/);
  assert.match(guarded.text, /上限 20%/);
});

test("历史记忆中的动态风控状态不会进入新一轮提示", () => {
  const out = sanitizeHistoricalAccountClaims("- 周亏损 7.49%，上限 5%\n- 这次不追涨的经验有效");
  assert.doesNotMatch(out, /7\.49/);
  assert.match(out, /历史动态风控状态已省略/);
  assert.match(out, /不追涨/);
});

test("恢复条件会自动关闭旧风险事件而不依赖 LLM 判断", () => {
  const db = fixture();
  db.riskIncidents = [
    { id: "i1", status: "open", source: "professional_risk_gate", title: "系统自动进入只减仓模式" },
    { id: "i2", status: "open", source: "accounting", title: "日亏损预算耗尽" },
    { id: "i3", status: "open", source: "pos_old", title: "仓位止损缺失" },
    { id: "i4", status: "open", source: "manual", title: "人工安全复核" }
  ];
  const snapshot = buildCurrentRiskSnapshot(db);
  reconcileRiskIncidentLifecycle(db, { degradation: snapshot.operationalDegradation, snapshot });
  assert.equal(db.riskIncidents.find((row) => row.id === "i1").status, "resolved");
  assert.equal(db.riskIncidents.find((row) => row.id === "i2").status, "resolved");
  assert.equal(db.riskIncidents.find((row) => row.id === "i3").status, "resolved");
  assert.equal(db.riskIncidents.find((row) => row.id === "i4").status, "open");
});
