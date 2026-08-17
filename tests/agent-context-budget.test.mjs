import assert from "node:assert/strict";
import test from "node:test";

import { buildHistoryForLlm, buildSystemPrompt, resolveAutonomousMaxSteps, selectAgentToolsForContext } from "../server/agentChat.mjs";
import { seedDatabase } from "../server/store.mjs";

const tool = (name) => ({ name, description: name, schema: { type: "object", properties: {} } });

test("automatic decisions expose only decision tools and required deterministic capabilities", () => {
  const all = [
    "sync_market", "analyze_market_structure", "get_market_intelligence", "propose_trade_plan",
    "register_watch", "create_task", "set_execution_mode", "resolve_risk_incidents",
    "scan_market_opportunities", "mcp__external__write_record"
  ].map(tool);
  const selected = selectAgentToolsForContext(all, {
    autonomous: true,
    trigger: "scheduled_patrol",
    requiredCalls: [{ name: "scan_market_opportunities" }],
    preflightCoverage: { missing: [] }
  }).map((row) => row.name);

  assert.deepEqual(selected, [
    "propose_trade_plan", "register_watch"
  ]);
  assert.equal(selected.includes("create_task"), false);
  assert.equal(selected.includes("set_execution_mode"), false);
  assert.equal(selected.includes("mcp__external__write_record"), false);
});

test("an automatic decision re-exposes only a capability whose deterministic preflight failed", () => {
  const all = ["get_global_market", "scan_market_opportunities", "propose_trade_plan", "create_task"].map(tool);
  const selected = selectAgentToolsForContext(all, {
    autonomous: true,
    trigger: "scheduled_patrol",
    preflightCoverage: { missing: [{ name: "scan_market_opportunities", symbol: null }] }
  });
  assert.deepEqual(selected.map((row) => row.name), ["scan_market_opportunities", "propose_trade_plan"]);
});

test("fast-move decisions may read cached attribution while scheduled decisions cannot", () => {
  const all = ["sync_market", "explain_market_move", "create_task"].map(tool);
  const scheduled = selectAgentToolsForContext(all, { autonomous: true, trigger: "scheduled_patrol" });
  const fast = selectAgentToolsForContext(all, { autonomous: true, trigger: "fast_move" });
  assert.deepEqual(scheduled.map((row) => row.name), []);
  assert.deepEqual(fast.map((row) => row.name), ["explain_market_move"]);
});

test("manual conversations preserve the full authorized tool set", () => {
  const all = ["sync_market", "create_task", "set_execution_mode"].map(tool);
  assert.equal(selectAgentToolsForContext(all, { autonomous: false }), all);
});

test("automatic market prompt keeps safety contracts but removes manual product handbook", async () => {
  const db = seedDatabase();
  const manual = await buildSystemPrompt(db, "分析 BTC", null, null, null, null, {
    marketAnalysisRequired: true,
    autonomous: false,
    symbols: ["BTC/USDT"]
  });
  const automatic = await buildSystemPrompt(db, "定时自主巡检", null, null, null, null, {
    marketAnalysisRequired: true,
    autonomous: true,
    symbols: ["BTC/USDT"]
  });

  assert.match(automatic, /API\/RSS 事件/);
  assert.match(automatic, /propose_trade_plan/);
  assert.match(automatic, /收益风险比至少 2R/);
  assert.match(automatic, /挂单未成交不是持仓/);
  assert.doesNotMatch(automatic, /本系统内置说明/);
  assert.ok(automatic.length < manual.length * 0.7, `automatic=${automatic.length}, manual=${manual.length}`);
});

test("non-market prompt omits trading portfolio, research cache and final risk payload", async () => {
  const db = seedDatabase();
  db.marketResearchContext = {
    id: "market_context_secret_marker",
    researchedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    symbols: ["BTC/USDT"],
    global: { sentiment: 50, materiality: "low", confidence: "low", driverTypes: [], eventTypes: [], impactChannels: [] },
    assets: [], citationCount: 0, provider: { attributionVerified: true }
  };
  const prompt = await buildSystemPrompt(db, "如何修改界面语言？", null, null, null, null, {
    marketAnalysisRequired: false,
    evidenceRequired: false,
    autonomous: false,
    symbols: []
  });

  assert.match(prompt, /本系统内置说明/);
  assert.doesNotMatch(prompt, /交易周期角色与组合裁决/);
  assert.doesNotMatch(prompt, /market_context_secret_marker/);
  assert.doesNotMatch(prompt, /最终风险事实/);
  assert.doesNotMatch(prompt, /最终账户事实/);
});

test("autonomous decisions never resend old patrol prose while manual chat keeps continuity", () => {
  const db = seedDatabase();
  db.chatMessages = [
    { id: "m1", sessionId: "chat_autocycle", role: "user", content: "旧巡检提示", createdAt: "2026-08-18T00:00:00.000Z" },
    { id: "m2", sessionId: "chat_autocycle", role: "agent", content: "旧价格和旧结论", createdAt: "2026-08-18T00:01:00.000Z" },
    { id: "m3", sessionId: "chat_manual", role: "user", content: "手动上下文", createdAt: "2026-08-18T00:02:00.000Z" },
    { id: "m4", sessionId: "chat_manual", role: "agent", content: "上一轮回答", createdAt: "2026-08-18T00:03:00.000Z" },
    { id: "m5", sessionId: "chat_manual", role: "user", content: "当前消息由调用方另加", createdAt: "2026-08-18T00:04:00.000Z" }
  ];

  assert.deepEqual(buildHistoryForLlm(db, "chat_autocycle"), []);
  const manual = buildHistoryForLlm(db, "chat_manual");
  assert.equal(manual.length, 2);
  assert.match(manual[0].content, /手动上下文/);
  assert.match(manual[1].content, /上一轮回答/);
});

test("invalid autonomous max-step configuration falls back to a real bounded loop", () => {
  assert.equal(resolveAutonomousMaxSteps("invalid"), 5);
  assert.equal(resolveAutonomousMaxSteps(2), 3);
  assert.equal(resolveAutonomousMaxSteps(99), 8);
});
