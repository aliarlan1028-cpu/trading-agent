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
  const initialMarket = data.activeMarket || data.markets?.[0] || { symbol: "BTC/USDT", candles: [] };
  const pairOptions = data.markets?.length ? data.markets.map((item) => item.symbol) : ["BTC/USDT", "ETH/USDT", "SOL/USDT"];
  const timeframeOptions = [["1m", "1分"], ["5m", "5分"], ["15m", "15分"], ["1h", "1小时"], ["4h", "4小时"], ["1d", "1日"]];
  const [selectedPair, setSelectedPair] = useState(initialMarket.symbol || "BTC/USDT");
  const [selectedTimeframe, setSelectedTimeframe] = useState("1h");
  function syncKlines(pair, timeframe) {
    return action(`/api/exchange/BINANCE/klines?symbol=${encodeURIComponent(pair)}&timeframe=${timeframe}`, {}, "GET");
  }
  const [chartMode, setChartMode] = useState("candles");
  const market = data.markets?.find((item) => item.symbol === selectedPair) || initialMarket;
  const latestReconcile = data.reconciliationReports?.[0];
  const latestSnapshot = data.accountSnapshots?.[0];
  const configuredAccounts = (data.exchangeAccounts || []).filter((account) => account.readEnabled).length;
  const totalAccounts = data.exchangeAccounts?.length || 0;
  const hasAccountData = latestSnapshot || data.portfolio.totalEquityUsdt !== null && data.portfolio.totalEquityUsdt !== undefined;
  const availableMargin = hasAccountData ? (data.portfolio.availableMarginUsdt ?? data.portfolio.availableMargin ?? 0) : null;
  const usedMargin = hasAccountData ? Math.max(0, Number(data.portfolio.totalEquityUsdt || 0) - Number(availableMargin || 0)) : null;
  const positionRows = (data.positions || []).slice(0, 3).map((item) => ({
    id: item.id,
    symbol: <b>{item.symbol}</b>,
    direction: <span className={item.direction === "空" ? "negative" : "positive"}>{item.direction}</span>,
    size: item.size,
    entry: formatMoney(item.entry),
    mark: formatMoney(item.mark),
    pnl: <span className={Number(item.pnl || 0) >= 0 ? "positive" : "negative"}>{Number(item.pnl || 0) >= 0 ? "+" : ""}{formatMoney(item.pnl)}</span>,
    action: <button className="linkCell" onClick={() => ui.openPanel("positions")}>详情</button>
  }));
  const orderRows = (data.orders || []).slice(0, 4).map((item) => ({
    id: item.id,
    time: formatTime(item.createdAt, "-"),
    symbol: item.symbol || "-",
    side: <span className={String(item.side || "").toLowerCase() === "sell" ? "negative" : "positive"}>{item.side || "-"}</span>,
    type: item.type || "-",
    price: item.price ? formatMoney(item.price) : "-",
    qty: item.size || item.quantity || "-",
    status: orderStatus(item.status),
    action: <button className="linkCell" onClick={() => action("/api/trade-actions/cancel_order", {
      exchange: item.exchange || "BINANCE",
      marketType: item.marketType || item.market_type || "perpetual_usdt",
      symbol: item.symbol,
      orderId: item.orderId,
      clientOrderId: item.clientOrderId || item.client_order_id || item.id,
      manualApproval: true
    })}>撤单</button>
  }));

  return (
    <div className="pageStack">
      <PageHeader active="marketAccount" />
      <div className="metricGrid five">
        <MetricCard label="总资产（USDT）" value={displayMoney(data.portfolio.totalEquityUsdt)} sub="私有账户同步后显示" candles={market.candles} />
        <MetricCard label="可用保证金（USDT）" value={displayMoney(availableMargin)} sub={data.portfolio.totalEquityUsdt ? `可用率 ${displayPct((availableMargin / Math.max(1, data.portfolio.totalEquityUsdt)) * 100).replace("+", "")}` : "私有账户同步后显示"} candles={market.candles} />
        <MetricCard label="今日盈亏（USDT）" value={displayMoney(data.portfolio.todayPnl)} sub={displayPct(data.portfolio.todayPnlPct)} tone="positive" candles={market.candles} />
        <MetricCard label="未实现盈亏（USDT）" value={displayMoney(data.portfolio.weekPnl)} sub={displayPct(data.portfolio.weekPnlPct)} tone="positive" candles={market.candles} />
        <Card className="metricCard reconcileCard actionCard" onClick={() => configuredAccounts ? action("/api/reconciler/run", { mode: "manual_ui" }) : ui.openPanel("keys")} role="button" tabIndex={0}><div><span>对账状态</span><strong className={latestReconcile?.status === "ok" ? "positive" : "warning"}>{configuredAccounts ? humanize(latestReconcile?.status, "未对账") : "待配置"}</strong><small>{configuredAccounts ? `最后对账：${formatDateTime(latestReconcile?.createdAt || latestSnapshot?.createdAt, "暂无记录")}` : "先配置只读 API 后再对账"}</small></div><ChevronRight size={18} /></Card>
      </div>

      <div className="marketGrid">
        <Card className="chartCard">
          <div className="chartHeader">
            <div><h2>市场行情</h2><div className="pairTabs">{pairOptions.map((pair) => <button className={selectedPair === pair ? "active" : ""} key={pair} onClick={() => { setSelectedPair(pair); syncKlines(pair, selectedTimeframe); }}>{pair}</button>)}</div></div>
            <div className="toolButtons"><button title="切换图表模式" aria-label="切换图表模式" onClick={() => setChartMode((current) => current === "candles" ? "line" : "candles")}><LineChart size={15} /> {chartMode === "candles" ? "K线" : "折线"}</button><button className="syncTickerButton" title="同步公开行情" onClick={() => action(`/api/exchange/BINANCE/ticker?symbol=${encodeURIComponent(selectedPair)}`, {}, "GET")}><RefreshCw size={15} /> 同步公开行情</button><button onClick={() => ui.openPanel("marketIndicators")}>指标 <ChevronDown size={14} /></button></div>
          </div>
          <div className="timeTabs">{timeframeOptions.map(([timeframe, label]) => <button className={selectedTimeframe === timeframe ? "active" : ""} key={timeframe} onClick={() => { setSelectedTimeframe(timeframe); syncKlines(selectedPair, timeframe); }}>{label}</button>)}</div>
          <div className="chartLegend">开 {displayMoney(market.candles?.at(-1)?.open)}　高 {displayMoney(market.high24h)}　低 {displayMoney(market.low24h)}　收 {displayMoney(market.price)}　涨幅 <b>{displayPct(market.changePct)}</b></div>
          {chartMode === "candles" ? <CandleChart candles={market.candles} /> : <LinePriceChart candles={market.candles} />}
        </Card>
        <Card className="snapshotCard">
          <SectionTitle title={`市场快照（${selectedPair}）`} />
          <RiskLine label="最新价格" value={market.price ? `${displayMoney(market.price)} USDT` : "未同步"} />
          <RiskLine label="24h 涨跌幅" value={displayPct(market.changePct)} />
          <RiskLine label="24h 最高 / 最低" value={market.high24h || market.low24h ? `${displayMoney(market.high24h)} / ${displayMoney(market.low24h)}` : "未同步"} />
          <RiskLine label="资金费率（8h）" value={market.fundingRate || "未同步"} />
          <RiskLine label="持仓量（OI）" value={market.openInterest ? `${market.openInterest} USDT` : "未同步"} />
          <RiskLine label="24h 成交量" value={market.volume24h ? `${market.volume24h} USDT` : "未同步"} />
          <RiskLine label="波动率（24h）" value="未计算" />
          <footer><StatusBadge>{market.status === "synced" ? "已同步" : "未同步"}</StatusBadge></footer>
        </Card>
      </div>

      <div className="marketTables">
        <Card>
          <SectionTitle title={`持仓（${data.positions?.length || 0}）`} />
          <DataTable columns={[
            { key: "symbol", label: "交易对" }, { key: "direction", label: "方向", width: ".7fr" }, { key: "size", label: "数量" }, { key: "entry", label: "开仓均价" }, { key: "mark", label: "标记价格" }, { key: "pnl", label: "未实现盈亏" }, { key: "action", label: "操作", width: ".6fr" }
          ]} rows={positionRows} />
        </Card>
        <Card>
          <SectionTitle title={`当前委托（${data.orders?.length || 0}）`} />
          <DataTable columns={[
            { key: "time", label: "时间" }, { key: "symbol", label: "交易对" }, { key: "side", label: "方向" }, { key: "type", label: "类型" }, { key: "price", label: "价格" }, { key: "qty", label: "数量" }, { key: "status", label: "状态" }, { key: "action", label: "操作" }
          ]} rows={orderRows} />
        </Card>
      </div>

      <div className="metricGrid four">
        <Card className="accountBox"><h2>账户余额（USDT）</h2><div className="accountNumbers"><span>总资产<b>{displayMoney(data.portfolio.totalEquityUsdt)}</b></span><span>可用保证金<b>{displayMoney(availableMargin)}</b></span><span>估算占用<b>{displayMoney(usedMargin)}</b></span><span>冻结资金<b>{displayMoney(data.portfolio.frozenUsdt)}</b></span></div></Card>
        <Card className="donutCard"><h2>保证金率</h2><div className="donut">{data.portfolio.totalEquityUsdt ? `${formatMoney((usedMargin / Math.max(1, data.portfolio.totalEquityUsdt)) * 100, 1)}%` : "未同步"}</div><small>风险等级：{data.portfolio.riskLabel || "未同步"}</small></Card>
        <Card className="safetyCard"><h2>强平安全</h2><strong>{data.positions?.length ? "需计算" : "暂无持仓"}</strong><ProgressBar value={0} /><div className="scale"><span>同步账户</span><span>计算风险</span><span>监控强平</span></div></Card>
        <Card className="syncCard"><h2>交易所同步状态</h2>{(data.exchangeAccounts || []).map((account) => <RiskLine key={account.id} label={account.exchange} value={exchangeState(account).label} />)}<RiskLine label="已配置账户" value={`${configuredAccounts} / ${totalAccounts}`} /><button className="textButton" onClick={() => ui.setActive("auditSystem")}>查看同步日志 <ChevronRight size={14} /></button></Card>
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
          <div className="dateStrip">{eventRows.map((event, index) => <button className={(selectedEventId ? selectedEventId === event.id : index === 0) ? "active" : ""} key={event.id} onClick={() => { setSelectedEventId(event.id); ui.notify(`已选择事件：${event.title}`); }}><span>{event.due || "待定"}</span><span>{event.category}</span></button>)}</div>
          {!eventRows.length && <div className="emptyPanel emptyPanelAction"><strong>暂无真实事件卡</strong><button className="secondaryButton" onClick={() => action("/api/event-sources/refresh", {})}><RefreshCw size={14} /> 刷新事件源</button></div>}
          <div className="eventRadarInner">
            <div className="eventTimeline">
              {eventRows.map((event, index) => (
                <div className="eventTimelineItem" key={event.id}>
                  <b>{event.due || "待定"}<small>{event.category}</small></b>
                  <span>{event.title}</span>
                  <StatusBadge tone={event.impact >= 80 ? "danger" : "warning"}>{event.impactLabel || "中影响"}</StatusBadge>
                </div>
              ))}
            </div>
            <div className="eventDetail">
              <div className="eventDetailHead"><strong>{primaryEvent.title || "暂无事件"}</strong><StatusBadge tone={primaryEvent.impact >= 80 ? "danger" : "warning"}>{primaryEvent.impactLabel || "待评估"}</StatusBadge><button className="textButton" onClick={() => ui.openPanel("eventSources")}>事件详情 <ChevronRight size={14} /></button></div>
              <div className="countdown eventDue"><b>{primaryEvent.due || "待定"}</b></div>
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
          <SectionTitle icon={GitBranch} title="事件相对任务规则" action={<button className="primaryButton" onClick={() => ui.openPanel("eventRule")}><Plus size={14} /> 新建规则</button>} />
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
  const knowledge = data.knowledge || {};
  const sourceCount = knowledge.sources?.length || 0;
  const conceptCount = knowledge.conceptCards?.length || 0;
  const ruleCount = knowledge.ruleProposals?.length || 0;
  const enabledSkills = (data.skills || []).filter((skill) => skill.status === "已启用").length;
  const importActions = (
    <div className="titleActions">
      <button className="secondaryButton" onClick={() => ui.openPanel("knowledgeImport")}><Plus size={14} /> 导入知识</button>
      <button className="textButton" onClick={() => ui.openPanel("knowledgeList")}>全部知识 <ChevronRight size={14} /></button>
    </div>
  );
  return (
    <div className="pageStack">
      <PageHeader active="knowledgeSkills" />
      <div className="metricGrid four">
        <MetricCard icon={FileText} label="知识来源" value={String(sourceCount)} sub={`${knowledge.chunks?.length || 0} 个片段`} tone="positive" />
        <MetricCard icon={Settings} label="专家规则" value={String(ruleCount)} sub={`${conceptCount} 张概念卡`} tone="positive" />
        <MetricCard icon={Sparkles} label="已启用技能" value={String(enabledSkills)} sub={`共 ${data.skills?.length || 0} 个技能`} tone="positive" />
        <MetricCard icon={RefreshCw} label="同步状态" value={data.eventSources?.length ? "有订阅源" : "未配置"} sub={`${data.eventSources?.length || 0} 个事件源`} />
      </div>

      <div className="knowledgeGrid">
        <Card>
          <SectionTitle title="专家知识库" action={importActions} />
          <div className="knowledgeCategoryList">
            {(knowledge.sources || []).slice(0, 5).map((source) => <button className="knowledgeCategory" key={source.id} onClick={() => ui.openPanel("knowledgeList")}><div><Globe2 size={22} /></div><span><strong>{source.domain || source.type}</strong><small>{source.title}</small></span><b>{humanize(source.status)}</b></button>)}
            {!knowledge.sources?.length && (
              <div className="emptyPanel emptyPanelAction">
                <strong>暂无真实知识来源</strong>
                <span>可以粘贴文本、导入网页链接、上传 PDF/DOCX/MD/TXT，或填写本地文件路径。</span>
                <button className="primaryButton" onClick={() => ui.openPanel("knowledgeImport")}><Plus size={14} /> 导入知识</button>
              </div>
            )}
          </div>
        </Card>
        <Card className="graphCard">
          <SectionTitle title="概念图谱 / 规则库" action={<button className="textButton" onClick={() => ui.openPanel("ruleLibrary")}>全部规则 <ChevronRight size={14} /></button>} />
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
        <Card className="skillCenterCard">
          <SectionTitle title="Skills 中心" action={<button className="textButton" onClick={() => ui.openPanel("skillImport")}>全部技能 <ChevronRight size={14} /></button>} />
          <div className="skillList">
            {(data.skills || []).slice(0, 3).map((skill) => <div key={skill.id}><Sparkles size={18} /><strong>{skill.name}</strong><small>v{skill.version}</small><StatusBadge>{skill.status || "已启用"}</StatusBadge></div>)}
            {!data.skills?.length && (
              <div className="emptyPanel emptyPanelAction">
                <strong>暂无已导入 Skill</strong>
                <span>填写 GitHub 仓库、Skill.md 链接，或直接粘贴 Skill.md 内容后再扫描安装。</span>
                <button className="secondaryButton" onClick={() => ui.openPanel("skillImport")}>导入 Skill</button>
              </div>
            )}
          </div>
          <div className="importButtons"><button onClick={() => ui.openPanel("skillImport")}>从 GitHub 导入</button><button onClick={() => ui.openPanel("skillImport")}>粘贴 Skill.md</button></div>
          <div className="mcpBox">
            <div><strong>MCP 工具</strong><span>{data.mcpServers?.filter((item) => item.status === "connected").length || 0}/{data.mcpServers?.length || 0} 已连接</span></div>
            <div className="mcpChips">{(data.mcpServers || []).slice(0, 3).map((item) => <span key={item.id}>{item.name}<b>{item.status}</b></span>)}</div>
            <RiskLine label="权限与隔离" value="沙箱执行" />
          </div>
        </Card>
      </div>

      <div className="knowledgeBottom">
        <Card>
          <SectionTitle icon={FileText} title="本次决策引用知识" />
          <DataTable columns={[
            { key: "name", label: "知识/规则/技能" }, { key: "type", label: "类型" }, { key: "quote", label: "引用片段", width: "2fr" }, { key: "confidence", label: "置信度" }, { key: "source", label: "来源" }
          ]} rows={(latestAnalysisRows(data) || [])} />
        </Card>
        <Card>
          <SectionTitle icon={RefreshCw} title="最近更新" action={<button className="textButton" onClick={() => ui.setActive("auditSystem")}>全部更新 <ChevronRight size={14} /></button>} />
          <div className="updateList">
            {data.auditLogs?.filter((item) => item.action?.includes("知识") || item.action?.includes("Skill") || item.action?.includes("导入")).slice(0, 5).map((item) => <div key={item.id}><b>{formatTime(item.createdAt)}</b><span>{item.action}</span><StatusBadge>{item.severity}</StatusBadge><small>{item.actor}</small></div>)}
            {!data.auditLogs?.some((item) => item.action?.includes("知识") || item.action?.includes("Skill") || item.action?.includes("导入")) && (
              <div className="emptyPanel emptyPanelAction">
                <strong>暂无真实知识或技能更新</strong>
                <span>完成一次知识或 Skill 导入后，这里会显示审计记录。</span>
                <button className="secondaryButton" onClick={() => ui.openPanel("knowledgeImport")}>导入第一条知识</button>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
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
          <SectionTitle title="授权委托 Mandate" action={<><StatusBadge tone={mandateTone}>{humanize(mandate.status, "未授权")}</StatusBadge><button className="secondaryButton" onClick={() => ui.openPanel("mandate")}>编辑</button></>} />
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
      <div className="securityGrid">
        <Card><SectionTitle title="API 与账户安全" />{(data.exchangeAccounts || []).map((account) => <RiskLine key={account.id} label={account.exchange} value={exchangeState(account).label} />)}<RiskLine label="告警 Webhook" value={data.alerts?.length ? "有告警记录" : "未触发"} /><button className="textButton centered" onClick={() => ui.openPanel("security")}>安全设置 <ChevronRight size={14} /></button></Card>
        <Card><SectionTitle title="IP 白名单" action={<button className="secondaryButton" onClick={() => ui.openPanel("ip")}>管理 IP</button>} />{(data.exchangeAccounts || []).map((account) => <RiskLine key={account.id} label={account.exchange} value={account.ipWhitelist || "未记录"} />)}<button className="textButton centered" onClick={() => ui.openPanel("ip")}>添加 IP <ChevronRight size={14} /></button></Card>
        <Card><SectionTitle title="密钥权限" action={<button className="secondaryButton" onClick={() => ui.openPanel("keys")}>管理密钥</button>} />{(data.apiKeyMetadata || []).map((key) => <RiskLine key={key.id} label={key.exchange} value={key.hasApiKey ? key.hasSecret ? "读写凭证已配置" : "仅 API Key" : "未配置"} />)}<RiskLine label="提现权限" value={(data.apiKeyMetadata || []).some((key) => key.withdrawPermission) ? "危险：发现提现权限" : "禁止"} /></Card>
        <Card><SectionTitle title="授权历史" action={<button className="textButton" onClick={() => ui.setActive("auditSystem")}>查看全部 <ChevronRight size={14} /></button>} /><div className="historyList">{(data.auditLogs || []).filter((item) => item.target?.includes("mandate") || item.action?.includes("授权")).slice(0, 4).map((item) => <div key={item.id}><StatusBadge>{item.severity}</StatusBadge><span>{item.action}</span><small>{item.actor}</small></div>)}</div><button className="textButton centered" onClick={() => ui.download("/api/audit-logs/export?format=csv", "audit-logs.csv")}>导出审计日志 <ChevronRight size={14} /></button></Card>
      </div>
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
          <SectionTitle title="决策与工具调用日志" action={<div className="filterGroup">{traceTypes.map((type) => <button className={traceTypeFilter === type ? "active" : ""} key={type} onClick={() => setTraceTypeFilter(type)}>{humanize(type, type)}</button>)}<button className={traceWindow === "24h" ? "active" : ""} onClick={() => setTraceWindow((current) => current === "24h" ? "all" : "24h")}>{traceWindow === "24h" ? "近 24 小时" : "全部时间"} <ChevronDown size={13} /></button></div>} />
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
