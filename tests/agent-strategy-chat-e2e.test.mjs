import assert from "node:assert/strict";
import test from "node:test";

import { runAgentChat } from "../server/agentChat.mjs";
import { userAgentInvocation } from "../server/agentInvocation.mjs";
import { resetLlmCircuits } from "../server/llmGateway.mjs";
import { seedDatabase } from "../server/store.mjs";

function openRouterResponse(message, index) {
  return new Response(JSON.stringify({
    id: `chatcmpl-strategy-${index}`,
    object: "chat.completion",
    created: 1,
    model: "google/gemini-test",
    choices: [{ index: 0, message, finish_reason: message.tool_calls?.length ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    openrouter_metadata: {
      strategy: "test",
      endpoints: { available: [{ selected: true, model: "google/gemini-test", provider: { name: "Google AI Studio" } }] }
    }
  }), { status: 200, headers: { "content-type": "application/json" } });
}

test("a real Agent chat model loop creates, persists and links the shared Strategy Studio draft", async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalModel = process.env.GEMINI_MODEL;
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  process.env.GEMINI_MODEL = "google/gemini-test";
  resetLlmCircuits();
  const requests = [];
  global.fetch = async (url, init = {}) => {
    if (!String(url?.url || url).includes("openrouter.ai/api/v1/chat/completions")) {
      return new Response(JSON.stringify({ error: "fixture blocks unrelated outbound calls" }), { status: 503, headers: { "content-type": "application/json" } });
    }
    const body = JSON.parse(init.body || "{}");
    requests.push(body);
    if (requests.length === 1) {
      return openRouterResponse({
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call-create-strategy",
          type: "function",
          function: {
            name: "create_skill_from_idea",
            arguments: JSON.stringify({
              name: "BTC 唐奇安突破",
              symbol: "BTC/USDT",
              direction: "long",
              timeframe: "1h",
              entry: "收盘突破过去 20 根 K 线最高价",
              stop: "入场价下方 2%",
              takeProfit: "2R",
              templateId: "breakout"
            })
          }
        }]
      }, 1);
    }
    return openRouterResponse({ role: "assistant", content: "策略工作室草稿已经创建并通过自动测试，请在工作室继续查看样本外证据。" }, 2);
  };

  try {
    const db = seedDatabase();
    db.strategyStudioDrafts = [];
    db.chatMessages = [];
    db.chatSessions = [];
    db.agentRuns = [];
    db.knowledge.tradingSkills = [];
    db.knowledge.tradingMethods = [];
    const result = await runAgentChat(db, {
      message: "帮我创建 BTC/USDT 1小时唐奇安20根突破做多策略，止损2%，止盈2R",
      tenantId: db.user.tenantId,
      userId: db.user.id,
      userName: db.user.name,
      isOwner: true,
      invocationContext: userAgentInvocation({ permissions: ["write:review"] })
    }, () => {});

    assert.equal(requests.length, 2);
    const authoringTool = requests[0].tools.find((row) => row.function?.name === "create_skill_from_idea")?.function;
    assert.ok(authoringTool);
    assert.ok(authoringTool.parameters.required.includes("symbol"));
    assert.match(authoringTool.parameters.properties.symbol.description, /必填/);
    assert.doesNotMatch(authoringTool.parameters.properties.symbol.description, /可选|不填则通用/);
    assert.equal(db.strategyStudioDrafts.length, 1);
    assert.equal(db.strategyStudioDrafts[0].authoring.channel, "agent_chat");
    assert.equal(db.strategyStudioDrafts[0].generatedTests.status, "passed");
    assert.equal(result.agentMessage.strategyDraftId, db.strategyStudioDrafts[0].id);
    assert.equal(result.run.strategyDraftId, db.strategyStudioDrafts[0].id);
    assert.equal(result.agentMessage.toolTrace.some((row) => row.name === "create_skill_from_idea"), true);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = originalModel;
    resetLlmCircuits();
  }
});
