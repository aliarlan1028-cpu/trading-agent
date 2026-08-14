import assert from "node:assert/strict";
import test from "node:test";

import { actionableAgentText, classifyAgentChatIntent } from "../server/agentIntent.mjs";

test("否定的交易动作不会触发市场或事实预检", () => {
  const result = classifyAgentChatIntent("仅调用 explain_system。不要创建任务、策略、观察哨、交易计划，也不要执行任何系统操作。");
  assert.equal(result.marketAnalysisRequired, false);
  assert.equal(result.evidenceRequired, false);
  assert.doesNotMatch(result.actionableText, /交易计划/);
});

test("否定下单不会吞掉同句里的正向行情请求", () => {
  const result = classifyAgentChatIntent("分析 BTC/USDT 现在的走势，但不要下单，也不要创建交易计划。");
  assert.equal(result.marketAnalysisRequired, true);
  assert.equal(result.evidenceRequired, true);
  assert.match(result.actionableText, /BTC\/USDT/);
});

test("账户问题只触发事实包，不扩散成市场分析", () => {
  const result = classifyAgentChatIntent("不要交易，只告诉我账户余额和当前净值。");
  assert.equal(result.marketAnalysisRequired, false);
  assert.equal(result.evidenceRequired, true);
});

test("英文否定动作也会从关键词路由文本中移除", () => {
  assert.doesNotMatch(actionableAgentText("Do not create a trading plan; only explain the tool counter."), /trading plan/i);
  const result = classifyAgentChatIntent("Do not create a trading plan; only explain the tool counter.");
  assert.equal(result.marketAnalysisRequired, false);
  assert.equal(result.evidenceRequired, false);
});

test("自主巡检不受自然语言否定规则影响", () => {
  const result = classifyAgentChatIntent("不要分析市场", { autonomous: true });
  assert.equal(result.marketAnalysisRequired, true);
  assert.equal(result.evidenceRequired, true);
});
