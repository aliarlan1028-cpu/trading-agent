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
  WalletCards,
  Zap
} from "lucide-react";
import { pageCopy, formatMoney, displayMoney, displayPct, pct, asArray, safeList, readFileAsDataUrl, formatDateTime, formatDate, formatTime, formatDuration, orderStatus, humanize, humanizeList, humanizePhase, shortId, statusTone, compactAction, systemStatus, exchangeState, useApi, PageHeader, Card, SectionTitle, MetricCard, MiniSparkline, CandleChart, LinePriceChart, StatusBadge, ProgressBar, DataTable, RiskLine, MiniChart } from "./lib.jsx";

export function MarketAccountPage({ data, action, ui }) {
  const [pnlWindow, setPnlWindow] = useState("本月");
  const market = data.activeMarket || data.markets?.[0] || { candles: [] };
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
  const qualityRows = [
    ["胜率", performance.trades ? `${performance.winRatePct}%` : "暂无数据"],
    ["盈亏比", performance.profitFactor ?? "暂无数据"],
    ["已平仓交易", performance.trades ? `${performance.trades} 笔` : "暂无交易"],
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

  return (
    <div className="pageStack">
      <PageHeader active="marketAccount" />
      <div className="metricGrid five">
        <MetricCard icon={WalletCards} label="总资产（USDT）" value={displayMoney(data.portfolio.totalEquityUsdt)} sub={latestSnapshot ? `快照 ${formatDateTime(latestSnapshot.createdAt)}` : "私有账户同步后显示"} candles={market.candles} />
        <MetricCard icon={TrendingUp} label="今日盈亏（USDT）" value={displayMoney(data.portfolio.todayPnl)} sub={displayPct(data.portfolio.todayPnlPct)} tone={Number(data.portfolio.todayPnl || 0) >= 0 ? "positive" : "warning"} candles={market.candles} />
        <MetricCard icon={SquareActivity} label="未实现盈亏（USDT）" value={displayMoney(data.portfolio.weekPnl)} sub={displayPct(data.portfolio.weekPnlPct)} tone={Number(data.portfolio.weekPnl || 0) >= 0 ? "positive" : "warning"} candles={market.candles} />
        <MetricCard icon={BarChart3} label={`累计盈亏（${pnlWindow}）`} value={displayMoney(monthlyPnl)} sub={`${performance.trades || 0} 笔已平仓`} tone={Number(monthlyPnl || 0) >= 0 ? "positive" : "warning"} candles={market.candles} />
        <Card className="metricCard reconcileCard actionCard" onClick={() => configuredAccounts ? action("/api/reconciler/run", { mode: "manual_ui" }) : ui.setActive("systemSettings")} role="button" tabIndex={0}><div><span>对账状态</span><strong className={latestReconcile?.status === "ok" ? "positive" : "warning"}>{configuredAccounts ? humanize(latestReconcile?.status, "未对账") : "待配置"}</strong><small>{configuredAccounts ? `最后对账：${formatDateTime(latestReconcile?.createdAt || latestSnapshot?.createdAt, "暂无记录")}` : "先配置只读 API 后再对账"}</small></div><ChevronRight size={18} /></Card>
      </div>

      <div className="dashboardToolbar">
        <div className="filterGroup">{["本月", "季度", "全年"].map((item) => <button className={pnlWindow === item ? "active" : ""} key={item} onClick={() => setPnlWindow(item)}>{item}</button>)}</div>
        <span>可用保证金 {displayMoney(availableMargin)} · 占用 {displayMoney(usedMargin)} · 保证金率 {marginRate === null ? "未同步" : `${formatMoney(marginRate, 1)}%`}</span>
      </div>

      <div className="dashboardGrid">
        <Card>
          <SectionTitle icon={Gauge} title="账户健康" />
          <div className="healthGrid">
            {accountHealthRows.map(([label, value, tone]) => <div key={label}><span>{label}</span><strong>{value}</strong><StatusBadge tone={tone}>{tone === "ok" ? "正常" : tone === "danger" ? "高危" : "待处理"}</StatusBadge></div>)}
          </div>
        </Card>
        <Card>
          <SectionTitle icon={BarChart3} title="收益质量" action={<button className="textButton" onClick={() => ui.setActive("review")}>去复盘 <ChevronRight size={14} /></button>} />
          <div className="qualityGrid">
            {qualityRows.map(([label, value]) => <RiskLine key={label} label={label} value={value} />)}
          </div>
        </Card>
      </div>

      <Card>
        <SectionTitle icon={Activity} title="合约微观结构" action={<button className="secondaryButton" onClick={() => action(`/api/exchange/OKX/microstructure?symbol=${encodeURIComponent(market.symbol || "BTC/USDT")}`, {}, "GET")}><RefreshCw size={14} /> 刷新</button>} />
        <div className="microGrid">
          <div><span>资金费率</span><strong className={Number(market.fundingRate) >= 0 ? "positive" : "negative"}>{market.fundingRate === null || market.fundingRate === undefined ? "未同步" : `${Number(market.fundingRate).toFixed(4)}%`}</strong></div>
          <div><span>未平仓量 OI</span><strong>{market.openInterest ? formatMoney(market.openInterest, 0) : "未同步"}</strong></div>
          <div><span>订单簿买盘占比</span><strong className={Number(market.bookImbalancePct) >= 50 ? "positive" : "negative"}>{market.bookImbalancePct === null || market.bookImbalancePct === undefined ? "未同步" : `${market.bookImbalancePct}%`}</strong></div>
          <div><span>24h 涨跌</span><strong className={Number(market.changePct) >= 0 ? "positive" : "negative"}>{displayPct(market.changePct)}</strong></div>
        </div>
        <p className="muted">{market.microSyncedAt ? `资金费率反映多空拥挤度、订单簿买盘占比 <42% 偏空 / >58% 偏多。最后同步 ${formatDateTime(market.microSyncedAt)}` : "点击「刷新」拉取 OKX 资金费率、未平仓量与订单簿深度——合约方向判断需要它，不能只看 K 线。"}</p>
      </Card>

      <div className="dashboardGrid compact">
        <Card>
          <SectionTitle icon={ListChecks} title="下一步动作" />
          <div className="actionList">{actionItems.map((item, index) => <div key={item}><b>{index + 1}</b><span>{item}</span></div>)}</div>
        </Card>
        <Card>
          <SectionTitle icon={Target} title="风险承压" />
          <RiskLine label="今日亏损预算" value={data.system.remainingDailyLossUsdt === null || data.system.remainingDailyLossUsdt === undefined ? "未授权" : `${displayMoney(data.system.remainingDailyLossUsdt)} USDT`} />
          <RiskLine label="持仓数量" value={`${data.positions?.length || 0} 个`} />
          <RiskLine label="当前委托" value={`${data.orders?.length || 0} 个`} />
          <RiskLine label="系统状态" value={systemStatus(data).label} />
        </Card>
      </div>
    </div>
  );
}

export function EventsTasksPage({ data, action, ui }) {
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
      <PageHeader active="eventsTasks" />
      <div className="eventsGrid">
        <Card className="eventRadarCard">
          <SectionTitle icon={Target} title="重要事件雷达" action={<button className="secondaryButton" onClick={() => action("/api/event-sources/refresh", {})}><RefreshCw size={14} /> 刷新事件源</button>} />
          <div className="dateStrip">{eventRows.map((event, index) => <button className={(selectedEventId ? selectedEventId === event.id : index === 0) ? "active" : ""} key={event.id} onClick={() => { setSelectedEventId(event.id); ui.notify(`已选择事件：${event.title}`); }}><span>{formatDate(event.due, "待定")}</span><span>{event.category}</span></button>)}</div>
          {!eventRows.length && <div className="emptyPanel emptyPanelAction"><strong>暂无真实事件卡</strong><button className="secondaryButton" onClick={() => action("/api/event-sources/refresh", {})}><RefreshCw size={14} /> 刷新事件源</button></div>}
          <div className="eventRadarInner">
            <div className="eventTimeline">
              {eventRows.map((event, index) => (
                <div className="eventTimelineItem" key={event.id}>
                  <b>{formatDateTime(event.due, "待定")}<small>{event.category}</small></b>
                  <span>{event.title}</span>
                  <StatusBadge tone={event.impact >= 80 ? "danger" : "warning"}>{event.impactLabel || "中影响"}</StatusBadge>
                </div>
              ))}
            </div>
            <div className="eventDetail">
              <div className="eventDetailHead"><strong>{primaryEvent.title || "暂无事件"}</strong><StatusBadge tone={primaryEvent.impact >= 80 ? "danger" : "warning"}>{primaryEvent.impactLabel || "待评估"}</StatusBadge><button className="textButton" onClick={() => ui.openPanel("eventSources")}>事件详情 <ChevronRight size={14} /></button></div>
              <div className="countdown eventDue"><b>{formatDateTime(primaryEvent.due, "待定")}</b></div>
              <div className="eventMetrics">
                <span>影响等级<b className={primaryEvent.impact >= 80 ? "negative" : "warning"}>{primaryEvent.impactLabel || "待评估"}</b></span>
                <span>市场影响度<b>{primaryEvent.impact ? `${Number(primaryEvent.impact) / 10}/10` : "未评估"}</b><ProgressBar value={primaryEvent.impact || 0} tone="red" /></span>
                <span>历史波动率<b>{data.activeMarket?.candles?.length ? "待计算" : "未同步"}</b><MiniSparkline candles={data.activeMarket?.candles} /></span>
                <span>置信度<b>{primaryEvent.confidence ? `${primaryEvent.confidence}%` : "未评估"}</b><ProgressBar value={primaryEvent.confidence || 0} /></span>
              </div>
              <div className="assetChips">{(primaryEvent.relatedSymbols || []).map((symbol) => <span key={symbol}>{symbol}</span>)}</div>
              <p className="eventAdvice">{primaryEvent.action || "暂无事件建议；刷新真实事件源后显示。"}</p>
            </div>
          </div>
        </Card>

        <Card className="taskCard">
          <SectionTitle icon={CalendarClock} title="定时任务" action={<button className="primaryButton" onClick={() => ui.openPanel("taskManager")}><Plus size={15} /> 新建任务</button>} />
          <div className="taskTabs">{taskTabs.map(([name, count]) => <button className={taskFilter === name ? "active" : ""} key={name} onClick={() => { setTaskFilter(name); ui.notify(`任务筛选：${name}`); }}>{name} {count}</button>)}</div>
          <DataTable columns={[
            { key: "name", label: "任务名称" }, { key: "schedule", label: "触发方式" }, { key: "next", label: "下次运行" }, { key: "status", label: "状态" }, { key: "type", label: "任务分类" }, { key: "op", label: "操作" }
          ]} rows={filteredTasks.slice(0, 5).map((task) => ({ id: task.id, name: task.name, schedule: task.schedule || "Every 1h", next: formatDateTime(task.nextRunAt, task.nextRun || "-"), status: <StatusBadge>{humanize(task.status || "running")}</StatusBadge>, type: task.role || "风控", op: <span className="rowActions"><button className="linkCell" onClick={() => action(`/api/tasks/${task.id}/run`, {})}>运行</button><button className="linkCell" onClick={() => action(`/api/tasks/${task.id}/${task.enabled === false ? "resume" : "pause"}`, task.enabled === false ? {} : { reason: "manual_ui" })}>{task.enabled === false ? "恢复" : "暂停"}</button></span> }))} />
        </Card>
      </div>

      <div className="eventsBottom">
        <Card>
          <SectionTitle icon={GitBranch} title="事件规则" action={<button className="primaryButton" onClick={() => ui.openPanel("eventRule")}><Plus size={14} /> 新建规则</button>} />
          <DataTable columns={[
            { key: "rule", label: "规则名称" }, { key: "event", label: "触发事件" }, { key: "condition", label: "触发条件" }, { key: "action", label: "执行动作" }, { key: "status", label: "状态" }, { key: "op", label: "操作" }
          ]} rows={eventRuleRows} />
        </Card>
        <Card>
          <SectionTitle icon={ClipboardList} title="任务运行日志" action={<button className="textButton" onClick={() => ui.setActive("auditSystem")}>查看全部日志 <ChevronRight size={14} /></button>} />
          <div className="runLogList">
            {(data.jobRuns || []).slice(0, 5).map((run, index) => (
              <div className="runLog" key={run.id}><b>{formatTime(run.createdAt)}</b><span>{run.taskName}</span><StatusBadge tone={statusTone(run.status)}>{humanize(run.status)}</StatusBadge><small>{run.output}</small></div>
            ))}
            {!data.jobRuns?.length && <div className="emptyPanel">暂无真实任务运行日志。</div>}
          </div>
        </Card>
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

export function KnowledgeSkillsPage({ data, action, ui }) {
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
      <PageHeader active="knowledgeSkills" />
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
          {ruleCount || conceptCount ? <div className="conceptGraph"><b>知识图谱</b>{(knowledge.conceptCards || []).slice(0, 6).map((concept, index) => <span className={`node n${index + 1}`} key={concept.id}>{concept.name}</span>)}</div> : (
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
          <div className="skillList">
            {(data.skills || []).slice(0, 6).map((skill) => <div key={skill.id}><Sparkles size={18} /><strong>{skill.name}</strong><small>v{skill.version}</small><StatusBadge>{skill.status || "已启用"}</StatusBadge></div>)}
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
          <SectionTitle title="MCP 工具服务" action={<button className="secondaryButton" onClick={() => ui.openPanel("skillImport")}><Plus size={14} /> 注册 MCP</button>} />
          <div className="mcpBox">
            <div><strong>MCP 工具</strong><span>{connectedMcp}/{data.mcpServers?.length || 0} 已连接</span></div>
            <div className="mcpChips">{(data.mcpServers || []).slice(0, 6).map((item) => <span key={item.id}>{item.name}<b>{item.status}</b></span>)}</div>
            {!data.mcpServers?.length && <div className="emptyPanel">暂无已注册的 MCP Server。</div>}
            <RiskLine label="权限与隔离" value="沙箱执行" />
          </div>
        </Card>
      </div>

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
    </>
  );
}

export function RiskAuthPage({ data, action, ui }) {
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
      <PageHeader active="riskAuth" />
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
          <div className="riskRuleGrid">
            {(data.riskRules || []).map((rule) => <div className="riskRuleBox" key={rule.id}><h3>{rule.name}</h3><span>{rule.description}</span><span>级别 {rule.level || "-"}</span><span>动作 {humanize(rule.action, rule.action || "-")}</span><StatusBadge>{rule.enabled ? "启用" : "停用"}</StatusBadge></div>)}
            {!data.riskRules?.length && <div className="emptyPanel">暂无风险规则。</div>}
          </div>
          <p className="muted">规则触发将按预设动作执行，可在右侧「风险状态墙」中手动干预。</p>
        </Card>
        <Card className="riskStatusWall">
          <SectionTitle title="风险状态墙" action={<small>实时更新 {formatDateTime(latestRisk.createdAt || data.system.updatedAt)} <RefreshCw size={13} /></small>} />
          <div className="riskScoreBox"><Shield size={28} /><span>当前风险等级</span><strong>{data.portfolio.riskLabel || "未同步"}</strong><div className="riskGauge">{hasRiskScore ? riskScore : "—"}<small>{hasRiskScore ? "/100" : ""}</small></div></div>
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

export function ReviewPage({ data, action, ui }) {
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
  const agentRows = agentRuns.slice(0, 8).map((run) => ({
    id: run.id,
    time: formatTime(run.createdAt),
    goal: run.goal || run.role || "-",
    status: <StatusBadge tone={statusTone(run.status)}>{humanize(run.status)}</StatusBadge>,
    model: run.model || run.source || "-"
  }));
  return (
    <div className="pageStack">
      <PageHeader active="review" />
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

      <StrategyResearchCard data={data} action={action} />

      <BacktestCard data={data} action={action} />

      <div className="reviewGrid">
        <Card>
          <SectionTitle icon={AlertTriangle} title="亏损聚类" />
          <div className="clusterList">
            {(analytics.lossClusters || []).map((cluster) => <div key={cluster.key}><strong>{cluster.key}</strong><span>{cluster.count} 笔 · {displayMoney(cluster.pnl)} USDT</span><small>{cluster.suggestion}</small></div>)}
            {!analytics.lossClusters?.length && <div className="emptyPanel">暂无可聚类亏损样本。</div>}
          </div>
        </Card>
        <Card>
          <SectionTitle icon={GitBranch} title="三段验证闭环" />
          <div className="validationList">
            {(analytics.validation || []).slice(0, 4).map((experiment) => <div key={experiment.id}><strong>{experiment.hypothesis}</strong><span>{experiment.stages?.map((stage) => `${stage.label}:${humanize(stage.status)}`).join(" / ")}</span><small>{humanize(experiment.status)}</small></div>)}
            {!analytics.validation?.length && <div className="emptyPanel">暂无策略实验。点击「创建改进闭环」生成回测 → 模拟盘 → 小额实盘验证任务。</div>}
          </div>
        </Card>
      </div>

      <div className="reviewGrid">
        <Card>
          <SectionTitle title="交易记录复盘" />
          <DataTable columns={[
            { key: "time", label: "时间" }, { key: "symbol", label: "交易对" }, { key: "direction", label: "方向" }, { key: "status", label: "执行" }, { key: "risk", label: "风控" }, { key: "review", label: "操作" }
          ]} rows={tradeRows} />
        </Card>
        <Card>
          <SectionTitle title="Agent 行为复盘" action={<button className="textButton" onClick={() => ui.setActive("auditSystem")}>看审计 <ChevronRight size={14} /></button>} />
          <DataTable columns={[
            { key: "time", label: "时间" }, { key: "goal", label: "目标", width: "1.6fr" }, { key: "status", label: "状态" }, { key: "model", label: "模型/来源" }
          ]} rows={agentRows} />
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
      <p className="muted">样本外验证（用前 70% 数据寻优、后 30% 验证）避免过拟合；「低置信」表示样本外交易太少，不足以采信。</p>
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

export function AuditSystemPage({ data, ui }) {
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
    ["授权任务", latestPlan.mandateId, humanize(data.agentStatus?.activeMandate?.status, "未授权")],
    ["分析包", latestPlan.analysisBundleId, latestPlan.analysisBundleId ? "已生成" : "未生成"],
    ["交易计划", latestPlan.id, humanize(latestPlan.status, "未生成")],
    ["风险校验", latestPlan.riskCheckId || latestRisk.id, humanize(latestRisk.decision || latestRisk.result, "未检查")],
    ["执行", latestOrder.id, humanize(latestOrder.status, "真实写关闭")],
    ["结算对账", data.reconciliationReports?.[0]?.id, humanize(data.reconciliationReports?.[0]?.status, "未对账")],
    ["复盘审查", data.reviews?.[0]?.id, data.reviews?.[0]?.id ? "已记录" : "未生成"]
  ];
  return (
    <div className="pageStack">
      <PageHeader active="auditSystem" />
      <div className="metricGrid five">
        <MetricCard icon={Gauge} label="API 健康" value={data.system.apiHealth || "未知"} sub={`实现 ${data.readiness?.implementationCompletionPct || 0}%`} />
        <MetricCard icon={Activity} label="WebSocket 状态" value={String(data.realtimeConnections?.filter((item) => item.status === "connected").length || 0)} sub={`${data.realtimeConnections?.length || 0} 个连接配置`} />
        <MetricCard icon={Zap} label="任务引擎" value={String(data.tasks?.filter((task) => task.enabled).length || 0)} sub="启用任务" />
        <MetricCard icon={RefreshCw} label="交易所同步" value={`${data.exchangeAccounts?.filter((item) => item.readEnabled).length || 0} / ${data.exchangeAccounts?.length || 0}`} sub="已配置只读账户" />
        <MetricCard icon={Shield} label="审计链" value={auditOk ? "正常" : "异常"} sub={`${data.auditLogs?.length || 0} 条日志`} />
      </div>

      <div className="auditGrid">
        <Card className="auditChainCard">
          <SectionTitle title="Agent 运行审计链" />
          <div className="auditChain">
            {chainItems.map(([item, value, state], index) => (
              <div className="auditStep" key={item} title={value || "未生成"}>
                <div>{index + 1}</div>
                <span><strong>{item}</strong><small>ID: {shortId(value)}</small></span>
                <StatusBadge tone={statusTone(state)}>{state}</StatusBadge>
              </div>
            ))}
          </div>
          <footer><span>最近耗时 <b>{formatDuration(traces[0]?.latencyMs)}</b></span><span>状态 <b className={latestRisk.passed ? "positive" : "warning"}>{humanize(latestRisk.decision || latestPlan.status, "未生成")}</b></span><button className="secondaryButton" onClick={() => ui.openPanel("auditChain")}>查看完整链路 <ChevronRight size={14} /></button></footer>
        </Card>
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
