import OpenAI from "openai";
import { runExpertAnalysis } from "./knowledgeEngine.mjs";
import { retrieveChunksSemantic } from "./knowledgePipeline.mjs";
import { evaluateTradePlan } from "./riskEngine.mjs";
import { refreshApiKeyMetadata, syncMicrostructure, syncPrivateReadOnly, syncPublicKlines, syncPublicMarket } from "./exchangeConnector.mjs";
import { fetchGlobalMarket, fetchSmartMoney, evaluateSmartMoneyAlignment } from "./marketSignals.mjs";
import { fetchTokenProfile } from "./tokenProfile.mjs";
import { refreshEventSources } from "./eventSources.mjs";
import { runBacktest } from "./backtestEngine.mjs";
import { activeStrategyProfiles, runStrategyResearch } from "./strategyOptimizer.mjs";
import { buildPortfolioRisk } from "./portfolioRisk.mjs";
import { executeApprovedPlan } from "./executionEngine.mjs";
import { paperValidationSummary } from "./paperTrading.mjs";
import { refreshAccounting } from "./accounting.mjs";
import { enabledSkillTools, isSkillTool, runSkillTool } from "./skillTools.mjs";
import { enabledMcpTools, isMcpTool, runMcpTool } from "./mcpClient.mjs";
import { recordLangSmithRun } from "./langSmith.mjs";
import { notifyLark } from "./larkNotifier.mjs";
import { setConfig } from "./runtimeConfig.mjs";
import { scheduleTask } from "./scheduler.mjs";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

const MAX_STEPS = 8;

const SYSTEM_GUIDE = `【本系统内置说明】
- AI交易员：对话入口，可读取行情、账户、事件、知识、授权和风控状态；能创建授权草案、交易计划、定时任务，并触发事件刷新/账户同步等系统动作。
- 仪表盘：展示真实账户资产、今日盈亏、对账健康和收益质量；只有交易所私有只读同步成功后才显示真实资产。
- 系统设置 / 交易所：保存 Binance 或 OKX API。Binance 至少需要 Key+Secret，OKX 需要 Key+Secret+Passphrase 才能做账户只读同步。任何提现权限都不应开启。
- 实盘灰度：真实交易的最小额度试运行机制。它不是放开自动交易，而是在 liveTradingEnabled、确认风险、写单开关、最大名义额、人工批准和风控全部满足时，只允许小额度真实订单。
- 风控与授权：授权委托限定交易所、交易对、杠杆、单笔风险、日亏上限和人工审批阈值；交易计划必须经过硬风控。
- 事件与任务：事件源负责同步宏观/交易所事件；定时任务负责执行轮询、持仓监控、账户对账、策略研究、模拟盘推进等。
- 审计与通知：集中查看日志、任务运行、通知和安全审计；普通业务页只展示关键状态，不应堆流水账。
- Admin：Owner 管理用户、免费授权、订阅套餐、支付请求、Agent Profile 与安全维护。`;

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
    description: "读取合约市场微观结构 + 聪明钱：资金费率、未平仓量(OI)、订单簿买卖不平衡、点差，以及大户/散户多空持仓比与主动买卖比。判断趋势/拥挤度/挤压风险、以及'大资金在做多还是做空'时必须结合它，不要只看 K 线。",
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
    name: "get_token_profile",
    description: "读取某交易对的『波动+统计性格』画像：已实现/年化波动率、ATR 百分位（当前波动高低）、Hurst 指数/方差比/自相关（该币是趋势型还是均值回归型）、平均趋势游程。判断'这个币现在该用顺势还是回归打法、波动该收多大仓'时用它。基于历史 K 线统计，可验证。",
    schema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "交易对，如 BTC/USDT" },
        timeframe: { type: "string", enum: ["5m", "15m", "1h", "4h", "1d"] }
      },
      required: ["symbol"]
    }
  },
  {
    name: "get_global_market",
    description: "读取全局大盘：BTC 主导率、加密总市值 24h 趋势、恐惧贪婪指数。判断个币方向前应先看大盘——大盘走弱/极度贪婪时对做多更保守；BTC 主导率上升时山寨相对弱势。自上而下决策的第一步。",
    schema: { type: "object", properties: {} }
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
    description: "对某交易对做自主策略研究：在 13 套多空策略上做 train/val/test 三窗样本外寻优（计入手续费/滑点/资金费率，多周期趋势确认，ATR 自适应止损）。不传 timeframe 时自动扫描 15m/1h/4h 选样本外最优周期；只有 val 与 test 双窗都合格才采纳。想知道'这个币现在用什么策略、什么周期、该做多还是做空'时用它，结果写入长期记忆。",
    schema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "交易对，如 BTC/USDT" },
        timeframe: { type: "string", enum: ["5m", "15m", "1h", "4h", "1d"], description: "可选；省略则自动扫描 15m/1h/4h 选最优周期" }
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
    name: "explain_system",
    description: "解释本交易系统的内置概念、页面和工作流。用户问实盘灰度、授权、风控、任务、API、Admin、审计等系统问题时优先调用。",
    schema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "要解释的系统概念或页面" }
      },
      required: ["topic"]
    }
  },
  {
    name: "create_task",
    description: "按用户要求创建定时任务。可创建 Every/Cron/At 类型任务，适合巡检、刷新事件、账户同步、对账、策略研究等。",
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        type: { type: "string", enum: ["Every", "Cron", "At"] },
        schedule: { type: "string", description: "例如 Every 15m、0 */6 * * *、2026-07-06T10:00:00.000Z" },
        role: { type: "string" },
        handler: { type: "string", enum: ["", "execution_poll", "position_monitor", "accounting_refresh", "agent_cycle", "reconcile", "strategy_research", "paper_forward", "event_refresh", "okx_readonly_sync"] }
      },
      required: ["name", "type", "schedule"]
    }
  },
  {
    name: "refresh_events",
    description: "刷新真实事件源并把新事件写入系统。用户要求获取最新事件、刷新信息源、检查宏观/交易所公告时调用。",
    schema: { type: "object", properties: {} }
  },
  {
    name: "sync_exchange_account",
    description: "同步指定交易所的私有只读账户数据，用于检查 API 是否可用、资产/持仓是否能读取。",
    schema: {
      type: "object",
      properties: {
        exchange: { type: "string", enum: ["BINANCE", "OKX"] }
      },
      required: ["exchange"]
    }
  },
  {
    name: "configure_exchange_credentials",
    description: "保存交易所 API 凭证并立即做只读同步验证。只在用户明确要求配置且提供完整凭证时调用；不要在回复中回显密钥。",
    schema: {
      type: "object",
      properties: {
        exchange: { type: "string", enum: ["BINANCE", "OKX"] },
        apiKey: { type: "string" },
        apiSecret: { type: "string" },
        passphrase: { type: "string" },
        ipWhitelist: { type: "string" }
      },
      required: ["exchange", "apiKey", "apiSecret"]
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
  },
  {
    name: "request_action",
    description: "当主人明确要求你代为执行平台内部高敏操作时调用：批准交易计划、激活/暂停/撤销授权 Mandate、开关实盘闸（实盘写入/真实下单/小额灰度）、开启或解除一键熔断、运行账户对账。除对账外，都会先生成一张“待确认操作卡”，由主人在对话里点“确认”后才真正执行——你绝不能声称已执行，只说“已生成待确认操作，请确认”。一次只请求一个操作。",
    schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["approve_plan", "set_live_gate", "mandate", "kill_switch", "run_reconcile"] },
        planId: { type: "string", description: "approve_plan 时的交易计划 id，缺省用最近待批准计划" },
        gate: { type: "string", enum: ["live", "order_write", "gray"], description: "set_live_gate 时开哪道闸：live=实盘写入总开关+风险确认，order_write=真实下单写入，gray=小额灰度策略" },
        enabled: { type: "boolean", description: "set_live_gate/kill_switch 的开(true)/关(false)" },
        op: { type: "string", enum: ["activate", "pause", "revoke"], description: "mandate 操作" },
        mandateId: { type: "string", description: "mandate 操作的目标 id，缺省用最近一个 Mandate" }
      },
      required: ["type"]
    }
  },
  {
    name: "list_risk_incidents",
    description: "读取当前未处理（open）的风险事件列表，用于逐条分析后决定是否可以标记为已处理。",
    schema: { type: "object", properties: {} }
  },
  {
    name: "resolve_risk_incidents",
    description: "把已经分析确认无碍的风险事件标记为已处理（关闭）。可传具体 ids，或 all=true 关闭全部未处理事件。务必在真正逐条分析确认后再调用，并在 note 里简述处理结论。",
    schema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "要关闭的事件 id 列表" },
        all: { type: "boolean", description: "为 true 时关闭全部 open 事件" },
        note: { type: "string", description: "处理结论备注" }
      }
    }
  }
];

const BASE_RULES = `你是一名专业的数字货币自主交易员 Agent，服务唯一主人。工作语言为中文。

铁律：
1. 任何价格、指标、行情结论都必须来自 sync_market 返回的真实数据；没有同步过就说"尚未同步"，绝不编造数字。
2. 提出交易计划必须调用 propose_trade_plan，让硬风控引擎检查；不要在文本里口头给交易参数。
3. 用户给出交易目标/授权边界时，先调用 create_mandate_draft 固化，再继续分析。
【自主交易分工·最重要】主人只负责设定"授权边界"：允许交易的币对、单笔风险%、日亏上限、最大杠杆、是否开启自动执行。而"做多还是做空、入场/止损/止盈价位、时机、仓位大小"全部是你从真实数据（行情/微观结构/聪明钱/事件/知识库/已验证策略画像）分析后**自己决定**的——这正是"自主交易"的意义。**绝对不能反过来问主人"你想做多还是做空/单笔想亏多少"**。当有人问"你会怎么自动交易/你的步骤是什么"时，正确回答是：①确认或请主人设定授权边界(币对/单笔风险/日亏/杠杆) → ②同步真实行情与信号、结合知识库与已验证策略形成方向判断 → ③用 propose_trade_plan 产出结构化计划(方向/入场/止损/止盈/仓位)过硬风控 → ④在授权与额度内自动执行或转人工批准 → ⑤实时监控、按止盈止损/保本/跟踪管理仓位 → ⑥平仓后复盘沉淀。方向与参数是你的活，不是问主人。没有 Mandate 时只问边界，不问方向。
4. 默认执行需人工批准。仅当主人已开启实盘写入且在灰度策略里关闭「保留人工确认」时，你提出并通过硬风控的计划会在授权与名义金额上限内自动执行（超上限仍转人工批准）。不要在拿到工具返回的执行状态前声称"已下单"，一切以 propose_trade_plan 返回的 status/execution 为准。
5. 回答克制、专业、可解释：结论 + 依据 + 风险。不确定就说不确定。
6. 永远不索取或输出 API 密钥等敏感信息。
7. 你拥有长期记忆（下方"主人档案/交易纪律/近期历史/长期记忆"）与专业知识库（下方"相关专业知识"）。决策时必须结合它们：遵守主人的偏好与纪律，引用知识库结论并说明依据。
8. 用户问本系统功能、页面或配置概念时，优先使用内置系统说明，不要回答"知识库没有资料"。
9. 用户明确命令你执行系统内部操作时，优先调用工具完成；涉及密钥、实盘开关、清空数据、改密码等高敏操作时说明风险并避免回显敏感信息。

输出格式：
- 面向前端可视化展示，优先使用清晰 Markdown 小节：### 结论、### 依据、### 风险、### 下一步。
- 重要状态用"标签：内容"单独成行，例如"交易对：BTC/USDT"、"状态：等待授权"、"风险：重大事件前不建议开仓"。
- 列表每条只表达一个判断，避免大段长文本；需要行动时用 1. 2. 3. 步骤。
- 不要输出表格、HTML、JSON 或代码块，除非用户明确要求。

${SYSTEM_GUIDE}`;

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
      .map((p) => `- ${p.symbol}(${p.timeframe})：优选「${p.label}」${p.direction === "short" ? "做空" : "做多"} 参数 ${JSON.stringify(p.params)}，合并样本外期望 ${p.oosScore ?? "-"}R / 胜率 ${p.oos?.winRatePct ?? "-"}%（${p.oosFolds || "-"}），置信度 ${p.confidence}，regime ${p.regime}`)
      .join("\n");
    sections.push(`【已验证策略画像（自主学习闭环产出，提计划时优先采用与之一致的方向/策略；无合格策略的交易对要更保守）】\n${text}`);
  }

  const paper = paperValidationSummary(db);
  if (paper) sections.push(`【模拟盘前向验证状态（未通过前向验证的策略不要建议放大实盘，只观察或小额）】\n${paper}`);

  const pr = buildPortfolioRisk(db, db.mandates?.find((m) => ["active", "running"].includes(m.status)));
  if (pr.portfolioVolPct !== null) {
    sections.push(`【组合波动预算】当前组合日度波动 ${pr.portfolioVolPct}%，预算 ${pr.budgetPct}%，已用 ${pr.utilizationPct}%。接近或超过预算时应减小新仓名义额度或避免同向相关加仓（执行引擎会自动按组合波动上限压低仓位）。`);
  }

  // 实时账户快照：让 Agent 用当前真实数字说话，而不是靠 HISTORY.md / 记忆里的旧余额。
  try { refreshAccounting(db); } catch { /* 无账户数据时忽略 */ }
  const pf = db.portfolio || {};
  const snap = (db.accountSnapshots || [])[0];
  const acctBits = [];
  if (pf.totalEquityUsdt != null) acctBits.push(`总资产 ${pf.totalEquityUsdt} USDT`);
  if (pf.availableMarginUsdt != null) acctBits.push(`可用保证金 ${pf.availableMarginUsdt} USDT`);
  if (pf.todayPnl != null) acctBits.push(`今日盈亏 ${pf.todayPnl} USDT`);
  if (pf.unrealizedPnl != null) acctBits.push(`未实现盈亏 ${pf.unrealizedPnl} USDT`);
  const openPositions = db.positions || [];
  const posText = openPositions.slice(0, 8).map((p) => {
    const sym = p.symbol || p.instId || "?";
    const dir = String(p.direction || p.side || p.posSide || "").trim();
    const entry = p.entry ?? p.entryPrice ?? p.avgPx ?? p.avgPrice;
    const upl = p.pnl ?? p.upl ?? p.unrealizedPnl;
    return `${sym}${dir ? " " + dir : ""} 开仓 ${entry ?? "-"} 浮盈亏 ${upl ?? "-"}`;
  }).join("；");
  const lastSync = snap?.createdAt;
  const staleMin = lastSync ? Math.round((Date.now() - new Date(lastSync).getTime()) / 60000) : null;
  if (acctBits.length || openPositions.length || lastSync) {
    const body = [
      acctBits.length ? acctBits.join(" ｜ ") : "账户未同步或暂无数据",
      openPositions.length ? `持仓：${posText}` : "当前无持仓",
      lastSync
        ? `最后同步：${lastSync}（约 ${staleMin} 分钟前）${staleMin != null && staleMin > 5 ? " —— 已过期" : ""}`
        : "尚未同步过私有账户"
    ].join("\n");
    sections.push(`【实时账户快照（以此为准，禁止用记忆/历史里的旧余额或旧持仓回答；当用户问当前余额/持仓、或上面数据已过期时，先调用 sync_account 再 get_account 取最新值再作答）】\n${body}`);
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

  // A 路：已批准的纪律/风控规则必须无条件遵守。
  const approvedRules = (db.knowledge?.ruleProposals || []).filter((r) => r.status === "已批准");
  if (approvedRules.length) {
    const text = approvedRules.slice(0, 14)
      .map((r) => `- [${r.category || "纪律"}] ${r.name}${r.condition ? `（当 ${r.condition}）` : ""}${r.action && r.action !== "none" ? ` → ${r.action}` : ""}`)
      .join("\n");
    sections.push(`【交易纪律与风控规则（来自知识库、已人工批准，必须无条件遵守）】\n${text}`);
  }
  // B 路：书本交易方法/进场 setup —— 作为「参考专家方法」注入决策，帮 AI 判断"什么行情、什么信号该怎么进出"，
  // 提升方向与入场准确率。顾问性质：AI 结合当前真实行情/信号/风控自主决策，不照搬；风控闸门仍最终把关。
  const methods = db.knowledge?.tradingMethods || [];
  if (methods.length) {
    const text = methods.slice(0, 14)
      .map((m) => `- 《${m.source?.title || "书"}》${m.name}（${m.marketRegime} · ${m.symbolScope} · ${m.timeframe} · ${m.direction}）｜进场 ${m.entry || "-"}${m.confirmation ? `（确认:${m.confirmation}）` : ""}｜止损 ${m.stop || "-"}｜止盈 ${m.takeProfit || "-"}${m.invalidation ? `｜不做:${m.invalidation}` : ""}`)
      .join("\n");
    sections.push(`【书本交易方法·参考（共 ${methods.length} 条，来自你已学习的经典交易著作）】\n这些是专家总结的"什么行情、什么信号该怎么进出场"的方法框架。提计划时：先判断当前行情属于哪种 regime，再参考匹配的方法确定方向与入场/止损/止盈——但必须用当前真实数据与风控确认，不照搬、不硬套。\n${text}`);
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
// 高敏操作确认闸：Agent 不直接执行涉及资金/授权的动作，而是生成"待确认操作卡"，
// 由主人在对话里点确认后，经权限校验的接口执行（见 index.mjs /api/agent/actions/:id/confirm）。
function summarizePendingAction(db, args = {}) {
  switch (args.type) {
    case "approve_plan": {
      const plan = args.planId
        ? (db.tradePlans || []).find((p) => p.id === args.planId)
        : (db.tradePlans || []).find((p) => ["awaiting_approval", "risk_checked", "draft"].includes(p.status)) || db.tradePlans?.[0];
      return { targetId: plan?.id, title: "批准并执行交易计划", detail: plan ? `${plan.symbol || "?"} ${plan.direction || ""} · 计划 ${plan.id}` : "未找到可批准的交易计划", danger: true };
    }
    case "set_live_gate": {
      const map = { live: "实盘写入总开关 + 风险确认", order_write: "真实下单写入", gray: "小额灰度策略" };
      return { title: `${args.enabled === false ? "关闭" : "开启"} ${map[args.gate] || args.gate}`, detail: "改变实盘下单能力，属于高敏操作", danger: args.enabled !== false };
    }
    case "mandate": {
      const m = args.mandateId ? (db.mandates || []).find((x) => x.id === args.mandateId) : db.mandates?.[0];
      const opLabel = { activate: "激活", pause: "暂停", revoke: "撤销" }[args.op] || args.op;
      return { targetId: m?.id, title: `${opLabel}授权 Mandate`, detail: m ? `${m.name || m.id}` : "未找到 Mandate", danger: args.op === "activate" };
    }
    case "kill_switch":
      return { title: args.enabled === false ? "解除一键熔断" : "开启一键熔断", detail: args.enabled === false ? "解除后恢复正常交易闸门" : "立即阻断所有新交易", danger: args.enabled === false };
    case "run_reconcile":
      return { title: "运行账户对账", detail: "拉取交易所快照与本地状态核对", danger: false };
    default:
      return { title: "未知操作", detail: String(args.type || ""), danger: true };
  }
}

function createPendingAction(db, args = {}) {
  const info = summarizePendingAction(db, args);
  const record = {
    id: id("pact"),
    type: args.type,
    args: { ...args, resolvedTargetId: info.targetId || null },
    title: info.title,
    detail: info.detail,
    danger: Boolean(info.danger),
    status: "awaiting_confirmation",
    createdAt: nowIso()
  };
  db.pendingActions ||= [];
  db.pendingActions.unshift(record);
  return { status: "awaiting_confirmation", message: `已生成待确认操作：${record.title}。请在对话里点“确认”后才会真正执行。`, pendingAction: { id: record.id, title: record.title, detail: record.detail, danger: record.danger } };
}

export async function executeTool(db, run, name, args = {}) {
  // 已启用的原生技能作为工具接入决策循环
  if (isSkillTool(name)) return runSkillTool(db, name, args);
  // 已连接的 MCP server 工具
  if (isMcpTool(name)) return runMcpTool(db, name, args);

  if (name === "request_action") return createPendingAction(db, args);

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
      const micro = await syncMicrostructure(db, args.exchange || "OKX", symbol);
      // 叠加聪明钱：大户/散户多空持仓比、主动买卖比（免费公开数据，容错）
      const smart = await fetchSmartMoney(symbol).catch(() => null);
      if (smart?.ok) {
        return { ...micro, smartMoney: smart, interpretation: [micro.interpretation, smart.interpretation].filter(Boolean).join("；") };
      }
      return micro;
    } catch (error) {
      return { error: `微观结构同步失败：${error.message}` };
    }
  }

  if (name === "get_token_profile") {
    try {
      return await fetchTokenProfile(args.symbol || "BTC/USDT", args.timeframe || "1h");
    } catch (error) {
      return { error: `币种画像失败：${error.message}` };
    }
  }

  if (name === "get_global_market") {
    try {
      const global = await fetchGlobalMarket();
      db.marketRegime = { ...(db.marketRegime || {}), global, updatedAt: nowIso() };
      return global;
    } catch (error) {
      return { error: `全局大盘同步失败：${error.message}` };
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

  if (name === "list_risk_incidents") {
    return (db.riskIncidents || []).filter((item) => item.status === "open").slice(0, 40).map((item) => ({
      id: item.id, title: item.title, severity: item.severity, source: item.source, createdAt: item.createdAt
    }));
  }

  if (name === "resolve_risk_incidents") {
    const open = (db.riskIncidents || []).filter((item) => item.status === "open");
    const targets = args.all ? open : open.filter((item) => (args.ids || []).includes(item.id));
    const now = nowIso();
    for (const incident of targets) {
      incident.status = "resolved";
      incident.resolvedAt = now;
      incident.resolvedBy = "AI";
      if (args.note) incident.resolveNote = String(args.note).slice(0, 500);
    }
    if (targets.length) appendAudit(db, `AI 标记 ${targets.length} 个风险事件为已处理${args.note ? `：${args.note}` : ""}`, "risk.incidents", "AI", "info");
    return { closed: targets.length, remaining: open.length - targets.length };
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
      // 不传 timeframe → 自动多周期扫描（15m/1h/4h）选样本外最优；传了则只跑该周期。
      const result = await runStrategyResearch(db, { symbols: [args.symbol], timeframe: args.timeframe });
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
      // 风控闸门（riskWall）只读这几个字段；缺了 allow_open_position 会导致激活后仍"禁止开仓"。
      allow_open_position: true,
      allow_close_position: true,
      allow_reduce_only: true,
      allow_add_position: false,
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

  if (name === "explain_system") {
    const topic = String(args.topic || "系统").trim();
    const lines = SYSTEM_GUIDE.split("\n").filter((line) => line.includes(topic) || topic.includes(line.split("：")[0]?.replace(/^- /, "")));
    return {
      topic,
      guide: lines.length ? lines.join("\n") : SYSTEM_GUIDE,
      note: "这是系统内置说明，不依赖外部知识库。"
    };
  }

  if (name === "create_task") {
    const task = {
      id: id("task"),
      name: String(args.name || "Agent 创建任务").trim(),
      type: args.type || "Every",
      schedule: args.schedule || "Every 1h",
      role: args.role || "Agent",
      handler: args.handler || "",
      enabled: true,
      status: "running",
      createdAt: nowIso(),
      source: "agent_chat"
    };
    db.tasks ||= [];
    db.tasks.unshift(task);
    scheduleTask(db, task);
    appendAudit(db, `Agent 创建定时任务：${task.name}`, task.id, "AgentChat");
    return { status: "ok", taskId: task.id, name: task.name, schedule: task.schedule, handler: task.handler || "custom" };
  }

  if (name === "refresh_events") {
    const result = await refreshEventSources(db);
    return { ...result, eventCount: db.events?.length || 0, latest: (db.events || []).slice(0, 5).map((event) => ({ title: event.title, due: event.due, category: event.category })) };
  }

  if (name === "sync_exchange_account") {
    const exchange = String(args.exchange || "").toUpperCase();
    const account = (db.exchangeAccounts || []).find((item) => item.exchange === exchange);
    if (!account) return { status: "missing_account", exchange };
    const snapshot = await syncPrivateReadOnly(db, account.id);
    return { status: snapshot.status, exchange, error: snapshot.error, positions: snapshot.positions?.length || 0, balances: snapshot.balances?.length || 0, createdAt: snapshot.createdAt };
  }

  if (name === "configure_exchange_credentials") {
    const exchange = String(args.exchange || "").toUpperCase();
    if (!["BINANCE", "OKX"].includes(exchange)) return { status: "invalid_exchange" };
    const entries = exchange === "OKX"
      ? { OKX_API_KEY: args.apiKey, OKX_API_SECRET: args.apiSecret, OKX_API_PASSPHRASE: args.passphrase }
      : { BINANCE_API_KEY: args.apiKey, BINANCE_API_SECRET: args.apiSecret };
    const applied = setConfig(db, entries);
    const account = (db.exchangeAccounts || []).find((item) => item.exchange === exchange);
    if (account && args.ipWhitelist !== undefined) account.ipWhitelist = args.ipWhitelist || "建议开启";
    refreshApiKeyMetadata(db);
    const snapshot = account?.readEnabled
      ? await syncPrivateReadOnly(db, account.id)
      : { status: "missing_credentials", error: exchange === "OKX" ? "OKX 需要 API Key、Secret、Passphrase 三项。" : "Binance 需要 API Key、Secret 两项。" };
    appendAudit(db, `Agent 配置 ${exchange} API 凭证`, account?.id || exchange, "AgentChat", "warning");
    return { status: snapshot.status, exchange, applied, error: snapshot.error, note: snapshot.status === "ok" ? "凭证已保存并通过只读同步验证。" : "凭证已保存，但只读同步未通过。" };
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
    // 聪明钱择时过滤（软性）：拉当前交易对的大户/散户/爆仓，判断与计划方向是否对齐。
    const smartMoney = await fetchSmartMoney(symbol).catch(() => null);
    const alignment = evaluateSmartMoneyAlignment(smartMoney, plan.direction);
    plan.smartMoneyAlignment = alignment;
    if (alignment.alignment === "caution") {
      risk.warnings = [...(risk.warnings || []), `聪明钱择时：与${plan.direction === "short" ? "做空" : "做多"}方向相悖（${alignment.reasons.join("；")}）`];
    }
    db.riskChecks.unshift(risk);
    plan.lastRiskCheck = risk;
    plan.riskCheckId = risk.id;
    plan.status = risk.passed ? "awaiting_approval" : "risk_rejected";
    db.tradePlans.unshift(plan);
    run.tradePlanId = plan.id;
    run.riskCheckId = risk.id;
    // 授权后全自动执行：仅当①实盘写入已开启 ②灰度策略关闭「保留人工确认」时，AI 自主批准并下单。
    // 名义金额超过灰度上限会被写入闸拦截 → 自动回退为待人工批准（大单永远需要你拍板，防御纵深）。
    let autoExecution = null;
    if (plan.status === "awaiting_approval") {
      const grayPolicy = (db.grayReleasePolicies || []).find((p) => p.enabled);
      const autoEligible = db.system.liveTradingEnabled === true && grayPolicy && grayPolicy.requiresManualApproval === false;
      if (autoEligible) {
        plan.status = "approved";
        plan.approvedAt = nowIso();
        plan.approvedBy = "AI·自动执行";
        plan.autoApproved = true;
        autoExecution = await executeApprovedPlan(db, plan.id, { manualApproval: false, autoExecuted: true });
        if (["submitted", "dry_run"].includes(autoExecution.status)) {
          appendAudit(db, `AI 自动批准并执行（${autoExecution.status}）：${symbol} ${plan.direction}`, plan.id, "AgentAuto", "critical");
          appendTrace(db, "agent_chat", `自动执行 ${symbol} ${plan.direction}`, "ok");
          await notifyLark(db, {
            severity: "critical",
            title: "🤖 AI 已自动执行交易",
            body: `对 **${symbol}** ${plan.direction === "short" ? "做空" : "做多"}，已在授权与灰度上限内自动${autoExecution.status === "submitted" ? "提交交易所" : "干跑（实盘写入未开）"}。`,
            fields: [{ label: "入场", value: `${args.entryLow} - ${args.entryHigh}` }, { label: "止损", value: String(args.stopLoss) }]
          });
        } else {
          // 被安全闸拦截（超上限/快照过期等）→ 回退人工批准
          plan.status = "awaiting_approval";
          plan.autoApproved = false;
          autoExecution = { ...autoExecution, fellBackToManual: true };
          appendAudit(db, `自动执行被安全闸拦截（${autoExecution.reason || autoExecution.status}），转人工批准`, plan.id, "AgentAuto", "warning");
        }
      }
    }

    if (!plan.autoApproved) {
      appendAudit(db, risk.passed ? "Agent 提出交易计划，待人工批准" : "Agent 交易计划被风控拒绝", plan.id, "AgentChat", risk.passed ? "info" : "warning");
      appendTrace(db, "agent_chat", `计划 ${symbol} ${args.direction}`, risk.passed ? "ok" : "blocked");
    }
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
      autoExecuted: plan.autoApproved === true,
      execution: autoExecution ? { status: autoExecution.status, reason: autoExecution.reason || null } : null,
      riskCheck: { passed: risk.passed, decision: risk.decision, summary: risk.summary, checks: risk.checks, warnings: risk.warnings || [] },
      smartMoneyAlignment: alignment,
      note: plan.autoApproved
        ? `已在授权与灰度上限内自动执行（${autoExecution.status}）。`
        : (risk.passed ? "计划已进入待批准队列，用户批准后才会进入执行链路。" : "计划被风控拒绝，请调整参数或修正授权边界。")
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
  if (process.env.DEEPSEEK_API_KEY) return { name: "deepseek", model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash" };
  if (process.env.GEMINI_API_KEY) return { name: "gemini", model: process.env.GEMINI_MODEL || "gemini-2.5-pro" };
  return null;
}

// OpenAI 兼容客户端：DeepSeek / Gemini 走各自 baseURL，其余走 OpenAI。
function openAiCompatClient(providerName) {
  if (providerName === "deepseek") return new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: "https://api.deepseek.com" });
  if (providerName === "gemini") return new OpenAI({ apiKey: process.env.GEMINI_API_KEY, baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/" });
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// 简单文本补全（无工具），供知识蒸馏等复用。无 LLM key 时返回 null。
export async function llmComplete(userText, systemPrompt = "") {
  const provider = activeProvider();
  if (!provider) return null;
  try {
    if (provider.name === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: provider.model, max_tokens: 2048, system: systemPrompt || "你是专业的金融知识蒸馏助手。", messages: [{ role: "user", content: String(userText).slice(0, 24000) }] })
      });
      if (!res.ok) throw new Error(`Anthropic ${res.status}`);
      const json = await res.json();
      return (json.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    }
    const client = openAiCompatClient(provider.name);
    const res = await client.chat.completions.create({
      model: provider.model,
      messages: [
        { role: "system", content: systemPrompt || "你是专业的金融知识蒸馏助手。" },
        { role: "user", content: String(userText).slice(0, 24000) }
      ],
      temperature: 0.2
    });
    return res.choices?.[0]?.message?.content || null;
  } catch {
    return null;
  }
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
  const client = openAiCompatClient(providerName);
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
  const session = ensureChatSession(db, payload.sessionId, userText);
  const userMessage = { id: id("msg"), sessionId: session.id, role: "user", content: userText, createdAt: nowIso() };
  db.chatMessages.push(userMessage);

  const run = {
    id: id("agent_run"),
    role: "AI 交易员",
    goal: userText,
    status: "running",
    source: "chat",
    sessionId: session.id,
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
    const tools = [...TOOL_DEFS, ...enabledSkillTools(db), ...enabledMcpTools(db)];
    if (!provider) {
      finalText = await fallbackWithoutLlm(db, run, userText, toolTrace);
    } else if (provider.name === "anthropic") {
      finalText = await anthropicLoop(db, run, provider.model, userText, toolTrace, systemPrompt, tools, session.id);
    } else {
      finalText = await openaiLoop(db, run, provider, userText, toolTrace, systemPrompt, tools, session.id);
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
  // 主对话 agent 的运行上报 LangSmith（配 key 则推云端，否则本地记录）；失败不影响对话。
  try {
    run.langSmith = await recordLangSmithRun(db, {
      name: `AI交易员: ${userText.slice(0, 60)}`,
      inputs: { message: userText },
      outputs: { final: finalText, toolCalls: toolTrace.length, status: run.status },
      runType: "chain",
      startTime: run.createdAt
    });
  } catch { /* tracing 不阻断主流程 */ }
  const agentMessage = {
    id: id("msg"),
    sessionId: session.id,
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
  session.updatedAt = agentMessage.createdAt;
  session.lastMessage = finalText.slice(0, 120);
  if (db.chatMessages.length > 400) db.chatMessages = db.chatMessages.slice(-400);
  appendTrace(db, "agent_chat", userText.slice(0, 80), run.status === "completed" ? "ok" : "error");
  if (saveDb) saveDb(db);
  return { userMessage, agentMessage, run };
}

function ensureChatSession(db, sessionId, firstMessage = "") {
  db.chatSessions ||= [];
  let session = db.chatSessions.find((item) => item.id === sessionId);
  if (!session) {
    session = {
      id: id("chat"),
      title: firstMessage ? firstMessage.slice(0, 24) : "新对话",
      status: "active",
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.chatSessions.unshift(session);
  }
  return session;
}

async function anthropicLoop(db, run, model, userText, toolTrace, systemPrompt, tools, sessionId) {
  const history = buildHistoryForLlm(db, sessionId);
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

async function openaiLoop(db, run, provider, userText, toolTrace, systemPrompt, tools, sessionId) {
  const history = buildHistoryForLlm(db, sessionId);
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
  if (isMcpTool(name)) return `MCP ${result.server || ""}：${String(result.content || result.error || "").slice(0, 140)}`;
  if (name === "sync_market") return `${result.symbol} 现价 ${result.price ?? "-"}，${result.candleCount} 根 K 线（${result.timeframe}）`;
  if (name === "get_microstructure") return `资金费率 ${result.fundingRatePct ?? "-"}%，买盘占比 ${result.bookImbalancePct ?? "-"}%。${result.interpretation || ""}`;
  if (name === "get_token_profile") return result.ok === false ? `画像不可用：${result.reason || result.error || "-"}` : result.interpretation || `性格 ${result.character}，波动 ${result.volState}`;
  if (name === "get_global_market") return result.interpretation || `BTC 主导率 ${result.btcDominancePct ?? "-"}%，情绪 ${result.fearGreed?.value ?? "-"}`;
  if (name === "run_backtest") return result.status === "ok" ? `回测 ${result.trades} 笔，胜率 ${result.winRatePct}%，盈亏比 ${result.profitFactor ?? "-"}，期望 ${result.expectancyR}R，最大回撤 ${result.maxDrawdownPct}%` : `回测未完成：${result.status}`;
  if (name === "research_strategy") return result.profile?.strategyId ? `优选「${result.profile.label}」（${result.profile.direction === "short" ? "做空" : "做多"}·${result.profile.timeframe}），双样本外期望 ${result.profile.oosScore ?? "-"}R，置信度 ${result.profile.confidence}` : "未找到合格策略（多周期样本外均不达标）";
  if (name === "propose_trade_plan") {
    const align = result.smartMoneyAlignment;
    const alignNote = align && align.alignment !== "neutral" ? `｜聪明钱${align.alignment === "favor" ? "支持" : "相悖⚠"}` : "";
    const autoNote = result.autoExecuted ? `｜🤖自动执行(${result.execution?.status || "-"})` : "";
    return `${result.status}：${result.riskCheck?.summary || ""}${alignNote}${autoNote}`;
  }
  if (name === "create_mandate_draft") return `授权草案 ${result.mandateId} 待确认`;
  if (name === "remember") return result.note || `已写入记忆（${result.scope}）`;
  if (name === "query_knowledge") return String(result.summary || "").slice(0, 120);
  if (name === "get_account") return `净值 ${result.portfolio?.totalEquityUsdt ?? "未同步"}，持仓 ${result.positions?.length || 0}`;
  if (name === "get_events") return `${Array.isArray(result) ? result.length : 0} 个事件`;
  if (name === "list_risk_incidents") return `${Array.isArray(result) ? result.length : 0} 个未处理风险事件`;
  if (name === "resolve_risk_incidents") return `已标记 ${result.closed || 0} 个事件为已处理，剩余 ${result.remaining ?? "-"}`;
  return JSON.stringify(result).slice(0, 120);
}

function sanitizeArgs(args = {}) {
  return JSON.parse(JSON.stringify(args).replace(/apiSecret|secret|passphrase|password/gi, "redacted"));
}

function buildHistoryForLlm(db, sessionId) {
  return (db.chatMessages || []).filter((message) => !sessionId || message.sessionId === sessionId).slice(-12, -1).map((message) => ({
    role: message.role === "agent" ? "assistant" : "user",
    content: String(message.content || "").slice(0, 2000)
  })).filter((message) => message.content);
}

// 无 LLM Key 时的诚实降级：仍然用真实数据，但明确说明能力受限。
async function fallbackWithoutLlm(db, run, userText, toolTrace) {
  if (/实盘灰度|授权|风控|定时任务|事件源|api|API|admin|审计|日志|订阅|知识库/.test(userText)) {
    return [
      "### 结论",
      "状态：本轮使用本地系统说明回答",
      "依据：这是 Trading Agent 内置功能，不需要知识库资料",
      "",
      "### 系统说明",
      SYSTEM_GUIDE,
      "",
      "### 下一步",
      "1. 你可以直接让我创建定时任务、刷新事件源、同步 OKX 账户或解释任一页面。",
      "2. 涉及 API 密钥、实盘开关、清空数据和改密码时，我会按高风险操作处理，不会回显敏感信息。"
    ].join("\n");
  }
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
