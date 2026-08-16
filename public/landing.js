(function () {
  "use strict";

  var I18N = {
    "nav.problem": ["问题", "Problem"],
    "nav.system": ["系统", "System"],
    "nav.capabilities": ["能力", "Capabilities"],
    "nav.compare": ["对比", "Compare"],
    "nav.guardrails": ["安全边界", "Guardrails"],
    "nav.contact": ["联系", "Contact"],
    "cta.dashboard": ["进入驾驶舱", "Open cockpit"],
    "cta.launch": ["启动驾驶舱", "Launch cockpit"],
    "cta.flightplan": ["查看飞行计划", "See the flight plan"],
    "cta.request": ["申请开通", "Request access"],
    "ticker.label": ["OKX 实时信号", "OKX LIVE SIGNAL"],
    "ticker.loading": ["正在接入实时行情…", "Connecting to live market data…"],
    "ticker.unavailable": ["实时行情暂不可用 · 正在自动重试", "LIVE FEED UNAVAILABLE · RETRYING"],
    "hero.kicker": ["有边界的自主智能", "BOUND AUTONOMOUS INTELLIGENCE"],
    "hero.statement": ["不是靠冲动起飞。<br>让 AI 把每一步变成有证据的航线。", "Not a launch on impulse.<br>AI turns every step into an evidenced flight path."],
    "hero.description": ["KORDYN 把交易所实时事实、专业知识、结构化计划、硬风控、受控执行与复盘连接起来，在你设定的资金与权限边界内持续工作。", "KORDYN connects live exchange facts, expert knowledge, structured plans, hard risk controls, controlled execution, and review—continuously operating within the capital and authority limits you define."],
    "hero.boundary1": ["默认只读", "Read-only by default"],
    "hero.boundary2": ["提现权限关闭", "Withdrawals disabled"],
    "hero.boundary3": ["每笔动作可追踪", "Every action traceable"],
    "hero.noteLabel": ["TO THE MOON", "TO THE MOON"],
    "hero.note": ["是对系统工程标准的要求，不是收益承诺。", "describes our engineering ambition—not a promise of returns."],
    "telemetry.market": ["市场事实已绑定", "Market facts bound"],
    "telemetry.risk": ["硬风控在线", "Hard risk online"],
    "console.title": ["决策证据链", "Decision evidence chain"],
    "console.fact1": ["账户绑定", "Account binding"],
    "console.fact2": ["市场事实", "Market facts"],
    "console.fact3": ["执行状态", "Execution state"],
    "console.bound": ["已验证", "VERIFIED"],
    "console.fresh": ["双时钟", "DUAL CLOCK"],
    "console.reconcile": ["持续对账", "RECONCILING"],
    "console.footer": ["模型负责判断，系统负责边界。", "The model reasons. The system enforces."],
    "lunar.captionTitle": ["可验证的智能", "Verifiable intelligence"],
    "lunar.captionText": ["API 事实先归一、校验、绑定证据，再进入模型。", "API facts are normalized, validated, and evidence-bound before the model sees them."],
    "proof.phases": ["个连续决策阶段", "connected decision phases"],
    "proof.clocks": ["交易所源时间 + 接收时间", "exchange source + receive time"],
    "proof.authority": ["套明确交易权限", "explicit authority envelope"],
    "proof.monitor": ["市场与仓位持续监控", "continuous market & position watch"],

    "problem.title": ["市场没有下班，人的注意力会。", "Markets never clock out. Human attention does."],
    "problem.lead": ["问题不是缺少信息，而是信息、判断、风险与执行彼此断开。交易者在多块屏幕间追赶，普通机器人只会重复规则，通用 Agent 又缺少真实交易状态。", "The problem is not a lack of information. Facts, judgment, risk, and execution are disconnected. Traders chase screens, fixed bots repeat rules, and general agents lack real trading state."],
    "problem.oneTitle": ["事实碎片化", "Fragmented facts"],
    "problem.oneText": ["行情、盘口、资金费率、OI、事件、账户与挂单散落在不同接口，单位和时间口径也不一致。", "Price, order book, funding, OI, events, accounts, and orders live across different interfaces with different units and clocks."],
    "problem.twoTitle": ["纪律难以持续", "Discipline decays"],
    "problem.twoText": ["人会疲劳、追涨、忽略事件窗口；固定机器人又无法理解新的市场语境和你的专业知识。", "People tire, chase moves, and miss event windows. Fixed bots cannot understand new context or apply your evolving expertise."],
    "problem.threeTitle": ["执行不等于闭环", "Execution is not closure"],
    "problem.threeText": ["下单只是开始。部分成交、止损、撤单、响应未知、费用和资金费都需要持续对账与恢复。", "Placing an order is only the start. Partial fills, stops, cancellations, unknown responses, fees, and funding all require reconciliation and recovery."],
    "problem.answerLabel": ["KORDYN 的回答", "KORDYN'S ANSWER"],
    "problem.answer": ["让 AI 负责持续理解，让确定性系统负责权限、风险和执行真相。", "Let AI sustain understanding—while deterministic systems own authority, risk, and execution truth."],

    "system.title": ["一条航线，连接感知、判断与行动。", "One flight path connects sensing, judgment, and action."],
    "system.lead": ["这不是“让模型直接下单”。每个阶段都有输入、证据、状态与明确后继；远端结果未知时进入恢复，而不是假装成功。", "This is not “let the model place orders.” Every phase has inputs, evidence, state, and a defined successor. Unknown remote outcomes enter recovery instead of being called success."],
    "system.sense": ["感知真实市场", "Sense the real market"],
    "system.senseText": ["OKX 行情、盘口、资金费率、OI、账户、持仓与订单，经单位和源时间校验。", "OKX prices, book, funding, OI, account, positions, and orders are validated for units and source time."],
    "system.recall": ["召回专业知识", "Recall expert knowledge"],
    "system.recallText": ["书籍、研究、规则、复盘与反方观点按当前问题组成证据包。", "Books, research, rules, reviews, and counter-views form an evidence bundle for the decision at hand."],
    "system.plan": ["生成结构化计划", "Build a structured plan"],
    "system.planText": ["方向、入场、止损、目标、仓位、失效条件与依据完整绑定。", "Direction, entry, stop, target, sizing, invalidation, and evidence are bound together."],
    "system.guard": ["通过硬风控闸", "Pass hard risk gates"],
    "system.guardText": ["权限、日亏损、杠杆、流动性、事件窗和同向风险在模型之外校验。", "Authority, daily loss, leverage, liquidity, event windows, and correlated exposure are checked outside the model."],
    "system.execute": ["受控执行与对账", "Execute and reconcile"],
    "system.executeText": ["稳定订单身份、幂等提交、状态轮询、保护确认和异常恢复共用一套状态机。", "Stable order identity, idempotent submission, polling, protection confirmation, and recovery share one state machine."],
    "system.monitor": ["持续管理仓位", "Continuously manage risk"],
    "system.monitorText": ["跟踪止损止盈、强平距离、移动保护与事件变化，只在证据充分时行动。", "Stops, targets, liquidation distance, trailing protection, and events are monitored; actions require sufficient evidence."],
    "system.review": ["财务对账与复盘", "Reconcile and review"],
    "system.reviewText": ["真实成交、手续费、返佣与资金费完成后，才进入净绩效与知识反馈。", "Only reconciled fills, fees, rebates, and funding enter net performance and the knowledge feedback loop."],

    "cap.title": ["不是一个聊天框，是一套交易操作系统。", "Not a chat box. A trading operating system."],
    "cap.lead": ["从情报、知识和策略，到事件任务与资金边界：这里展示的是 KORDYN App 正在工作的真实产品界面。", "From intelligence, knowledge, and strategies to events, tasks, and capital limits—this is the real KORDYN App at work."],
    "cap.intelTitle": ["汇总实时情报", "Unify live intelligence"],
    "cap.intelBoundary": ["数据过期或来源不足，不形成确定结论", "Stale or weakly sourced data cannot become a firm conclusion"],
    "cap.knowledgeTitle": ["调用专业知识", "Apply expert knowledge"],
    "cap.knowledgeBoundary": ["未经审批的自由文本不会成为系统指令", "Unapproved free text never becomes a system instruction"],
    "cap.strategyTitle": ["采用版本化策略", "Use versioned strategies"],
    "cap.strategyBoundary": ["未验证、未批准的版本不能进入实盘", "Unvalidated or unapproved versions cannot enter live trading"],
    "cap.operationsTitle": ["持续监控事件与任务", "Monitor events and tasks continuously"],
    "cap.operationsBoundary": ["任务只能唤醒判断，不能绕过风控下单", "Tasks may wake a decision, never bypass risk controls"],
    "cap.riskTitle": ["在授权范围内执行", "Execute inside explicit authority"],
    "cap.riskBoundary": ["额度、杠杆、亏损与紧急停止由代码控制", "Limits, leverage, loss, and emergency stops are code-enforced"],

    "common.all": ["全部", "All"],
    "common.items": ["条", "items"],
    "common.name": ["名称", "Name"],
    "common.type": ["类型", "Type"],
    "common.status": ["状态", "Status"],
    "common.high": ["高", "High"],
    "common.medium": ["中", "Medium"],
    "common.low": ["低", "Low"],

    "app.realUi": ["真实产品界面", "REAL PRODUCT UI"],
    "app.synced": ["事实同步于 12 秒前", "Facts synced 12 seconds ago"],
    "app.demoData": ["示例数据 · 事实同步于 12 秒前", "DEMO DATA · Facts synced 12 seconds ago"],
    "app.workspace": ["产品工作区", "WORKSPACES"],
    "app.intel": ["情报中心", "Intelligence"],
    "app.knowledge": ["知识库", "Knowledge"],
    "app.strategy": ["策略库", "Strategies"],
    "app.operations": ["事件与任务", "Events & Tasks"],
    "app.risk": ["资金与边界", "Capital & Limits"],
    "app.guardOnline": ["硬风控在线", "Hard risk online"],
    "app.sevenGates": ["7 / 7 安全闸可用", "7 / 7 safety gates available"],
    "app.crumb": ["工作台 / 实盘主账户", "Workspace / Primary live account"],
    "app.autonomous": ["自主运行中", "Autonomy running"],
    "app.reduceOnly": ["只减仓", "Reduce only"],
    "app.pause": ["暂停自主", "Pause autonomy"],
    "app.accountEquity": ["账户权益", "Account equity"],
    "app.factsVerified": ["账户事实已验证", "Account facts verified"],
    "app.marginUsed": ["保证金使用", "Margin used"],
    "app.marginHealthy": ["健康 · 可用 9,742 USDT", "Healthy · 9,742 USDT available"],
    "app.riskBudget": ["风险预算", "Risk budget"],
    "app.withinLimits": ["所有限制以内", "Inside all limits"],
    "app.dataHeartbeat": ["数据心跳", "Data heartbeat"],

    "intel.title": ["AI 交易员", "AI Trader"],
    "intel.dialog": ["对话", "Dialog"],
    "intel.tab": ["情报", "Intel"],
    "intel.watch": ["盯盘", "Watch"],
    "intel.refresh": ["刷新情报", "Refresh intel"],
    "intel.categories": ["情报分类", "Intel categories"],
    "intel.flash": ["快讯", "Flash"],
    "intel.macro": ["宏观", "Macro"],
    "intel.market": ["市场", "Market"],
    "intel.knowledge": ["知识", "Knowledge"],
    "intel.confidence": ["置信度 ≥ 70%", "Confidence ≥ 70%"],
    "intel.liveFlashes": ["实时快讯", "Live flashes"],
    "intel.fastLane": ["30 秒快车道", "30s fast lane"],
    "intel.marketState": ["市场状态", "Market state"],
    "intel.regime": ["趋势扩张", "Trend expansion"],
    "intel.structure": ["结构判断", "Structure read"],
    "intel.anomalies": ["异常波动", "Anomalies"],
    "intel.liveScan": ["实时扫描", "Live scan"],
    "intel.sentiment": ["多源倾向", "Multi-source bias"],
    "intel.bullish": ["温和偏多", "Mild bullish bias"],
    "intel.flowing": ["分层新闻流运行中", "Layered news feed running"],
    "intel.feed": ["情报动态", "Intel Feed"],
    "intel.justUpdated": ["刚更新", "Just updated"],
    "intel.news1": ["美国核心通胀低于预期，风险资产快速上行", "US core inflation misses expectations; risk assets rise quickly"],
    "intel.news1Text": ["BTC 与 ETH 同步放量，仍等待利率路径与盘口深度交叉确认。", "BTC and ETH volume expanded together; rate-path and order-book confirmation are still pending."],
    "intel.news2": ["BTC 永续合约未平仓量 15 分钟上升 4.8%", "BTC perpetual open interest rose 4.8% in 15 minutes"],
    "intel.news2Text": ["价格与 OI 同向上升，资金费率仍处于中性区间。", "Price and OI rose together while funding remains neutral."],
    "intel.news3": ["策略库命中：突破回踩确认", "Strategy match: breakout retest confirmation"],
    "intel.news3Text": ["只作为候选上下文，尚未形成交易计划。", "Candidate context only; no trade plan has been formed."],
    "intel.news4": ["买一至买五深度较 1 小时均值增加 22%", "Top-five bid depth is 22% above its one-hour average"],
    "intel.news4Text": ["主动买单占比 57%，盘口支撑增强但尚未触发入场条件。", "Aggressive buys are 57%; book support improved without triggering entry conditions."],
    "intel.news5": ["未来 4 小时暂无一级宏观事件", "No tier-one macro event in the next four hours"],
    "intel.news5Text": ["事件静默窗未启用，系统维持正常观察频率。", "No event blackout is active; normal watch cadence remains in force."],
    "intel.impact": ["影响评估", "Impact Assessment"],
    "intel.relatedAssets": ["关联资产", "Related assets"],
    "intel.direction": ["方向影响", "Directional impact"],
    "intel.positive": ["偏多", "Bullish bias"],
    "intel.sources": ["交叉来源", "Cross sources"],
    "intel.freshness": ["事实新鲜度", "Fact freshness"],
    "intel.signalMix": ["证据一致度", "Evidence alignment"],
    "intel.orderbook": ["盘口结构", "Order book"],
    "intel.derivatives": ["衍生品", "Derivatives"],
    "intel.macroData": ["宏观数据", "Macro data"],
    "intel.contextOnly": ["当前情报只进入分析上下文，不会直接触发下单。", "This intelligence enters analysis context only and never triggers an order directly."],

    "knowledge.title": ["研究中心", "Research"],
    "knowledge.capabilities": ["能力库", "Capabilities"],
    "knowledge.import": ["导入知识", "Import knowledge"],
    "knowledge.parse": ["解析来源", "Parse sources"],
    "knowledge.distill": ["蒸馏方法", "Distill methods"],
    "knowledge.compile": ["编译技能", "Compile skills"],
    "knowledge.validate": ["验证批准", "Validate & approve"],
    "knowledge.liveUse": ["实盘采用", "Live use"],
    "knowledge.indexHealth": ["索引健康度", "Index health"],
    "knowledge.citations": ["可追溯引用", "Traceable citations"],
    "knowledge.sourceAnchors": ["页码与来源锚点", "Page and source anchors"],
    "knowledge.readySkills": ["候选技能", "Candidate skills"],
    "knowledge.awaitingApproval": ["项等待批准", "awaiting approval"],
    "knowledge.lastCompile": ["最近编译", "Last compile"],
    "knowledge.compileSuccess": ["无冲突 · 通过", "No conflicts · passed"],
    "knowledge.sources": ["知识源", "Knowledge Sources"],
    "knowledge.effect": ["实际作用", "Actual effect"],
    "knowledge.source1": ["专业交易系统与方法", "Professional Trading Systems & Methods"],
    "knowledge.source2": ["BTC 突破交易复盘", "BTC breakout trade reviews"],
    "knowledge.source3": ["风险管理条令", "Risk management doctrine"],
    "knowledge.source4": ["订单簿微观结构笔记", "Order-book microstructure notes"],
    "knowledge.source5": ["宏观事件反应手册", "Macro-event response playbook"],
    "knowledge.indexed": ["已索引", "Indexed"],
    "knowledge.active": ["已生效", "Active"],
    "knowledge.pending": ["待审批", "Pending"],
    "knowledge.review": ["复盘", "Review"],
    "knowledge.doctrine": ["条令", "Doctrine"],
    "knowledge.methods8": ["8 条方法", "8 methods"],
    "knowledge.lessons4": ["4 条经验", "4 lessons"],
    "knowledge.rules3": ["3 条规则", "3 rules"],
    "knowledge.signals6": ["6 条信号", "6 signals"],
    "knowledge.playbook": ["手册", "Playbook"],
    "knowledge.scenarios7": ["7 个情景", "7 scenarios"],
    "knowledge.network": ["概念与知识网络", "Concept & Knowledge Network"],
    "knowledge.concepts": ["个概念", "concepts"],
    "knowledge.breakout": ["突破交易", "Breakout trading"],
    "knowledge.volume": ["成交量确认", "Volume confirmation"],
    "knowledge.falseBreak": ["假突破", "False breakout"],
    "knowledge.liquidity": ["流动性", "Liquidity"],
    "knowledge.stop": ["结构止损", "Structure stop"],
    "knowledge.volatility": ["波动率", "Volatility"],
    "knowledge.openInterest": ["未平仓量", "Open interest"],
    "knowledge.eventWindow": ["事件窗口", "Event window"],
    "knowledge.approvedRelation": ["已批准关系", "Approved link"],
    "knowledge.pendingRelation": ["待验证关系", "Pending validation"],
    "knowledge.doctrineLive": ["生效中的条令", "Active Doctrine"],
    "knowledge.lenses": ["分析透镜", "Analysis lenses"],
    "knowledge.ironRules": ["风控铁律", "Risk rules"],
    "knowledge.rule1": ["不在数据过期时新开仓", "No new entries on stale data"],
    "knowledge.hardBlock": ["确定性硬拦截", "Deterministic hard block"],
    "knowledge.rule2": ["突破必须得到成交量确认", "Breakouts require volume confirmation"],
    "knowledge.agentLens": ["Agent 分析透镜", "Agent analysis lens"],
    "knowledge.truthTitle": ["交易方法 ≠ 已上岗策略。", "A trading method is not a live strategy."],
    "knowledge.truthText": ["只有完成历史验证、前向验证和人工批准的技能，才可能按匹配信号进入交易计划。", "Only skills that complete historical validation, forward validation, and human approval may enter a trade plan on matching signals."],

    "strategy.title": ["策略库", "Strategy Library"],
    "strategy.catalog": ["策略目录", "Strategy Catalog"],
    "strategy.studio": ["策略工作室", "Strategy Studio"],
    "strategy.marketplace": ["市场", "Marketplace"],
    "strategy.import": ["导入研究策略", "Import research strategy"],
    "strategy.total": ["策略版本", "Strategy versions"],
    "strategy.validated": ["历史已验证", "Historically validated"],
    "strategy.forward": ["前向验证中", "Forward validating"],
    "strategy.live": ["实盘小额试用", "Small-size live probation"],
    "strategy.thisMonth": ["本月", "this month"],
    "strategy.samples": ["个样本", "samples"],
    "strategy.paperDays": ["个前向交易日", "forward-trading days"],
    "strategy.riskCap": ["风险上限", "risk cap"],
    "strategy.versioned": ["版本化产品", "Versioned products"],
    "strategy.name": ["策略", "Strategy"],
    "strategy.market": ["市场", "Market"],
    "strategy.stage": ["阶段", "Stage"],
    "strategy.oos": ["样本外", "Out of sample"],
    "strategy.probation": ["小额试用", "Small-size probation"],
    "strategy.active": ["生效", "Active"],
    "strategy.validating": ["验证中", "Validating"],
    "strategy.history": ["历史验证", "Historical validation"],
    "strategy.rejected": ["未通过", "Rejected"],
    "strategy.description": ["突破关键结构后等待回踩与成交量确认，只在趋势扩张环境中寻找顺势机会。", "Wait for a retest and volume confirmation after a structural breakout, seeking continuation only in a trend-expansion regime."],
    "strategy.direction": ["方向", "Direction"],
    "strategy.longShort": ["双向", "Long & short"],
    "strategy.timeframe": ["周期", "Timeframe"],
    "strategy.maxRisk": ["最大单笔风险", "Max risk per trade"],
    "strategy.approver": ["批准人", "Approver"],
    "strategy.oosReturn": ["样本外结果", "Out-of-sample result"],
    "strategy.testTrades": ["验证交易", "Validation trades"],
    "strategy.riskAdjusted": ["风险调整得分", "Risk-adjusted score"],
    "strategy.illustrative": ["示例验证数据 · 不代表未来表现", "Illustrative validation data · not indicative of future performance"],
    "strategy.compiled": ["已编译", "Compiled"],
    "strategy.backtested": ["历史通过", "Backtest passed"],
    "strategy.paperPassed": ["前向通过", "Forward passed"],
    "strategy.boundTitle": ["未批准版本不会进入实盘", "Unapproved versions cannot enter live trading"],
    "strategy.boundText": ["每次计划同时记录策略 ID、版本和验证证据。", "Every plan records the strategy ID, version, and validation evidence."],

    "operations.title": ["系统运营", "Operations"],
    "operations.overview": ["总览", "Overview"],
    "operations.events": ["事件日历", "Events"],
    "operations.tasks": ["任务调度", "Tasks"],
    "operations.audit": ["审计", "Audit"],
    "operations.add": ["添加日程", "Add event"],
    "operations.healthy": ["调度健康", "Scheduler healthy"],
    "operations.totalTasks": ["任务总数", "Total tasks"],
    "operations.success": ["成功率", "Success rate"],
    "operations.running": ["执行中", "Running"],
    "operations.queued": ["等待队列", "Queued"],
    "operations.upcoming": ["即将发生的事件", "Upcoming Events"],
    "operations.event1": ["美联储讲话", "Fed speech"],
    "operations.event2": ["BTC 期权到期", "BTC options expiry"],
    "operations.chainUpgrade": ["链上升级", "Network upgrade"],
    "operations.weeklyReview": ["周度风险复盘", "Weekly risk review"],
    "operations.silence": ["事件静默窗：前后 30 分钟", "Event blackout: 30 minutes before and after"],
    "operations.btcExpiry": ["BTC 期权到期", "BTC options expiry"],
    "operations.monitorOnly": ["仅监控，不直接触发交易", "Monitor only; never triggers a trade directly"],
    "operations.fundingSettle": ["资金费率结算", "Funding settlement"],
    "operations.reconcileFunding": ["结算后自动核对净费用", "Reconcile net fees after settlement"],
    "operations.mainChain": ["自主主链路", "Autonomous Main Chain"],
    "operations.sync": ["同步市场与账户", "Sync market & account"],
    "operations.scan": ["巡检与决策", "Scan & decide"],
    "operations.monitor": ["观察哨监控", "Watch monitoring"],
    "operations.guardCheck": ["重跑硬风控", "Re-run hard risk"],
    "operations.reconcile": ["执行与对账", "Execute & reconcile"],
    "operations.reviewLoop": ["财务复盘回流", "Financial review feedback"],
    "operations.recentRuns": ["近期运行", "Recent Runs"],
    "operations.marketRefresh": ["市场事实刷新", "Market fact refresh"],
    "operations.eventRefresh": ["事件源刷新", "Event source refresh"],
    "operations.agentCycle": ["Agent 决策循环", "Agent decision cycle"],
    "operations.riskSnapshot": ["风险快照固化", "Risk snapshot sealed"],
    "operations.orderReconcile": ["订单状态对账", "Order-state reconciliation"],
    "operations.noTrade": ["无交易", "No trade"],

    "risk.title": ["资金与交易控制", "Capital & Trading Controls"],
    "risk.overview": ["风险总览", "Risk overview"],
    "risk.limits": ["资金与交易边界", "Capital & Trading Limits"],
    "risk.rules": ["风控规则", "Risk Rules"],
    "risk.emergency": ["紧急停止", "Emergency stop"],
    "risk.orderLimit": ["当前有效单笔上限", "Effective limit per order"],
    "risk.liveCapacity": ["已计入实时账户容量", "Includes live account capacity"],
    "risk.pairLimit": ["单交易对累计上限", "Cumulative limit per pair"],
    "risk.portfolioLimit": ["全部持仓累计上限", "Portfolio notional limit"],
    "risk.leverage": ["允许杠杆", "Allowed leverage"],
    "risk.current": ["当前", "current"],
    "risk.accountEquity": ["账户权益", "Account equity"],
    "risk.fresh": ["12 秒前验证", "Verified 12 seconds ago"],
    "risk.availableBalance": ["可用余额", "Available balance"],
    "risk.riskBudgetUsed": ["风险预算使用", "Risk budget used"],
    "risk.dailyBudgetUsed": ["日亏损预算使用", "Daily loss budget used"],
    "risk.liquidationBuffer": ["强平安全距离", "Liquidation buffer"],
    "risk.safe": ["安全", "Safe"],
    "risk.mode": ["执行方式", "Execution Mode"],
    "risk.approvalMode": ["逐笔确认", "Per-trade approval"],
    "risk.observe": ["只分析，不下单", "Analyze only"],
    "risk.observeText": ["继续发现机会，不向 OKX 提交订单", "Keep finding opportunities without sending orders to OKX"],
    "risk.approveEach": ["逐笔确认后下单", "Approve each trade"],
    "risk.approveEachText": ["每笔计划由你批准后才使用真实资金", "Each plan needs your approval before using real funds"],
    "risk.autoWithin": ["符合限制时自动下单", "Automatic within limits"],
    "risk.autoWithinText": ["全部事实、权限与硬风控通过后执行", "Execute only after all facts, permissions, and hard-risk checks pass"],
    "risk.lossLimits": ["杠杆与亏损边界", "Leverage & Loss Limits"],
    "risk.tradeLoss": ["单笔最多亏损", "Maximum loss per trade"],
    "risk.dailyLoss": ["单日亏损上限", "Daily loss limit"],
    "risk.weeklyLoss": ["近 7 日亏损上限", "Rolling 7-day loss limit"],
    "risk.positions": ["最多同时持仓", "Maximum concurrent positions"],
    "risk.secrets": ["密钥不进入模型", "Secrets never enter the model"],
    "risk.secretsText": ["Secret 与 Passphrase 隔离于模型上下文和普通日志。", "Secrets and passphrases are isolated from model context and ordinary logs."],
    "risk.liveChecks": ["实盘交易检查", "Live trading checks"],
    "risk.passed": ["通过", "passed"],
    "risk.check1": ["API Key 已确认禁止提现", "API key confirmed without withdrawal access"],
    "risk.check2": ["账户事实新鲜且环境一致", "Account facts are fresh and environment-bound"],
    "risk.check3": ["策略版本已批准", "Strategy version approved"],
    "risk.check4": ["保护单能力可验证", "Protection-order capability verified"],
    "risk.check5": ["审计链完整", "Audit chain intact"],
    "risk.check6": ["当前不在高风险事件静默窗", "Outside high-risk event blackout windows"],
    "risk.check7": ["亏损与同向敞口预算充足", "Loss and correlated-exposure budgets available"],

    "compare.title": ["AI Agent 很多，交易闭环很少。", "AI agents are everywhere. Closed trading loops are not."],
    "compare.lead": ["差别不在会不会聊天，而在它能否读懂真实账户、遵守确定性边界、处理执行异常，并解释最终结果。", "The difference is not conversation. It is whether the system understands real account state, obeys deterministic limits, survives execution anomalies, and explains final results."],
    "compare.dimension": ["关键能力", "CORE CAPABILITY"],
    "compare.manual": ["人工交易", "MANUAL TRADING"],
    "compare.bot": ["固定策略机器人", "RULE BOT"],
    "compare.general": ["通用 AI Agent", "GENERAL AI AGENT"],
    "compare.row1": ["理解实时市场语境", "Understands live market context"],
    "compare.row2": ["调用你的专业知识", "Applies your expertise"],
    "compare.row3": ["模型之外的硬风控", "Hard risk outside the model"],
    "compare.row4": ["远端结果未知与崩溃恢复", "Unknown outcomes & crash recovery"],
    "compare.row5": ["真实净绩效与审计", "True net performance & audit"],
    "compare.humanLimited": ["受精力限制", "Attention-limited"],
    "compare.ruleOnly": ["仅固定条件", "Fixed conditions only"],
    "compare.contextNoState": ["有语境，缺真实状态", "Context, but no real state"],
    "compare.factBound": ["交易所事实绑定", "Exchange-fact bound"],
    "compare.memory": ["依赖记忆", "Relies on memory"],
    "compare.hardcoded": ["需手工编码", "Must be hard-coded"],
    "compare.genericRag": ["泛化检索", "Generic retrieval"],
    "compare.graphRecall": ["知识图谱 + 审批规则", "Knowledge graph + approved rules"],
    "compare.selfDiscipline": ["靠自律", "Self-discipline"],
    "compare.basicLimits": ["基础阈值", "Basic thresholds"],
    "compare.promptRules": ["常依赖提示词", "Often prompt-based"],
    "compare.codeGuard": ["确定性代码闸门", "Deterministic code gates"],
    "compare.manualCheck": ["人工检查", "Manual checking"],
    "compare.varies": ["实现不一", "Varies"],
    "compare.noOms": ["通常无 OMS", "Usually no OMS"],
    "compare.durable": ["持久意图 + 对账恢复", "Durable intent + reconciliation"],
    "compare.manualJournal": ["手工复盘", "Manual journal"],
    "compare.tradeLog": ["交易日志", "Trade log"],
    "compare.narrative": ["多为文字总结", "Mostly narrative"],
    "compare.financial": ["费用/资金费对账 + 证据链", "Fee/funding reconciliation + evidence"],
    "compare.note": ["比较基于系统设计目标，不代表任何收益优劣；交易风险始终存在。", "Comparison describes system design goals, not return superiority. Trading risk always remains."],

    "guard.title": ["飞得更远之前，先知道哪里不能去。", "Before going farther, define where not to go."],
    "guard.lead": ["每一项能力旁边，都有一个不能被模型绕过的边界。点击下面的环节，在真实 App 界面中查看它们如何同时工作。", "Every capability has a boundary the model cannot bypass. Select a stage below to see both working together in the real App interface."],
    "guard.oneTitle": ["密钥不进入模型", "Secrets never enter the model"],
    "guard.oneText": ["API Secret、Passphrase 与敏感令牌隔离于模型上下文、前端和普通日志。", "API secrets, passphrases, and sensitive tokens are isolated from model context, the frontend, and ordinary logs."],
    "guard.twoTitle": ["权限由你定义", "You define authority"],
    "guard.twoText": ["交易所、币种、策略、单笔风险、杠杆、日亏损和有效期都有明确上限。", "Exchange, symbols, strategies, per-trade risk, leverage, daily loss, and expiry all have explicit limits."],
    "guard.threeTitle": ["保护无法证明则降级", "Unproven protection means degraded mode"],
    "guard.threeText": ["止损、订单、持仓或财务事实不可确认时，不会以“看起来正常”继续开仓。", "When stops, orders, positions, or financial facts cannot be proven, the system does not keep opening risk because things merely look normal."],
    "guard.fourTitle": ["一键停止与只减仓", "Emergency stop and reduce-only"],
    "guard.fourText": ["异常、事件窗口或操作员指令可暂停新仓，并持续跟踪撤单与退出结果。", "Anomalies, event windows, or an operator command can freeze new risk while cancellations and exits remain tracked."],
    "closing.title": ["TO THE MOON.<br><em>WITH A FLIGHT PLAN.</em>", "TO THE MOON.<br><em>WITH A FLIGHT PLAN.</em>"],
    "closing.text": ["让 AI 持续理解，让系统守住边界，让每一次行动都留下证据。", "Let AI sustain understanding, let the system hold the boundaries, and let every action leave evidence."],
    "footer.tagline": ["有边界的 AI 自主交易系统", "Bounded autonomous AI trading"],
    "footer.disclaimer": ["免责声明：KORDYN 不构成投资建议或收益承诺。数字资产与自动化交易风险极高，可能损失全部本金；实盘前必须完成安全、权限、风控和紧急停止演练。", "Disclaimer: KORDYN is not investment advice and makes no promise of returns. Digital assets and automated trading carry extreme risk, including total loss. Complete security, authority, risk, and emergency-stop reviews before live use."]
  };

  var lang = "zh";
  var tickerPayload = null;
  var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  try {
    var requested = new URLSearchParams(window.location.search).get("lang");
    lang = requested === "en" || requested === "zh" ? requested : (localStorage.getItem("ui_lang") || "zh");
  } catch (_error) { lang = "zh"; }
  if (lang !== "en" && lang !== "zh") lang = "zh";

  function textFor(key) {
    var value = I18N[key];
    return value ? value[lang === "en" ? 1 : 0] : key;
  }

  function applyLang(nextLang) {
    lang = nextLang;
    document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
    document.querySelectorAll("[data-i18n]").forEach(function (node) {
      var value = I18N[node.getAttribute("data-i18n")];
      if (value) node.textContent = value[lang === "en" ? 1 : 0];
    });
    document.querySelectorAll("[data-i18n-html]").forEach(function (node) {
      var value = I18N[node.getAttribute("data-i18n-html")];
      if (value) node.innerHTML = value[lang === "en" ? 1 : 0];
    });
    document.querySelectorAll('[data-action="lang"]').forEach(function (button) {
      button.textContent = lang === "en" ? "中文" : "EN";
    });
    try { localStorage.setItem("ui_lang", lang); } catch (_error) { /* local storage may be unavailable */ }
    renderTicker();
  }

  function formatPrice(value) {
    var number = Number(value);
    if (!Number.isFinite(number)) return "—";
    if (number >= 1000) return number.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (number >= 1) return number.toFixed(2);
    if (number >= .01) return number.toFixed(4);
    return number.toFixed(6);
  }

  function createTickerGroup() {
    var group = document.createElement("div");
    group.className = "ticker-group";
    (tickerPayload.items || []).forEach(function (item) {
      var row = document.createElement("span");
      row.className = "ticker-item";
      row.append(document.createTextNode(item.symbol));
      var value = document.createElement("b");
      var change = Number(item.changePct);
      value.className = change >= 0 ? "up" : "down";
      value.textContent = formatPrice(item.last) + " " + (change >= 0 ? "↗ +" : "↘ ") + change.toFixed(2) + "%";
      row.append(value);
      group.append(row);
    });
    if (tickerPayload.fundingPct !== null && tickerPayload.fundingPct !== undefined) {
      var funding = document.createElement("span");
      funding.className = "ticker-item";
      funding.append(document.createTextNode("BTC FUNDING"));
      var fundingValue = document.createElement("b");
      var fundingNumber = Number(tickerPayload.fundingPct);
      fundingValue.className = fundingNumber >= 0 ? "up" : "down";
      fundingValue.textContent = (fundingNumber >= 0 ? "+" : "") + fundingNumber.toFixed(4) + "%";
      funding.append(fundingValue);
      group.append(funding);
    }
    if (Number.isFinite(Number(tickerPayload.btcOi))) {
      var oi = document.createElement("span");
      oi.className = "ticker-item";
      oi.append(document.createTextNode("BTC OI"));
      var oiValue = document.createElement("b");
      oiValue.textContent = Number(tickerPayload.btcOi).toLocaleString("en-US", { maximumFractionDigits: 0 }) + " BTC";
      oi.append(oiValue);
      group.append(oi);
    }
    return group;
  }

  function renderTicker() {
    var track = document.getElementById("taTicker");
    if (!track) return;
    var tickerShell = track.closest(".ticker");
    track.replaceChildren();
    if (!tickerPayload || !Array.isArray(tickerPayload.items) || !tickerPayload.items.length) {
      track.classList.add("is-static");
      if (tickerShell) tickerShell.classList.toggle("is-unavailable", Boolean(tickerPayload));
      track.textContent = tickerPayload ? textFor("ticker.unavailable") : textFor("ticker.loading");
      return;
    }
    if (tickerShell) tickerShell.classList.remove("is-unavailable");
    track.classList.remove("is-static");
    var first = createTickerGroup();
    track.append(first, first.cloneNode(true));
    var time = document.getElementById("tickerTime");
    var stamp = new Date(tickerPayload.at || Date.now());
    if (time && Number.isFinite(stamp.getTime())) time.textContent = stamp.toLocaleTimeString(lang === "en" ? "en-GB" : "zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function fetchTicker() {
    fetch("/api/public/ticker-bar", { headers: { Accept: "application/json" } })
      .then(function (response) { if (!response.ok) throw new Error("ticker_http_" + response.status); return response.json(); })
      .then(function (payload) {
        if (payload && Array.isArray(payload.items) && payload.items.length) tickerPayload = payload;
        else if (!tickerPayload) tickerPayload = { items: [], error: payload?.error || "ticker_unavailable", at: payload?.at || new Date().toISOString() };
        renderTicker();
      })
      .catch(function () {
        if (!tickerPayload) tickerPayload = { items: [], error: "ticker_unavailable", at: new Date().toISOString() };
        renderTicker();
      });
  }

  function initReveal() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll(".ta-reveal"));
    if (reducedMotion || !("IntersectionObserver" in window)) {
      nodes.forEach(function (node) { node.classList.add("ta-in"); });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("ta-in");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: .12, rootMargin: "0px 0px -6%" });
    nodes.forEach(function (node) { observer.observe(node); });
  }

  function initFlightAnimation() {
    if (reducedMotion) return;
    var steps = Array.prototype.slice.call(document.querySelectorAll(".flight-step"));
    var consoleSteps = Array.prototype.slice.call(document.querySelectorAll(".console-route span"));
    var index = 0;
    window.setInterval(function () {
      index = (index + 1) % steps.length;
      steps.forEach(function (step, stepIndex) {
        step.classList.toggle("is-active", stepIndex === index);
        step.classList.toggle("is-complete", stepIndex < index);
      });
      consoleSteps.forEach(function (step, stepIndex) { step.classList.toggle("is-active", stepIndex === index % consoleSteps.length); });
    }, 1800);
  }

  function initProductShowcase() {
    var proof = document.getElementById("productProof");
    if (!proof) return;
    var controls = Array.prototype.slice.call(proof.querySelectorAll("[data-product-tab]"));
    var panels = Array.prototype.slice.call(proof.querySelectorAll("[data-product-panel]"));
    function activate(id, scrollToPanel) {
      controls.forEach(function (control) {
        var active = control.getAttribute("data-product-tab") === id;
        control.classList.toggle("is-active", active);
        if (control.hasAttribute("aria-selected")) control.setAttribute("aria-selected", active ? "true" : "false");
      });
      panels.forEach(function (panel) {
        var active = panel.getAttribute("data-product-panel") === id;
        panel.hidden = !active;
        panel.classList.toggle("is-active", active);
      });
      if (scrollToPanel) {
        var selectedPanel = proof.querySelector('[data-product-panel="' + id + '"]');
        if (selectedPanel) selectedPanel.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
      }
    }
    controls.forEach(function (control) {
      control.addEventListener("click", function () {
        var fromBoundary = Boolean(control.closest(".cap-boundary-list"));
        activate(control.getAttribute("data-product-tab"), fromBoundary);
      });
    });
    activate("intel", false);
  }

  function initScrollState() {
    var nav = document.getElementById("siteNav");
    var progress = document.getElementById("scrollProgress");
    var queued = false;
    function update() {
      queued = false;
      var top = window.scrollY || document.documentElement.scrollTop || 0;
      if (nav) nav.classList.toggle("is-scrolled", top > 16);
      var max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      if (progress) progress.style.width = Math.min(100, top / max * 100) + "%";
    }
    window.addEventListener("scroll", function () {
      if (!queued) { queued = true; window.requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  function startAuth(mode) {
    try { window.parent.postMessage({ type: "lp-start", mode: mode }, window.location.origin); } catch (_error) { /* parent may be unavailable */ }
  }

  document.addEventListener("click", function (event) {
    var target = event.target.closest("[data-action]");
    if (!target) return;
    var action = target.getAttribute("data-action");
    if (action === "login" || action === "subscribe") {
      event.preventDefault();
      startAuth(action === "subscribe" ? "subscribe" : "login");
    } else if (action === "contact") {
      event.preventDefault();
      window.open("https://t.me/e2ptradingclub", "_blank", "noopener,noreferrer");
    } else if (action === "lang") {
      event.preventDefault();
      applyLang(lang === "en" ? "zh" : "en");
    }
  });

  applyLang(lang);
  initReveal();
  initFlightAnimation();
  initProductShowcase();
  initScrollState();
  fetchTicker();
  window.setInterval(fetchTicker, 20000);
})();
