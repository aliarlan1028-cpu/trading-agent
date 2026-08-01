import OpenAI from "openai";
import { runExpertAnalysis } from "./knowledgeEngine.mjs";
import { classifyUntrustedContent, evaluateAgentProposal } from "./agentSafetyEval.mjs";
import { retrieveChunksSemantic } from "./knowledgePipeline.mjs";
import { bindKnowledgeSkillsToPlan, createSkillFromIdea, selectActiveKnowledgeSkills } from "./knowledgeSkills.mjs";
import { evaluateTradePlan } from "./riskEngine.mjs";
import { fetchTickerQuiet, okxContractSpec, refreshApiKeyMetadata, syncMicrostructure, syncPrivateReadOnly, syncPublicKlines, syncPublicMarket } from "./exchangeConnector.mjs";
import { deriveAutomationState } from "./ops.mjs";
import { analyzeMarketStructure } from "./setupReview.mjs";
import { cancelWatch, describeWatch, listActiveWatches, registerWatch } from "./watchSentinel.mjs";
import { fetchGlobalMarket, fetchSmartMoney, evaluateSmartMoneyAlignment } from "./marketSignals.mjs";
import { deterministicDecision } from "./deterministicDecision.mjs";
import { validateTradePlan } from "./schema.mjs";
import { fetchTokenProfile } from "./tokenProfile.mjs";
import { refreshEventSources } from "./eventSources.mjs";
import { runBacktest } from "./backtestEngine.mjs";
import { activeStrategyProfiles, runStrategyResearch } from "./strategyOptimizer.mjs";
import { buildPortfolioRisk } from "./portfolioRisk.mjs";
import { executeApprovedPlan } from "./executionEngine.mjs";
import { paperValidationSummary } from "./paperTrading.mjs";
import { refreshAccounting } from "./accounting.mjs";
import { enabledSkillTools, isSkillTool, runSkillTool, trustedSkillMethodologies } from "./skillTools.mjs";
import { enabledMcpTools, isMcpTool, runMcpTool } from "./mcpClient.mjs";
import { recordLangSmithRun } from "./langSmith.mjs";
import { notifyLark } from "./larkNotifier.mjs";
import { setConfig } from "./runtimeConfig.mjs";
import { scheduleTask } from "./scheduler.mjs";
import { activeMandate, appendAudit, appendTrace, id, nowIso } from "./store.mjs";

// 自主巡检要在一轮里判大盘 + 逐一分析 3 个授权币(sync/微结构)+ 提计划前调 analyze_market_structure,
// 8 步经常在数据采集阶段就耗尽、来不及 propose(实测多轮 8 步全花在 sync_market 上未提计划)。给到 12 步留足余量。
const MAX_STEPS = 12;

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
    name: "analyze_market_structure",
    description: "用 SMC/供需方法对真实 4H+1H K 线做结构分析：给出大周期结构方向(BOS/趋势)、当前处于结构哪一段、优质供需区/关键位、1H 流动性扫荡与 CHoCH 现状、以及可执行的方向与入场思路(含结构失效位=止损参考)。这是你做方向判断和入场设计的核心参谋工具——提计划前应先调用它把结构看清;它是参谋不是审批,结构不清晰会诚实说'建议观望'。",
    schema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "交易对，如 BTC/USDT" },
        direction: { type: "string", enum: ["long", "short"], description: "你倾向的方向(可选),用于让分析师针对性核对结构是否支持" }
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
        minLeverage: { type: "number", description: "最低杠杆(杠杆区间下限);想固定杠杆就与 maxLeverage 相同" },
        positionPct: { type: "number", description: "仓位:每单保证金占余额的百分比(如 30),名义=保证金×杠杆" },
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
        timeframe: { type: "string", enum: ["5m", "15m", "1h", "4h", "1d"], description: "计划使用的分析周期" },
        riskPercent: { type: "number", description: "单笔风险占比，如 0.3" },
        knowledgeSkillIds: { type: "array", items: { type: "string" }, description: "本计划明确采用的 active 知识技能 ID；只有实际用于推理与计划条件时才填写" },
        adoptedToolSkillIds: { type: "array", items: { type: "string" }, description: "本计划明确采用了哪些【受信任导入方法论】的 ID（见系统提示里的受信任导入方法论区块）；只有真的照它的方法做了这个计划才填，用于按真实成绩复盘该方法论" },
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
    name: "create_skill_from_idea",
    description: "把主人在对话里口述的交易策略想法保存成知识技能草案。当主人说“帮我建一个策略/把这个想法存成技能”时调用。技能必须依次通过历史样本外验证、纯前向模拟和人工批准，之后才进入小额实盘试用；真实成绩达标方可转正。策略逻辑必须落到受支持模板，且有明确入场与止损；不要虚构主人没说的参数。",
    schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "策略名称,简洁可辨识" },
        direction: { type: "string", enum: ["long", "short"], description: "做多或做空(单一方向)" },
        timeframe: { type: "string", enum: ["5m", "15m", "1h", "4h", "1d"], description: "分析周期" },
        entry: { type: "string", description: "入场条件的自然语言描述,如‘收盘突破过去20根K线最高价’‘RSI 跌破30后回升’" },
        confirmation: { type: "string", description: "可选:入场确认条件,如‘成交量高于20周期均量’" },
        stop: { type: "string", description: "止损描述,如‘入场价下方2%’或‘2倍ATR自适应’——必填" },
        takeProfit: { type: "string", description: "止盈描述,如‘2R’‘3%’,缺省按2R" },
        symbol: { type: "string", description: "可选:限定交易对(如 BTC/USDT);不填则通用" },
        marketRegime: { type: "string", description: "可选:适用的市场状态,如‘上行趋势’‘震荡’" },
        templateId: { type: "string", enum: ["trend", "meanrev", "breakout", "macd", "bollinger", "death_cross", "rsi_short", "breakdown", "supertrend", "vol_breakout", "squeeze", "rsi_bull_div", "rsi_bear_div"], description: "可选:若你能明确判断该想法对应哪个模板就直接指定,能提高编译成功率;不确定则留空由系统从描述推断" }
      },
      required: ["name", "direction", "timeframe", "entry", "stop"]
    }
  },
  {
    name: "register_watch",
    description: "登记观察哨：把'若价格发生 X 则需要重新评估'的关键条件落地成结构化价格哨。哨兵每分钟用真实行情核对，条件命中（穿越语义）会立即触发一轮完整巡检让你重新决策——哨兵本身绝不下单。巡检结论里出现'若跌破/若突破/若回踩某区间'这类可执行触发条件时必须登记，不要只写在文字里。条件当前已成立时会被拒绝（此时应直接分析而不是挂哨）。同币同向且价位相近的哨会自动合并更新，不必担心重复。",
    schema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "币对，如 BTC/USDT，必须在授权白名单内" },
        kind: { type: "string", enum: ["price_above", "price_below", "enter_zone"], description: "price_above=向上突破 level；price_below=向下跌破 level；enter_zone=回踩进入 [levelLow, levelHigh] 区间" },
        level: { type: "number", description: "price_above / price_below 的触发价" },
        levelLow: { type: "number", description: "enter_zone 区间下沿" },
        levelHigh: { type: "number", description: "enter_zone 区间上沿" },
        note: { type: "string", description: "登记理由与触发后的评估要点，如'放量跌破则短期偏空，评估做空'" },
        ttlHours: { type: "number", description: "有效期小时数，默认 24，最大 48；过期自动作废" }
      },
      required: ["symbol", "kind", "note"]
    }
  },
  {
    name: "cancel_watch",
    description: "撤销一个不再需要的活跃观察哨（行情结构变化使条件失去意义、或需要腾出名额时）。",
    schema: {
      type: "object",
      properties: {
        watchId: { type: "string", description: "要撤销的观察哨 id（可从系统提示的观察哨列表或 register_watch 返回中获得）" },
        reason: { type: "string", description: "撤销原因" }
      },
      required: ["watchId"]
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

// 分析透明度页用:如实列出 Agent 决策时可调用的工具目录(名称+用途),不编造。
export function listAgentTools() {
  return TOOL_DEFS.map((t) => ({ name: t.name, description: t.description }));
}

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
10. 观察哨纪律【强制·最容易犯错】：分析得出"若跌破 X / 若突破 Y / 若回踩 Z 区间则重新评估"这类关键触发条件时，**唯一正确做法是调用 register_watch 工具**把它登记。
   - 在回复正文里写"观察哨一览"表格、列出"哨兵/条件/距触发/逻辑"这类文字，**完全不算登记**——那只是空话，哨兵根本没在盯，等于欺骗主人。绝对禁止在文字里画观察哨表格或声称"已挂 N 个观察哨/全部保留"。
   - 系统会自动展示真正已登记的观察哨（见上方【当前观察哨】区块，没有该区块就说明当前一个都没有）。你不需要、也不许自己复述它。
   - 每一条你想盯的条件 = 一次 register_watch 工具调用。想盯 3 个条件就调用 3 次工具，然后在文字里最多用一句话说"已登记 N 个观察哨盯盘"，不要展开成表。
   - 已有等价观察哨不必重复登记；条件失去意义用 cancel_watch 撤掉。
   - 【只对授权白名单内的币对挂哨·重要】register_watch 只对白名单内币对有效。分析白名单**外**的币(分析本身完全开放、任何币都能分析)时，**不要调用 register_watch**(必被哨兵拒、白白报错)；正常给完整分析结论，只在结尾用一句话提示"该币不在授权白名单，如需交易/监控可加白"，绝不要把"不在白名单/系统拒绝了"放在开头、让一次成功的分析读起来像被系统拦下。
11. Setup 质量纪律【提计划前自检，避免真金白银的错单】：**propose_trade_plan 之前必须先调用 analyze_market_structure 把 4H 结构、供需区、1H 流动性/CHoCH 看清**(它是你的结构参谋),再逐项确认——
   - 盈亏比：入场→最近止盈 / 入场→止损 的比值必须 ≥2R。达不到就重构止盈止损或直接不提，绝不提交 <2R 的低质量计划。
   - 高周期结构优先：方向必须与 4H 结构一致（4H BOS 定方向）。不要仅凭单根低周期(1m/5m/15m)放量 K 线就逆着大结构开仓——低周期单根放量+整数关口，多半是流动性扫荡(先砸后拉/先拉后砸)而不是真突破。
   - 止损别扎在猎杀区：止损不要正好压在破位/突破那根 K 线的最高/最低点上方(下方)一点点——那里止损最密集、最容易被"扫损"；要放到结构真正失效位之外，给足缓冲。
   - 记住这个反例：曾对 BTC 在 15m 单根放量砸穿整数关口后立刻做空、止损压在破位高点上方、RR 仅 1.5，结果价格反向扫掉上方止损、计划失败。"低周期逆结构 + 紧止损 + 低 RR"是典型错误组合，别再犯。
12. 合约下单口径【硬事实·禁止手算】：OKX/币安永续的下单量单位是「张(contract)」不是「币」。1 张 = ctVal 个币（BTC-USDT-SWAP 每张 0.01 BTC）；最小下单量是 minSz 张——BTC 为 0.01 张 = 0.0001 BTC ≈ 6 USDT 名义、5x 约 1.3 USDT 保证金，**不是** 0.01 BTC(那是整整 1 张、≈640 USDT)。get_microstructure 会返回真实 contractSpec(ctVal/minSz/lotSz/最小名义)，要谈最小量/名义/保证金就用它。
   - 【绝对禁止】把「0.01 张」当成「0.01 币」、或自己手算合约最小值/名义/保证金，更不能据此断言「账户太小、即使批准也会被交易所拒」——这几乎总是错的(极易算成 100 倍)。真实可下量由执行引擎按 minSz/lotSz/最小名义额(~5 USDT)自动对齐并强制(不足才返回 below_min_size)。可下与否一律以 propose_trade_plan 返回的 sizing 与引擎结果为准，不要自己下结论。
13. 计划结果播报【必须照 propose_trade_plan 的返回字段如实说，禁止想当然】：
   - 执行前的闸只有一道:**硬风控**(evaluateTradePlan，管授权/仓位/止损/杠杆/盈亏比等，返回如 36/36)。结构质量靠你在提计划前用 analyze_market_structure 自己把关(不再有事后否决的 SRTL 硬闸)。硬风控通过后:自主全开则自动下单,否则进待批准。
   - 按返回的 status 字段播报，**不许自己脑补**：orderPlaced 或 autoExecuted 为 true → 才是真的下单了；status 为 awaiting_approval → 才说"等待人工批准"；被硬风控拒 → 说风控原因,别说成等待批准。
   - 自主已开(autonomy+实盘写入+灰度「无需人工批准」全开)时，计划会**自动送执行**、不经人工批准；这时更不能说"等你批准"。以 autoGateReason 字段解释为什么没下单。
14. 极值处不追单 · 换位置换确认【关键·最容易犯:大跌后在低点追空】：单边大跌/大涨已充分展开、价格到极值附近时，【不禁止】该方向，但【禁止在原地"追"】——必须换更好的位置或更强的确认，别在恐慌的最后一根里追进去。
   - 大跌贴近 24h 低点(rangePosition24h 很低)想做空时：不要因为"已经跌很多/还会跌"就在低点直接追空(原地追，反弹会被扫、真续跌也是烂价位)。**正确做法二选一**：①等反弹回上方阻力/供需区，在衰竭确认处做空(高抛，最佳)；②若判断是延续破位，用 register_watch 登记"跌破 24h 低点 X 后回踩确认"的观察哨，做【破位回踩】，而不是在破位前的低点追。
   - 一句话：做空要么"反弹到阻力高抛"、要么"破位回踩确认"，绝不"在刚砸下来的低点追"。大涨追多同理(等回踩支撑做多，或破位向上回踩确认)。
   - 这样既不会在底部被反弹扫，又不会错过真正的续跌——续跌用破位观察哨接住。判断用 sync_market 的 changePct 与 rangePosition24h(价格在24h高低区间百分位)。

输出格式：
- 结论先行、极度精简：先用 1-2 句给出本轮结论，再补必要依据；不复述任务要求、不逐条汇报"我检查了什么"，只说发现了什么和决定了什么。
- 面向前端可视化展示，优先使用清晰 Markdown 小节：### 结论、### 依据、### 风险、### 下一步；无实质内容的小节直接省略。
- 重要状态用"标签：内容"单独成行，例如"交易对：BTC/USDT"、"状态：等待授权"。
- 列表每条只表达一个判断，一条尽量不超过一行；同类信息合并成一条，整体列表不超过 6 条；需要行动时用 1. 2. 3. 步骤。
- 不要输出表格、HTML、JSON、代码块或 --- 分隔线，除非用户明确要求。
- 所有时间一律使用北京时间（UTC+8）并注明，如"14:30（UTC+8）"；不要输出 UTC 裸时间。

${SYSTEM_GUIDE}`;

// ---------------------------------------------------------------------------
// 动态系统提示：把长期记忆（状态文件 + 三层记忆）与专业知识库（RAG 检索）
// 注入 LLM 上下文，让 Agent 真正"记得主人、掌握专业知识"。
// ---------------------------------------------------------------------------
function clip(text, max) {
  const value = String(text || "").trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function quarantineInjectedKnowledge(db, chunks = []) {
  const safe = [];
  for (const chunk of chunks) {
    const classification = classifyUntrustedContent(chunk.text);
    if (!classification.safe) {
      appendTrace(db, "knowledge_security", `隔离疑似提示注入：${chunk.citationLocator || chunk.id || "unknown"}`, "blocked");
      continue;
    }
    safe.push(chunk);
  }
  return safe;
}

// 北京时间 HH:mm(注入提示词的时间戳统一 UTC+8;ISO 直接 slice 是 UTC 会差 8 小时)。
function hhmmCn(iso) {
  const d = new Date(iso || 0);
  return !iso || Number.isNaN(d.getTime()) ? "?" : d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" });
}

async function buildSystemPrompt(db, userText = "") {
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
  } else {
    // 诚实纪律:画像为空时明确告知,防止模型把策略模板/知识方法名冒充"已验证策略"
    // (用户实锤:巡检里把唐奇安/布林挤压/Supertrend 三个做多模板说成"已验证策略"逐币匹配,
    // 而生产库画像为空——且清一色做多,造成"系统只有做多"的假象)。
    sections.push("【已验证策略画像】当前没有任何已验证的策略画像。严禁把策略模板名或知识库方法名说成\"已验证策略\"去逐币匹配；分析时直接基于真实行情结构+知识库原则判断。\n重要:提交交易计划(propose_trade_plan)不需要有\"已验证策略\"背书——策略画像只是加分项、不是前置条件。当行情结构清晰(如放量破位、明确的供需区反应)且盈亏比达标时,你可以也应该按方向下计划,包括做空;绝不能因为\"没有已验证的做空策略\"就机械地只观望而放走清晰的做空机会。无验证支撑时用更小仓位、更严结构确认来控制风险,而不是一刀切不做。");
  }

  const paper = paperValidationSummary(db);
  if (paper) sections.push(`【模拟盘前向验证状态（未通过前向验证的策略不要建议放大实盘，只观察或小额）】\n${paper}`);

  const pr = buildPortfolioRisk(db, activeMandate(db));
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

  // 授权白名单显式注入:此前对话提示词从不告知当前可交易/挂哨的币对,AI 只能在 register_watch
  // 失败后才知道 ACH 不在白名单 → 对白名单外的币也去挂哨、然后把"系统拒绝了"当开头,让纯分析
  // 看起来像被拦(用户实锤 ACH)。这里把白名单摆到台面上,并申明"分析全开放、下单/挂哨才受限"。
  const mdt = activeMandate(db);
  if (mdt) {
    const wl = (mdt.allowedSymbols || []).join("、") || "(当前为空)";
    sections.push(`【授权白名单（仅这些币对可下单/挂观察哨/自动监控）】${wl}\n重要边界：**行情分析对全市场开放**——任何 OKX/币安币对都能用 sync_market / get_microstructure / analyze_market_structure / get_token_profile / research_strategy 自由分析并给出方向结论。但 **propose_trade_plan 与 register_watch 只对白名单内币对有效**，对白名单外的币调用会被硬风控/哨兵直接拒。因此分析白名单外的币时：照常给完整分析，不要调用这两个工具，只在结尾一句话提示"不在白名单、如需交易/监控可加白（要我帮你更新授权吗）"。`);
  }

  // 大盘/聪明钱快照:与定时巡检同一份预取数据(db.marketRegime)。
  // 此前只有巡检 goal 注入这段,手动对话不注入 → 同一时刻两条路径口径不一致、结论相左。
  const rg = db.marketRegime || {};
  const regimeBits = [rg.global?.interpretation, rg.smartMoney?.ok !== false ? rg.smartMoney?.interpretation : null].filter(Boolean);
  if (regimeBits.length) {
    sections.push(`【大盘与聪明钱（系统预取快照,更新于 ${hhmmCn(rg.updatedAt)} (UTC+8);与定时巡检同源,可调用 get_global_market / get_microstructure 复核）】${regimeBits.join("；")}`);
  }

  // 全市场异动 + 消息面归因（环境感知）：让 AI 知道"今天市场在动什么、为什么"，而不是只盯授权币。
  const movers = db.marketMovers?.movers || [];
  if (movers.length) {
    const text = movers.slice(0, 6).map((m) => `- ${m.symbol} ${m.changePct >= 0 ? "+" : ""}${m.changePct}%（额 $${(m.quoteVolUsdt / 1e6).toFixed(0)}M）${m.narrative ? `｜${m.narrative.narrative || ""}（${m.narrative.category || ""}，情绪${m.narrative.sentiment ?? "?"}）` : ""}`).join("\n");
    sections.push(`【全市场异动·环境感知（截至 ${hhmmCn(db.marketMovers.scannedAt)} (UTC+8)，仅供理解大盘情绪与轮动，不是追涨信号；只在授权白名单内交易）】\n${text}`);
  }

  // 活跃观察哨：让每条对话路径都知道"哨兵正在盯什么"，避免重复登记、支持按 id 撤销。
  const watches = listActiveWatches(db);
  if (watches.length) {
    const lines = watches.map((w) => {
      const remainH = Math.max(0, Math.round((new Date(w.expiresAt).getTime() - Date.now()) / 3_600_000));
      return `- ${w.id}: ${describeWatch(w)} · 余 ${remainH}h${w.note ? ` · ${w.note}` : ""}`;
    }).join("\n");
    sections.push(`【当前观察哨（哨兵每分钟核对，命中即触发巡检；等价条件勿重复登记）】\n${lines}`);
  }

  const chunks = quarantineInjectedKnowledge(db, await retrieveChunksSemantic(db, userText, 5));
  if (chunks.length) {
    const knowledge = chunks
      .map((chunk, index) => `[[${index + 1}]] 来源：${chunk.citationLocator}\n${clip(chunk.text, 600)}`)
      .join("\n\n");
    sections.push(`【相关专业知识（从主人导入的知识库检索，可引用编号 [[n]]）】\n${knowledge}`);
  } else if ((db.knowledge?.chunks || []).length === 0) {
    sections.push("【专业知识库】主人尚未导入任何金融/交易知识，暂无可检索内容。");
  }

  // 受信任的导入 skill:把它的方法论(SKILL.md)注入决策上下文,让 AI 照这套方法分析。
  // 转正的可信度更高(已用真实成绩验证);试用中的当参考、别重仓押注。
  const trustedMethods = trustedSkillMethodologies(db);
  for (const t of trustedMethods.slice(0, 3)) {
    const tag = t.graduated ? "已用真实成绩转正" : "小额试用·未验证";
    sections.push(`【受信任导入方法论（${tag}）· ${t.name}｜采用其思路做计划时把 ID「${t.id}」放入 propose_trade_plan 的 adoptedToolSkillIds 以便复盘归因】\n${t.instructions}`);
  }

  // A 路：已批准的纪律/风控规则必须无条件遵守。
  const approvedRules = (db.knowledge?.ruleProposals || []).filter((r) => r.status === "已批准")
    .sort((a, b) => (b.doctrine ? 1 : 0) - (a.doctrine ? 1 : 0)); // 条令铁律排前,不被截断
  if (approvedRules.length) {
    const text = approvedRules.slice(0, 20)
      .map((r) => `- [${r.category || "纪律"}] ${r.name}${r.condition ? `（当 ${r.condition}）` : ""}${r.action && r.action !== "none" ? ` → ${r.action}` : ""}`)
      .join("\n");
    sections.push(`【交易纪律与风控规则（来自知识库、已人工批准，必须无条件遵守）】\n${text}`);
  }
  // W4:采纳的分析透镜/纪律(知识库转换产出、采纳即用),决策时遵循。只塑造分析、不直接下单。
  const adoptedLenses = (db.knowledge?.lenses || []).filter((l) => l.active)
    .sort((a, b) => (b.doctrine ? 1 : 0) - (a.doctrine ? 1 : 0)); // 条令透镜排前,不被截断
  if (adoptedLenses.length) {
    sections.push(`【分析条令 / 透镜（决策时遵循；只塑造分析与仓位、绝不直接下单。这些是让你更专业、不是更不敢交易——2-3视角同向+清晰结构+盈亏比达标就应提计划，弱对齐用小仓而非观望）】\n${adoptedLenses.slice(0, 12).map((l) => `- ${l.name}：${l.promptText}${!l.doctrine && l.sourceTitle ? `（《${l.sourceTitle}》）` : ""}`).join("\n")}`);
  }
  const adoptedWorkflows = (db.knowledge?.workflows || []).filter((w) => w.active);
  if (adoptedWorkflows.length) {
    sections.push(`【采纳的分析工作流（来自知识库，遇到相符场景就按步骤走，仍受硬风控约束）】\n${adoptedWorkflows.slice(0, 6).map((w) => `- ${w.name}：${(w.steps || []).join(" → ")}${w.sourceTitle ? `（《${w.sourceTitle}》）` : ""}`).join("\n")}`);
  }
  // 信息面智能简报:已按可信度/是否计价/假消息过滤过的关键新闻(未证实的别当事实)。
  try {
    const { newsBriefForPrompt } = await import("./newsIntelligence.mjs");
    const brief = newsBriefForPrompt(db);
    if (brief.length) sections.push(`【信息面 · 关键新闻（已按来源可信度/多源印证/是否已计价/假消息风险过滤;标"⚠未证实"的只当线索、不当事实,影响面别只看标题）】\n${brief.join("\n")}`);
  } catch { /* 信息面简报不阻断 */ }
  // 日程事件(向前看):未来已排期的事件 + 事件静默窗口(条令 S7)。行为提示、非硬闸。
  try {
    const { upcomingScheduledEvents } = await import("./scheduledEvents.mjs");
    const upcoming = upcomingScheduledEvents(db, 168); // 未来 7 天
    if (upcoming.length) {
      const blackoutMin = Math.max(0, Number(process.env.EVENT_BLACKOUT_MINUTES || 30));
      const now = Date.now();
      const lines = upcoming.slice(0, 8).map((e) => {
        const t = new Date(e.due || e.startAt).getTime();
        const hrs = (t - now) / 3600000;
        const when = hrs < 24 ? `${Math.round(hrs)} 小时后` : `${Math.round(hrs / 24)} 天后`;
        const inBlackout = e.impact >= 70 && (t - now) <= blackoutMin * 60000;
        return `- ${e.shortTitle || e.title}（${when} · 影响${e.impactLabel || e.impact}${inBlackout ? " · ⏸静默窗口内" : ""}）`;
      });
      const anyBlackout = upcoming.some((e) => e.impact >= 70 && (new Date(e.due || e.startAt).getTime() - now) <= blackoutMin * 60000);
      sections.push(`【日程事件 · 未来已排期（向前看,S7）】\n${lines.join("\n")}\n事件静默:距高影响事件不足 ${blackoutMin} 分钟(标⏸)时,不新开高杠杆仓、降敞口、宁可等公布后再动;事件前若已持仓考虑减仓。${anyBlackout ? "【当前处于静默窗口:优先降敞口而非新开仓】" : ""}`);
    }
  } catch { /* 信息面简报不阻断 */ }
  // 链上/基本面简报(DefiLlama 免费源:TVL/稳定币供应=中期资金面背景;巨鲸/净流未接则不臆断)。
  try {
    const { onchainBriefForPrompt } = await import("./onchainFundamentals.mjs");
    const oc = onchainBriefForPrompt(db);
    if (oc) sections.push(`【链上 / 基本面 · 资金面背景（中期视角,不是短线信号;长期利好别直接当短多）】${oc}`);
  } catch { /* 链上简报不阻断 */ }
  // 可用技能分两层如实标注:active=已用真实成绩转正(可信);live_probation=小额实盘试用中(未验证)。
  // 绝不把试用技能说成"已验证"——否则 LLM 会拿它当可信依据推理,污染判断。
  const usableSkills = selectActiveKnowledgeSkills(db, {}, { limit: 6 });
  const fmtSkill = (skill) => {
    const lm = skill.liveMetrics;
    const perf = lm?.trades ? `｜实盘 ${lm.trades} 笔 PF ${lm.profitFactor ?? "-"} 胜率 ${lm.winRatePct}%` : "";
    const bt = skill.validation?.test?.expectancyR != null ? `｜回测参考 ${skill.validation.test.expectancyR}R` : "";
    return `- [${skill.id}@v${skill.version}]《${skill.sourceTitle || "知识来源"}》${skill.name}｜${skill.spec.symbolScope.join("/")} · ${skill.spec.timeframe} · ${skill.spec.direction}｜止损 ${skill.spec.stopDescription}${perf}${bt}`;
  };
  const activeSkills = usableSkills.filter((s) => s.status === "active");
  const probationSkills = usableSkills.filter((s) => s.status === "live_probation");
  if (activeSkills.length) {
    sections.push(`【已验证技能（已用真实成绩转正，可信）】\n匹配交易对/方向/周期/市场状态时可用；实际参与推理须把 ID 放入 knowledgeSkillIds。风控会复查状态、版本、指纹与当前信号。\n${activeSkills.map(fmtSkill).join("\n")}`);
  }
  if (probationSkills.length) {
    sections.push(`【小额试用中的技能（尚未验证，正用小额实盘检验，表现不足会自动退役）】\n这些是候选、非结论：可以参考并在小额度内试用，但不要当作已证实的优势重仓押注；回测参考分仅供权衡，不代表已验证。若采用请照样放入 knowledgeSkillIds 以便真实成绩归因（这正是它转正或退役的依据）。\n${probationSkills.map(fmtSkill).join("\n")}`);
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

function createPendingAction(db, args = {}, run = {}) {
  const info = summarizePendingAction(db, args);
  const record = {
    id: id("pact"),
    type: args.type,
    args: { ...args, resolvedTargetId: info.targetId || null },
    title: info.title,
    detail: info.detail,
    danger: Boolean(info.danger),
    status: "awaiting_confirmation",
    tenantId: run.tenantId || "tenant_owner",
    requestedByUserId: run.requestedByUserId || null,
    requestedBy: run.requestedBy || "Agent",
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

  if (name === "request_action") return createPendingAction(db, args, run);

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
    // 24h 区间位置:价格在 [low24h, high24h] 的百分位。0=贴24h低点、100=贴24h高点。
    // 用于纪律 14:大跌后 rangePosition 很低=接近低点=追空在末端;大涨后很高=追多在末端。
    const px = Number(market?.price ?? ticker?.price);
    const rangePosition24h = (Number.isFinite(market?.high24h) && Number.isFinite(market?.low24h) && market.high24h > market.low24h && Number.isFinite(px))
      ? Math.round(((px - market.low24h) / (market.high24h - market.low24h)) * 100) : null;
    return {
      symbol,
      timeframe,
      price: market?.price ?? ticker?.price,
      change24hPct: market?.changePct,
      high24h: market?.high24h,
      low24h: market?.low24h,
      rangePosition24h,
      extensionNote: rangePosition24h == null ? null
        : rangePosition24h <= 20 ? `价格在 24h 区间 ${rangePosition24h}%（接近 24h 低点）——若当日大跌，此处做空是追末端/易抄在恐慌见底，慎空`
        : rangePosition24h >= 80 ? `价格在 24h 区间 ${rangePosition24h}%（接近 24h 高点）——若当日大涨，此处做多是追末端，慎多`
        : `价格在 24h 区间 ${rangePosition24h}% 位`,
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
      // 合约规格(下单单位是"张"不是"币")——喂真实 ctVal/minSz/lotSz + 最小下单名义,
      // 防止模型把"0.01 张"误当成"0.01 币"、手算成 100 倍名义再瞎断言"账户太小下不了单"。
      // 合约规格拿不到时给显式 available:false 哨兵(不静默丢),否则模型会退回手算最小量/名义(审计 llm-F2)。
      let contractSpec = { available: false, note: "合约规格未取到——禁止手算最小量/名义/保证金,可下量以执行引擎返回为准" };
      try {
        const base = symbol.split("/")[0];
        const spec = await okxContractSpec(`${symbol.replace("/", "-")}-SWAP`);
        const px = Number(micro?.markPrice ?? micro?.price ?? (db.markets || []).find((m) => m.symbol === symbol)?.price ?? 0);
        if (spec) contractSpec = {
          available: true,
          unit: "张(contract)",
          ctVal: spec.ctVal, ctValCcy: base, minSz: spec.minSz, lotSz: spec.lotSz,
          note: `1 张 = ${spec.ctVal} ${base}；最小下单 ${spec.minSz} 张（不是 ${spec.minSz} ${base}）`,
          minOrderCoin: Number((spec.minSz * spec.ctVal).toPrecision(6)),
          minOrderNotionalUsdt: px > 0 ? Number((spec.minSz * spec.ctVal * px).toFixed(2)) : null
        };
      } catch { /* 保持 available:false 哨兵 */ }
      const out = smart?.ok
        ? { ...micro, smartMoney: smart, interpretation: [micro.interpretation, smart.interpretation].filter(Boolean).join("；") }
        : { ...micro };
      return { ...out, contractSpec };
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

  if (name === "analyze_market_structure") {
    try {
      return await analyzeMarketStructure(db, args.symbol || "BTC/USDT", args.direction || null);
    } catch (error) {
      return { available: false, reason: `结构分析失败：${error.message}` };
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

  if (name === "create_skill_from_idea") {
    const result = createSkillFromIdea(db, args, run?.role === "AI 交易员" ? "用户(经 AI)" : "用户");
    if (!result.ok) return { error: result.error, status: result.status || "invalid" };
    const s = result.skill;
    return {
      status: result.status,
      skillId: s.id,
      name: s.name,
      template: s.spec.templateLabel,
      direction: s.spec.direction,
      timeframe: s.spec.timeframe,
      stop: s.spec.stopDescription,
      takeProfit: s.spec.takeProfitDescription,
      note: result.status === "live_probation"
        ? "已保存为你的技能并上岗小额试用(未验证);它会参与决策并用真实成交成绩复盘,达标自动转正、不达标自动退役。"
        : "已保存为你的技能(待验证)。"
    };
  }

  if (name === "register_watch") {
    const symbol = String(args.symbol || "").trim().toUpperCase();
    let price = null;
    try {
      const ticker = await fetchTickerQuiet(symbol);
      price = Number(ticker?.price);
    } catch { /* 下面回退到已同步行情 */ }
    if (!Number.isFinite(price) || price <= 0) {
      price = Number((db.markets || []).find((m) => m.symbol === symbol)?.price);
    }
    const result = registerWatch(db, args, price, run?.role || "AI 交易员");
    if (!result.ok) return { error: result.error };
    return {
      status: result.updated ? "updated" : "registered",
      watchId: result.watch.id,
      watch: describeWatch(result.watch),
      expiresAt: result.watch.expiresAt,
      activeWatches: listActiveWatches(db).map((w) => `${w.id}: ${describeWatch(w)}`)
    };
  }

  if (name === "cancel_watch") {
    const result = cancelWatch(db, String(args.watchId || ""), run?.role || "AI 交易员", String(args.reason || ""));
    if (!result.ok) return { error: result.error };
    return { status: "cancelled", watch: describeWatch(result.watch) };
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
      activeMandate: activeMandate(db) || null
    };
  }

  if (name === "get_events") {
    return (db.events || []).slice(0, 8).map((event) => ({
      title: event.title,
      category: event.category,
      due: event.due,
      impact: event.impact,
      action: event.action,
      // 信息面智能:情绪/影响币种/影响时长/来源可信度/多源印证/已计价程度/假消息风险
      intel: event.intel ? { sentiment: event.intel.sentiment, symbols: event.intel.affectedSymbols, horizon: event.intel.impactHorizon, credibility: event.intel.credibility, corroboration: event.intel.corroboration, pricedIn: event.intel.pricedIn, fakeRisk: event.intel.fakeRisk, note: event.intel.oneLine } : null
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
    const retrieved = quarantineInjectedKnowledge(db, await retrieveChunksSemantic(db, `${args.question || ""} ${args.symbol || ""}`, 5));
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
      min_leverage: Math.max(1, Math.min(Number(args.maxLeverage || 1), Number(args.minLeverage || 1))),
      minLeverage: Math.max(1, Math.min(Number(args.maxLeverage || 1), Number(args.minLeverage || 1))),
      sizingMode: "balance_pct",
      positionPct: Math.max(1, Math.min(100, Number(args.positionPct || 30))),
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
    const mandate = activeMandate(db)
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
      // 计划必须钉住授权版本(P0):此前从不写入,风控按默认 v1 对比当前版本必拒。
      mandateVersion: Number(mandate?.version || 1),
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
      // 落库计划周期：执行层要用它做技能模拟盘的周期一致性校验（此前从未写入，校验被静默跳过）。
      timeframe: args.timeframe || "1h",
      source: "agent_chat",
      createdAt: nowIso()
    };
    // Schema 硬闸:挡住结构非法的计划(方向错、止损在错误一侧、NaN、区间颠倒)——
    // 这类逻辑错误比"说错方向"更隐蔽,过去要靠风控引擎间接兜,现在写入前直接拒。
    const planCheck = validateTradePlan(plan);
    if (!planCheck.valid) {
      return { error: `交易计划结构非法，未提交：${planCheck.errors.join("；")}。请修正后重新调用 propose_trade_plan。` };
    }
    Object.assign(plan, planCheck.normalized); // 规范化双字段，保持全库一致
    if (planCheck.warnings.length) plan.schemaWarnings = planCheck.warnings;
    bindKnowledgeSkillsToPlan(db, plan, {
      timeframe: args.timeframe || "1h",
      regime: market.regime || db.marketRegime?.regime || "",
      selectedSkillIds: args.knowledgeSkillIds || [],
      requireExplicitAdoption: true
    }, "AgentChat");
    // 归因受信任导入方法论:AI 用 adoptedToolSkillIds 声明本计划采纳了哪些受信任 skill 的方法论,
    // 据此用真实平仓成绩复盘(达标转正/不达标退役)。只认真实存在且受信任的 id。
    const declared = Array.isArray(args.adoptedToolSkillIds) ? args.adoptedToolSkillIds.map(String) : [];
    const validTrusted = (db.skills || []).filter((s) => !s.native && s.trusted && declared.includes(s.id)).map((s) => s.id);
    if (validTrusted.length) plan.adoptedTrustedSkillIds = validTrusted;
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
      // 唯一真相源:自动下单与否用 deriveAutomationState(与状态卡/前端横幅同一判定,11 道闸按执行链)。
      // 旧的 4 闸 autoEligible 漏了 killSwitch/orderWrite/风险确认/Key核验,与状态卡各说各话(审计 gating)。
      const auto = deriveAutomationState(db, { hasProvider: Boolean(activeProvider()) });
      const autoEligible = auto.mode === "full_auto_small";
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
          // 只有"可重试的安全闸拦截"(超额度/快照过期/额度不足等)才回退人工批准。
          // 引擎终态(结构审核未过/保护单失败/执行失败)必须保留引擎设的状态——绝不能改回
          // awaiting_approval,否则被拒/可能裸仓的计划会变成"可一键再批准",绕过防重试锁(审计 state-F1)。
          const terminalReject = ["setup_rejected", "protection_failed", "failed", "risk_recheck_failed", "cancelled"].includes(autoExecution.status);
          if (terminalReject) {
            plan.autoApproved = false;
            autoExecution = { ...autoExecution, fellBackToManual: false };
            appendAudit(db, `自动执行被引擎终态拦截（${autoExecution.status}：${autoExecution.reason || autoExecution.review?.reason || ""}），未下单，不转人工批准`, plan.id, "AgentAuto", "warning");
          } else {
            plan.status = "awaiting_approval";
            plan.autoApproved = false;
            autoExecution = { ...autoExecution, fellBackToManual: true };
            appendAudit(db, `自动执行被安全闸拦截（${autoExecution.reason || autoExecution.status}），转人工批准`, plan.id, "AgentAuto", "warning");
          }
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
    // 计划结果如实播报:autoApproved 在执行前就被置 true,不能拿它当"已下单"——下单闸拦了/入场被拒就没下单。
    // 用真实执行状态判定 placed(是否产生真实订单),分清"真下单 / 被结构闸拒 / 停在待批准"三种。
    // dry_run 是"算了没下单",绝不能算"已下单"(审计 llm-F3)——否则模型会谎报"已自动下单"。
    const placed = Boolean(autoExecution && ["submitted", "entry_pending", "entry_filled", "protecting"].includes(autoExecution.status));
    const simulated = Boolean(autoExecution && autoExecution.status === "dry_run");
    let autoGateReason = null;
    if (simulated) {
      autoGateReason = "干跑：实盘写入未开，已完成数量/价格计算但未向交易所提交(未真下单)";
    } else if (autoExecution && !placed) {
      // 已自动送执行但没真正下单(被下单闸拦、入场被拒、部分成交撤单等)——如实报状态,不脑补。
      autoGateReason = `自动执行未成交（${autoExecution.reason || autoExecution.status}）`;
    } else if (risk.passed && !plan.autoApproved) {
      // 停在待批准、但自主已开——用同一个 deriveAutomationState 说清缺哪道闸(与状态卡口径一致,不再各算各的)。
      const auto = deriveAutomationState(db, { hasProvider: Boolean(activeProvider()) });
      autoGateReason = auto.mode === "semi_auto"
        ? "当前为半自动:灰度策略仍要求「人工批准」(取消勾选即全自动)"
        : (auto.blockers?.length ? auto.blockers.join("、") : auto.detail);
    }
    return {
      planId: plan.id,
      status: plan.status,
      autoExecuted: placed,
      orderPlaced: placed,
      autoGateReason,
      execution: autoExecution ? { status: autoExecution.status, reason: autoExecution.reason || null } : null,
      riskCheck: { passed: risk.passed, decision: risk.decision, summary: risk.summary, checks: risk.checks, warnings: risk.warnings || [] },
      smartMoneyAlignment: alignment,
      note: placed
        ? `已在授权与灰度上限内自动执行并下单（${autoExecution.status}）。`
        : simulated
          ? `干跑完成（实盘写入未开）：已算好数量/价格但未向交易所提交，未真下单。要真实下单请开启「实盘写入」。`
          : autoExecution
          ? `计划已自动送执行，但${autoGateReason}。未产生真实订单——这【不是】"等待人工批准"，需重提更优 setup 或调整参数。`
          : (risk.passed
            ? `计划已进入待批准队列，你批准后进入执行链路。${autoGateReason ? `未自动下单原因：${autoGateReason}。` : ""}`
            : "计划被风控拒绝，请调整参数或修正授权边界。")
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
  if (process.env.DEEPSEEK_API_KEY) return { name: "deepseek", model: process.env.DEEPSEEK_MODEL || "deepseek-v4-pro" };
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
    traceId: null,
    role: "AI 交易员",
    goal: userText,
    status: "running",
    source: "chat",
    sessionId: session.id,
    tenantId: payload.tenantId || "tenant_owner",
    requestedByUserId: payload.userId || null,
    requestedBy: payload.userName || "Agent",
    steps: [],
    createdAt: nowIso()
  };
  run.traceId = run.id;
  db.agentRuns.unshift(run);

  const provider = activeProvider();
  run.model = provider ? `${provider.name}/${provider.model}` : "local-fallback";
  run.promptVersion = "agent-chat-v1";
  run.toolSchemaVersion = "agent-tools-v1";
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
    // 诚实守卫:模型(尤其弱模型)常在正文声称"已登记 N 个观察哨/哨兵在盯"却根本没调用 register_watch。
    // 只留 trace 不够——用户会被正文误导(实锤:正文说"已登记3个",右侧观察哨面板却空)。
    // 这里同时在可见回复末尾加注更正,让聊天文字与面板口径一致。
    // 只在模型明确"声称已登记/哨兵已在盯"却没真调工具时才加注——
    // 收窄到显式登记声明,别再命中"若跌破 X 做空"这类正常条件分析(那是行情研判不是观察哨声明,
    // 之前的宽正则会对做交易计划的正常回复误报)。
    const claimsWatch = /(已|帮你|我已|为你)[^。\n]{0,6}(登记|设好|布好|建好|设置好)[^。\n]{0,4}观察哨|观察哨[^。\n]{0,6}(已登记|已设置|已就位|在盯|盯着|每分钟)|哨兵[^。\n]{0,6}(已在盯|盯着|每分钟)|观察哨一览/.test(finalText || "");
    const registeredThisRun = toolTrace.some((t) => t.name === "register_watch" && !String(t.summary || "").startsWith("失败"));
    if (claimsWatch && !registeredThisRun) {
      appendTrace(db, "agent_chat", "⚠ 回复声称已登记观察哨但本轮未成功调用 register_watch——哨兵未实际登记,已在回复末尾加注更正", "warning");
      finalText = `${finalText || ""}\n\n> ⚠️ **系统更正**：本轮回复提到了观察哨，但**未实际调用登记工具**，哨兵不会自动盯盘。若需盯盘触发，请在右侧「观察哨」面板确认已登记。`;
    }
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

// 给安全护栏提供真实上下文（此前恒为空 → 新鲜度/杠杆检查全部空转）。
function buildSafetyContext(db, name, args) {
  if (name !== "propose_trade_plan") return {};
  const symbol = String(args?.symbol || "").toUpperCase();
  const market = (db.markets || []).find((m) => m.symbol === symbol);
  const marketAgeMs = market?.lastRealtimeAt || market?.lastSyncedAt
    ? Date.now() - new Date(market.lastRealtimeAt || market.lastSyncedAt).getTime()
    : null;
  const mandate = activeMandate(db);
  const snapshot = (db.accountSnapshots || [])[0];
  const snapshotAgeMs = snapshot?.createdAt ? Date.now() - new Date(snapshot.createdAt).getTime() : null;
  return {
    // 行情 10 分钟内算新鲜；没有该币行情记录 → 明确判 stale（不许对着空数据提计划）
    marketDataFresh: market ? (marketAgeMs != null && marketAgeMs < 10 * 60 * 1000) : false,
    // 账户快照仅在实盘开启时要求新鲜（30 分钟）；纸面/未配置不作要求（undefined 不触发违规）
    accountSnapshotFresh: db.system?.liveTradingEnabled
      ? (snapshotAgeMs != null && snapshotAgeMs < 30 * 60 * 1000)
      : undefined,
    // 读真实写入的键(max_leverage / maxLeverageBySymbol);旧代码读扁平 maxLeverage(从不写入)→
    // agentSafetyEval 杠杆闸永久失效(审计 concept-F1)。这里改成与 riskEngine 同口径,让防线复活。
    mandateMaxLeverage: (() => {
      const bySym = mandate?.maxLeverageBySymbol ? Object.values(mandate.maxLeverageBySymbol).map(Number).filter(Number.isFinite) : [];
      const v = mandate?.max_leverage ?? mandate?.maxLeverage ?? (bySym.length ? Math.max(...bySym) : null);
      return v != null ? Number(v) : null;
    })()
  };
}

async function runToolTracked(db, run, name, args, toolTrace) {
  const startedAt = Date.now();
  let result;
  const safety = evaluateAgentProposal({ action: name, payload: args }, buildSafetyContext(db, name, args));
  if (!safety.passed) {
    result = { error: "Agent safety policy blocked this tool call", violations: safety.violations };
    appendAudit(db, `Agent 工具调用被安全策略阻断：${name}`, run.id, "AgentSafety", "warning");
  } else {
    try {
      result = await executeTool(db, run, name, args);
    } catch (error) {
      result = { error: error.message };
    }
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
  if (name === "analyze_market_structure") return result.available === false ? `结构分析不可用：${result.reason || "-"}` : `结构 ${result.bias || "?"}(4H ${result.structure4h || "?"})，${result.phase || ""}；入场思路：${result.entryIdea || "-"}`;
  if (name === "get_global_market") return result.interpretation || `BTC 主导率 ${result.btcDominancePct ?? "-"}%，情绪 ${result.fearGreed?.value ?? "-"}`;
  if (name === "run_backtest") return result.status === "ok" ? `回测 ${result.trades} 笔，胜率 ${result.winRatePct}%，盈亏比 ${result.profitFactor ?? "-"}，期望 ${result.expectancyR}R，最大回撤 ${result.maxDrawdownPct}%` : `回测未完成：${result.status}`;
  if (name === "research_strategy") return result.profile?.strategyId ? `优选「${result.profile.label}」（${result.profile.direction === "short" ? "做空" : "做多"}·${result.profile.timeframe}），双样本外期望 ${result.profile.oosScore ?? "-"}R，置信度 ${result.profile.confidence}` : "未找到合格策略（多周期样本外均不达标）";
  if (name === "propose_trade_plan") {
    const align = result.smartMoneyAlignment;
    const alignNote = align && align.alignment !== "neutral" ? `｜聪明钱${align.alignment === "favor" ? "支持" : "相悖⚠"}` : "";
    const autoNote = result.autoExecuted ? `｜🤖自动执行(${result.execution?.status || "-"})` : "";
    return `${result.status}：${result.riskCheck?.summary || ""}${alignNote}${autoNote}`;
  }
  if (name === "create_skill_from_idea") return `技能「${result.name}」已保存（${result.status === "live_probation" ? "上岗试用" : result.status}）：${result.direction}·${result.timeframe}·${result.template || "-"}`;
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
      // 确定性决策兜底：即使没有 LLM，也用真实多源信号给一个透明、可解释、非编造的方向读数。
      const full = db.markets?.find((mk) => mk.symbol === symbol) || {};
      const smart = await fetchSmartMoney(symbol).catch(() => null);
      const rangeAtr = Number(market.recentHigh) - Number(market.recentLow);
      const d = deterministicDecision({
        market: {
          symbol,
          price: Number(market.price),
          changePct: full.changePct ?? Number(market.change24hPct),
          fundingRate: full.fundingRate,
          bookImbalancePct: full.bookImbalancePct,
          atrPct: rangeAtr > 0 && Number(market.price) > 0 ? (rangeAtr / Number(market.price)) * 0.25 : undefined
        },
        smartMoney: smart,
        mandate: activeMandate(db) || db.mandates?.[0] || null
      });
      const dirCn = d.direction === "long" ? "偏多" : d.direction === "short" ? "偏空" : "观望";
      lines.push("", `**确定性规则决策（无 LLM 兜底，非编造）：${dirCn}，置信度 ${d.confidence}。**`,
        `因子分：动量 ${d.scores.momentum}｜资金费率 ${d.scores.funding}｜盘口 ${d.scores.book}｜聪明钱 ${d.scores.smartMoney}（融合 ${d.net}）。`);
      if (d.reasons.length) lines.push(`说明：${d.reasons.join("；")}。`);
      if (d.plan) lines.push(`参考结构（仅供参考，非实盘计划）：入场 ${d.plan.entryLow}–${d.plan.entryHigh}，止损 ${d.plan.stopLoss}，止盈 ${d.plan.takeProfits.join(" / ")}，风险 ${d.plan.riskPercent}%·${d.plan.leverage}x。配置 LLM 后可自动过硬风控并转成可执行计划。`);
    }
  }
  const account = await runToolTracked(db, run, "get_account", {}, toolTrace);
  if (!account.exchangeAccounts?.some((item) => item.readEnabled)) {
    lines.push("交易所 API 未配置：我读不到你的账户与持仓，只能使用公开行情。");
  }
  lines.push("", "配置任一 LLM Key 后，我可以：解析你的授权目标 → 结合行情/知识库/事件生成交易计划 → 通过硬风控检查后交给你批准。");
  return lines.join("\n");
}
