import { activeProvider, runAgentChat } from "./agentChat.mjs";
import { refreshAccounting } from "./accounting.mjs";
import { syncPublicMarket } from "./exchangeConnector.mjs";
import { fetchMarketRegime } from "./marketSignals.mjs";
import { evaluateTradePlan } from "./riskEngine.mjs";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

// ---------------------------------------------------------------------------
// 自主巡检循环：由调度器周期触发。
// LLM 已配置且授权激活时 → 走真实 LLM 决策循环（与对话共用一套工具与风控）；
// 否则做真实数据巡检（行情同步 + 核算 + 风控复查），不产生编造内容。
// ---------------------------------------------------------------------------

export async function runAgentCycle(db, payload = {}, saveDb) {
  const mandate = (db.mandates || []).find((item) => ["active", "running"].includes(item.status));
  const provider = activeProvider();
  const awaitingPlan = (db.tradePlans || []).find((plan) => plan.status === "awaiting_approval");

  // 前置巡检：同步授权交易对行情 + 刷新真实核算
  const symbols = mandate?.allowedSymbols?.length ? mandate.allowedSymbols : ["BTC/USDT"];
  const syncedSymbols = [];
  for (const symbol of symbols.slice(0, 3)) {
    try {
      await syncPublicMarket(db, "OKX", symbol);
      syncedSymbols.push(symbol);
    } catch {}
  }
  const accounting = refreshAccounting(db);

  // 先判大盘：全局大盘 + 首个交易对聪明钱（免费公开数据，容错，不阻断）
  let regime = null;
  try {
    regime = await fetchMarketRegime(symbols[0] || "BTC/USDT");
    db.marketRegime = { ...regime, updatedAt: nowIso() };
  } catch {}
  const regimeSummary = [regime?.global?.interpretation, regime?.smartMoney?.ok ? regime.smartMoney.interpretation : null].filter(Boolean).join("；");

  const skipReasons = [];
  if (!db.system.autonomyEnabled) skipReasons.push("自主推进已暂停");
  if (db.system.killSwitch) skipReasons.push("熔断开启");
  if (!mandate) skipReasons.push("无激活授权");
  if (!provider) skipReasons.push("未配置 LLM");
  if (awaitingPlan) skipReasons.push(`已有待批准计划 ${awaitingPlan.id}，避免重复生成`);
  if (accounting.remainingDailyLossUsdt !== null && accounting.remainingDailyLossUsdt !== undefined && accounting.remainingDailyLossUsdt <= 0) {
    skipReasons.push("日亏损预算耗尽");
  }

  if (skipReasons.length) {
    const run = {
      id: id("run"),
      role: "AI 交易员",
      goal: payload.goal || "周期巡检",
      status: "patrol_only",
      source: "agent_cycle",
      steps: [
        { phase: "observe", summary: syncedSymbols.length ? `已同步 ${syncedSymbols.join("、")} 真实行情。` : "行情同步失败或无授权交易对。" },
        ...(regimeSummary ? [{ phase: "regime", summary: `大盘/聪明钱：${regimeSummary}。` }] : []),
        { phase: "accounting", summary: `今日盈亏 ${accounting.todayPnl ?? "未知"} USDT，剩余亏损预算 ${accounting.remainingDailyLossUsdt ?? "未授权"}。` },
        { phase: "decision", summary: `本轮不进入 LLM 决策：${skipReasons.join("；")}。` }
      ],
      createdAt: nowIso()
    };
    db.agentRuns.unshift(run);
    appendTrace(db, "agent_cycle", `巡检（${skipReasons[0]}）`, "ok");
    if (saveDb) saveDb(db);
    return run;
  }

  // 完整决策循环：与对话入口共用 runAgentChat（工具、风控、审计全一致）
  const goal = payload.goal
    || `【定时巡检】当前授权：${mandate.allowedSymbols.join("、")}，单笔风险上限 ${mandate.maxSingleTradeRiskPct}%，日亏上限 ${mandate.maxDailyLossPct}%。${regimeSummary ? `\n【大盘与聪明钱（已预取，可直接引用，也可调用 get_global_market / get_microstructure 复核）】${regimeSummary}。` : ""}\n请先判大盘再看个币：先看全局方向与情绪、大户/散户多空结构，再检查授权交易对的行情、持仓与事件；只有出现明确符合授权边界、且不与大盘/聪明钱明显背离的机会才提出交易计划，否则简要说明为什么继续观察。`;
  const result = await runAgentChat(db, { message: goal }, saveDb);
  result.run.source = "agent_cycle";
  appendAudit(db, "定时自主巡检完成", result.run.id, "AgentCycle");
  return result.run;
}

// 巡检后复查最新执行中计划的风控（授权过期、预算变化等）
export function recheckActivePlanRisk(db) {
  const plan = (db.tradePlans || []).find((item) => ["approved", "executing", "awaiting_approval"].includes(item.status));
  if (!plan) return null;
  const risk = evaluateTradePlan(db, plan);
  if (!risk.passed && plan.status !== "risk_rejected") {
    // 去重：同一计划的风控复查失败只保留一条 open 事件，重复只更新时间与计数，避免每轮巡检刷屏。
    const existing = (db.riskIncidents || []).find(
      (item) => item.status === "open" && item.source === plan.id && String(item.title || "").includes("风控复查失败")
    );
    if (existing) {
      existing.count = (existing.count || 1) + 1;
      existing.lastSeenAt = nowIso();
      existing.title = `计划 ${plan.symbol} 风控复查失败：${risk.summary}`;
    } else {
      appendAudit(db, `执行中计划风控复查失败：${risk.summary}`, plan.id, "AgentCycle", "warning");
      appendTrace(db, "risk_check", `${plan.symbol} 复查失败`, "blocked");
      db.riskIncidents.unshift({
        id: id("incident"),
        severity: "high",
        status: "open",
        title: `计划 ${plan.symbol} 风控复查失败：${risk.summary}`,
        source: plan.id,
        count: 1,
        createdAt: nowIso(),
        lastSeenAt: nowIso()
      });
    }
  }
  return risk;
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
