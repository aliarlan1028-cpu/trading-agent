import { runExpertAnalysis } from "./knowledgeEngine.mjs";
import { evaluateTradePlan } from "./riskEngine.mjs";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

const DEFAULT_COMMAND = "请先配置交易所 API 与 LLM API，并写下交易目标、交易对、最大杠杆和风险边界。";

export function getAgentStatus(db) {
  const activeMandate = findActiveMandate(db);
  const latestRun = db.agentRuns?.[0] || null;
  const latestPlan = db.tradePlans?.[0] || null;
  const latestBundle = latestPlan?.analysisBundleId
    ? db.analysisBundles.find((item) => item.id === latestPlan.analysisBundleId)
    : db.analysisBundles?.[0];
  const highImpactEvent = db.events?.find((event) => Number(event.impact || 0) >= 90);
  const state = deriveAgentState(db, activeMandate, latestRun, latestPlan);
  const reasonNotTrading = explainNoTrade(db, activeMandate, latestPlan, highImpactEvent);

  return {
    id: "agent_primary_trader",
    name: "AI 交易员",
    state,
    stateLabel: stateLabel(state),
    authorized: Boolean(activeMandate),
    activeMandate,
    currentGoal: activeMandate?.goal || latestRun?.goal || "等待配置交易所 API、LLM API 与授权委托。",
    currentObservation: latestPlan?.reasoningSummary || (hasConfiguredExchange(db) ? "可读取已配置账户与公开行情，尚未形成交易计划。" : "交易所 API 未配置，当前只能展示系统状态与配置检查。"),
    currentPlan: latestPlan || null,
    latestAnalysis: latestBundle || null,
    reasonNotTrading,
    nextActions: buildNextActions(db, latestPlan, highImpactEvent),
    riskWall: buildRiskWall(db, activeMandate),
    timeline: buildTimeline(db, latestRun),
    updatedAt: nowIso()
  };
}

export function parseMandateCommand(db, text = DEFAULT_COMMAND) {
  const command = String(text || DEFAULT_COMMAND).trim();
  const symbols = [];
  if (/BTC/i.test(command)) symbols.push("BTC/USDT");
  if (/ETH/i.test(command)) symbols.push("ETH/USDT");
  if (/SOL/i.test(command)) symbols.push("SOL/USDT");
  const leverage = Number(command.match(/(\d+)\s*[x倍]/i)?.[1] || 1);
  const dailyLoss = Number(command.match(/日(?:内)?(?:最大)?亏损(?:超过|上限)?\s*(\d+(?:\.\d+)?)%/)?.[1] || 2);
  const singleRisk = Number(command.match(/单笔(?:最大)?(?:亏损|风险).*?(\d+(?:\.\d+)?)%/)?.[1] || 0.5);
  const threshold = Number(command.match(/(\d+(?:,\d{3})*|\d+)\s*USDT.*?(?:确认|人工)/i)?.[1]?.replace(/,/g, "") || 20000);
  const noOpenBefore = Number(command.match(/(?:CPI|FOMC|非农).*?前\s*(\d+)\s*分钟/)?.[1] || 30);
  const exchange = /OKX/i.test(command) && !/Binance/i.test(command) ? "OKX" : "BINANCE";
  const now = new Date();
  const validUntil = new Date(now);
  validUntil.setHours(23, 59, 59, 0);

  return {
    id: id("mandate_draft"),
    name: "自然语言授权草案",
    status: "pending_confirmation",
    goal: command,
    exchanges: [exchange],
    exchange_scope: [exchange],
    account_scope: ["main"],
    marketTypes: ["perpetual_usdt"],
    market_scope: ["perpetual"],
    allowedSymbols: symbols,
    symbol_whitelist: symbols,
    deniedSymbols: [],
    symbol_blacklist: [],
    strategies: /趋势|trend/i.test(command) ? ["trend_following"] : ["trend_following", "event_protection"],
    strategy_scope: /趋势|trend/i.test(command) ? ["trend_following"] : ["trend_following", "event_protection"],
    maxLeverageBySymbol: Object.fromEntries(symbols.map((symbol) => [symbol, leverage])),
    max_leverage: leverage,
    maxSingleTradeRiskPct: singleRisk,
    max_single_trade_risk_pct: singleRisk,
    maxDailyLossPct: dailyLoss,
    max_daily_loss_pct: dailyLoss,
    maxWeeklyDrawdownPct: 5,
    max_weekly_drawdown_pct: 5,
    max_notional_usdt: threshold,
    allow_open_position: true,
    allow_close_position: true,
    allow_reduce_only: true,
    allow_add_position: false,
    manual_approval_threshold_usdt: threshold,
    event_restrictions: {
      high_impact_event_no_open_minutes_before: noOpenBefore,
      high_impact_event_no_open_minutes_after: 15
    },
    allowedActions: ["open", "cancel", "amend", "close", "move_stop", "take_profit"],
    validFrom: nowIso(),
    valid_from: nowIso(),
    validUntil: validUntil.toISOString(),
    valid_until: validUntil.toISOString(),
    createdAt: nowIso(),
    parsedFrom: command
  };
}

export function runAgentCommand(db, payload = {}) {
  const command = payload.command || payload.goal || DEFAULT_COMMAND;
  const mandateDraft = parseMandateCommand(db, command);
  const run = createAgentRun(db, command, mandateDraft);
  if (!mandateDraft.allowedSymbols.length) {
    run.status = "setup_required";
    run.steps.push(step("setup_required", "等待交易目标", "请在目标里写明至少一个交易对，例如 BTC、ETH 或 SOL；系统不会在缺少目标时生成交易计划。", run));
    appendAudit(db, "AgentOrchestrator 等待交易目标与配置", run.id, "AgentOrchestrator", "warning");
    appendTrace(db, "agent_orchestrator", "等待交易目标与配置", "warning");
    return { run, mandateDraft, message: "请先写明交易对和风险边界。", status: getAgentStatus(db) };
  }
  if (!findActiveMandate(db)) {
    const existingDraft = db.mandates.find((item) => item.id === mandateDraft.id);
    if (!existingDraft) db.mandates.unshift(mandateDraft);
    run.status = "awaiting_mandate_confirmation";
    run.mandateId = mandateDraft.id;
    run.steps.push(step("mandate_draft", "生成授权草案", `识别交易所 ${mandateDraft.exchanges.join(" / ")}，币种 ${mandateDraft.allowedSymbols.join("、")}；等待你确认激活后再生成交易计划。`, run));
    appendAudit(db, "AgentOrchestrator 生成授权草案，等待确认", mandateDraft.id, "AgentOrchestrator");
    appendTrace(db, "agent_orchestrator", "授权草案待确认", "paused");
    return { run, mandateDraft, message: "授权草案已生成。请先确认/激活授权，系统才会继续生成可执行交易计划。", status: getAgentStatus(db) };
  }
  const bundle = runExpertAnalysis(db, {
    trigger_type: "agent_orchestrator",
    question: command,
    symbol: mandateDraft.allowedSymbols[0],
    market_context: db.markets?.find((item) => item.symbol === mandateDraft.allowedSymbols[0])
  });
  bundle.agentRunId = run.id;
  bundle.hypothesis ||= `${mandateDraft.allowedSymbols[0]} 需要结合真实行情、账户状态与授权边界评估。`;
  bundle.supportingEvidence ||= ["已解析授权边界", "将使用真实行情与账户数据做风控"];
  bundle.opposingEvidence ||= ["未同步真实行情时不能生成可执行价格", "未激活授权时不能进入执行器"];
  bundle.riskNotes ||= ["必须带止损", "需通过 Mandate 与 RiskCheck"];
  bundle.finalSummary ||= bundle.summary;

  const intent = createTradeIntent(db, run, mandateDraft, bundle);
  const plan = createTradePlanFromIntent(db, intent, mandateDraft, bundle);
  const risk = evaluateTradePlan(db, plan);
  risk.tradePlanId = plan.id;
  risk.agentRunId = run.id;
  risk.result = mapRiskResult(risk);
  risk.riskScore = risk.decision === "blocked" ? 82 : risk.decision === "allowed_with_warnings" ? 56 : 38;
  risk.createdAt = nowIso();
  db.riskChecks.unshift(risk);
  plan.lastRiskCheck = risk;
  plan.status = risk.passed ? (requiresApproval(plan, mandateDraft) ? "awaiting_approval" : "approved") : "risk_rejected";
  plan.riskCheckId = risk.id;

  run.status = risk.passed ? plan.status : "blocked";
  run.analysisBundleId = bundle.id;
  run.tradeIntentId = intent.id;
  run.tradePlanId = plan.id;
  run.riskCheckId = risk.id;
  run.steps.push(
    step("mandate_checking", "检查授权草案", `识别交易所 ${mandateDraft.exchanges.join(" / ")}，币种 ${mandateDraft.allowedSymbols.join("、")}。`, run),
    step("observing", "观察市场与账户", "读取行情、持仓、事件、知识库和系统状态。", run, ["market.read", "event.read", "knowledge.query"]),
    step("analyzing", "生成证据包", bundle.finalSummary || bundle.summary, run, ["knowledge.query"]),
    step("planning", "生成交易意图与计划", `${plan.symbol} ${plan.direction}，等待 ${plan.entry?.range || plan.entry_range?.join(" - ")}。`, run),
    step("risk_checking", "硬风控检查", risk.summary, run, ["risk.check"])
  );
  if (risk.passed) run.steps.push(step(plan.status, plan.status === "awaiting_approval" ? "等待人工确认" : "计划已批准", plan.status === "awaiting_approval" ? "名义本金或策略条件触发人工确认阈值。" : "当前仅进入计划状态，不直接下单。", run));
  appendAudit(db, "AgentOrchestrator 运行授权-分析-计划-风控闭环", run.id, "AgentOrchestrator");
  appendTrace(db, "agent_orchestrator", command, run.status === "blocked" ? "blocked" : "ok");
  return { run, mandateDraft, analysisBundle: bundle, tradeIntent: intent, tradePlan: plan, riskCheck: risk, status: getAgentStatus(db) };
}

export function activateMandate(db, mandateId) {
  const mandate = db.mandates.find((item) => item.id === mandateId);
  if (!mandate) return null;
  mandate.status = "active";
  mandate.activatedAt = nowIso();
  appendAudit(db, "激活授权委托", mandate.id, "AgentOrchestrator");
  return mandate;
}

export function changeAgentRunStatus(db, runId, status) {
  const run = db.agentRuns.find((item) => item.id === runId);
  if (!run) return null;
  run.status = status;
  run.updatedAt = nowIso();
  run.steps ||= [];
  run.steps.push(step(status, `AgentRun ${status}`, "用户或系统更新 AgentRun 状态。", run));
  appendAudit(db, `AgentRun 状态变更：${status}`, run.id, "AgentOrchestrator", ["killed", "blocked", "failed"].includes(status) ? "warning" : "info");
  return run;
}

function createAgentRun(db, command, mandateDraft) {
  const run = {
    id: id("agent_run"),
    agentRunId: null,
    role: "AI 交易员",
    goal: command,
    status: "created",
    mandateDraftId: mandateDraft.id,
    steps: [],
    createdAt: nowIso()
  };
  run.agentRunId = run.id;
  db.agentRuns.unshift(run);
  return run;
}

function createTradeIntent(db, run, mandateDraft, bundle) {
  db.tradeIntents ||= [];
  const intent = {
    id: id("intent"),
    trade_intent_id: null,
    agentRunId: run.id,
    agent_run_id: run.id,
    analysisBundleId: bundle.id,
    symbol: mandateDraft.allowedSymbols[0],
    market_type: "perpetual",
    direction: /空|short/i.test(run.goal) ? "short" : /多|long|买/i.test(run.goal) ? "long" : "observe",
    time_horizon: "intraday",
    strategy_type: mandateDraft.strategies?.[0] || "manual_review",
    thesis: bundle.hypothesis,
    invalidation_condition: "缺少真实行情或授权边界不满足",
    confidence: 0,
    createdAt: nowIso(),
    created_at: nowIso()
  };
  intent.trade_intent_id = intent.id;
  db.tradeIntents.unshift(intent);
  return intent;
}

function createTradePlanFromIntent(db, intent, mandateDraft, bundle) {
  const market = db.markets?.find((item) => item.symbol === intent.symbol) || db.markets?.[0];
  const price = Number(market?.price || 0);
  const hasMarketPrice = Number.isFinite(price) && price > 0;
  const low = hasMarketPrice ? Math.round(price * 0.984) : null;
  const high = hasMarketPrice ? Math.round(price * 0.99) : null;
  const stop = hasMarketPrice ? Math.round(price * 0.965) : null;
  const tp1 = hasMarketPrice ? Math.round(price * 1.014) : null;
  const tp2 = hasMarketPrice ? Math.round(price * 1.038) : null;
  const plan = {
    id: id("plan"),
    trade_plan_id: null,
    tradeIntentId: intent.id,
    trade_intent_id: intent.id,
    agentRunId: intent.agentRunId,
    agent_run_id: intent.agentRunId,
    mandateId: findActiveMandate(db)?.id || mandateDraft.id,
    mandate_id: findActiveMandate(db)?.id || mandateDraft.id,
    analysisBundleId: bundle.id,
    analysis_bundle_id: bundle.id,
    exchange: mandateDraft.exchanges[0],
    marketType: "perpetual_usdt",
    market_type: "perpetual",
    symbol: intent.symbol,
    strategy: mandateDraft.strategies?.[0] || "manual_review",
    direction: intent.direction,
    entry: hasMarketPrice ? { type: "limit", range: `${low} - ${high}`, riskPercent: Math.min(0.45, mandateDraft.maxSingleTradeRiskPct) } : { type: "pending_market_data", range: "等待真实行情同步", riskPercent: 999 },
    entry_type: "limit",
    entry_range: hasMarketPrice ? [low, high] : [],
    stopLoss: stop,
    stop_loss: stop,
    takeProfit: hasMarketPrice ? [tp1, tp2] : [],
    take_profit: hasMarketPrice ? [tp1, tp2] : [],
    position_size_pct: 0,
    max_loss_pct: Math.min(0.45, mandateDraft.maxSingleTradeRiskPct),
    leverage: Math.min(3, mandateDraft.max_leverage),
    max_slippage_pct: 0.08,
    reduce_only: false,
    requires_human_approval: false,
    status: hasMarketPrice ? "draft" : "data_unavailable",
    reasoningSummary: hasMarketPrice ? (bundle.finalSummary || bundle.summary) : "缺少真实行情价格，不能生成可执行入场、止损和止盈。",
    createdAt: nowIso()
  };
  plan.trade_plan_id = plan.id;
  db.tradePlans.unshift(plan);
  return plan;
}

function step(phase, title, summary, run, tools = []) {
  const item = { id: id("step"), stepId: null, agentRunId: run.id, phase, title, summary, tools, createdAt: nowIso() };
  item.stepId = item.id;
  return item;
}

function findActiveMandate(db) {
  return db.mandates?.find((item) => ["active", "running"].includes(item.status));
}

function deriveAgentState(db, mandate, run, plan) {
  if (db.system.killSwitch) return "killed";
  if (!hasConfiguredExchange(db)) return "setup_required";
  if (!mandate) return "unauthorized";
  if (!db.system.autonomyEnabled) return "paused";
  if (run?.status === "awaiting_approval" || plan?.status === "awaiting_approval") return "awaiting_approval";
  if (plan?.status === "monitoring") return "monitoring";
  if (plan?.status === "approved" || plan?.status === "draft") return "waiting_entry";
  if (run?.status === "blocked" || plan?.status === "risk_rejected") return "risk_paused";
  return "observing";
}

function stateLabel(state) {
  return {
    setup_required: "待配置",
    unauthorized: "未授权",
    observing: "观察中",
    running: "运行中",
    waiting_entry: "等待入场",
    monitoring: "持仓管理",
    risk_paused: "风控暂停",
    paused: "已暂停",
    awaiting_approval: "等待确认",
    killed: "熔断"
  }[state] || state;
}

function explainNoTrade(db, mandate, plan, event) {
  if (db.system.killSwitch) return "系统处于熔断状态，禁止所有新交易。";
  if (!hasConfiguredExchange(db)) return "交易所 API 未配置，无法读取真实账户、持仓、委托与私有风控数据。";
  if (!mandate) return "尚未激活授权委托，AI 交易员只能观察、分析和生成建议。";
  if (!plan) return "尚未形成符合授权边界的交易计划。";
  if (plan.status === "risk_rejected") return plan.lastRiskCheck?.summary || "最近交易计划被风控拒绝。";
  if (plan.status === "awaiting_approval") return "交易计划需要人工确认，执行器不会自动提交订单。";
  if (event) return `${event.title} 为高影响事件，Agent 当前避免追单并等待风险窗口结束。`;
  return "当前计划处于等待入场条件阶段，不满足价格或风险条件时不会下单。";
}

function buildNextActions(db, plan, event) {
  if (!hasConfiguredExchange(db)) return ["配置交易所 API Key/Secret", "确认 API Key 无提现权限并设置 IP 白名单", "配置 LLM API Key", "同步公开行情与只读账户"];
  const actions = ["继续监控授权交易对与账户状态", "刷新公开行情、资金费率与事件风险", "必要时要求重新生成交易计划"];
  if (event) actions.unshift(`跟踪 ${event.title} 对交易权限的影响`);
  if (plan?.status === "awaiting_approval") actions.unshift("等待用户确认或取消计划");
  return actions.slice(0, 5);
}

function hasConfiguredExchange(db) {
  return (db.exchangeAccounts || []).some((account) => account.readEnabled);
}

function buildRiskWall(db, mandate) {
  return {
    mandateStatus: mandate?.status || "missing",
    validUntil: mandate?.validUntil || mandate?.valid_until,
    exchanges: mandate?.exchanges || mandate?.exchange_scope || [],
    symbols: mandate?.allowedSymbols || mandate?.symbol_whitelist || [],
    marketScope: mandate?.marketTypes || mandate?.market_scope || [],
    maxLeverage: mandate ? (mandate.max_leverage || Math.max(1, ...Object.values(mandate.maxLeverageBySymbol || { default: 1 }))) : null,
    singleRiskPct: mandate?.maxSingleTradeRiskPct || mandate?.max_single_trade_risk_pct,
    dailyLossPct: mandate?.maxDailyLossPct || mandate?.max_daily_loss_pct,
    remainingDailyLossUsdt: db.system.remainingDailyLossUsdt,
    allowOpen: mandate?.allow_open_position ?? false,
    allowClose: mandate?.allow_close_position ?? false,
    allowReduceOnly: mandate?.allow_reduce_only ?? false,
    allowAdd: mandate?.allow_add_position ?? false
  };
}

function buildTimeline(db, latestRun) {
  const runSteps = latestRun?.steps || [];
  const traceSteps = (db.traces || []).slice(0, 8).map((trace) => ({
    id: trace.id,
    phase: trace.type,
    title: trace.title,
    summary: trace.status,
    tools: [],
    createdAt: trace.createdAt
  }));
  return [...runSteps, ...traceSteps].slice(0, 12);
}

function mapRiskResult(risk) {
  if (!risk.passed) return "rejected";
  if (risk.decision === "allowed_with_warnings") return "approved_with_modification";
  return "approved";
}

function requiresApproval(plan, mandate) {
  const price = Number(plan.entry_range?.[1] || 0);
  const notional = price * 0.001;
  return notional > Number(mandate.manual_approval_threshold_usdt || Infinity);
}
