import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpen,
  BrainCircuit,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Database,
  Eye,
  FileText,
  Gauge,
  GitBranch,
  Globe2,
  Hourglass,
  KeyRound,
  Layers,
  LineChart,
  ListChecks,
  Lock,
  PlugZap,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Settings,
  Shield,
  Sparkles,
  SquareActivity,
  Target,
  Timer,
  TrendingUp,
  UserCog,
  WalletCards,
  Zap
} from "lucide-react";
import { pageCopy, formatMoney, displayMoney, displayPct, pct, asArray, safeList, readFileAsDataUrl, formatDateTime, formatDate, formatTime, formatDuration, orderStatus, humanize, humanizeList, humanizePhase, shortId, statusTone, compactAction, systemStatus, exchangeState, useApi, PageHeader, Card, SectionTitle, MetricCard, MiniSparkline, CandleChart, LinePriceChart, StatusBadge, ProgressBar, DataTable, RiskLine, MiniChart, SemiGauge, InsightNote } from "./lib.jsx";

// 驾驶舱：仪表盘（总览）+ 复盘 合并为一个导航页，用子标签切换，共享同一页头。
export function CockpitPage({ data, action, ui, cockpitTab = "overview", setCockpitTab }) {
  return (
    <div className="pageStack">
      <div className="cockpitHead">
        <PageHeader active="cockpit" />
        <div className="settingsSubNav cockpitTabs" role="tablist" aria-label="驾驶舱导航">
          <button type="button" role="tab" aria-selected={cockpitTab === "overview"} className={cockpitTab === "overview" ? "active" : ""} onClick={() => setCockpitTab("overview")}>
            <Gauge size={15} /> 总览
          </button>
          <button type="button" role="tab" aria-selected={cockpitTab === "review"} className={cockpitTab === "review" ? "active" : ""} onClick={() => setCockpitTab("review")}>
            <ClipboardList size={15} /> 复盘
          </button>
        </div>
      </div>
      {cockpitTab === "review"
        ? <ReviewPage data={data} action={action} ui={ui} embedded />
        : <MarketAccountPage data={data} action={action} ui={ui} embedded />}
    </div>
  );
}

export function MarketAccountPage({ data, action, ui, embedded = false }) {
  const [pnlWindow, setPnlWindow] = useState("本月");
  const market = data.activeMarket || data.markets?.[0] || { candles: [] };
  const pr = data.portfolioRisk || { portfolioVolPct: null, positions: [], correlations: [] };
  const latestReconcile = data.reconciliationReports?.[0];
  const latestSnapshot = data.accountSnapshots?.[0];
  const configuredAccounts = (data.exchangeAccounts || []).filter((account) => account.readEnabled).length;
  const totalAccounts = data.exchangeAccounts?.length || 0;
  const hasAccountData = latestSnapshot || data.portfolio.totalEquityUsdt !== null && data.portfolio.totalEquityUsdt !== undefined;
  const availableMargin = hasAccountData ? (data.portfolio.availableMarginUsdt ?? data.portfolio.availableMargin ?? 0) : null;
  const usedMargin = hasAccountData ? Math.max(0, Number(data.portfolio.totalEquityUsdt || 0) - Number(availableMargin || 0)) : null;
  const marginRate = data.portfolio.totalEquityUsdt ? (usedMargin / Math.max(1, data.portfolio.totalEquityUsdt)) * 100 : null;
  const performance = data.performance || {};
  const monthlyPnl = pnlWindow === "本月" ? performance.totalPnlUsdt : performance.totalPnlUsdt;
  const openExecutions = performance.openExecutions || (data.executionOrders || []).filter((item) => !["filled", "closed", "cancelled", "rejected"].includes(String(item.status || "").toLowerCase())).length;
  const riskChecks = data.riskChecks || [];
  const blockedChecks = riskChecks.filter((item) => ["blocked", "rejected", "risk_rejected"].includes(String(item.decision || item.result || item.status || "").toLowerCase())).length;
  const accountHealthRows = [
    ["交易所账户", `${configuredAccounts} / ${totalAccounts}`, configuredAccounts ? "ok" : "warning"],
    ["私有账户快照", latestSnapshot ? formatDateTime(latestSnapshot.createdAt) : "未同步", latestSnapshot ? "ok" : "warning"],
    ["对账状态", configuredAccounts ? humanize(latestReconcile?.status, "未对账") : "待配置", latestReconcile?.status === "ok" ? "ok" : "warning"],
    ["实盘写入", data.system?.liveTradingEnabled ? "开启" : "关闭", data.system?.liveTradingEnabled ? "danger" : "warning"],
    ["在途执行", `${openExecutions} 个`, openExecutions ? "warning" : "ok"],
    ["近期风控阻断", `${blockedChecks} 次`, blockedChecks ? "warning" : "ok"]
  ];
  // 收益质量只做一行摘要 + 去复盘入口，胜率/盈亏比的完整拆解由复盘页承载，避免与复盘重复展示。
  const qualityRows = [
    ["交易样本", performance.trades ? `${performance.trades} 笔已平仓 · 胜率 ${performance.winRatePct}% · 盈亏比 ${performance.profitFactor ?? "-"}` : "暂无已平仓交易，完成闭环后到复盘拆解"],
    ["最大回撤", data.portfolio.maxDrawdownPct !== null && data.portfolio.maxDrawdownPct !== undefined ? displayPct(-Math.abs(Number(data.portfolio.maxDrawdownPct))) : "未同步"],
    ["月交易次数", data.portfolio.monthlyTrades !== null && data.portfolio.monthlyTrades !== undefined ? `${data.portfolio.monthlyTrades} / ${data.portfolio.monthlyTradeLimit || "不限"}` : "未设置"],
    ["风险等级", data.portfolio.riskLabel || "未同步"]
  ];
  const actionItems = [
    configuredAccounts ? "运行一次手动对账，确认账户快照与交易所一致。" : "先在系统设置中添加只读交易所 API。",
    performance.trades ? "按策略、品种、时段拆分胜率和盈亏比，定位优势场景。" : "完成真实或模拟闭环后，累计可复盘交易样本。",
    blockedChecks ? "查看被风控阻断的计划，调整授权边界或策略参数。" : "保持当前硬风控，通过小额灰度累积样本。",
    openExecutions ? "检查在途执行单是否需要撤单、改价或转入只减仓。" : "当前没有在途执行压力。"
  ];

  const configured = configuredAccounts > 0;
  const stripCells = [
    { label: "总资产 USDT", value: displayMoney(data.portfolio.totalEquityUsdt), sub: latestSnapshot ? `快照 ${formatDateTime(latestSnapshot.createdAt)}` : "同步后显示" },
    { label: "今日盈亏", value: configured ? displayMoney(data.portfolio.todayPnl) : "未同步", sub: configured ? displayPct(data.portfolio.todayPnlPct) : "接入后同步", tone: configured ? (Number(data.portfolio.todayPnl || 0) >= 0 ? "positive" : "negative") : "" },
    { label: "未实现盈亏", value: configured ? displayMoney(data.portfolio.weekPnl) : "未同步", sub: configured ? displayPct(data.portfolio.weekPnlPct) : "接入后同步", tone: configured ? (Number(data.portfolio.weekPnl || 0) >= 0 ? "positive" : "negative") : "" },
    { label: `累计盈亏·${pnlWindow}`, value: displayMoney(monthlyPnl), sub: `${performance.trades || 0} 笔已平仓`, tone: Number(monthlyPnl || 0) >= 0 ? "positive" : "warning" },
    { label: "可用保证金", value: displayMoney(availableMargin), sub: `占用 ${displayMoney(usedMargin)}` },
    { label: "保证金率", value: marginRate === null ? "未同步" : `${formatMoney(marginRate, 1)}%` },
    { label: "对账", value: configured ? humanize(latestReconcile?.status, "未对账") : "待配置", tone: latestReconcile?.status === "ok" ? "positive" : "warning", onClick: () => configured ? action("/api/reconciler/run", { mode: "manual_ui" }) : ui.setActive("systemSettings") }
  ];

  return (
    <div className="pageStack cockpitOverview">
      {!embedded && <PageHeader active="marketAccount" />}

      <div className="cockpitStripRow">
        <div className="cockpitStrip">
          {stripCells.map((cell) => {
            const clickable = Boolean(cell.onClick);
            return (
              <div key={cell.label} className={`stripCell ${clickable ? "clickable" : ""}`} {...(clickable ? { role: "button", tabIndex: 0, onClick: cell.onClick } : {})}>
                <span>{cell.label}</span>
                <strong className={cell.tone}>{cell.value}</strong>
                {cell.sub && <small>{cell.sub}</small>}
              </div>
            );
          })}
        </div>
        <div className="cockpitPnlWindow">
          <span>盈亏区间</span>
          <div className="filterGroup mini">{["本月", "季度", "全年"].map((item) => <button className={pnlWindow === item ? "active" : ""} key={item} onClick={() => setPnlWindow(item)}>{item}</button>)}</div>
        </div>
      </div>

      <div className="cockpitGrid">
        <Card className="cpCard">
          <SectionTitle icon={Gauge} title="账户健康" />
          <div className="healthGrid tight">
            {accountHealthRows.map(([label, value, tone]) => <div key={label}><span>{label}</span><strong>{value}</strong><StatusBadge tone={tone}>{tone === "ok" ? "正常" : tone === "danger" ? "高危" : "待处理"}</StatusBadge></div>)}
          </div>
        </Card>

        <Card className="cpCard">
          <SectionTitle icon={Target} title="风险承压" />
          <div className="qualityGrid">
            <RiskLine label="今日亏损预算" value={data.system.remainingDailyLossUsdt === null || data.system.remainingDailyLossUsdt === undefined ? "未授权" : `${displayMoney(data.system.remainingDailyLossUsdt)} USDT`} />
            <RiskLine label="持仓数量" value={`${data.positions?.length || 0} 个`} />
            <RiskLine label="当前委托" value={`${data.orders?.length || 0} 个`} />
            <RiskLine label="系统状态" value={systemStatus(data).label} />
          </div>
        </Card>

        <Card className="cpCard">
          <SectionTitle icon={BarChart3} title="收益质量" action={<button className="textButton" onClick={() => ui.setActive("review")}>去复盘 <ChevronRight size={14} /></button>} />
          <div className="qualityGrid">
            {qualityRows.map(([label, value]) => <RiskLine key={label} label={label} value={value} />)}
          </div>
        </Card>

        <Card className="cpCard">
          <SectionTitle icon={Activity} title="合约微观结构" action={<button className="iconButton" title="刷新微观结构" onClick={() => action(`/api/exchange/OKX/microstructure?symbol=${encodeURIComponent(market.symbol || "BTC/USDT")}`, {}, "GET")}><RefreshCw size={14} /></button>} />
          <div className="microGrid">
            <div><span>资金费率</span><strong className={Number(market.fundingRate) >= 0 ? "positive" : "negative"}>{market.fundingRate === null || market.fundingRate === undefined ? "未同步" : `${Number(market.fundingRate).toFixed(4)}%`}</strong></div>
            <div><span>未平仓量 OI</span><strong>{market.openInterest ? formatMoney(market.openInterest, 0) : "未同步"}</strong></div>
            <div><span>买盘占比</span><strong className={Number(market.bookImbalancePct) >= 50 ? "positive" : "negative"}>{market.bookImbalancePct === null || market.bookImbalancePct === undefined ? "未同步" : `${market.bookImbalancePct}%`}</strong></div>
            <div><span>24h 涨跌</span><strong className={Number(market.changePct) >= 0 ? "positive" : "negative"}>{displayPct(market.changePct)}</strong></div>
          </div>
        </Card>

        <Card className="cpCard">
          <SectionTitle icon={Gauge} title="组合波动预算" />
          {pr.portfolioVolPct !== null && pr.portfolioVolPct !== undefined ? (
            <>
              <div className="microGrid">
                <div><span>组合日波动</span><strong>{pr.portfolioVolPct}%</strong></div>
                <div><span>波动预算</span><strong>{pr.budgetPct}%</strong></div>
                <div><span>预算使用</span><strong className={pr.utilizationPct > 100 ? "negative" : pr.utilizationPct > 80 ? "warning" : "positive"}>{pr.utilizationPct}%</strong></div>
                <div><span>持仓数</span><strong>{pr.positions.length}</strong></div>
              </div>
              <ProgressBar value={Math.min(100, pr.utilizationPct || 0)} tone={pr.utilizationPct > 100 ? "red" : "blue"} />
            </>
          ) : (
            <div className="emptyPanel">{pr.status === "no_equity" ? "同步私有账户净值后，按组合波动预算给每个仓位定量。" : "暂无持仓；开仓后显示组合波动与预算使用。"}</div>
          )}
        </Card>

        <details className="cpCard cpDetails">
          <summary><span className="cpSummaryTitle"><ListChecks size={15} /> 下一步动作</span><ChevronDown size={14} className="cpChevron" /></summary>
          <div className="actionList">{actionItems.map((item, index) => <div key={item}><b>{index + 1}</b><span>{item}</span></div>)}</div>
        </details>
      </div>
    </div>
  );
}

export function EventsTasksPage({ data, action, ui, embedded = false, mode = "all" }) {
  const showEvents = mode === "all" || mode === "events";
  const showTasks = mode === "all" || mode === "tasks";
  const events = data.events || [];
  const tasks = data.tasks || [];
  const [selectedEventId, setSelectedEventId] = useState("");
  const [taskFilter, setTaskFilter] = useState("全部");
  const eventRows = events.reduce((acc, event) => {
    const key = `${event.title}:${event.category}`;
    if (!acc.some((item) => `${item.title}:${item.category}` === key)) acc.push(event);
    return acc;
  }, []).slice(0, 5);
  const primaryEvent = eventRows.find((event) => event.id === selectedEventId) || eventRows[0] || events[0] || {};
  const filteredTasks = taskFilter === "全部" ? tasks : tasks.filter((task) => task.type === taskFilter);
  const eventRuleTemplates = [
    { name: "高影响事件前停止开仓", scope: "event", level: "L1", action: "pause_opening", event: "宏观事件（影响 ≥ 80）", condition: "事件前 30 分钟", description: "重大宏观事件公布前 30 分钟暂停新开仓，事件落地后人工确认恢复" },
    { name: "资金费率异常告警", scope: "event", level: "L2", action: "notify", event: "资金费率", condition: "|费率| > 0.1% / 8h", description: "永续合约资金费率绝对值超过 0.1% 时推送告警，提示极端多空失衡" },
    { name: "交易所大额流入告警", scope: "event", level: "L2", action: "notify", event: "链上事件", condition: "单笔 > 5000 BTC 流入交易所", description: "监测到大额 BTC 流入交易所地址时告警，提示潜在抛压" }
  ];
  const eventRuleRows = (data.riskRules || []).filter((rule) => rule.scope === "event").map((rule) => ({
    id: rule.id,
    rule: rule.name,
    event: rule.event || "事件条件",
    condition: rule.condition || rule.description || "-",
    action: humanize(rule.action),
    status: <StatusBadge tone={rule.enabled === false ? "warning" : "ok"}>{rule.enabled === false ? "已停用" : "启用"}</StatusBadge>,
    op: <button className="linkCell" onClick={() => ui.openPanel("riskRules")}>管理</button>
  }));
  const taskTabs = [
    ["全部", tasks.length],
    ["Cron", tasks.filter((task) => task.type === "Cron").length],
    ["Every", tasks.filter((task) => task.type === "Every").length],
    ["At", tasks.filter((task) => task.type === "At").length]
  ];
  return (
    <div className="pageStack">
      {!embedded && <PageHeader active="eventsTasks" />}
      <div className="eventsGrid">
        {showEvents && (
        <Card className="eventRadarCard">
          <SectionTitle icon={Target} title="重要事件雷达" action={<button className="secondaryButton" onClick={() => action("/api/event-sources/refresh", {})}><RefreshCw size={14} /> 刷新事件源</button>} />
          <div className="dateStrip">{eventRows.map((event, index) => <button className={(selectedEventId ? selectedEventId === event.id : index === 0) ? "active" : ""} key={event.id} onClick={() => { setSelectedEventId(event.id); ui.notify(`已选择事件：${event.title}`); }}><span>{formatDate(event.due, "待定")}</span><span>{event.category}</span></button>)}</div>
          {!eventRows.length && <div className="emptyPanel emptyPanelAction"><strong>暂无真实事件卡</strong><button className="secondaryButton" onClick={() => action("/api/event-sources/refresh", {})}><RefreshCw size={14} /> 刷新事件源</button></div>}
          <div className="eventRadarInner">
            <div className="eventTimeline">
              {eventRows.map((event, index) => (
                <div className="eventTimelineItem" key={event.id} title={event.rawTitle || event.title}>
                  <b>{formatDateTime(event.due, "待定")}<small>{event.category}</small></b>
                  <span>{event.shortTitle || event.title}</span>
                  <StatusBadge tone={event.impact >= 80 ? "danger" : event.impact >= 50 ? "warning" : "neutral"}>{event.impactLabel || "中影响"}</StatusBadge>
                </div>
              ))}
            </div>
            <div className="eventDetail">
              <div className="eventDetailHead"><strong title={primaryEvent.rawTitle || primaryEvent.title}>{primaryEvent.shortTitle || primaryEvent.title || "暂无事件"}</strong><StatusBadge tone={primaryEvent.impact >= 80 ? "danger" : primaryEvent.impact >= 50 ? "warning" : "neutral"}>{primaryEvent.impactLabel || "待评估"}</StatusBadge><button className="textButton" onClick={() => ui.openPanel("eventSources")}>事件详情 <ChevronRight size={14} /></button></div>
              <div className="countdown eventDue"><b>{formatDateTime(primaryEvent.due, "待定")}</b></div>
              <div className="eventMetrics">
                <span>影响等级<b className={primaryEvent.impact >= 80 ? "negative" : primaryEvent.impact >= 50 ? "warning" : ""}>{primaryEvent.impactLabel || "待评估"}</b></span>
                <span>市场影响度<b>{primaryEvent.impact ? `${Number(primaryEvent.impact) / 10}/10` : "未评估"}</b><ProgressBar value={primaryEvent.impact || 0} tone="red" /></span>
                <span>历史波动率<b>{data.activeMarket?.candles?.length ? "待计算" : "未同步"}</b><MiniSparkline candles={data.activeMarket?.candles} /></span>
                <span>置信度<b>{primaryEvent.confidence ? `${primaryEvent.confidence}%` : "未评估"}</b><ProgressBar value={primaryEvent.confidence || 0} /></span>
              </div>
              <div className="assetChips">{(primaryEvent.relatedSymbols || []).map((symbol) => <span key={symbol}>{symbol}</span>)}</div>
              <p className="eventAdvice">{primaryEvent.action || "暂无事件建议；刷新真实事件源后显示。"}</p>
            </div>
          </div>
        </Card>
        )}

        {showTasks && (
        <Card className="taskCard">
          <SectionTitle icon={CalendarClock} title="定时任务" action={<button className="primaryButton" onClick={() => ui.openPanel("taskManager")}><Plus size={15} /> 新建任务</button>} />
          <div className="taskTabs">{taskTabs.map(([name, count]) => <button className={taskFilter === name ? "active" : ""} key={name} onClick={() => { setTaskFilter(name); ui.notify(`任务筛选：${name}`); }}>{name} {count}</button>)}</div>
          <DataTable columns={[
            { key: "name", label: "任务名称" }, { key: "schedule", label: "触发方式" }, { key: "next", label: "下次运行" }, { key: "status", label: "状态" }, { key: "type", label: "任务分类" }, { key: "op", label: "操作" }
          ]} rows={filteredTasks.slice(0, 5).map((task) => ({ id: task.id, name: task.name, schedule: task.schedule || "Every 1h", next: formatDateTime(task.nextRunAt, task.nextRun || "-"), status: <StatusBadge>{humanize(task.status || "running")}</StatusBadge>, type: task.role || "风控", op: <span className="rowActions"><button className="linkCell" onClick={() => action(`/api/tasks/${task.id}/run`, {})}>运行</button><button className="linkCell" onClick={() => action(`/api/tasks/${task.id}/${task.enabled === false ? "resume" : "pause"}`, task.enabled === false ? {} : { reason: "manual_ui" })}>{task.enabled === false ? "恢复" : "暂停"}</button></span> }))} />
        </Card>
        )}
      </div>

      <div className="eventsBottom">
        {showEvents && (
        <Card>
          <SectionTitle icon={GitBranch} title="事件规则" action={<button className="primaryButton" onClick={() => ui.openPanel("eventRule")}><Plus size={14} /> 新建规则</button>} />
          {!eventRuleRows.length && (
            <div className="emptyPanel emptyPanelGuide">
              <strong>还没有事件规则</strong>
              <small>规则会在事件触发时自动执行动作（告警 / 暂停开仓）。从模板一键创建：</small>
              <div className="templateChips">
                {eventRuleTemplates.map((template) => (
                  <button key={template.name} onClick={() => action("/api/risk/rules", template)}>{template.name}</button>
                ))}
              </div>
            </div>
          )}
          {eventRuleRows.length > 0 && (
            <DataTable columns={[
              { key: "rule", label: "规则名称" }, { key: "event", label: "触发事件" }, { key: "condition", label: "触发条件" }, { key: "action", label: "执行动作" }, { key: "status", label: "状态" }, { key: "op", label: "操作" }
            ]} rows={eventRuleRows} />
          )}
        </Card>
        )}
        {showTasks && (
        <Card>
          <SectionTitle icon={ClipboardList} title="任务健康摘要" action={<button className="textButton" onClick={() => ui.setActive("auditSystem")}>日志中心 <ChevronRight size={14} /></button>} />
          <div className="healthGrid">
            <div><span>任务总数</span><strong>{tasks.length}</strong><StatusBadge>{tasks.length ? "已创建" : "暂无"}</StatusBadge></div>
            <div><span>启用任务</span><strong>{tasks.filter((task) => task.enabled !== false).length}</strong><StatusBadge tone="ok">运行</StatusBadge></div>
            <div><span>最近运行</span><strong>{formatDateTime(data.jobRuns?.[0]?.createdAt, "暂无")}</strong><StatusBadge tone={statusTone(data.jobRuns?.[0]?.status)}>{humanize(data.jobRuns?.[0]?.status, "未运行")}</StatusBadge></div>
            <div><span>失败次数</span><strong>{(data.jobRuns || []).filter((run) => ["failed", "error"].includes(String(run.status || "").toLowerCase())).length}</strong><StatusBadge tone="warning">近记录</StatusBadge></div>
          </div>
        </Card>
        )}
      </div>
    </div>
  );
}

export function latestAnalysisRows(data) {
  const bundle = data.analysisBundles?.[0];
  if (!bundle) return [];
  const views = (bundle.expertViews || []).map((view, index) => ({
    id: `${bundle.id || "analysis"}:${index}`,
    name: view.domain || "分析视角",
    type: "分析",
    quote: view.view || bundle.summary || "-",
    confidence: view.confidence ? `${Math.round(view.confidence * 100)}%` : "-",
    source: bundle.id || "本次运行"
  }));
  const citations = (bundle.citations || []).map((citation) => ({
    id: `citation:${citation}`,
    name: citation,
    type: "引用",
    quote: "来自真实导入知识库的引用标识",
    confidence: "-",
    source: bundle.id || "本次运行"
  }));
  return [...views, ...citations].slice(0, 6);
}

export function KnowledgeSkillsPage({ data, action, ui, embedded = false }) {
  const [tab, setTab] = useState("knowledge");
  const knowledge = data.knowledge || {};
  const sourceCount = knowledge.sources?.length || 0;
  const conceptCount = knowledge.conceptCards?.length || 0;
  const ruleCount = knowledge.ruleProposals?.length || 0;
  const chunkCount = knowledge.chunks?.length || 0;
  const enabledSkills = (data.skills || []).filter((skill) => skill.status === "已启用").length;
  const connectedMcp = data.mcpServers?.filter((item) => item.status === "connected").length || 0;
  return (
    <div className="pageStack">
      {!embedded && <PageHeader active="knowledgeSkills" />}
      <div className="subTabBar">
        <button className={tab === "knowledge" ? "active" : ""} onClick={() => setTab("knowledge")}><BookOpen size={15} /> 知识库</button>
        <button className={tab === "skills" ? "active" : ""} onClick={() => setTab("skills")}><Sparkles size={15} /> Skill 中心</button>
      </div>
      {tab === "knowledge"
        ? <KnowledgeBaseTab data={data} action={action} ui={ui} sourceCount={sourceCount} conceptCount={conceptCount} ruleCount={ruleCount} chunkCount={chunkCount} knowledge={knowledge} />
        : <SkillCenterTab data={data} action={action} ui={ui} enabledSkills={enabledSkills} connectedMcp={connectedMcp} />}
    </div>
  );
}

function KnowledgeBaseTab({ data, action, ui, sourceCount, conceptCount, ruleCount, chunkCount, knowledge }) {
  const [query, setQuery] = useState("");
  const embed = data.embeddingStatus || { mode: "lexical", provider: null, model: null, totalChunks: chunkCount, embeddedChunks: 0, coveragePct: 0 };
  const importActions = (
    <div className="titleActions">
      <button className="secondaryButton" onClick={() => ui.openPanel("knowledgeImport")}><Plus size={14} /> 导入知识</button>
      <button className="textButton" onClick={() => ui.openPanel("knowledgeList")}>全部知识 <ChevronRight size={14} /></button>
    </div>
  );
  return (
    <>
      <div className="metricGrid four">
        <MetricCard icon={FileText} label="知识来源" value={String(sourceCount)} sub={`${chunkCount} 个可检索片段`} tone="positive" />
        <MetricCard icon={Layers} label="概念卡" value={String(conceptCount)} sub="已抽取概念" tone="positive" />
        <MetricCard icon={Settings} label="专家规则" value={String(ruleCount)} sub="待审批 / 已批准" tone="positive" />
        <MetricCard icon={BrainCircuit} label="检索模式" value={embed.mode === "semantic" ? "语义向量" : "词频匹配"} sub={embed.mode === "semantic" ? `${embed.model} · 覆盖 ${embed.coveragePct}%` : "配置 OpenAI/Gemini Key 可升级"} tone={embed.mode === "semantic" ? "positive" : ""} />
      </div>

      <Card>
        <SectionTitle icon={Search} title="知识检索（RAG）" action={
          <div className="titleActions">
            <StatusBadge tone={embed.mode === "semantic" ? "ok" : "warning"}>{embed.mode === "semantic" ? `语义检索 · 已向量化 ${embed.embeddedChunks}/${embed.totalChunks}` : "词频检索"}</StatusBadge>
            {embed.provider && embed.coveragePct < 100 && embed.totalChunks > 0 && <button className="secondaryButton" onClick={() => action("/api/knowledge/reembed", {})}><Sparkles size={14} /> 重新向量化</button>}
          </div>
        } />
        <div className="ragQueryBar">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：CPI 公布前后 BTC 应该如何控制仓位？" onKeyDown={(event) => { if (event.key === "Enter" && query.trim()) action("/api/knowledge/rag-query", { query: query.trim(), topK: 5 }); }} />
          <button className="primaryButton" disabled={!query.trim()} onClick={() => action("/api/knowledge/rag-query", { query: query.trim(), topK: 5 })}><Search size={14} /> 检索</button>
        </div>
        <DataTable columns={[
          { key: "name", label: "知识/规则/技能" }, { key: "type", label: "类型" }, { key: "quote", label: "引用片段", width: "2fr" }, { key: "confidence", label: "相关度" }, { key: "source", label: "来源" }
        ]} rows={(latestAnalysisRows(data) || [])} />
      </Card>

      <div className="knowledgeGrid">
        <Card>
          <SectionTitle title="专家知识库" action={importActions} />
          <div className="knowledgeCategoryList">
            {(knowledge.sources || []).slice(0, 6).map((source) => <button className="knowledgeCategory" key={source.id} onClick={() => ui.openPanel("knowledgeList")}><div><Globe2 size={22} /></div><span><strong>{source.domain || source.type}</strong><small>{source.title}</small></span><b>{humanize(source.status)}</b></button>)}
            {!knowledge.sources?.length && (
              <div className="emptyPanel emptyPanelAction">
                <strong>暂无真实知识来源</strong>
                <span>把金融、交易、经济类书籍与资料喂给 AI：可粘贴文本、导入网页链接、上传 PDF/DOCX/MD/TXT，或填写本地文件路径。</span>
                <button className="primaryButton" onClick={() => ui.openPanel("knowledgeImport")}><Plus size={14} /> 导入知识</button>
              </div>
            )}
          </div>
        </Card>
        <Card className="graphCard">
          <SectionTitle title="概念与规则" action={<button className="textButton" onClick={() => ui.openPanel("ruleLibrary")}>全部规则 <ChevronRight size={14} /></button>} />
          {ruleCount || conceptCount ? (
            <div className="conceptGraph">
              <div className="conceptHub"><b>知识图谱</b><small>{conceptCount} 个概念 · {ruleCount} 条规则</small></div>
              <div className="conceptNodeGrid">
                {(knowledge.conceptCards || []).slice(0, 6).map((concept, index) => <span className={index < 2 ? "primary" : ""} key={concept.id}>{concept.name}</span>)}
              </div>
            </div>
          ) : (
            <div className="emptyPanel emptyPanelAction">
              <strong>还没有概念或规则</strong>
              <span>导入资料后会自动切片并抽取概念；也可以在导入时生成待审批规则草案。</span>
              <button className="secondaryButton" onClick={() => ui.openPanel("knowledgeImport")}>导入并生成图谱</button>
            </div>
          )}
          <div className="ruleTiles">
            {(knowledge.ruleProposals || []).slice(0, 4).map((rule) => <button key={rule.id} onClick={() => ui.openPanel("ruleLibrary")}><strong>{rule.name}</strong><small>{rule.description || "基于专家知识库生成"}</small><StatusBadge tone={rule.status === "已批准" ? "ok" : "warning"}>{humanize(rule.status, "待审批")}</StatusBadge></button>)}
          </div>
          <button className="textButton centered" onClick={() => ui.openPanel("ruleLibrary")}>查看全部规则 <ChevronRight size={14} /></button>
        </Card>
      </div>

      <Card>
        <SectionTitle icon={RefreshCw} title="最近更新" action={<button className="textButton" onClick={() => ui.setActive("auditSystem")}>全部更新 <ChevronRight size={14} /></button>} />
        <div className="updateList">
          {data.auditLogs?.filter((item) => item.action?.includes("知识") || item.action?.includes("导入") || item.action?.includes("RAG") || item.action?.includes("解析")).slice(0, 5).map((item) => <div key={item.id}><b>{formatTime(item.createdAt)}</b><span>{item.action}</span><StatusBadge>{item.severity}</StatusBadge><small>{item.actor}</small></div>)}
          {!data.auditLogs?.some((item) => item.action?.includes("知识") || item.action?.includes("导入") || item.action?.includes("RAG") || item.action?.includes("解析")) && (
            <div className="emptyPanel emptyPanelAction">
              <strong>暂无真实知识更新</strong>
              <span>完成一次知识导入后，这里会显示审计记录。</span>
              <button className="secondaryButton" onClick={() => ui.openPanel("knowledgeImport")}>导入第一条知识</button>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}

function McpManager({ data, action }) {
  const [form, setForm] = useState({ name: "", url: "", apiKey: "" });
  const servers = data.mcpServers || [];
  const status = data.mcpStatus || {};
  const countLabel = `${status.connected || 0}/${status.total || 0} 已连接 · ${status.tools || 0} 个工具`;
  async function register(event) {
    event.preventDefault();
    if (!form.name.trim() || !form.url.trim()) return;
    const created = await action("/api/mcp", { name: form.name.trim(), url: form.url.trim(), apiKey: form.apiKey.trim() || undefined });
    if (created?.id) {
      await action(`/api/mcp/${created.id}/connect`, {});
      setForm({ name: "", url: "", apiKey: "" });
    }
  }
  return (
    <Card>
      <SectionTitle title="MCP 工具服务" action={<small className="muted">{countLabel}</small>} />
      <form className="ragQueryBar" style={{ flexWrap: "wrap" }} onSubmit={register}>
        <input placeholder="名称，如 Tavily 搜索" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="MCP Server 端点 URL" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
        <input placeholder="API Key（可选，Bearer）" type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
        <button className="primaryButton" type="submit"><Plus size={14} /> 注册并连接</button>
      </form>
      <div className="mcpServerGrid">
        {servers.map((s) => {
          const tone = s.status === "connected" ? "ok" : s.status === "error" ? "danger" : "warning";
          const sub = `${s.toolCount || 0} 工具${s.lastError ? ` · ${s.lastError}` : ""}`;
          return (
            <div className="mcpServerItem" key={s.id}>
              <div className="mcpServerMeta"><strong>{s.name}</strong><small title={s.url}>{s.url}</small><small>{sub}</small></div>
              <StatusBadge tone={tone}>{humanize(s.status, s.status)}</StatusBadge>
              <span className="rowActions">
                <button className="linkCell" onClick={() => action(`/api/mcp/${s.id}/connect`, {})}>连接</button>
                {s.status === "connected" ? <button className="linkCell" onClick={() => action(`/api/mcp/${s.id}/disable`, {})}>停用</button> : null}
              </span>
            </div>
          );
        })}
        {servers.length ? null : <div className="emptyPanel">暂无 MCP Server。注册后点「连接」发现工具，已连接的工具会接入 AI 交易员。</div>}
      </div>
      <InsightNote icon={PlugZap} title="工具接入">已连接的 MCP 工具以 mcp__ 前缀接入 AI 交易员的决策循环。例：Tavily 搜索 MCP（需 API Key）给 Agent 加查实时新闻、研报的能力。</InsightNote>
    </Card>
  );
}

function SkillCenterTab({ data, action, ui, enabledSkills, connectedMcp }) {
  return (
    <>
      <div className="metricGrid four">
        <MetricCard icon={Sparkles} label="已启用技能" value={String(enabledSkills)} sub={`共 ${data.skills?.length || 0} 个技能`} tone="positive" />
        <MetricCard icon={PlugZap} label="MCP 已连接" value={`${connectedMcp}/${data.mcpServers?.length || 0}`} sub="外部工具服务" tone={connectedMcp ? "positive" : ""} />
        <MetricCard icon={Activity} label="Skill 运行" value={`${data.skillRuns?.length || 0} 次`} sub="沙箱执行样本" />
        <MetricCard icon={Shield} label="权限与隔离" value="沙箱执行" sub="依赖扫描 + 无网络运行" />
      </div>

      <div className="knowledgeGrid">
        <Card className="skillCenterCard">
          <SectionTitle title="Skills 中心" action={<div className="titleActions"><button className="secondaryButton" onClick={() => ui.openPanel("skillImport")}><Plus size={14} /> 导入 Skill</button><button className="textButton" onClick={() => ui.openPanel("skillImport")}>全部技能 <ChevronRight size={14} /></button></div>} />
          <InsightNote icon={Sparkles} title="技能生效方式">已启用的技能会作为可调用工具接入 AI 交易员的决策循环；内置技能只读，需要扫描并安装后生效。</InsightNote>
          <div className="skillList">
            {(data.skills || []).slice(0, 6).map((skill) => <div key={skill.id}><Sparkles size={18} /><strong>{skill.name}</strong><small>{skill.native ? "内置" : `v${skill.version}`}</small><StatusBadge tone={skill.status === "已启用" ? "ok" : "warning"}>{skill.status || "已启用"}</StatusBadge></div>)}
            {!data.skills?.length && (
              <div className="emptyPanel emptyPanelAction">
                <strong>暂无已导入 Skill</strong>
                <span>从其他 Skill 库下载能帮到你的技能：填写 GitHub 仓库、Skill.md 链接，或直接粘贴 Skill.md 内容后再扫描安装。</span>
                <button className="secondaryButton" onClick={() => ui.openPanel("skillImport")}>导入 Skill</button>
              </div>
            )}
          </div>
          <div className="importButtons"><button onClick={() => ui.openPanel("skillImport")}>从 GitHub 导入</button><button onClick={() => ui.openPanel("skillImport")}>粘贴 Skill.md</button></div>
        </Card>
        <Card>
          <SectionTitle icon={RefreshCw} title="最近技能更新" action={<button className="textButton" onClick={() => ui.setActive("auditSystem")}>全部更新 <ChevronRight size={14} /></button>} />
          <div className="updateList">
            {data.auditLogs?.filter((item) => item.action?.includes("Skill") || item.action?.includes("MCP") || item.action?.includes("沙箱")).slice(0, 5).map((item) => <div key={item.id}><b>{formatTime(item.createdAt)}</b><span>{item.action}</span><StatusBadge>{item.severity}</StatusBadge><small>{item.actor}</small></div>)}
            {!data.auditLogs?.some((item) => item.action?.includes("Skill") || item.action?.includes("MCP") || item.action?.includes("沙箱")) && (
              <div className="emptyPanel emptyPanelAction">
                <strong>暂无真实技能更新</strong>
                <span>完成一次 Skill 或 MCP 导入后，这里会显示审计记录。</span>
                <button className="secondaryButton" onClick={() => ui.openPanel("skillImport")}>导入第一个 Skill</button>
              </div>
            )}
          </div>
        </Card>
      </div>

      <McpManager data={data} action={action} />
    </>
  );
}

function RiskQuadrants({ rules = [] }) {
  const quadrantOf = (scope) => {
    const s = String(scope || "").toLowerCase();
    if (/account|portfolio|loss|margin|equity/.test(s)) return "account";
    if (/event/.test(s)) return "event";
    if (/system|knowledge|kill|api/.test(s)) return "system";
    return "trade";
  };
  const quadrants = [
    { key: "account", title: "账户风险", icon: WalletCards, tone: "" },
    { key: "trade", title: "交易风险", icon: TrendingUp, tone: "" },
    { key: "event", title: "事件风险", icon: Bell, tone: "warning" },
    { key: "system", title: "系统风险", icon: Shield, tone: "positive" }
  ];
  const buckets = { account: [], trade: [], event: [], system: [] };
  for (const rule of rules) buckets[quadrantOf(rule.scope)].push(rule);
  return (
    <div className="riskQuadrantGrid">
      {quadrants.map(({ key, title, icon: Icon, tone }) => (
        <div className="riskQuadrant" key={key}>
          <header><span className={`quadIcon ${tone}`}><Icon size={16} /></span><strong>{title}</strong><b>{buckets[key].length}</b></header>
          {buckets[key].length ? buckets[key].map((rule) => (
            <div className="quadRule" key={rule.id}>
              <div><strong>{rule.name}</strong><small>{rule.level || "-"} · {humanize(rule.action, rule.action || "-")}</small></div>
              <StatusBadge tone={rule.enabled === false ? "warning" : "ok"}>{rule.enabled === false ? "停用" : "启用"}</StatusBadge>
            </div>
          )) : <div className="quadEmpty">无规则</div>}
        </div>
      ))}
    </div>
  );
}

export function RiskAuthPage({ data, action, ui, embedded = false }) {
  const mandate = data.agentStatus?.activeMandate || data.mandates?.[0] || {};
  const latestRisk = data.riskChecks?.[0] || {};
  const grayPolicy = data.grayReleasePolicies?.[0] || {};
  const rawRiskScore = latestRisk.riskScore ?? data.portfolio.riskScore;
  const hasRiskScore = rawRiskScore !== null && rawRiskScore !== undefined && rawRiskScore !== "" && Number.isFinite(Number(rawRiskScore));
  const riskScore = hasRiskScore ? Number(rawRiskScore) : 0;
  const mandateTone = mandate.status === "running" || mandate.status === "active" ? "ok" : statusTone(mandate.status);
  const validFrom = mandate.validFrom || mandate.valid_from;
  const validUntil = mandate.validUntil || mandate.valid_until;
  const mandateValidity = validFrom && validUntil
    ? `${formatDate(validFrom)} ~ ${formatDate(validUntil)}`
    : validUntil
      ? `截至 ${formatDate(validUntil)}`
      : validFrom
        ? `${formatDate(validFrom)} 起`
        : "未记录";
  return (
    <div className="pageStack">
      {!embedded && <PageHeader active="riskAuth" />}
      <div className="riskAuthGrid">
        <Card>
          <SectionTitle title="授权委托" action={<><StatusBadge tone={mandateTone}>{humanize(mandate.status, "未授权")}</StatusBadge><button className="secondaryButton" onClick={() => ui.openPanel("mandate")}>编辑</button></>} />
          <div className="mandateRows">
            <RiskLine label="授权范围" value={humanizeList(mandate.marketTypes, "未设置")} />
            <RiskLine label="交易所" value={safeList(mandate.exchanges, "未授权")} />
            <RiskLine label="交易对白名单" value={safeList(mandate.allowedSymbols, "未授权")} />
            <RiskLine label="最大杠杆倍数" value={mandate.max_leverage || mandate.maxLeverageBySymbol ? `${mandate.max_leverage || Math.max(1, ...Object.values(mandate.maxLeverageBySymbol || { default: 1 }))}x` : "未授权"} />
            <RiskLine label="单日最大亏损" value={`${mandate.maxDailyLossPct || "-"}%`} />
            <RiskLine label="审批阈值（单笔下单）" value={mandate.id ? `≥ ${formatMoney(mandate.humanApprovalNotionalUsdt || mandate.manual_approval_threshold_usdt || 0, 0)} USDT` : "未授权"} />
            <RiskLine label="有效期" value={mandateValidity} />
            <RiskLine label="状态" value={humanize(mandate.status, "未授权")} />
          </div>
          <button className="textButton centered" onClick={() => ui.openPanel("mandate")}>查看委托详情与审批记录 <ChevronRight size={14} /></button>
        </Card>
        <Card>
          <SectionTitle title="风险规则" action={<button className="secondaryButton" onClick={() => ui.openPanel("riskRules")}>管理规则</button>} />
          <RiskQuadrants rules={data.riskRules || []} />
          <InsightNote icon={Shield} title="规则执行">规则触发将按预设动作执行，可在右侧风险状态墙中手动干预。</InsightNote>
        </Card>
        <Card className="riskStatusWall">
          <SectionTitle title="风险状态墙" action={<small>实时更新 {formatDateTime(latestRisk.createdAt || data.system.updatedAt)} <RefreshCw size={13} /></small>} />
          <div className="riskScoreBox"><Shield size={28} /><span>当前风险等级<strong>{data.portfolio.riskLabel || "未同步"}</strong></span><SemiGauge value={hasRiskScore ? riskScore : NaN} max={100} unit="风险分 /100" size={132} color={riskScore >= 70 ? "#c0392b" : riskScore >= 40 ? "#e07a3f" : "#3f8f5b"} /></div>
          <div className="lossBudget"><span>剩余亏损预算（今日）<b>{data.system.remainingDailyLossUsdt === null || data.system.remainingDailyLossUsdt === undefined ? "未授权" : `${displayMoney(data.system.remainingDailyLossUsdt, 2, "0.00")} USDT`}</b></span><small>日亏损上限 {mandate.maxDailyLossPct || "-"}%</small><ProgressBar value={hasRiskScore ? Math.max(0, 100 - riskScore) : 0} /></div>
          <RiskLine label="灰度实盘额度" value={grayPolicy.enabled ? `${formatMoney(grayPolicy.maxNotionalUsdt, 0)} USDT` : "未启用"} />
          <RiskLine label="最大杠杆倍数" value={mandate.max_leverage || mandate.maxLeverageBySymbol ? `${mandate.max_leverage || Math.max(1, ...Object.values(mandate.maxLeverageBySymbol || { default: 1 }))}x` : "未授权"} />
          <RiskLine label="最近风控结论" value={latestRisk.summary || humanize(latestRisk.decision, "暂无检查")} />
          <RiskLine label="系统状态" value={systemStatus(data).label} />
          <div className="riskActionRow"><button onClick={() => action("/api/system/autonomy", { enabled: false })}>暂停交易</button><button onClick={() => action("/api/risk/reduce-only", { enabled: true })}>只减仓</button><button className="danger" onClick={() => action("/api/risk/kill-switch", { enabled: true })}>一键熔断</button></div>
          <small className="centerMuted">触发后将立即生效，并记录审计日志。</small>
        </Card>
      </div>
      <div className="authHistoryGrid">
        <Card><SectionTitle title="授权历史" action={<button className="textButton" onClick={() => ui.setActive("auditSystem")}>查看全部 <ChevronRight size={14} /></button>} /><div className="historyList">{(data.auditLogs || []).filter((item) => item.target?.includes("mandate") || item.action?.includes("授权")).slice(0, 4).map((item) => <div key={item.id}><StatusBadge>{item.severity}</StatusBadge><span>{item.action}</span><small>{item.actor}</small></div>)}</div><button className="textButton centered" onClick={() => ui.download("/api/audit-logs/export?format=csv", "audit-logs.csv")}>导出审计日志 <ChevronRight size={14} /></button></Card>
      </div>
    </div>
  );
}

export function ReviewPage({ data, action, ui, embedded = false }) {
  const [reviewTab, setReviewTab] = useState("strategy");
  const performance = data.performance || {};
  const reviews = data.reviews || [];
  const tradePlans = data.tradePlans || [];
  const executionOrders = data.executionOrders || data.orders || [];
  const skillRuns = data.skillRuns || [];
  const agentRuns = data.agentRuns || [];
  const riskChecks = data.riskChecks || [];
  const analytics = data.reviewAnalytics || {};
  const breakdowns = analytics.breakdowns || {};
  const cost = analytics.cost || {};
  const attribution = analytics.attribution || {};
  const failedRuns = agentRuns.filter((run) => ["failed", "error"].includes(String(run.status || "").toLowerCase())).length;
  const blockedRisk = riskChecks.filter((item) => ["blocked", "rejected", "risk_rejected"].includes(String(item.decision || item.result || item.status || "").toLowerCase())).length;
  const latestReview = reviews[0] || {};
  const optimizationItems = [
    blockedRisk ? `近期有 ${blockedRisk} 次风控阻断，优先复盘入场、止损和授权边界。` : "近期没有明显风控阻断，继续小样本验证策略稳定性。",
    failedRuns ? `有 ${failedRuns} 次 Agent 运行失败，需要检查模型、工具调用和网络配置。` : "Agent 运行链路暂未暴露失败集中点。",
    performance.trades ? `胜率 ${performance.winRatePct}%、盈亏比 ${performance.profitFactor ?? "未计算"}，下一步按策略和市场状态拆分表现。` : "交易样本不足，先建立最小交易日志闭环。",
    skillRuns.length ? "已有 Skill 运行记录，可按成功率、耗时和输出质量筛选高价值 Skill。" : "Skill 尚未形成运行样本，建议先用知识解析和风控复盘类 Skill。"
  ];
  const tradeRows = tradePlans.slice(0, 8).map((plan) => {
    const order = executionOrders.find((item) => item.planId === plan.id || item.id === plan.executionOrderId) || {};
    return {
      id: plan.id,
      time: formatTime(plan.createdAt),
      symbol: plan.symbol || order.symbol || "-",
      direction: humanize(plan.direction || order.side, "-"),
      status: <StatusBadge tone={statusTone(order.status || plan.status)}>{humanize(order.status || plan.status, "未执行")}</StatusBadge>,
      risk: humanize(plan.lastRiskCheck?.decision || plan.status, "未检查"),
      review: <button className="linkCell" onClick={() => ui.openPanel("executionDetail")}>详情</button>
    };
  });
  const skillRows = skillRuns.slice(0, 8).map((run) => ({
    id: run.id,
    time: formatTime(run.createdAt),
    skill: run.skillName || run.name || run.skillId || "Skill",
    status: <StatusBadge tone={statusTone(run.status)}>{humanize(run.status, "已记录")}</StatusBadge>,
    output: run.output || run.summary || run.resultSummary || "-"
  }));
  return (
    <div className="pageStack">
      {!embedded && <PageHeader active="review" />}
      <div className="metricGrid five">
        <MetricCard icon={BarChart3} label="累计盈亏" value={displayMoney(performance.totalPnlUsdt)} sub={`${performance.trades || 0} 笔已平仓`} tone={Number(performance.totalPnlUsdt || 0) >= 0 ? "positive" : "warning"} />
        <MetricCard icon={Target} label="胜率" value={performance.trades ? `${performance.winRatePct}%` : "暂无数据"} sub="按已平仓交易统计" />
        <MetricCard icon={Gauge} label="盈亏比" value={performance.profitFactor ?? "暂无数据"} sub="Profit Factor" />
        <MetricCard icon={BrainCircuit} label="Agent 运行" value={`${agentRuns.length} 次`} sub={`${failedRuns} 次失败`} tone={failedRuns ? "warning" : "positive"} />
        <MetricCard icon={Sparkles} label="Skill 复盘" value={`${skillRuns.length} 次`} sub="运行样本" />
      </div>

      <div className="reviewGrid">
        <Card className="reviewFocus">
          <SectionTitle icon={ListChecks} title="自我优化线索" action={<span className="sectionActions"><button className="secondaryButton" onClick={() => action("/api/review/backfill-fields", {})}><RefreshCw size={14} /> 补全字段</button><button className="secondaryButton" onClick={() => action("/api/review/strategy-improvement", {})}><BrainCircuit size={14} /> 创建改进闭环</button></span>} />
          <div className="actionList">{optimizationItems.map((item, index) => <div key={item}><b>{index + 1}</b><span>{item}</span></div>)}</div>
        </Card>
        <Card>
          <SectionTitle icon={ClipboardList} title="最近复盘结论" />
          {latestReview.id ? (
            <div className="reviewNote">
              <strong>{latestReview.title || latestReview.id}</strong>
              <p>{latestReview.summary || latestReview.content || "已记录复盘，但缺少摘要。"}</p>
              <small>{formatDateTime(latestReview.createdAt)}</small>
            </div>
          ) : <div className="emptyPanel emptyPanelAction"><strong>暂无复盘报告</strong><span>完成交易闭环或运行复盘 Agent 后，这里会沉淀结论。</span></div>}
        </Card>
      </div>

      <div className="subTabBar">
        <button className={reviewTab === "strategy" ? "active" : ""} onClick={() => setReviewTab("strategy")}><Rocket size={15} /> 策略与验证</button>
        <button className={reviewTab === "perf" ? "active" : ""} onClick={() => setReviewTab("perf")}><BarChart3 size={15} /> 绩效拆解</button>
        <button className={reviewTab === "trades" ? "active" : ""} onClick={() => setReviewTab("trades")}><ClipboardList size={15} /> 交易与行为</button>
      </div>

      {reviewTab === "strategy" && (
        <>
          <StrategyResearchCard data={data} action={action} />
          <PaperValidationCard data={data} action={action} />
          <BacktestCard data={data} action={action} />
        </>
      )}

      {reviewTab === "perf" && (
        <>
          <div className="reviewGrid">
            <Card>
              <SectionTitle icon={BarChart3} title="拆分胜率与盈亏比" />
              <div className="segmentGrid">
                <SegmentList title="按策略" rows={breakdowns.strategy} />
                <SegmentList title="按币种" rows={breakdowns.symbol} />
                <SegmentList title="按时段" rows={breakdowns.session} />
                <SegmentList title="按行情 Regime" rows={breakdowns.regime} />
              </div>
            </Card>
            <Card>
              <SectionTitle icon={Gauge} title="交易质量指标" />
              <RiskLine label="平均 MAE" value={cost.avgMaeUsdt === null || cost.avgMaeUsdt === undefined ? "未记录" : `${displayMoney(cost.avgMaeUsdt)} USDT`} />
              <RiskLine label="平均 MFE" value={cost.avgMfeUsdt === null || cost.avgMfeUsdt === undefined ? "未记录" : `${displayMoney(cost.avgMfeUsdt)} USDT`} />
              <RiskLine label="平均滑点" value={cost.avgSlippageBps === null || cost.avgSlippageBps === undefined ? "未记录" : `${formatMoney(cost.avgSlippageBps, 2)} bps`} />
              <RiskLine label="手续费合计" value={`${displayMoney(cost.totalFeesUsdt)} USDT`} />
              <RiskLine label="资金费率合计" value={`${displayMoney(cost.totalFundingUsdt)} USDT`} />
              <RiskLine label="平均持仓时长" value={cost.avgHoldingMinutes === null || cost.avgHoldingMinutes === undefined ? "未记录" : `${formatMoney(cost.avgHoldingMinutes, 0)} 分钟`} />
            </Card>
          </div>
          <Card>
            <SectionTitle icon={AlertTriangle} title="亏损聚类" />
            <div className="clusterList">
              {(analytics.lossClusters || []).map((cluster) => <div key={cluster.key}><strong>{cluster.key}</strong><span>{cluster.count} 笔 · {displayMoney(cluster.pnl)} USDT</span><small>{cluster.suggestion}</small></div>)}
              {!analytics.lossClusters?.length && <div className="emptyPanel">暂无可聚类亏损样本。</div>}
            </div>
          </Card>
        </>
      )}

      {reviewTab === "trades" && (
        <>
          <div className="reviewGrid">
            <Card>
              <SectionTitle title="交易记录复盘" />
              <DataTable columns={[
                { key: "time", label: "时间" }, { key: "symbol", label: "交易对" }, { key: "direction", label: "方向" }, { key: "status", label: "执行" }, { key: "risk", label: "风控" }, { key: "review", label: "操作" }
              ]} rows={tradeRows} />
            </Card>
            <Card>
              <SectionTitle title="执行质量" action={<button className="textButton" onClick={() => ui.setActive("auditSystem")}>看日志中心 <ChevronRight size={14} /></button>} />
              <RiskLine label="在途执行单" value={`${(data.executionOrders || []).filter((item) => !["closed", "cancelled", "rejected"].includes(String(item.status || "").toLowerCase())).length} 个`} />
              <RiskLine label="风控阻断" value={`${blockedRisk} 次`} />
              <RiskLine label="Agent 运行失败" value={`${failedRuns} 次`} />
              <RiskLine label="详细日志" value="已集中到审计与通知" />
            </Card>
          </div>
          <Card>
            <SectionTitle title="贡献复盘" action={<button className="textButton" onClick={() => ui.setActive("knowledgeSkills")}>管理 Skill <ChevronRight size={14} /></button>} />
            <div className="reviewGrid nested">
              <DataTable columns={[
                { key: "time", label: "时间" }, { key: "skill", label: "Skill" }, { key: "status", label: "状态" }, { key: "output", label: "输出摘要", width: "1.8fr" }
              ]} rows={skillRows} />
              <div className="contributionList">
                {(attribution.rules || []).slice(0, 6).map((rule) => <div key={rule.id}><strong>{rule.name}</strong><span>{rule.checks} 次检查 · {rule.blocked} 次阻断</span><small>{rule.contribution}</small></div>)}
                {(attribution.skills || []).slice(0, 6).map((skill) => <div key={skill.id}><strong>{skill.name}</strong><span>{skill.runs} 次运行 · 成功率 {skill.successRatePct ?? "未验证"}</span><small>{skill.contribution}</small></div>)}
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function EquitySparkline({ values = [] }) {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1e-9, max - min);
  const path = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 100;
    const y = 44 - ((value - min) / range) * 40;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
  return <svg className="equityCurve" viewBox="0 0 100 48" preserveAspectRatio="none"><path d={path} /></svg>;
}

function PaperValidationCard({ data, action }) {
  const report = data.paperReport || { minForwardTrades: 8, sessions: [] };
  const sessions = report.sessions || [];
  const tone = { passed: "ok", failed: "danger", running: "warning" };
  const label = { passed: "已通过", failed: "未通过", running: "验证中" };
  return (
    <Card>
      <SectionTitle icon={GitBranch} title="模拟盘前向验证（回测 → 模拟盘 → 小额实盘）" action={<span className="sectionActions"><button className="secondaryButton" onClick={() => action("/api/paper/spawn-from-profiles", {})}><Plus size={14} /> 从已验证策略开盘</button><button className="secondaryButton" onClick={() => action("/api/paper/run", {})}><RefreshCw size={14} /> 前向推进</button></span>} />
      {sessions.length ? (
        <DataTable columns={[
          { key: "symbol", label: "交易对" }, { key: "strategy", label: "策略", width: "1.4fr" }, { key: "progress", label: "前向交易" }, { key: "exp", label: "前向期望" }, { key: "dd", label: "最大回撤" }, { key: "status", label: "状态" }
        ]} rows={sessions.map((s) => ({
          id: s.id,
          symbol: `${s.symbol} · ${s.timeframe}`,
          strategy: `${s.label}${s.seeded ? " · 含预热" : ""}`,
          progress: `${s.metrics?.trades ?? 0} / ${report.minForwardTrades}`,
          exp: s.metrics?.expectancyR !== null && s.metrics?.expectancyR !== undefined ? `${s.metrics.expectancyR}R` : "-",
          dd: s.metrics?.maxDrawdownPct !== null && s.metrics?.maxDrawdownPct !== undefined ? `${s.metrics.maxDrawdownPct}%` : "-",
          status: <StatusBadge tone={tone[s.status] || "warning"}>{label[s.status] || s.status}</StatusBadge>
        }))} />
      ) : (
        <div className="emptyPanel emptyPanelAction">
          <strong>还没有模拟盘会话</strong>
          <span>先在上方「自适应策略研究」跑出已验证策略，再点「从已验证策略开盘」——系统会对这些策略开纯前向模拟盘，随真实行情累积样本，通过后才建议放大实盘。</span>
          <button className="secondaryButton" onClick={() => action("/api/paper/spawn-from-profiles", {})}>从已验证策略开盘</button>
        </div>
      )}
      <InsightNote icon={Rocket} title="前向验证">只在会话创建后到来的 K 线上模拟成交，无法过拟合历史；前向满 {report.minForwardTrades} 笔且期望为正、回撤可控才通过。开启 REQUIRE_PAPER_VALIDATION 后，未通过的交易对将禁止开实盘新仓。</InsightNote>
    </Card>
  );
}

function StrategyResearchCard({ data, action }) {
  const profiles = data.strategyProfiles || [];
  const confTone = { validated: "ok", low: "warning", none: "danger" };
  const confLabel = { validated: "已验证", low: "低置信", none: "无合格策略" };
  return (
    <Card>
      <SectionTitle icon={BrainCircuit} title="自适应策略研究（样本外验证）" action={<button className="secondaryButton" onClick={() => action("/api/strategy/research", {})}><Rocket size={14} /> 运行研究</button>} />
      {profiles.length ? (
        <DataTable columns={[
          { key: "symbol", label: "交易对" }, { key: "strategy", label: "优选策略", width: "1.5fr" }, { key: "oos", label: "样本外期望" }, { key: "winrate", label: "样本外胜率" }, { key: "conf", label: "置信度" }, { key: "regime", label: "Regime" }
        ]} rows={profiles.map((p) => ({
          id: p.id,
          symbol: `${p.symbol} · ${p.timeframe}`,
          strategy: p.label,
          oos: p.test?.expectancyR !== null && p.test?.expectancyR !== undefined ? `${p.test.expectancyR}R（${p.test.trades} 笔）` : "-",
          winrate: p.test?.winRatePct !== null && p.test?.winRatePct !== undefined ? `${p.test.winRatePct}%` : "-",
          conf: <StatusBadge tone={confTone[p.confidence] || "warning"}>{confLabel[p.confidence] || p.confidence}</StatusBadge>,
          regime: p.regime || "-"
        }))} />
      ) : (
        <div className="emptyPanel emptyPanelAction">
          <strong>还没有策略画像</strong>
          <span>点击「运行研究」：在趋势/均值回归/突破多套策略上做 train→test 样本外寻优，胜出者自动写入 Agent 记忆并参与后续决策。每 6 小时也会自动跑一次。</span>
        </div>
      )}
      <InsightNote icon={Search} title="样本外验证">用前 70% 数据寻优、后 30% 验证，降低过拟合风险；低置信表示样本外交易太少，不足以采信。</InsightNote>
    </Card>
  );
}

function BacktestCard({ data, action }) {
  const [form, setForm] = useState({ symbol: "BTC/USDT", timeframe: "1h", fastPeriod: 10, slowPeriod: 30, stopLossPct: 2, takeProfitR: 2 });
  const latest = (data.backtests || [])[0];
  const positive = latest && Number(latest.netReturnPct) >= 0;
  return (
    <Card>
      <SectionTitle icon={LineChart} title="策略回测" action={<button className="secondaryButton" onClick={() => action("/api/backtest/run", { ...form, fastPeriod: Number(form.fastPeriod), slowPeriod: Number(form.slowPeriod), stopLossPct: Number(form.stopLossPct), takeProfitR: Number(form.takeProfitR) })}><Rocket size={14} /> 运行回测</button>} />
      <div className="dashboardToolbar">
        <div className="filterGroup">{["15m", "1h", "4h", "1d"].map((tf) => <button className={form.timeframe === tf ? "active" : ""} key={tf} onClick={() => setForm((current) => ({ ...current, timeframe: tf }))}>{tf}</button>)}</div>
        <span>SMA({form.fastPeriod}/{form.slowPeriod}) 金叉开多 · 止损 {form.stopLossPct}% · 止盈 {form.takeProfitR}R</span>
      </div>
      {latest ? (
        <>
          <div className="btMetrics">
            <div><span>交易笔数</span><strong>{latest.trades}</strong></div>
            <div><span>胜率</span><strong>{latest.winRatePct === null ? "-" : `${latest.winRatePct}%`}</strong></div>
            <div><span>盈亏比</span><strong>{latest.profitFactor ?? "-"}</strong></div>
            <div><span>期望</span><strong>{latest.expectancyR ?? "-"}R</strong></div>
            <div><span>最大回撤</span><strong className="negative">{latest.maxDrawdownPct ?? "-"}%</strong></div>
            <div><span>净收益</span><strong className={positive ? "positive" : "negative"}>{displayPct(latest.netReturnPct)}</strong></div>
          </div>
          <EquitySparkline values={latest.equityCurve} />
          <p className="muted">{latest.symbol} {latest.timeframe} · {latest.candles} 根 K 线 · {latest.strategy}{latest.note ? ` · ${latest.note}` : ""}</p>
        </>
      ) : (
        <div className="emptyPanel emptyPanelAction">
          <strong>还没有回测结果</strong>
          <span>点击「运行回测」在历史 K 线上验证策略，得到胜率、盈亏比与最大回撤——上实盘前先用它证明策略有效。</span>
        </div>
      )}
    </Card>
  );
}

function SegmentList({ title, rows = [] }) {
  return (
    <div className="segmentList">
      <h3>{title}</h3>
      {rows.slice(0, 4).map((row) => (
        <div key={row.key}>
          <strong>{row.key}</strong>
          <span>{row.trades} 笔 · 胜率 {row.winRatePct === null ? "暂无" : `${row.winRatePct}%`} · 盈亏比 {row.profitFactor ?? "暂无"}</span>
          <b className={Number(row.pnl || 0) >= 0 ? "positive" : "negative"}>{displayMoney(row.pnl)} USDT</b>
        </div>
      ))}
      {!rows.length && <div className="emptyPanel">暂无样本。</div>}
    </div>
  );
}

export function AuditSystemPage({ data, ui, embedded = false }) {
  const traces = data.traces || [];
  const jobRuns = data.jobRuns || [];
  const [traceTypeFilter, setTraceTypeFilter] = useState("全部");
  const [traceWindow, setTraceWindow] = useState("24h");
  const latestPlan = data.tradePlans?.[0] || {};
  const latestRisk = data.riskChecks?.[0] || latestPlan.lastRiskCheck || {};
  const latestOrder = data.orders?.[0] || data.executionOrders?.[0] || {};
  const auditOk = data.readiness?.checks?.find((item) => item.key === "audit_chain")?.configured ?? true;
  const successfulRuns = jobRuns.filter((run) => ["ok", "completed"].includes(String(run.status).toLowerCase())).length;
  const successRate = jobRuns.length ? `${((successfulRuns / jobRuns.length) * 100).toFixed(1)}%` : "暂无数据";
  const latencies = traces.map((trace) => Number(trace.latencyMs)).filter(Number.isFinite).sort((a, b) => a - b);
  const p95 = latencies.length ? formatDuration(latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]) : "暂无数据";
  const incidents = [...(data.riskIncidents || []), ...(data.alerts || [])].slice(0, 5);
  const cutoff = traceWindow === "24h" ? Date.now() - 24 * 60 * 60 * 1000 : 0;
  const filteredTraces = traces.filter((trace) => {
    const withinWindow = !cutoff || new Date(trace.createdAt).getTime() >= cutoff;
    const withinType = traceTypeFilter === "全部" || trace.type === traceTypeFilter;
    return withinWindow && withinType;
  });
  const traceTypes = ["全部", ...Array.from(new Set(traces.map((trace) => trace.type).filter(Boolean))).slice(0, 3)];
  const chainItems = [
    ["授权任务", latestPlan.mandateId, humanize(data.agentStatus?.activeMandate?.status, "未授权"), KeyRound],
    ["分析包", latestPlan.analysisBundleId, latestPlan.analysisBundleId ? "已生成" : "未生成", FileText],
    ["交易计划", latestPlan.id, humanize(latestPlan.status, "未生成"), ClipboardList],
    ["风险校验", latestPlan.riskCheckId || latestRisk.id, humanize(latestRisk.decision || latestRisk.result, "未检查"), Shield],
    ["执行", latestOrder.id, humanize(latestOrder.status, "真实写关闭"), Rocket],
    ["结算对账", data.reconciliationReports?.[0]?.id, humanize(data.reconciliationReports?.[0]?.status, "未对账"), RefreshCw],
    ["复盘审查", data.reviews?.[0]?.id, data.reviews?.[0]?.id ? "已记录" : "未生成", Search]
  ];
  return (
    <div className="pageStack">
      {!embedded && <PageHeader active="auditSystem" />}
      <div className="metricGrid five">
        <MetricCard icon={Gauge} label="API 健康" value={data.system.apiHealth || "未知"} sub={`实现 ${data.readiness?.implementationCompletionPct || 0}%`} />
        <MetricCard icon={Activity} label="WebSocket 状态" value={data.realtimeStarted ? "运行中" : "未启动"} sub={data.realtimeStarted ? `${data.realtimeConnections?.filter((item) => item.status === "connected").length || 0} / ${data.realtimeConnections?.length || 0} 已连接` : "实时管理器未开启"} tone={data.realtimeStarted ? "positive" : "warning"} />
        <MetricCard icon={Zap} label="任务引擎" value={String(data.tasks?.filter((task) => task.enabled).length || 0)} sub="启用任务" />
        <MetricCard icon={RefreshCw} label="交易所同步" value={`${data.exchangeAccounts?.filter((item) => item.readEnabled).length || 0} / ${data.exchangeAccounts?.length || 0}`} sub="已配置只读账户" />
        <MetricCard icon={Shield} label="审计链" value={auditOk ? "正常" : "异常"} sub={`${data.auditLogs?.length || 0} 条日志`} />
      </div>

      <Card className="auditChainCard">
        <SectionTitle title="Agent 运行审计链" />
        <div className="auditChain stepper">
          {chainItems.map(([item, value, state, Icon], index) => (
            <div className="auditStep" key={item} title={value || "未生成"}>
              <div className="auditStepIcon">{Icon ? <Icon size={18} /> : index + 1}</div>
              <strong>{item}</strong>
              <small>{shortId(value)}</small>
              <StatusBadge tone={statusTone(state)}>{state}</StatusBadge>
            </div>
          ))}
        </div>
        <footer><span>最近耗时 <b>{formatDuration(traces[0]?.latencyMs)}</b></span><span>状态 <b className={latestRisk.passed ? "positive" : "warning"}>{humanize(latestRisk.decision || latestPlan.status, "未生成")}</b></span><button className="secondaryButton" onClick={() => ui.openPanel("auditChain")}>查看完整链路 <ChevronRight size={14} /></button></footer>
      </Card>

      <div className="auditGrid two">
        <Card>
          <SectionTitle title="决策日志" action={<div className="filterGroup">{traceTypes.map((type) => <button className={traceTypeFilter === type ? "active" : ""} key={type} onClick={() => setTraceTypeFilter(type)}>{humanize(type, type)}</button>)}<button className={traceWindow === "24h" ? "active" : ""} onClick={() => setTraceWindow((current) => current === "24h" ? "all" : "24h")}>{traceWindow === "24h" ? "近 24 小时" : "全部时间"} <ChevronDown size={13} /></button></div>} />
          <DataTable columns={[
            { key: "time", label: "时间" }, { key: "agent", label: "Agent / 步骤" }, { key: "type", label: "类型" }, { key: "detail", label: "详情", width: "1.5fr" }, { key: "status", label: "状态" }
          ]} rows={filteredTraces.slice(0, 8).map((trace) => ({ id: trace.id, time: formatTime(trace.createdAt), agent: humanize(trace.type || "步骤"), type: trace.type?.includes("tool") ? "工具调用" : "决策", detail: trace.title, status: <StatusBadge tone={statusTone(trace.status)}>{humanize(trace.status)}</StatusBadge> }))} />
        </Card>
        <Card className="executionAuditCard">
          <SectionTitle title="执行审计" />
          <div className="executionAudit">
            <RiskLine label="订单 ID" value={shortId(latestOrder.id)} />
            <RiskLine label="交易计划 ID" value={shortId(latestPlan.id)} />
            <RiskLine label="风险校验 ID" value={shortId(latestPlan.riskCheckId || latestRisk.id)} />
            <RiskLine label="交易对" value={latestPlan.symbol || latestOrder.symbol || "-"} />
            <RiskLine label="方向 / 类型" value={`${humanize(latestPlan.direction || latestOrder.side, "-")} / ${humanize(latestOrder.type || latestPlan.entry?.type, "-")}`} />
            <RiskLine label="执行状态" value={humanize(latestOrder.status, "真实写操作关闭")} />
            <RiskLine label="对账结果" value={humanize(data.reconciliationReports?.[0]?.status, "未对账")} />
          </div>
          <button className="textButton centered" onClick={() => ui.openPanel("executionDetail")}>查看详情 <ChevronRight size={14} /></button>
        </Card>
      </div>

      <Card>
        <SectionTitle title="系统可观测性" action={<button className="textButton" onClick={() => ui.setActive("eventsTasks")}>全部事件 <ChevronRight size={14} /></button>} />
        <div className="observabilityGrid">
          <MiniChart title="任务成功率" value={successRate} sub={`${jobRuns.length} 次真实任务运行`} />
          <MiniChart title="任务延迟（P95）" value={p95} sub={`${latencies.length} 条 Trace 样本`} />
          <MiniChart title="告警数量" value={String(incidents.length)} sub="风险事件 + 外部告警" />
          <div className="incidentPanel">
            <h3>近期告警与事件</h3>
            {incidents.map((item) => <div key={item.id}><StatusBadge tone={statusTone(item.severity || item.status)}>{humanize(item.status || item.severity, "记录")}</StatusBadge><span>{item.title || item.message || item.action || item.id}</span><small>{formatTime(item.createdAt)}</small></div>)}
            {!incidents.length && <div className="emptyPanel">暂无真实告警。</div>}
          </div>
        </div>
      </Card>
    </div>
  );
}

export function AgentProfilesPage({ data, action, ui }) {
  const profiles = (data.agentProfiles || []).slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  const enabled = profiles.filter((profile) => profile.enabled !== false).length;
  const proposal = profiles.filter((profile) => profile.canProposeTrade).length;
  const risk = profiles.filter((profile) => profile.canApproveRisk).length;
  const phases = profiles.map((profile) => profile.phase).filter(Boolean);
  const comparison = [
    ["市场输入", "行情、事件、策略研究容易混在同一段分析里", "市场观察员和事件分析员先拆分事实、噪音和风险窗口"],
    ["交易计划", "LLM 可能直接给方向建议，计划结构不稳定", "策略研究员与交易计划员输出固定字段：方向、触发、止损、仓位、失效条件"],
    ["风险边界", "风控更多依赖统一规则，缺少角色复核语境", "风控官独立审查计划，只能批准/拒绝，不能替自己放宽规则"],
    ["执行过程", "批准后执行和持仓监控的责任不够清晰", "执行监督员盯订单状态，持仓管理员盯止损、保本、减仓和异常"],
    ["复盘记忆", "复盘更像记录结果，较难反哺下一轮", "复盘/记忆管理员把错误、有效条件和禁忌沉淀为下一轮上下文"]
  ];
  return (
    <div className="pageStack">
      <PageHeader active="agentProfiles" />
      <div className="metricGrid four">
        <MetricCard icon={BrainCircuit} label="交易 Agent" value={`${profiles.length} 个`} sub={`${enabled} 个启用`} />
        <MetricCard icon={ClipboardList} label="可提计划" value={`${proposal} 个`} sub="只生成结构化计划，不直接下单" />
        <MetricCard icon={Shield} label="风控审批" value={`${risk} 个`} sub="只允许风控官批准/拒绝" />
        <MetricCard icon={GitBranch} label="流程阶段" value={`${new Set(phases).size} 段`} sub="观察→复盘闭环" />
      </div>

      <Card className="agentManifesto">
        <SectionTitle icon={Sparkles} title="人格宣言" action={<button className="secondaryButton" onClick={() => ui.setActive("systemSettings")}>配置模型 <ChevronRight size={14} /></button>} />
        <blockquote>我不是来替你冒险的，我是来把风险变得可见、可控、可复盘的。</blockquote>
        <InsightNote icon={Shield} title="交易权限边界">所有 Agent 都只能提出结构化建议或审查结果；真实写单必须经过交易计划、硬风控、授权、执行引擎和交易写入网关。</InsightNote>
      </Card>

      <Card className="agentFlowBoard">
        <SectionTitle icon={GitBranch} title="8 Agent 编排链路" />
        <div className="agentFlowRail">
          {profiles.map((profile, index) => (
            <div className="agentFlowStep" key={profile.id}>
              <b>{String(index + 1).padStart(2, "0")}</b>
              <span>{profile.name}</span>
              <small>{profile.phase}</small>
            </div>
          ))}
        </div>
      </Card>

      <Card className="agentCompareCard">
        <SectionTitle icon={BarChart3} title="加入 8 Agent 前后对比" />
        <div className="agentCompareGrid">
          {comparison.map(([topic, before, after]) => (
            <div key={topic}>
              <strong>{topic}</strong>
              <p><b>以前</b>{before}</p>
              <p><b>现在</b>{after}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="agentProfileGrid">
        {profiles.map((profile) => (
          <Card className={`agentProfileCard ${profile.enabled === false ? "disabled" : ""}`} key={profile.id}>
            <div className="agentProfileHead">
              <div>
                <span>{profile.role}</span>
                <h2>{profile.name}</h2>
              </div>
              <StatusBadge tone={profile.enabled === false ? "warning" : "ok"}>{profile.enabled === false ? "停用" : "启用"}</StatusBadge>
            </div>
            <p>{profile.personality}</p>
            <RiskLine label="使命" value={profile.mission} />
            <RiskLine label="输出" value={profile.outputSchema} />
            <RiskLine label="记忆策略" value={profile.memoryPolicy} />
            <div className="agentToolList">
              {(profile.tools || []).map((tool) => <span key={tool}>{tool}</span>)}
            </div>
            <div className="agentBoundaryList">
              {(profile.boundaries || []).slice(0, 4).map((item) => <small key={item}>· {item}</small>)}
            </div>
            <footer>
              <button className="secondaryButton" onClick={() => action(`/api/agent/profiles/${profile.id}`, { enabled: profile.enabled === false }, "PATCH")}>{profile.enabled === false ? "启用" : "停用"}</button>
              <button className="textButton" onClick={() => {
                const next = window.prompt("更新人格宣言", profile.declaration || "");
                if (next !== null) action(`/api/agent/profiles/${profile.id}`, { declaration: next }, "PATCH");
              }}>编辑宣言</button>
            </footer>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function AdminPage({ data, action }) {
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "", role: "交易用户", freeMonths: 0 });
  const [newPlan, setNewPlan] = useState({ name: "", months: 1, priceUsdt: 0, features: "" });
  const [planDrafts, setPlanDrafts] = useState({});
  const [grantMonths, setGrantMonths] = useState(12);
  const [adminTab, setAdminTab] = useState("users");
  const plans = data.subscriptionPlans || [];
  const users = data.users || [];
  const payments = data.paymentRequests || [];
  const subscriptions = data.subscriptions || [];
  const profiles = (data.agentProfiles || []).slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  const activeSubs = subscriptions.filter((item) => ["active", "trialing"].includes(item.status)).length;
  const ownerGrants = subscriptions.filter((item) => item.source === "owner_grant").length;
  const activeProfiles = profiles.filter((profile) => profile.enabled !== false).length;
  useEffect(() => {
    setPlanDrafts((current) => {
      const next = { ...current };
      for (const plan of plans) {
        if (!next[plan.id]) next[plan.id] = { ...plan, features: (plan.features || []).join("\n") };
      }
      return next;
    });
  }, [plans]);
  function subscriptionFor(user) {
    return subscriptions.find((item) => item.tenantId === user.tenantId || item.userId === user.id);
  }
  function updatePlanDraft(id, patch) {
    setPlanDrafts((current) => ({ ...current, [id]: { ...(current[id] || {}), ...patch } }));
  }
  function resetUserPassword(user) {
    const password = window.prompt(`为 ${user.email || user.name} 设置新的临时密码（至少 10 位）。设置后请让 TA 登录并在“账户 → 修改密码”里自行更换。`);
    if (!password) return;
    if (password.length < 10) { ui.notify?.("临时密码至少 10 位"); return; }
    action(`/api/admin/users/${user.id}/reset-password`, { password }, "POST");
  }
  function savePlan(plan) {
    const draft = planDrafts[plan.id] || plan;
    action(`/api/admin/subscription-plans/${plan.id}`, {
      name: draft.name,
      months: draft.months,
      priceUsdt: draft.priceUsdt,
      enabled: draft.enabled !== false,
      features: String(draft.features || "").split("\n").map((item) => item.trim()).filter(Boolean)
    }, "PATCH");
  }
  const adminTabs = [
    ["users", "用户授权", UserCog],
    ["billing", "套餐支付", WalletCards],
    ["agents", "Agent 配置", BrainCircuit],
    ["security", "安全维护", Shield]
  ];
  return (
    <div className="pageStack">
      <PageHeader active="admin" />
      <Card className="adminHero">
        <div>
          <span>Owner Control Center</span>
          <h2>用户、订阅、Agent 与安全维护集中在这里</h2>
          <p>日常交易页面只展示交易工作流；这里负责谁能登录、谁被授权、套餐如何定价，以及后台 Agent 能力是否启用。</p>
        </div>
        <div className="adminHeroMetrics">
          <div><strong>{users.length}</strong><span>用户</span></div>
          <div><strong>{activeSubs}</strong><span>有效订阅</span></div>
          <div><strong>{ownerGrants}</strong><span>免费授权</span></div>
          <div><strong>{activeProfiles}/{profiles.length}</strong><span>Agent 启用</span></div>
        </div>
      </Card>

      <div className="adminTabs" role="tablist" aria-label="Admin sections">
        {adminTabs.map(([id, label, Icon]) => (
          <button key={id} className={adminTab === id ? "active" : ""} onClick={() => setAdminTab(id)}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      {adminTab === "users" && (
        <div className="adminTwoColumn">
          <Card className="adminCreateCard">
            <SectionTitle icon={UserCog} title="Owner 开通账号" action={<StatusBadge tone="ok">免费授权可选</StatusBadge>} />
            <div className="adminFormStack">
              <label><span>姓名</span><input value={newUser.name} onChange={(event) => setNewUser({ ...newUser, name: event.target.value })} placeholder="用户姓名" /></label>
              <label><span>邮箱</span><input value={newUser.email} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} placeholder="user@example.com" /></label>
              <label><span>初始密码</span><input type="password" value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} placeholder="至少 10 位" /></label>
              <div className="adminInlineFields">
                <label><span>角色</span><select value={newUser.role} onChange={(event) => setNewUser({ ...newUser, role: event.target.value })}><option>交易用户</option><option>管理员</option></select></label>
                <label><span>免费月数</span><input type="number" min="0" value={newUser.freeMonths} onChange={(event) => setNewUser({ ...newUser, freeMonths: event.target.value })} /></label>
              </div>
              <button className="primaryButton" onClick={() => action("/api/admin/users", newUser)}>创建账号</button>
            </div>
          </Card>

          <Card>
            <SectionTitle icon={Lock} title="用户授权" action={<label className="inlineControl"><span>默认赠送</span><input type="number" min="1" value={grantMonths} onChange={(event) => setGrantMonths(event.target.value)} /> 月</label>} />
            <div className="adminUserList">
              {users.map((user) => {
                const sub = subscriptionFor(user);
                return (
                  <div className={`adminUserRow ${user.isOwner ? "owner" : ""}`} key={user.id}>
                    <div className="adminUserIdentity"><strong>{user.name || user.email || user.id}</strong><small>{user.email || "-"} · {user.tenantId}</small></div>
                    <select value={user.role || "交易用户"} disabled={user.isOwner} onChange={(event) => action(`/api/admin/users/${user.id}`, { role: event.target.value }, "PATCH")}><option>交易用户</option><option>管理员</option></select>
                    <select value={user.status || "active"} disabled={user.isOwner} onChange={(event) => action(`/api/admin/users/${user.id}`, { status: event.target.value }, "PATCH")}><option value="active">启用</option><option value="disabled">停用</option></select>
                    <div className="adminSubState"><StatusBadge tone={sub?.status === "active" ? "ok" : "warning"}>{sub?.source === "owner_grant" ? "Owner 免费授权" : humanize(sub?.status, "未订阅")}</StatusBadge><small>{sub?.currentPeriodEnd ? `到期 ${formatDate(sub.currentPeriodEnd)}` : "长期有效"}</small></div>
                    <span className="adminUserActions">
                      {user.isOwner ? <span className="muted">Owner</span> : (
                        <>
                          <button className="secondaryButton" onClick={() => action(`/api/admin/users/${user.id}/grant-free`, { months: grantMonths })}>赠送 {grantMonths} 月</button>
                          <button className="secondaryButton" onClick={() => resetUserPassword(user)}>重置密码</button>
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {adminTab === "billing" && (
        <div className="adminTwoColumn billing">
          <Card>
            <SectionTitle icon={WalletCards} title="订阅套餐定价" />
            <div className="planEditList pretty">
              {plans.map((plan) => {
                const draft = planDrafts[plan.id] || plan;
                return (
                  <div className="planEditRow" key={plan.id}>
                    <div className="planEditHeader">
                      <input value={draft.name || ""} onChange={(event) => updatePlanDraft(plan.id, { name: event.target.value })} placeholder="套餐名称" />
                      <button type="button" className="planToggle" title="点击启用/停用" onClick={() => updatePlanDraft(plan.id, { enabled: draft.enabled === false })}>
                        <StatusBadge tone={draft.enabled === false ? "warning" : "ok"}>{draft.enabled === false ? "已停用" : "启用中"}</StatusBadge>
                      </button>
                    </div>
                    <div className="adminInlineFields">
                      <label><span>周期 · 月</span><input type="number" min="1" value={draft.months || 1} onChange={(event) => updatePlanDraft(plan.id, { months: event.target.value })} /></label>
                      <label><span>价格 · USDT</span><input type="number" min="0" value={draft.priceUsdt ?? 0} onChange={(event) => updatePlanDraft(plan.id, { priceUsdt: event.target.value })} /></label>
                    </div>
                    <textarea rows={2} value={draft.features || ""} onChange={(event) => updatePlanDraft(plan.id, { features: event.target.value })} placeholder="套餐权益，每行一条" />
                    <button className="primaryButton" onClick={() => savePlan(plan)}>保存</button>
                  </div>
                );
              })}
            </div>
          </Card>
          <div className="adminStack">
            <Card>
              <SectionTitle icon={Plus} title="新增套餐" />
              <div className="adminFormStack">
                <input value={newPlan.name} onChange={(event) => setNewPlan({ ...newPlan, name: event.target.value })} placeholder="套餐名" />
                <div className="adminInlineFields">
                  <input type="number" min="1" value={newPlan.months} onChange={(event) => setNewPlan({ ...newPlan, months: event.target.value })} placeholder="月数" />
                  <input type="number" min="0" value={newPlan.priceUsdt} onChange={(event) => setNewPlan({ ...newPlan, priceUsdt: event.target.value })} placeholder="USDT 价格" />
                </div>
                <textarea value={newPlan.features} onChange={(event) => setNewPlan({ ...newPlan, features: event.target.value })} placeholder="套餐权益，每行一条" />
                <button className="secondaryButton" onClick={() => action("/api/admin/subscription-plans", { ...newPlan, features: String(newPlan.features || "").split("\n").filter(Boolean) })}>新增套餐</button>
              </div>
            </Card>
            <Card>
              <SectionTitle icon={Database} title="TRC20 支付请求" />
              <div className="paymentRequestList">
                {payments.slice(0, 8).map((payment) => (
                  <div key={payment.id}>
                    <span>{formatTime(payment.createdAt)}</span>
                    <strong>{displayMoney(payment.amount, 2, "0")} USDT</strong>
                    <small>{payment.planId}</small>
                    <StatusBadge tone={payment.status === "confirmed" ? "ok" : "warning"}>{humanize(payment.status)}</StatusBadge>
                  </div>
                ))}
                {!payments.length && <div className="emptyPanel">暂无支付请求。</div>}
              </div>
            </Card>
          </div>
        </div>
      )}

      {adminTab === "agents" && (
        <Card>
          <SectionTitle icon={BrainCircuit} title="Agent Profile 配置" action={<InsightNote icon={Shield} title="说明">这里是后台能力开关，不作为用户侧介绍页展示；Agent 会在交易计划、风控、执行和复盘流程中发挥作用。</InsightNote>} />
          <div className="adminAgentGrid">
            {profiles.map((profile) => (
              <div className={`adminAgentMini ${profile.enabled === false ? "disabled" : ""}`} key={profile.id}>
                <div>
                  <b>{String(profile.order || "").padStart(2, "0")}</b>
                  <strong>{profile.name}</strong>
                  <small>{profile.role}</small>
                </div>
                <p>{profile.mission}</p>
                <button className="secondaryButton" onClick={() => action(`/api/agent/profiles/${profile.id}`, { enabled: profile.enabled === false }, "PATCH")}>{profile.enabled === false ? "启用" : "停用"}</button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {adminTab === "security" && (
        <div className="adminTwoColumn">
          <Card>
            <SectionTitle icon={KeyRound} title="修改管理员密码" action={<InsightNote icon={AlertTriangle} title="提示">修改后当前会话可能仍短暂有效；建议保存后退出并用新密码重新登录。</InsightNote>} />
            <div className="adminFormStack">
              <label><span>新密码</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 12 位" /></label>
              <button className="primaryButton" disabled={password.length < 12} onClick={() => action("/api/admin/password", { password })}>保存密码</button>
            </div>
          </Card>
          <Card>
            <SectionTitle icon={RefreshCw} title="清空工作数据" />
            <p className="muted">清空行情、计划、持仓、订单、复盘、记忆、任务运行和通知，保留用户、密钥、系统配置、风险规则、Agent Profile 与套餐。</p>
            <label className="dangerConfirm"><span>输入 RESET 确认</span><input value={confirmText} onChange={(event) => setConfirmText(event.target.value)} placeholder="RESET" /></label>
            <button className="danger" disabled={confirmText !== "RESET"} onClick={() => action("/api/system/reset-operational-data", { keepAudit: true })}>清空并开始投入</button>
          </Card>
        </div>
      )}
    </div>
  );
}
