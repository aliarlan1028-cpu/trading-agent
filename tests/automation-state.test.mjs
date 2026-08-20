import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "automation-state-test-"));
process.env.DATA_DIR = dataDir;
delete process.env.I_UNDERSTAND_REAL_TRADING;
delete process.env.REAL_ORDER_WRITE_ENABLED;
process.env.WORM_AUDIT_ENDPOINT = "https://audit.example.com/append";
process.env.ALERT_WEBHOOK_URL = "https://alerts.example.com/hook";

const { deriveAutomationState } = await import("../server/ops.mjs");
const { normalizeDatabase } = await import("../server/store.mjs");
const { partitionAutonomousBlockers } = await import("../server/routes/securityConfig.mjs");
const { ensureCuratedSkills } = await import("../server/knowledgeSkills.mjs");

const verifiedAuditStatus = Object.freeze({
  operationalReady: true,
  mode: "full_chain",
  confidence: "full_chain_local",
  legacyChainOk: true,
  externalAttestation: "deferred",
  failures: []
});

function dbFixture() {
  return {
    system: { autonomyEnabled: true, killSwitch: false, liveTradingEnabled: false, remainingDailyLossUsdt: 100, professionalRiskMode: true, wormAuditLastSuccessAt: new Date().toISOString() },
    mandates: [{ id: "m1", status: "active", version: 1, allowedSymbols: ["BTC/USDT"], activatedAt: "2026-07-27T00:00:00.000Z" }],
    apiKeyMetadata: [{ id: "key_okx", exchange: "OKX", hasApiKey: true, hasSecret: true, withdrawPermission: false }],
    accountSnapshots: [{ id: "snap-1", exchange: "OKX", status: "ok", createdAt: new Date().toISOString() }],
    grayReleasePolicies: [],
    auditLogs: [], alerts: [{ status: "sent", createdAt: new Date().toISOString() }],
    traces: []
  };
}

test("派生状态机:按执行链顺序给出单一结论", () => {
  const db = dbFixture();
  // 熔断优先级最高
  db.system.killSwitch = true;
  assert.equal(deriveAutomationState(db, { hasProvider: true }).mode, "halted");
  db.system.killSwitch = false;
  // 自主暂停
  db.system.autonomyEnabled = false;
  assert.equal(deriveAutomationState(db, { hasProvider: true }).mode, "paused");
  db.system.autonomyEnabled = true;
  // 无 LLM → 自主决策被拦
  const noLlm = deriveAutomationState(db, { hasProvider: false });
  assert.equal(noLlm.mode, "analysis_blocked");
  assert.equal(noLlm.runtimeStatus, "analysis_unavailable");
  assert.ok(noLlm.blockers.includes("未配置 LLM"));
  // 实盘写入关闭 → 观察模式(干跑),这正是"自主运行中≠会自动下单"的诚实表述
  assert.equal(deriveAutomationState(db, { hasProvider: true }).mode, "observe");
});

test("只分析模式不被交易授权和账户额度伪装成故障", () => {
  const db = dbFixture();
  db.system.requestedOperatingMode = "observe";
  db.system.reduceOnlyMode = true;
  db.system.reduceOnlyReasons = ["financial_reconciliation_pending"];
  db.system.remainingDailyLossUsdt = 0;
  db.mandates = [];
  db.accountSnapshots = [];
  const state = deriveAutomationState(db, { hasProvider: true });
  assert.equal(state.mode, "observe");
  assert.equal(state.selectedMode, "observe");
  assert.equal(state.selectedModeLabel, "只分析");
  assert.equal(state.runtimeStatus, "normal");
  assert.deepEqual(state.blockers, []);
});

test("旧的独立自主暂停迁移为三模式真相，紧急停止仍保持停机", () => {
  const legacy = normalizeDatabase({ meta: {}, system: { autonomyEnabled: false, liveTradingEnabled: false, killSwitch: false } });
  assert.equal(legacy.system.requestedOperatingMode, "observe");
  assert.equal(legacy.system.autonomyEnabled, true);
  assert.equal(legacy.system.operatingModeSchemaVersion, 2);

  const stopped = normalizeDatabase({ meta: {}, system: { autonomyEnabled: false, liveTradingEnabled: false, killSwitch: true } });
  assert.equal(stopped.system.autonomyEnabled, false);
  assert.equal(stopped.system.operatingModeSchemaVersion, 2);
});

test("实盘链:Key 未核验/灰度未启用逐项点名,全通且免批则为全自动小额", () => {
  const db = dbFixture();
  db.system.liveTradingEnabled = true;
  db.system.realTradingAck = true;
  db.system.orderWriteEnabled = true;
  // Key 未核验(permissionVerifiedAt 缺失) + 灰度未启用 → 实盘开仓被拦并点名
  let st = deriveAutomationState(db, { hasProvider: true });
  assert.equal(st.mode, "live_blocked");
  assert.ok(st.blockers.includes("API Key 权限未核验"));
  assert.ok(st.blockers.includes("灰度策略未启用"));
  // 补齐核验与灰度(保留人工确认) → 半自动
  db.apiKeyMetadata[0].permissionVerifiedAt = "2026-07-27T00:00:00.000Z";
  db.grayReleasePolicies.push({ id: "g1", enabled: true, requiresManualApproval: true, maxNotionalUsdt: 200 });
  st = deriveAutomationState(db, { hasProvider: true, auditStatus: verifiedAuditStatus });
  assert.equal(st.mode, "semi_auto");
  // 关闭人工确认 → 全自动·小额
  db.grayReleasePolicies[0].requiresManualApproval = false;
  st = deriveAutomationState(db, { hasProvider: true, auditStatus: verifiedAuditStatus });
  assert.equal(st.mode, "full_auto_small");
  assert.match(st.detail, /200 USDT/);
  // 日亏预算耗尽回落为被拦
  db.system.remainingDailyLossUsdt = 0;
  assert.equal(deriveAutomationState(db, { hasProvider: true }).mode, "blocked");
});

test("历史成功快照不能让实盘状态继续显示可下单", () => {
  const db = dbFixture();
  db.system.liveTradingEnabled = true;
  db.system.realTradingAck = true;
  db.system.orderWriteEnabled = true;
  db.apiKeyMetadata[0].permissionVerifiedAt = new Date().toISOString();
  db.grayReleasePolicies = [{ id: "g1", enabled: true, requiresManualApproval: false, maxNotionalUsdt: 200 }];
  db.accountSnapshots[0].createdAt = new Date(Date.now() - 11 * 60_000).toISOString();
  const state = deriveAutomationState(db, { hasProvider: true });
  assert.equal(state.mode, "live_blocked");
  assert.equal(state.requestedMode, "full_auto", "临时阻断不能把用户选择改写成只分析");
  assert.ok(state.blockers.includes("账户快照缺失或已过期"));
});

test("已保存执行方式与当前有效状态分离", () => {
  const db = dbFixture();
  db.system.requestedOperatingMode = "full_auto";
  db.system.liveTradingEnabled = true;
  db.system.realTradingAck = true;
  db.system.orderWriteEnabled = true;
  db.system.reduceOnlyMode = true;
  const state = deriveAutomationState(db, { hasProvider: true });
  assert.equal(state.mode, "reduce_only");
  assert.equal(state.requestedMode, "full_auto");
  assert.equal(state.requestedLabel, "自动交易");
  assert.equal(state.selectedMode, "full_auto");
  assert.equal(state.runtimeStatus, "opening_paused");
  assert.equal(state.runtimeLabel, "暂停新开仓");
  assert.equal(state.resumesAutomatically, true);
  assert.equal(state.blockerDetails[0].code, "opening_paused");
  assert.match(state.detail, /原因解除后自动恢复/);
});

test("暂停新开仓状态公开每个持久安全原因", () => {
  const db = dbFixture();
  db.system.requestedOperatingMode = "full_auto";
  db.system.reduceOnlyMode = true;
  db.system.reduceOnlyReasons = ["financial_reconciliation_pending", "execution:close_unknown_pending"];
  const state = deriveAutomationState(db, { hasProvider: true });
  assert.deepEqual(state.blockerDetails.map((item) => item.code), ["financial_reconciliation_pending", "execution:close_unknown_pending"]);
  assert.ok(state.blockers.includes("账户核算基线或费用对账未完成"));
  assert.ok(state.blockers.includes("平仓结果未知"));
});

test("只有滚动窗口基线缺失时不再误报为成交费用未对账", () => {
  const db = dbFixture();
  db.system.requestedOperatingMode = "full_auto";
  db.system.reduceOnlyMode = true;
  db.system.reduceOnlyReasons = ["financial_reconciliation_pending"];
  db.portfolio = {
    pendingFinancialReconciliationToday: 0,
    pendingFinancialReconciliationWeek: 1,
    pendingTradeFinancialFactsToday: 0,
    pendingTradeFinancialFactsWeek: 0,
    dailyBaselineStatus: "reconciled",
    weekBaselineStatus: "period_start_snapshot_missing",
    accountingHistoryBackfill: {
      status: "failed",
      reason: "local_exchange_realized_pnl_mismatch",
      progressPct: 28.5,
      naturalReadyAt: "2026-08-22T13:15:00.000Z"
    }
  };
  const state = deriveAutomationState(db, { hasProvider: true });
  assert.equal(state.blockerDetails[0].label, "近 7 日风险窗口尚未建立");
  assert.match(state.blockerDetails[0].detail, /成交费用：已完成/);
  assert.match(state.blockerDetails[0].detail, /本地成交与 OKX 账单不一致/);
  assert.match(state.blockerDetails[0].recovery, /预计最晚 8(?:月|\/)22(?:日)? 21:15 自动成熟/);
  assert.equal(state.blockerDetails[0].accounting.historyBackfillReason, "local_exchange_realized_pnl_mismatch");
});

test("自动交易保存只拒绝结构性缺项，临时运行故障保留为等待恢复", () => {
  const result = partitionAutonomousBlockers([
    "OKX 私有 WebSocket 未连接",
    "OKX 账户对账未通过",
    "没有当前有效的 OKX Mandate",
    "本地审计链校验失败"
  ]);
  assert.deepEqual(result.transient, ["OKX 私有 WebSocket 未连接", "OKX 账户对账未通过"]);
  assert.deepEqual(result.hard, ["没有当前有效的 OKX Mandate", "本地审计链校验失败"]);
});

test("BitLaunch 单服务器模式不伪造 WORM，但不把缺少外部 WORM 当成自动交易阻断", () => {
  const previousProfile = process.env.PRODUCTION_SECURITY_PROFILE;
  const previousWorm = process.env.WORM_AUDIT_ENDPOINT;
  process.env.PRODUCTION_SECURITY_PROFILE = "bitlaunch_single_server";
  delete process.env.WORM_AUDIT_ENDPOINT;
  try {
    const db = dbFixture();
    db.system.liveTradingEnabled = true;
    db.system.realTradingAck = true;
    db.system.orderWriteEnabled = true;
    db.apiKeyMetadata[0].permissionVerifiedAt = new Date().toISOString();
    db.grayReleasePolicies = [{ id: "g1", enabled: true, requiresManualApproval: false, maxNotionalUsdt: 200 }];
    assert.equal(deriveAutomationState(db, { hasProvider: true, auditStatus: verifiedAuditStatus }).mode, "full_auto_small");
  } finally {
    if (previousProfile === undefined) delete process.env.PRODUCTION_SECURITY_PROFILE;
    else process.env.PRODUCTION_SECURITY_PROFILE = previousProfile;
    if (previousWorm === undefined) delete process.env.WORM_AUDIT_ENDPOINT;
    else process.env.WORM_AUDIT_ENDPOINT = previousWorm;
  }
});

test("精选手写技能:入列5个已编译(含2个做空),幂等且不给被拒技能刷版本", () => {
  const db = {
    meta: {}, auditLogs: [], traces: [], fills: [], tradePlans: [], paperSessions: [], markets: [],
    knowledge: { sources: [], chunks: [], tradingMethods: [], tradingSkills: [], skillInvocations: [], skillAttributions: [] }
  };
  const first = ensureCuratedSkills(db);
  assert.equal(first.created, 5);
  const skills = db.knowledge.tradingSkills;
  assert.equal(skills.length, 5);
  assert.ok(skills.every((s) => s.status === "compiled" && s.curated === true));
  assert.equal(skills.filter((s) => s.spec.direction === "short").length, 2, "必须包含做空技能");
  assert.ok(skills.every((s) => s.spec.params.atrStop === true), "统一 ATR 自适应止损");
  // 幂等:再跑不新增
  assert.equal(ensureCuratedSkills(db).created, 0);
  assert.equal(db.knowledge.tradingSkills.length, 5);
  // 历史验证被拒后也不重编译刷版本
  skills[0].status = "historical_rejected";
  ensureCuratedSkills(db);
  assert.equal(db.knowledge.tradingSkills.length, 5);
  assert.equal(skills[0].status, "historical_rejected");
});
