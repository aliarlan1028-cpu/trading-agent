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
  Hourglass,
  MessageSquare,
  Radar,
  RefreshCw,
  Rocket,
  Search,
  Trash2,
  ListChecks,
  Plus,
  Shield,
  ShieldCheck,
  Target,
  TrendingUp,
  Wrench,
  XCircle,
  Zap
} from "lucide-react";
import { apiUrl, displayMoney, displayPrice, displayPct, formatDateTime, formatTime, humanize, marginUsage, authHeaders, smartMoneyBias, statusTone, StatusBadge, SymbolChips } from "./lib.jsx";

// 模型按知识库提示会输出 [[n]] 引用编号(用于内部接地),对终端用户是噪音、且渲染成裸标记像 bug。
// 统一剥掉编号并清理残留的多余空格与中文标点前空格,让"超出了 [[2]] 建议的 3x"读成"超出了建议的 3x"。
function stripCitationMarkers(text = "") {
  return String(text)
    .replace(/\[\[\d+\]\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([，。、；：）】」』"])/g, "$1");
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
    // Markdown 水平分隔线(--- / *** / ___):模型偶尔会输出,渲染成裸文本很丑,直接当段落分隔吞掉。
    if (/^([-*_])\1{2,}$/.test(line.replace(/\s+/g, ""))) {
      flushAll();
      continue;
    }
    // 代码围栏(``` 或 ```lang):模型偶尔用它包住指标块,前端不渲染代码块,裸 ``` 会漏出来(用户实锤)。
    // 直接吞掉围栏行本身,里面的内容照常按富文本解析。
    if (/^`{3,}[a-zA-Z0-9_-]*$/.test(line)) {
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
  const blocks = parseRichText(stripCitationMarkers(text));
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
  failed: "提交失败",
  setup_rejected: "结构审核未过 · 未下单",
  protection_failed: "保护单布置失败"
};

function PlanCard({ plan, executionOrder, action, ui, markets }) {
  if (!plan) return null;
  const risk = plan.lastRiskCheck || {};
  const checks = risk.checks || [];
  const passedCount = checks.filter((check) => check.passed).length;
  const [showChecks, setShowChecks] = useState(false);
  const awaiting = plan.status === "awaiting_approval";
  // 计划新鲜度:现价已越过止损的做多/做空计划已失效,批准必被风控复查拒绝(且会一开仓即触发止损)——
  // 直接在卡上禁用"批准计划"并说明原因,别让用户点了才被拒。
  const nowPrice = Number((markets || []).find((m) => m.symbol === plan.symbol)?.price);
  const stopVal = Number(plan.stopLoss ?? plan.stop_loss);
  const isShort = String(plan.direction).toLowerCase() === "short";
  const stopCrossed = Number.isFinite(nowPrice) && nowPrice > 0 && Number.isFinite(stopVal) && (isShort ? nowPrice >= stopVal : nowPrice <= stopVal);
  const invalidForApproval = stopCrossed || plan.status === "expired";
  return (
    <div className={`chatPlanCard ${risk.passed ? "" : "rejected"}`}>
      <header>
        <b>{plan.symbol}</b>
        <span className={plan.direction === "short" ? "negative" : "positive"}>{plan.direction === "short" ? "做空" : "做多"}</span>
        <StatusBadge tone={awaiting ? "warning" : statusTone(plan.status)}>{humanize(plan.status)}</StatusBadge>
        {stopCrossed && <span className="evBadge neg">已失效 · 现价越过止损</span>}
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
        {awaiting && !invalidForApproval && <button className="approveButton" onClick={() => action(`/api/trade-plans/${plan.id}/approve`, {})}>批准计划</button>}
        {awaiting && invalidForApproval && <button className="approveButton" disabled title="现价已越过止损，计划已失效，无法批准">已失效 · 不可批准</button>}
        {awaiting && <button onClick={() => action(`/api/trade-plans/${plan.id}/cancel`, { reason: "user_rejected" })}>{invalidForApproval ? "作废" : "拒绝"}</button>}
        <button className="ghostButton" onClick={() => ui.openPanel("auditChain")}>审计链 <ChevronRight size={13} /></button>
      </footer>
      {awaiting && invalidForApproval && <small className="planHint danger">现价 {displayPrice(nowPrice)} 已越过止损 {displayPrice(stopVal)}——计划已失效，批准会一开仓即触发止损，请作废后等 AI 重新提计划。</small>}
      {awaiting && !invalidForApproval && <small className="planHint">批准后立即进入执行引擎：按净值与止损距离计算数量、提交入场单并附带保护性止损；实盘写入关闭时只做干跑计算。</small>}
      {executionOrder && (
        <div className="executionStrip">
          <span className={`execDot ${["entry_filled", "protecting"].includes(executionOrder.status) ? "on" : executionOrder.status === "closed" ? "done" : ""}`} />
          <b>{EXECUTION_LABELS[executionOrder.status] || executionOrder.status}</b>
          <small>
            数量 {executionOrder.quantity} · 名义 {displayMoney(executionOrder.notionalUsdt)} USDT
            {executionOrder.filledPrice ? ` · 成交 ${displayMoney(executionOrder.filledPrice)}` : ""}
            {Number.isFinite(Number(executionOrder.realizedPnl)) ? ` · 盈亏 ${displayMoney(executionOrder.realizedPnl)}` : ""}
            {executionOrder.status === "setup_rejected" && executionOrder.setupReview?.reason ? ` · 原因：${executionOrder.setupReview.reason}` : ""}
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
    const er = plan?.entry_range;
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
  const marginRate = marginUsage(portfolio).marginRatePct;

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
        {/* 概念图对齐:当前 Agent 状态改为 label:value 行(映射真实字段),不再用四宫格 */}
        <div className="agStatusRows">
          {[
            { k: "策略模式", v: plan?.strategy ? humanize(plan.strategy) : (data.automationState?.label || (autoOn ? "自主运行" : "待命")), tone: data.automationState?.mode === "full_auto_small" ? "pos" : "" },
            { k: "市场环境", v: judge, tone: judgePos ? "pos" : judgeNeg ? "neg" : "" },
            { k: "当前任务", v: latestRun.steps?.[0]?.title || (plan ? `${plan.symbol} 策略评估` : "等待巡检机会") },
            { k: "授权边界", v: hasMandate && mandate.maxSingleTradeRiskPct != null ? `${mandate.maxSingleTradeRiskPct}%/笔 · 日亏≤${mandate.maxDailyLossPct ?? "-"}%` : "未授权" },
            { k: "下一步", v: nextStep },
            { k: "最近决策", v: trajSteps[0] && trajSteps[0].time !== "—" ? `${trajSteps[0].time} ${trajSteps[0].t}` : "—" }
          ].map((r) => <div className="agStatusRow" key={r.k}><span>{r.k}</span><b className={`mono ${r.tone || ""}`} title={typeof r.v === "string" ? r.v : ""}>{r.v}</b></div>)}
        </div>
        <div className="agStatusFoot"><ShieldCheck size={11} /> 受风控中心授权约束</div>
        <div className="agPlan">
          <div className="agPlanHead">
            <span className="agPlanBtc">₿</span>
            <b className="mono">{plan?.symbol || "暂无交易计划"}</b>
            {(() => {
              const mk = (data.markets || []).find((m) => m.symbol === (plan?.symbol || ""));
              if (!mk?.price || !plan) return null;
              const price = Number(mk.price);
              const stop = Number(plan.stopLoss ?? plan.stop_loss);
              const mid = Array.isArray(plan.entry_range) && plan.entry_range.length ? (Number(plan.entry_range[0]) + Number(plan.entry_range[plan.entry_range.length - 1])) / 2 : NaN;
              const isShort = String(plan.direction).toLowerCase() === "short";
              const stopCrossed = Number.isFinite(stop) && (isShort ? price >= stop : price <= stop);
              const devPct = Number.isFinite(mid) && mid > 0 ? Math.abs(mid - price) / price * 100 : 0;
              return (<>
                <span className="agPlanNow mono">现价 {displayPrice(price)}</span>
                {stopCrossed ? <span className="evBadge neg">已失效 · 现价越过止损</span>
                  : devPct > 8 ? <span className="evBadge warn">偏离现价 {devPct.toFixed(0)}% · 陈旧</span> : null}
              </>);
            })()}
            {plan && <span className="agPlanTag">{plan.strategy ? humanize(plan.strategy) : "未指定策略"}</span>}
            {plan?.executionBlock && <span className="evBadge neg" title={plan.executionBlock.detail}>已批准未下单 · {plan.executionBlock.detail.length > 22 ? `${plan.executionBlock.detail.slice(0, 22)}…` : plan.executionBlock.detail}</span>}
            <span className="agPlanRight mono">{plan ? "当前交易计划 · 价位为计划目标" : `白名单 ${(mandate.allowedSymbols || []).slice(0, 3).join(" / ") || "未设置"} · 等巡检提出机会`}</span>
          </div>
          <div className="agPlanGrid">
            <div><div className="agPlanK">入场区间</div><b className="mono">{plan ? (plan.entry?.range || (plan.entry_range ? plan.entry_range.join("–") : "—")) : "—"}</b></div>
            <div><div className="agPlanK">止损价</div><b className="mono neg">{plan ? displayPrice(plan.stopLoss ?? plan.stop_loss) : "—"}</b></div>
            <div><div className="agPlanK">止盈目标</div><b className="mono pos">{plan && (plan.takeProfit || plan.take_profit)?.length ? (plan.takeProfit || plan.take_profit).slice(0, 2).map((t) => displayPrice(t)).join(" / ") : "—"}</b></div>
            <div><div className="agPlanK" title="打到止损这笔亏账户的百分比(≤授权单笔风险上限);不是仓位大小">本笔风险·杠杆</div><b className="mono">{plan ? `${plan.max_loss_pct ?? "-"}% · ${plan.leverage || 1}x` : "—"}</b></div>
            <div><div className="agPlanK">盈亏比</div><b className="mono">{planRR ? `1 : ${planRR}` : "—"}</b></div>
            <div><div className="agPlanK">置信度</div><b className="mono">{plan?.confidence ? `${plan.confidence}%` : "—"}</b></div>
          </div>
        </div>
      </div>

      {/* 观察哨：AI 登记的价格触发条件，哨兵每分钟盯盘，命中即刻唤起巡检 */}
      <div className="agCard">
        <div className="agHeadIcon"><Eye size={13} /> 观察哨 · 分钟级盯盘</div>
        {(() => {
          const all = data.watchTriggers || [];
          const actives = all.filter((w) => w.status === "active");
          const recent = all.filter((w) => w.status !== "active").slice(0, 2);
          const label = { triggered: "已触发", expired: "已过期", cancelled: "已撤销", invalidated: "已作废" };
          const desc = (w) => w.kind === "price_above" ? `向上突破 ${displayPrice(w.level)}`
            : w.kind === "price_below" ? `向下跌破 ${displayPrice(w.level)}`
              : `回踩 ${displayPrice(w.levelLow)}–${displayPrice(w.levelHigh)}`;
          if (!all.length) return <small className="agWatchEmpty">暂无观察哨。巡检得出"若跌破/突破某价位"的结论时，AI 会把条件登记在这里，哨兵每分钟核对真实行情，命中即刻唤起 AI 重新决策。</small>;
          return (
            <div className="agWatchList">
              {actives.map((w) => {
                const remainH = Math.max(0, (new Date(w.expiresAt).getTime() - Date.now()) / 3_600_000);
                return (
                  <div className="agWatchRow" key={w.id}>
                    <span className="agWatchDot" />
                    <div className="agWatchBody">
                      <b className="mono">{w.symbol}</b> {desc(w)}
                      {w.note && <small title={w.note}>{w.note.length > 30 ? `${w.note.slice(0, 30)}…` : w.note}</small>}
                    </div>
                    <span className="agWatchMeta mono">余 {remainH >= 1 ? `${Math.round(remainH)}h` : `${Math.max(1, Math.round(remainH * 60))}m`}</span>
                    <button className="agWatchCancel" title="撤销观察哨" onClick={() => { if (window.confirm(`撤销观察哨：${w.symbol} ${desc(w)}？`)) action(`/api/watch-triggers/${w.id}/cancel`, {}); }}><XCircle size={13} /></button>
                  </div>
                );
              })}
              {recent.map((w) => (
                <div className="agWatchRow closed" key={w.id}>
                  <span className={`agWatchDot ${w.status}`} />
                  <div className="agWatchBody"><b className="mono">{w.symbol}</b> {desc(w)}</div>
                  <span className="agWatchMeta mono">{label[w.status] || w.status}{w.status === "triggered" && w.triggerPrice ? ` @${displayPrice(w.triggerPrice)}` : ""}</span>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {/* 授权与风控墙 */}
      <div className="agCard">
        <div className="agHeadIcon"><ShieldCheck size={13} /> 授权与风控墙</div>
        <div className="agWallGrid">
          {mandateRows.map((r) => <div className="agWallRow" key={r.k}><span>{r.k}</span><b className="mono">{r.v}</b></div>)}
        </div>
        <div className="agBudget">
          <div className="agBudgetTop"><span>今日亏损预算</span><span>{remaining != null ? `${displayMoney(remaining, 2)} 剩余${budgetPct != null ? ` · ${budgetPct.toFixed(0)}%` : ""}` : "未授权"}</span></div>
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

    </div>
  );
}

// 顶部 KPI 条:塞进「对话/情报」Tab 行右侧(bar=紧凑内联),填补标题区空白
export function ChatKpiStrip({ data, bar = false }) {
  const portfolio = data.portfolio || {};
  const perf = data.performance || {};
  const positions = data.positions || [];
  const btc = (data.markets || []).find((m) => /BTC/i.test(m.symbol || ""));
  const todayPnl = Number(portfolio.todayPnl || 0);
  const cumPnl = Number(perf.totalPnlUsdt ?? 0);
  const marginRate = marginUsage(portfolio).marginRatePct;
  const kpis = [
    { k: "总资产", v: displayMoney(portfolio.totalEquityUsdt, 0, "—"), d: "账户实时净值", plain: true },
    { k: "持仓风险", v: marginRate == null ? "—" : `${marginRate.toFixed(1)}%`, d: `${positions.length} 个持仓`, plain: true },
    { k: "今日盈亏", v: `${todayPnl >= 0 ? "+" : ""}${displayMoney(todayPnl, 0, "0")}`, d: portfolio.todayPnlPct != null ? displayPct(portfolio.todayPnlPct) : "等待账户同步", pos: todayPnl >= 0, colorVal: true },
    { k: "累计盈亏", v: `${cumPnl >= 0 ? "+" : ""}${displayMoney(cumPnl, 0, "0")}`, d: perf.trades ? `${perf.trades} 笔` : "尚无成交", pos: cumPnl >= 0, colorVal: true },
    { k: "BTC/USDT", v: btc ? displayMoney(btc.price, 0, "—") : "—", d: btc?.changePct != null ? displayPct(btc.changePct) : "待同步", pos: Number(btc?.changePct || 0) >= 0, colorVal: btc?.changePct != null }
  ];
  return (
    <div className={bar ? "chatKpiBar" : "chatKpiStrip"}>
      {kpis.map((kp) => (
        <div className="chatKpi" key={kp.k}>
          <div className="chatKpiK">{kp.k}</div>
          <div className="chatKpiLine"><span className={`chatKpiV mono ${kp.colorVal ? (kp.pos ? "pos" : "neg") : ""}`}>{kp.v}</span><span className={`chatKpiD mono ${kp.plain ? "" : kp.pos ? "pos" : "neg"}`}>{kp.d}</span></div>
        </div>
      ))}
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

export function ChatPage({ data, action, ui, concept = false }) {
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

  // 切走页面会 unmount ChatPage,发出去的问题在后端照常处理并落库,但组件本地的"思考中"状态丢了。
  // 重新进入时:若最后一条是用户消息(还没等到 AI 回复),说明有一轮在后端进行/刚完成——
  // 显示思考态并轮询,回复落库后自动补上,不再"停止思考不回答"(用户实锤)。
  const awaitingReply = messages.length > 0 && messages[messages.length - 1].role === "user";
  useEffect(() => {
    if (!awaitingReply || pending) return undefined;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      loadMessages();
      if (tries >= 40) clearInterval(timer); // 最多轮询 2 分钟
    }, 3000);
    return () => clearInterval(timer);
  }, [awaitingReply, pending, activeSessionId]);

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

  // 一次性清空全部对话历史（含早期悬浮助手混入的只读问答）。计划/授权/审计/成交不受影响。
  async function resetHistory() {
    if (!window.confirm("清空全部对话历史？（含早期 AI 助手混入的问答）\n交易计划、授权、审计、成交记录不受影响，无法撤销。")) return;
    try {
      const response = await fetch(apiUrl("/api/agent/chat/reset"), { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: "{}" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "清空失败");
      setSessions([]); setActiveSessionId(""); setMessages([]);
      ui.notify?.(json.message || "已清空聊天历史");
    } catch (error) {
      ui.notify?.(error.message || "清空失败");
    }
  }

  return (
    <div className={`chatShell ${view === "intel" ? "intel" : ""} ${concept ? "conceptChatShell" : ""}`}>
    {concept && view === "chat" && (
      <aside className="conceptSessions">
        <div className="conceptSessionsHead"><b>对话历史</b><button onClick={() => newSession()}><Plus size={13} /> 新对话</button></div>
        <div className="conceptSessionSearch"><Search size={13}/><span>搜索对话…</span></div>
        <small>今天</small>
        <div className="conceptSessionList">
          {sessions.map((s) => (
            <button className={s.id === activeSessionId ? "active" : ""} key={s.id} onClick={() => switchSession(s.id)} title={s.title}>
              <span>{(s.title || "未命名对话").slice(0, 18)}</span><small>{formatTime(s.updatedAt || s.createdAt)}</small>
              <i title="删除" onClick={(e) => deleteSession(s.id, e)}>×</i>
            </button>
          ))}
          {!sessions.length && <div className="conceptSessionEmpty">发送第一条消息后，会话会保存在这里。</div>}
        </div>
        {sessions.length > 0 && <button className="conceptClear" onClick={resetHistory}><Trash2 size={12}/> 清空历史</button>}
      </aside>
    )}
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
      {!concept && <div className="agHistBar">
        <span className="agHistLabel">历史会话</span>
        <button className="agSessChip newSess" onClick={() => newSession()}><Plus size={12} /> 新建</button>
        {sessions.length > 0 && <button className="agSessChip clearAll" onClick={resetHistory} title="清空全部对话历史（含早期 AI 助手混入的问答）"><Trash2 size={11} /> 清空</button>}
        {sessions.map((s) => (
          <button className={`agSessChip ${s.id === activeSessionId ? "on" : ""}`} key={s.id} onClick={() => switchSession(s.id)} title={s.title}>
            {s.id === activeSessionId && <MessageSquare size={12} />}
            {(s.title || "未命名对话").slice(0, 12)} · {formatTime(s.updatedAt || s.createdAt)}
            <i className="agSessDel" title="删除" onClick={(e) => deleteSession(s.id, e)}>×</i>
          </button>
        ))}
      </div>}

      <div className="agMsgs" ref={scrollRef}>
        {!messages.length && <SetupChecklist onExample={(example) => send(example)} />}
        {messages.map((message) => (message.role === "user" ? (
          <div className="agMsgUserRow" key={message.id}>
            <div className="agBubbleUser"><RichMessage text={message.content} compact onSuggest={null} /></div>
            <small className="agMsgMeta userSide">{formatTime(message.createdAt)}</small>
          </div>
        ) : (
          <div className="agMsgAiRow" key={message.id}>
            <span className="agAvatar"><Bot size={18} /></span>
            <div className="agBubbleAi">
              <div className="agAiLabel">AI 交易员</div>
              <RichMessage text={message.content} onSuggest={!pending ? (t) => send(t) : null} />
              {message.mandateId && <MandateCard mandate={findMandate(message.mandateId)} action={action} />}
              {message.planId && (
                <PlanCard plan={findPlan(message.planId)} executionOrder={(data.executionOrders || []).find((item) => item.planId === message.planId)} action={action} ui={ui} markets={data.markets} />
              )}
              <ToolTrace trace={message.toolTrace || []} />
              <small className="agMsgMeta">{formatTime(message.createdAt)}{message.model ? ` · ${message.model}` : ""}</small>
            </div>
          </div>
        )))}
        {(pending || awaitingReply) && (
          <div className="agMsgAiRow">
            <span className="agAvatar"><Bot size={18} /></span>
            <div className="agBubbleAi"><div className="thinkingDots"><span /><span /><span /></div>{awaitingReply && !pending && <small className="agThinkNote">思考中·可切走稍后回来查看</small>}</div>
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
      const response = await fetch(apiUrl(`/api/events/${id}`), { method: "DELETE", headers: authHeaders() });
      if (!response.ok) { const j = await response.json().catch(() => ({})); throw new Error(j.error || `删除失败 ${response.status}`); } // 此前 403/404 也本地删除,刷新又复活(审计 M4)
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
