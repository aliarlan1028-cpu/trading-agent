import assert from "node:assert/strict";
import test from "node:test";

import { executeTool } from "../server/agentChat.mjs";
import { seedDatabase } from "../server/store.mjs";

test("Agent 兼容工具创建策略工作室草稿而不是第二套知识技能", async () => {
  const db = seedDatabase();
  db.strategyStudioDrafts = [];
  db.knowledge.tradingSkills = [];
  db.knowledge.tradingMethods = [];
  const run = { id: "run-authoring", sessionId: "chat-authoring", role: "AI 交易员", steps: [] };
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
