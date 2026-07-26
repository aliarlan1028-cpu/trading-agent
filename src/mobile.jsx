import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bell,
  Bot,
  Menu,
  PieChart,
  ShieldCheck,
  X,
  BookOpen,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Gauge,
  Globe2,
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
  Zap,
  CheckCircle2,
  Rocket,
  Sparkles,
  Trash2
} from "lucide-react";
import { displayMoney, displayPrice, displayPct, formatDate, formatDateTime, formatTime, humanize, humanizePhase, smartMoneyBias, CandleChart, TradingViewChart, LiveCandleChart, LivePrice, ProgressBar, StatusBadge, statusTone, SymbolChips, systemStatus } from "./lib.jsx";
import { ChatPage } from "./chat.jsx";
import { AdminPage, ConceptGraph } from "./pages.jsx";
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
  // 状态头标题基于授权目标/系统状态，绝不回显用户聊天内容（currentGoal 可能是最近一句对话）。
  const railHeadline = mandate?.goal ? cleanAgentText(mandate.goal, "自主交易授权") : "只读观察巡检";
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

  return (
    <>
      {/* 1. 状态：现在是什么状态 */}
      <div className="railBlock railStatusHead">
        <div className="railStatusTop">
          <span className="railLabel">AI 交易员</span>
          <StatusBadge tone={statusTone(agentStatus.state || data.system?.apiHealth)}>{displayStateLabel}</StatusBadge>
        </div>
        <strong className="railGoal">{railHeadline}</strong>
        <small className="railMandate">{mandate ? `授权运行 · ${mandate.name || mandate.id}` : "未授权 · 等待授权"}</small>
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
    // 聊天对话不算"Agent 动作"：只有产出交易计划/授权草案的 chat run 才进时间线，纯闲聊不显示。
    .filter((run) => run.source !== "chat" || run.tradePlanId || run.mandateId)
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
  const system = data.system || {};
  const riskWall = agentStatus.riskWall || {};
  const canOpen = system.killSwitch ? false : riskWall.allowOpen === true;
  const gateLabel = system.killSwitch ? "熔断中" : (canOpen ? "允许开仓" : "禁止开仓");
  const gateTone = system.killSwitch ? "danger" : (canOpen ? "ok" : "warning");
  const regime = data.marketRegime || {};
  const gmMob = regime.global || {};
  const smMob = regime.smartMoney || {};
  const hasRegimeMob = gmMob.ok || smMob.ok;
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

      {inboxCount > 0 && (
      <section className="mInbox">
        <header><Inbox size={14} /> 需要你处理 · {inboxCount}</header>
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
      </section>
      )}

      <section className="mQuickGrid quad">
        <button onClick={() => ui.setActive("positions")}><span>持仓</span><strong>{positions.length}</strong></button>
        <button onClick={() => ui.setActive("positions")}><span>在途委托</span><strong>{orders.length}</strong></button>
        <button onClick={() => ui.setActive("riskAuth")}><span>日亏预算</span><strong>{budget === null || budget === undefined ? "未授权" : displayMoney(budget, 0)}</strong></button>
        <button className={openIncidents.length ? "alert" : ""} onClick={() => ui.setActive("auditSystem")}><span>风险事件</span><strong>{openIncidents.length}</strong></button>
      </section>

      <section className="mAgentCard" onClick={onOpenRail} role="button" tabIndex={0}>
        <header>
          <span>Agent 当前任务</span>
          <StatusBadge tone={statusTone(agentStatus.state || data.system?.apiHealth)}>{displayStateLabel}</StatusBadge>
        </header>
        <strong>{displayGoal}</strong>
      </section>

      <section className="mRegimeCard" role="button" tabIndex={0} onClick={() => action("/api/market/regime", {}, "GET")}>
        <header><span><Globe2 size={14} /> 大盘与聪明钱</span><RefreshCw size={12} /></header>
        {hasRegimeMob ? (
          <>
            <div className="mRegimeGrid">
              <span>BTC 主导<b>{gmMob.btcDominancePct != null ? `${gmMob.btcDominancePct}%` : "-"}</b></span>
              <span>情绪<b>{gmMob.fearGreed ? gmMob.fearGreed.value : "-"}</b></span>
              <span>大户多空<b>{smMob.topTraderLongShortRatio ?? "-"}</b></span>
              <span>散户多空<b>{smMob.retailLongShortRatio ?? "-"}</b></span>
            </div>
            {smMob.ok && smMob.interpretation && <p>{smMob.interpretation}</p>}
          </>
        ) : (
          <p className="mRegimeEmpty">点击拉取 BTC 主导率、情绪、大户/散户多空比与爆仓</p>
        )}
      </section>

      <div className="mAgentDock">
        <span className={`mGateChip ${gateTone}`}><Shield size={13} /> {gateLabel}</span>
        <button className="mDockBtn" onClick={() => action("/api/system/autonomy", { enabled: !system.autonomyEnabled })}>
          {system.autonomyEnabled ? "暂停自主推进" : "恢复自主推进"}
        </button>
      </div>

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

// 屏 S5 — 系统设置：账户卡 + 交易所列表 + 系统配置分区 + 订阅卡。
function MobileSettingsIndex({ data, onOpen }) {
  const config = data.config || {};
  const exchange = config.exchange || {};
  const integrations = config.integrations || {};
  const live = config.liveTrading || {};
  const runtime = config.runtime || {};
  const user = data.user || {};
  const sub = (data.subscriptions || [])[0] || {};
  const subs = {
    llm: config.llm?.activeProvider ? humanize(config.llm.activeProvider, config.llm.activeProvider) : "未配置",
    exchange: [exchange.binance?.hasKey && "Binance", exchange.okx?.hasKey && "OKX"].filter(Boolean).join("、") || "未配置",
    live: live.effective ? "已开启" : "关闭",
    integrations: integrations.telegram?.configured ? "TG 已接入" : integrations.lark?.hasWebhook ? "飞书已接入" : "未配置",
    runtime: runtime.authRequired === false ? "免登录" : "鉴权开启"
  };
  const exchanges = [
    { id: "binance", name: "Binance", letter: "B", cls: "binance", connected: exchange.binance?.hasKey },
    { id: "okx", name: "OKX", letter: "O", cls: "okx", connected: exchange.okx?.hasKey }
  ];
  return (
    <div className="mScreen">
      <div className="mCard mAcctCard">
        <span className="mAcctAvatar">{String(user.name || user.email || "U").charAt(0).toUpperCase()}</span>
        <div className="mAcctInfo"><b>{user.name || "量化交易员"}</b><small>{user.email || "—"}</small></div>
        <span className="mAcctPlan">{user.isOwner ? "OWNER" : sub.status ? "PRO" : "—"}</span>
      </div>

      <div className="mCard">
        <div className="mCardHead"><b>交易所与 API 密钥</b><small>{exchanges.filter((e) => e.connected).length} 已连接</small></div>
        {exchanges.map((e) => (
          <button className="mExRow" key={e.id} onClick={() => onOpen("settings:exchange")}>
            <span className={`mExLogo ${e.cls}`}>{e.letter}</span>
            <div className="mExInfo"><b>{e.name}</b><small>{e.connected ? "已配置密钥" : "未配置"}</small></div>
            <StatusBadge tone={e.connected ? "ok" : "neutral"}>{e.connected ? "已连接" : "未连接"}</StatusBadge>
            <ChevronRight size={15} />
          </button>
        ))}
        <div className="mSecNote"><Shield size={13} /> 密钥加密存储；只勾读写交易，绝不勾选提币权限</div>
      </div>

      <div className="mCard">
        <div className="mCardHead"><b>系统配置</b></div>
        {settingsSections.map((item) => (
          <button className="mCfgRow" key={item.id} onClick={() => onOpen(`settings:${item.id}`)}>
            <span>{item.label}</span>
            <small className="mono">{subs[item.id]}</small>
            <ChevronRight size={15} />
          </button>
        ))}
      </div>

      {sub.status && (
        <div className="mCard mPlanCard">
          <div className="mPlanTop">
            <div><b>{sub.planName || "专业版"}</b><small>{sub.source === "owner_grant" ? "Owner 免费授权" : humanize(sub.status)}</small></div>
            <span className="mPlanBadge">生效中</span>
          </div>
          <div className="mPlanFoot mono">到期 {sub.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : "长期有效"}</div>
        </div>
      )}
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

// 屏 S3 — 风控与授权：风险墙 + 亏损预算 + MANDATE 6 行 + 规则 2×2 + 操作按钮行。
function MobileRisk({ data, action, ui }) {
  const mandate = data.agentStatus?.activeMandate || data.mandates?.[0] || {};
  const sys = data.system || {};
  const portfolio = data.portfolio || {};
  const rules = data.riskRules || [];
  const maxLeverage = mandate.max_leverage || (mandate.maxLeverageBySymbol ? Math.max(1, ...Object.values(mandate.maxLeverageBySymbol)) : null);
  const approvalThreshold = mandate.humanApprovalNotionalUsdt || mandate.manual_approval_threshold_usdt;
  const validUntil = mandate.validUntil || mandate.valid_until;
  const budgetRemain = sys.remainingDailyLossUsdt;
  const budgetCap = sys.dailyLossCapUsdt;
  const budgetPct = budgetCap ? Math.max(0, Math.min(100, (Number(budgetRemain) / Number(budgetCap)) * 100)) : null;
  const killed = sys.killSwitch;
  const active = ["running", "active"].includes(mandate.status);
  // 授权≠低风险：有真实风险等级就用它，否则显示"已授权·风险待评估"，不写死"低风险"。
  const rLabel = /高|中|低/.test(portfolio.riskLabel || "") ? portfolio.riskLabel : null;
  const wall = killed ? { label: "熔断停机 · 已阻断开仓", tone: "critical" }
    : active ? { label: rLabel ? `${rLabel} · 运行中` : "已授权 · 风险待评估", tone: rLabel === "高风险" ? "critical" : rLabel === "中风险" ? "warning" : rLabel ? "ok" : "warning" }
    : { label: "未授权 · 观察模式", tone: "warning" };
  const mandateTone = active ? "ok" : statusTone(mandate.status);
  const mandRows = [
    ["授权范围", (mandate.exchanges || []).length ? "已授权交易" : "未授权", ""],
    ["交易所", (mandate.exchanges || []).join("、") || "—", ""],
    ["最大杠杆", maxLeverage ? `${maxLeverage}x` : "—", ""],
    ["单日最大亏损", mandate.maxDailyLossPct ? `${mandate.maxDailyLossPct}%` : "—", "neg"],
    ["审批阈值", approvalThreshold != null && mandate.id ? `${displayMoney(approvalThreshold, 0)} U` : "—", ""],
    ["有效期", validUntil ? formatDate(validUntil) : "长期有效", ""]
  ];
  const groups = [["账户", "#2A6FDB", "#EAF0FB"], ["交易", "#1F7A50", "#E6F1EA"], ["事件", "#D06A22", "#FBEDDF"], ["系统", "#7A4FD0", "#F0EAFB"]];
  const scopeCount = (name) => rules.filter((r) => String(r.scope || r.category || r.name || "").includes(name)).length;
  return (
    <div className="mScreen">
      <div className={`mRiskWall ${wall.tone}`}>
        <ShieldCheck size={22} />
        <div><b>{wall.label}</b><small>{active ? "授权与硬风控生效中" : "配置授权后进入自主"}</small></div>
      </div>
      <div className="mCard mBudgetCard">
        <div className="mBudgetTop"><span>剩余亏损预算</span><b className="mono">{budgetRemain != null ? `${displayMoney(budgetRemain, 2)} USDT` : "未授权"}</b></div>
        <div className="mBudgetBar"><i style={{ width: `${budgetPct ?? 0}%` }} /></div>
      </div>
      <div className="mCard">
        <div className="mCardHead"><b>授权委托 MANDATE</b><StatusBadge tone={mandateTone}>{humanize(mandate.status, "未授权")}</StatusBadge></div>
        <div className="mMandList">{mandRows.map(([k, v, tone]) => <div className="mMandRow" key={k}><span>{k}</span><b className={`mono ${tone}`}>{v}</b></div>)}</div>
        <button className="mLink2" onClick={() => ui.openPanel("mandate")}>编辑授权 ›</button>
      </div>
      <div className="mCard">
        <div className="mCardHead"><b>风险规则</b></div>
        <div className="mRuleGrid2">{groups.map(([name, c, bg]) => { const n = scopeCount(name); return <div className="mRuleCard2" key={name} style={{ background: bg }}><b style={{ color: c }}>{name}</b><small>{n ? `${n} 条已启用` : "无规则"}</small><i style={{ background: c }} /></div>; })}</div>
      </div>
      <div className="mRiskBtns">
        <button className="mRbPause" onClick={() => action("/api/system/autonomy", { enabled: false })}>暂停自主</button>
        <button className="mRbReduce" onClick={() => ui.openPanel("riskRules")}>只减仓</button>
        <button className="mRbKill" onClick={() => action("/api/risk/kill-switch", { enabled: !killed, reason: "" })}>{killed ? "解除熔断" : "一键熔断"}</button>
      </div>
    </div>
  );
}

const KNOW_SEGMENTS = ["上手", "方法", "技能", "规则", "图谱"];
const MSKILL = {
  compile_failed: { label: "编译失败", tone: "danger" },
  compiled: { label: "待历史验证", tone: "warning", next: { action: "validate", label: "历史验证" } },
  historical_rejected: { label: "历史未通过", tone: "danger", next: { action: "validate", label: "重跑" } },
  historical_validated: { label: "待模拟", tone: "warning", next: { action: "paper", label: "开始模拟" } },
  paper_validating: { label: "模拟中", tone: "info" },
  paper_rejected: { label: "模拟未通过", tone: "danger" },
  paper_validated: { label: "待批准", tone: "warning", next: { action: "approve", label: "批准启用" } },
  active: { label: "已上岗", tone: "ok" },
  degraded: { label: "已降级", tone: "danger" },
  superseded: { label: "已被替代", tone: "neutral" },
  retired: { label: "已退役", tone: "neutral" }
};
const MSKILL_HELP = [
  ["待历史验证", "warning", "已编译成可执行规则，等你点「历史验证」跑三窗回测。"],
  ["待模拟 / 模拟中", "warning", "历史通过后进入纯前向模拟盘，用之后的真实行情逐笔积累样本。"],
  ["待批准", "warning", "模拟也达标了，等你人工批准——只有你批准的技能才进实盘。"],
  ["已上岗", "ok", "已批准，正在参与实盘计划生成。"],
  ["编译失败", "danger", "方法缺明确入场/止损/止盈或周期不受支持，补全后可重编译。"],
  ["历史/模拟未通过", "danger", "验证未达门槛，不能上岗。"],
  ["已降级", "danger", "上岗后实盘变差被自动停用，需重新验证。"],
  ["已被替代 / 已退役", "neutral", "旧版本被更新版取代，或已退役，仅供追溯。"]
];

function MobileKnowledge({ data, action, ui }) {
  const [seg, setSeg] = useState("上手");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const knowledge = data.knowledge || {};
  const sources = knowledge.sources || [];
  const methods = knowledge.tradingMethods || [];
  const skills = knowledge.tradingSkills || [];
  const rules = knowledge.ruleProposals || [];
  const compiledIds = new Set(skills.filter((s) => !["retired", "superseded"].includes(s.status)).map((s) => s.sourceMethodId));
  const active = skills.filter((s) => s.status === "active").length;
  const inPipe = skills.filter((s) => !["retired", "superseded", "compile_failed", "active"].includes(s.status)).length;
  // 当前该做哪一步：没知识源→喂料；有草案没进流水线→编译验证；进了流水线没上岗→批准；已上岗→完成。
  const step = sources.length === 0 ? 1 : (active === 0 && inPipe === 0) ? 2 : active === 0 ? 3 : 4;
  const guide = [
    { n: 1, Icon: BookOpen, title: "喂知识", desc: "导入交易书籍或文章，自动蒸馏出方法与风控纪律。", cta: "导入知识源", on: () => ui.openPanel("knowledgeImport") },
    { n: 2, Icon: Rocket, title: "编译 + 验证", desc: "把方法编译成技能，跑历史回测 + 纯前向模拟盘。", cta: "去方法", on: () => setSeg("方法") },
    { n: 3, Icon: ShieldCheck, title: "人工批准上岗", desc: "只有你亲自批准的技能才进入实盘决策。", cta: "去技能", on: () => setSeg("技能") }
  ];

  async function search() {
    if (!query.trim()) return;
    const result = await action("/api/knowledge/rag-query", { query: query.trim(), topK: 5 });
    setHits(result.hits || result.results || result.chunks || []);
  }

  return (
    <div className="mSubPage">
      <div className="mChips">
        {KNOW_SEGMENTS.map((name) => <button key={name} className={seg === name ? "active" : ""} onClick={() => setSeg(name)}>{name}{name === "方法" && methods.length ? ` ${methods.length}` : ""}{name === "技能" && skills.length ? ` ${skills.length}` : ""}{name === "规则" && rules.length ? ` ${rules.length}` : ""}{name === "图谱" && knowledge.conceptCards?.length ? ` ${knowledge.conceptCards.length}` : ""}</button>)}
      </div>

      {seg === "上手" && (
        <>
          <div className="mKGuide">
            <div className="mKGuideTitle"><Sparkles size={14} /> 知识库怎么用？三步让 AI 交易员变强</div>
            {guide.map((s) => {
              const state = s.n < step ? "done" : s.n === step ? "active" : "todo";
              const Icon = state === "done" ? CheckCircle2 : s.Icon;
              return (
                <div className={`mKStep ${state}`} key={s.n}>
                  <span className="mKStepIcon"><Icon size={16} /></span>
                  <div className="mKStepBody">
                    <b>{s.title}{state === "active" && <em> · 现在做这步</em>}{state === "done" && <em className="ok"> · 已完成</em>}</b>
                    <p>{s.desc}</p>
                    <button className={state === "active" ? "mMiniPrimary" : "mMiniGhost"} onClick={s.on}>{s.cta} ›</button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mPageStats">
            <div><span>知识源</span><strong>{sources.length}</strong></div>
            <div><span>交易方法</span><strong>{methods.length}</strong></div>
            <div><span>已上岗技能</span><strong>{active}</strong></div>
          </div>

          <div className="mSearchBar">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="检索知识库，如：CPI 前如何控仓" onKeyDown={(event) => { if (event.key === "Enter") search(); }} />
            <button onClick={search} aria-label="检索"><Search size={16} /></button>
          </div>
          {hits !== null && (
            <div className="mSectionCard">
              <header><span>检索结果（{hits.length}）</span></header>
              {!hits.length && <p className="mInboxEmpty">没有命中的知识片段。</p>}
              {hits.slice(0, 5).map((hit, index) => <p className="mLeadLine" key={index}>{String(hit.text || hit.content || hit.chunk || "").slice(0, 120)}</p>)}
            </div>
          )}

          <div className="mSectionCard">
            <header><span>知识源（{sources.length}）</span><button className="textButton" onClick={() => ui.openPanel("knowledgeList")}>全部 <ChevronRight size={12} /></button></header>
            {!sources.length && <p className="mInboxEmpty">还没有导入知识。点下方「导入知识」开始。</p>}
            {sources.slice(0, 8).map((source) => (
              <div className="mRowItem" key={source.id || source.title}>
                <b>{source.title || source.name || "未命名"}</b>
                <StatusBadge tone={statusTone(source.status)}>{humanize(source.status, "已导入")}</StatusBadge>
              </div>
            ))}
          </div>
          <button className="mPrimaryAction" onClick={() => ui.openPanel("knowledgeImport")}><Plus size={15} /> 导入知识</button>
        </>
      )}

      {seg === "方法" && (
        <div className="mSectionCard">
          <header><span>交易方法草案（{methods.length}）</span><small>需走验证才上岗</small></header>
          {!methods.length && <p className="mInboxEmpty">导入书籍后自动蒸馏交易方法草案。</p>}
          {methods.map((m) => {
            const compiled = compiledIds.has(m.id);
            const open = openId === m.id;
            return (
              <div className={`mKRow ${open ? "open" : ""}`} key={m.id}>
                <button className="mKRowHead" onClick={() => setOpenId(open ? null : m.id)}>
                  <span className={`mDir ${m.direction}`}>{m.direction === "short" ? "空" : m.direction === "long" ? "多" : "多空"}</span>
                  <b>{m.name}</b>
                  <StatusBadge tone={compiled ? "ok" : "neutral"}>{compiled ? "已编译" : "草案"}</StatusBadge>
                </button>
                {open && (
                  <div className="mKRowBody">
                    <p><i>进场</i>{m.entry || "-"}</p>
                    <p><i>止损</i>{m.stop || "-"}</p>
                    <p><i>止盈</i>{m.takeProfit || "-"}</p>
                    {m.source?.title && <p className="mKSrc">《{m.source.title}》</p>}
                    {!compiled && <button className="mMiniPrimary" onClick={() => action(`/api/knowledge/methods/${m.id}/compile`, {})}>编译为技能草案 ›</button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {seg === "技能" && (
        <div className="mSectionCard">
          <header><span>技能流水线（{skills.length}）</span><button className="textButton" onClick={() => action("/api/knowledge/skills/sync", {})}>同步</button></header>
          <div className="mKLegend">
            <button className="mKLegendHead" onClick={() => setLegendOpen((v) => !v)}><Info size={13} /> 这些状态是什么意思？<ChevronDown size={13} className={legendOpen ? "flip" : ""} /></button>
            {legendOpen && MSKILL_HELP.map(([label, tone, desc]) => (
              <div className="mKLegendRow" key={label}><StatusBadge tone={tone}>{label}</StatusBadge><span>{desc}</span></div>
            ))}
          </div>
          {!skills.length && <p className="mInboxEmpty">还没有技能。到「方法」把方法编译成技能草案后在此推进验证。</p>}
          {(() => {
            const ARCHIVED = new Set(["compile_failed", "superseded", "retired"]);
            const live = skills.filter((s) => !ARCHIVED.has(s.status));
            const archived = skills.filter((s) => ARCHIVED.has(s.status));
            const row = (skill) => {
              const st = MSKILL[skill.status] || { label: skill.status, tone: "neutral" };
              const open = openId === skill.id;
              return (
                <div className={`mKRow ${open ? "open" : ""}`} key={skill.id}>
                  <button className="mKRowHead" onClick={() => setOpenId(open ? null : skill.id)}>
                    <b>{skill.name} <span className="mono">v{skill.version}</span></b>
                    {skill.spec?.lowTrust && <StatusBadge tone="warning">低信任</StatusBadge>}
                    <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                  </button>
                  {open && (
                    <div className="mKRowBody">
                      <p className="mKSrc">{skill.spec?.templateLabel || "未编译"} · {skill.spec?.timeframe || "-"}{skill.sourceTitle ? ` · 《${skill.sourceTitle}》` : ""}</p>
                      {skill.compileErrors?.length > 0 && <p className="mKErr">不能执行：{skill.compileErrors.join("；")}</p>}
                      {skill.status === "superseded" && <p className="mKSrc">已被更新版本替代，仅作追溯。</p>}
                      {skill.liveMetrics && <p><i>实盘</i>{skill.liveMetrics.trades} 笔 · 胜率 {skill.liveMetrics.winRatePct}%</p>}
                      {st.next && <button className="mMiniPrimary" onClick={() => action(`/api/knowledge/skills/${skill.id}/${st.next.action}`, {})}>{st.next.label} ›</button>}
                      {skill.status === "compile_failed" && skill.sourceMethodId && <button className="mMiniPrimary" onClick={() => action(`/api/knowledge/methods/${skill.sourceMethodId}/compile`, {})}>重新编译 ›</button>}
                    </div>
                  )}
                </div>
              );
            };
            return (
              <>
                {live.map(row)}
                {!live.length && skills.length > 0 && <p className="mInboxEmpty">当前没有在流水线中的活技能，只有归档技能。</p>}
                {archived.length > 0 && (
                  <>
                    <div className="mKArchiveHead">
                      <button onClick={() => setArchivedOpen((v) => !v)}><ChevronDown size={12} className={archivedOpen ? "flip" : ""} /> 已归档 {archived.length}</button>
                      <button className="mKArchivePurge" onClick={() => { if (window.confirm("清理归档：删除编译失败与已被替代的技能？（已退役保留）")) action("/api/knowledge/skills/purge-archived", {}); }}><Trash2 size={11} /> 清理</button>
                    </div>
                    {archivedOpen && archived.map(row)}
                  </>
                )}
              </>
            );
          })()}
        </div>
      )}

      {seg === "规则" && (
        <div className="mSectionCard">
          <header><span>风控纪律（{rules.length}）</span><button className="textButton" onClick={() => ui.openPanel("ruleLibrary")}>管理/去重 <ChevronRight size={12} /></button></header>
          {!rules.length && <p className="mInboxEmpty">导入资料后自动抽取风控纪律。</p>}
          {rules.slice(0, 20).map((r) => (
            <div className="mRowItem" key={r.id}>
              <b>{r.name}</b>
              <StatusBadge tone={r.status === "已批准" ? "ok" : "warning"}>{humanize(r.status, "待审批")}</StatusBadge>
            </div>
          ))}
          {rules.length > 0 && <button className="mPrimaryAction" onClick={() => ui.openPanel("ruleLibrary")}>去规则库批准 / 去重 ›</button>}
        </div>
      )}

      {seg === "图谱" && (
        <div className="mSectionCard">
          <header><span>概念图谱（{knowledge.conceptCards?.length || 0}）</span><small>相关概念自动聚簇</small></header>
          <ConceptGraph concepts={knowledge.conceptCards || []} />
        </div>
      )}
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
  const OPEN_EXEC = new Set(["submitted", "entry_pending", "entry_partial", "entry_filled", "protecting"]);
  const openExecutions = (data.executionOrders || []).filter((item) => OPEN_EXEC.has(String(item.status || "").toLowerCase())).length;
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

// 屏 S2 — 市场与账户：指标 2×2 + 行情卡（SVG K线）+ 持仓卡 + 保证金甜甜圈。
function MobileMarket({ data, action, ui }) {
  const [tf, setTf] = useState("1H");
  const [sym, setSym] = useState(null);
  const portfolio = data.portfolio || {};
  const configured = (data.exchangeAccounts || []).some((a) => a.readEnabled);
  const markets = (data.markets || []).filter((m) => m && m.symbol);
  const market = markets.find((m) => m.symbol === sym) || markets[0] || { symbol: "BTC/USDT", candles: [] };
  const positions = data.positions || [];
  const equity = portfolio.totalEquityUsdt;
  const avail = portfolio.availableMarginUsdt;
  const used = equity != null && avail != null ? Math.max(0, Number(equity) - Number(avail)) : null;
  // used 为 null 时必须保持 null（旧代码 null/equity===0 会把"未同步"渲染成 0%）。
  const marginRate = used != null && Number(equity) > 0 ? (used / Number(equity)) * 100 : null;
  const metrics = [
    ["总资产", configured && equity != null ? displayMoney(equity, 2) : "未同步", null],
    ["今日盈亏", configured && portfolio.todayPnl != null ? `${portfolio.todayPnl >= 0 ? "+" : ""}${displayMoney(portfolio.todayPnl, 2)}` : "未同步", configured ? portfolio.todayPnl : null],
    ["可用保证金", configured && avail != null ? displayMoney(avail, 2) : "未同步", null],
    ["未实现盈亏", configured && portfolio.unrealizedPnl != null ? `${portfolio.unrealizedPnl >= 0 ? "+" : ""}${displayMoney(portfolio.unrealizedPnl, 2)}` : "未同步", configured ? portfolio.unrealizedPnl : null]
  ];
  const chgPos = Number(market.changePct || 0) >= 0;
  const tvInterval = { "15m": "15", "1H": "60", "4H": "240", "1D": "D" }[tf] || "60";
  const circ = 2 * Math.PI * 24;
  const dash = `${((marginRate ?? 0) / 100) * circ} ${circ}`;
  return (
    <div className="mScreen">
      <div className="mMetric2x2">
        {metrics.map(([k, v, pn]) => <div className="mMetricCell" key={k}><span>{k}</span><b className={`mono ${pn != null ? (Number(pn) >= 0 ? "pos" : "neg") : ""}`}>{v}</b></div>)}
      </div>
      <div className="mCard">
        <LivePrice symbol={market.symbol} fallbackPrice={market.price} fallbackChange={market.changePct}>
          {(price, change) => (
            <>
              <div className="mMktHead">
                <div className="mMktSym"><span className="mCoinDot">{(market.symbol || "B").charAt(0)}</span><b className="mono">{market.symbol}</b></div>
                <div className={`mMktChg ${Number(change || 0) >= 0 ? "pos" : "neg"} mono`}>{displayPct(change)}</div>
              </div>
              <div className="mMktPrice mono">{displayPrice(price)}</div>
            </>
          )}
        </LivePrice>
        {markets.length > 1 && <div className="mSymPills">{markets.slice(0, 4).map((m) => <button key={m.symbol} className={m.symbol === market.symbol ? "active" : ""} onClick={() => setSym(m.symbol)}>{m.symbol.replace("/USDT", "")}</button>)}</div>}
        <div className="mTfPills">{["15m", "1H", "4H", "1D"].map((t) => <button key={t} className={tf === t ? "active" : ""} onClick={() => setTf(t)}>{t}</button>)}</div>
        <div className="mKline tv"><TradingViewChart symbol={market.symbol} interval={tvInterval} livePrice={market.price} /></div>
      </div>
      <div className="mCard">
        <div className="mCardHead"><b>持仓</b><button className="mLink" onClick={() => ui.setActive("positions")}>全部 ›</button></div>
        {positions.length ? positions.slice(0, 3).map((p, i) => {
          const short = String(p.direction || p.side || p.posSide || "").toLowerCase().includes("short");
          const pnl = Number(p.pnl ?? p.upl ?? p.unrealizedPnl ?? 0);
          return (
            <div className="mPosRow" key={i}>
              <div className="mPosL"><b className="mono">{p.symbol || p.instId}</b><span className={`mPosDir ${short ? "short" : "long"}`}>{short ? "做空" : "做多"}</span></div>
              <div className="mPosR"><b className={`mono ${pnl >= 0 ? "pos" : "neg"}`}>{pnl >= 0 ? "+" : ""}{displayMoney(pnl, 2)}</b><small className="mono">{displayMoney(p.size ?? p.qty ?? p.pos ?? 0, 2)} · {displayPct(p.roiPct ?? p.uplRatioPct)}</small></div>
            </div>
          );
        }) : <div className="mEmpty">连接交易所后显示真实持仓</div>}
      </div>
      <div className="mCard mMarginCard">
        <svg className="mDonut" viewBox="0 0 56 56">
          <circle cx="28" cy="28" r="24" fill="none" stroke="#EDE7DB" strokeWidth="6" />
          <circle cx="28" cy="28" r="24" fill="none" stroke="#D06A22" strokeWidth="6" strokeDasharray={dash} strokeLinecap="round" transform="rotate(-90 28 28)" />
          <text x="28" y="31" textAnchor="middle" className="mDonutTxt">{marginRate != null ? `${marginRate.toFixed(0)}%` : "—"}</text>
        </svg>
        <div className="mMarginInfo"><b>保证金率</b><small>{marginRate != null ? `已用保证金 ${marginRate.toFixed(1)}%` : "连接账户后显示"}</small></div>
      </div>
    </div>
  );
}

// 屏 S4 — 审计与系统：系统卡 2×2 + 审计链 + 决策/工具日志。
function MobileAudit({ data, ui }) {
  const sys = data.system || {};
  const rt = data.realtimeConnections || [];
  const tasks = (data.tasks || []).filter((t) => t.enabled).length;
  const exSynced = (data.exchangeAccounts || []).filter((a) => a.readEnabled).length;
  const exTotal = data.exchangeAccounts?.length || 0;
  const sysCards = [
    ["API 健康", sys.apiHealth || "未知", "#2A6FDB", "#EAF0FB"],
    ["WebSocket", data.realtimeStarted ? `${rt.filter((c) => c.status === "connected").length}/${rt.length || 0}` : "未启动", "#7A4FD0", "#F0EAFB"],
    ["任务引擎", String(tasks), "#D06A22", "#FBEDDF"],
    ["交易所同步", exTotal ? `${exSynced}/${exTotal}` : "未接入", "#1F7A50", "#E6F1EA"]
  ];
  const chain = (data.traces || []).slice(0, 6);
  const logs = (data.auditLogs || []).slice(0, 5);
  return (
    <div className="mScreen">
      <div className="mMetric2x2">
        {sysCards.map(([k, v, c, bg]) => <div className="mMetricCell" key={k}><span style={{ color: c }}>{k}</span><b className="mono" style={{ color: c }}>{v}</b><i className="mSysDot" style={{ background: bg }} /></div>)}
      </div>
      <div className="mCard">
        <div className="mCardHead"><b>运行审计链</b><button className="mLink" onClick={() => ui.openPanel("auditChain")}>完整 ›</button></div>
        {chain.length ? chain.map((t, i) => (
          <div className="mChainRow" key={t.id || i}>
            <span className={`mChainDot ${statusTone(t.status)}`} />
            <div className="mChainMid"><b>{t.title || t.type}</b><small className="mono">{t.id ? String(t.id).slice(0, 14) : t.type}</small></div>
            <small className="mono mChainTime">{formatTime(t.createdAt)}</small>
          </div>
        )) : <div className="mEmpty">暂无审计链记录</div>}
      </div>
      <div className="mCard">
        <div className="mCardHead"><b>决策与工具日志</b></div>
        {logs.length ? logs.map((l, i) => (
          <div className="mLogRow" key={l.id || i}>
            <small className="mono">{formatTime(l.createdAt)}</small>
            <b>{l.action}</b>
            <StatusBadge tone={statusTone(l.severity)}>{humanize(l.severity || "ok")}</StatusBadge>
          </div>
        )) : <div className="mEmpty">暂无日志</div>}
      </div>
    </div>
  );
}

// 屏 S1 — AI 交易员：顶栏下 4 等分状态条。
function MobileChatStatus({ data }) {
  const sys = data.system || {};
  const pf = data.portfolio || {};
  const autoOn = sys.autonomyEnabled === true && !sys.killSwitch;
  const smMob = data.marketRegime?.smartMoney || {};
  // 与桌面端共用 smartMoneyBias（1.05/0.95 三档），不再用 >=1 二分导致两端结论矛盾。
  const bias = smMob.ok ? smartMoneyBias(smMob.topTraderLongShortRatio).label : "待同步";
  const mandate = data.mandates?.find((m) => ["active", "running"].includes(m.status));
  const cells = [
    ["状态", autoOn ? "运行中" : "已暂停", autoOn ? "pos" : ""],
    ["判断", bias, bias === "偏多" ? "pos" : bias === "偏空" ? "neg" : ""],
    ["今日", pf.todayPnlPct != null ? displayPct(pf.todayPnlPct) : "—", Number(pf.todayPnlPct || 0) >= 0 ? "pos" : "neg"],
    ["目标", mandate?.targetMonthlyPct ? `${mandate.targetMonthlyPct}%` : "—", ""]
  ];
  return (
    <div className="mChatStatus">
      {cells.map(([k, v, tone]) => <div className="mChatStatCell" key={k}><span>{k}</span><b className={`mono ${tone}`}>{v}</b></div>)}
    </div>
  );
}

// 移动端主导航（与桌面 6 页 IA 一致 + 系统设置），走顶部汉堡抽屉。
const mobileNav = [
  { id: "chat", label: "AI 交易员", code: "ALPHA-01", icon: Bot },
  { id: "cockpit", label: "市场与账户", code: "MARKET · ACCOUNT", icon: PieChart },
  { id: "eventsTasks", label: "事件与任务", code: "EVENTS · TASKS", icon: CalendarClock },
  { id: "knowledgeSkills", label: "知识与技能", code: "KNOWLEDGE · SKILLS", icon: BookOpen },
  { id: "riskAuth", label: "风控与授权", code: "RISK · MANDATE", icon: ShieldCheck },
  { id: "auditSystem", label: "审计与系统", code: "AUDIT · SYSTEM", icon: Activity },
  { id: "systemSettings", label: "系统设置", code: "SETTINGS · CONFIG", icon: Settings }
];

function MobileHeader({ route, onMenu, right }) {
  const item = mobileNav.find((n) => n.id === route) || mobileNav[0];
  return (
    <header className="mHeader2">
      <button className="mMenuBtn" onClick={onMenu} aria-label="打开菜单"><Menu size={20} /></button>
      <div className="mHeaderMid"><strong>{item.label}</strong><small className="mono">{item.code}</small></div>
      <div className="mHeaderRight">{right}</div>
    </header>
  );
}

function NavDrawer({ open, route, onNavigate, onClose, data }) {
  if (!open) return null;
  const status = systemStatus(data);
  return (
    <div className="mDrawerOverlay" onClick={onClose}>
      <aside className="mDrawer" onClick={(event) => event.stopPropagation()}>
        <div className="mDrawerBrand"><span className="mDrawerLogo">◆</span><div className="mDrawerBrandText"><b>交易 Agent</b><small>AI · DIGITAL ASSET</small></div></div>
        <div className="mDrawerNav">
          {mobileNav.map((n) => {
            const Icon = n.icon;
            return <button key={n.id} className={`mDrawerItem ${route === n.id ? "active" : ""}`} onClick={() => onNavigate(n.id)}><Icon size={19} /><span>{n.label}</span></button>;
          })}
        </div>
        <div className="mDrawerFoot">
          <div className={`mDrawerStatus ${status.tone}`}><span />{status.label}</div>
          <button className="mDrawerClose" onClick={onClose}>关闭菜单</button>
        </div>
      </aside>
    </div>
  );
}

export function MobileApp({ api }) {
  const { data, action, toast, busy, notify, download, refresh } = api;
  const [route, setRoute] = useState("chat");
  const [drawer, setDrawer] = useState(false);
  const [subPage, setSubPage] = useState("");
  const [panel, setPanel] = useState("");
  const [killConfirm, setKillConfirm] = useState(false);
  // 打开审计/动态即把未读通知标为已读
  useEffect(() => {
    if (route === "auditSystem" && (data.notifications || []).some((item) => !item.read)) action("/api/notifications/read", {});
  }, [route]);

  function navigate(next) {
    if (mobileNav.some((n) => n.id === next)) { setRoute(next); setSubPage(""); setDrawer(false); return; }
    if (next === "positions" || next === "marketAccount") { setRoute("cockpit"); setSubPage(next); setDrawer(false); return; }
    if (next === "review") { setRoute("auditSystem"); setSubPage("review"); setDrawer(false); return; }
    if (next === "admin" || next === "systemSettings") { setRoute("systemSettings"); setSubPage(next === "admin" ? "admin" : ""); setDrawer(false); return; }
    if (String(next).startsWith("settings:")) { setRoute("systemSettings"); setSubPage(next); setDrawer(false); return; }
    setRoute("cockpit"); setSubPage(""); setDrawer(false);
  }

  const ui = { setActive: navigate, notify, download, refresh, openPanel: setPanel, closePanel: () => setPanel("") };
  const autoOn = data.system?.autonomyEnabled === true && !data.system?.killSwitch;
  const settingsSection = subPage.startsWith("settings:") ? subPage.slice(9) : "";

  let content = null;
  if (route === "chat") {
    content = <div className="content mChatContent"><MobileChatStatus data={data} /><ChatPage data={data} action={action} ui={ui} /></div>;
  } else if (route === "cockpit") {
    content = subPage === "positions" ? <MobilePositions data={data} action={action} ui={ui} />
      : subPage === "marketAccount" ? <MobileAccountHealth data={data} action={action} />
        : <MobileMarket data={data} action={action} ui={ui} />;
  } else if (route === "eventsTasks") {
    content = <MobileTasks data={data} action={action} ui={ui} />;
  } else if (route === "knowledgeSkills") {
    content = <MobileKnowledge data={data} action={action} ui={ui} />;
  } else if (route === "riskAuth") {
    content = <MobileRisk data={data} action={action} ui={ui} />;
  } else if (route === "auditSystem") {
    content = subPage === "review" ? <MobileReview data={data} ui={ui} /> : <MobileAudit data={data} ui={ui} />;
  } else if (route === "systemSettings") {
    content = settingsSection ? <div className="content mSubContent"><div className="settingsPage"><SystemConfigPanel data={data} action={action} ui={ui} section={settingsSection} /></div></div>
      : subPage === "admin" ? <div className="content mSubContent mAdminContent"><AdminPage data={data} action={action} ui={ui} /></div>
        : <MobileSettingsIndex data={data} onOpen={setSubPage} />;
  } else {
    content = <MobileHome data={data} action={action} ui={ui} onOpenRail={() => {}} />;
  }

  const headerRight = subPage
    ? <button className="mBack" onClick={() => setSubPage("")} aria-label="返回"><ChevronLeft size={19} /></button>
    : route === "chat"
      ? <span className={`mRunBadge ${autoOn ? "on" : "off"}`}><span className="pulseDot" />{autoOn ? "运行中" : "已暂停"}</span>
      : <button className="mKill" onClick={() => setKillConfirm(true)}><Zap size={13} /> 熔断</button>;

  return (
    <div className="mShell2">
      <MobileHeader route={route} onMenu={() => setDrawer(true)} right={headerRight} />
      <main className={`mMain2 ${route === "chat" && !subPage ? "mMainChat" : ""}`}>{content}</main>
      <NavDrawer open={drawer} route={route} onNavigate={navigate} onClose={() => setDrawer(false)} data={data} />
      {killConfirm && <KillConfirmDialog enable action={action} onClose={() => setKillConfirm(false)} />}
      {panel && <ConfigPanel panel={panel} data={data} action={action} ui={ui} />}
      {busy && <div className="busyIndicator"><Activity size={13} /> 执行中</div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
