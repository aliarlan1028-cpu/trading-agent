import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUp,
  BarChart3,
  Bot,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Eye,
  History,
  Hourglass,
  MessageSquare,
  Radar,
  RefreshCw,
  Rocket,
  Trash2,
  KeyRound,
  ListChecks,
  PlugZap,
  Plus,
  Shield,
  ShieldCheck,
  Target,
  TrendingUp,
  Wrench,
  XCircle,
  Zap
} from "lucide-react";
import { apiUrl, displayMoney, displayPrice, displayPct, formatDateTime, formatTime, humanize, smartMoneyBias, statusTone, StatusBadge, SymbolChips } from "./lib.jsx";

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
  let tableLines = [];

  function flushTable() {
    if (!tableLines.length) return;
    const rows = tableLines
      .map((l) => l.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim()));
    const sepIdx = rows.findIndex((r) => r.length && r.every((c) => /^:?-{2,}:?$/.test(c) || /^:?-+:?$/.test(c)));
    let header = null;
    let body = rows;
    if (sepIdx === 0) { body = rows.slice(1); }
    else if (sepIdx > 0) { header = rows[sepIdx - 1]; body = rows.slice(sepIdx + 1); }
    body = body.filter((r) => r.some((c) => c !== ""));
    if (header || body.length) blocks.push({ type: "table", header, rows: body });
    tableLines = [];
  }
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
    flushTable();
  }

  for (const rawLine of String(text || "").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushAll();
      continue;
    }
    if (/^\|.*\|\s*$/.test(line) && (line.match(/\|/g) || []).length >= 2) {
      flushParagraph();
      flushBullets();
      flushSteps();
      flushMetrics();
      tableLines.push(line);
      continue;
    }
    flushTable();
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
        if (block.type === "table") {
          return (
            <div className="richTableWrap" key={index}>
              <table className="richTable">
                {block.header && (
                  <thead><tr>{block.header.map((cell, cellIndex) => <th key={cellIndex}>{renderInline(cell)}</th>)}</tr></thead>
                )}
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{renderInline(cell)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
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

// AI 交易员右栏：严格照设计稿（当前 Agent 状态 / 授权与风控墙 / 运行轨迹 / KPI），接真实数据。
function AgentRail({ data, action, ui, send }) {
  const system = data.system || {};
  const agentStatus = data.agentStatus || {};
  const riskWall = agentStatus.riskWall || {};
  const portfolio = data.portfolio || {};
  const perf = data.performance || {};
  const mandate = (data.mandates || []).find((m) => ["active", "running"].includes(m.status)) || {};
  const hasMandate = Boolean(mandate.id);
  const plan = (data.tradePlans || []).find((p) => ["awaiting_approval", "approved", "executing"].includes(p.status));
  // 盈亏比可由固定的入场/止损/止盈直接算出，不该恒显"—"（计划价位是下单前定死的目标，本就不随行情变动）。
  const planRR = (() => {
    if (plan?.riskReward) return plan.riskReward;
    const er = plan?.entry_range || (plan?.entry?.range ? null : null);
    const entry = Array.isArray(er) && er.length ? (Number(er[0]) + Number(er[er.length - 1])) / 2 : Number(plan?.entry?.mid ?? plan?.entryPrice ?? NaN);
    const stop = Number(plan?.stopLoss ?? plan?.stop_loss ?? NaN);
    const tps = plan?.takeProfit || plan?.take_profit || [];
    const tp = Number(Array.isArray(tps) ? tps[0] : tps);
    if (![entry, stop, tp].every(Number.isFinite) || entry === stop) return null;
    const rr = Math.abs(tp - entry) / Math.abs(entry - stop);
    return Number.isFinite(rr) && rr > 0 ? rr.toFixed(2) : null;
  })();
  const positions = data.positions || [];
  const gm = data.marketRegime?.global || {};
  const sm = data.marketRegime?.smartMoney || {};
  const btc = (data.markets || []).find((m) => /BTC/i.test(m.symbol || ""));
  const latestRun = (data.agentRuns || [])[0] || {};
  const todayPnl = Number(portfolio.todayPnl || 0);
  // 累计盈亏 = performanceReport 全时段真实合计；不再回退 weekPnl（后端从未写入的死字段）。
  const cumPnl = Number(perf.totalPnlUsdt ?? 0);
  const autoOn = system.autonomyEnabled === true && !system.killSwitch;
  const canOpen = system.killSwitch ? false : riskWall.allowOpen === true;
  const ratio = sm.topTraderLongShortRatio;
  // 全端统一的偏向判定（smartMoneyBias，阈值一处定义）；语义用"偏多/偏空"不再冒充"趋势"。
  const bias = smartMoneyBias(ratio);
  const judge = system.killSwitch ? "已熔断" : bias.label === "待同步" ? "观察中" : bias.label;
  const judgePos = bias.tone === "pos";
  const judgeNeg = bias.tone === "neg";
  // 后端真实的下一步建议是 nextActions（数组）；此前读不存在的单数 nextAction 恒 undefined，
  // 永远落到"等待信号"这个与信号无关的假文案。
  const nextStep = (agentStatus.nextActions || [])[0] || (canOpen ? "已授权开仓" : "未授权开仓");
  const remaining = system.remainingDailyLossUsdt;
  const cap = mandate.maxDailyLossPct && portfolio.totalEquityUsdt ? (Number(mandate.maxDailyLossPct) / 100) * Number(portfolio.totalEquityUsdt) : null;
  const budgetPct = cap && remaining != null ? Math.max(0, Math.min(100, (Number(remaining) / cap) * 100)) : null;
  // 只认真实同步的可用保证金；缺失就是 null——旧回退 totalEquity 会假装"持仓风险 0.0%"。
  const marginRate = portfolio.availableMarginUsdt != null && Number(portfolio.totalEquityUsdt) > 0
    ? Math.min(100, Math.max(0, ((Number(portfolio.totalEquityUsdt) - Number(portfolio.availableMarginUsdt)) / Number(portfolio.totalEquityUsdt)) * 100))
    : null;

  const mandateRows = hasMandate ? [
    { k: "授权范围", v: humanize(mandate.marketTypes?.[0] || "perpetual_usdt", "永续") },
    { k: "交易所", v: (mandate.exchanges || []).join("·") || "—" },
    { k: "白名单", v: `${(mandate.allowedSymbols || []).length} 币` },
    { k: "最大杠杆", v: `${mandate.max_leverage || 1}x` },
    { k: "单笔风险", v: `${mandate.maxSingleTradeRiskPct ?? "-"}%` },
    { k: "审批阈值", v: `≥${displayMoney(mandate.humanApprovalNotionalUsdt || mandate.manual_approval_threshold_usdt || 0, 0)}` }
  ] : [
    { k: "授权范围", v: "未授权" }, { k: "交易所", v: "—" }, { k: "白名单", v: "—" },
    { k: "最大杠杆", v: "—" }, { k: "单笔风险", v: "—" }, { k: "审批阈值", v: "—" }
  ];

  // 轨迹用最新 run 的真实步骤与各自时间戳——旧版是写死的五步流水 + 同一个时间戳复制五遍（假轨迹）。
  const TRAJ_ICONS = { observe: Eye, regime: BrainCircuit, decision: ClipboardList, risk_check: Shield, execution: Hourglass };
  const trajSteps = (latestRun.steps || []).slice(0, 5).map((s) => ({
    Icon: TRAJ_ICONS[s.phase] || BrainCircuit,
    t: (s.title || humanize(s.phase, "步骤")).slice(0, 6),
    time: s.createdAt ? formatTime(s.createdAt) : "—"
  }));

  const kpis = [
    { k: "总资产", v: displayMoney(portfolio.totalEquityUsdt, 0, "—"), d: portfolio.todayPnlPct != null ? displayPct(portfolio.todayPnlPct) : "", pos: Number(portfolio.todayPnl || 0) >= 0 },
    { k: "持仓风险", v: marginRate == null ? "—" : `${marginRate.toFixed(1)}%`, d: `${positions.length} 仓`, plain: true },
    { k: "今日盈亏", v: `${todayPnl >= 0 ? "+" : ""}${displayMoney(todayPnl, 0, "0")}`, d: portfolio.todayPnlPct != null ? displayPct(portfolio.todayPnlPct) : "", pos: todayPnl >= 0, colorVal: true },
    { k: "累计盈亏", v: `${cumPnl >= 0 ? "+" : ""}${displayMoney(cumPnl, 0, "0")}`, d: perf.trades ? `${perf.trades} 笔` : "", pos: cumPnl >= 0, colorVal: true },
    { k: "BTC/USDT", v: btc ? displayMoney(btc.price, 0, "—") : "—", d: btc?.changePct != null ? displayPct(btc.changePct) : "", pos: Number(btc?.changePct || 0) >= 0 }
  ];

  async function toggleAutonomy() { await action("/api/system/autonomy", { enabled: !system.autonomyEnabled }); }
  async function fireKill() { if (window.confirm(system.killSwitch ? "确认解除熔断？" : "确认一键熔断？将立即阻断所有新开仓。")) await action("/api/risk/kill-switch", { enabled: !system.killSwitch, reason: "" }); }

  return (
    <div className="agRail">
      {/* 当前 Agent 状态 */}
      <div className="agCard">
        <div className="agHeadNum"><span className="agNum">2</span>当前 Agent 状态</div>
        <div className="agMiniGrid">
          {/* 授权边界卡：显示真实的授权字段（单笔风险/日亏上限）——旧 targetMonthlyPct 是后端从未写入的死字段，永远显示"—" */}
          <div className="agMini"><div className="agMiniK">授权边界</div><div className="agMiniV mono">{hasMandate && mandate.maxSingleTradeRiskPct != null ? `${mandate.maxSingleTradeRiskPct}%/笔` : "—"}</div><div className="agMiniS">{hasMandate && mandate.maxDailyLossPct != null ? `日亏≤${mandate.maxDailyLossPct}%` : "未授权"}</div></div>
          <div className="agMini"><div className="agMiniK">状态</div><div className={`agMiniV sg ${autoOn ? "pos" : ""}`}>{autoOn ? "运行中" : "已暂停"}</div><div className="agMiniS">{system.killSwitch ? "已熔断" : autoOn ? "已开启" : "待启动"}</div></div>
          <div className="agMini"><div className="agMiniK">大盘结构</div><div className={`agMiniV sg ${judgePos ? "pos" : ""} ${judgeNeg ? "neg" : ""}`}>{judge}</div><div className="agMiniS">{ratio != null ? `BTC大户${ratio}` : "待同步"}</div></div>
          <div className="agMini"><div className="agMiniK">下一步</div><div className="agMiniV sg" title={nextStep}>{nextStep.length > 8 ? `${nextStep.slice(0, 8)}…` : nextStep}</div><div className="agMiniS">{canOpen ? "已授权开仓" : "未授权开仓"}</div></div>
        </div>
        <div className="agPlan">
          <div className="agPlanHead">
            <span className="agPlanBtc">₿</span>
            <b className="mono">{plan?.symbol || (mandate.allowedSymbols || [])[0] || "BTC/USDT"}</b>
            <span className="agPlanTag">{plan?.strategy || mandate.strategies?.[0] ? humanize(plan?.strategy || mandate.strategies?.[0]) : "未指定策略"}</span>
            <span className="agPlanRight mono">{plan ? "当前交易计划" : "暂无计划"}</span>
          </div>
          <div className="agPlanGrid">
            <div><div className="agPlanK">入场区间</div><b className="mono">{plan ? (plan.entry?.range || (plan.entry_range ? plan.entry_range.join("–") : "—")) : "—"}</b></div>
            <div><div className="agPlanK">止损价</div><b className="mono neg">{plan ? displayPrice(plan.stopLoss ?? plan.stop_loss) : "—"}</b></div>
            <div><div className="agPlanK">止盈目标</div><b className="mono pos">{plan && (plan.takeProfit || plan.take_profit)?.length ? (plan.takeProfit || plan.take_profit).slice(0, 2).map((t) => displayPrice(t)).join(" / ") : "—"}</b></div>
            <div><div className="agPlanK">仓位·杠杆</div><b className="mono">{plan ? `${plan.max_loss_pct ?? "-"}% · ${plan.leverage || 1}x` : "—"}</b></div>
            <div><div className="agPlanK">盈亏比</div><b className="mono">{planRR ? `1 : ${planRR}` : "—"}</b></div>
            <div><div className="agPlanK">置信度</div><b className="mono">{plan?.confidence ? `${plan.confidence}%` : "—"}</b></div>
          </div>
        </div>
      </div>

      {/* 授权与风控墙 */}
      <div className="agCard">
        <div className="agHeadIcon"><ShieldCheck size={13} /> 授权与风控墙</div>
        <div className="agWallGrid">
          {mandateRows.map((r) => <div className="agWallRow" key={r.k}><span>{r.k}</span><b className="mono">{r.v}</b></div>)}
        </div>
        <div className="agBudget">
          <div className="agBudgetTop"><span>今日亏损预算</span><span>{remaining != null ? `${displayMoney(remaining, 0)} 剩余${budgetPct != null ? ` · ${budgetPct.toFixed(0)}%` : ""}` : "未授权"}</span></div>
          <div className="agBudgetBar"><i style={{ width: `${budgetPct ?? 0}%` }} /></div>
        </div>
        <div className="agWallBtns">
          <button className="agBtnGhost" onClick={toggleAutonomy}>{autoOn ? "暂停" : "恢复"}</button>
          <button className="agBtnKill" onClick={fireKill}><Zap size={12} /> {system.killSwitch ? "解除熔断" : "一键熔断"}</button>
        </div>
      </div>

      {/* Agent 运行轨迹 */}
      <div className="agCard">
        <div className="agTrajHead"><span className="agSecLabel"><i />Agent 运行轨迹 · 最新循环</span><button className="agLink" onClick={() => ui.setActive("auditSystem")}>完整 ›</button></div>
        <div className="agTrajGrid">
          {!trajSteps.length && <div className="emptyPanel" style={{ gridColumn: "1 / -1" }}>暂无运行记录；开启自主巡检后显示真实步骤轨迹</div>}
          {trajSteps.map(({ Icon, t, time }, i) => (
            <div className="agTrajCell" key={`${t}-${i}`}><span className="agTrajIcon"><Icon size={12} /></span><b>{t}</b><div className="agTrajTime mono">{time}</div></div>
          ))}
        </div>
      </div>

      {/* KPI 条 */}
      <div className="agKpiRow">
        {kpis.map((kp) => (
          <div className="agKpi" key={kp.k}>
            <div className="agKpiK">{kp.k}</div>
            <div className={`agKpiV mono ${kp.colorVal ? (kp.pos ? "pos" : "neg") : ""}`}>{kp.v}</div>
            <div className={`agKpiD mono ${kp.plain ? "warn" : kp.pos ? "pos" : "neg"}`}>{kp.d}</div>
          </div>
        ))}
      </div>
    </div>
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
  const system = data.system || {};
  const autoOn = system.autonomyEnabled === true && !system.killSwitch;
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
    <div className={`chatShell ${view === "intel" ? "intel" : ""}`}>
    <div className="agChat">
      <div className="agChatHead">
        <div className="agChatTitle"><span className="agChatNum">1</span>{view === "chat" ? "与 AI 交易员对话" : "情报中心"}</div>
        <div className="agChatHeadR">
          <div className="agViewToggle">
            <button className={view === "chat" ? "on" : ""} title="对话" onClick={() => setView("chat")}><MessageSquare size={13} /></button>
            <button className={view === "intel" ? "on" : ""} title="情报" onClick={() => setView("intel")}><Radar size={13} /></button>
          </div>
          <span className={`agRunBadge ${autoOn ? "on" : "off"}`}><span />{autoOn ? "运行中" : system.killSwitch ? "已熔断" : "已暂停"}</span>
          <button className="agLaunchBtn" onClick={() => action("/api/system/autonomy", { enabled: !system.autonomyEnabled })}><Rocket size={14} /> {system.autonomyEnabled ? "暂停自主" : "启动自主交易"}</button>
        </div>
      </div>

      {view === "intel" ? <IntelCenter action={action} /> : (<>
      <div className="agHistBar">
        <span className="agHistLabel">历史会话</span>
        <button className="agSessChip newSess" onClick={() => newSession()}><Plus size={12} /> 新建</button>
        {sessions.map((s) => (
          <button className={`agSessChip ${s.id === activeSessionId ? "on" : ""}`} key={s.id} onClick={() => switchSession(s.id)} title={s.title}>
            {s.id === activeSessionId && <MessageSquare size={12} />}
            {(s.title || "未命名对话").slice(0, 12)} · {formatTime(s.updatedAt || s.createdAt)}
            <i className="agSessDel" title="删除" onClick={(e) => deleteSession(s.id, e)}>×</i>
          </button>
        ))}
      </div>

      <div className="agMsgs" ref={scrollRef}>
        {!messages.length && <SetupChecklist onExample={(example) => send(example)} />}
        {messages.map((message) => (message.role === "user" ? (
          <div className="agMsgUserRow" key={message.id}>
            <div className="agBubbleUser"><RichMessage text={message.content} compact onSuggest={null} /></div>
          </div>
        ) : (
          <div className="agMsgAiRow" key={message.id}>
            <span className="agAvatar"><Bot size={18} /></span>
            <div className="agBubbleAi">
              <div className="agAiLabel">AI 交易员</div>
              <RichMessage text={message.content} onSuggest={!pending ? (t) => send(t) : null} />
              {message.mandateId && <MandateCard mandate={findMandate(message.mandateId)} action={action} />}
              {message.planId && (
                <PlanCard plan={findPlan(message.planId)} executionOrder={(data.executionOrders || []).find((item) => item.planId === message.planId)} action={action} ui={ui} />
              )}
              <ToolTrace trace={message.toolTrace || []} />
              <small className="agMsgMeta">{formatTime(message.createdAt)}{message.model ? ` · ${message.model}` : ""}</small>
            </div>
          </div>
        )))}
        {pending && (
          <div className="agMsgAiRow">
            <span className="agAvatar"><Bot size={18} /></span>
            <div className="agBubbleAi"><div className="thinkingDots"><span /><span /><span /></div></div>
          </div>
        )}
      </div>

      {(data.pendingActions || []).length > 0 && (
        <div className="pendingActionsDock">
          {(data.pendingActions || []).map((pa) => (
            <div className={`pendingActionCard ${pa.danger ? "danger" : ""}`} key={pa.id}>
              <div className="paInfo"><span className="paBadge">待确认操作</span><b>{pa.title}</b><small>{pa.detail}</small></div>
              <div className="paActions">
                <button className="secondaryButton" onClick={() => action(`/api/agent/actions/${pa.id}/cancel`, {})}>取消</button>
                <button className={pa.danger ? "dangerButton" : "primaryButton"} onClick={() => action(`/api/agent/actions/${pa.id}/confirm`, {})}>确认执行</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="agInputBar">
        <textarea
          value={input}
          rows={1}
          placeholder={provider ? `输入指令，与 AI 交易员对话…（${provider.name}/${provider.model}）` : "输入指令，与 AI 交易员对话… 例如「把仓位降到 5%」"}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }}
        />
        <button className="agSend" disabled={pending || !input.trim()} onClick={() => send()} aria-label="发送"><ArrowUp size={18} /></button>
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
