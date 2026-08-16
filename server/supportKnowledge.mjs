// Versioned, customer-facing product knowledge and deterministic read-only diagnostics.
// This is intentionally separate from trading knowledge: customer support must explain
// what the product actually does in the current release, not improvise from market lore.
import { buildStrategyProductCatalog } from "./strategyProducts.mjs";

const RELEASE = process.env.APP_RELEASE || "dev";

const ARTICLES = [
  {
    id: "assistant.role", title: "系统客服与 AI 交易员的职责边界", page: "global",
    keywords: ["客服", "助手", "ai助手", "ai 助手", "会什么", "能做什么", "下单", "修改配置"],
    body: "悬浮窗口是只读系统客服：解释功能、查询当前状态、定位设置和协助排障。它不下单、不撤单、不生成交易计划、不修改授权或风险参数。行情判断和交易执行由 AI 交易员负责，高风险操作必须进入对应页面并经过权限与确认。"
  },
  {
    id: "trading.waiting_entry", title: "等待入场条件（尚未向 OKX 下单）", page: "chat",
    keywords: ["等待入场", "条件计划", "条件已武装", "armed", "触发", "okx委托", "尚未下单", "停止等待"],
    body: "等待入场条件表示计划已通过提案风控并保存在系统内，但 OKX 尚未收到订单。多阶段计划可依次等待突破、回踩和K线确认；中间步骤只推进场景，只有最后一步满足后才会刷新事实、再次执行硬风控并进入 OMS。停止等待只取消本地监控；系统离线期间不具备交易所原生条件单的成交保证。"
  },
  {
    id: "trading.order_states", title: "计划、挂单与持仓的区别", page: "chat",
    keywords: ["计划", "挂单", "委托", "持仓", "成交", "entry_pending", "position"],
    body: "交易计划只是决策记录；等待入场条件时 OKX 没有订单；入场挂单中表示订单已提交但未成交；只有 OKX 成交并经账户同步确认后才显示为持仓。页面状态必须以 OMS 与 OKX 对账结果为准。"
  },
  {
    id: "trader.workflow", title: "AI 交易员自主决策流程", page: "chat",
    keywords: ["ai交易员", "ai 交易员", "怎么分析", "决策", "巡检", "自主交易", "流程", "日内交易员", "波段交易员", "角色"],
    body: "自主循环先取得 OKX 行情、闭合 K 线、账户与事件事实，再由确定性代码计算可核验的多周期结构。日内视角使用 1H 背景、15m 结构和 5m 确认；波段视角使用 1D 背景、4H 结构和 1H 确认。角色适配分目前只做影子观察，不决定多空、不修改风险。主 Agent 综合结构、微观盘面、信息面、成本和账户容量提出候选，随后仍须通过确定性风控与执行闸，并持续对账和复盘。仓位真相、风险限制和订单状态只能来自代码与交易所数据。"
  },
  {
    id: "cockpit.overview", title: "交易驾驶舱", page: "cockpit",
    keywords: ["驾驶舱", "资产", "净值", "持仓", "订单", "成交", "行情"],
    body: "交易驾驶舱集中展示账户净值、真实持仓、在途订单、成交和市场监控。未同步字段应显示未同步，不应用历史值或模型推测补齐。"
  },
  {
    id: "research.center", title: "研究中心与策略生命周期", page: "researchCenter",
    keywords: ["研究中心", "策略库", "策略", "回测", "前向", "转正", "知识库", "能力库", "策略工作室", "自然语言策略", "策略市场"],
    body: "研究中心把策略产品与指标研究模型分开。策略工作室把自然语言编译到白名单确定性模板，自动检查结构、参数、未来数据隔离、成本和风控合同；随后用 OKX 历史收盘 K 线做带 purge/embargo 的三段样本外回测。只有自动测试和样本外门槛都通过才能发布到内部策略市场。启用市场策略只是把不可变版本加入 AI 可选集，不等于实盘已验证，也不会绕过实时结构、账户容量、授权和硬风控。"
  },
  {
    id: "risk.posture", title: "风险总览", page: "riskCenter:posture",
    keywords: ["风险姿态", "风险评分", "预算", "敞口", "回撤", "熔断", "暂停新开仓"],
    body: "风险总览汇总当前账户风险、交易权限、就绪状态和未处理风险事件。紧急停止会阻止全部新增交易；普通安全限制只暂停新开仓，仍会管理已有仓位，并在原因解除后自动恢复。"
  },
  {
    id: "risk.mandate", title: "交易权限与风险限制", page: "riskCenter:mandate",
    keywords: ["授权边界", "当前授权委托", "授权", "白名单", "杠杆", "单笔风险", "单日亏损", "近7日", "审批阈值"],
    body: "“资金与交易边界”是相关参数的统一入口：同时展示 OKX 权益、可用保证金、成交后保证金使用率上限、交易权限额度、小额实盘额度和参考单笔上限。页面的资金名义额度按最高授权杠杆展示；真实计划会按实际杠杆重新计算。最终定仓始终取账户资金、单笔/单币种/组合权限、小额实盘和风险约束中最严格的一项。旧授权默认不允许同币种追加仓位；修改会生成新版本并用于后续计划。"
  },
  {
    id: "risk.protection_settings", title: "自动保护设置", page: "riskCenter:mandate",
    keywords: ["自动保护", "运行保护", "盈亏比", "连亏", "冷却", "追踪止损", "每日盈利目标", "保本", "事件窗口", "运行时可调", "风控阈值"],
    body: "自动保护设置包含最低盈亏比、连续亏损暂停、回撤暂停、追踪止损、重大事件前限制，以及可选的“单个 AI 托管持仓浮盈达到明确每日目标后，止损至少保护到开仓价”。目标保本使用 OKX 权威浮盈和真实算法止损，只向有利方向移动；已有更好止损时不修改，也不改变原止盈。"
  },
  {
    id: "risk.rules", title: "风险规则库", page: "riskCenter:rules",
    keywords: ["规则库", "风险规则", "硬风控", "阻断", "动态规则"],
    body: "规则库保存可审计的风险规则。只有被执行引擎支持的结构化条件才会成为硬阻断；纯文字提示必须明确标记为提示，不能显示成已经强制执行。"
  },
  {
    id: "risk.live", title: "实盘设置与小额验证", page: "riskCenter:mandate",
    keywords: ["实盘", "真实下单", "自动开仓", "运行模式", "暂停新开仓"],
    body: "发送真实订单需要 OKX 权限、有效交易权限、风控检查、真实订单开关和运行健康同时满足。小额验证只是限制订单规模，不会绕过任何风险检查；任一必要检查失败都会阻止新增仓位。"
  },
  {
    id: "risk.keys", title: "交易所密钥安全", page: "riskCenter:security",
    keywords: ["密钥安全", "api key", "secret", "passphrase", "提现", "ip白名单", "ip 白名单"],
    body: "OKX API 必须关闭提现权限并建议绑定服务器 IP。密钥不会进入模型上下文或前端回显；权限未核验、凭证不完整或对账异常时实盘开仓会被阻断。"
  },
  {
    id: "operations.center", title: "系统运营、任务与审计", page: "operationsCenter",
    keywords: ["系统运营", "任务", "事件", "通知", "审计", "日志", "运行轨迹"],
    body: "系统运营页用于查看定时任务、事件日历、通知、Agent 编排和审计记录。任务状态来自调度器；审计记录用于解释谁在何时改变了什么，不能当作交易所仓位真相。"
  },
  {
    id: "settings.environment", title: "环境与服务", page: "systemSettings:base",
    keywords: ["环境与服务", "环境", "服务端", "端口", "时区", "数据库", "实时传输"],
    body: "环境与服务展示服务地址、运行环境、时区、数据库与实时通道。端口和部分底层参数需要重启后生效；页面应明确区分立即生效与重启生效。"
  },
  {
    id: "settings.models", title: "模型与密钥", page: "systemSettings:models",
    keywords: ["模型与密钥", "模型", "deepseek", "gemini", "openrouter", "provider"],
    body: "模型设置固定为双模型架构：OpenRouter 的 Gemini 负责主分析和提出候选计划，DeepSeek 官网 API 负责独立审查；任何模型都不能绕过确定性风控和执行闸。两者之间不做跨模型静默降级。留空密钥表示保留已有值；移除是单独操作。客服不能查看密钥原文，也不能代替用户保存敏感凭证。"
  },
  {
    id: "settings.exchange", title: "OKX 连接", page: "systemSettings:exchange",
    keywords: ["交易所连接", "okx连接", "okx 连接", "保证金模式", "持仓模式", "权限核验"],
    body: "OKX 连接页配置 API Key、Secret、Passphrase、IP 白名单、保证金模式和持仓模式。连接成功只代表凭证可用；真实交易仍取决于授权、实盘开关和全部安全闸。"
  },
  {
    id: "settings.network", title: "网络代理", page: "systemSettings:base:proxy",
    keywords: ["网络代理", "代理", "http proxy", "https proxy", "网络"],
    body: "网络代理只在服务器需要代理访问外部 API 时配置。错误代理会造成模型、新闻或交易所连接失败；更改后应运行连接检查。"
  },
  {
    id: "settings.notifications", title: "通知渠道", page: "systemSettings:base:notifications",
    keywords: ["通知渠道", "telegram", "tg", "飞书", "lark", "webhook", "推送"],
    body: "Telegram 仅用于配置的盈利海报和观察哨群推送；飞书用于关键交易、风险与系统事件通知。每个渠道应独立测试，未配置不会影响核心分析与交易逻辑。"
  },
  {
    id: "settings.backup", title: "数据、备份与恢复", page: "systemSettings:base:backup",
    keywords: ["数据与备份", "备份", "恢复", "日志", "清理", "三层记忆"],
    body: "备份应覆盖交易实体、授权、审计、知识和必要配置，并经过恢复演练。清理容器镜像和轮转运行日志不等于删除行情知识、交易复盘或三层记忆；业务数据删除必须走独立保留策略。"
  },
  {
    id: "settings.security", title: "系统安全", page: "systemSettings:base:security",
    keywords: ["安全", "登录", "密码", "2fa", "totp", "会话", "注册"],
    body: "系统安全包含登录鉴权、密码、会话、双因素认证、注册策略和密钥存储。客服只可解释状态和定位页面，不可读取密码、密钥或代替用户完成高风险安全变更。"
  },
  {
    id: "news.intelligence", title: "新闻快讯与事件准备", page: "chat:intelligence",
    keywords: ["新闻", "快讯", "信息面", "事件", "daily", "日报", "rss", "日历"],
    body: "实时快讯用于发现突发消息，官方日历用于提前准备已知宏观事件，日报用于汇总当天重点。来源失败或数据过期必须显示来源与时间，不得由模型补写事实。"
  }
];

// Product UI is bilingual, so support retrieval must be bilingual too. These are
// maintained product statements, not model-generated translations.
const ENGLISH = {
  "assistant.role": { title: "Product Support and AI Trader responsibilities", keywords: ["product support", "assistant", "help", "customer support", "can you trade", "change settings"], body: "The floating assistant is read-only Product Support. It explains features, checks current system status, points to the right setting, and helps troubleshoot. It cannot place or cancel orders, create trade plans, or change trading permissions, risk limits, or secrets. Market analysis and execution belong to the AI Trader; sensitive actions stay in their dedicated pages and confirmation flows." },
  "trading.waiting_entry": { title: "Waiting for entry (no OKX order yet)", keywords: ["waiting for entry", "entry monitoring", "armed", "trigger", "no order", "stop waiting"], body: "Waiting for entry means a plan passed proposal-time risk checks and is being monitored locally, but no order has been sent to OKX. A multi-stage plan may wait for a break, retest, and candle confirmation in sequence; intermediate stages only advance the scenario. The system refreshes facts, reruns hard risk controls, and enters the OMS only after the final stage. Stopping the wait cancels local monitoring. Because this is not an exchange-native conditional order, it cannot execute while the system is offline." },
  "trading.order_states": { title: "Trade plan, open order, and position states", keywords: ["trade plan", "open order", "position", "filled", "order status"], body: "A trade plan is a decision record. Waiting for entry means there is no OKX order. Entry order open means an order was submitted but has not filled. A position appears only after OKX confirms the fill and account synchronization verifies it. OMS and OKX reconciliation are the source of truth." },
  "trader.workflow": { title: "How the AI Trader makes autonomous decisions", keywords: ["ai trader", "market analysis", "decision", "autonomous trading", "workflow", "day trader", "swing trader", "role"], body: "Each cycle first gathers OKX market, closed-candle, account, and event facts, then deterministic code computes auditable multi-timeframe structure. The Day view uses 1H context, 15m structure, and 5m confirmation; the Swing view uses 1D context, 4H structure, and 1H confirmation. Role suitability remains shadow-only: it neither chooses direction nor changes risk. The main Agent combines structure, microstructure, information, execution cost, and account capacity to propose a candidate, which must still pass deterministic risk and execution gates. Code and exchange data remain the source of truth for positions, limits, and order state." },
  "cockpit.overview": { title: "Trading Cockpit", keywords: ["cockpit", "equity", "positions", "orders", "fills", "market"], body: "The Trading Cockpit brings together account equity, verified positions, active orders, fills, and market monitoring. Unsynchronized fields remain unavailable rather than being filled from history or model guesses." },
  "research.center": { title: "Research and the strategy lifecycle", keywords: ["research", "strategy", "backtest", "forward test", "validation", "knowledge", "strategy studio", "natural language strategy", "strategy market"], body: "Strategy Studio compiles natural language into an allowlisted deterministic signal model, then automatically tests schema, parameters, look-ahead isolation, costs, and the non-bypassable risk contract. It uses OKX closed candles for three purged and embargoed out-of-sample folds. A draft can enter the internal market only after generated tests and OOS gates pass. Enabling a version only makes it eligible for AI selection; it is not live validation and cannot bypass live structure, capacity, mandate, or hard-risk checks." },
  "risk.posture": { title: "Risk overview", keywords: ["risk overview", "risk score", "budget", "exposure", "drawdown", "emergency stop", "reduce only"], body: "Risk Overview summarizes account risk, trading permissions, readiness, and open incidents. Emergency stop blocks new trades. Reduce-only allows only actions that lower existing risk." },
  "risk.mandate": { title: "Capital and Trading Limits", keywords: ["capital", "trading permissions", "available margin", "post-trade margin", "allowed pairs", "leverage", "risk per trade", "daily loss", "approval"], body: "Capital & Trading Limits is the single place for OKX equity, available margin, the post-trade margin-use ceiling, trading-permission limits, live-validation limits, and an indicative per-order amount. The page estimates fund-based notional at the highest authorized leverage; every real plan is recalculated at its actual leverage. Final sizing always uses the strictest account, per-order, per-pair, portfolio, live-validation, and risk constraint. Legacy permissions do not authorize adding to an existing pair unless that option is explicitly enabled." },
  "risk.protection_settings": { title: "Automatic Protection settings", keywords: ["automatic protection", "reward to risk", "losing streak", "drawdown pause", "trailing stop", "daily profit goal", "break even", "event window"], body: "Automatic Protection covers minimum reward-to-risk, losing-streak pauses, drawdown pauses, trailing stops, event limits, and an optional rule that protects an AI-managed position at least at entry after its OKX-verified unrealized PnL reaches the explicitly saved daily goal. It never weakens a better stop or changes take-profit targets." },
  "risk.rules": { title: "Risk Rules", keywords: ["risk rules", "hard risk control", "block", "dynamic rule"], body: "Risk Rules stores auditable controls. Only structured conditions supported by the execution engine can hard-block a trade. Plain-text guidance must remain guidance and cannot be presented as enforced." },
  "risk.live": { title: "Live trading and small-size validation", keywords: ["live trading", "real orders", "automatic entries", "small size", "reduce only"], body: "Real orders require valid OKX permissions, active trading permissions, risk approval, the real-order switch, and healthy runtime checks. Small-size validation limits order size but never bypasses risk controls. These controls are managed in Capital & Trading Limits. Any required check can block a new position." },
  "risk.keys": { title: "Exchange key security", keywords: ["api key", "secret", "passphrase", "withdrawal", "ip allowlist", "key security"], body: "The OKX API key must have withdrawals disabled and should be restricted to the server IP. Secrets are never placed in model context or returned to the frontend. Incomplete credentials, unverified permissions, or reconciliation problems block live entries." },
  "operations.center": { title: "Operations, tasks, and audit", keywords: ["operations", "tasks", "events", "notifications", "audit", "logs"], body: "Operations shows scheduled tasks, the event calendar, notifications, agent orchestration, and audit records. Scheduler state explains task execution; audit records explain system changes, but neither is a substitute for verified exchange positions." },
  "settings.environment": { title: "Environment and Services", keywords: ["environment", "server", "port", "timezone", "database", "realtime"], body: "Environment and Services shows the server address, runtime, timezone, database, and real-time channels. Ports and some low-level values require a service restart; the UI distinguishes immediate changes from restart-required changes." },
  "settings.models": { title: "Models and Keys", keywords: ["models", "deepseek", "gemini", "openrouter", "provider", "model key"], body: "The model layer is fixed to two roles: Gemini through OpenRouter performs primary analysis and proposes candidates; DeepSeek through its official API independently reviews them. Neither model can bypass deterministic risk and execution gates, and there is no silent cross-model fallback. Leaving a secret blank preserves the existing value; removing it is a separate action. Product Support cannot read or save secret values for the user." },
  "settings.exchange": { title: "OKX connection", keywords: ["okx connection", "exchange", "margin mode", "position mode", "permission check"], body: "The OKX connection page configures the API key, secret, passphrase, IP allowlist, margin mode, and position mode. A successful connection confirms credentials only; live trading still depends on trading permissions, live switches, and every safety check." },
  "settings.network": { title: "Network Proxy", keywords: ["network proxy", "http proxy", "https proxy", "network"], body: "Configure a proxy only when the server needs it to reach external APIs. An incorrect proxy can break model, news, or exchange connections; run connection checks after changing it." },
  "settings.notifications": { title: "Notification Channels", keywords: ["notification", "telegram", "lark", "webhook", "push"], body: "Telegram is reserved for configured profit posters and watch-condition group updates. Lark carries important trading, risk, and system alerts. Test each channel independently; an unconfigured channel does not change core analysis or trading logic." },
  "settings.backup": { title: "Data, backup, and recovery", keywords: ["backup", "restore", "logs", "cleanup", "memory"], body: "Backups cover trading entities, permissions, audit, knowledge, and required configuration, and should be verified through restore drills. Pruning container images and rotating runtime logs does not delete market knowledge, trade reviews, or layered memory; business-data deletion follows a separate retention policy." },
  "settings.security": { title: "System Security", keywords: ["security", "login", "password", "2fa", "totp", "session", "registration"], body: "System Security covers sign-in, passwords, sessions, two-factor authentication, registration policy, and secret storage. Product Support can explain status and navigation but cannot read passwords or secrets or perform sensitive changes." },
  "news.intelligence": { title: "Breaking news and event preparation", keywords: ["news", "breaking news", "events", "daily brief", "rss", "calendar"], body: "The breaking-news feed discovers unexpected events, official calendars prepare for known macro releases, and the Daily Brief summarizes the day's priorities. Failed or stale sources must retain source and time evidence; the model cannot invent missing facts." }
};

function normalized(value) { return String(value || "").toLowerCase().replace(/[\s·_:/（）()\-]/g, ""); }

export function searchSupportArticles(question, pageContext = {}, limit = 5) {
  const query = normalized(question);
  const page = String(pageContext.page || "");
  const english = pageContext.language === "en";
  return ARTICLES.map((article) => {
    const en = ENGLISH[article.id];
    let score = article.page === "global" ? 1 : 0;
    if (page && (page === article.page || page.startsWith(article.page) || article.page.startsWith(page))) score += 8;
    for (const keyword of [...article.keywords, ...(en?.keywords || [])]) if (query.includes(normalized(keyword))) score += normalized(keyword).length + 3;
    for (const token of String(en?.title || "").toLowerCase().split(/\W+/).filter((word) => word.length >= 4)) if (query.includes(normalized(token))) score += token.length;
    if (query.includes(normalized(article.title)) || (en?.title && query.includes(normalized(en.title)))) score += 12;
    return { article: english && en ? { ...article, ...en } : article, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(({ article }) => ({
    ...article,
    release: RELEASE,
    citation: `${english ? "Product guide" : "产品说明"} · ${article.title} · ${RELEASE}`
  }));
}

function activeRows(items, states) { return (items || []).filter((row) => states.includes(String(row.status || "").toLowerCase())); }

export function buildSupportDiagnostics(db, question, pageContext = {}) {
  const q = normalized(question);
  const sys = db.system || {};
  const portfolio = db.portfolio || {};
  const positions = (db.positions || []).filter((row) => Number(row.size ?? row.pos ?? 0) !== 0);
  const armed = activeRows(db.armedSetups, ["armed", "triggered", "fast_validating"]);
  const orders = activeRows(db.executionOrders, ["submitted", "entry_pending", "entry_filled", "protecting", "executing"]);
  const incidents = activeRows(db.riskIncidents, ["open"]);
  const latestSnapshot = (db.accountSnapshots || []).find((row) => row.status === "ok") || null;
  const facts = [
    `当前页面：${pageContext.page || "未知"}；界面语言：${pageContext.language || sys.uiLang || "zh"}；版本：${RELEASE}`,
    `账户：权益 ${portfolio.totalEquityUsdt ?? "未同步"} USDT；真实持仓 ${positions.length}；账户事实时间 ${latestSnapshot?.createdAt || "未同步"}`,
    `交易运行：已选模式 ${sys.requestedOperatingMode || (sys.liveTradingEnabled ? "真实交易" : "只分析")}；紧急停止${sys.killSwitch ? "开启" : "关闭"}；暂停新开仓${sys.reduceOnlyMode ? "是" : "否"}`,
    `待处理：等待入场条件 ${armed.length}；在途执行 ${orders.length}；未处理风险事件 ${incidents.length}`
  ];
  const evidence = ["support_tool:system_status", "support_tool:account_snapshot"];

  if (/等待入场|条件计划|条件已武装|armed|委托|挂单|下单|持仓/.test(q)) {
    facts.push(armed.length ? `等待入场明细：${armed.slice(0, 8).map((setup) => {
      const trigger = setup.trigger || {};
      const condition = trigger.kind === "enter_zone" ? `${trigger.levelLow}-${trigger.levelHigh}` : `${trigger.kind}@${trigger.level}`;
      return `${setup.symbol} ${setup.direction}，条件 ${condition}，确认规则 ${(trigger.confirmations || []).map((row) => `${row.timeframe}:${row.kind}`).join("+") || "仅价格"}，到期 ${setup.expiresAt}`;
    }).join("；")}` : "当前没有等待入场条件的计划");
    facts.push(orders.length ? `在途订单：${orders.slice(0, 8).map((row) => `${row.symbol} ${row.status}，OKX订单号${row.exchangeOrderId || row.orderId || "未返回"}`).join("；")}` : "当前没有在途 OKX 执行订单");
    evidence.push("support_tool:trade_state");
  }
  if (/策略|回测|前向|转正|研究|工作室|市场/.test(q)) {
    const catalog = buildStrategyProductCatalog(db);
    facts.push(`策略产品：总数 ${catalog.summary.total}；实盘观察 ${catalog.summary.liveObservation}；证据达标运行 ${catalog.summary.validatedActive}；证据门槛通过 ${catalog.summary.evidenceQualified}`);
    facts.push(`策略工作室：草稿 ${(db.strategyStudioDrafts || []).length}；已发布版本 ${(db.strategyBlueprintVersions || []).length}；已启用 ${(db.strategyAssignments || []).filter((row) => row.enabled).length}；工作室回测 ${(db.strategyStudioBacktests || []).length}`);
    evidence.push("support_tool:strategy_catalog");
  }
  if (/新闻|快讯|rss|事件|日历|日报|信息面/.test(q)) {
    const sources = db.marketIntelligenceSourceHealth || db.eventSources || [];
    facts.push(`信息来源：${sources.slice(0, 12).map((row) => `${row.name || row.id}:${row.health || row.lastStatus || row.status || "未知"}`).join("；") || "未同步"}`);
    evidence.push("support_tool:information_sources");
  }
  if (/配置|模型|密钥|交易所|网络|代理|通知|备份|安全|登录|密码/.test(q)) {
    const config = db.config || {};
    const accounts = db.exchangeAccounts || [];
    facts.push(`配置状态：模型 ${config.llm?.activeProvider || "未配置"}；OKX ${accounts.some((row) => row.exchange === "OKX" && row.readEnabled) ? "已连接" : "未连接"}；Telegram ${config.integrations?.telegram?.configured ? "已配置" : "未配置"}；飞书 ${config.integrations?.lark?.hasWebhook ? "已配置" : "未配置"}`);
    evidence.push("support_tool:configuration_status");
  }
  return { facts, evidence, asOf: new Date().toISOString(), release: RELEASE };
}

export function supportCatalogSummary() {
  return {
    release: RELEASE,
    articles: ARTICLES.length,
    pages: [...new Set(ARTICLES.map((article) => article.page))],
    articleIds: ARTICLES.map((article) => article.id)
  };
}
