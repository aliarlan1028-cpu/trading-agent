import React, { useEffect, useMemo, useRef, useState } from "react";
import { uiConfirm, uiPrompt } from "./confirm.jsx";
import {
  Activity,
  Bell,
  Bot,
  Menu,
  PieChart,
  ShieldCheck,
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
  ReceiptText,
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
import { apiUrl, authHeaders, haptic, displayMoney, marginUsage, SKILL_STATE, SKILL_STATE_HELP, OPEN_EXECUTION_STATES, countOpenExecutions, displayPrice, displayPct, formatDate, formatDateTime, formatTime, humanize, humanizePhase, localizeText, smartMoneyBias, TradingViewChart, LivePrice, StatusBadge, statusTone, systemStatus } from "./lib.jsx";
import { ChatPage } from "./chat.jsx";
import { ConceptGraph } from "./pages.jsx";
import { SignalHubPage, TradeJournalPage } from "./relayoutPages.jsx";
import { ConfigPanel, LiveGrayPanel, SystemConfigPanel, TaskManagerPanel } from "./panels.jsx";
import { t } from "./i18n.js";
import { ExecutionLedgerConcept, ExecutionReviewConcept, WatchMonitorConcept } from "./conceptPages.jsx";

export function KillConfirmDialog({ enable, action, onClose }) {
  const [reason, setReason] = useState("");
  async function confirm() {
    await action("/api/risk/kill-switch", { enabled: enable, reason });
    onClose();
  }
  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="confirmDialog" onClick={(event) => event.stopPropagation()}>
        <strong>{enable ? t("确认紧急停止新交易？", "Activate the emergency stop?") : t("确认恢复新交易？", "Resume new trading?")}</strong>
        <p>{enable ? t("将立即阻断所有新交易，并请求撤销全部在途委托。", "This immediately blocks all new trades and requests cancellation of all open orders.") : t("解除后系统恢复正常风控运行，重新允许新交易。", "Once released, the system resumes normal risk control and allows new trades again.")}</p>
        {enable && <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("停止原因（可选，会写入审计记录）", "Reason (optional, written to the audit trail)")} autoFocus />}
        <div className="confirmActions">
          <button type="button" className="ghostButton" onClick={onClose}>{t("取消", "Cancel")}</button>
          <button type="button" className={enable ? "confirmDanger" : "primaryButton"} onClick={confirm}>{enable ? t("确认紧急停止", "Confirm emergency stop") : t("确认恢复", "Confirm resume")}</button>
        </div>
      </div>
    </div>
  );
}

const settingsSections = [
  { id: "llm", label: t("模型", "Model") },
  { id: "exchange", label: t("交易所", "Exchange") },
  { id: "integrations", label: t("外部服务", "Integrations") },
  { id: "runtime", label: t("运行参数", "Runtime") }
];

const positionSegments = ["持仓", "在途委托", "执行单"];

function MobilePositions({ data, action, ui }) {
  const [segment, setSegment] = useState("持仓");
  const positions = data.positions || [];
  const orders = data.orders || [];
  const executions = data.executionOrders || [];
  const reduceOnly = Boolean(data.system?.reduceOnlyMode);
  const activeExec = OPEN_EXECUTION_STATES; // 单一来源(lib),与后端对齐
  const activeExecutions = executions.filter((order) => activeExec.includes(String(order.status || "").toLowerCase())).length;
  const portfolio = data.portfolio || {};
  const configured = (data.exchangeAccounts || []).some((account) => account.readEnabled);
  const exposure = positions.reduce((sum, position) => sum + Math.abs(Number(position.size || 0) * Number(position.mark || position.entry || 0)), 0);
  const totalPnl = positions.reduce((sum, position) => sum + Number(position.pnl || 0), 0);
  const availableMargin = portfolio.availableMarginUsdt ?? portfolio.availableMargin ?? null;
  const marginRate = configured ? marginUsage(portfolio).marginRatePct : null;
  return (
    <div className="mPositions">
      <div className="mPageStats">
        <div><span>{t("总敞口", "Total exposure")}</span><strong>{configured ? displayMoney(exposure, 0) : t("未同步", "Not synced")}</strong></div>
        <div><span>{t("未实现盈亏", "Unrealized PnL")}</span><strong className={totalPnl >= 0 ? "positive" : "negative"}>{configured ? `${totalPnl >= 0 ? "+" : ""}${displayMoney(totalPnl)}` : t("未同步", "Not synced")}</strong></div>
        <div><span>{t("保证金率", "Margin ratio")}</span><strong>{marginRate === null ? t("未同步", "Not synced") : `${marginRate.toFixed(1)}%`}</strong></div>
      </div>
      <div className="mMiniStats">
        <div><span>{t("持仓数", "Positions")}</span><strong>{positions.length}</strong></div>
        <div><span>{t("在途委托", "Open orders")}</span><strong>{orders.length}</strong></div>
        <div><span>{t("活跃执行", "Active executions")}</span><strong>{activeExecutions}</strong></div>
        <div><span>{t("可用保证金", "Available margin")}</span><strong>{configured ? displayMoney(availableMargin, 0) : t("未同步", "Not synced")}</strong></div>
      </div>
      <div className="mChips">
        {positionSegments.map((name) => (
          <button key={name} className={segment === name ? "active" : ""} onClick={() => setSegment(name)}>{name}</button>
        ))}
      </div>

      {segment === "持仓" && (
        <>
          {!positions.length && <p className="mInboxEmpty">{t("暂无真实持仓。配置只读 API 并完成同步后展示。", "No live positions. Configure read-only API and sync to display.")}</p>}
          {positions.map((position) => {
            const pnl = Number(position.pnl || 0);
            return (
              <div className="mPosCard" key={position.id || position.symbol}>
                <header>
                  <strong>{position.symbol}</strong>
                  <StatusBadge tone={position.direction === "short" ? "danger" : "ok"}>{position.direction === "short" ? t("空", "Short") : t("多", "Long")}</StatusBadge>
                </header>
                <div className={`mPosPnl ${pnl >= 0 ? "positive" : "negative"}`}>{pnl >= 0 ? "+" : ""}{displayMoney(position.pnl, 2, "--")} <small>{t("未实现盈亏", "Unrealized PnL")}</small></div>
                <div className="mPosMeta">
                  <span>{t("数量", "Size")}<b>{position.size ?? "-"}</b></span>
                  <span>{t("开仓均价", "Entry price")}<b>{position.entry ? displayMoney(position.entry) : "-"}</b></span>
                  <span>{t("标记价格", "Mark price")}<b>{position.mark ? displayMoney(position.mark) : "-"}</b></span>
                </div>
              </div>
            );
          })}
        </>
      )}

      {segment === "在途委托" && (
        <>
          {!orders.length && <p className="mInboxEmpty">{t("暂无在途委托。", "No open orders.")}</p>}
          {orders.map((order) => (
            <div className="mPosCard" key={order.id}>
              <header>
                <strong>{order.symbol || order.id}</strong>
                <StatusBadge tone={statusTone(order.status)}>{humanize(order.status)}</StatusBadge>
              </header>
              <div className="mPosMeta">
                <span>{t("方向", "Side")}<b>{order.side || order.direction || "-"}</b></span>
                <span>{t("价格", "Price")}<b>{order.price ? displayMoney(order.price) : t("市价", "Market")}</b></span>
                <span>{t("数量", "Size")}<b>{order.quantity ?? order.size ?? "-"}</b></span>
              </div>
            </div>
          ))}
        </>
      )}

      {segment === "执行单" && (
        <>
          {!executions.length && <p className="mInboxEmpty">{t("暂无执行单。批准交易计划后由执行引擎生成。", "No execution orders. Generated by the execution engine after a trade plan is approved.")}</p>}
          {executions.map((order) => (
            <div className="mPosCard" key={order.id}>
              <header>
                <strong>{order.symbol || order.id}</strong>
                <StatusBadge tone={statusTone(order.status)}>{humanize(order.status)}</StatusBadge>
              </header>
              <div className="mPosMeta">
                <span>{t("方向", "Side")}<b>{order.direction || "-"}</b></span>
                <span>{t("入场", "Entry")}<b>{order.entryPrice ? displayMoney(order.entryPrice) : "-"}</b></span>
                <span>{t("止损", "Stop-loss")}<b>{order.stopLoss ? displayMoney(order.stopLoss) : "-"}</b></span>
              </div>
              {activeExec.includes(String(order.status || "").toLowerCase()) && (
                <div className="mInboxActions">
                  <button onClick={() => action(`/api/execution-orders/${order.id}/close`, { reason: "manual_mobile" })}>{t("市价平仓", "Close at market")}</button>
                </div>
              )}
            </div>
          ))}
        </>
      )}

      <button className={`mToggleRow ${reduceOnly ? "on" : ""}`} onClick={() => action("/api/risk/reduce-only", { enabled: !reduceOnly })}>
        <span>
          <strong>{t("只减仓模式", "Reduce-only mode")}</strong>
          <small>{reduceOnly ? t("已开启：禁止新开仓，仅允许减仓", "On: no new positions, reduce only") : t("关闭中：开启后 Agent 只能减仓", "Off: when on, the Agent can only reduce")}</small>
        </span>
        <i className={reduceOnly ? "on" : ""} />
      </button>

      <div className="mList">
        <button onClick={() => ui.setActive("marketAccount")}>
          <Activity size={17} />
          <span>{t("账户健康与对账", "Account health & reconciliation")}</span>
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
  const runtime = config.runtime || {};
  const user = data.user || {};
  const sub = (data.subscriptions || [])[0] || {};
  const subExpiresAt = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).getTime() : null;
  const subExpired = Number.isFinite(subExpiresAt) && subExpiresAt < Date.now();
  const subs = {
    llm: config.llm?.activeProvider ? humanize(config.llm.activeProvider, config.llm.activeProvider) : t("未配置", "Not configured"),
    exchange: exchange.okx?.hasKey ? "OKX" : t("未配置", "Not configured"),
    integrations: integrations.telegram?.configured ? t("TG 已接入", "Telegram connected") : integrations.lark?.hasWebhook ? t("飞书已接入", "Lark connected") : t("未配置", "Not configured"),
    runtime: runtime.authRequired === false ? t("免登录", "No login") : t("鉴权开启", "Auth enabled")
  };
  const exchanges = [
    { id: "okx", name: "OKX", letter: "O", cls: "okx", connected: exchange.okx?.hasKey }
  ];
  return (
    <div className="mScreen">
      <div className="mCard mAcctCard">
        <span className="mAcctAvatar">{user.avatar ? <img src={user.avatar} alt="" /> : String(localizeText(user.name || user.email || "U")).charAt(0).toUpperCase()}</span>
        <div className="mAcctInfo"><b>{localizeText(user.name || t("量化交易员", "Quant Trader"))}</b><small>{user.email || "—"}</small></div>
        <span className="mAcctPlan">{user.isOwner ? "OWNER" : sub.status ? "PRO" : "—"}</span>
      </div>

      <div className="mCard">
        <div className="mCardHead"><b>{t("交易所与 API 密钥", "Exchanges & API keys")}</b><small>{exchanges.filter((e) => e.connected).length} {t("已连接", "connected")}</small></div>
        {exchanges.map((e) => (
          <button className="mExRow" key={e.id} onClick={() => onOpen("settings:exchange")}>
            <span className={`mExLogo ${e.cls}`}>{e.letter}</span>
            <div className="mExInfo"><b>{e.name}</b><small>{e.connected ? t("已配置密钥", "Key configured") : t("未配置", "Not configured")}</small></div>
            <StatusBadge tone={e.connected ? "ok" : "neutral"}>{e.connected ? t("已连接", "Connected") : t("未连接", "Not connected")}</StatusBadge>
            <ChevronRight size={15} />
          </button>
        ))}
        <div className="mSecNote"><Shield size={13} /> {t("密钥加密存储；只勾读写交易，绝不勾选提币权限", "Keys are encrypted at rest; grant read/trade only, never withdrawal permission")}</div>
      </div>

      <div className="mCard">
        <div className="mCardHead"><b>{t("系统配置", "System configuration")}</b></div>
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
            <div><b>{sub.planName || t("专业版", "Pro")}</b><small>{sub.source === "owner_grant" ? t("Owner 免费授权", "Owner free grant") : humanize(sub.status)}</small></div>
            <span className={`mPlanBadge ${subExpired ? "expired" : ""}`}>{subExpired ? t("已过期", "Expired") : t("生效中", "Active")}</span>
          </div>
          <div className="mPlanFoot mono">{t("到期", "Expires")} {sub.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : t("长期有效", "No expiry")}</div>
        </div>
      )}
    </div>
  );
}

function MobileRisk({ data, action, ui, view = "all" }) {
  const showOverview = view === "all" || view === "overview";
  const showSettings = view === "all" || view === "settings";
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
  const [dailyGoal, setDailyGoal] = useState(sys.dailyGoalUsdt ?? "");
  const [goalBreakeven, setGoalBreakeven] = useState(sys.dailyGoalBreakevenEnabled === true);
  useEffect(() => setDailyGoal(sys.dailyGoalUsdt ?? ""), [sys.dailyGoalUsdt]);
  useEffect(() => setGoalBreakeven(sys.dailyGoalBreakevenEnabled === true), [sys.dailyGoalBreakevenEnabled]);
  const savedDailyGoal = sys.dailyGoalUsdt == null ? "" : String(sys.dailyGoalUsdt);
  const goalProtectionDirty = String(dailyGoal) !== savedDailyGoal || goalBreakeven !== (sys.dailyGoalBreakevenEnabled === true);
  async function saveGoalProtection() {
    const amount = Number(dailyGoal);
    if (goalBreakeven && (!Number.isFinite(amount) || amount <= 0)) {
      ui.notify?.(t("启用目标保本前，请先填写大于 0 的每日盈利目标", "Enter a daily profit goal greater than zero before enabling goal-based break-even protection"));
      return;
    }
    await action("/api/system/goals", {
      dailyGoalUsdt: Number.isFinite(amount) && amount > 0 ? amount : null,
      dailyGoalBreakevenEnabled: goalBreakeven
    });
  }
  const active = ["running", "active"].includes(mandate.status);
  // 授权≠低风险：有真实风险等级就用它，否则显示"已授权·风险待评估"，不写死"低风险"。
  const rLabel = /高|中|低/.test(portfolio.riskLabel || "") ? portfolio.riskLabel : null;
  const wall = killed ? { label: t("紧急停止中 · 已阻止新开仓", "Emergency stop active · new entries blocked"), tone: "critical" }
    : active ? { label: rLabel ? `${rLabel} · ${t("运行中", "Running")}` : t("已授权 · 风险待评估", "Authorized · risk pending"), tone: rLabel === "高风险" ? "critical" : rLabel === "中风险" ? "warning" : rLabel ? "ok" : "warning" }
    : { label: t("未授权 · 观察模式", "Not authorized · observe mode"), tone: "warning" };
  const mandateTone = active ? "ok" : statusTone(mandate.status);
  const mandRows = [
    [t("授权范围", "Scope"), (mandate.exchanges || []).length ? t("已授权交易", "Trading authorized") : t("未授权", "Not authorized"), ""],
    [t("交易所", "Exchanges"), (mandate.exchanges || []).join(t("、", ", ")) || "—", ""],
    [t("最大杠杆", "Max leverage"), maxLeverage ? `${maxLeverage}x` : "—", ""],
    [t("单日最大亏损", "Max daily loss"), mandate.maxDailyLossPct ? `${mandate.maxDailyLossPct}%` : "—", "neg"],
    [t("近7日最大亏损", "Rolling 7-day loss"), mandate.id ? `${mandate.maxWeeklyLossPct ?? mandate.max_weekly_loss_pct ?? 5}%` : "—", "neg"],
    [t("审批阈值", "Approval threshold"), approvalThreshold != null && mandate.id ? `${displayMoney(approvalThreshold, 0)} U` : "—", ""],
    [t("有效期", "Valid until"), validUntil ? formatDate(validUntil) : t("长期有效", "No expiry"), ""]
  ];
  const groups = [["账户", "#2A6FDB", "#EAF0FB"], ["交易", "#1F7A50", "#E6F1EA"], ["事件", "#D06A22", "#FBEDDF"], ["系统", "#7A4FD0", "#F0EAFB"]];
  // scope 真实取值是英文(trade/account/event/knowledge),此前中文 includes 恒 0 → 永远"无规则"(审计 M3)
  const scopeOf = (r) => { const t = String(r.scope || r.category || r.name || "").toLowerCase(); if (/account|portfolio|loss|margin|equity|账户/.test(t)) return "账户"; if (/event|事件/.test(t)) return "事件"; if (/system|knowledge|kill|api|系统/.test(t)) return "系统"; return "交易"; };
  const scopeCount = (name) => rules.filter((r) => scopeOf(r) === name).length;
  return (
    <div className="mScreen">
      {showOverview && <div className={`mRiskWall ${wall.tone}`}>
        <ShieldCheck size={22} />
        <div><b>{wall.label}</b><small>{active ? t("交易权限与硬风控生效中", "Trading permissions and hard risk controls are active") : t("先配置交易权限，再开启自主交易", "Configure trading permissions before enabling autonomous trading")}</small></div>
      </div>}
      {showOverview && <div className="mCard mBudgetCard">
        <div className="mBudgetTop"><span>{t("剩余亏损预算", "Remaining loss budget")}</span><b className="mono">{budgetRemain != null ? `${displayMoney(budgetRemain, 2)} USDT` : t("未授权", "Not authorized")}</b></div>
        <div className="mBudgetBar"><i style={{ width: `${budgetPct ?? 0}%` }} /></div>
      </div>}
      {showOverview && (() => {
        // 风险事件处理:按标题折叠去重、显条数,逐组/一键标记已处理(接 close / close-all)。移动版此前完全没有。
        const openInc = (data.riskIncidents || []).filter((i) => i.status === "open");
        const incGroups = [];
        for (const inc of openInc) { const k = inc.title || inc.source || "风险事件"; const g = incGroups.find((x) => x.key === k); if (g) { g.count += 1; g.items.push(inc); } else incGroups.push({ key: k, count: 1, items: [inc] }); }
        return <div className="mCard">
          <div className="mCardHead"><b>{t("风险事件", "Risk incidents")}</b><span className={openInc.length ? "mIncCount on" : "mIncCount"}>{openInc.length ? `${openInc.length} ${t("项未处理", "unresolved")}` : t("全部已处理", "All resolved")}</span></div>
          {!openInc.length && <div className="mEmpty">{t("当前没有未处理的风险事件。", "No unresolved risk incidents.")}</div>}
          {incGroups.map((g) => (
            <div className="mIncRow" key={g.key}>
              <div className="mIncL"><b>{g.key}</b>{g.count > 1 && <span className="mIncX">×{g.count}</span>}</div>
              <button className="mIncBtn" onClick={async () => { for (const inc of g.items) await action(`/api/risk/incidents/${inc.id}/close`, {}); ui.notify?.(t("已处理", "Resolved")); }}>{g.count > 1 ? `${t("处理", "Resolve")} ${g.count}${t(" 项", "")}` : t("标记已处理", "Mark resolved")}</button>
            </div>
          ))}
          {openInc.length > 1 && <button className="mLink2" onClick={() => action("/api/risk/incidents/close-all", {})}>{t("全部标记已处理", "Mark all resolved")} ›</button>}
        </div>;
      })()}
      {showSettings && <div className="mCard">
        <div className="mCardHead"><b>{t("交易权限", "Trading permissions")}</b><StatusBadge tone={mandateTone}>{humanize(mandate.status, t("未设置", "Not configured"))}</StatusBadge></div>
        <div className="mMandList">{mandRows.map(([k, v, tone]) => <div className="mMandRow" key={k}><span>{k}</span><b className={`mono ${tone}`}>{v}</b></div>)}</div>
        <button className="mLink2" onClick={() => ui.openPanel("mandate")}>{t("编辑交易权限", "Edit trading permissions")} ›</button>
      </div>}
      {showOverview && <div className="mCard">
        <div className="mCardHead"><b>{t("风险规则", "Risk rules")}</b></div>
        <div className="mRuleGrid2">{groups.map(([name, c, bg]) => { const n = scopeCount(name); const label = { "账户": t("账户", "Account"), "交易": t("交易", "Trading"), "事件": t("事件", "Events"), "系统": t("系统", "System") }[name] || name; return <div className="mRuleCard2" key={name} style={{ background: bg }}><b style={{ color: c }}>{label}</b><small>{n ? `${n} ${t("条已启用", "enabled")}` : t("无规则", "No rules")}</small><i style={{ background: c }} /></div>; })}</div>
      </div>}
      {showSettings && <div className="mCard">
        <div className="mCardHead"><b>{t("实盘写入与灰度", "Live trading & rollout")}</b><StatusBadge tone={data.config?.liveTrading?.effective ? "danger" : "neutral"}>{data.config?.liveTrading?.effective ? t("实盘已开启", "Live on") : t("实盘关闭", "Live off")}</StatusBadge></div>
        <LiveGrayPanel data={data} action={action} ui={ui} />
      </div>}
      {showSettings && <div className="mCard mGoalProtectionCard">
        <div className="mCardHead"><b>{t("盈利目标保护", "Profit goal protection")}</b><StatusBadge tone={goalBreakeven ? "ok" : "neutral"}>{goalBreakeven ? t("已开启", "On") : t("未开启", "Off")}</StatusBadge></div>
        <label className="mGoalAmount"><span><b>{t("每日盈利目标", "Daily profit goal")}</b><small>{t("必须明确保存；没有目标时不会触发", "Must be explicitly saved; no goal means no trigger")}</small></span><div><input type="number" min="0.01" step="0.01" inputMode="decimal" value={dailyGoal} onChange={(event) => setDailyGoal(event.target.value)} aria-label={t("每日盈利目标", "Daily profit goal")} /><i>USDT</i></div></label>
        <small className="mGoalDerived">{t(`月度目标自动为日目标 × 当月 ${sys.monthlyGoalDays || 30} 天${sys.monthlyGoalUsdt ? ` = ${sys.monthlyGoalUsdt} USDT` : ""}`, `Monthly goal is daily goal × ${sys.monthlyGoalDays || 30} days${sys.monthlyGoalUsdt ? ` = ${sys.monthlyGoalUsdt} USDT` : ""}`)}</small>
        <label className="mGoalToggle"><input type="checkbox" checked={goalBreakeven} onChange={(event) => setGoalBreakeven(event.target.checked)} /><span><b>{t("单个持仓浮盈达到目标后，止损至少保护到开仓价", "Move the stop to at least entry after one position reaches the goal")}</b><small>{t("只管理 AI 开立的仓位；不会放宽更有利的止损，也不改变止盈和跟踪止损", "Only AI-opened positions; never weakens a better stop or changes take-profit and trailing-stop logic")}</small></span></label>
        <button type="button" className="primaryButton mGoalSave" disabled={!goalProtectionDirty} onClick={saveGoalProtection}>{t("保存盈利保护", "Save profit protection")}</button>
      </div>}

      {showOverview && <div className="mRiskBtns">
        <button className="mRbPause" onClick={() => action("/api/system/autonomy", { enabled: false })}>{t("暂停自主", "Pause autonomy")}</button>
        <button className="mRbReduce" onClick={async () => { const on = Boolean(data.system?.reduceOnlyMode); if (await uiConfirm(on ? t("关闭只减仓模式?", "Turn off reduce-only mode?") : t("开启只减仓模式?将禁止新开仓,仅允许减仓/平仓/撤单。", "Turn on reduce-only mode? New positions will be blocked; only reduce/close/cancel allowed."))) action("/api/risk/reduce-only", { enabled: !on }); }}>{data.system?.reduceOnlyMode ? t("退出只减仓", "Exit reduce-only") : t("只减仓", "Reduce-only")}</button> {/* 此前只是打开规则面板,不减仓(审计 M2) */}
        <button className="mRbKill" onClick={() => action("/api/risk/kill-switch", { enabled: !killed, reason: "" })}>{killed ? t("恢复新交易", "Resume trading") : t("紧急停止", "Emergency stop")}</button>
      </div>}
    </div>
  );
}

const KNOW_SEGMENTS = ["上手", "方法", "技能", "规则", "图谱"];
function MobileKnowledge({ data, action, ui, view = "all" }) {
  // 与桌面对齐:知识库(view=knowledge)只留 上手/方法/规则/图谱;能力与工具(view=capabilities)只留 技能。
  const segs = view === "capabilities" ? ["技能"] : view === "knowledge" ? ["上手", "方法", "规则", "图谱"] : KNOW_SEGMENTS;
  const [segState, setSeg] = useState(view === "capabilities" ? "技能" : "上手");
  const seg = segs.includes(segState) ? segState : segs[0];
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
    { n: 1, Icon: BookOpen, title: t("喂知识", "Feed knowledge"), desc: t("导入交易书籍或文章，自动蒸馏出方法与风控纪律。", "Import trading books or articles; methods and risk discipline are distilled automatically."), cta: t("导入知识源", "Import source"), on: () => ui.openPanel("knowledgeImport") },
    { n: 2, Icon: Rocket, title: t("编译 + 验证", "Compile + validate"), desc: t("把方法编译成技能，跑历史回测 + 纯前向模拟盘。", "Compile methods into skills, run historical backtest + pure forward paper trading."), cta: t("去方法", "Go to methods"), on: () => setSeg("方法") },
    { n: 3, Icon: ShieldCheck, title: t("人工批准上岗", "Manual approval"), desc: t("只有你亲自批准的技能才进入实盘决策。", "Only skills you personally approve enter live decision-making."), cta: t("去技能", "Go to skills"), on: () => setSeg("技能") }
  ];

  async function search() {
    if (!query.trim()) return;
    const result = await action("/api/knowledge/rag-query", { query: query.trim(), topK: 5 });
    // 后端返回 analysisBundle{summary,retrievedRefs[]},没有 hits/results/chunks(此前永远"没有命中",审计 H6)
    const refs = (result.retrievedRefs || []).map((r) => ({ text: r.citationLocator, score: r.score }));
    setHits(result.id ? [{ text: result.summary, score: null }, ...refs] : []);
  }

  return (
    <div className="mSubPage">
      <div className="mChips">
        {segs.map((name) => <button key={name} className={seg === name ? "active" : ""} onClick={() => setSeg(name)}>{name}{name === "方法" && methods.length ? ` ${methods.length}` : ""}{name === "技能" && skills.length ? ` ${skills.filter((k) => !["compile_failed", "superseded", "retired"].includes(k.status)).length}` : ""}{name === "规则" && rules.length ? ` ${rules.length}` : ""}{name === "图谱" && knowledge.conceptCards?.length ? ` ${knowledge.conceptCards.length}` : ""}</button>)}
      </div>

      {seg === "上手" && (
        <>
          <div className="mKGuide">
            <div className="mKGuideTitle"><Sparkles size={14} /> {t("知识库怎么用？三步让 AI 交易员变强", "How to use the knowledge base? Three steps to sharpen your AI trader")}</div>
            {guide.map((s) => {
              const state = s.n < step ? "done" : s.n === step ? "active" : "todo";
              const Icon = state === "done" ? CheckCircle2 : s.Icon;
              return (
                <div className={`mKStep ${state}`} key={s.n}>
                  <span className="mKStepIcon"><Icon size={16} /></span>
                  <div className="mKStepBody">
                    <b>{s.title}{state === "active" && <em>{t(" · 现在做这步", " · do this now")}</em>}{state === "done" && <em className="ok">{t(" · 已完成", " · done")}</em>}</b>
                    <p>{s.desc}</p>
                    <button className={state === "active" ? "mMiniPrimary" : "mMiniGhost"} onClick={s.on}>{s.cta} ›</button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mPageStats">
            <div><span>{t("知识源", "Sources")}</span><strong>{sources.length}</strong></div>
            <div><span>{t("交易方法", "Methods")}</span><strong>{methods.length}</strong></div>
            <div><span>{t("已上岗技能", "Live skills")}</span><strong>{active}</strong></div>
          </div>

          <div className="mSearchBar">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("检索知识库，如：CPI 前如何控仓", "Search the knowledge base, e.g. how to size before CPI")} onKeyDown={(event) => { if (event.key === "Enter") search(); }} />
            <button onClick={search} aria-label={t("检索", "Search")}><Search size={16} /></button>
          </div>
          {hits !== null && (
            <div className="mSectionCard">
              <header><span>{t("检索结果（", "Results (")}{hits.length}{t("）", ")")}</span></header>
              {!hits.length && <p className="mInboxEmpty">{t("没有命中的知识片段。", "No matching knowledge snippets.")}</p>}
              {hits.slice(0, 5).map((hit, index) => <p className="mLeadLine" key={index}>{String(hit.text || "").slice(0, 120)}{hit.score != null ? ` · ${hit.score}` : ""}</p>)}
            </div>
          )}

          <div className="mSectionCard">
            <header><span>{t("知识源（", "Sources (")}{sources.length}{t("）", ")")}</span><button className="textButton" onClick={() => ui.openPanel("knowledgeList")}>{t("全部", "All")} <ChevronRight size={12} /></button></header>
            {!sources.length && <p className="mInboxEmpty">{t("还没有导入知识。点下方「导入知识」开始。", "No knowledge imported yet. Tap \"Import knowledge\" below to start.")}</p>}
            {sources.slice(0, 8).map((source) => (
              <div className="mRowItem" key={source.id || source.title}>
                <b>{source.title || source.name || t("未命名", "Untitled")}</b>
                <StatusBadge tone={statusTone(source.status)}>{humanize(source.status, t("已导入", "Imported"))}</StatusBadge>
              </div>
            ))}
          </div>
          <button className="mPrimaryAction" onClick={() => ui.openPanel("knowledgeImport")}><Plus size={15} /> {t("导入知识", "Import knowledge")}</button>
        </>
      )}

      {seg === "方法" && (
        <div className="mSectionCard">
          <header><span>{t("交易方法草案（", "Method drafts (")}{methods.length}{t("）", ")")}</span><small>{t("需走验证才上岗", "Must pass validation to go live")}</small></header>
          {!methods.length && <p className="mInboxEmpty">{t("导入书籍后自动蒸馏交易方法草案。", "Method drafts are distilled automatically after importing books.")}</p>}
          {methods.map((m) => {
            const compiled = compiledIds.has(m.id);
            const open = openId === m.id;
            return (
              <div className={`mKRow ${open ? "open" : ""}`} key={m.id}>
                <button className="mKRowHead" onClick={() => setOpenId(open ? null : m.id)}>
                  <span className={`mDir ${m.direction}`}>{m.direction === "short" ? t("空", "Short") : m.direction === "long" ? t("多", "Long") : t("多空", "Both")}</span>
                  <b>{m.name}</b>
                  <StatusBadge tone={compiled ? "ok" : "neutral"}>{compiled ? t("已编译", "Compiled") : t("草案", "Draft")}</StatusBadge>
                </button>
                {open && (
                  <div className="mKRowBody">
                    <p><i>{t("进场", "Entry")}</i>{m.entry || "-"}</p>
                    <p><i>{t("止损", "Stop-loss")}</i>{m.stop || "-"}</p>
                    <p><i>{t("止盈", "Take-profit")}</i>{m.takeProfit || "-"}</p>
                    {m.source?.title && <p className="mKSrc">《{m.source.title}》</p>}
                    {!compiled && <button className="mMiniPrimary" onClick={() => action(`/api/knowledge/methods/${m.id}/compile`, {})}>{t("编译为技能草案", "Compile to skill draft")} ›</button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {seg === "技能" && (
        <div className="mSectionCard">
          <header><span>{t("技能流水线（", "Skill pipeline (")}{skills.length}{t("）", ")")}</span><span style={{ display: "flex", gap: 8 }}>{(async () => { const n = skills.filter(async (k) => ["compiled", "historical_rejected"].includes(k.status)).length; return n > 0 && <button className="textButton" onClick={async () => { if (await uiConfirm(`${t("批量历史验证", "Batch historical validation for")} ${n} ${t("个技能?", "skills?")}`)) action("/api/knowledge/skills/validate-all", {}); }}>{t("一键验证", "Validate all")}({n})</button>; })()}<button className="textButton" onClick={async () => action("/api/knowledge/skills/sync", {})}>{t("同步", "Sync")}</button></span></header>
          <div className="mKLegend">
            <button className="mKLegendHead" onClick={() => setLegendOpen((v) => !v)}><Info size={13} /> {t("这些状态是什么意思？", "What do these statuses mean?")}<ChevronDown size={13} className={legendOpen ? "flip" : ""} /></button>
            {legendOpen && SKILL_STATE_HELP.map(([label, tone, desc]) => (
              <div className="mKLegendRow" key={label}><StatusBadge tone={tone}>{label}</StatusBadge><span>{desc}</span></div>
            ))}
          </div>
          {!skills.length && <p className="mInboxEmpty">{t("还没有技能。到「方法」把方法编译成技能草案后在此推进验证。", "No skills yet. Go to Methods, compile a method into a skill draft, then advance validation here.")}</p>}
          {(() => {
            const ARCHIVED = new Set(["compile_failed", "superseded", "retired"]);
            const STATUS_RANK = { paper_validated: 0, historical_validated: 1, paper_validating: 2, compiled: 3, degraded: 4, historical_rejected: 5, paper_rejected: 6 };
            const live = skills.filter((s) => !ARCHIVED.has(s.status))
              .sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9));
            const archived = skills.filter((s) => ARCHIVED.has(s.status));
            const row = (skill) => {
              const st = SKILL_STATE[skill.status] || { label: skill.status, tone: "neutral" };
              const open = openId === skill.id;
              return (
                <div className={`mKRow ${open ? "open" : ""}`} key={skill.id}>
                  <button className="mKRowHead" onClick={() => setOpenId(open ? null : skill.id)}>
                    {skill.spec?.direction && <span className={`mDir ${skill.spec.direction}`}>{skill.spec.direction === "short" ? t("空", "Short") : t("多", "Long")}</span>}
                    <b>{skill.name} <span className="mono">v{skill.version}</span></b>
                    {skill.spec?.lowTrust && <StatusBadge tone="warning">{t("低信任", "Low trust")}</StatusBadge>}
                    <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                  </button>
                  {open && (
                    <div className="mKRowBody">
                      <p className="mKSrc">{skill.spec?.templateLabel || t("未编译", "Not compiled")} · {skill.spec?.timeframe || "-"}{skill.sourceTitle ? ` · 《${skill.sourceTitle}》` : ""}</p>
                      {skill.compileErrors?.length > 0 && <p className="mKErr">{t("不能执行：", "Cannot execute: ")}{skill.compileErrors.join(t("；", "; "))}</p>}
                      {skill.status === "superseded" && <p className="mKSrc">{t("已被更新版本替代，仅作追溯。", "Superseded by a newer version; kept for traceability.")}</p>}
                      {skill.liveMetrics && <p><i>{t("实盘", "Live")}</i>{skill.liveMetrics.trades}{t(" 笔 · 胜率 ", " trades · Win ")}{skill.liveMetrics.winRatePct}%</p>}
                      {st.next && <button className="mMiniPrimary" onClick={() => action(`/api/knowledge/skills/${skill.id}/${st.next.action}`, {})}>{st.next.label} ›</button>}
                      {skill.status === "compile_failed" && skill.sourceMethodId && <button className="mMiniPrimary" onClick={() => action(`/api/knowledge/methods/${skill.sourceMethodId}/compile`, {})}>{t("重新编译", "Recompile")} ›</button>}
                    </div>
                  )}
                </div>
              );
            };
            return (
              <>
                {live.map(row)}
                {!live.length && skills.length > 0 && <p className="mInboxEmpty">{t("当前没有在流水线中的活技能，只有归档技能。", "No active skills in the pipeline, only archived skills.")}</p>}
                {archived.length > 0 && (
                  <>
                    <div className="mKArchiveHead">
                      <button onClick={() => setArchivedOpen((v) => !v)}><ChevronDown size={12} className={archivedOpen ? "flip" : ""} /> {t("已归档", "Archived")} {archived.length}</button>
                      <button className="mKArchivePurge" onClick={async () => { if (await uiConfirm(t("清理归档：删除编译失败与已被替代的技能？（已退役保留）", "Purge archive: delete compile-failed and superseded skills? (retired ones are kept)"))) action("/api/knowledge/skills/purge-archived", {}); }}><Trash2 size={11} /> {t("清理", "Purge")}</button>
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
          <header><span>{t("风控纪律（", "Risk discipline (")}{rules.length}{t("）", ")")}</span><button className="textButton" onClick={() => ui.openPanel("ruleLibrary")}>{t("管理/去重", "Manage/dedupe")} <ChevronRight size={12} /></button></header>
          {!rules.length && <p className="mInboxEmpty">{t("导入资料后自动抽取风控纪律。", "Risk discipline is extracted automatically after importing material.")}</p>}
          {rules.slice(0, 20).map((r) => (
            <div className="mRowItem" key={r.id}>
              <b>{r.name}</b>
              <StatusBadge tone={r.status === "已批准" ? "ok" : "warning"}>{humanize(r.status, t("待审批", "Pending approval"))}</StatusBadge>
            </div>
          ))}
          {rules.length > 0 && <button className="mPrimaryAction" onClick={() => ui.openPanel("ruleLibrary")}>{t("去规则库批准 / 去重", "Approve / dedupe in rule library")} ›</button>}
        </div>
      )}

      {seg === "图谱" && (
        <div className="mSectionCard">
          <header><span>{t("概念图谱（", "Concept graph (")}{knowledge.conceptCards?.length || 0}{t("）", ")")}</span><small>{t("相关概念自动聚簇", "Related concepts cluster automatically")}</small></header>
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
        <div><span>{t("今日事件", "Today's events")}</span><strong>{todayEvents.length}</strong></div>
        <div><span>{t("活跃任务", "Active tasks")}</span><strong>{activeTasks.length}</strong></div>
        <div><span>{t("事件规则", "Event rules")}</span><strong>{(data.riskRules || []).filter((rule) => rule.scope === "event").length}</strong></div>
      </div>

      <div className="mChips">
        {taskSegments.map((name) => (
          <button key={name} className={segment === name ? "active" : ""} onClick={() => setSegment(name)}>{name}</button>
        ))}
      </div>

      {segment === "重要事件" && (
        <div className="mSectionCard">
          <header>
            <span>{t("重要事件", "Key events")}</span>
            <button className="textButton" onClick={() => action("/api/event-sources/refresh", {})}><RefreshCw size={12} /> {t("刷新", "Refresh")}</button>
          </header>
          {!events.length && <p className="mInboxEmpty">{t("暂无事件。点击刷新拉取事件源。", "No events. Tap refresh to pull event sources.")}</p>}
          {events.map((event) => (
            <div className="mRowItem" key={event.id} title={event.rawTitle || event.title}>
              <span>{formatDateTime(event.due, t("待定", "TBD"))}</span>
              <b>{event.shortTitle || event.title}</b>
              <StatusBadge tone={event.impact >= 80 ? "danger" : event.impact >= 50 ? "warning" : "neutral"}>{event.impactLabel || t("待评估", "Pending")}</StatusBadge>
            </div>
          ))}
        </div>
      )}

      {segment === "定时任务" && (
        <div className="mSectionCard">
          <header><span>{t("定时任务（", "Scheduled tasks (")}{tasks.length}{t("）", ")")}</span></header>
          {!tasks.length && <p className="mInboxEmpty">{t("暂无定时任务。", "No scheduled tasks.")}</p>}
          {tasks.map((task) => (
            <div className="mRuleRow" key={task.id}>
              <span>
                <b>{task.name}</b>
                <small>{task.schedule || "Every 1h"} · {humanize(task.status || "running")}</small>
              </span>
              <div className="mRowActions">
                <button onClick={() => action(`/api/tasks/${task.id}/run`, {})}>{t("运行", "Run")}</button>
                <button onClick={() => action(`/api/tasks/${task.id}/${task.enabled === false ? "resume" : "pause"}`, task.enabled === false ? {} : { reason: "manual_ui" })}>{task.enabled === false ? t("恢复", "Resume") : t("暂停", "Pause")}</button>
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
  const openExecutions = countOpenExecutions(data.executionOrders);
  const blockedChecks = (data.riskChecks || []).filter((item) => ["blocked", "rejected", "risk_rejected"].includes(String(item.decision || item.result || item.status || "").toLowerCase())).length;
  const rows = [
    [t("交易所账户", "Exchange accounts"), `${configuredAccounts} / ${totalAccounts}`, configuredAccounts ? "ok" : "neutral"],
    [t("私有账户快照", "Account snapshot"), latestSnapshot ? formatDateTime(latestSnapshot.createdAt) : t("未同步", "Not synced"), latestSnapshot ? "ok" : "neutral"],
    [t("对账状态", "Reconciliation"), configuredAccounts ? humanize(latestReconcile?.status, t("未对账", "Not reconciled")) : t("待配置", "Not configured"), latestReconcile?.status === "ok" ? "ok" : "neutral"],
    [t("实盘写入", "Live trading"), data.system?.liveTradingEnabled ? t("已开启", "On") : t("关闭", "Off"), data.system?.liveTradingEnabled ? "warning" : "neutral"], // 主动授权开关≠故障,与桌面口径一致用提醒色
    [t("在途执行", "In-flight executions"), `${openExecutions}${t(" 个", "")}`, openExecutions ? "warning" : "ok"],
    [t("近期风控阻断", "Recent risk blocks"), `${blockedChecks}${t(" 次", "")}`, blockedChecks ? "warning" : "ok"]
  ];
  return (
    <div className="mSubPage">
      <div className="mPageStats">
        <div><span>{t("账户", "Accounts")}</span><strong>{configuredAccounts}/{totalAccounts}</strong></div>
        <div><span>{t("快照", "Snapshot")}</span><strong>{latestSnapshot ? formatTime(latestSnapshot.createdAt) : t("未同步", "Not synced")}</strong></div>
        <div><span>{t("对账", "Reconcile")}</span><strong>{configuredAccounts ? humanize(latestReconcile?.status, t("未对账", "Not reconciled")) : t("待配置", "Not configured")}</strong></div>
      </div>

      <div className="mSectionCard">
        <header><span>{t("健康检查", "Health check")}</span></header>
        {rows.map(([label, value, tone]) => (
          <div className="mRowItem" key={label}>
            <b>{label}</b>
            <em className="mRowValue">{value}</em>
            <StatusBadge tone={tone}>{tone === "ok" ? t("正常", "OK") : tone === "danger" ? t("注意", "Attention") : tone === "warning" ? t("待处理", "Pending") : t("待配置", "Not configured")}</StatusBadge>
          </div>
        ))}
      </div>

      <button className="mPrimaryAction" onClick={() => action("/api/reconciler/run", { mode: "manual_ui" })}><RefreshCw size={15} /> {t("手动对账", "Manual reconcile")}</button>
    </div>
  );
}

// 全部 OKX USDT 永续合约清单(真实拉取),供移动版行情搜索选币用。
function useMobileInstruments() {
  const [list, setList] = useState([]);
  useEffect(() => {
    let alive = true;
    fetch(apiUrl("/api/market/instruments"), { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : { instruments: [] }))
      .then((d) => { if (alive) setList((d.instruments || []).map((i) => i.symbol || i).filter(Boolean)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return list;
}

// 移动版底部弹层选币器:搜索全部永续合约、点选切换、可加自选。替代原来只有 4 个硬编码的 pill。
function MobilePairSheet({ instruments, current, onPick, onClose, onAddWatch }) {
  const [q, setQ] = useState("");
  const [drag, setDrag] = useState(0);
  const startY = useRef(null);
  const qU = q.trim().toUpperCase();
  const list = (instruments || []).filter((s) => !qU || s.includes(qU)).slice(0, 200);
  // 下滑关闭手势:拖住把手往下拉超过阈值即关闭。
  const dStart = (e) => { startY.current = e.touches[0].clientY; };
  const dMove = (e) => { if (startY.current == null) return; const dy = e.touches[0].clientY - startY.current; if (dy > 0) setDrag(dy); };
  const dEnd = () => { const close = drag > 90; startY.current = null; if (close) { haptic("light"); onClose(); } else setDrag(0); };
  return (
    <div className="mSheetOverlay" onClick={onClose}>
      <div className="mSheet" onClick={(e) => e.stopPropagation()} style={{ transform: drag ? `translateY(${drag}px)` : "", transition: startY.current == null ? "transform .22s ease-out" : "none" }}>
        <div className="mSheetGrip" onTouchStart={dStart} onTouchMove={dMove} onTouchEnd={dEnd}><span /></div>
        <div className="mSheetHead"><b>{t("选择币对", "Select pair")}</b><button className="mSheetClose" onClick={onClose} aria-label={t("关闭", "Close")}><ChevronDown size={20} /></button></div>
        <div className="mSheetSearch"><Search size={15} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("输入币种，如 BTC / SOL", "Enter a symbol, e.g. BTC / SOL")} /></div>
        <div className="mSheetList">
          {list.map((s) => (
            <button key={s} className={`mSheetRow ${s === current ? "on" : ""}`} onClick={() => { onPick(s); onClose(); }}>
              <span>{s}</span>
              {onAddWatch && <span className="mSheetAdd" role="button" onClick={(e) => { e.stopPropagation(); onAddWatch(s); }}><Plus size={15} /></span>}
            </button>
          ))}
          {!list.length && <div className="mEmpty">{instruments && instruments.length ? t("无匹配币对", "No matching pairs") : t("合约清单加载中…", "Loading contract list…")}</div>}
        </div>
      </div>
    </div>
  );
}

function MobileMarket({ data, action, ui }) {
  const [tf, setTf] = useState("1H");
  const [sym, setSym] = useState(null);
  const [sheet, setSheet] = useState(false);
  const instruments = useMobileInstruments();
  const portfolio = data.portfolio || {};
  const configured = (data.exchangeAccounts || []).some((a) => a.readEnabled);
  const markets = (data.markets || []).filter((m) => m && m.symbol);
  // 选中的币对可能不在已同步的 markets 里(从全量清单选的),用最小对象兜底让图表/标题正常切换。
  const market = markets.find((m) => m.symbol === sym) || (sym ? { symbol: sym, candles: [] } : markets[0]) || { symbol: "BTC/USDT", candles: [] };
  const positions = data.positions || [];
  const equity = portfolio.totalEquityUsdt;
  const avail = portfolio.availableMarginUsdt;
  // 保证金口径统一走 lib.marginUsage(含冻结保证金;缺数据=null,不造假)。
  const { usedMarginUsdt: used, marginRatePct: marginRate } = marginUsage(portfolio);
  const metrics = [
    [t("总资产", "Total equity"), configured && equity != null ? displayMoney(equity, 2) : t("未同步", "Not synced"), null],
    [t("今日盈亏", "Today's PnL"), configured && portfolio.todayPnl != null ? `${portfolio.todayPnl >= 0 ? "+" : ""}${displayMoney(portfolio.todayPnl, 2)}` : t("未同步", "Not synced"), configured ? portfolio.todayPnl : null],
    [t("可用保证金", "Available margin"), configured && avail != null ? displayMoney(avail, 2) : t("未同步", "Not synced"), null],
    [t("未实现盈亏", "Unrealized PnL"), configured && portfolio.unrealizedPnl != null ? `${portfolio.unrealizedPnl >= 0 ? "+" : ""}${displayMoney(portfolio.unrealizedPnl, 2)}` : t("未同步", "Not synced"), configured ? portfolio.unrealizedPnl : null]
  ];
  const chgPos = Number(market.changePct || 0) >= 0;
  const mediumTerm = data.mediumTermAnalytics || {};
  const mediumSymbol = (mediumTerm.symbols || []).find((row) => row.symbol === market.symbol);
  const leverageLabel = (value) => ({ leverage_build_up:t("杠杆堆积","Leverage build-up"), long_build:t("多头增仓","Long build"), long_build_crowded:t("多头拥挤","Crowded long build"), short_build:t("空头增仓","Short build"), short_build_crowded:t("空头拥挤","Crowded short build"), short_covering:t("空头回补","Short covering"), long_deleveraging:t("多头去杠杆","Long deleveraging"), price_move_without_oi_confirmation:t("价格缺OI确认","Price lacks OI confirmation"), deleveraging_without_direction:t("无方向去杠杆","Directionless deleveraging"), stable_or_mixed:t("稳定/混合","Stable/mixed") }[value] || humanize(value));
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
        <div className="mSnapRow">
          <span>{t("24h高", "24h H")}<b className="mono">{market.high24h != null ? displayMoney(market.high24h, 2) : "—"}</b></span>
          <span>{t("24h低", "24h L")}<b className="mono">{market.low24h != null ? displayMoney(market.low24h, 2) : "—"}</b></span>
          <span>{t("成交额", "Volume")}<b className="mono">{market.volume24h ? String(market.volume24h) : "—"}</b></span>
          <span>{t("资金费率", "Funding")}<b className="mono">{market.fundingRate == null ? "—" : `${Number(market.fundingRate) >= 0 ? "+" : ""}${Number(market.fundingRate).toFixed(4)}%`}</b></span>
        </div>
        <div className="mSymPills">
          {markets.slice(0, 4).map((m) => <button key={m.symbol} className={m.symbol === market.symbol ? "active" : ""} onClick={() => setSym(m.symbol)}>{m.symbol.replace("/USDT", "")}</button>)}
          <button className="mSymMore" onClick={() => setSheet(true)}><Search size={13} /> {t("全部币对", "All pairs")}</button>
        </div>
        <div className="mTfPills">{["15m", "1H", "4H", "1D"].map((t) => <button key={t} className={tf === t ? "active" : ""} onClick={() => setTf(t)}>{t}</button>)}</div>
        <div className="mKline tv"><TradingViewChart symbol={market.symbol} interval={tvInterval} livePrice={market.price} /></div>
      </div>
      <div className="mCard">
        <div className="mCardHead"><b>{t("中频合约状态", "Medium-term contract state")}</b><small>{t("5分钟事实", "5m facts")}</small></div>
        {["15m","1h","4h"].map((window) => { const row=mediumSymbol?.windows?.[window]; return <div className="mPosRow" key={window}><div className="mPosL"><b className="mono">{window}</b><small>{row?.status==="ok"?leverageLabel(row.leverageState):t("样本积累中","Building samples")}</small></div><div className="mPosR"><b className="mono">{row?.status==="ok"?`P ${row.priceChangePct}% · OI ${row.oiChangePct}%`:`${row?.samples??0}/${row?.expected??"—"}`}</b><small className="mono">{row?.status==="ok"?`F ${row.fundingEndPct??"—"}% · CVD ${row.cvdImbalancePct==null?"—":`${row.cvdImbalancePct}%`}`:t("不足时不输出结论","No conclusion until sufficient")}</small></div></div>; })}
        {market.symbol!=="BTC/USDT"&&<div className="mPosRow"><div className="mPosL"><b>BTC Beta</b><small>24h / 3d / 7d</small></div><div className="mPosR"><b className="mono">{["24h","3d","7d"].map((window)=>{const row=mediumSymbol?.btcRisk?.[window];return row?.status==="ok"?`${window} β${row.beta}`:`${window} —`;}).join(" · ")}</b><small>{t("15分钟收益率，严格覆盖", "15m returns with strict coverage")}</small></div></div>}
        {mediumTerm.portfolioBtcRisk?.status&&!['no_positions','insufficient'].includes(mediumTerm.portfolioBtcRisk.status)&&<div className="mPosRow"><div className="mPosL"><b>{t("组合 BTC 风险","Portfolio BTC risk")}</b><small>{mediumTerm.portfolioBtcRisk.status}</small></div><div className="mPosR"><b className="mono">{mediumTerm.portfolioBtcRisk.netBtcEquivalentUsdt} U</b><small>{t("净 / 毛等效","Net / gross equiv.")} {mediumTerm.portfolioBtcRisk.grossBtcBetaExposureUsdt} U</small></div></div>}
        {Object.entries(mediumTerm.eventVolatility?.byType||{}).slice(0,3).map(([type,row])=><div className="mPosRow" key={type}><div className="mPosL"><b>{type}</b><small>{t("BTC 事件波动","BTC event volatility")}</small></div><div className="mPosR"><b className="mono">{row.status==="usable"?`n=${row.samples} · RV ${row.medianPost1hRealizedVolPct}%`:`${row.samples}/${row.minimumSamples}`}</b><small>{row.status==="usable"?`p90 ${row.p90Post1hRealizedVolPct}% · ×${row.medianPost1hVolExpansionRatio}`:t("样本积累中","Building samples")}</small></div></div>)}
      </div>
      <div className="mCard">
        <div className="mCardHead"><b>{t("持仓", "Positions")}</b><button className="mLink" onClick={() => ui.setActive("positions")}>{t("全部", "All")} ›</button></div>
        {positions.length ? positions.slice(0, 3).map((p, i) => {
          const short = String(p.direction || p.side || p.posSide || "").toLowerCase().includes("short");
          const pnl = Number(p.pnl ?? p.upl ?? p.unrealizedPnl ?? 0);
          return (
            <div className="mPosRow" key={i}>
              <div className="mPosL"><b className="mono">{p.symbol || p.instId}</b><span className={`mPosDir ${short ? "short" : "long"}`}>{short ? t("做空", "Short") : t("做多", "Long")}</span></div>
              <div className="mPosR"><b className={`mono ${pnl >= 0 ? "pos" : "neg"}`}>{pnl >= 0 ? "+" : ""}{displayMoney(pnl, 2)}</b><small className="mono">{displayMoney(p.size ?? p.qty ?? p.pos ?? 0, 2)} · {displayPct(p.roiPct ?? p.uplRatioPct)}</small></div>
            </div>
          );
        }) : <div className="mEmpty">{t("连接交易所后显示真实持仓", "Live positions appear after connecting an exchange")}</div>}
      </div>
      <div className="mCard mMarginCard">
        <svg className="mDonut" viewBox="0 0 56 56">
          <circle cx="28" cy="28" r="24" fill="none" stroke="#EDE7DB" strokeWidth="6" />
          <circle cx="28" cy="28" r="24" fill="none" stroke="#D06A22" strokeWidth="6" strokeDasharray={dash} strokeLinecap="round" transform="rotate(-90 28 28)" />
          <text x="28" y="31" textAnchor="middle" className="mDonutTxt">{marginRate != null ? `${marginRate.toFixed(0)}%` : "—"}</text>
        </svg>
        <div className="mMarginInfo"><b>{t("保证金率", "Margin ratio")}</b><small>{marginRate != null ? `${t("已用保证金", "Used margin")} ${marginRate.toFixed(1)}%` : t("连接账户后显示", "Shown after connecting an account")}</small></div>
      </div>
      {sheet && <MobilePairSheet instruments={instruments} current={market.symbol} onPick={setSym} onClose={() => setSheet(false)} onAddWatch={(s) => { action("/api/watchlist", { symbol: s }); ui.notify?.(`${t("已加入自选", "Added to watchlist")} ${s}`); }} />}
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
    [t("API 健康", "API health"), sys.apiHealth || t("未知", "Unknown"), "#2A6FDB", "#EAF0FB"],
    ["WebSocket", data.realtimeStarted ? `${rt.filter((c) => c.status === "connected").length}/${rt.length || 0}` : t("未启动", "Not started"), "#7A4FD0", "#F0EAFB"],
    [t("任务引擎", "Task engine"), String(tasks), "#D06A22", "#FBEDDF"],
    [t("交易所同步", "Exchange sync"), exTotal ? `${exSynced}/${exTotal}` : t("未接入", "Not connected"), "#1F7A50", "#E6F1EA"]
  ];
  const chain = (data.traces || []).slice(0, 6);
  const logs = (data.auditLogs || []).slice(0, 5);
  return (
    <div className="mScreen">
      <div className="mMetric2x2">
        {sysCards.map(([k, v, c, bg]) => <div className="mMetricCell" key={k}><span style={{ color: c }}>{k}</span><b className="mono" style={{ color: c }}>{v}</b><i className="mSysDot" style={{ background: bg }} /></div>)}
      </div>
      <div className="mCard">
        <div className="mCardHead"><b>{t("最近运行记录", "Recent runs")}</b><button className="mLink" onClick={() => ui.openPanel("auditChain")}>{t("完整", "Full")} ›</button></div>
        {chain.length ? chain.map((t, i) => (
          <div className="mChainRow" key={t.id || i}>
            <span className={`mChainDot ${statusTone(t.status)}`} />
            <div className="mChainMid"><b>{t.title || t.type}</b><small className="mono">{t.id ? String(t.id).slice(0, 14) : t.type}</small></div>
            <small className="mono mChainTime">{formatTime(t.createdAt)}</small>
          </div>
        )) : <div className="mEmpty">{t("暂无审计链记录", "No audit trail records")}</div>}
      </div>
      <div className="mCard">
        <div className="mCardHead"><b>{t("决策与工具日志", "Decision & tool logs")}</b></div>
        {logs.length ? logs.map((l, i) => (
          <div className="mLogRow" key={l.id || i}>
            <small className="mono">{formatTime(l.createdAt)}</small>
            <b>{l.action}</b>
            <StatusBadge tone={statusTone(l.severity)}>{humanize(l.severity || "ok")}</StatusBadge>
          </div>
        )) : <div className="mEmpty">{t("暂无日志", "No logs")}</div>}
      </div>
    </div>
  );
}

// 屏 S1 — AI 交易员：顶栏下 4 等分状态条。
function MobileChatStatus({ data, ui }) {
  const sys = data.system || {};
  const pf = data.portfolio || {};
  const autoOn = sys.autonomyEnabled === true && !sys.killSwitch;
  const smMob = data.marketRegime?.smartMoney || {};
  // 与桌面端共用 smartMoneyBias（1.05/0.95 三档），不再用 >=1 二分导致两端结论矛盾。
  const bias = smMob.ok ? smartMoneyBias(smMob.topTraderLongShortRatio).label : t("待同步", "Pending sync");
  const mandate = data.mandates?.find((m) => ["active", "running"].includes(m.status));
  const cells = [
    [t("状态", "Status"), autoOn ? t("运行中", "Running") : t("已暂停", "Paused"), autoOn ? "pos" : ""],
    [t("判断", "Read"), bias, bias === "偏多" ? "pos" : bias === "偏空" ? "neg" : ""],
    [t("今日", "Today"), pf.todayPnlPct != null ? displayPct(pf.todayPnlPct) : "—", Number(pf.todayPnlPct || 0) >= 0 ? "pos" : "neg"],
    [t("目标", "Target"), mandate?.maxDailyLossPct ? `${t("亏≤", "Loss ≤")}${mandate.maxDailyLossPct}${t("%/日", "%/day")}` : "—" /* targetMonthlyPct 是后端从未写入的死字段(审计 L1) */, ""]
  ];
  return (
    <div className="mChatStatusWrap"><div className="mChatStatus">
      {cells.map(([k, v, tone]) => <div className="mChatStatCell" key={k}><span>{k}</span><b className={`mono ${tone}`}>{v}</b></div>)}
    </div><div className="mChatShortcuts"><button onClick={()=>ui.setActive("riskHub")}><ShieldCheck/>{t("查看交易限制","Trading limits")}</button><button onClick={()=>ui.setActive("watch")}><Gauge/>{t("实时盯盘","Live watch")}<b>{(data.watchTriggers||[]).filter(item=>item.status==="active").length}</b></button></div></div>
  );
}

// 移动端主导航（与桌面 IA 对齐:交易 / 能力 / 风控与运维），走顶部汉堡抽屉。
// W1b:新增 信号中心(计划看板) + 交易日志,顺序与桌面一致。
// 风控中心(移动版):把风控总览 + 风控设置合并到一个导航项,顶部 Tab 切换。
function MobileRiskHub({ data, action, ui }) {
  const [tab, setTab] = useState("overview");
  return (
    <div className="mHub">
      <div className="mHubTabs">
        <button type="button" className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>{t("风控总览", "Risk overview")}</button>
        <button type="button" className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>{t("风控设置", "Risk settings")}</button>
      </div>
      <MobileRisk data={data} action={action} ui={ui} view={tab} />
    </div>
  );
}

// 策略库(移动版):所有会输出交易主张的策略——蒸馏/导入/LLM。与桌面 StrategyLibraryConcept 同口径。
function MobileStrategy({ data, action }) {
  const studio = data.strategyStudio || {};
  const products = (data.strategyCatalog?.products || []).map((row) => ({ id: row.versionId, name: t(row.definition?.name || row.id, row.definition?.nameEn || row.id), status: row.deployment?.state, origin: t("策略产品", "Product"), timeframe: (row.definition?.timeframes || []).join("/") }));
  const strategies = [...products, ...(data.knowledge?.tradingSkills || []), ...((data.skills || []).filter((s) => s.kind === "strategy"))]
    .map((s, i) => ({ ...s, id: s.id || `str-${i}`, name: s.name || s.title || t("未命名策略", "Untitled strategy"), origin: s.origin || (s.methodId ? t("蒸馏", "Distilled") : s.userAuthored ? t("LLM/手写", "LLM/Manual") : /imported|uploaded|github|clawhub/i.test(String(s.source || "")) ? t("导入", "Imported") : t("内置", "Built-in")) }));
  const [tab, setTab] = useState("catalog");
  const [prompt, setPrompt] = useState("");
  const drafts = studio.drafts || [];
  const [selectedId, setSelectedId] = useState(drafts[0]?.id || "");
  const selected = drafts.find((row) => row.id === selectedId) || drafts[0] || {};
  const latestBt = (studio.backtests || []).find((row) => row.id === selected.latestBacktestId);
  const listings = studio.marketplace?.listings || [];
  const createDraft = async () => {
    if (prompt.trim().length < 12) return;
    const result = await action("/api/strategy/studio/drafts", { prompt }, "POST");
    if (result?.draft?.id) { setSelectedId(result.draft.id); setPrompt(""); if (result.suite?.status === "passed") await action(`/api/strategy/studio/drafts/${result.draft.id}/backtest`, {}, "POST"); }
  };
  const statusLabel = (value) => ({ owner_live_observation:t("实盘观察（未验证）","Live observation"), validated_active:t("证据达标","Evidence-qualified"), tests_passed:t("自动测试通过","Tests passed"), backtest_passed:t("样本外通过","OOS passed"), backtest_failed:t("样本外未通过","OOS failed"), published:t("已发布","Published") }[value] || humanize(value, "—"));
  return (
    <div className="mScreen">
      <div className="mHubTabs mStrategyTabs"><button className={tab === "catalog" ? "active" : ""} onClick={() => setTab("catalog")}>{t("目录", "Catalog")}</button><button className={tab === "studio" ? "active" : ""} onClick={() => setTab("studio")}>{t("工作室", "Studio")}</button><button className={tab === "market" ? "active" : ""} onClick={() => setTab("market")}>{t("市场", "Market")}</button></div>
      {tab === "catalog" && <><div className="mMetric2x2"><div className="mMetricCell"><span>{t("策略总数", "Strategies")}</span><b className="mono">{strategies.length}</b></div><div className="mMetricCell"><span>{t("版本化产品", "Products")}</span><b className="mono pos">{products.length}</b></div><div className="mMetricCell"><span>{t("工作室草稿", "Studio drafts")}</span><b className="mono">{drafts.length}</b></div><div className="mMetricCell"><span>{t("市场发布", "Published")}</span><b className="mono">{studio.marketplace?.summary?.studio || 0}</b></div></div><div className="mCard">{strategies.length ? strategies.map((s) => <div className="mIncRow" key={s.id}><div className="mIncL"><b>{localizeText(s.name)}</b><span className="mIncX">{s.origin}{s.timeframe ? ` · ${s.timeframe}` : ""}</span></div><StatusBadge tone={statusTone(s.status)}>{statusLabel(s.status)}</StatusBadge></div>) : <div className="mEmpty">{t("暂无策略", "No strategies")}</div>}</div></>}
        {tab === "studio" && <div className="mStrategyStack"><div className="mCard"><b className="mSectionTitle">{t("自然语言创建策略", "Create from natural language")}</b><p className="mStrategyHelp">{t("只编译到确定性白名单规则；创建草稿不会下单。", "Compiles only to deterministic allowlisted rules. Drafts never place orders.")}</p><textarea className="mStrategyPrompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t("例：ADA/USDT 1小时，RSI 14 从30下方站回时做多，止损2%，止盈2.5R", "Example: Long ADA/USDT on 1h when RSI(14) crosses back above 30; 2% stop, 2.5R target")}/><button className="mStrategyPrimary" disabled={prompt.trim().length < 12} onClick={createDraft}><Sparkles size={14}/>{t("生成、测试并自动回测", "Generate, test, and backtest")}</button></div>
        {drafts.length ? <div className="mCard"><b className="mSectionTitle">{t("策略草稿", "Strategy drafts")}</b><div className="mStrategyDrafts">{drafts.slice(0,20).map((row) => <button key={row.id} className={row.id === selected.id ? "active" : ""} onClick={() => setSelectedId(row.id)}><span><b>{localizeText(row.blueprint?.name)}</b><small>{row.blueprint?.symbols?.join("/")} · {row.blueprint?.timeframe} · {humanize(row.blueprint?.direction)}</small></span><StatusBadge tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusBadge></button>)}</div></div> : null}
        {selected.id && <><div className="mCard"><b className="mSectionTitle">{t("系统理解的规则", "Compiled rules")}</b><div className="mStrategyFacts"><span>{t("信号", "Signal")}<b>{t(selected.blueprint?.templateName || "—", selected.blueprint?.templateNameEn || selected.blueprint?.templateName || "—")}</b></span><span>{t("止损 / 止盈", "Stop / target")}<b>{selected.blueprint?.exitPolicy?.stopLossPct}% · {selected.blueprint?.exitPolicy?.takeProfitR}R</b></span><span>{t("参数", "Parameters")}<b className="mono">{JSON.stringify(selected.blueprint?.params || {})}</b></span></div></div><div className="mCard"><b className="mSectionTitle">{t("自动测试", "Generated tests")} · {selected.generatedTests?.passed || 0}/{selected.generatedTests?.total || 0}</b>{(selected.generatedTests?.tests || []).map((test) => <div className="mStrategyTest" key={test.id}>{test.passed ? <CheckCircle2 size={14}/> : <Info size={14}/>}<span><b>{t(test.name, test.nameEn || test.name)}</b><small>{t(test.detail, test.detailEn || test.detail)}</small></span></div>)}</div><div className="mCard"><b className="mSectionTitle">{t("样本外证据", "Out-of-sample evidence")}</b>{latestBt ? <div className="mStrategyFacts"><span>{t("交易 / 期望", "Trades / expectancy")}<b>{latestBt.oos?.trades || 0} · {latestBt.oos?.expectancyR ?? "—"}R</b></span><span>PF / {t("回撤", "drawdown")}<b>{latestBt.oos?.profitFactor ?? "—"} · {latestBt.oos?.maxDrawdownPct ?? "—"}%</b></span><span>{t("正向分段", "Positive folds")}<b>{latestBt.positiveFolds}/{latestBt.activeFolds}</b></span></div> : <p className="mStrategyHelp">{t("尚未运行 OKX 历史样本外回测。", "OKX historical OOS backtest has not run.")}</p>}<div className="mStrategyActions"><button disabled={selected.generatedTests?.status !== "passed"} onClick={() => action(`/api/strategy/studio/drafts/${selected.id}/backtest`, {}, "POST")}>{t("运行回测", "Run backtest")}</button><button disabled={!latestBt?.passed || Boolean(selected.publishVersionId)} onClick={() => action(`/api/strategy/studio/drafts/${selected.id}/publish`, {}, "POST")}>{selected.publishVersionId ? t("已发布", "Published") : t("发布到市场", "Publish")}</button></div></div></>}
      </div>}
      {tab === "market" && <div className="mStrategyStack"><div className="mCard"><b className="mSectionTitle">{t("内部策略市场", "Internal strategy market")}</b><p className="mStrategyHelp">{t("不依赖对外 MCP。启用只会加入 AI 可选集，仍须通过全部实时风控。", "Independent of external MCP. Enabling only adds a strategy to the AI eligible set; all live risk checks remain mandatory.")}</p></div>{listings.map((row) => { const def = row.definition || {}; const oos = row.validation?.oos; return <div className="mCard" key={row.id}><div className="mStrategyMarketHead"><b>{t(row.title || def.name, row.titleEn || row.title || def.name)}</b><StatusBadge tone={row.evidenceLevel === "live_validated" ? "ok" : "warning"}>{row.evidenceLevel === "oos_passed" ? t("样本外通过", "OOS passed") : row.evidenceLevel === "live_validated" ? t("实盘证据达标", "Live-validated") : t("实盘观察", "Live observation")}</StatusBadge></div><p className="mStrategyHelp">{t(row.summary || def.description, row.summaryEn || row.summary || def.description)}</p><div className="mStrategyFacts"><span>{t("版本", "Version")}<b className="mono">{row.strategyVersionId}</b></span><span>{t("方向 / 周期", "Side / timeframe")}<b>{humanize(def.direction)} · {(def.timeframes || []).join("/") || def.timeframe || "—"}</b></span><span>{t("证据", "Evidence")}<b>{row.source === "official" ? `${row.metrics?.closedTrades || 0} ${t("笔实盘", "live closes")}` : `${oos?.trades || 0} ${t("笔样本外", "OOS trades")} · ${oos?.expectancyR ?? "—"}R`}</b></span></div>{row.source === "official" ? <button className="mStrategyDisabled" disabled>{row.enabled ? t("系统当前可用", "Available") : t("已暂停", "Paused")}</button> : <button className="mStrategyPrimary" onClick={() => action(`/api/strategy/market/${encodeURIComponent(row.strategyVersionId)}/${row.enabled ? "disable" : "enable"}`, {}, "POST")}>{row.enabled ? t("从 AI 可选集移除", "Remove from AI set") : t("加入 AI 可选集", "Add to AI set")}</button>}</div>; })}</div>}
    </div>
  );
}

const mobileNav = [
  { id: "chat", label: ["AI 交易员", "AI Trader"], code: "ALPHA-01", icon: Bot },
  { id: "watch", label: ["实时盯盘", "Live Watch"], code: "WATCH · LIVE", icon: Gauge },
  { id: "cockpit", label: ["市场与账户", "Market & Account"], code: "MARKET · ACCOUNT", icon: PieChart },
  { id: "executionReview", label: ["执行与复盘", "Execution & Review"], code: "EXECUTION · REVIEW", icon: ClipboardList },
  { id: "tradeLedger", label: ["委托与成交", "Orders & Fills"], code: "ORDERS · FILLS", icon: ReceiptText },
  { id: "riskHub", label: ["风控中心", "Risk Control"], code: "RISK · CONTROL", icon: ShieldCheck },
  { id: "knowledgeBase", label: ["知识库", "Knowledge"], code: "KNOWLEDGE", icon: BookOpen },
  { id: "strategyLib", label: ["策略库", "Strategy"], code: "STRATEGY · LIB", icon: Rocket },
  { id: "eventsTasks", label: ["事件与任务", "Events & Tasks"], code: "EVENTS · TASKS", icon: CalendarClock },
  { id: "auditSystem", label: ["审计", "Audit"], code: "AUDIT · SYSTEM", icon: Activity },
  { id: "systemSettings", label: ["系统设置", "Settings"], code: "SETTINGS · CONFIG", icon: Settings }
];
const mobileNavLabel = (item) => t(item?.label?.[0] || "", item?.label?.[1] || item?.label?.[0] || "");

function MobileHeader({ route, onMenu, right, reconnecting }) {
  const item = mobileNav.find((n) => n.id === route) || mobileNav[0];
  return (
    <header className="mHeader2">
      <button className="mMenuBtn" onClick={onMenu} aria-label={t("打开菜单", "Open menu")}><Menu size={20} /></button>
      <div className="mHeaderMid"><strong>{mobileNavLabel(item)}</strong><small className="mono">{item.code}</small></div>
      <div className="mHeaderRight">
        {reconnecting && <span className="mReconnect"><span className="pulseDot" />{t("重连中", "Reconnecting")}</span>}
        {right}
      </div>
    </header>
  );
}

function NavDrawer({ open, route, onNavigate, onClose, data, lang, switchLang }) {
  if (!open) return null;
  const status = systemStatus(data);
  return (
    <div className="mDrawerOverlay" onClick={onClose}>
      <aside className="mDrawer" onClick={(event) => event.stopPropagation()}>
        <div className="mDrawerBrand"><span className="mDrawerLogo"><img src="/kordyn-logo.svg" alt="KORDYN" /></span><div className="mDrawerBrandText"><b>KORDYN</b><small>AI · DIGITAL ASSET</small></div></div>
        {switchLang && <div className="mLangBar"><Globe2 size={14} /><div className="mLangSeg" role="group" aria-label={t("切换语言", "Switch language")}><button className={lang === "zh" ? "on" : ""} onClick={() => switchLang("zh")}>中文</button><button className={lang === "en" ? "on" : ""} onClick={() => switchLang("en")}>English</button></div></div>}
        <div className="mDrawerNav">
          {mobileNav.map((n) => {
            const Icon = n.icon;
            return <button key={n.id} className={`mDrawerItem ${route === n.id ? "active" : ""}`} onClick={() => onNavigate(n.id)}><Icon size={19} /><span>{mobileNavLabel(n)}</span></button>;
          })}
        </div>
        <div className="mDrawerFoot">
          <div className={`mDrawerStatus ${status.tone}`}><span />{status.label}</div>
          <button className="mDrawerClose" onClick={onClose}>{t("关闭菜单", "Close menu")}</button>
        </div>
      </aside>
    </div>
  );
}

// 下拉刷新:滚到顶再下拉超过阈值 → 触发 refresh + 轻触觉。原生 App 的核心手感。
function PullToRefresh({ onRefresh, className, children }) {
  const ref = useRef(null);
  const startY = useRef(null);
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const THRESHOLD = 66;
  const onStart = (e) => { startY.current = (ref.current && ref.current.scrollTop <= 0 && !busy) ? e.touches[0].clientY : null; };
  const onMove = (e) => {
    if (startY.current == null) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0) { if (e.cancelable) e.preventDefault(); setPull(Math.min(dy * 0.5, 88)); }
    else setPull(0);
  };
  const onEnd = async () => {
    if (startY.current == null) return;
    const shouldRefresh = pull >= THRESHOLD && !busy;
    startY.current = null;
    if (shouldRefresh) { setBusy(true); setPull(46); haptic("light"); try { await onRefresh?.(); } catch { /* 忽略 */ } setBusy(false); }
    setPull(0);
  };
  return (
    <main ref={ref} className={className} onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}
      style={{ transform: pull ? `translateY(${pull}px)` : "", transition: startY.current == null ? "transform .24s cubic-bezier(.2,.8,.2,1)" : "none" }}>
      <div className="mPtr" style={{ opacity: pull || busy ? 1 : 0 }}>
        <RefreshCw size={16} className={busy ? "mSpin" : ""} style={{ transform: busy ? "" : `rotate(${Math.min(pull * 4, 360)}deg)` }} />
        <span>{busy ? t("刷新中…", "Refreshing…") : pull >= THRESHOLD ? t("松开刷新", "Release to refresh") : t("下拉刷新", "Pull to refresh")}</span>
      </div>
      {children}
    </main>
  );
}

export function MobileApp({ api, lang, switchLang }) {
  const { data, action, toast, busy, notify, download, refresh, connectionError } = api;
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
    haptic("light");
    if (next === "tradeJournal") { setRoute("executionReview"); setSubPage(""); setDrawer(false); return; }
    if (mobileNav.some((n) => n.id === next)) { setRoute(next); setSubPage(""); setDrawer(false); return; }
    if (next === "positions" || next === "marketAccount") { setRoute("cockpit"); setSubPage(next); setDrawer(false); return; }
    if (next === "systemSettings") { setRoute("systemSettings"); setSubPage(""); setDrawer(false); return; }
    if (String(next).startsWith("settings:")) { setRoute("systemSettings"); setSubPage(next); setDrawer(false); return; }
    setRoute("cockpit"); setSubPage(""); setDrawer(false);
  }

  const ui = { setActive: navigate, notify, download, refresh, openPanel: setPanel, closePanel: () => setPanel("") };
  const autoOn = data.system?.autonomyEnabled === true && !data.system?.killSwitch;
  const settingsSection = subPage.startsWith("settings:") ? subPage.slice(9) : "";

  let content = null;
  if (route === "chat") {
    content = <div className="content mChatContent"><MobileChatStatus data={data} ui={ui} /><ChatPage data={data} action={action} ui={ui} /></div>;
  } else if (route === "watch") {
    content = <div className="content mSubContent"><WatchMonitorConcept data={data} action={action} ui={ui} /></div>;
  } else if (route === "cockpit") {
    content = subPage === "positions" ? <MobilePositions data={data} action={action} ui={ui} />
      : subPage === "marketAccount" ? <MobileAccountHealth data={data} action={action} />
        : <MobileMarket data={data} action={action} ui={ui} />;
  } else if (route === "executionReview") {
    content = <div className="content mSubContent"><ExecutionReviewConcept data={data} action={action} ui={ui} /></div>;
  } else if (route === "tradeLedger") {
    content = <div className="content mSubContent"><ExecutionLedgerConcept data={data} action={action} ui={ui} /></div>;
  } else if (route === "riskHub") {
    content = <MobileRiskHub data={data} action={action} ui={ui} />;
  } else if (route === "eventsTasks") {
    content = <MobileTasks data={data} action={action} ui={ui} />;
  } else if (route === "knowledgeBase") {
    content = <MobileKnowledge data={data} action={action} ui={ui} view="knowledge" />;
  } else if (route === "strategyLib") {
    content = <div className="content mSubContent"><MobileStrategy data={data} action={action} /></div>;
  } else if (route === "auditSystem") {
    content = <MobileAudit data={data} ui={ui} />;
  } else if (route === "systemSettings") {
    content = settingsSection ? <div className="content mSubContent"><div className="settingsPage"><SystemConfigPanel data={data} action={action} ui={ui} section={settingsSection} /></div></div>
        : <MobileSettingsIndex data={data} onOpen={setSubPage} />;
  } else {
    content = <MobileMarket data={data} action={action} ui={ui} />;
  }

  const headerRight = subPage
    ? <button className="mBack" onClick={() => setSubPage("")} aria-label={t("返回", "Back")}><ChevronLeft size={19} /></button>
    : route === "chat"
      ? <span className={`mRunBadge ${autoOn ? "on" : "off"}`}><span className="pulseDot" />{autoOn ? t("运行中", "Running") : t("已暂停", "Paused")}</span>
      : <button className="mKill" onClick={() => setKillConfirm(true)}><Zap size={13} /> {data.system?.killSwitch ? t("恢复交易", "Resume") : t("紧急停止", "Emergency stop")}</button>;

  return (
    <div className="mShell2">
      <MobileHeader route={route} onMenu={() => setDrawer(true)} right={headerRight} reconnecting={Boolean(connectionError)} />
      {route === "chat" && !subPage
        ? <main className="mMain2 mMainChat">{content}</main>
        : <PullToRefresh className="mMain2" onRefresh={refresh}>{content}</PullToRefresh>}
      <NavDrawer open={drawer} route={route} onNavigate={navigate} onClose={() => setDrawer(false)} data={data} lang={lang} switchLang={switchLang} />
      {killConfirm && <KillConfirmDialog enable={!data.system?.killSwitch} action={action} onClose={() => setKillConfirm(false)} />} {/* 已熔断时应走解除流程(审计 L5) */}
      {panel && <ConfigPanel panel={panel} data={data} action={action} ui={ui} />}
      {busy && <div className="busyIndicator"><Activity size={13} /> {t("执行中", "Working")}</div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
