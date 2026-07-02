import { runExpertAnalysis } from "./knowledgeEngine.mjs";
import { runReconciler } from "./reconciler.mjs";
import { evaluateTradePlan } from "./riskEngine.mjs";
import { runTask } from "./scheduler.mjs";
import { syncPrivateReadOnly, syncPublicMarket } from "./exchangeConnector.mjs";
import { executeTradeAction } from "./tradeActions.mjs";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

export function listTools() {
  return [
    { name: "market.read", description: "读取或同步公开行情" },
    { name: "account.sync_readonly", description: "同步交易所只读账户快照" },
    { name: "knowledge.query", description: "运行专家知识库分析" },
    { name: "risk.check", description: "检查交易计划风控" },
    { name: "reconciler.run", description: "运行账户/实时/订单对账" },
    { name: "task.run", description: "运行定时任务" },
    { name: "trade.write", description: "执行真实交易写操作，受安全闸门限制" }
  ];
}

export async function callTool(db, toolName, args = {}, saveDb) {
  const startedAt = Date.now();
  let result;
  if (toolName === "market.read") result = await syncPublicMarket(db, args.exchange || "BINANCE", args.symbol || "BTC/USDT");
  else if (toolName === "account.sync_readonly") result = await syncPrivateReadOnly(db, args.accountId || db.exchangeAccounts?.[0]?.id);
  else if (toolName === "knowledge.query") result = runExpertAnalysis(db, args);
  else if (toolName === "risk.check") result = evaluateTradePlan(db, args.plan || db.tradePlans?.[0] || {});
  else if (toolName === "reconciler.run") result = runReconciler(db, args);
  else if (toolName === "task.run") result = runTask(db, args.taskId || db.tasks?.[0]?.id, saveDb, "agent_tool");
  else if (toolName === "trade.write") result = await executeTradeAction(db, args.action || "place_order", args.payload || {});
  else result = { status: "unknown_tool", toolName };

  const execution = {
    id: id("tool"),
    toolName,
    args: redactArgs(args),
    resultSummary: summarize(result),
    latencyMs: Date.now() - startedAt,
    createdAt: nowIso()
  };
  db.toolExecutions.unshift(execution);
  appendAudit(db, `调用工具 ${toolName}`, execution.id, "ToolRouter", result?.status === "blocked" ? "warning" : "info");
  appendTrace(db, "tool_call", toolName, result?.status || "ok", execution.latencyMs);
  if (saveDb) saveDb(db);
  return { execution, result };
}

function redactArgs(args) {
  const text = JSON.stringify(args || {});
  return JSON.parse(text.replace(/apiSecret|secret|passphrase|password/gi, "redacted"));
}

function summarize(result) {
  if (!result) return "";
  if (typeof result === "string") return result.slice(0, 300);
  return JSON.stringify(result).slice(0, 600);
}
