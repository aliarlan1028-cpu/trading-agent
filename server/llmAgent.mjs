// ⚠️ DEPRECATED / 遗留路径。产品的主 Agent 是 agentChat.mjs（runAgentChat）——
// 记忆、知识、策略研究、模拟盘、Skill/MCP 工具都在那里。本文件（/api/llm-agent/run）
// 与 toolRouter.mjs 是早期的平行实现，仅为兼容旧接口保留，不要在此新增能力。
import OpenAI from "openai";
import { recordLangSmithRun } from "./langSmith.mjs";
import { callTool, listTools } from "./toolRouter.mjs";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

export async function runLlmAgent(db, payload = {}, saveDb) {
  const role = payload.role || "AI 交易员";
  const goal = payload.goal || "分析当前市场并提出下一步动作";
  const maxSteps = Number(payload.maxSteps || 4);
  const run = {
    id: id("llmrun"),
    role,
    goal,
    status: "running",
    steps: [],
    toolCalls: [],
    model: selectedModel(),
    createdAt: nowIso()
  };
  db.llmRuns.unshift(run);

  let context = buildContext(db, role, goal);
  for (let step = 0; step < maxSteps; step += 1) {
    const decision = await decideNextAction(context, role, goal);
    run.steps.push({ phase: "Think", content: decision.thought || decision.final || "", createdAt: nowIso() });
    if (decision.final || decision.action === "finish") {
      run.status = "completed";
      run.final = decision.final || decision.thought;
      break;
    }
    const toolName = decision.action || "knowledge.query";
    const { execution, result } = await callTool(db, toolName, decision.args || {}, saveDb);
    run.toolCalls.push(execution.id);
    run.steps.push({ phase: "Act", toolName, args: decision.args || {}, resultSummary: execution.resultSummary, createdAt: nowIso() });
    context += `\nTool ${toolName} result: ${execution.resultSummary}`;
  }
  if (run.status === "running") {
    run.status = "completed";
    run.final = run.steps.at(-1)?.content || "已完成多步观察。";
  }
  run.completedAt = nowIso();
  const langsmith = await recordLangSmithRun(db, { name: `${role}: ${goal}`, inputs: { role, goal }, outputs: { final: run.final }, runType: "chain" });
  run.langSmith = langsmith;
  appendAudit(db, "运行真实 LLM Agent", run.id, role);
  appendTrace(db, "llm_agent", `${role} ${goal}`, run.status);
  if (saveDb) saveDb(db);
  return run;
}

async function decideNextAction(context, role, goal) {
  if (!process.env.OPENAI_API_KEY && !process.env.DEEPSEEK_API_KEY) return deterministicDecision(context, goal);
  const provider = process.env.OPENAI_API_KEY ? "openai" : "deepseek";
  if (provider === "openai") {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.2",
      input: [
        { role: "system", content: systemPrompt() },
        { role: "user", content: `${context}\n\nRole: ${role}\nGoal: ${goal}\nReturn JSON only.` }
      ],
      temperature: 0.2
    });
    return parseDecision(response.output_text);
  }
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      messages: [{ role: "system", content: systemPrompt() }, { role: "user", content: `${context}\nRole: ${role}\nGoal: ${goal}\nReturn JSON only.` }],
      temperature: 0.2
    })
  });
  const json = await response.json();
  return parseDecision(json.choices?.[0]?.message?.content || "");
}

function deterministicDecision(context, goal) {
  if (!context.includes("knowledge.query")) return { thought: "先召回专家知识库和风险规则。", action: "knowledge.query", args: { question: goal, symbol: inferSymbol(goal) } };
  if (!context.includes("risk.check")) return { thought: "继续进行风控检查。", action: "risk.check", args: {} };
  return { final: "已完成知识召回与风控检查；真实写交易仍需 live guard、灰度策略和人工批准。" };
}

function inferSymbol(goal = "") {
  if (/BTC/i.test(goal)) return "BTC/USDT";
  if (/ETH/i.test(goal)) return "ETH/USDT";
  if (/SOL/i.test(goal)) return "SOL/USDT";
  return "";
}

function parseDecision(text) {
  try {
    return JSON.parse(text.replace(/^```json/i, "").replace(/```$/i, "").trim());
  } catch {
    return { final: text || "模型未返回可解析动作。" };
  }
}

function systemPrompt() {
  return `You are a trading agent runtime. Pick one tool from ${JSON.stringify(listTools().map((t) => t.name))} or finish. Return JSON: {"thought":"...","action":"tool.name","args":{...}} or {"final":"..."}. Never request secrets. Trade writes must be tiny, approved, and guard-checked.`;
}

function buildContext(db, role, goal) {
  return JSON.stringify({
    role,
    goal,
    portfolio: db.portfolio,
    system: db.system,
    topMarket: db.markets?.[0],
    activeEvents: db.events?.slice(0, 3),
    tools: listTools()
  });
}

function selectedModel() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_MODEL || "gpt-5.2";
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_MODEL || "deepseek-chat";
  return "deterministic-local";
}
