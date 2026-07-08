import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUp,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  History,
  MessageSquare,
  Radar,
  RefreshCw,
  Trash2,
  KeyRound,
  ListChecks,
  PlugZap,
  Plus,
  Shield,
  Target,
  TrendingUp,
  Wrench,
  XCircle
} from "lucide-react";
import { apiUrl, displayMoney, displayPct, formatDateTime, formatTime, humanize, statusTone, StatusBadge, SymbolChips } from "./lib.jsx";

function authHeaders(extra = {}) {
  const token = localStorage.getItem("agent_token") || "";
  return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

function renderInline(text = "") {
  return String(text).split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : <React.Fragment key={index}>{part}</React.Fragment>
  );
}

function visualTone(text = "") {
  const value = String(text);
  if (/风险|警告|阻断|拒绝|失败|止损|亏损|回撤|不要|禁止|未配置|异常/.test(value)) return "danger";
  if (/等待|观察|谨慎|不确定|授权|确认|未同步|建议/.test(value)) return "warning";
  if (/机会|通过|正常|优势|盈利|止盈|完成|可执行/.test(value)) return "ok";
  return "neutral";
}

function sectionIcon(title = "") {
  if (/结论|判断|摘要/.test(title)) return Target;
  if (/依据|数据|行情|指标/.test(title)) return BarChart3;
  if (/风险|限制|注意/.test(title)) return AlertTriangle;
  if (/下一步|计划|动作|执行/.test(title)) return ListChecks;
  if (/机会|方向|趋势/.test(title)) return TrendingUp;
  return BrainCircuit;
}

function parseRichText(text = "") {
  const blocks = [];
  let paragraph = [];
  let bullets = [];
  let steps = [];
  let metrics = [];

  function flushParagraph() {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", text: paragraph.join("\n") });
      paragraph = [];
    }
  }
  function flushBullets() {
    if (bullets.length) {
      blocks.push({ type: "bullets", items: bullets });
      bullets = [];
    }
  }
  function flushSteps() {
    if (steps.length) {
      blocks.push({ type: "steps", items: steps });
      steps = [];
    }
  }
  function flushMetrics() {
    if (metrics.length) {
      blocks.push({ type: "metrics", items: metrics });
      metrics = [];
    }
  }
  function flushAll() {
    flushParagraph();
    flushBullets();
    flushSteps();
    flushMetrics();
  }

  for (const rawLine of String(text || "").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushAll();
      continue;
    }
    const heading = line.match(/^#{1,4}\s+(.+)$/) || line.match(/^【(.+)】$/);
    if (heading) {
      flushAll();
      blocks.push({ type: "heading", text: heading[1].replace(/\*\*/g, "") });
      continue;
    }
    const strongHeading = line.match(/^\*\*([^*]{2,26})\*\*[:：]?$/);
    if (strongHeading) {
      flushAll();
      blocks.push({ type: "heading", text: strongHeading[1] });
      continue;
    }
    const numbered = line.match(/^(\d+)[.、)]\s+(.+)$/);
    if (numbered) {
      flushParagraph();
      flushBullets();
      flushMetrics();
      steps.push({ number: numbered[1], text: numbered[2] });
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      flushSteps();
      flushMetrics();
      bullets.push({ text: bullet[1], tone: visualTone(bullet[1]) });
      continue;
    }
    const metric = line.match(/^(结论|方向|交易对|价格|入场|止损|止盈|风险|仓位|杠杆|置信度|状态|账户|持仓|事件|建议|下一步|依据)[:：]\s*(.+)$/);
    if (metric) {
      flushParagraph();
      flushBullets();
      flushSteps();
      metrics.push({ label: metric[1], value: metric[2], tone: visualTone(line) });
      continue;
    }
    flushBullets();
    flushSteps();
    flushMetrics();
    paragraph.push(line);
  }
  flushAll();
  return blocks.length ? blocks : [{ type: "paragraph", text }];
}

function RichMessage({ text = "", compact = false, onSuggest = null }) {
  const blocks = parseRichText(text);
  const isSuggestion = (t) => /[?？]\s*$/.test(String(t || "").trim());
  const cleanSuggest = (t) => String(t || "").replace(/\*\*/g, "").trim();
  return (
    <div className={compact ? "richMessage compact" : "richMessage"}>
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const Icon = sectionIcon(block.text);
          return <div className="richHeading" key={index}><Icon size={14} /><strong>{block.text}</strong></div>;
        }
        if (block.type === "metrics") {
          return (
            <div className="richMetricGrid" key={index}>
              {block.items.map((item, itemIndex) => (
                <div className={`richMetric ${item.tone}`} key={`${item.label}-${itemIndex}`}>
                  <span>{item.label}</span>
                  <b>{renderInline(item.value)}</b>
                </div>
              ))}
            </div>
          );
        }
        if (block.type === "bullets") {
          return (
            <div className="richBulletList" key={index}>
              {block.items.map((item, itemIndex) => (
                onSuggest && isSuggestion(item.text)
                  ? <button type="button" className="chatSuggestBtn" key={itemIndex} onClick={() => onSuggest(cleanSuggest(item.text))}><span>{renderInline(item.text)}</span><ChevronRight size={14} /></button>
                  : (
                    <div className={`richBullet ${item.tone}`} key={itemIndex}>
                      <i>{item.tone === "danger" ? <AlertTriangle size={12} /> : item.tone === "ok" ? <CheckCircle2 size={12} /> : <span />}</i>
                      <span>{renderInline(item.text)}</span>
                    </div>
                  )
              ))}
            </div>
          );
        }
        if (block.type === "steps") {
          return (
            <div className="richSteps" key={index}>
              {block.items.map((item, itemIndex) => (
                onSuggest && isSuggestion(item.text)
                  ? <button type="button" className="chatSuggestBtn step" key={itemIndex} onClick={() => onSuggest(cleanSuggest(item.text))}><b>{item.number}</b><span>{renderInline(item.text)}</span><ChevronRight size={14} /></button>
                  : (
                    <div className="richStep" key={itemIndex}>
                      <b>{item.number}</b>
                      <span>{renderInline(item.text)}</span>
                    </div>
                  )
              ))}
            </div>
          );
        }
        return String(block.text).split("\n").map((line, lineIndex) => <p key={`${index}-${lineIndex}`}>{renderInline(line)}</p>);
      })}
    </div>
  );
}

const EXECUTION_LABELS = {
  dry_run: "干跑完成（实盘关闭）",
  entry_pending: "入场单挂单中",
  entry_filled: "入场已成交",
  protecting: "止盈止损已布置",
  closed: "已平仓",
  cancelled: "已取消",
  blocked: "被安全闸拦截",
  failed: "提交失败"
};

function PlanCard({ plan, executionOrder, action, ui }) {
  if (!plan) return null;
  const risk = plan.lastRiskCheck || {};
  const checks = risk.checks || [];
  const passedCount = checks.filter((check) => check.passed).length;
  const [showChecks, setShowChecks] = useState(false);
  const awaiting = plan.status === "awaiting_approval";
  return (
    <div className={`chatPlanCard ${risk.passed ? "" : "rejected"}`}>
      <header>
        <b>{plan.symbol}</b>
        <span className={plan.direction === "short" ? "negative" : "positive"}>{plan.direction === "short" ? "做空" : "做多"}</span>
        <StatusBadge tone={plan.status === "risk_rejected" ? "danger" : awaiting ? "warning" : "ok"}>{humanize(plan.status)}</StatusBadge>
        <small>{plan.strategy ? humanize(plan.strategy) : ""} {plan.leverage ? `· ${plan.leverage}x` : ""}</small>
      </header>
      <div className="planNumbers">
        <span><small>入场区间</small><b>{plan.entry?.range || "-"}</b></span>
        <span><small>止损</small><b className="negative">{displayMoney(plan.stopLoss)}</b></span>
        <span><small>止盈</small><b className="positive">{(plan.takeProfit || []).map((tp) => displayMoney(tp)).join(" / ") || "-"}</b></span>
        <span><small>单笔风险</small><b>{plan.entry?.riskPercent ?? plan.max_loss_pct ?? "-"}%</b></span>
      </div>
      <button className="riskSummaryRow" onClick={() => setShowChecks((current) => !current)}>
        {risk.passed
          ? <CheckCircle2 size={15} className="positive" />
          : <XCircle size={15} className="negative" />}
        <span>风控 {passedCount}/{checks.length} 通过 · {risk.summary || "未检查"}</span>
        <ChevronDown size={14} style={{ transform: showChecks ? "rotate(180deg)" : "none" }} />
      </button>
      {showChecks && (
        <div className="riskCheckList">
          {checks.map((check) => (
            <div key={check.name} className={check.passed ? "" : "failed"}>
              {check.passed ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
              <span>{check.name}</span>
              <small>{check.detail}</small>
            </div>
          ))}
        </div>
      )}
      {plan.smartMoneyAlignment && plan.smartMoneyAlignment.alignment !== "neutral" && (
        <div className={`smAlignRow ${plan.smartMoneyAlignment.alignment}`}>
          {plan.smartMoneyAlignment.alignment === "favor" ? <TrendingUp size={14} /> : <AlertTriangle size={14} />}
          <span>聪明钱{plan.smartMoneyAlignment.alignment === "favor" ? "支持该方向" : "与该方向相悖"}</span>
          <small>{(plan.smartMoneyAlignment.reasons || []).join("；")}</small>
        </div>
      )}
      <footer>
        {awaiting && <button className="approveButton" onClick={() => action(`/api/trade-plans/${plan.id}/approve`, {})}>批准计划</button>}
        {awaiting && <button onClick={() => action(`/api/trade-plans/${plan.id}/cancel`, { reason: "user_rejected" })}>拒绝</button>}
        <button className="ghostButton" onClick={() => ui.openPanel("auditChain")}>审计链 <ChevronRight size={13} /></button>
      </footer>
      {awaiting && <small className="planHint">批准后立即进入执行引擎：按净值与止损距离计算数量、提交入场单并附带保护性止损；实盘写入关闭时只做干跑计算。</small>}
      {executionOrder && (
        <div className="executionStrip">
          <span className={`execDot ${["entry_filled", "protecting"].includes(executionOrder.status) ? "on" : executionOrder.status === "closed" ? "done" : ""}`} />
          <b>{EXECUTION_LABELS[executionOrder.status] || executionOrder.status}</b>
          <small>
            数量 {executionOrder.quantity} · 名义 {displayMoney(executionOrder.notionalUsdt)} USDT
            {executionOrder.filledPrice ? ` · 成交 ${displayMoney(executionOrder.filledPrice)}` : ""}
            {Number.isFinite(Number(executionOrder.realizedPnl)) ? ` · 盈亏 ${displayMoney(executionOrder.realizedPnl)}` : ""}
          </small>
          {["entry_pending", "entry_filled", "protecting"].includes(executionOrder.status) && (
            <button onClick={() => action(`/api/execution-orders/${executionOrder.id}/close`, { reason: "manual_ui" })}>撤单/平仓</button>
          )}
        </div>
      )}
    </div>
  );
}

function MandateCard({ mandate, action }) {
  if (!mandate) return null;
  const pending = mandate.status === "pending_confirmation";
  return (
    <div className="chatMandateCard">
      <header><Shield size={15} /><b>授权委托{pending ? "草案" : ""}</b><StatusBadge tone={pending ? "warning" : "ok"}>{humanize(mandate.status)}</StatusBadge></header>
      <div className="mandateGridMini">
        <span><small>交易对</small><SymbolChips symbols={mandate.allowedSymbols} empty="-" /></span>
        <span><small>最大杠杆</small><b>{mandate.max_leverage || 1}x</b></span>
        <span><small>单笔风险</small><b>{mandate.maxSingleTradeRiskPct}%</b></span>
        <span><small>日亏上限</small><b>{mandate.maxDailyLossPct}%</b></span>
      </div>
      {pending && <footer><button className="approveButton" onClick={() => action(`/api/mandates/${mandate.id}/activate`, {})}>确认激活</button><small>激活后 Agent 才能在此边界内提出可执行计划</small></footer>}
    </div>
  );
}

function ToolTrace({ trace = [] }) {
  const [open, setOpen] = useState(false);
  if (!trace.length) return null;
  return (
    <div className="toolTrace">
      <button onClick={() => setOpen((current) => !current)}>
        <Wrench size={12} /> {trace.length} 次工具调用 <ChevronDown size={12} style={{ transform: open ? "rotate(180deg)" : "none" }} />
      </button>
      {open && trace.map((item, index) => (
        <div key={index}><b>{item.name}</b><span>{item.summary}</span><small>{item.latencyMs}ms</small></div>
      ))}
    </div>
  );
}

function AccountSyncCard({ data, action, ui }) {
  const accounts = data.exchangeAccounts || [];
  const readAccount = accounts.find((a) => a.readEnabled);
  const configured = Boolean(readAccount);
  const snapshot = data.accountSnapshots?.[0];
  const balance = data.portfolio?.totalEquityUsdt;
  const hasData = configured && (snapshot || (balance !== null && balance !== undefined));
  const lastSync = snapshot?.createdAt || readAccount?.lastSyncedAt || readAccount?.updatedAt;
  const autoTask = (data.tasks || []).find((t) => t.handler === "okx_readonly_sync");
  const autoSync = configured && autoTask && autoTask.enabled !== false;
  const todayPnl = Number(data.portfolio?.todayPnl || 0);
  const todayPct = data.portfolio?.todayPnlPct;
  const tip = hasData
    ? `来源：${readAccount.exchange} API ｜ 自动同步：${autoSync ? "每分钟" : "未开启"} ｜ 最后同步：${formatDateTime(lastSync, "未记录")}\n点击立即同步账户`
    : "未连接交易所 · 点击去连接 OKX 只读 API";
  return (
    <button
      type="button"
      className={`acctChip ${hasData ? "ok" : "unconfigured"}`}
      title={tip}
      onClick={() => (configured ? action(`/api/exchange/${readAccount.id}/sync-readonly`, {}) : ui.setActive("systemSettings"))}
    >
      <RefreshCw size={13} />
      <b>{hasData ? "已同步" : configured ? "待同步" : "未连接"}</b>
      {hasData
        ? <span className="acctBal">{displayMoney(balance)} USDT{todayPct !== null && todayPct !== undefined && Number(todayPct) !== 0 ? <em className={todayPnl >= 0 ? "positive" : "negative"}>{displayPct(todayPct)}</em> : null}</span>
        : <span className="acctBal muted">连接交易所</span>}
    </button>
  );
}

// AI 交易员右栏：把"该我关注/该我处理"的东西集中在这里，其余交给 AI。
function AgentRail({ data, action, ui, send }) {
  const system = data.system || {};
  const agentStatus = data.agentStatus || {};
  const riskWall = agentStatus.riskWall || {};
  const portfolio = data.portfolio || {};
  const mandate = (data.mandates || []).find((m) => ["active", "running"].includes(m.status));
  const awaitingPlans = (data.tradePlans || []).filter((p) => p.status === "awaiting_approval").slice(0, 3);
  const pendingActions = (data.pendingActions || []).slice(0, 3);
  const pendingMandates = (data.mandates || []).filter((m) => m.status === "pending_confirmation").slice(0, 2);
  const openIncidents = (data.riskIncidents || []).filter((i) => i.status === "open");
  const inboxCount = awaitingPlans.length + pendingActions.length + pendingMandates.length + (openIncidents.length ? 1 : 0);
  const todayPnl = Number(portfolio.todayPnl || 0);
  const budget = system.remainingDailyLossUsdt;
  const positions = data.positions || [];
  const orders = (data.orders || data.executionOrders || []).filter((o) => !["closed", "canceled", "cancelled", "filled_closed"].includes(String(o.status || "").toLowerCase()));
  const canOpen = system.killSwitch ? false : riskWall.allowOpen === true;
  const gateLabel = system.killSwitch ? "熔断中" : (canOpen ? "允许开仓" : "禁止开仓");
  const gateTone = system.killSwitch ? "danger" : (canOpen ? "ok" : "warning");
  const stateLabel = agentStatus.stateLabel || humanize(agentStatus.state, "观察中");
  const gm = data.marketRegime?.global || {};
  const sm = data.marketRegime?.smartMoney || {};

  async function toggleAutonomy() { await action("/api/system/autonomy", { enabled: !system.autonomyEnabled }); }
  async function releaseKill() { if (window.confirm("确认解除熔断？")) await action("/api/risk/kill-switch", { enabled: false, reason: "" }); }

  return (
    <aside className="agentRail">
      {/* ① 需要你处理 */}
      <div className="arCard">
        <div className="arHead"><ListChecks size={14} /> 需要你处理{inboxCount ? <span className="arBadge">{inboxCount}</span> : null}</div>
        {inboxCount === 0 && <div className="arEmpty"><CheckCircle2 size={14} /> 暂无待办 · 系统运行正常</div>}
        {awaitingPlans.map((p) => (
          <div className="arItem" key={p.id}>
            <div className="arItemTop"><b>{p.direction === "short" ? "做空" : "做多"} {p.symbol}</b><small>待批准交易计划</small></div>
            <div className="arItemActions">
              <button className="arBtn primary" onClick={() => action(`/api/trade-plans/${p.id}/approve`, {})}>批准</button>
              <button className="arBtn" onClick={() => action(`/api/trade-plans/${p.id}/cancel`, { reason: "user_rejected" })}>驳回</button>
              <button className="arBtn ai" onClick={() => send(`帮我评估待批准的交易计划 ${p.symbol}（${p.direction === "short" ? "做空" : "做多"}），该不该批准？给结论和理由。`)}>🤖 交给AI</button>
            </div>
          </div>
        ))}
        {pendingActions.map((pa) => (
          <div className="arItem" key={pa.id}>
            <div className="arItemTop"><b>{pa.title}</b><small>{pa.detail}</small></div>
            <div className="arItemActions">
              <button className="arBtn primary" onClick={() => action(`/api/agent/actions/${pa.id}/confirm`, {})}>确认</button>
              <button className="arBtn" onClick={() => action(`/api/agent/actions/${pa.id}/cancel`, {})}>取消</button>
            </div>
          </div>
        ))}
        {pendingMandates.map((m) => (
          <div className="arItem" key={m.id}>
            <div className="arItemTop"><b>激活授权委托</b><small>{m.goal || m.name || "确认后 AI 才能提出可执行计划"}</small></div>
            <div className="arItemActions"><button className="arBtn primary" onClick={() => action(`/api/mandates/${m.id}/activate`, {})}>确认激活</button></div>
          </div>
        ))}
        {openIncidents.length > 0 && (
          <div className="arItem">
            <div className="arItemTop"><b>{openIncidents.length} 个未处理风险事件</b><small>已分析确认无碍后可标记已处理</small></div>
            <div className="arItemActions">
              <button className="arBtn" onClick={() => ui.setActive("auditSystem")}>去查看 <ChevronRight size={12} /></button>
              <button className="arBtn" onClick={() => { if (window.confirm(`确认把 ${openIncidents.length} 个事件全部标记为已处理？`)) action("/api/risk/incidents/close-all", {}); }}>全部标记已处理</button>
              <button className="arBtn ai" onClick={() => send("逐条读取并分析当前未处理的风险事件（用 list_risk_incidents 工具），对确认无碍的用 resolve_risk_incidents 标记为已处理，并向我汇报每条的处理结论。")}>🤖 交给AI</button>
            </div>
          </div>
        )}
      </div>

      {/* ② 账户与风险 */}
      <div className="arCard">
        <div className="arHead"><BarChart3 size={14} /> 账户与风险</div>
        <div className="arPnl">
          <span>今日盈亏</span>
          <strong className={todayPnl >= 0 ? "positive" : "negative"}>{todayPnl >= 0 ? "+" : ""}{displayMoney(todayPnl, 2, "0.00")} USDT</strong>
        </div>
        <div className="arRow" title="今日还能亏多少就触发日亏上限"><span className="term">剩余日亏预算</span><b>{budget === null || budget === undefined ? "未授权" : `${displayMoney(budget)} USDT`}</b></div>
        <div className="arRow"><span>持仓 / 在途</span><button className="arLink" onClick={() => ui.setActive("cockpit")}>{positions.length} / {orders.length} <ChevronRight size={12} /></button></div>
      </div>

      {/* ③ AI 状态与总控 */}
      <div className="arCard">
        <div className="arHead"><BrainCircuit size={14} /> AI 状态</div>
        <div className="arStateRow">
          <StatusBadge tone={statusTone(agentStatus.state || system.apiHealth)}>{stateLabel}</StatusBadge>
          <span className={`arGate ${gateTone}`}>{gateLabel}</span>
        </div>
        {mandate && <div className="arMandate">做 {(mandate.allowedSymbols || []).slice(0, 3).join("·") || "—"} · {mandate.max_leverage || 1}x · 日亏≤{mandate.maxDailyLossPct || "-"}%</div>}
        <div className="arControls">
          <button className="arBtn" onClick={toggleAutonomy}>{system.autonomyEnabled ? "暂停自主推进" : "恢复自主推进"}</button>
          {system.killSwitch && <button className="arBtn danger" onClick={releaseKill}>解除熔断</button>}
        </div>
      </div>

      {/* ④ 市场速览 */}
      <div className="arCard">
        <div className="arHead"><TrendingUp size={14} /> 市场速览 <button className="arRefresh" title="刷新大盘/聪明钱" onClick={() => ui.refresh?.(true)}><RefreshCw size={12} /></button></div>
        <div className="arRow"><span className="term" title="BTC 市值占全市场比例；上升时山寨相对弱势">BTC 主导</span><b>{gm.btcDominancePct != null ? `${gm.btcDominancePct}%` : "—"}</b></div>
        <div className="arRow"><span className="term" title="市场情绪：极低=极度恐惧（常是反向机会），极高=极度贪婪（注意回撤）">恐惧贪婪</span><b>{gm.fearGreed ? `${gm.fearGreed.value} · ${gm.fearGreed.label}` : "—"}</b></div>
        <div className="arRow"><span className="term" title="精英交易员的多空持仓比，>1 偏多、<1 偏空">大户多空</span><b className={sm.topTraderLongShortRatio == null ? "" : sm.topTraderLongShortRatio >= 1 ? "positive" : "negative"}>{sm.topTraderLongShortRatio ?? "—"}</b></div>
        <div className="arRow"><span className="term" title="全体/散户的多空持仓比，常作反向指标">散户多空</span><b>{sm.retailLongShortRatio ?? "—"}</b></div>
        <button className="arAskLink" onClick={() => send("用大白话讲讲现在的大盘和聪明钱信号，对我的交易有什么提示？")}>🤖 让 AI 解读当前行情</button>
      </div>
    </aside>
  );
}

function SetupChecklist({ onExample }) {
  const examples = [
    "看看 BTC 现在的走势，说说你的判断",
    "稳健做 BTC/ETH：单笔风险 0.3%，日亏损上限 1%，最大 3 倍杠杆，重大事件前 30 分钟停止开仓",
    "现在有哪些高影响事件？对我的持仓有什么风险？"
  ];
  return (
    <div className="setupChecklist">
      <div className="examplePrompts">
        {examples.map((example) => <button key={example} onClick={() => onExample(example)}>{example}</button>)}
      </div>
    </div>
  );
}

export function ChatPage({ data, action, ui }) {
  const [messages, setMessages] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [view, setView] = useState("chat");
  const [llmConfigured, setLlmConfigured] = useState(true);
  const [provider, setProvider] = useState(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const scrollRef = useRef(null);

  async function loadMessages(sessionId = activeSessionId) {
    try {
      const path = sessionId ? `/api/agent/chat?sessionId=${encodeURIComponent(sessionId)}` : "/api/agent/chat";
      const response = await fetch(apiUrl(path), { headers: authHeaders() });
      if (!response.ok) return;
      const json = await response.json();
      setMessages(json.messages || []);
      setSessions(json.sessions || []);
      setActiveSessionId(json.activeSessionId || json.sessions?.[0]?.id || "");
      setLlmConfigured(Boolean(json.llmConfigured));
      setProvider(json.provider);
    } catch {}
  }

  useEffect(() => { loadMessages(); }, []);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, pending]);

  async function send(textOverride) {
    const text = String(textOverride ?? input).trim();
    if (!text || pending) return;
    setInput("");
    setPending(true);
    setMessages((current) => [...current, { id: `tmp_${Date.now()}`, role: "user", content: text, createdAt: new Date().toISOString() }]);
    try {
      const response = await fetch(apiUrl("/api/agent/chat"), {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ message: text, sessionId: activeSessionId })
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || `请求失败 ${response.status}`);
      await loadMessages(json.agentMessage?.sessionId || activeSessionId);
      await ui.refresh(false);
    } catch (error) {
      setMessages((current) => [...current, { id: `err_${Date.now()}`, role: "agent", content: `请求失败：${error.message}`, createdAt: new Date().toISOString() }]);
    } finally {
      setPending(false);
    }
  }

  function findPlan(planId) {
    return (data.tradePlans || []).find((plan) => plan.id === planId);
  }
  function findMandate(mandateId) {
    return (data.mandates || []).find((mandate) => mandate.id === mandateId);
  }
  // 新建对话只在本地开启一个"草稿会话"，不立刻建库；发第一条消息时后端才真正创建
  // 并用首句作为标题。这样空对话永远不会留进历史记录。
  function newSession() {
    setActiveSessionId("");
    setMessages([]);
  }

  function switchSession(sessionId) {
    setActiveSessionId(sessionId);
    loadMessages(sessionId);
  }

  async function deleteSession(sessionId, event) {
    event.stopPropagation();
    try {
      const response = await fetch(apiUrl(`/api/agent/chat/sessions/${sessionId}`), { method: "DELETE", headers: authHeaders() });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "删除失败");
      setSessions(json.sessions || []);
      if (sessionId === activeSessionId) { setActiveSessionId(""); setMessages([]); }
    } catch (error) {
      ui.notify?.(error.message || "删除失败");
    }
  }

  return (
    <div className="chatShell">
    <div className="chatPage">
      <div className="chatSessionBar">
        <div className="chatViewSwitch">
          <button className={view === "chat" ? "active" : ""} onClick={() => setView("chat")}><MessageSquare size={15} /> 对话</button>
          <button className={view === "intel" ? "active" : ""} onClick={() => setView("intel")}><Radar size={15} /> 情报</button>
        </div>
        <AccountSyncCard data={data} action={action} ui={ui} />
        {view === "chat" && (
        <div className="chatSessionSwitch">
          <button className="csSwitchBtn" onClick={() => { newSession(); setShowHistory(false); }}><Plus size={15} /> 新建对话</button>
          <button className={`csSwitchBtn history ${showHistory ? "active" : ""}`} onClick={() => setShowHistory((value) => !value)} aria-expanded={showHistory}>
            <History size={15} /> 历史记录
            {sessions.length > 1 && <b className="csCount">{sessions.length}</b>}
          </button>
        </div>
        )}
        {view === "chat" && showHistory && (
          <>
            <div className="chatHistoryBackdrop" onClick={() => setShowHistory(false)} />
            <div className="chatHistoryPop" role="listbox">
              {sessions.length ? sessions.map((session) => (
                <div className={`chatHistoryItem ${session.id === activeSessionId ? "active" : ""}`} key={session.id}>
                  <button className="chatHistoryOpen" onClick={() => { switchSession(session.id); setShowHistory(false); }} title={session.title}>
                    <span>{session.title || "未命名对话"}</span>
                    <small>{formatTime(session.updatedAt || session.createdAt)}</small>
                  </button>
                  <button className="chatHistoryDelete" title="删除对话" onClick={(event) => deleteSession(session.id, event)}><Trash2 size={13} /></button>
                </div>
              )) : <div className="chatHistoryEmpty">暂无历史对话</div>}
            </div>
          </>
        )}
      </div>
      {view === "intel" && <IntelCenter action={action} />}
      {view === "chat" && (<>
      <div className="chatScroll" ref={scrollRef}>
        {!messages.length && <SetupChecklist onExample={(example) => send(example)} />}
        {messages.map((message) => (
          <div className={`chatMessage ${message.role}`} key={message.id}>
            {message.role === "agent" && <div className="botAvatar"><BrainCircuit size={16} /></div>}
            <div className="chatBody">
              <div className="chatContent"><RichMessage text={message.content} compact={message.role === "user"} onSuggest={message.role === "agent" && !pending ? (t) => send(t) : null} /></div>
              {message.mandateId && <MandateCard mandate={findMandate(message.mandateId)} action={action} />}
              {message.planId && (
                <PlanCard
                  plan={findPlan(message.planId)}
                  executionOrder={(data.executionOrders || []).find((item) => item.planId === message.planId)}
                  action={action}
                  ui={ui}
                />
              )}
              <ToolTrace trace={message.toolTrace || []} />
              <small className="chatMeta">
                {formatTime(message.createdAt)}{message.role === "agent" && message.model ? ` · ${message.model}` : ""}
              </small>
            </div>
          </div>
        ))}
        {pending && (
          <div className="chatMessage agent">
            <div className="botAvatar"><BrainCircuit size={16} /></div>
            <div className="chatBody"><div className="thinkingDots"><span /><span /><span /></div></div>
          </div>
        )}
      </div>
      {(data.pendingActions || []).length > 0 && (
        <div className="pendingActionsDock">
          {(data.pendingActions || []).map((pa) => (
            <div className={`pendingActionCard ${pa.danger ? "danger" : ""}`} key={pa.id}>
              <div className="paInfo">
                <span className="paBadge">待确认操作</span>
                <b>{pa.title}</b>
                <small>{pa.detail}</small>
              </div>
              <div className="paActions">
                <button className="secondaryButton" onClick={() => action(`/api/agent/actions/${pa.id}/cancel`, {})}>取消</button>
                <button className={pa.danger ? "dangerButton" : "primaryButton"} onClick={() => action(`/api/agent/actions/${pa.id}/confirm`, {})}>确认执行</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="chatInputBar">
        <textarea
          value={input}
          rows={1}
          placeholder={provider ? `下达目标或提问（${provider.name}/${provider.model}）` : "下达目标或提问，例如：稳健观察 BTC，单笔风险不超过 0.3%"}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        <button className="sendButton" disabled={pending || !input.trim()} onClick={() => send()} aria-label="发送">
          <ArrowUp size={17} />
        </button>
      </div>
      </>)}
    </div>
    {view === "chat" && <AgentRail data={data} action={action} ui={ui} send={send} />}
    </div>
  );
}

// 情报中心：把新闻聚合成的"事件专题"按热点排序展示，每个专题可展开看持续跟进的时间线。
function IntelCenter({ action }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState({});

  async function load() {
    setLoading(true);
    try {
      const response = await fetch(apiUrl("/api/events/intel"), { headers: authHeaders() });
      const json = await response.json();
      setEvents(Array.isArray(json) ? json : []);
    } catch {} finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function refresh() {
    setBusy(true);
    try {
      await fetch(apiUrl("/api/event-sources/refresh"), { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: "{}" });
      await load();
    } catch {} finally { setBusy(false); }
  }

  async function removeIntel(id, event) {
    event.stopPropagation();
    try {
      await fetch(apiUrl(`/api/events/${id}`), { method: "DELETE", headers: authHeaders() });
      setEvents((current) => current.filter((item) => item.id !== id));
    } catch {}
  }

  return (
    <div className="intelCenter">
      <div className="intelHead">
        <div>
          <h3>情报中心</h3>
          <span>把零散新闻聚合成事件专题，按影响度、热度、时效与你的持仓相关性排序、持续跟进</span>
        </div>
        <button className="secondaryButton" onClick={refresh} disabled={busy}><RefreshCw size={14} /> {busy ? "刷新中…" : "刷新情报"}</button>
      </div>
      {loading && !events.length ? (
        <div className="emptyPanel">加载中…</div>
      ) : !events.length ? (
        <div className="emptyPanel emptyPanelAction"><strong>暂无情报</strong><button className="secondaryButton" onClick={refresh}><RefreshCw size={14} /> 刷新情报</button></div>
      ) : (
        <div className="intelList">
          {events.map((ev) => {
            const open = expanded[ev.id];
            const tone = ev.impact >= 80 ? "danger" : ev.impact >= 50 ? "warning" : "neutral";
            const dirTone = /空/.test(ev.directionHint || "") ? "negative" : /多/.test(ev.directionHint || "") ? "positive" : "";
            return (
              <div className={`intelCard ${tone}`} key={ev.id}>
                <div className="intelCardTop">
                  <button className="intelCardHead" onClick={() => setExpanded((state) => ({ ...state, [ev.id]: !state[ev.id] }))}>
                    <div className="intelTitleRow">
                      <span className="intelHot">🔥 {ev.hotScore}</span>
                      <b>{ev.title}</b>
                      <StatusBadge tone={tone}>{ev.impactLabel}</StatusBadge>
                    </div>
                    <div className="intelMeta">
                      <span>{ev.updateCount || 1} 条报道</span>
                      {ev.directionHint && <span className={`intelDir ${dirTone}`}>{ev.directionHint}</span>}
                      {(ev.relatedSymbols || []).slice(0, 3).map((symbol) => <span key={symbol} className="intelSym">{symbol}</span>)}
                      <ChevronDown size={14} className={open ? "intelChevron open" : "intelChevron"} />
                    </div>
                  </button>
                  <button className="intelDelete" title="删除该情报专题" onClick={(event) => removeIntel(ev.id, event)}><Trash2 size={15} /></button>
                </div>
                {ev.action && <p className="intelAssess">{ev.action}</p>}
                {open && (
                  <div className="intelTimeline">
                    {(ev.timeline || []).map((update, index) => (
                      <div className="intelUpdate" key={index}>
                        <time>{formatDateTime(update.at, "—")}</time>
                        <div className="intelUpdateBody">
                          {update.link
                            ? <a href={update.link} target="_blank" rel="noreferrer" title="打开原文">{update.title}</a>
                            : <b>{update.title}</b>}
                          {update.source && <small>{update.source}</small>}
                        </div>
                      </div>
                    ))}
                    {!(ev.timeline || []).length && <div className="intelUpdate"><span className="muted">暂无跟进记录</span></div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
