import { activeProvider, runAgentChat } from "./agentChat.mjs";
import { expireStalePlans } from "./agentOrchestrator.mjs";
import { refreshAccounting } from "./accounting.mjs";
import { syncPublicMarket } from "./exchangeConnector.mjs";
import { fetchMarketRegime } from "./marketSignals.mjs";
import { evaluateTradePlan } from "./riskEngine.mjs";
import { activeMandate, appendAudit, appendTrace, id, nowIso } from "./store.mjs";
import { consumeTriggeredWatches, describeWatch } from "./watchSentinel.mjs";
import { applyOperationalDegradation } from "./professionalRiskGate.mjs";

// ---------------------------------------------------------------------------
// 自主巡检循环：由调度器周期触发。
// LLM 已配置且授权激活时 → 走真实 LLM 决策循环（与对话共用一套工具与风控）；
// 否则做真实数据巡检（行情同步 + 核算 + 风控复查），不产生编造内容。
// ---------------------------------------------------------------------------

export async function runAgentCycle(db, payload = {}, saveDb) {
  const mandate = activeMandate(db);
  const provider = activeProvider();
  // 巡检开始先作废陈旧计划,避免后台把隔夜旧计划当成"待执行"误下单。
  expireStalePlans(db);
  const awaitingPlan = (db.tradePlans || []).find((plan) => plan.status === "awaiting_approval");

  // 前置巡检：同步授权交易对行情 + 刷新真实核算
  const symbols = mandate?.allowedSymbols?.length ? mandate.allowedSymbols : ["BTC/USDT"];
  const syncedSymbols = [];
  const syncErrors = []; // 失败原因必须留痕:空 catch 会让"没有机会"和"系统看不到数据"混为一谈(外审 P1)
  for (const symbol of symbols.slice(0, 3)) {
    try {
      await syncPublicMarket(db, "OKX", symbol);
      syncedSymbols.push(symbol);
    } catch (error) {
      syncErrors.push(`${symbol}: ${String(error.message || error).slice(0, 80)}`);
    }
  }
  if (syncErrors.length) appendTrace(db, "agent_cycle", `巡检行情同步失败 ${syncErrors.join("；")}`, "warning");
  const accounting = refreshAccounting(db);
  // 先给公开行情同步一次自愈机会，再按 SLO 裁定是否自动进入只减仓。
  // 否则调度刚启动时的旧缓存会在成功刷新前误触发永久人工解锁。
  applyOperationalDegradation(db, "AgentRuntime");

  // 先判大盘：全局大盘 + 首个交易对聪明钱（免费公开数据，容错，不阻断）
  let regime = null;
  try {
    regime = await fetchMarketRegime(symbols[0] || "BTC/USDT");
    db.marketRegime = {
    ...regime,
    global: regime.global || db.marketRegime?.global || null,       // 免费源 429 时保留上次好值
    smartMoney: regime.smartMoney || db.marketRegime?.smartMoney || null,
    updatedAt: nowIso()
  };
  } catch (error) {
    appendTrace(db, "agent_cycle", `大盘/聪明钱预取失败：${String(error.message || error).slice(0, 100)}（沿用上次快照）`, "warning");
  }
  const regimeSummary = [regime?.global?.interpretation, regime?.smartMoney?.ok ? regime.smartMoney.interpretation : null].filter(Boolean).join("；");

  // 观察哨触发消费：无论走 LLM 还是 patrol_only，都在这一轮处理掉，防止无限重触发
  const triggeredWatches = consumeTriggeredWatches(db);
  // 快速异动消费:哨兵探测到的急速涨跌,本轮消费掉并注入目标,让 AI 优先评估(用户实锤:ADA一小时跌4%没反应)
  const fastMoves = db.system.pendingFastMoves || [];
  db.system.pendingFastMoves = [];

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
      traceId: null,
      role: "AI 交易员",
      goal: payload.goal || "周期巡检",
      status: "patrol_only",
      source: "agent_cycle",
      steps: [
        { phase: "observe", summary: syncedSymbols.length ? `已同步 ${syncedSymbols.join("、")} 真实行情。` : "行情同步失败或无授权交易对。" },
        ...(fastMoves.length ? [{ phase: "fast_move", summary: `快速异动但本轮未进入 LLM 决策：${fastMoves.map((e) => `${e.symbol} ${e.windowMin}分钟${e.direction === "down" ? "跌" : "涨"}${e.movePct}%`).join("；")}。` }] : []),
        ...(triggeredWatches.length ? [{ phase: "watch", summary: `观察哨触发但本轮未进入 LLM 决策：${triggeredWatches.map((w) => `${describeWatch(w)}(触发价 ${w.triggerPrice})`).join("；")}。` }] : []),
        ...(regimeSummary ? [{ phase: "regime", summary: `大盘/聪明钱：${regimeSummary}。` }] : []),
        { phase: "accounting", summary: `今日盈亏 ${accounting.todayPnl ?? "未知"} USDT，剩余亏损预算 ${accounting.remainingDailyLossUsdt ?? "未授权"}。` },
        { phase: "decision", summary: `本轮不进入 LLM 决策：${skipReasons.join("；")}。` }
      ],
      createdAt: nowIso()
    };
    run.traceId = run.id;
    db.agentRuns.unshift(run);
    appendTrace(db, "agent_cycle", `巡检（${skipReasons[0]}）`, "ok");
    if (saveDb) saveDb(db);
    return run;
  }

  // 完整决策循环：与对话入口共用 runAgentChat（工具、风控、审计全一致）
  const regimeBullets = regimeSummary ? regimeSummary.split(/[;；]\s*/).filter(Boolean).map((x) => `- ${x.trim()}`).join("\n") : "";
  // 标题带批次开始时间(北京时间),用户在长会话里靠它区分每轮巡检。
  const startedHhmm = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" });
  const watchBullets = triggeredWatches.map((w) => `- ${describeWatch(w)} 已触发（触发价 ${w.triggerPrice}）${w.note ? ` · 登记理由：${w.note}` : ""}`);
  const moveBullets = fastMoves.map((e) => `- ${e.symbol} ${e.windowMin} 分钟内${e.direction === "down" ? "快速下跌" : "快速上涨"} ${e.movePct}%（现价 ${e.price}，自${e.direction === "down" ? "高" : "低"}点 ${e.refPrice}）`);
  const goal = payload.goal
    || [
      fastMoves.length ? `【⚠ 快速异动 · ${startedHhmm}】` : triggeredWatches.length ? `【⚠ 观察哨触发 · ${startedHhmm}】` : `【定时巡检 · ${startedHhmm}】`,
      ...(moveBullets.length ? [...moveBullets, ""] : []),
      ...(watchBullets.length ? [...watchBullets, ""] : []),
      `- 授权白名单：${mandate.allowedSymbols.join("、")}`,
      `- 单笔风险上限 ${mandate.maxSingleTradeRiskPct}% · 日亏上限 ${mandate.maxDailyLossPct}%`,
      ...(regimeBullets ? ["", "【大盘与聪明钱 · 系统预取，可调用 get_global_market / get_microstructure 复核】", regimeBullets] : []),
      "",
      "【本轮任务】",
      ...(fastMoves.length
        ? [
          "1. 立即复核异动币种：sync_market + get_microstructure 看这波急速涨跌是否伴随放量、订单簿失衡与结构破位（识别无量假突破/急跌诱空）；并调 explain_market_move 查这波【为什么】涨/跌（消息面催化/连锁清算/情绪），把原因和技术面一起看",
          "2. 顺势评估机会：急跌可评估做空或规避、急涨可评估做多或止盈；按授权边界与盈亏比决定是否 propose_trade_plan，不达标则说明原因",
          "3. 若判断后续还有关键触发位（如跌破某支撑加速），逐条 register_watch 登记让哨兵继续盯"
        ]
        : triggeredWatches.length
        ? [
          "1. 优先复核触发币种：用 sync_market / get_microstructure 确认触发是否伴随量能与结构（无量假突破/假跌破要识别出来）",
          "2. 确认有效则按授权边界评估是否提出交易计划；无效或不确定则说明原因，需要时重新登记观察哨",
          "3. 顺带检查其余授权交易对与大盘环境是否有变化"
        ]
        : [
          "1. 先判大盘：全局方向与情绪、大户/散户多空结构",
          "2. 再看个币：逐一检查授权交易对的行情、持仓与事件；对认真评估、可能提计划的币，调 explain_market_move 查它最新消息面（利空/利好/催化剂）——事件源未必覆盖到它，别只看 K 线，把消息面纳入方向判断",
          "3. 扩大视野找机会：调用 scan_market_opportunities 扫全市场永续（漏斗打分排 Top 候选，含白名单外的币），对排前候选用 sync_market/get_microstructure/analyze_market_structure 深分析；白名单内的达标就走第 4 步，白名单外若确属优质机会则在汇总里明确建议加白（附方向、理由与建议授权参数）",
          "4. 只有出现明确符合授权边界、且不与大盘/聪明钱明显背离的机会才提出交易计划；否则简要说明为什么继续观察",
          "5. 关键触发条件（若跌破/若突破/若回踩）必须逐条调用 register_watch 工具登记（想盯 3 个就调 3 次），绝不能只在回复里画“观察哨一览”表格——写表不等于登记，哨兵不会盯，等于骗自己。登记完文字里一句“已登记 N 个观察哨”即可，不要展开。"
        ])
    ].join("\n");
  // 自动巡检全部归入固定会话:此前每次巡检都新建会话,15 分钟一个,历史会话被无限堆满。
  // 交易计划另有一等公民承载(待批准卡片/计划卡/审计链),用户手动对话保持独立会话。
  db.chatSessions ||= [];
  if (!db.chatSessions.some((c) => c.id === "chat_autocycle")) {
    db.chatSessions.unshift({ id: "chat_autocycle", title: "自主巡检 · 自动汇总", status: "active", system: true, createdAt: nowIso(), updatedAt: nowIso() });
  }
  const result = await runAgentChat(db, { message: goal, sessionId: "chat_autocycle" }, saveDb);
  result.run.source = "agent_cycle";
  appendAudit(db, "定时自主巡检完成", result.run.id, "AgentCycle");
  return result.run;
}

// 巡检后复查最新执行中计划的风控（授权过期、预算变化等）
export function recheckActivePlanRisk(db) {
  // 计划时效清扫:awaiting/approved 超过 24h 自动过期(用户实锤:7 月 7 日的 approved 计划
  // 挂了 19 天仍可被执行;行情早已作废它,计划必须有保质期)。executing 不动(有真实仓位)。
  const EXPIRY_MS = 24 * 60 * 60 * 1000;
  for (const p of db.tradePlans || []) {
    if (!["awaiting_approval", "approved"].includes(p.status)) continue;
    const age = Date.now() - new Date(p.createdAt || 0).getTime();
    if (age > EXPIRY_MS) {
      p.status = "expired";
      p.expiredAt = nowIso();
      appendAudit(db, `计划超时自动过期(${Math.round(age / 3600000)}h 未成交):${p.symbol}`, p.id, "PlanExpiry", "info");
    }
  }
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
