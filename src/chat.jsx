import React, { useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { uiConfirm, uiPrompt } from "./confirm.jsx";
import {
  AlertTriangle,
  ArrowUp,
  BarChart3,
  Bot,
  BrainCircuit,
  BookOpen,
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
  Zap,
  Download,
  Image as ImageIcon,
  X
} from "lucide-react";
import { apiUrl, displayMoney, displayPrice, displayPct, formatDateTime, formatTime, humanize, marginUsage, authHeaders, smartMoneyBias, statusTone, StatusBadge, SymbolChips } from "./lib.jsx";
import { t } from "./i18n.js";
import { SITE_URL, SITE_QR } from "./siteQr.js";

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

// 执行状态标签在渲染时取 t()，语言切换（key=lang 重挂载）才能生效；模块级常量不会重算。
function executionLabel(status) {
  const map = {
    dry_run: t("干跑完成（实盘关闭）", "Dry run done (live off)"),
    entry_pending: t("入场单挂单中", "Entry order pending"),
    entry_filled: t("入场已成交", "Entry filled"),
    protecting: t("止盈止损已布置", "TP/SL placed"),
    closed: t("已平仓", "Closed"),
    cancelled: t("已取消", "Cancelled"),
    blocked: t("被安全闸拦截", "Blocked by safety gate"),
    failed: t("提交失败", "Submit failed"),
    setup_rejected: t("结构审核未过 · 未下单", "Setup rejected · no order"),
    protection_failed: t("保护单布置失败", "Protection order failed")
  };
  return map[status] || status;
}

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
        <span className={plan.direction === "short" ? "negative" : "positive"}>{plan.direction === "short" ? t("做空", "Short") : t("做多", "Long")}</span>
        <StatusBadge tone={awaiting ? "warning" : statusTone(plan.status)}>{humanize(plan.status)}</StatusBadge>
        {plan.outOfWhitelist && <span className="evBadge warn" title={t("该币不在授权白名单，确认即一次性授权本笔交易，不会加入常驻白名单", "This coin is not on the whitelist; confirming authorizes only this single trade and does not add it to the standing whitelist")}>⚠ {t("白名单外 · 一次性授权", "Off whitelist · one-time")}</span>}
        {stopCrossed && <span className="evBadge neg">{t("已失效 · 现价越过止损", "Void · price crossed stop")}</span>}
        <small>{plan.strategy ? humanize(plan.strategy) : ""} {plan.leverage ? `· ${plan.leverage}x` : ""}</small>
      </header>
      <div className="planNumbers">
        <span><small>{t("入场区间", "Entry zone")}</small><b>{plan.entry?.range || "-"}</b></span>
        <span><small>{t("止损", "Stop")}</small><b className="negative">{displayMoney(plan.stopLoss)}</b></span>
        <span><small>{t("止盈", "Take profit")}</small><b className="positive">{(plan.takeProfit || []).map((tp) => displayMoney(tp)).join(" / ") || "-"}</b></span>
        <span><small>{t("单笔风险", "Per-trade risk")}</small><b>{plan.entry?.riskPercent ?? plan.max_loss_pct ?? "-"}%</b></span>
      </div>
      <button className="riskSummaryRow" onClick={() => setShowChecks((current) => !current)}>
        {risk.passed
          ? <CheckCircle2 size={15} className="positive" />
          : <XCircle size={15} className="negative" />}
        <span>{t("风控", "Risk")} {passedCount}/{checks.length} {t("通过", "passed")} · {risk.summary || t("未检查", "not checked")}</span>
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
          <span>{t("聪明钱", "Smart money")}{plan.smartMoneyAlignment.alignment === "favor" ? t("支持该方向", " favors this side") : t("与该方向相悖", " opposes this side")}</span>
          <small>{(plan.smartMoneyAlignment.reasons || []).join("；")}</small>
        </div>
      )}
      <footer>
        {awaiting && !invalidForApproval && <button className="approveButton" onClick={() => action(`/api/trade-plans/${plan.id}/approve`, {})}>{plan.outOfWhitelist ? t("确认下单（仅本笔）", "Confirm order (this trade only)") : t("批准计划", "Approve plan")}</button>}
        {awaiting && invalidForApproval && <button className="approveButton" disabled title={t("现价已越过止损，计划已失效，无法批准", "Price has crossed the stop; the plan is void and cannot be approved")}>{t("已失效 · 不可批准", "Void · cannot approve")}</button>}
        {awaiting && <button onClick={() => action(`/api/trade-plans/${plan.id}/cancel`, { reason: "user_rejected" })}>{invalidForApproval ? t("作废", "Discard") : t("拒绝", "Reject")}</button>}
        <button className="ghostButton" onClick={() => ui.openPanel("auditChain")}>{t("审计链", "Audit chain")} <ChevronRight size={13} /></button>
      </footer>
      {plan.appliedKnowledge && ((plan.appliedKnowledge.lenses || []).length > 0 || (plan.appliedKnowledge.rules || []).length > 0) && (
        <div className="planKnowledge" title={t("本计划实际依据的透镜与铁律（AI 自报，已按真实知识库校验）", "Lenses and hard rules this plan actually relies on (AI-reported, verified against the real knowledge base)")}>
          <BookOpen size={12} />
          <span>{t("依据知识：", "Knowledge used: ")}
            {(plan.appliedKnowledge.lenses || []).map((n) => <em key={`l-${n}`} className="pkLens">{n}</em>)}
            {(plan.appliedKnowledge.rules || []).map((n) => <em key={`r-${n}`} className="pkRule">{n}</em>)}
          </span>
        </div>
      )}
      {awaiting && invalidForApproval && <small className="planHint danger">{t("现价", "Now")} {displayPrice(nowPrice)} {t("已越过止损", "has crossed the stop")} {displayPrice(stopVal)}{t("——计划已失效，批准会一开仓即触发止损，请作废后等 AI 重新提计划。", " — the plan is void; approving would trigger the stop right on entry. Discard it and wait for the AI to re-propose.")}</small>}
      {awaiting && !invalidForApproval && !plan.outOfWhitelist && <small className="planHint">{t("批准后立即进入执行引擎：按净值与止损距离计算数量、提交入场单并附带保护性止损；实盘写入关闭时只做干跑计算。", "On approval it enters the execution engine immediately: it sizes from equity and stop distance, submits the entry order with a protective stop attached; when live writes are off it only runs a dry-run calculation.")}</small>}
      {awaiting && !invalidForApproval && plan.outOfWhitelist && <small className="planHint">{plan.symbol}{t(" 不在授权白名单——这是全市场扫描发现的机会。点「确认下单」即一次性授权本笔交易并立即进入执行引擎（实盘写入关闭时只做干跑）；仅授权这一笔，不加入常驻白名单，自主巡检以后也不会自动碰它。", " is not on the whitelist — this opportunity came from a full-market scan. Tapping Confirm order authorizes just this single trade and enters the execution engine immediately (dry-run only when live writes are off); it authorizes this one trade only, is not added to the standing whitelist, and autonomous scans will never touch it on their own later.")}</small>}
      {executionOrder && (
        <div className="executionStrip">
          <span className={`execDot ${["entry_filled", "protecting"].includes(executionOrder.status) ? "on" : executionOrder.status === "closed" ? "done" : ""}`} />
          <b>{executionLabel(executionOrder.status)}</b>
          <small>
            {t("数量", "Qty")} {executionOrder.quantity} · {t("名义", "Notional")} {displayMoney(executionOrder.notionalUsdt)} USDT
            {executionOrder.filledPrice ? ` · ${t("成交", "Filled")} ${displayMoney(executionOrder.filledPrice)}` : ""}
            {Number.isFinite(Number(executionOrder.realizedPnl)) ? ` · ${t("盈亏", "PnL")} ${displayMoney(executionOrder.realizedPnl)}` : ""}
            {executionOrder.status === "setup_rejected" && executionOrder.setupReview?.reason ? ` · ${t("原因：", "Reason: ")}${executionOrder.setupReview.reason}` : ""}
          </small>
          {["entry_pending", "entry_filled", "protecting"].includes(executionOrder.status) && (
            <button onClick={() => action(`/api/execution-orders/${executionOrder.id}/close`, { reason: "manual_ui" })}>{t("撤单/平仓", "Cancel/Close")}</button>
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
      <header><Shield size={15} /><b>{t("授权委托", "Mandate")}{pending ? t("草案", " draft") : ""}</b><StatusBadge tone={pending ? "warning" : "ok"}>{humanize(mandate.status)}</StatusBadge></header>
      <div className="mandateGridMini">
        <span><small>{t("交易对", "Symbols")}</small><SymbolChips symbols={mandate.allowedSymbols} empty="-" /></span>
        <span><small>{t("最大杠杆", "Max leverage")}</small><b>{mandate.max_leverage || 1}x</b></span>
        <span><small>{t("单笔风险", "Per-trade risk")}</small><b>{mandate.maxSingleTradeRiskPct}%</b></span>
        <span><small>{t("日亏上限", "Daily loss cap")}</small><b>{mandate.maxDailyLossPct}%</b></span>
      </div>
      {pending && <footer><button className="approveButton" onClick={() => action(`/api/mandates/${mandate.id}/activate`, {})}>{t("确认激活", "Confirm & activate")}</button><small>{t("激活后 Agent 才能在此边界内提出可执行计划", "Only after activation can the agent propose executable plans within these bounds")}</small></footer>}
    </div>
  );
}

function ToolTrace({ trace = [] }) {
  const [open, setOpen] = useState(false);
  if (!trace.length) return null;
  return (
    <div className="toolTrace">
      <button onClick={() => setOpen((current) => !current)}>
        <Wrench size={12} /> {trace.length} {t("次工具调用", "tool calls")} <ChevronDown size={12} style={{ transform: open ? "rotate(180deg)" : "none" }} />
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
  // 多仓/多计划:全部取出,卡片可切换逐个看(此前只 find 出一个,多仓时看不到其余)。
  const plans = (data.tradePlans || []).filter((p) => ["awaiting_approval", "approved", "executing"].includes(p.status));
  const [planIdx, setPlanIdx] = useState(0);
  const [watchTip, setWatchTip] = useState(null); // 观察哨悬停 tooltip(fixed 定位,逃出滚动容器裁剪)
  const plan = plans.length ? plans[Math.min(planIdx, plans.length - 1)] : null;
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
  const judge = system.killSwitch ? t("已熔断", "Halted") : bias.label === "待同步" ? t("观察中", "Watching") : bias.label;
  const judgePos = bias.tone === "pos";
  const judgeNeg = bias.tone === "neg";
  // 后端真实的下一步建议是 nextActions（数组）；此前读不存在的单数 nextAction 恒 undefined，
  // 永远落到"等待信号"这个与信号无关的假文案。
  const nextStep = (agentStatus.nextActions || [])[0] || (canOpen ? t("已授权开仓", "Cleared to open") : t("未授权开仓", "Not cleared to open"));
  const remaining = system.remainingDailyLossUsdt;
  const cap = mandate.maxDailyLossPct && portfolio.totalEquityUsdt ? (Number(mandate.maxDailyLossPct) / 100) * Number(portfolio.totalEquityUsdt) : null;
  const budgetPct = cap && remaining != null ? Math.max(0, Math.min(100, (Number(remaining) / cap) * 100)) : null;
  // 只认真实同步的可用保证金；缺失就是 null——旧回退 totalEquity 会假装"持仓风险 0.0%"。
  const marginRate = marginUsage(portfolio).marginRatePct;

  const mandateRows = hasMandate ? [
    { k: t("授权范围", "Mandate scope"), v: humanize(mandate.marketTypes?.[0] || "perpetual_usdt", "永续") },
    { k: t("交易所", "Exchange"), v: (mandate.exchanges || []).join("·") || "—" },
    { k: t("白名单", "Whitelist"), v: `${(mandate.allowedSymbols || []).length} ${t("币", "coins")}` },
    { k: t("最大杠杆", "Max leverage"), v: `${mandate.max_leverage || 1}x` },
    { k: t("单笔风险", "Per-trade risk"), v: `${mandate.maxSingleTradeRiskPct ?? "-"}%` },
    { k: t("审批阈值", "Approval threshold"), v: `≥${displayMoney(mandate.humanApprovalNotionalUsdt || mandate.manual_approval_threshold_usdt || 0, 0)}` }
  ] : [
    { k: t("授权范围", "Mandate scope"), v: t("未授权", "Not authorized") }, { k: t("交易所", "Exchange"), v: "—" }, { k: t("白名单", "Whitelist"), v: "—" },
    { k: t("最大杠杆", "Max leverage"), v: "—" }, { k: t("单笔风险", "Per-trade risk"), v: "—" }, { k: t("审批阈值", "Approval threshold"), v: "—" }
  ];

  // 轨迹用最新 run 的真实步骤与各自时间戳——旧版是写死的五步流水 + 同一个时间戳复制五遍（假轨迹）。
  const TRAJ_ICONS = { observe: Eye, regime: BrainCircuit, decision: ClipboardList, risk_check: Shield, execution: Hourglass };
  const trajSteps = (latestRun.steps || []).slice(0, 5).map((s) => ({
    Icon: TRAJ_ICONS[s.phase] || BrainCircuit,
    t: (s.title || humanize(s.phase, "步骤")).slice(0, 6),
    time: s.createdAt ? formatTime(s.createdAt) : "—"
  }));

  const kpis = [
    { k: t("总资产", "Equity"), v: displayMoney(portfolio.totalEquityUsdt, 0, "—"), d: portfolio.todayPnlPct != null ? displayPct(portfolio.todayPnlPct) : "", pos: Number(portfolio.todayPnl || 0) >= 0 },
    { k: t("持仓风险", "Position risk"), v: marginRate == null ? "—" : `${marginRate.toFixed(1)}%`, d: `${positions.length} ${t("仓", "pos")}`, plain: true },
    { k: t("今日盈亏", "Today PnL"), v: `${todayPnl >= 0 ? "+" : ""}${displayMoney(todayPnl, 0, "0")}`, d: portfolio.todayPnlPct != null ? displayPct(portfolio.todayPnlPct) : "", pos: todayPnl >= 0, colorVal: true },
    { k: t("累计盈亏", "Cumulative PnL"), v: `${cumPnl >= 0 ? "+" : ""}${displayMoney(cumPnl, 0, "0")}`, d: perf.trades ? `${perf.trades} ${t("笔", "trades")}` : "", pos: cumPnl >= 0, colorVal: true },
    { k: "BTC/USDT", v: btc ? displayMoney(btc.price, 0, "—") : "—", d: btc?.changePct != null ? displayPct(btc.changePct) : "", pos: Number(btc?.changePct || 0) >= 0 }
  ];

  async function toggleAutonomy() { await action("/api/system/autonomy", { enabled: !system.autonomyEnabled }); }
  async function fireKill() { if (await uiConfirm(system.killSwitch ? t("确认解除熔断？", "Lift the circuit breaker?") : t("确认一键熔断？将立即阻断所有新开仓。", "Trigger the circuit breaker? This immediately blocks all new position opens."))) await action("/api/risk/kill-switch", { enabled: !system.killSwitch, reason: "" }); }

  return (
    <div className="agRail">
      {watchTip && (
        <div className="agWatchTipFixed" style={{ left: Math.max(8, watchTip.rect.left - 312), top: Math.min(watchTip.rect.top, (typeof window !== "undefined" ? window.innerHeight : 800) - 190) }}>
          {watchTip.lines.map((ln, i) => <div key={i}>{ln}</div>)}
        </div>
      )}
      {/* 当前 Agent 状态 */}
      <div className="agCard">
        <div className="agHeadNum"><span className="agNum">2</span>{t("当前 Agent 状态", "Agent status")}</div>
        {/* 概念图对齐:当前 Agent 状态改为 label:value 行(映射真实字段),不再用四宫格 */}
        <div className="agStatusRows">
          {[
            { k: t("策略模式", "Strategy mode"), v: plan?.strategy ? humanize(plan.strategy) : (data.automationState?.label || (autoOn ? t("自主运行", "Autonomous") : t("待命", "Standby"))), tone: data.automationState?.mode === "full_auto_small" ? "pos" : "" },
            { k: t("市场环境", "Market regime"), v: judge, tone: judgePos ? "pos" : judgeNeg ? "neg" : "" },
            { k: t("当前任务", "Current task"), v: latestRun.steps?.[0]?.title || (plan ? `${plan.symbol} ${t("策略评估", "strategy review")}` : t("等待巡检机会", "Waiting for a scan opportunity")) },
            { k: t("授权边界", "Mandate limits"), v: hasMandate && mandate.maxSingleTradeRiskPct != null ? `${mandate.maxSingleTradeRiskPct}%/${t("笔", "trade")} · ${t("日亏≤", "daily loss ≤")}${mandate.maxDailyLossPct ?? "-"}%` : t("未授权", "Not authorized") },
            { k: t("下一步", "Next step"), v: nextStep },
            { k: t("最近决策", "Last decision"), v: trajSteps[0] && trajSteps[0].time !== "—" ? `${trajSteps[0].time} ${trajSteps[0].t}` : "—" }
          ].map((r) => <div className="agStatusRow" key={r.k}><span>{r.k}</span><b className={`mono ${r.tone || ""}`} title={typeof r.v === "string" ? r.v : ""}>{r.v}</b></div>)}
        </div>
        <div className="agStatusFoot"><ShieldCheck size={11} /> {t("受风控中心授权约束", "Bound by Risk Center authorization")}</div>
        <div className="agPlan">
          <div className="agPlanHead">
            <span className="agPlanBtc">₿</span>
            <b className="mono">{plan?.symbol || t("暂无交易计划", "No trade plan")}</b>
            {plans.length > 1 && (
              <span className="agPlanSwitch">
                <button type="button" onClick={() => setPlanIdx((i) => (i - 1 + plans.length) % plans.length)} title={t("上一个持仓/计划", "Previous position/plan")}>‹</button>
                <em className="mono">{Math.min(planIdx, plans.length - 1) + 1}/{plans.length}</em>
                <button type="button" onClick={() => setPlanIdx((i) => (i + 1) % plans.length)} title={t("下一个持仓/计划", "Next position/plan")}>›</button>
              </span>
            )}
            {plan && (() => {
              // 挂单 vs 持仓的真实状态:限价单已提交但价格没到=挂单未成交(仓位仍为0),成交后才是持仓。
              const eo = (data.executionOrders || []).find((o) => o.planId === plan.id);
              const held = (data.positions || []).some((p) => p.symbol === plan.symbol && Number(p.size ?? p.pos ?? 0) !== 0);
              const st = held || ["entry_filled", "protecting"].includes(eo?.status) ? { t: t("持仓中", "Holding"), c: "pos" }
                : eo?.status === "entry_pending" ? { t: t("⏳挂单未成交", "⏳ Pending fill"), c: "warn" }
                : eo?.status === "closed" ? { t: t("已平仓", "Closed"), c: "" }
                : plan.status === "awaiting_approval" ? { t: t("待确认", "Pending"), c: "warn" }
                : plan.status === "approved" ? { t: t("准备下单", "Ready to order"), c: "warn" }
                : null;
              return st ? <span className={`evBadge ${st.c}`}>{st.t}</span> : null;
            })()}
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
                <span className="agPlanNow mono">{t("现价", "Now")} {displayPrice(price)}</span>
                {stopCrossed ? <span className="evBadge neg">{t("已失效 · 现价越过止损", "Void · price crossed stop")}</span>
                  : devPct > 8 ? <span className="evBadge warn">{t("偏离现价", "Off market")} {devPct.toFixed(0)}% · {t("陈旧", "stale")}</span> : null}
              </>);
            })()}
            {plan && <span className="agPlanTag">{plan.strategy ? humanize(plan.strategy) : t("未指定策略", "No strategy set")}</span>}
            {plan?.executionBlock && <span className="evBadge neg" title={plan.executionBlock.detail}>{t("已批准未下单", "Approved, not ordered")} · {plan.executionBlock.detail.length > 22 ? `${plan.executionBlock.detail.slice(0, 22)}…` : plan.executionBlock.detail}</span>}
            <span className="agPlanRight mono">{plan ? t("当前交易计划 · 价位为计划目标", "Current plan · prices are plan targets") : t("等巡检提出机会", "Awaiting scan opportunities")}</span>
          </div>
          {!plan && (() => {
            // 无计划时的授权白名单:计数 + 省略号截断(白名单再多也不挤爆,全量在 title 里),简写去 /USDT。
            const wl = (mandate.allowedSymbols || []).map((s) => String(s));
            return (
              <div className="agPlanWl" title={wl.join(" · ") || t("未设置授权白名单", "No whitelist set")}>
                <span className="agPlanWlLabel">{t("授权", "Authorized")} {wl.length} {t("币", "coins")}</span>
                <span className="agPlanWlList">{wl.map((s) => s.replace(/\/USDT$/i, "")).join(" · ") || t("未设置", "None set")}</span>
              </div>
            );
          })()}
          <div className="agPlanGrid">
            <div><div className="agPlanK">{t("入场区间", "Entry zone")}</div><b className="mono">{plan ? (plan.entry?.range || (plan.entry_range ? plan.entry_range.join("–") : "—")) : "—"}</b></div>
            <div><div className="agPlanK">{t("止损价", "Stop price")}</div><b className="mono neg">{plan ? displayPrice(plan.stopLoss ?? plan.stop_loss) : "—"}</b></div>
            <div><div className="agPlanK">{t("止盈目标", "Take profit")}</div><b className="mono pos">{plan && (plan.takeProfit || plan.take_profit)?.length ? (plan.takeProfit || plan.take_profit).slice(0, 2).map((tp) => displayPrice(tp)).join(" / ") : "—"}</b></div>
            <div><div className="agPlanK" title={t("打到止损这笔亏账户的百分比(≤授权单笔风险上限);不是仓位大小", "Percent of the account this trade loses if the stop is hit (≤ the authorized per-trade risk cap); not the position size")}>{t("本笔风险·杠杆", "Trade risk · leverage")}</div><b className="mono">{plan ? `${plan.max_loss_pct ?? "-"}% · ${plan.leverage || 1}x` : "—"}</b></div>
            <div><div className="agPlanK">{t("盈亏比", "R:R")}</div><b className="mono">{planRR ? `1 : ${planRR}` : "—"}</b></div>
            <div><div className="agPlanK">{t("置信度", "Confidence")}</div><b className="mono">{plan?.confidence != null ? `${plan.confidence}%` : "—"}</b></div>
          </div>
        </div>
      </div>

      {/* 观察哨：AI 登记的价格触发条件，哨兵每分钟盯盘，命中即刻唤起巡检 */}
      <div className="agCard">
        <div className="agHeadIcon"><Eye size={13} /> {t("观察哨 · 分钟级盯盘", "Watch · minute-by-minute")}</div>
        {(() => {
          const all = data.watchTriggers || [];
          const actives = all.filter((w) => w.status === "active");
          const recent = all.filter((w) => w.status !== "active").slice(0, 2);
          const label = { triggered: t("已触发", "Triggered"), expired: t("已过期", "Expired"), cancelled: t("已撤销", "Cancelled"), invalidated: t("已作废", "Void") };
          const desc = (w) => w.kind === "price_above" ? `${t("向上突破", "Breaks above")} ${displayPrice(w.level)}`
            : w.kind === "price_below" ? `${t("向下跌破", "Breaks below")} ${displayPrice(w.level)}`
              : `${t("回踩", "Pullback to")} ${displayPrice(w.levelLow)}–${displayPrice(w.levelHigh)}`;
          // 悬停显示完整信息(侧栏窄、note 被截断 → 鼠标放上去看全:条件 + 完整备注 + 状态 + 时间)。
          const fullInfo = (w) => [
            `${w.symbol} · ${desc(w)}`,
            w.note ? `${t("备注：", "Note: ")}${w.note}` : "",
            w.status === "active"
              ? `${t("到期：", "Expires: ")}${new Date(w.expiresAt).toLocaleString("zh-CN")}`
              : `${label[w.status] || w.status}${w.status === "triggered" && w.triggerPrice ? ` @${displayPrice(w.triggerPrice)}` : ""}`,
            w.createdAt ? `${t("登记于：", "Logged: ")}${new Date(w.createdAt).toLocaleString("zh-CN")}` : ""
          ].filter(Boolean).join("\n");
          if (!all.length) return <small className="agWatchEmpty">{t("暂无观察哨。巡检得出\"若跌破/突破某价位\"的结论时，AI 会把条件登记在这里，哨兵每分钟核对真实行情，命中即刻唤起 AI 重新决策。", "No watches yet. When a scan concludes \"if price breaks below/above a level\", the AI logs the condition here; the sentinel checks live prices every minute and wakes the AI to re-decide the moment it hits.")}</small>;
          return (
            <div className="agWatchList">
              {actives.map((w) => {
                const remainH = Math.max(0, (new Date(w.expiresAt).getTime() - Date.now()) / 3_600_000);
                return (
                  <div className="agWatchRow" key={w.id} onMouseEnter={(e) => setWatchTip({ lines: fullInfo(w).split("\n"), rect: e.currentTarget.getBoundingClientRect() })} onMouseLeave={() => setWatchTip(null)}>
                    <span className="agWatchDot" />
                    <div className="agWatchBody">
                      <b className="mono">{w.symbol}</b> {desc(w)}
                      {w.note && <small>{w.note.length > 30 ? `${w.note.slice(0, 30)}…` : w.note}</small>}
                    </div>
                    <span className="agWatchMeta mono">{t("余", "Left")} {remainH >= 1 ? `${Math.round(remainH)}h` : `${Math.max(1, Math.round(remainH * 60))}m`}</span>
                    <button className="agWatchCancel" title={t("撤销观察哨", "Cancel watch")} onClick={async () => { if (await uiConfirm(`${t("撤销观察哨：", "Cancel watch: ")}${w.symbol} ${desc(w)}？`)) action(`/api/watch-triggers/${w.id}/cancel`, {}); }}><XCircle size={13} /></button>
                  </div>
                );
              })}
              {recent.map((w) => (
                <div className="agWatchRow closed" key={w.id} onMouseEnter={(e) => setWatchTip({ lines: fullInfo(w).split("\n"), rect: e.currentTarget.getBoundingClientRect() })} onMouseLeave={() => setWatchTip(null)}>
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
        <div className="agHeadIcon"><ShieldCheck size={13} /> {t("授权与风控墙", "Mandate & Risk wall")}</div>
        <div className="agWallGrid">
          {mandateRows.map((r) => <div className="agWallRow" key={r.k}><span>{r.k}</span><b className="mono">{r.v}</b></div>)}
        </div>
        <div className="agBudget">
          <div className="agBudgetTop"><span>{t("今日亏损预算", "Today's loss budget")}</span><span>{remaining != null ? `${displayMoney(remaining, 2)} ${t("剩余", "left")}${budgetPct != null ? ` · ${budgetPct.toFixed(0)}%` : ""}` : t("未授权", "Not authorized")}</span></div>
          <div className="agBudgetBar"><i style={{ width: `${budgetPct ?? 0}%` }} /></div>
        </div>
        <div className="agWallBtns">
          <button className="agBtnGhost" onClick={toggleAutonomy}>{autoOn ? t("暂停", "Pause") : t("恢复", "Resume")}</button>
          <button className="agBtnKill" onClick={fireKill}><Zap size={12} /> {system.killSwitch ? t("解除熔断", "Lift breaker") : t("一键熔断", "Kill switch")}</button>
        </div>
      </div>

      {/* Agent 运行轨迹 */}
      <div className="agCard">
        <div className="agTrajHead"><span className="agSecLabel"><i />{t("Agent 运行轨迹 · 最新循环", "Run trace · latest loop")}</span><button className="agLink" onClick={() => ui.setActive("auditSystem")}>{t("完整 ›", "Full ›")}</button></div>
        <div className="agTrajGrid">
          {!trajSteps.length && <div className="emptyPanel" style={{ gridColumn: "1 / -1" }}>{t("暂无运行记录；开启自主巡检后显示真实步骤轨迹", "No run records yet; enable autonomous scanning to see the real step trace")}</div>}
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
    { k: t("总资产", "Equity"), v: displayMoney(portfolio.totalEquityUsdt, 0, "—"), d: t("账户实时净值", "Live account equity"), plain: true },
    { k: t("持仓风险", "Position risk"), v: marginRate == null ? "—" : `${marginRate.toFixed(1)}%`, d: `${positions.length} ${t("个持仓", "positions")}`, plain: true },
    { k: t("今日盈亏", "Today PnL"), v: `${todayPnl >= 0 ? "+" : ""}${displayMoney(todayPnl, 0, "0")}`, d: portfolio.todayPnlPct != null ? displayPct(portfolio.todayPnlPct) : t("等待账户同步", "Awaiting account sync"), pos: todayPnl >= 0, colorVal: true },
    { k: t("累计盈亏", "Cumulative PnL"), v: `${cumPnl >= 0 ? "+" : ""}${displayMoney(cumPnl, 0, "0")}`, d: perf.trades ? `${perf.trades} ${t("笔", "trades")}` : t("尚无成交", "No fills yet"), pos: cumPnl >= 0, colorVal: true },
    { k: "BTC/USDT", v: btc ? displayMoney(btc.price, 0, "—") : "—", d: btc?.changePct != null ? displayPct(btc.changePct) : t("待同步", "Syncing"), pos: Number(btc?.changePct || 0) >= 0, colorVal: btc?.changePct != null }
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
    t("看看 BTC 现在的走势，说说你的判断", "Look at BTC's current trend and give me your read"),
    t("稳健做 BTC/ETH：单笔风险 0.3%，日亏损上限 1%，最大 3 倍杠杆，重大事件前 30 分钟停止开仓", "Trade BTC/ETH conservatively: 0.3% per-trade risk, 1% daily loss cap, max 3x leverage, stop opening 30 minutes before major events"),
    t("现在有哪些高影响事件？对我的持仓有什么风险？", "What high-impact events are there right now? What's the risk to my positions?")
  ];
  return (
    <div className="setupChecklist">
      <div className="examplePrompts">
        {examples.map((example) => <button key={example} onClick={() => onExample(example)}>{example}</button>)}
      </div>
    </div>
  );
}

// 把一条 AI 交易员分析渲染成精美海报,支持中/英切换与导出 PNG(社交分享获客)。
// 内容只用消息原文(中文)+ 后端 LLM 翻译(英文),不编造。图片在前端由 html-to-image 从模板导出。
function PosterModal({ content, meta, onClose }) {
  const [lang, setLang] = useState("zh");
  const [enText, setEnText] = useState("");
  const [translating, setTranslating] = useState(false);
  const [transError, setTransError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const posterRef = useRef(null);

  useEffect(() => {
    const onEsc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  async function toEnglish() {
    setLang("en");
    if (enText || translating) return;
    setTranslating(true); setTransError("");
    try {
      const response = await fetch(apiUrl("/api/posters/translate"), {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ text: content })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.translated) throw new Error(json.error || `${t("翻译失败", "Translation failed")}(${response.status})`);
      setEnText(json.translated);
    } catch (error) {
      setTransError(error.message || t("翻译失败", "Translation failed")); setLang("zh");
    } finally { setTranslating(false); }
  }

  async function download() {
    if (!posterRef.current) return;
    setDownloading(true);
    try {
      const dataUrl = await toPng(posterRef.current, { pixelRatio: 2, cacheBust: true, backgroundColor: "#ffffff" });
      const link = document.createElement("a");
      link.download = `ai-trader-${lang}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}.png`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      setTransError(`${t("导出图片失败：", "Image export failed: ")}${error.message || error}`);
    } finally { setDownloading(false); }
  }

  const enReady = lang === "zh" || Boolean(enText);
  const body = lang === "en" ? enText : content;
  const dateStr = meta?.createdAt ? formatDateTime(meta.createdAt) : "";

  return (
    <div className="posterOverlay" onClick={onClose}>
      <div className="posterModal" onClick={(e) => e.stopPropagation()}>
        <div className="posterToolbar">
          <div className="posterLangTabs">
            <button type="button" className={lang === "zh" ? "active" : ""} onClick={() => setLang("zh")}>中文</button>
            <button type="button" className={lang === "en" ? "active" : ""} onClick={toEnglish} disabled={translating}>
              {translating ? t("翻译中…", "Translating…") : "English"}
            </button>
          </div>
          <div className="posterActions">
            <button type="button" className="primaryButton" disabled={downloading || !enReady} onClick={download}>
              <Download size={14} /> {downloading ? t("生成中…", "Generating…") : t("下载 PNG", "Download PNG")}
            </button>
            <button type="button" className="posterClose" onClick={onClose} title={t("关闭", "Close")}><X size={16} /></button>
          </div>
        </div>
        {transError && <div className="posterError">{transError}</div>}
        <div className="posterScroll">
          <div className="posterCanvas" ref={posterRef}>
            <div className="posterHeader">
              <div className="posterBrand">
                <span className="posterLogo"><Bot size={22} /></span>
                <div className="posterBrandText">
                  <b>{lang === "en" ? "AI Trader" : "AI 交易员"}</b>
                  <small>{lang === "en" ? "Autonomous market analysis" : "自主行情分析"}</small>
                </div>
              </div>
              {dateStr && <span className="posterDate">{dateStr}</span>}
            </div>
            <div className="posterBody">
              {lang === "en" && !enText
                ? <div className="posterTranslating">{translating ? "Translating…" : t("点击 English 生成英文版", "Click English to generate the English version")}</div>
                : <RichMessage text={body} />}
            </div>
            <div className="posterFooter">
              <div className="posterFootLeft">
                <span className="posterTag">{lang === "en" ? "AI-generated · Not financial advice" : "AI 自动生成 · 仅供参考，不构成投资建议"}</span>
                <span className="posterSite">{lang === "en" ? "Try autonomous AI trading" : "扫码体验 AI 自主交易"} · <b>{SITE_URL}</b></span>
              </div>
              <img className="posterQr" src={SITE_QR} alt={SITE_URL} width="72" height="72" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChatPage({ data, action, ui, concept = false }) {
  const system = data.system || {};
  const autoOn = system.autonomyEnabled === true && !system.killSwitch;
  const [messages, setMessages] = useState([]);
  const [posterMsg, setPosterMsg] = useState(null); // 当前要生成海报的 AI 消息
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [view, setView] = useState("chat");
  const [llmConfigured, setLlmConfigured] = useState(true);
  const [provider, setProvider] = useState(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  // 输入框自动长高:随内容增高到 160px 上限,超过再内部滚动——不再卡在 1 行看不全打的字。
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

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
      if (!response.ok) throw new Error(json.error || `${t("请求失败", "Request failed")} ${response.status}`);
      await loadMessages(json.agentMessage?.sessionId || activeSessionId);
      await ui.refresh(false);
    } catch (error) {
      setMessages((current) => [...current, { id: `err_${Date.now()}`, role: "agent", content: `${t("请求失败：", "Request failed: ")}${error.message}`, createdAt: new Date().toISOString() }]);
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
      if (!response.ok) throw new Error(json.error || t("删除失败", "Delete failed"));
      setSessions(json.sessions || []);
      if (sessionId === activeSessionId) { setActiveSessionId(""); setMessages([]); }
    } catch (error) {
      ui.notify?.(error.message || t("删除失败", "Delete failed"));
    }
  }

  // 一次性清空全部对话历史（含早期悬浮助手混入的只读问答）。计划/授权/审计/成交不受影响。
  async function resetHistory() {
    if (!await uiConfirm(t("清空全部对话历史？（含早期 AI 助手混入的问答）\n交易计划、授权、审计、成交记录不受影响，无法撤销。", "Clear all chat history? (including early Q&A mixed in from the assistant)\nTrade plans, mandates, audits, and fills are unaffected. This cannot be undone."))) return;
    try {
      const response = await fetch(apiUrl("/api/agent/chat/reset"), { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: "{}" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || t("清空失败", "Clear failed"));
      setSessions([]); setActiveSessionId(""); setMessages([]);
      ui.notify?.(json.message || t("已清空聊天历史", "Chat history cleared"));
    } catch (error) {
      ui.notify?.(error.message || t("清空失败", "Clear failed"));
    }
  }

  return (
    <div className={`chatShell ${view === "intel" ? "intel" : ""} ${concept ? "conceptChatShell" : ""}`}>
    <div className="agChat">
      <div className="agChatHead">
        <div className="agChatTitle"><span className="agChatNum">1</span>{view === "chat" ? t("与 AI 交易员对话", "Chat with the AI trader") : t("情报中心", "Intel Center")}</div>
        <div className="agChatHeadR">
          <div className="agViewToggle">
            <button className={view === "chat" ? "on" : ""} title={t("对话", "Chat")} onClick={() => setView("chat")}><MessageSquare size={13} /></button>
            <button className={view === "intel" ? "on" : ""} title={t("情报", "Intel")} onClick={() => setView("intel")}><Radar size={13} /></button>
          </div>
          <span className={`agRunBadge ${autoOn ? "on" : "off"}`}><span />{autoOn ? t("运行中", "Running") : system.killSwitch ? t("已熔断", "Halted") : t("已暂停", "Paused")}</span>
          <button className="agLaunchBtn" onClick={() => action("/api/system/autonomy", { enabled: !system.autonomyEnabled })}><Rocket size={14} /> {system.autonomyEnabled ? t("暂停自主", "Pause autonomy") : t("启动自主交易", "Start autonomous trading")}</button>
        </div>
      </div>

      {view === "intel" ? <IntelCenter action={action} data={data} /> : (<>
      {<div className={`agHistBar ${concept ? "conceptHistBar" : ""}`}>
        <span className="agHistLabel">{t("对话历史", "History")}</span>
        <button className="agSessChip newSess" onClick={() => newSession()}><Plus size={12} /> {t("新建", "New")}</button>
        {sessions.length > 0 && <button className="agSessChip clearAll" onClick={resetHistory} title={t("清空全部对话历史（含早期 AI 助手混入的问答）", "Clear all chat history (including early Q&A mixed in from the assistant)")}><Trash2 size={11} /> {t("清空", "Clear")}</button>}
        {sessions.map((s) => (
          <button className={`agSessChip ${s.id === activeSessionId ? "on" : ""}`} key={s.id} onClick={() => switchSession(s.id)} title={s.title}>
            {s.id === activeSessionId && <MessageSquare size={12} />}
            {(s.title || t("未命名对话", "Untitled")).slice(0, 12)} · {formatTime(s.updatedAt || s.createdAt)}
            <i className="agSessDel" title={t("删除", "Delete")} onClick={(e) => deleteSession(s.id, e)}>×</i>
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
              <div className="agAiLabel">{t("AI 交易员", "AI Trader")}</div>
              <RichMessage text={message.content} onSuggest={!pending ? (t) => send(t) : null} />
              {message.mandateId && <MandateCard mandate={findMandate(message.mandateId)} action={action} />}
              {message.planId && (
                <PlanCard plan={findPlan(message.planId)} executionOrder={(data.executionOrders || []).find((item) => item.planId === message.planId)} action={action} ui={ui} markets={data.markets} />
              )}
              <ToolTrace trace={message.toolTrace || []} />
              <div className="agMsgFootRow">
                <small className="agMsgMeta">{formatTime(message.createdAt)}{message.model ? ` · ${message.model}` : ""}</small>
                {String(message.content || "").length > 80 && (
                  <button type="button" className="agPosterBtn" title={t("把这条分析做成海报（中/英，可导出）", "Turn this analysis into a poster (ZH/EN, exportable)")} onClick={() => setPosterMsg(message)}>
                    <ImageIcon size={13} /> {t("海报", "Poster")}
                  </button>
                )}
              </div>
            </div>
          </div>
        )))}
        {(pending || awaitingReply) && (
          <div className="agMsgAiRow">
            <span className="agAvatar"><Bot size={18} /></span>
            <div className="agBubbleAi"><div className="thinkingDots"><span /><span /><span /></div>{awaitingReply && !pending && <small className="agThinkNote">{t("思考中·可切走稍后回来查看", "Thinking · you can switch away and check back later")}</small>}</div>
          </div>
        )}
      </div>

      {(data.pendingActions || []).length > 0 && (
        <div className="pendingActionsDock">
          {(data.pendingActions || []).map((pa) => (
            <div className={`pendingActionCard ${pa.danger ? "danger" : ""}`} key={pa.id}>
              <div className="paInfo"><span className="paBadge">{t("待确认操作", "Pending action")}</span><b>{pa.title}</b><small>{pa.detail}</small></div>
              <div className="paActions">
                <button className="secondaryButton" onClick={() => action(`/api/agent/actions/${pa.id}/cancel`, {})}>{t("取消", "Cancel")}</button>
                <button className={pa.danger ? "dangerButton" : "primaryButton"} onClick={() => action(`/api/agent/actions/${pa.id}/confirm`, {})}>{t("确认执行", "Confirm")}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {posterMsg && <PosterModal content={stripCitationMarkers(posterMsg.content)} meta={posterMsg} onClose={() => setPosterMsg(null)} />}

      <div className="agInputBar">
        <textarea
          ref={inputRef}
          value={input}
          rows={1}
          placeholder={provider ? `${t("输入指令，与 AI 交易员对话…", "Message the AI trader…")}（${provider.name}/${provider.model}）` : t("输入指令，与 AI 交易员对话… 例如「把仓位降到 5%」", "Message the AI trader… e.g. \"Cut my position to 5%\"")}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }}
        />
        <button className="agSend" disabled={pending || !input.trim()} onClick={() => send()} aria-label={t("发送", "Send")}><ArrowUp size={18} /></button>
      </div>
      </>)}
    </div>
    {view === "chat" && <AgentRail data={data} action={action} ui={ui} send={send} />}
    </div>
  );
}

// 情报中心：把新闻聚合成的"事件专题"按热点排序展示，每个专题可展开看持续跟进的时间线。
function IntelCenter({ action, data = {} }) {
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
          <h3>{t("情报中心", "Intel Center")}</h3>
          <span>{t("把零散新闻聚合成事件专题，按影响度、热度、时效与你的持仓相关性排序、持续跟进", "Aggregates scattered news into event threads, ranked by impact, heat, recency and relevance to your positions, and followed over time")}</span>
        </div>
        <button className="secondaryButton" onClick={refresh} disabled={busy}><RefreshCw size={14} /> {busy ? t("刷新中…", "Refreshing…") : t("刷新情报", "Refresh intel")}</button>
      </div>
      {(() => {
        // 自动刷新状态条:直接读事件源刷新定时任务的真实 上次/下次,让用户看出它在按 20 分钟节奏转,
        // 而不是"只有手动点才更新"。任务不存在(旧库未排程)时不显示。
        const task = (data.tasks || []).find((x) => x.id === "task_sys_event_refresh");
        if (!task) return null;
        const paused = task.enabled === false;
        const every = String(task.schedule || "").replace(/^Every\s*/i, "");
        return (
          <div className={`intelAutoBar ${paused ? "off" : "on"}`}>
            <span className="intelAutoDot" />
            <b>{paused ? t("自动刷新已暂停", "Auto-refresh paused") : t("自动刷新中", "Auto-refreshing")}</b>
            <small>{t("每", "Every")} {every} · {t("上次", "Last")} {formatDateTime(task.lastRunAt, "—")} · {t("下次", "Next")} {formatDateTime(task.nextRunAt, "—")}</small>
          </div>
        );
      })()}
      {(data.missedOpportunities || []).length > 0 && (
        <div className="missedOppCard">
          <div className="missedOppHead"><BookOpen size={14} /> 错过机会复盘 <small>大波动却没交易的复盘，已沉淀进 AI 记忆</small></div>
          <div className="missedOppList">
            {(data.missedOpportunities || []).slice(0, 6).map((m) => (
              <div className={`missedOppRow ${m.inWhitelist ? "wl" : ""}`} key={m.key}>
                <b>{m.symbol}</b>
                <span className={m.changePct >= 0 ? "pos" : "neg"}>{m.changePct >= 0 ? "+" : ""}{m.changePct}%</span>
                {m.inWhitelist ? <em className="tagWl">白名单内·本可做</em> : <em className="tagOff">白名单外</em>}
                {m.analyzed && <em className="tagAn">分析过没做</em>}
                {m.lesson && <p title={m.lesson}>{m.lesson}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
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
            // 25 分钟内有新报道并进来的专题 = 刚更新(一轮自动刷新的窗口),打新鲜标让归并进时间线的新新闻显出来。
            const freshMs = ev.lastUpdatedAt ? Date.now() - new Date(ev.lastUpdatedAt).getTime() : Infinity;
            const fresh = freshMs >= 0 && freshMs < 25 * 60 * 1000;
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
                      {fresh && <span className="intelFresh" title={`最近更新 ${formatDateTime(ev.lastUpdatedAt, "—")}`}>刚更新</span>}
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
