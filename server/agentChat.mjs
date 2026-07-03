import OpenAI from "openai";
import { runExpertAnalysis } from "./knowledgeEngine.mjs";
import { retrieveChunksSemantic } from "./knowledgePipeline.mjs";
import { evaluateTradePlan } from "./riskEngine.mjs";
import { syncMicrostructure, syncPublicKlines, syncPublicMarket } from "./exchangeConnector.mjs";
import { runBacktest } from "./backtestEngine.mjs";
import { activeStrategyProfiles, runStrategyResearch } from "./strategyOptimizer.mjs";
import { buildPortfolioRisk } from "./portfolioRisk.mjs";
import { paperValidationSummary } from "./paperTrading.mjs";
import { enabledSkillTools, isSkillTool, runSkillTool } from "./skillTools.mjs";
import { notifyLark } from "./larkNotifier.mjs";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

const MAX_STEPS = 8;

// ---------------------------------------------------------------------------
// 工具定义：Agent 在对话循环中唯一能触达系统的方式。
// ---------------------------------------------------------------------------
const TOOL_DEFS = [
  {
    name: "sync_market",
    description: "同步指定交易对的真实公开行情与 K 线（Binance/OKX 公开数据，无需密钥）。分析任何行情前必须先调用。",
    schema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "交易对，如 BTC/USDT" },
        exchange: { type: "string", enum: ["BINANCE", "OKX"] },
        timeframe: { type: "string", enum: ["1m", "5m", "15m", "1h", "4h", "1d"] }
      },
      required: ["symbol"]
    }
  },
  {
    name: "get_microstructure",
    description: "读取合约市场微观结构：资金费率、未平仓量(OI)、订单簿买卖不平衡与点差。判断趋势/拥挤度/挤压风险时必须结合它，不要只看 K 线。",
    schema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "交易对，如 BTC/USDT" },
        exchange: { type: "string", enum: ["OKX", "BINANCE"] }
      },
      required: ["symbol"]
    }
  },
  {
    name: "get_account",
    description: "读取当前账户组合、持仓、交易所配置状态与风控预算。",
    schema: { type: "object", properties: {} }
  },
  {
    name: "get_events",
    description: "读取当前跟踪的宏观/交易所事件（CPI、FOMC 等）及影响评估。",
    schema: { type: "object", properties: {} }
  },
  {
    name: "query_knowledge",
    description: "查询专家知识库，返回相关规则、专家观点与引用。",
    schema: {
      type: "object",
      properties: {
        question: { type: "string" },
        symbol: { type: "string" }
      },
      required: ["question"]
    }
  },
  {
    name: "run_backtest",
    description: "在历史 K 线上回测一个均线交叉策略，返回胜率、盈亏比、最大回撤与期望 R。提出新策略或调参前用它验证，不要凭空断言策略有效。",
    schema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "交易对，如 BTC/USDT" },
        timeframe: { type: "string", enum: ["15m", "1h", "4h", "1d"] },
        fastPeriod: { type: "number", description: "快线周期，默认 10" },
        slowPeriod: { type: "number", description: "慢线周期，默认 30" },
        stopLossPct: { type: "number", description: "止损百分比，默认 2" },
        takeProfitR: { type: "number", description: "止盈 R 倍数，默认 2" }
      },
      required: ["symbol"]
    }
  },
  {
    name: "research_strategy",
    description: "对某交易对做自主策略研究：在多套策略（趋势/均值回归/突破）上做样本外寻优，返回样本外表现最好的策略与参数画像。想知道'这个币现在用什么策略靠谱'时用它，结果会写入长期记忆供后续决策。",
    schema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "交易对，如 BTC/USDT" },
        timeframe: { type: "string", enum: ["1h", "4h", "1d"] }
      },
      required: ["symbol"]
    }
  },
  {
    name: "create_mandate_draft",
    description: "把用户的自然语言授权目标固化为结构化授权委托草案（需用户在界面上确认激活后才生效）。",
    schema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "用户目标原文摘要" },
        exchanges: { type: "array", items: { type: "string" } },
        allowedSymbols: { type: "array", items: { type: "string" }, description: "如 [\"BTC/USDT\"]" },
        maxLeverage: { type: "number" },
        maxSingleTradeRiskPct: { type: "number" },
        maxDailyLossPct: { type: "number" },
        humanApprovalNotionalUsdt: { type: "number" },
        validHours: { type: "number" }
      },
      required: ["goal", "allowedSymbols"]
    }
  },
  {
    name: "remember",
    description: "把关于主人的长期偏好/风险偏好/交易风格，或本次得到的交易教训写入长期记忆，供未来所有会话使用。用户明确表达偏好、或你总结出可复用的经验时调用。",
    schema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["user_profile", "trading_discipline", "lesson"], description: "user_profile=写入主人档案 USER.md；trading_discipline=写入交易纪律 AGENT.md；lesson=写入长期记忆条目" },
        title: { type: "string", description: "记忆标题（lesson 用）" },
        content: { type: "string", description: "要记住的内容，一句话，具体可执行" }
      },
      required: ["scope", "content"]
    }
  },
  {
    name: "propose_trade_plan",
    description: "基于已同步的真实行情提出交易计划。计划会立即通过硬风控引擎检查，结果一并返回；通过后仍需人工批准才可能执行。入场/止损/止盈必须来自真实行情分析，不允许编造。",
    schema: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        direction: { type: "string", enum: ["long", "short"] },
        entryLow: { type: "number" },
        entryHigh: { type: "number" },
        stopLoss: { type: "number" },
        takeProfits: { type: "array", items: { type: "number" } },
        leverage: { type: "number" },
        riskPercent: { type: "number", description: "单笔风险占比，如 0.3" },
        rationale: { type: "string", description: "完整推理：依据哪些行情结构、知识规则与事件判断" }
      },
      required: ["symbol", "direction", "entryLow", "entryHigh", "stopLoss", "rationale"]
    }
  }
];

const BASE_RULES = `你是一名专业的数字货币自主交易员 Agent，服务唯一主人。工作语言为中文。

铁律：
1. 任何价格、指标、行情结论都必须来自 sync_market 返回的真实数据；没有同步过就说"尚未同步"，绝不编造数字。
2. 提出交易计划必须调用 propose_trade_plan，让硬风控引擎检查；不要在文本里口头给交易参数。
3. 用户给出交易目标/授权边界时，先调用 create_mandate_draft 固化，再继续分析。
4. 执行永远需要人工批准，你无权直接下单；不要承诺"已下单"。
5. 回答克制、专业、可解释：结论 + 依据 + 风险。不确定就说不确定。
6. 永远不索取或输出 API 密钥等敏感信息。
7. 你拥有长期记忆（下方"主人档案/交易纪律/近期历史/长期记忆"）与专业知识库（下方"相关专业知识"）。决策时必须结合它们：遵守主人的偏好与纪律，引用知识库结论并说明依据。`;

// ---------------------------------------------------------------------------
// 动态系统提示：把长期记忆（状态文件 + 三层记忆）与专业知识库（RAG 检索）
// 注入 LLM 上下文，让 Agent 真正"记得主人、掌握专业知识"。
// ---------------------------------------------------------------------------
function clip(text, max) {
  const value = String(text || "").trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export async function buildSystemPrompt(db, userText = "") {
  const sections = [BASE_RULES];
  const state = db.agentStateFiles || {};

  const user = clip(state.USER?.content, 1200);
  if (user && !user.startsWith("尚未配置")) sections.push(`【主人档案 USER.md】\n${user}`);

  const agent = clip(state.AGENT?.content, 1200);
  if (agent && !agent.startsWith("Agent 当前处于待配置")) sections.push(`【交易纪律 AGENT.md】\n${agent}`);

  const history = clip(state.HISTORY?.content, 1000);
  if (history && !history.startsWith("暂无真实运行历史")) sections.push(`【近期运行历史 HISTORY.md（最新在前）】\n${history}`);

  const memories = (db.memoryItems || []).slice(0, 8)
    .map((item) => `- [${item.layer || "memory"}] ${item.title}：${clip(item.content, 200)}`)
    .join("\n");
  if (memories) sections.push(`【长期记忆】\n${memories}`);

  const profiles = (db.strategyProfiles || []).filter((p) => p.strategyId).slice(0, 5);
  if (profiles.length) {
    const text = profiles
      .map((p) => `- ${p.symbol}(${p.timeframe})：优选「${p.label}」参数 ${JSON.stringify(p.params)}，样本外期望 ${p.test?.expectancyR ?? "-"}R / 胜率 ${p.test?.winRatePct ?? "-"}%，置信度 ${p.confidence}，regime ${p.regime}`)
      .join("\n");
    sections.push(`【已验证策略画像（自主学习闭环产出，提计划时优先采用与之一致的方向/策略；无合格策略的交易对要更保守）】\n${text}`);
  }

  const paper = paperValidationSummary(db);
  if (paper) sections.push(`【模拟盘前向验证状态（未通过前向验证的策略不要建议放大实盘，只观察或小额）】\n${paper}`);

  const pr = buildPortfolioRisk(db, db.mandates?.find((m) => ["active", "running"].includes(m.status)));
  if (pr.portfolioVolPct !== null) {
    sections.push(`【组合波动预算】当前组合日度波动 ${pr.portfolioVolPct}%，预算 ${pr.budgetPct}%，已用 ${pr.utilizationPct}%。接近或超过预算时应减小新仓名义额度或避免同向相关加仓（执行引擎会自动按组合波动上限压低仓位）。`);
  }

  const chunks = await retrieveChunksSemantic(db, userText, 5);
  if (chunks.length) {
    const knowledge = chunks
      .map((chunk, index) => `[[${index + 1}]] 来源：${chunk.citationLocator}\n${clip(chunk.text, 600)}`)
      .join("\n\n");
    sections.push(`【相关专业知识（从主人导入的知识库检索，可引用编号 [[n]]）】\n${knowledge}`);
  } else if ((db.knowledge?.chunks || []).length === 0) {
    sections.push("【专业知识库】主人尚未导入任何金融/交易知识，暂无可检索内容。");
  }

  return sections.join("\n\n");
}

// 每轮结束把结论沉淀进 HISTORY.md，形成跨会话的长期记忆。
function recordRunHistory(db, run, finalText) {
  db.agentStateFiles ||= {};
  db.agentStateFiles.HISTORY ||= { id: "state_history", title: "HISTORY.md", content: "", updatedAt: nowIso() };
  const stamp = nowIso();
  const outcome = run.tradePlanId
    ? `提出交易计划 ${run.tradePlanId}`
    : run.mandateId
      ? `生成授权草案 ${run.mandateId}`
      : "仅分析/观察";
  const line = `- ${stamp} · 目标：${clip(run.goal, 80)} · 结果：${outcome} · 结论：${clip(finalText, 160)}`;
  const existing = String(db.agentStateFiles.HISTORY.content || "").replace(/^暂无真实运行历史。?$/, "").trim();
  const lines = [line, ...(existing ? existing.split("\n") : [])].slice(0, 30);
  db.agentStateFiles.HISTORY.content = lines.join("\n");
  db.agentStateFiles.HISTORY.updatedAt = stamp;
}

// ---------------------------------------------------------------------------
// 工具执行
// ---------------------------------------------------------------------------
export async function executeTool(db, run, name, args = {}) {
  // 已启用的原生技能作为工具接入决策循环
  if (isSkillTool(name)) return runSkillTool(db, name, args);

  if (name === "sync_market") {
    const symbol = args.symbol || "BTC/USDT";
    const exchange = args.exchange || "BINANCE";
    const timeframe = args.timeframe || "1h";
    const [ticker, klines] = await Promise.all([
      syncPublicMarket(db, exchange, symbol).catch((error) => ({ error: error.message })),
      syncPublicKlines(db, exchange, symbol, timeframe).catch((error) => ({ error: error.message }))
    ]);
    const market = db.markets.find((item) => item.symbol === (symbol.includes("/") ? symbol : symbol.replace("USDT", "/USDT")));
    const candles = market?.candles || [];
    const recent = candles.slice(-48);
    return {
      symbol,
      timeframe,
      price: market?.price ?? ticker?.price,
      change24hPct: market?.changePct,
      high24h: market?.high24h,
      low24h: market?.low24h,
      volume24h: market?.volume24h,
      candleCount: candles.length,
      recentHigh: recent.length ? Math.max(...recent.map((c) => c.high)) : null,
      recentLow: recent.length ? Math.min(...recent.map((c) => c.low)) : null,
      lastCandles: candles.slice(-12).map((c) => ({ t: c.time, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume })),
      errors: [ticker?.error, klines?.error].filter(Boolean)
    };
  }

  if (name === "get_microstructure") {
    const symbol = args.symbol || "BTC/USDT";
    try {
      return await syncMicrostructure(db, args.exchange || "OKX", symbol);
    } catch (error) {
      return { error: `微观结构同步失败：${error.message}` };
    }
  }

  if (name === "get_account") {
    return {
      portfolio: db.portfolio,
      positions: db.positions,
      exchangeAccounts: (db.exchangeAccounts || []).map((account) => ({
        exchange: account.exchange,
        readEnabled: account.readEnabled,
        tradeEnabled: account.tradeEnabled
      })),
      liveTradingEnabled: db.system.liveTradingEnabled,
      killSwitch: db.system.killSwitch,
      remainingDailyLossUsdt: db.system.remainingDailyLossUsdt,
      activeMandate: db.mandates.find((item) => ["active", "running"].includes(item.status)) || null
    };
  }

  if (name === "get_events") {
    return (db.events || []).slice(0, 8).map((event) => ({
      title: event.title,
      category: event.category,
      due: event.due,
      impact: event.impact,
      action: event.action
    }));
  }

  if (name === "query_knowledge") {
    const retrieved = await retrieveChunksSemantic(db, `${args.question || ""} ${args.symbol || ""}`, 5);
    const bundle = runExpertAnalysis(db, {
      trigger_type: "agent_chat",
      question: args.question,
      symbol: args.symbol,
      retrieved,
      market_context: db.markets?.find((item) => item.symbol === args.symbol)
    });
    run.analysisBundleId = bundle.id;
    return {
      analysisBundleId: bundle.id,
      summary: bundle.finalSummary || bundle.summary,
      expertViews: bundle.expertViews,
      citations: bundle.citations
    };
  }

  if (name === "run_backtest") {
    try {
      const result = await runBacktest(db, args);
      run.backtestId = result.id;
      return result;
    } catch (error) {
      return { error: `回测失败：${error.message}` };
    }
  }

  if (name === "research_strategy") {
    try {
      const result = await runStrategyResearch(db, { symbols: [args.symbol], timeframe: args.timeframe || "4h" });
      const profile = activeStrategyProfiles(db, args.symbol)[0];
      run.strategyProfileId = profile?.id;
      return { profile, skipped: result.skipped };
    } catch (error) {
      return { error: `策略研究失败：${error.message}` };
    }
  }

  if (name === "create_mandate_draft") {
    const symbols = (args.allowedSymbols || []).map((s) => String(s).toUpperCase());
    const validHours = Number(args.validHours || 24);
    const mandate = {
      id: id("mandate"),
      name: "对话授权草案",
      status: "pending_confirmation",
      goal: args.goal,
      exchanges: args.exchanges?.length ? args.exchanges : ["BINANCE"],
      marketTypes: ["perpetual_usdt"],
      allowedSymbols: symbols,
      strategies: ["trend_following", "event_protection", "manual_review"],
      maxLeverageBySymbol: Object.fromEntries(symbols.map((s) => [s, Number(args.maxLeverage || 1)])),
      max_leverage: Number(args.maxLeverage || 1),
      maxSingleTradeRiskPct: Number(args.maxSingleTradeRiskPct || 0.5),
      maxDailyLossPct: Number(args.maxDailyLossPct || 1),
      humanApprovalNotionalUsdt: Number(args.humanApprovalNotionalUsdt || 5000),
      manual_approval_threshold_usdt: Number(args.humanApprovalNotionalUsdt || 5000),
      allowedActions: ["open", "cancel", "amend", "close", "move_stop", "take_profit"],
      validFrom: nowIso(),
      validUntil: new Date(Date.now() + validHours * 3600 * 1000).toISOString(),
      createdAt: nowIso(),
      source: "agent_chat"
    };
    db.mandates.unshift(mandate);
    run.mandateId = mandate.id;
    appendAudit(db, "Agent 对话生成授权草案", mandate.id, "AgentChat");
    return { mandateId: mandate.id, status: mandate.status, note: "草案已创建，等待用户在界面上确认激活。" };
  }

  if (name === "remember") {
    const content = String(args.content || "").trim();
    if (!content) return { error: "记忆内容不能为空" };
    db.agentStateFiles ||= {};
    const stamp = nowIso();
    if (args.scope === "user_profile") {
      const file = db.agentStateFiles.USER ||= { id: "state_user", title: "USER.md", content: "", updatedAt: stamp };
      const base = String(file.content || "").replace(/^尚未配置交易目标。.*$/, "").trim();
      file.content = `${base ? `${base}\n` : ""}- ${content}`.slice(0, 4000);
      file.updatedAt = stamp;
      appendAudit(db, "更新主人档案 USER.md", file.id, "AgentChat");
      return { scope: "user_profile", note: "已写入主人档案，未来会话会记得。" };
    }
    if (args.scope === "trading_discipline") {
      const file = db.agentStateFiles.AGENT ||= { id: "state_agent", title: "AGENT.md", content: "", updatedAt: stamp };
      const base = String(file.content || "").replace(/^Agent 当前处于待配置状态；.*$/, "").trim();
      file.content = `${base ? `${base}\n` : ""}- ${content}`.slice(0, 4000);
      file.updatedAt = stamp;
      appendAudit(db, "更新交易纪律 AGENT.md", file.id, "AgentChat");
      return { scope: "trading_discipline", note: "已写入交易纪律。" };
    }
    db.memoryItems ||= [];
    const item = { id: id("mem"), layer: "semantic", title: args.title || content.slice(0, 24), content, tags: ["agent_learned"], source: "agent_chat", createdAt: stamp };
    db.memoryItems.unshift(item);
    if (db.memoryItems.length > 200) db.memoryItems = db.memoryItems.slice(0, 200);
    appendAudit(db, "写入长期记忆", item.id, "AgentChat");
    return { scope: "lesson", memoryId: item.id, note: "已记住这条经验。" };
  }

  if (name === "propose_trade_plan") {
    const symbol = String(args.symbol || "").toUpperCase();
    const market = db.markets?.find((item) => item.symbol === symbol);
    if (!market?.price) {
      return { error: `尚未同步 ${symbol} 行情，请先调用 sync_market。` };
    }
    const mandate = db.mandates.find((item) => ["active", "running"].includes(item.status))
      || db.mandates.find((item) => item.id === run.mandateId)
      || db.mandates[0];
    const bundle = run.analysisBundleId
      ? db.analysisBundles.find((item) => item.id === run.analysisBundleId)
      : runExpertAnalysis(db, { trigger_type: "agent_chat", question: args.rationale, symbol });
    const riskPercent = Number(args.riskPercent || mandate?.maxSingleTradeRiskPct || 0.3);
    const plan = {
      id: id("plan"),
      agentRunId: run.id,
      agent_run_id: run.id,
      mandateId: mandate?.id,
      mandate_id: mandate?.id,
      analysisBundleId: bundle?.id,
      analysis_bundle_id: bundle?.id,
      exchange: mandate?.exchanges?.[0] || "BINANCE",
      marketType: "perpetual_usdt",
      market_type: "perpetual",
      symbol,
      strategy: mandate?.strategies?.[0] || "manual_review",
      direction: args.direction,
      entry: { type: "limit", range: `${args.entryLow} - ${args.entryHigh}`, riskPercent },
      entry_range: [Number(args.entryLow), Number(args.entryHigh)],
      stopLoss: Number(args.stopLoss),
      stop_loss: Number(args.stopLoss),
      takeProfit: (args.takeProfits || []).map(Number),
      take_profit: (args.takeProfits || []).map(Number),
      leverage: Number(args.leverage || 1),
      max_loss_pct: riskPercent,
      max_slippage_pct: 0.08,
      reduce_only: false,
      status: "draft",
      reasoningSummary: args.rationale,
      source: "agent_chat",
      createdAt: nowIso()
    };
    const risk = evaluateTradePlan(db, plan);
    risk.tradePlanId = plan.id;
    risk.agentRunId = run.id;
    risk.createdAt = nowIso();
    db.riskChecks.unshift(risk);
    plan.lastRiskCheck = risk;
    plan.riskCheckId = risk.id;
    plan.status = risk.passed ? "awaiting_approval" : "risk_rejected";
    db.tradePlans.unshift(plan);
    run.tradePlanId = plan.id;
    run.riskCheckId = risk.id;
    appendAudit(db, risk.passed ? "Agent 提出交易计划，待人工批准" : "Agent 交易计划被风控拒绝", plan.id, "AgentChat", risk.passed ? "info" : "warning");
    appendTrace(db, "agent_chat", `计划 ${symbol} ${args.direction}`, risk.passed ? "ok" : "blocked");
    if (plan.status === "awaiting_approval") {
      await notifyLark(db, {
        severity: "warning",
        title: "📈 新交易计划待你批准",
        body: `AI 交易员对 **${symbol}** 提出${args.direction === "short" ? "做空" : "做多"}计划，已通过硬风控，等待你在应用内批准。`,
        fields: [
          { label: "入场区间", value: `${args.entryLow} - ${args.entryHigh}` },
          { label: "止损", value: String(args.stopLoss) },
          { label: "止盈", value: (args.takeProfits || []).join(" / ") || "-" },
          { label: "风控", value: risk.summary || "通过" }
        ]
      });
    }
    return {
      planId: plan.id,
      status: plan.status,
      riskCheck: { passed: risk.passed, decision: risk.decision, summary: risk.summary, checks: risk.checks },
      note: risk.passed ? "计划已进入待批准队列，用户批准后才会进入执行链路。" : "计划被风控拒绝，请调整参数或修正授权边界。"
    };
  }

  return { error: `未知工具：${name}` };
}

// ---------------------------------------------------------------------------
// LLM Provider 适配
// ---------------------------------------------------------------------------
export function activeProvider() {
  if (process.env.ANTHROPIC_API_KEY) return { name: "anthropic", model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5" };
  if (process.env.OPENAI_API_KEY) return { name: "openai", model: process.env.OPENAI_MODEL || "gpt-5.2" };
  if (process.env.DEEPSEEK_API_KEY) return { name: "deepseek", model: process.env.DEEPSEEK_MODEL || "deepseek-chat" };
  return null;
}

async function anthropicTurn(model, messages, systemPrompt, tools) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: systemPrompt || BASE_RULES,
      messages,
      tools: (tools || TOOL_DEFS).map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.schema }))
    })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${body.slice(0, 300)}`);
  }
  return response.json();
}

async function openaiCompatTurn(providerName, model, messages, systemPrompt, tools) {
  const client = providerName === "deepseek"
    ? new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: "https://api.deepseek.com" })
    : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.chat.completions.create({
    model,
    messages: [{ role: "system", content: systemPrompt || BASE_RULES }, ...messages],
    tools: (tools || TOOL_DEFS).map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.schema } })),
    temperature: 0.2
  });
  return response.choices[0].message;
}

// ---------------------------------------------------------------------------
// 对话主循环
// ---------------------------------------------------------------------------
export async function runAgentChat(db, payload = {}, saveDb) {
  const userText = String(payload.message || "").trim();
  if (!userText) throw new Error("消息不能为空");

  db.chatMessages ||= [];
  const userMessage = { id: id("msg"), role: "user", content: userText, createdAt: nowIso() };
  db.chatMessages.push(userMessage);

  const run = {
    id: id("agent_run"),
    role: "AI 交易员",
    goal: userText,
    status: "running",
    source: "chat",
    steps: [],
    createdAt: nowIso()
  };
  db.agentRuns.unshift(run);

  const provider = activeProvider();
  const toolTrace = [];
  let finalText = "";
  let errorText = "";

  try {
    const systemPrompt = await buildSystemPrompt(db, userText);
    const tools = [...TOOL_DEFS, ...enabledSkillTools(db)];
    if (!provider) {
      finalText = await fallbackWithoutLlm(db, run, userText, toolTrace);
    } else if (provider.name === "anthropic") {
      finalText = await anthropicLoop(db, run, provider.model, userText, toolTrace, systemPrompt, tools);
    } else {
      finalText = await openaiLoop(db, run, provider, userText, toolTrace, systemPrompt, tools);
    }
    run.status = "completed";
    recordRunHistory(db, run, finalText);
  } catch (error) {
    run.status = "failed";
    errorText = error.message;
    finalText = `本轮决策循环出错：${error.message}`;
    appendAudit(db, "AgentChat 运行失败", run.id, "AgentChat", "warning");
  }

  run.completedAt = nowIso();
  const agentMessage = {
    id: id("msg"),
    role: "agent",
    content: finalText,
    model: provider ? `${provider.name}/${provider.model}` : "local-fallback",
    agentRunId: run.id,
    planId: run.tradePlanId || null,
    mandateId: run.mandateId || null,
    analysisBundleId: run.analysisBundleId || null,
    toolTrace,
    error: errorText || undefined,
    createdAt: nowIso()
  };
  db.chatMessages.push(agentMessage);
  if (db.chatMessages.length > 400) db.chatMessages = db.chatMessages.slice(-400);
  appendTrace(db, "agent_chat", userText.slice(0, 80), run.status === "completed" ? "ok" : "error");
  if (saveDb) saveDb(db);
  return { userMessage, agentMessage, run };
}

async function anthropicLoop(db, run, model, userText, toolTrace, systemPrompt, tools) {
  const history = buildHistoryForLlm(db);
  const messages = [...history, { role: "user", content: userText }];
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const response = await anthropicTurn(model, messages, systemPrompt, tools);
    const textParts = response.content.filter((block) => block.type === "text").map((block) => block.text);
    const toolUses = response.content.filter((block) => block.type === "tool_use");
    if (response.stop_reason !== "tool_use" || !toolUses.length) {
      return textParts.join("\n").trim() || "（模型未返回内容）";
    }
    messages.push({ role: "assistant", content: response.content });
    const results = [];
    for (const toolUse of toolUses) {
      const result = await runToolTracked(db, run, toolUse.name, toolUse.input, toolTrace);
      results.push({ type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify(result).slice(0, 6000) });
    }
    messages.push({ role: "user", content: results });
  }
  return "已达到单轮最大工具调用步数，以上是当前掌握的信息。";
}

async function openaiLoop(db, run, provider, userText, toolTrace, systemPrompt, tools) {
  const history = buildHistoryForLlm(db);
  const messages = [...history, { role: "user", content: userText }];
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const message = await openaiCompatTurn(provider.name, provider.model, messages, systemPrompt, tools);
    if (!message.tool_calls?.length) {
      return (message.content || "").trim() || "（模型未返回内容）";
    }
    messages.push(message);
    for (const toolCall of message.tool_calls) {
      let args = {};
      try { args = JSON.parse(toolCall.function.arguments || "{}"); } catch { args = {}; }
      const result = await runToolTracked(db, run, toolCall.function.name, args, toolTrace);
      messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result).slice(0, 6000) });
    }
  }
  return "已达到单轮最大工具调用步数，以上是当前掌握的信息。";
}

async function runToolTracked(db, run, name, args, toolTrace) {
  const startedAt = Date.now();
  let result;
  try {
    result = await executeTool(db, run, name, args);
  } catch (error) {
    result = { error: error.message };
  }
  const trace = {
    name,
    args: sanitizeArgs(args),
    summary: summarizeToolResult(name, result),
    latencyMs: Date.now() - startedAt
  };
  toolTrace.push(trace);
  run.steps.push({ id: id("step"), phase: name, title: `工具 ${name}`, summary: trace.summary, createdAt: nowIso() });
  return result;
}

function summarizeToolResult(name, result = {}) {
  if (result.error) return `失败：${result.error}`;
  if (isSkillTool(name)) return String(result.note || JSON.stringify(result)).slice(0, 160);
  if (name === "sync_market") return `${result.symbol} 现价 ${result.price ?? "-"}，${result.candleCount} 根 K 线（${result.timeframe}）`;
  if (name === "get_microstructure") return `资金费率 ${result.fundingRatePct ?? "-"}%，买盘占比 ${result.bookImbalancePct ?? "-"}%。${result.interpretation || ""}`;
  if (name === "run_backtest") return result.status === "ok" ? `回测 ${result.trades} 笔，胜率 ${result.winRatePct}%，盈亏比 ${result.profitFactor ?? "-"}，期望 ${result.expectancyR}R，最大回撤 ${result.maxDrawdownPct}%` : `回测未完成：${result.status}`;
  if (name === "research_strategy") return result.profile?.strategyId ? `优选「${result.profile.label}」，样本外期望 ${result.profile.test?.expectancyR ?? "-"}R，置信度 ${result.profile.confidence}` : "未找到合格策略（样本外均不达标）";
  if (name === "propose_trade_plan") return `${result.status}：${result.riskCheck?.summary || ""}`;
  if (name === "create_mandate_draft") return `授权草案 ${result.mandateId} 待确认`;
  if (name === "remember") return result.note || `已写入记忆（${result.scope}）`;
  if (name === "query_knowledge") return String(result.summary || "").slice(0, 120);
  if (name === "get_account") return `净值 ${result.portfolio?.totalEquityUsdt ?? "未同步"}，持仓 ${result.positions?.length || 0}`;
  if (name === "get_events") return `${Array.isArray(result) ? result.length : 0} 个事件`;
  return JSON.stringify(result).slice(0, 120);
}

function sanitizeArgs(args = {}) {
  return JSON.parse(JSON.stringify(args).replace(/apiSecret|secret|passphrase|password/gi, "redacted"));
}

function buildHistoryForLlm(db) {
  return (db.chatMessages || []).slice(-12, -1).map((message) => ({
    role: message.role === "agent" ? "assistant" : "user",
    content: String(message.content || "").slice(0, 2000)
  })).filter((message) => message.content);
}

// 无 LLM Key 时的诚实降级：仍然用真实数据，但明确说明能力受限。
async function fallbackWithoutLlm(db, run, userText, toolTrace) {
  const symbolMatch = userText.match(/\b(BTC|ETH|SOL|BNB|XRP|DOGE)\b/i);
  const lines = ["**当前未配置 LLM API Key（Anthropic / OpenAI / DeepSeek），我以本地规则模式运行，只能做数据同步与风控预检，无法做真正的行情分析。**", ""];
  if (symbolMatch) {
    const symbol = `${symbolMatch[1].toUpperCase()}/USDT`;
    const market = await runToolTracked(db, run, "sync_market", { symbol }, toolTrace);
    if (!market.error) {
      lines.push(`已同步真实行情：${symbol} 现价 ${market.price} USDT，24h 涨跌 ${market.change24hPct ?? "-"}%，近 48 根 K 线区间 ${market.recentLow} ~ ${market.recentHigh}。`);
    }
  }
  const account = await runToolTracked(db, run, "get_account", {}, toolTrace);
  if (!account.exchangeAccounts?.some((item) => item.readEnabled)) {
    lines.push("交易所 API 未配置：我读不到你的账户与持仓，只能使用公开行情。");
  }
  lines.push("", "配置任一 LLM Key 后，我可以：解析你的授权目标 → 结合行情/知识库/事件生成交易计划 → 通过硬风控检查后交给你批准。");
  return lines.join("\n");
}
