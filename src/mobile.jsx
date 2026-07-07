import React, { useMemo, useState } from "react";
import {
  Activity,
  Bell,
  BookOpen,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Gauge,
  Inbox,
  Info,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  UserCog,
  WalletCards,
  Zap
} from "lucide-react";
import { displayMoney, formatDate, formatDateTime, formatTime, humanize, humanizePhase, ProgressBar, StatusBadge, statusTone, systemStatus } from "./lib.jsx";
import { ChatPage } from "./chat.jsx";
import { AdminPage } from "./pages.jsx";
import { ConfigPanel, SystemConfigPanel, TaskManagerPanel } from "./panels.jsx";

export function KillConfirmDialog({ enable, action, onClose }) {
  const [reason, setReason] = useState("");
  async function confirm() {
    await action("/api/risk/kill-switch", { enabled: enable, reason });
    onClose();
  }
  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="confirmDialog" onClick={(event) => event.stopPropagation()}>
        <strong>{enable ? "确认触发一键熔断？" : "确认解除熔断？"}</strong>
        <p>{enable ? "将立即阻断所有新交易，并请求撤销全部在途委托。" : "解除后系统恢复正常风控运行，重新允许新交易。"}</p>
        {enable && <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="熔断原因（可选，写入审计链）" autoFocus />}
        <div className="confirmActions">
          <button type="button" className="ghostButton" onClick={onClose}>取消</button>
          <button type="button" className={enable ? "confirmDanger" : "primaryButton"} onClick={confirm}>{enable ? "确认熔断" : "确认解除"}</button>
        </div>
      </div>
    </div>
  );
}

export function RailContent({ data, action, ui }) {
  const [releaseConfirm, setReleaseConfirm] = useState(false);
  const [showTaskInfo, setShowTaskInfo] = useState(false);
  const agentStatus = data.agentStatus || {};
  const latestPlan = agentStatus.currentPlan || data.tradePlans?.[0] || {};
  const latestAnalysis = agentStatus.latestAnalysis || data.analysisBundles?.[0] || {};
  const latestRisk = latestPlan.lastRiskCheck || data.riskChecks?.[0] || {};
  const riskWall = agentStatus.riskWall || {};
  const mandate = data.mandates?.find((item) => ["active", "running"].includes(item.status));
  const positions = data.positions || [];
  const orders = data.orders || data.executionOrders || [];
  const timeline = buildAgentTimeline(data);
  const budget = data.system?.remainingDailyLossUsdt;
  const avgExpertConfidence = latestAnalysis.expertViews?.length
    ? latestAnalysis.expertViews.reduce((sum, view) => sum + Number(view.confidence || 0), 0) / latestAnalysis.expertViews.length
    : null;
  const beforeConfidence = latestPlan.confidenceBefore ?? latestPlan.confidence_before ?? null;
  const afterConfidence = latestPlan.confidenceAfter ?? latestPlan.confidence_after ?? avgExpertConfidence;
  const confidenceText = beforeConfidence !== null || afterConfidence !== null
    ? `${beforeConfidence !== null ? `${Math.round(Number(beforeConfidence) * 100)}%` : "未记录"} → ${afterConfidence !== null ? `${Math.round(Number(afterConfidence) * 100)}%` : "未记录"}`
    : "未记录";
  const displayGoal = cleanAgentText(agentStatus.currentGoal, "观察模式巡检");
  const displayStateLabel = isConfigNoise({ title: agentStatus.currentGoal, status: agentStatus.state })
    ? "观察中"
    : (agentStatus.stateLabel || humanize(agentStatus.state, "待配置"));
  const decisionSummary = cleanAgentText(latestAnalysis.summary || latestPlan.rationale || agentStatus.currentObservation, "暂无可执行交易计划，继续观察公开行情与系统状态。");
  const citationCount = (latestAnalysis.citations || []).length;
  const memoryCount = (data.memoryItems || []).length;
  const gateBlocked = latestRisk.decision === "blocked" || riskWall.allowOpen === false || data.system?.killSwitch;
  const gateTone = gateBlocked ? "danger" : riskWall.allowOpen ? "ok" : "warning";
  const gateLabel = cleanAgentText(data.system?.killSwitch ? "熔断中" : latestRisk.summary || (riskWall.allowOpen ? "允许开仓" : "观察中"), "观察中");
  const nextAction = agentStatus.nextActions?.[0] || data.system?.latestAction || "等待下一轮巡检";
  const accountConstraint = positions.length
    ? `${positions.length} 个持仓会影响下一步判断`
    : orders.length
      ? `${orders.length} 个委托需要避让`
      : "暂无持仓/委托冲突";
  // 把"Agent 动作 + 事件"合并成一条按时间倒序的统一动态流，取代原来重叠的三块。
  const feed = [
    ...timeline.slice(0, 6).map((t) => ({ id: `a_${t.id}`, kind: "Agent", text: cleanAgentText(t.title, "-"), time: t.createdAt, cls: "act" })),
    ...(data.events || []).slice(0, 5).map((e) => ({ id: `e_${e.id}`, kind: "事件", text: String(e.shortTitle || e.title || "-"), time: (e.due && e.due !== "即时" && e.due !== "新近") ? e.due : e.createdAt, cls: e.impact >= 80 ? "danger" : e.impact >= 50 ? "warn" : "ev" }))
  ].sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0))
    .filter((item, index, arr) => arr.findIndex((x) => x.kind === item.kind && x.text === item.text) === index)
    .slice(0, 7);

  return (
    <>
      {/* 1. 状态：现在是什么状态 */}
      <div className="railBlock railStatusHead">
        <div className="railStatusTop">
          <span className="railLabel">AI 交易员</span>
          <StatusBadge tone={statusTone(agentStatus.state || data.system?.apiHealth)}>{displayStateLabel}</StatusBadge>
        </div>
        <strong className="railGoal">{displayGoal}</strong>
        <small className="railMandate">{mandate ? `授权：${mandate.name || mandate.id}` : "未授权 · 只读观察"}</small>
      </div>

      {/* 2. 能否交易：最重要的风控闸门 */}
      <div className="railBlock">
        <span className="railLabel">能否交易</span>
        <div className={`gateBanner ${gateTone}`}>
          <strong>{data.system?.killSwitch ? "熔断中" : (riskWall.allowOpen ? "允许开仓" : "禁止开仓")}</strong>
          <small>{cleanAgentText(latestRisk.blockers?.[0]?.detail || agentStatus.reasonNotTrading || gateLabel, "等待下一次风控校验。")}</small>
        </div>
        <div className="railGateGrid">
          <span>减仓<b>{riskWall.allowReduceOnly ? "允许" : "待授权"}</b></span>
          <span>日亏损预算<b>{budget === null || budget === undefined ? "未授权" : displayMoney(budget)}</b></span>
          <span>人工确认<b>{mandate ? "按阈值" : "需授权"}</b></span>
          <span>持仓/委托<b>{positions.length} / {orders.length}</b></span>
        </div>
      </div>

      {/* 3. 最近动态：Agent 动作 + 事件 合并时间线 */}
      <div className="railBlock">
        <div className="railStatusTop">
          <span className="railLabel">最近动态</span>
          <button className="textButton" onClick={() => action("/api/event-sources/refresh", {})}>刷新</button>
        </div>
        {!feed.length && <span className="railSub">暂无动态</span>}
        {feed.map((item) => (
          <div className="railFeedItem" key={item.id}>
            <span className={`railFeedTag ${item.cls}`}>{item.kind}</span>
            <b title={item.text}>{String(item.text).slice(0, 34)}</b>
            <time>{item.time ? formatTime(item.time) : ""}</time>
          </div>
        ))}
        <button className="textButton" onClick={() => ui.setActive("review")}>进入复盘 <ChevronRight size={13} /></button>
      </div>

      {/* 4. 快捷操作 */}
      <div className="railBlock railActions">
        <button onClick={() => action("/api/system/autonomy", { enabled: !data.system.autonomyEnabled })}>
          {data.system.autonomyEnabled ? "暂停自主推进" : "恢复自主推进"}
        </button>
        {data.system.killSwitch && <button className="danger" onClick={() => setReleaseConfirm(true)}>解除熔断</button>}
      </div>
      {releaseConfirm && <KillConfirmDialog enable={false} action={action} onClose={() => setReleaseConfirm(false)} />}
    </>
  );
}

export function RightRail(props) {
  return (
    <aside className="rightRail">
      <RailContent {...props} />
    </aside>
  );
}

const mobileTabs = [
  { id: "home", label: "总览", icon: Gauge },
  { id: "chat", label: "对话", icon: MessageSquare },
  { id: "feed", label: "动态", icon: Bell },
  { id: "manage", label: "管理", icon: SlidersHorizontal }
];

const manageGroups = [
  {
    title: "交易",
    items: [
      { id: "positions", label: "持仓与订单", icon: WalletCards },
      { id: "review", label: "复盘与绩效", icon: ClipboardList }
    ]
  },
  {
    title: "Agent",
    items: [
      { id: "knowledgeSkills", label: "知识与技能", icon: BookOpen },
      { id: "eventsTasks", label: "任务与事件", icon: CalendarClock },
      { id: "riskAuth", label: "风控与授权", icon: Shield }
    ]
  },
  {
    title: "系统",
    items: [
      { id: "systemSettings", label: "系统设置", icon: Settings },
      { id: "admin", label: "Admin 控制台", icon: UserCog }
    ]
  }
];

const settingsSections = [
  { id: "llm", label: "模型" },
  { id: "exchange", label: "交易所" },
  { id: "live", label: "实盘灰度" },
  { id: "integrations", label: "外部服务" },
  { id: "runtime", label: "运行参数" }
];

const manageLabels = {
  ...Object.fromEntries(manageGroups.flatMap((group) => group.items.map((item) => [item.id, item.label]))),
  marketAccount: "账户健康与对账",
  auditSystem: "审计链",
  ...Object.fromEntries(settingsSections.map((item) => [`settings:${item.id}`, item.label]))
};

function isConfigNoise(item = {}) {
  const text = `${item.phase || ""} ${item.title || ""} ${item.summary || ""} ${item.status || ""}`.toLowerCase();
  return /交易所\s*api|api key\/secret|missing_credentials|setup_required|等待配置交易所|配置交易所/.test(text);
}

function cleanAgentText(value, fallback) {
  return isConfigNoise({ title: value }) ? fallback : (value || fallback);
}

function isNormalActionStatus(value) {
  const status = String(value || "").toLowerCase();
  return !status || ["ok", "running", "completed", "success"].includes(status);
}

function agentActionLabel(item = {}) {
  if (item.createdAt) return formatTime(item.createdAt);
  return humanizePhase(item.phase || item.type || item.status, humanize(item.phase || item.type || item.status, "步骤"));
}

function AgentActionStatus({ status }) {
  if (isNormalActionStatus(status)) return null;
  return <StatusBadge tone={statusTone(status)}>{humanize(status)}</StatusBadge>;
}

function buildAgentTimeline(data, limit = 4) {
  return (data.agentRuns || [])
    .filter((run) => run.source !== "chat" || run.tradePlanId || run.mandateId || (run.steps || []).length > 0)
    .slice(0, limit)
    .map((run) => ({
      id: run.id,
      phase: run.role || "agent_run",
      title: run.tradePlanId ? "生成交易计划" : run.mandateId ? "生成授权草案" : run.goal,
      status: run.status,
      createdAt: run.createdAt
    }))
    .filter((item) => !isConfigNoise(item));
}

function MobileHome({ data, action, ui, onOpenRail }) {
  const [showAgentInfo, setShowAgentInfo] = useState(false);
  const accounts = data.exchangeAccounts || [];
  const configuredAccounts = accounts.filter((account) => account.readEnabled).length;
  const portfolio = data.portfolio || {};
  const awaitingPlans = (data.tradePlans || []).filter((plan) => plan.status === "awaiting_approval").slice(0, 2);
  const pendingMandates = (data.mandates || []).filter((mandate) => mandate.status === "pending_confirmation").slice(0, 1);
  const openIncidents = (data.riskIncidents || []).filter((incident) => incident.status === "open");
  const inboxCount = awaitingPlans.length + pendingMandates.length;
  const positions = data.positions || [];
  const orders = (data.orders || data.executionOrders || []).filter((order) => !["closed", "canceled", "cancelled", "filled_closed"].includes(String(order.status || "").toLowerCase()));
  const budget = data.system?.remainingDailyLossUsdt;
  const agentStatus = data.agentStatus || {};
  const displayGoal = cleanAgentText(agentStatus.currentGoal, "观察模式巡检");
  const displayStateLabel = isConfigNoise({ title: agentStatus.currentGoal, status: agentStatus.state })
    ? "观察中"
    : (agentStatus.stateLabel || humanize(agentStatus.state, "待配置"));
  const todayPnl = Number(portfolio.todayPnl || 0);
  return (
    <div className="mHome">
      <section className="mEquity">
        <span>总资产（USDT）</span>
        <strong>{configuredAccounts ? displayMoney(portfolio.totalEquityUsdt) : "未同步"}</strong>
        <small className={configuredAccounts ? (todayPnl >= 0 ? "positive" : "negative") : ""}>
          {configuredAccounts ? `今日 ${todayPnl >= 0 ? "+" : ""}${displayMoney(portfolio.todayPnl, 2, "0.00")} USDT` : "连接交易所后同步真实资产"}
        </small>
      </section>

      <section className={`mInbox ${inboxCount ? "" : "empty"}`}>
        <header><Inbox size={14} /> 需要你处理{inboxCount ? ` · ${inboxCount}` : ""}</header>
        {!inboxCount && <p className="mInboxEmpty">暂无等待你的审批或确认事项</p>}
        {awaitingPlans.map((plan) => (
          <div className="mInboxItem" key={plan.id}>
            <strong>{plan.direction === "short" ? "做空" : "做多"} {plan.symbol || "计划"}</strong>
            <small>{plan.rationale ? String(plan.rationale).slice(0, 42) : "等待你批准后进入执行引擎"}</small>
            <div className="mInboxActions">
              <button className="approve" onClick={() => action(`/api/trade-plans/${plan.id}/approve`, {})}>批准</button>
              <button onClick={() => action(`/api/trade-plans/${plan.id}/cancel`, { reason: "user_rejected" })}>驳回</button>
            </div>
          </div>
        ))}
        {pendingMandates.map((mandate) => (
          <div className="mInboxItem" key={mandate.id}>
            <strong>激活授权委托</strong>
            <small>{mandate.goal || mandate.name || "确认后 Agent 才能提出可执行计划"}</small>
            <div className="mInboxActions">
              <button className="approve" onClick={() => action(`/api/mandates/${mandate.id}/activate`, {})}>确认激活</button>
            </div>
          </div>
        ))}
        {openIncidents.length > 0 && (
          <button className="mIncidentLine" onClick={() => ui.setActive("auditSystem")}>
            {openIncidents.length} 个未关闭风险事件 <ChevronRight size={13} />
          </button>
        )}
      </section>

      <section className="mQuickGrid">
        <button onClick={() => ui.setActive("positions")}><span>持仓</span><strong>{positions.length}</strong></button>
        <button onClick={() => ui.setActive("positions")}><span>在途委托</span><strong>{orders.length}</strong></button>
        <button onClick={() => ui.setActive("riskAuth")}><span>日亏预算</span><strong>{budget === null || budget === undefined ? "未授权" : displayMoney(budget, 0)}</strong></button>
      </section>

      <section className="mAgentCard" onClick={onOpenRail} role="button" tabIndex={0}>
        <header>
          <span>Agent 当前任务</span>
          <StatusBadge tone={statusTone(agentStatus.state || data.system?.apiHealth)}>{displayStateLabel}</StatusBadge>
        </header>
        <strong>{displayGoal}</strong>
      </section>

    </div>
  );
}

const feedFilters = ["全部", "通知", "审计", "任务"];

function MobileFeed({ data }) {
  const [filter, setFilter] = useState("全部");
  const items = useMemo(() => {
    const merged = [
      ...(data.notifications || []).map((item) => ({ id: `n:${item.id}`, kind: "通知", time: item.createdAt, title: item.title || item.body || item.message || "通知", tone: item.severity || (item.read ? "ok" : "info") })),
      ...(data.auditLogs || []).map((item) => ({ id: `a:${item.id}`, kind: "审计", time: item.createdAt, title: item.action, tone: item.severity })),
      ...(data.jobRuns || []).map((item) => ({ id: `j:${item.id}`, kind: "任务", time: item.createdAt, title: `${item.taskName || "任务"} · ${String(item.output || item.status || "").slice(0, 40)}`, tone: item.status }))
    ];
    return merged
      .filter((item) => item.time)
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .slice(0, 80);
  }, [data]);
  const visible = filter === "全部" ? items : items.filter((item) => item.kind === filter);
  return (
    <div className="mFeed">
      <div className="mChips">
        {feedFilters.map((name) => (
          <button key={name} className={filter === name ? "active" : ""} onClick={() => setFilter(name)}>{name}</button>
        ))}
      </div>
      {!visible.length && <p className="mInboxEmpty">这里会汇总通知、审计与任务运行记录</p>}
      {visible.map((item) => (
        <div className="mFeedRow card" key={item.id}>
          <span>{formatTime(item.time)}<i>{item.kind}</i></span>
          <b>{item.title}</b>
          <StatusBadge tone={statusTone(item.tone)}>{humanize(item.tone || "ok")}</StatusBadge>
        </div>
      ))}
    </div>
  );
}

const positionSegments = ["持仓", "在途委托", "执行单"];

function MobilePositions({ data, action, ui }) {
  const [segment, setSegment] = useState("持仓");
  const positions = data.positions || [];
  const orders = data.orders || [];
  const executions = data.executionOrders || [];
  const reduceOnly = Boolean(data.system?.reduceOnlyMode);
  const activeExec = ["entry_submitted", "entry_filled", "protecting", "open"];
  const activeExecutions = executions.filter((order) => activeExec.includes(String(order.status || "").toLowerCase())).length;
  const portfolio = data.portfolio || {};
  const configured = (data.exchangeAccounts || []).some((account) => account.readEnabled);
  const exposure = positions.reduce((sum, position) => sum + Math.abs(Number(position.size || 0) * Number(position.mark || position.entry || 0)), 0);
  const totalPnl = positions.reduce((sum, position) => sum + Number(position.pnl || 0), 0);
  const equity = Number(portfolio.totalEquityUsdt || 0);
  const availableMargin = portfolio.availableMarginUsdt ?? portfolio.availableMargin;
  const marginRate = configured && equity > 0 && availableMargin !== undefined && availableMargin !== null
    ? ((equity - Number(availableMargin)) / equity) * 100
    : null;
  return (
    <div className="mPositions">
      <div className="mPageStats">
        <div><span>总敞口</span><strong>{configured ? displayMoney(exposure, 0) : "未同步"}</strong></div>
        <div><span>未实现盈亏</span><strong className={totalPnl >= 0 ? "positive" : "negative"}>{configured ? `${totalPnl >= 0 ? "+" : ""}${displayMoney(totalPnl)}` : "未同步"}</strong></div>
        <div><span>保证金率</span><strong>{marginRate === null ? "未同步" : `${marginRate.toFixed(1)}%`}</strong></div>
      </div>
      <div className="mMiniStats">
        <div><span>持仓数</span><strong>{positions.length}</strong></div>
        <div><span>在途委托</span><strong>{orders.length}</strong></div>
        <div><span>活跃执行</span><strong>{activeExecutions}</strong></div>
        <div><span>可用保证金</span><strong>{configured ? displayMoney(availableMargin, 0) : "未同步"}</strong></div>
      </div>
      <div className="mChips">
        {positionSegments.map((name) => (
          <button key={name} className={segment === name ? "active" : ""} onClick={() => setSegment(name)}>{name}</button>
        ))}
      </div>

      {segment === "持仓" && (
        <>
          {!positions.length && <p className="mInboxEmpty">暂无真实持仓。配置只读 API 并完成同步后展示。</p>}
          {positions.map((position) => {
            const pnl = Number(position.pnl || 0);
            return (
              <div className="mPosCard" key={position.id || position.symbol}>
                <header>
                  <strong>{position.symbol}</strong>
                  <StatusBadge tone={position.direction === "short" ? "danger" : "ok"}>{position.direction === "short" ? "空" : "多"}</StatusBadge>
                </header>
                <div className={`mPosPnl ${pnl >= 0 ? "positive" : "negative"}`}>{pnl >= 0 ? "+" : ""}{displayMoney(position.pnl, 2, "--")} <small>未实现盈亏</small></div>
                <div className="mPosMeta">
                  <span>数量<b>{position.size ?? "-"}</b></span>
                  <span>开仓均价<b>{position.entry ? displayMoney(position.entry) : "-"}</b></span>
                  <span>标记价格<b>{position.mark ? displayMoney(position.mark) : "-"}</b></span>
                </div>
              </div>
            );
          })}
        </>
      )}

      {segment === "在途委托" && (
        <>
          {!orders.length && <p className="mInboxEmpty">暂无在途委托。</p>}
          {orders.map((order) => (
            <div className="mPosCard" key={order.id}>
              <header>
                <strong>{order.symbol || order.id}</strong>
                <StatusBadge tone={statusTone(order.status)}>{humanize(order.status)}</StatusBadge>
              </header>
              <div className="mPosMeta">
                <span>方向<b>{order.side || order.direction || "-"}</b></span>
                <span>价格<b>{order.price ? displayMoney(order.price) : "市价"}</b></span>
                <span>数量<b>{order.quantity ?? order.size ?? "-"}</b></span>
              </div>
            </div>
          ))}
        </>
      )}

      {segment === "执行单" && (
        <>
          {!executions.length && <p className="mInboxEmpty">暂无执行单。批准交易计划后由执行引擎生成。</p>}
          {executions.map((order) => (
            <div className="mPosCard" key={order.id}>
              <header>
                <strong>{order.symbol || order.id}</strong>
                <StatusBadge tone={statusTone(order.status)}>{humanize(order.status)}</StatusBadge>
              </header>
              <div className="mPosMeta">
                <span>方向<b>{order.direction || "-"}</b></span>
                <span>入场<b>{order.entryPrice ? displayMoney(order.entryPrice) : "-"}</b></span>
                <span>止损<b>{order.stopLoss ? displayMoney(order.stopLoss) : "-"}</b></span>
              </div>
              {activeExec.includes(String(order.status || "").toLowerCase()) && (
                <div className="mInboxActions">
                  <button onClick={() => action(`/api/execution-orders/${order.id}/close`, { reason: "manual_mobile" })}>市价平仓</button>
                </div>
              )}
            </div>
          ))}
        </>
      )}

      <button className={`mToggleRow ${reduceOnly ? "on" : ""}`} onClick={() => action("/api/risk/reduce-only", { enabled: !reduceOnly })}>
        <span>
          <strong>只减仓模式</strong>
          <small>{reduceOnly ? "已开启：禁止新开仓，仅允许减仓" : "关闭中：开启后 Agent 只能减仓"}</small>
        </span>
        <i className={reduceOnly ? "on" : ""} />
      </button>

      <div className="mList">
        <button onClick={() => ui.setActive("marketAccount")}>
          <Activity size={17} />
          <span>账户健康与对账</span>
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

function MobileSettingsIndex({ data, onOpen }) {
  const config = data.config || {};
  const exchange = config.exchange || {};
  const integrations = config.integrations || {};
  const live = config.liveTrading || {};
  const runtime = config.runtime || {};
  const subs = {
    llm: config.llm?.activeProvider ? humanize(config.llm.activeProvider, config.llm.activeProvider) : "未配置",
    exchange: [exchange.binance?.hasKey && "Binance", exchange.okx?.hasKey && "OKX"].filter(Boolean).join("、") || "未配置",
    live: live.effective ? "已开启" : "关闭",
    integrations: integrations.telegram?.configured ? "TG 已接入" : integrations.lark?.hasWebhook ? "飞书已接入" : "未配置",
    runtime: runtime.authRequired === false ? "免登录" : "鉴权开启"
  };
  return (
    <div className="mManage">
      <div className="mList">
        {settingsSections.map((item) => (
          <button key={item.id} onClick={() => onOpen(`settings:${item.id}`)}>
            <span>{item.label}</span>
            <small className="mListSub">{subs[item.id]}</small>
            <ChevronRight size={15} />
          </button>
        ))}
      </div>
      <p className="mManageNote">每项单独一页，改完即存。</p>
    </div>
  );
}

function MobileReview({ data, ui }) {
  const [showLeads, setShowLeads] = useState(false);
  const performance = data.performance || {};
  const riskChecks = data.riskChecks || [];
  const blocked = riskChecks.filter((item) => ["blocked", "rejected", "risk_rejected"].includes(String(item.decision || item.result || item.status || "").toLowerCase())).length;
  const failedRuns = (data.agentRuns || []).filter((run) => ["failed", "error"].includes(String(run.status || "").toLowerCase())).length;
  const plans = (data.tradePlans || []).slice(0, 10);
  const orders = data.executionOrders || data.orders || [];
  const skillRuns = data.skillRuns || [];
  const cost = data.reviewAnalytics?.cost || {};
  const leads = [
    blocked ? `近期 ${blocked} 次风控阻断，优先复盘入场、止损和授权边界。` : "近期没有明显风控阻断。",
    failedRuns ? `${failedRuns} 次 Agent 运行失败，检查模型与工具调用。` : "Agent 运行链路暂无失败集中点。",
    performance.trades ? `胜率 ${performance.winRatePct}%、盈亏比 ${performance.profitFactor ?? "未计算"}，可按策略拆分表现。` : "交易样本不足，先建立最小交易闭环。"
  ];
  return (
    <div className="mSubPage">
      <div className="mPageStats">
        <div><span>胜率</span><strong>{performance.trades ? `${performance.winRatePct}%` : "无样本"}</strong></div>
        <div><span>盈亏比</span><strong>{performance.profitFactor ?? "未计算"}</strong></div>
        <div><span>风控拦截</span><strong className={blocked ? "warning" : ""}>{blocked} 次</strong></div>
      </div>
      <div className="mMiniStats">
        <div><span>已平仓</span><strong>{performance.trades || 0}</strong></div>
        <div><span>Agent 失败</span><strong className={failedRuns ? "warning" : ""}>{failedRuns}</strong></div>
        <div><span>Skill 运行</span><strong>{skillRuns.length}</strong></div>
        <div><span>手续费</span><strong>{cost.totalFeesUsdt === null || cost.totalFeesUsdt === undefined ? "未记录" : `${displayMoney(cost.totalFeesUsdt, 1)}U`}</strong></div>
      </div>

      <div className="mSectionCard">
        <header><span>交易复盘（{performance.trades || 0} 笔已平仓）</span></header>
        {!plans.length && <p className="mInboxEmpty">暂无交易计划记录。批准计划后这里会形成复盘流。</p>}
        {plans.map((plan) => {
          const order = orders.find((item) => item.planId === plan.id || item.id === plan.executionOrderId) || {};
          return (
            <button className="mRowItem" key={plan.id} onClick={() => ui.openPanel("executionDetail")}>
              <span>{formatTime(plan.createdAt)}</span>
              <b>{plan.symbol || order.symbol || "-"} · {plan.direction === "short" ? "做空" : "做多"}</b>
              <StatusBadge tone={statusTone(order.status || plan.status)}>{humanize(order.status || plan.status, "未执行")}</StatusBadge>
            </button>
          );
        })}
      </div>

      <button className="mToggleRow" onClick={() => setShowLeads((current) => !current)}>
        <span><strong>优化线索</strong><small>{showLeads ? "收起" : `${leads.length} 条可执行改进`}</small></span>
        <ChevronDown size={16} style={{ transform: showLeads ? "rotate(180deg)" : "none" }} />
      </button>
      {showLeads && (
        <div className="mSectionCard">
          {leads.map((lead, index) => <p className="mLeadLine" key={index}>{index + 1}. {lead}</p>)}
        </div>
      )}
    </div>
  );
}

function MobileRisk({ data, action, ui }) {
  const mandate = data.agentStatus?.activeMandate || data.mandates?.[0] || {};
  const rules = data.riskRules || [];
  const mandateTone = ["running", "active"].includes(mandate.status) ? "ok" : statusTone(mandate.status);
  const maxLeverage = mandate.max_leverage || (mandate.maxLeverageBySymbol ? Math.max(1, ...Object.values(mandate.maxLeverageBySymbol)) : null);
  const approvalThreshold = mandate.humanApprovalNotionalUsdt || mandate.manual_approval_threshold_usdt;
  const validUntil = mandate.validUntil || mandate.valid_until;
  return (
    <div className="mSubPage">
      <div className="mPageStats">
        <div><span>单日亏损上限</span><strong>{mandate.maxDailyLossPct ? `${mandate.maxDailyLossPct}%` : "未授权"}</strong></div>
        <div><span>最大杠杆</span><strong>{maxLeverage ? `${maxLeverage}x` : "未授权"}</strong></div>
        <div><span>审批阈值</span><strong>{mandate.id && approvalThreshold !== undefined ? `${displayMoney(approvalThreshold, 0)}U` : "未授权"}</strong></div>
      </div>

      <div className="mSectionCard">
        <header>
          <span>授权委托</span>
          <StatusBadge tone={mandateTone}>{humanize(mandate.status, "未授权")}</StatusBadge>
        </header>
        <div className="mKvRows">
          <span>交易所<b>{(mandate.exchanges || []).join("、") || "未授权"}</b></span>
          <span>交易对白名单<b>{(mandate.allowedSymbols || []).join("、") || "未授权"}</b></span>
          <span>有效期<b>{validUntil ? `截至 ${formatDateTime(validUntil)}` : "未记录"}</b></span>
        </div>
        <div className="mInboxActions">
          <button onClick={() => ui.openPanel("mandate")}>编辑授权</button>
        </div>
      </div>

      <div className="mSectionCard">
        <header><span>风控规则（{rules.length}）</span></header>
        {!rules.length && <p className="mInboxEmpty">暂无风控规则。</p>}
        {rules.slice(0, 12).map((rule) => (
          <div className="mRuleRow" key={rule.id}>
            <span>
              <b>{rule.name}</b>
              <small>{rule.level || "L2"} · {humanize(rule.action, "notify")}{rule.condition ? ` · ${rule.condition}` : ""}</small>
            </span>
            <button
              className={`mMiniToggle ${rule.enabled === false ? "" : "on"}`}
              aria-label={rule.enabled === false ? "启用规则" : "停用规则"}
              onClick={() => action(`/api/risk/rules/${rule.id}`, { enabled: rule.enabled === false }, "PATCH")}
            ><i /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function MobileKnowledge({ data, action, ui }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState(null);
  const knowledge = data.knowledge || {};
  const sources = knowledge.sources || [];
  async function search() {
    if (!query.trim()) return;
    const result = await action("/api/knowledge/rag-query", { query: query.trim(), topK: 5 });
    setHits(result.hits || result.results || result.chunks || []);
  }
  return (
    <div className="mSubPage">
      <div className="mPageStats">
        <div><span>知识来源</span><strong>{sources.length}</strong></div>
        <div><span>概念卡</span><strong>{knowledge.conceptCards?.length || 0}</strong></div>
        <div><span>专家规则</span><strong>{knowledge.ruleProposals?.length || 0}</strong></div>
      </div>

      <div className="mSearchBar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="检索知识库，如：CPI 前如何控仓" onKeyDown={(event) => { if (event.key === "Enter") search(); }} />
        <button onClick={search} aria-label="检索"><Search size={16} /></button>
      </div>
      {hits !== null && (
        <div className="mSectionCard">
          <header><span>检索结果（{hits.length}）</span></header>
          {!hits.length && <p className="mInboxEmpty">没有命中的知识片段。</p>}
          {hits.slice(0, 5).map((hit, index) => (
            <p className="mLeadLine" key={index}>{String(hit.text || hit.content || hit.chunk || "").slice(0, 120)}</p>
          ))}
        </div>
      )}

      <div className="mSectionCard">
        <header>
          <span>知识来源</span>
          <button className="textButton" onClick={() => ui.openPanel("knowledgeList")}>全部 <ChevronRight size={12} /></button>
        </header>
        {!sources.length && <p className="mInboxEmpty">还没有导入知识。</p>}
        {sources.slice(0, 8).map((source) => (
          <div className="mRowItem" key={source.id || source.title}>
            <b>{source.title || source.name || "未命名"}</b>
            <StatusBadge tone={statusTone(source.status)}>{humanize(source.status, "已导入")}</StatusBadge>
          </div>
        ))}
      </div>

      <button className="mPrimaryAction" onClick={() => ui.openPanel("knowledgeImport")}><Plus size={15} /> 导入知识</button>
    </div>
  );
}

const taskSegments = ["重要事件", "定时任务", "创建任务"];

function MobileTasks({ data, action }) {
  const [segment, setSegment] = useState("重要事件");
  const events = (data.events || []).slice(0, 10);
  const tasks = data.tasks || [];
  const activeTasks = tasks.filter((task) => task.enabled !== false);
  const todayEvents = (data.events || []).filter((event) => {
    if (!event.due) return false;
    return new Date(event.due).toDateString() === new Date().toDateString();
  });
  return (
    <div className="mSubPage">
      <div className="mPageStats">
        <div><span>今日事件</span><strong>{todayEvents.length}</strong></div>
        <div><span>活跃任务</span><strong>{activeTasks.length}</strong></div>
        <div><span>事件规则</span><strong>{(data.riskRules || []).filter((rule) => rule.scope === "event").length}</strong></div>
      </div>

      <div className="mChips">
        {taskSegments.map((name) => (
          <button key={name} className={segment === name ? "active" : ""} onClick={() => setSegment(name)}>{name}</button>
        ))}
      </div>

      {segment === "重要事件" && (
        <div className="mSectionCard">
          <header>
            <span>重要事件</span>
            <button className="textButton" onClick={() => action("/api/event-sources/refresh", {})}><RefreshCw size={12} /> 刷新</button>
          </header>
          {!events.length && <p className="mInboxEmpty">暂无事件。点击刷新拉取事件源。</p>}
          {events.map((event) => (
            <div className="mRowItem" key={event.id} title={event.rawTitle || event.title}>
              <span>{formatDateTime(event.due, "待定")}</span>
              <b>{event.shortTitle || event.title}</b>
              <StatusBadge tone={event.impact >= 80 ? "danger" : event.impact >= 50 ? "warning" : "neutral"}>{event.impactLabel || "待评估"}</StatusBadge>
            </div>
          ))}
        </div>
      )}

      {segment === "定时任务" && (
        <div className="mSectionCard">
          <header><span>定时任务（{tasks.length}）</span></header>
          {!tasks.length && <p className="mInboxEmpty">暂无定时任务。</p>}
          {tasks.map((task) => (
            <div className="mRuleRow" key={task.id}>
              <span>
                <b>{task.name}</b>
                <small>{task.schedule || "Every 1h"} · {humanize(task.status || "running")}</small>
              </span>
              <div className="mRowActions">
                <button onClick={() => action(`/api/tasks/${task.id}/run`, {})}>运行</button>
                <button onClick={() => action(`/api/tasks/${task.id}/${task.enabled === false ? "resume" : "pause"}`, task.enabled === false ? {} : { reason: "manual_ui" })}>{task.enabled === false ? "恢复" : "暂停"}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {segment === "创建任务" && (
        <div className="mSectionCard">
          <TaskManagerPanel data={data} action={action} />
        </div>
      )}
    </div>
  );
}

function MobileAccountHealth({ data, action }) {
  const latestReconcile = data.reconciliationReports?.[0];
  const latestSnapshot = data.accountSnapshots?.[0];
  const configuredAccounts = (data.exchangeAccounts || []).filter((account) => account.readEnabled).length;
  const totalAccounts = data.exchangeAccounts?.length || 0;
  const openExecutions = (data.executionOrders || []).filter((item) => !["filled", "closed", "cancelled", "rejected"].includes(String(item.status || "").toLowerCase())).length;
  const blockedChecks = (data.riskChecks || []).filter((item) => ["blocked", "rejected", "risk_rejected"].includes(String(item.decision || item.result || item.status || "").toLowerCase())).length;
  const rows = [
    ["交易所账户", `${configuredAccounts} / ${totalAccounts}`, configuredAccounts ? "ok" : "neutral"],
    ["私有账户快照", latestSnapshot ? formatDateTime(latestSnapshot.createdAt) : "未同步", latestSnapshot ? "ok" : "neutral"],
    ["对账状态", configuredAccounts ? humanize(latestReconcile?.status, "未对账") : "待配置", latestReconcile?.status === "ok" ? "ok" : "neutral"],
    ["实盘写入", data.system?.liveTradingEnabled ? "开启" : "关闭", data.system?.liveTradingEnabled ? "danger" : "neutral"],
    ["在途执行", `${openExecutions} 个`, openExecutions ? "warning" : "ok"],
    ["近期风控阻断", `${blockedChecks} 次`, blockedChecks ? "warning" : "ok"]
  ];
  return (
    <div className="mSubPage">
      <div className="mPageStats">
        <div><span>账户</span><strong>{configuredAccounts}/{totalAccounts}</strong></div>
        <div><span>快照</span><strong>{latestSnapshot ? formatTime(latestSnapshot.createdAt) : "未同步"}</strong></div>
        <div><span>对账</span><strong>{configuredAccounts ? humanize(latestReconcile?.status, "未对账") : "待配置"}</strong></div>
      </div>

      <div className="mSectionCard">
        <header><span>健康检查</span></header>
        {rows.map(([label, value, tone]) => (
          <div className="mRowItem" key={label}>
            <b>{label}</b>
            <em className="mRowValue">{value}</em>
            <StatusBadge tone={tone}>{tone === "ok" ? "正常" : tone === "danger" ? "注意" : tone === "warning" ? "待处理" : "待配置"}</StatusBadge>
          </div>
        ))}
      </div>

      <button className="mPrimaryAction" onClick={() => action("/api/reconciler/run", { mode: "manual_ui" })}><RefreshCw size={15} /> 手动对账</button>
    </div>
  );
}

function MobileManage({ onOpen, data }) {
  const accounts = data.exchangeAccounts || [];
  const configured = accounts.filter((account) => account.readEnabled).length;
  const activeMandate = (data.mandates || []).some((mandate) => ["active", "running"].includes(mandate.status));
  const positions = (data.positions || []).length;
  const badges = {
    positions: positions ? { tone: "ok", label: `${positions} 持仓` } : null,
    riskAuth: activeMandate ? { tone: "ok", label: "授权中" } : { tone: "neutral", label: "待授权" },
    systemSettings: configured ? null : { tone: "neutral", label: "待配置" }
  };
  return (
    <div className="mManage">
      {manageGroups.map((group) => (
        <div key={group.title}>
          <p className="mGroupTitle">{group.title}</p>
          <div className="mList">
            {group.items.map((item) => {
              const Icon = item.icon;
              const badge = badges[item.id];
              return (
                <button key={item.id} onClick={() => onOpen(item.id)}>
                  <Icon size={17} />
                  <span>{item.label}</span>
                  {badge && <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>}
                  <ChevronRight size={15} />
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <p className="mManageNote">审计与通知已合并进「动态」标签页。</p>
    </div>
  );
}

export function MobileApp({ api }) {
  const { data, action, toast, busy, notify, download, refresh } = api;
  const [tab, setTab] = useState("home");
  const [subPage, setSubPage] = useState("");
  const [panel, setPanel] = useState("");
  const [railOpen, setRailOpen] = useState(false);
  const [killConfirm, setKillConfirm] = useState(false);

  function navigate(next) {
    if (next === "chat") { setTab("chat"); setSubPage(""); return; }
    if (next === "auditSystem") { setTab("feed"); setSubPage(""); setRailOpen(false); return; }
    if (manageLabels[next]) { setTab("manage"); setSubPage(next); setRailOpen(false); return; }
    setTab("home");
    setSubPage("");
  }

  const ui = { setActive: navigate, notify, download, refresh, openPanel: setPanel, closePanel: () => setPanel("") };
  const currentStatus = systemStatus(data);
  const live = data.system?.liveTradingEnabled;

  const settingsSection = subPage.startsWith("settings:") ? subPage.slice(9) : "";

  let content = null;
  if (tab === "manage" && subPage === "positions") {
    content = <MobilePositions data={data} action={action} ui={ui} />;
  } else if (tab === "manage" && subPage === "systemSettings") {
    content = <MobileSettingsIndex data={data} onOpen={setSubPage} />;
  } else if (tab === "manage" && subPage) {
    content = (
      <>
        {subPage === "marketAccount" && <MobileAccountHealth data={data} action={action} />}
        {subPage === "review" && <MobileReview data={data} ui={ui} />}
        {subPage === "knowledgeSkills" && <MobileKnowledge data={data} action={action} ui={ui} />}
        {subPage === "eventsTasks" && <MobileTasks data={data} action={action} ui={ui} />}
        {subPage === "riskAuth" && <MobileRisk data={data} action={action} ui={ui} />}
        {subPage === "admin" && <div className="content mSubContent mAdminContent"><AdminPage data={data} action={action} ui={ui} /></div>}
        {settingsSection && <div className="content mSubContent"><div className="settingsPage"><SystemConfigPanel data={data} action={action} ui={ui} section={settingsSection} /></div></div>}
      </>
    );
  } else if (tab === "chat") {
    content = <div className="content mChatContent"><ChatPage data={data} action={action} ui={ui} /></div>;
  } else if (tab === "feed") {
    content = <MobileFeed data={data} />;
  } else if (tab === "manage") {
    content = <MobileManage onOpen={(id) => setSubPage(id)} data={data} />;
  } else {
    content = <MobileHome data={data} action={action} ui={ui} onOpenRail={() => setRailOpen(true)} />;
  }

  return (
    <div className="mShell">
      <header className="mHeader">
        {tab === "manage" && subPage ? (
          <>
            <button className="mBack" onClick={() => setSubPage(settingsSection ? "systemSettings" : "")} aria-label="返回"><ChevronLeft size={19} /></button>
            <strong className="mHeaderTitle">{manageLabels[subPage]}</strong>
            <span className="mHeaderSpacer" />
          </>
        ) : (
          <>
            <div className="mHeaderStatus">
              <button className={`mStatusPill ${currentStatus.tone}`} onClick={() => navigate("riskAuth")}>
                <span />{currentStatus.label}
              </button>
              <span className={`mLivePill ${live ? "on" : ""}`}>{live ? "实盘" : "模拟盘"}</span>
            </div>
            <button className="mKill" onClick={() => setKillConfirm(true)}><Zap size={13} /> 熔断</button>
          </>
        )}
      </header>

      <main className={`mMain ${tab === "chat" && !subPage ? "mMainChat" : ""}`}>{content}</main>

      <nav className="mTabbar">
        {mobileTabs.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button key={item.id} className={active ? "active" : ""} onClick={() => { setTab(item.id); setSubPage(""); }} aria-label={item.label}>
              <Icon size={20} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {railOpen && (
        <div className="railSheetOverlay" onClick={() => setRailOpen(false)}>
          <div className="railSheet" onClick={(event) => event.stopPropagation()}>
            <div className="railSheetHead">
              <strong>Agent 状态</strong>
              <button onClick={() => setRailOpen(false)} aria-label="关闭"><ChevronDown size={17} /></button>
            </div>
            <RailContent data={data} action={action} ui={{ ...ui, setActive: (next) => { setRailOpen(false); navigate(next); } }} />
          </div>
        </div>
      )}
      {killConfirm && <KillConfirmDialog enable action={action} onClose={() => setKillConfirm(false)} />}
      {panel && <ConfigPanel panel={panel} data={data} action={action} ui={ui} />}
      {busy && <div className="busyIndicator"><Activity size={13} /> 执行中</div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
