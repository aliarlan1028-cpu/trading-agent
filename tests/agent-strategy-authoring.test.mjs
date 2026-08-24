import assert from "node:assert/strict";
import test from "node:test";

import { executeTool } from "../server/agentChat.mjs";
import { agentInvocationPolicy, userAgentInvocation } from "../server/agentInvocation.mjs";
import { seedDatabase } from "../server/store.mjs";
import { strategyDraftsReferencedByChat } from "../server/strategyStudio.mjs";

test("Agent 兼容工具创建策略工作室草稿而不是第二套知识技能", async () => {
  const db = seedDatabase();
  db.strategyStudioDrafts = [];
  db.knowledge.tradingSkills = [];
  db.knowledge.tradingMethods = [];
  const run = {
    id: "run-authoring",
    sessionId: "chat-authoring",
    role: "AI 交易员",
    tenantId: db.user.tenantId,
    requestedByUserId: db.user.id,
    principal: { tenantId: db.user.tenantId, userId: db.user.id, isOwner: true },
    steps: [],
    invocation: agentInvocationPolicy(userAgentInvocation({ permissions: ["write:review"] }))
  };
  const result = await executeTool(db, run, "create_skill_from_idea", {
    name: "BTC 突破策略",
    symbol: "BTC/USDT",
    direction: "long",
    timeframe: "1h",
    entry: "收盘突破过去 20 根 K 线最高价",
    stop: "入场价下方 2%",
    takeProfit: "2R",
    templateId: "breakout"
  });
  assert.equal(result.strategyDraftId, run.strategyDraftId);
  assert.equal(result.generatedTests.status, "passed");
  assert.equal(db.strategyStudioDrafts.length, 1);
  assert.equal(db.strategyStudioDrafts[0].authoring.channel, "agent_chat");
  assert.equal(result.compilationReport.status, "compiled");
  assert.equal(result.compilationReport.unsupported.length, 0);
  assert.equal(db.knowledge.tradingSkills.length, 0);
  assert.equal(db.knowledge.tradingMethods.length, 0);
});

test("Agent strategy authoring rejects unsupported confirmation logic instead of dropping it", async () => {
  const db = seedDatabase();
  db.strategyStudioDrafts = [];
  const run = {
    id: "run-unsupported-authoring",
    sessionId: "chat-authoring",
    role: "AI 交易员",
    tenantId: db.user.tenantId,
    requestedByUserId: db.user.id,
    principal: { tenantId: db.user.tenantId, userId: db.user.id, isOwner: true },
    steps: [],
    invocation: agentInvocationPolicy(userAgentInvocation({ permissions: ["write:review"] }))
  };

  await assert.rejects(
    executeTool(db, run, "create_skill_from_idea", {
      name: "订单簿确认突破",
      symbol: "BTC/USDT",
      direction: "long",
      timeframe: "1h",
      entry: "收盘突破过去 20 根 K 线最高价",
      confirmation: "订单簿买盘强度超过卖盘两倍",
      stop: "入场价下方 2%",
      takeProfit: "2R",
      templateId: "breakout"
    }),
    (error) => error?.code === "strategy_unsupported_semantics"
  );
  assert.equal(db.strategyStudioDrafts.length, 0);

  await assert.rejects(
    executeTool(db, run, "create_skill_from_idea", {
      name: "二次收盘确认突破",
      symbol: "BTC/USDT",
      direction: "long",
      timeframe: "1h",
      entry: "收盘突破过去 20 根 K 线最高价",
      confirmation: "连续两根收盘保持在突破位上方",
      stop: "入场价下方 2%",
      takeProfit: "2R",
      templateId: "breakout"
    }),
    (error) => error?.code === "strategy_unsupported_semantics"
      && error?.details?.unsupported?.includes("separate_confirmation")
  );
  assert.equal(db.strategyStudioDrafts.length, 0);
});

test("Agent strategy authoring requires an explicit symbol instead of silently defaulting to BTC", async () => {
  const db = seedDatabase();
  db.strategyStudioDrafts = [];
  db.mandates = [{ id: "mandate-authoring", status: "active", version: 1, allowedSymbols: ["BTC/USDT"] }];
  const run = {
    id: "run-missing-symbol-authoring",
    sessionId: "chat-authoring",
    role: "AI 交易员",
    tenantId: db.user.tenantId,
    requestedByUserId: db.user.id,
    principal: { tenantId: db.user.tenantId, userId: db.user.id, isOwner: true },
    steps: [],
    invocation: agentInvocationPolicy(userAgentInvocation({ permissions: ["write:review"] }))
  };

  await assert.rejects(
    executeTool(db, run, "create_skill_from_idea", {
      name: "通用突破策略",
      direction: "long",
      timeframe: "1h",
      entry: "收盘突破过去 20 根 K 线最高价",
      stop: "入场价下方 2%",
      takeProfit: "2R",
      templateId: "breakout"
    }),
    (error) => error?.code === "strategy_needs_clarification"
      && error?.details?.missing?.includes("symbol")
  );
  assert.equal(db.strategyStudioDrafts.length, 0);
});

test("Agent strategy authoring supports the ATR stop forms advertised by its tool contract", async () => {
  const db = seedDatabase();
  db.strategyStudioDrafts = [];
  const run = {
    id: "run-atr-authoring",
    sessionId: "chat-authoring",
    role: "AI 交易员",
    tenantId: db.user.tenantId,
    requestedByUserId: db.user.id,
    principal: { tenantId: db.user.tenantId, userId: db.user.id, isOwner: true },
    steps: [],
    invocation: agentInvocationPolicy(userAgentInvocation({ permissions: ["write:review"] }))
  };

  const result = await executeTool(db, run, "create_skill_from_idea", {
    name: "BTC ATR 突破",
    symbol: "BTC/USDT",
    direction: "long",
    timeframe: "1h",
    entry: "收盘突破过去 20 根 K 线最高价",
    stop: "2倍ATR自适应",
    takeProfit: "2R",
    templateId: "breakout"
  });
  const draft = db.strategyStudioDrafts.find((row) => row.id === result.strategyDraftId);
  assert.equal(draft.blueprint.exitPolicy.atrStop, true);
  assert.equal(draft.blueprint.exitPolicy.atrMult, 2);
  assert.equal(draft.blueprint.exitPolicy.atrPeriod, 14);
  assert.equal(result.stop, "2x ATR(14)");
  assert.equal(result.generatedTests.status, "passed");
});

test("Chat section only receives strategy drafts referenced by chat messages", () => {
  const db = seedDatabase();
  db.strategyStudioDrafts = [
    { id: "draft-visible", tenantId: db.user.tenantId, ownerUserId: db.user.id },
    { id: "draft-private", tenantId: "tenant-b", ownerUserId: "user-b" }
  ];
  db.chatMessages = [
    { id: "msg-1", strategyDraftId: "draft-visible" },
    { id: "msg-2", strategyDraftId: "draft-missing" },
    { id: "msg-3", strategyDraftId: "draft-visible" }
  ];
  assert.deepEqual(strategyDraftsReferencedByChat(db, { principal: { tenantId: db.user.tenantId, userId: db.user.id, isOwner: true } }).map((draft) => draft.id), ["draft-visible"]);
});
