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
  assert.equal(db.knowledge.tradingSkills.length, 0);
  assert.equal(db.knowledge.tradingMethods.length, 0);
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
