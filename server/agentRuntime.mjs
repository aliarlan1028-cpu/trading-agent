import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";
import { runExpertAnalysis } from "./knowledgeEngine.mjs";
import { evaluateTradePlan } from "./riskEngine.mjs";

export function runAgentCycle(db, payload = {}) {
  const role = payload.role || "AI 交易员";
  const goal = payload.goal || "观察市场、事件、知识库与风险状态，并给出下一步动作";
  const symbol = payload.symbol || db.markets?.find((market) => market.price)?.symbol || "";
  const bundle = runExpertAnalysis(db, {
    trigger_type: "agent_cycle",
    question: `${role}：${goal}`,
    symbol,
    market_context: { symbol }
  });
  const plan = db.tradePlans[0];
  const risk = plan ? evaluateTradePlan(db, plan) : null;
  const run = {
    id: id("run"),
    role,
    goal,
    status: "completed",
    analysisBundleId: bundle.id,
    riskDecision: risk?.decision,
    steps: [
      { phase: "Observe", summary: symbol ? `读取 ${symbol} 行情、持仓、事件、任务心跳与知识库。` : "等待真实行情或用户指定交易对。" },
      { phase: "Think", summary: bundle.summary },
      { phase: "Act", summary: risk?.passed ? "允许进入低风险执行器或继续监控。" : "风控阻断，进入观察或降风险动作。" },
      { phase: "Stop", summary: "生成 AgentRun、Trace 和审计记录。" }
    ],
    createdAt: nowIso()
  };
  db.agentRuns.unshift(run);
  appendAudit(db, "运行 Agent ReAct 循环", run.id, role);
  appendTrace(db, "agent_run", `${role} ReAct`, "ok");
  return run;
}

export function updateStateFile(db, name, content) {
  const key = String(name || "").toUpperCase();
  if (!["USER", "AGENT", "HISTORY"].includes(key)) {
    throw new Error("Unknown state file");
  }
  db.agentStateFiles[key] ||= { id: `state_${key.toLowerCase()}`, title: `${key}.md`, content: "", updatedAt: nowIso() };
  db.agentStateFiles[key].content = content;
  db.agentStateFiles[key].updatedAt = nowIso();
  appendAudit(db, `更新状态文件 ${key}.md`, db.agentStateFiles[key].id, "Memory Agent");
  appendTrace(db, "state_file", `更新 ${key}.md`);
  return db.agentStateFiles[key];
}

export function addMemoryItem(db, payload = {}) {
  const item = {
    id: id("mem"),
    layer: payload.layer || "episodic",
    title: payload.title || "新记忆",
    content: payload.content || "",
    tags: payload.tags || [],
    source: payload.source || "manual",
    createdAt: nowIso()
  };
  db.memoryItems.unshift(item);
  appendAudit(db, "写入三层记忆", item.id, "Memory Agent");
  return item;
}
