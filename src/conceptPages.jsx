import React, { useEffect, useMemo, useState } from "react";
import { uiConfirm, uiPrompt } from "./confirm.jsx";
import {
  Activity, AlertTriangle, BarChart3, Bell, BookOpen, Bot,
  CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleDollarSign, Clock3, Database, Eye, Globe2,
  FileText, GitBranch, Info, KeyRound,
  Play, Plus, RefreshCw, Rocket, Search, Server, ShieldCheck,
  Sparkles, Target, TrendingUp, Users, WalletCards,
  Wrench, XCircle
} from "lucide-react";
import { ChatPage } from "./chat.jsx";
import { SymbolMultiSelect, SystemConfigPanel } from "./panels.jsx";
import { ConceptGraph } from "./conceptGraph.jsx";
import { apiUrl, authHeaders, automationPresentation, countOpenExecutions, displayMoney, displayPct, formatDateTime, formatTime, humanize, localizeText, SKILL_STATE, TradingViewChart } from "./lib.jsx";
import { t } from "./i18n.js";
import { executionExitAction, requestExecutionExit } from "./executionExit.js";
import { buildCapabilityCatalogRows, buildEventRows, buildExecutionView, buildMarketRows, buildPositionView, buildStrategyCatalogRows, isApprovedKnowledgeWorkflow, isCompletedTradeReview, isPublishedImportedSkill, isPublishedKnowledgeStrategy, netReviewResult, positionNotionalUsdt } from "./viewData.js";

// 技能/策略生命周期状态 → 中文短标签 + Pill 颜色(cp2Pill 用 good/warn/bad/neutral)。
// 修:此前策略详情用 humanize 直接吐英文原值(historical_rejected → "historical rejected")又长又跨行,
// 且 toneOf 匹配不到把"历史未通过"错染成绿色。统一走 SKILL_STATE。
const SKILL_TONE_CLASS = { ok: "good", warning: "warn", danger: "bad", info: "warn", neutral: "neutral" };
const SKILL_LABEL_EN = { compile_failed:"Compilation failed",compiled:"Needs historical validation",historical_rejected:"Historical validation failed",historical_validated:"Ready for forward validation",paper_validating:"Forward validation running",paper_rejected:"Forward validation failed",paper_validated:"Awaiting approval",live_probation:"Small-size live trial",active:"Live",degraded:"Disabled after performance decline",superseded:"Superseded",retired:"Retired" };
const skillStatusLabel = (status) => SKILL_STATE[status] ? t(SKILL_STATE[status].label, SKILL_LABEL_EN[status] || humanize(status,"—")) : humanize(status, "—");
const skillStatusTone = (status) => SKILL_STATE[status] ? (SKILL_TONE_CLASS[SKILL_STATE[status].tone] || "neutral") : toneOf(status);
const PRODUCT_STATE_LABEL = {
  research:["研究中","Research"],historical_validation:["历史验证中","Historical validation"],
  owner_live_observation:["实盘观察（未验证）","Live observation (unvalidated)"],
  validated_active:["证据达标运行中","Evidence-qualified live"],paused:["已暂停","Paused"],
  degraded:["表现降级","Degraded"],retired:["已退役","Retired"]
};
const productStateLabel = (status) => { const pair=PRODUCT_STATE_LABEL[status]; return pair?t(pair[0],pair[1]):skillStatusLabel(status); };
const productStateTone = (status) => status==="validated_active"?"good":status==="owner_live_observation"||/validation|research/.test(String(status))?"warn":/degraded|retired/.test(String(status))?"bad":"neutral";
const PRODUCT_EVIDENCE_LABEL={closed_trades:["已平仓样本","Closed trades"],profit_factor:["盈亏因子","Profit factor"],expectancy_r:["R 期望","R expectancy"],consecutive_losses:["当前连续亏损","Current loss streak"]};
const productEvidenceLabel=(key)=>{const pair=PRODUCT_EVIDENCE_LABEL[key];return pair?t(pair[0],pair[1]):humanize(key);};
const strategyDirectionLabel=(value)=>value==="both"?t("多空双向","Long & short"):humanize(value,"—");
import "./conceptPages.css";
import "./conceptSettings.css";

const arr = (value) => Array.isArray(value) ? value : [];
const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const money = (value, fallback = "—") => value == null ? fallback : displayMoney(value, 2, fallback);
const toneOf = (value = "") => /失败|异常|熔断|拒绝|critical|error|block/i.test(String(value))
  ? "bad"
  : /等待|警告|待|warning|pause|pending/i.test(String(value)) ? "warn" : "good";

export function ConceptCard({ title, meta, icon: Icon, action, className = "", children }) {
  return <section className={`cp2Card ${className}`}>
    {(title || action) && <header className="cp2CardHead"><div>{Icon && <Icon size={14}/>}<b>{title}</b>{meta && <span>{meta}</span>}</div>{action}</header>}
    {children}
  </section>;
}

export function Pill({ children, tone = "neutral" }) {
  return <span className={`cp2Pill ${tone}`}>{children}</span>;
}

export function WatchMonitorConcept({ data, action }) {
  const watches = arr(data.watchTriggers);
  const active = watches.filter((item) => item.status === "active");
  const watchGroups = arr(data.watchBoard).length ? arr(data.watchBoard) : Object.values(active.reduce((groups, item) => {
    groups[item.symbol] ||= { symbol: item.symbol, analysisAt: item.analysisAt || item.createdAt, primary: null, secondary: [] };
    if (!groups[item.symbol].primary || item.priority === "primary") {
      if (groups[item.symbol].primary) groups[item.symbol].secondary.push(groups[item.symbol].primary);
      groups[item.symbol].primary = item;
    } else groups[item.symbol].secondary.push(item);
    return groups;
  }, {}));
  const history = watches.filter((item) => item.status !== "active").slice(0, 8);
  const anomalies = arr(data.abnormalVolatility);
  const flashes = arr(data.newsFeed).slice(0, 6);
  const watchDescription = (item) => item.kind === "price_above"
    ? `${t("向上突破", "Break above")} ${money(item.level)}`
    : item.kind === "price_below"
      ? `${t("向下跌破", "Break below")} ${money(item.level)}`
      : `${t("进入区间", "Enter zone")} ${money(item.levelLow)}–${money(item.levelHigh)}`;
  const purposeLabel = (item) => ({ decision: t("核心决策点", "Core decision"), confirmation: t("确认条件", "Confirmation"), invalidation: t("失效条件", "Invalidation"), alternative: t("备选情景", "Alternative") }[item.purpose] || t("辅助情景", "Supporting scenario"));
  const directionOf = (item) => item.direction === "long" ? "long" : item.direction === "short" ? "short" : "neutral";
  const directionLabel = (item) => directionOf(item) === "long" ? t("做多情景", "Long scenario") : directionOf(item) === "short" ? t("做空情景", "Short scenario") : t("中性观察", "Neutral watch");
  const directionTone = (item) => directionOf(item) === "long" ? "good" : directionOf(item) === "short" ? "bad" : "neutral";
  const thesisText = (item) => localizeText(item.displayThesis || item.thesis || item.analysisTitle, item.displayThesisEn || item.thesis || item.analysisTitle) || t("当前方向尚未确认，等待关键条件提供新的决策依据。", "No trade direction is confirmed; the system is waiting for the next decision point.");
  const meaningText = (item) => localizeText(item.displayTriggerMeaning || item.triggerMeaning || item.note, item.displayTriggerMeaningEn || item.triggerMeaning || item.note) || t("命中后重新检查结构、量能与盈亏比，不直接下单。", "Re-check structure, flow and risk/reward after the trigger; do not enter automatically.");
  const anomalyLabel = (status) => ({ confirmed: t("已经发生", "Confirmed"), elevated: t("风险升高", "Elevated risk"), normal: t("暂未异常", "No anomaly"), insufficient_data: t("样本不足", "Insufficient data") }[status] || humanize(status));
  const anomalyTone = (status) => status === "confirmed" ? "bad" : status === "elevated" ? "warn" : status === "normal" ? "good" : "neutral";
  return <div className="cp2Stack wmPage">
    <div className="wmHero"><div><Eye/><span><b>{t("实时盯盘与异常波动", "Live Watch & Abnormal Volatility")}</b><small>{t("先看方向与原判断，再看条件命中会改变什么；命中只触发复核，不等于开仓", "Read the direction and original thesis first, then what the trigger changes; a trigger starts review, not a trade")}</small></span></div><div><strong>{watchGroups.length}</strong><span>{t(`${active.length} 个条件 · ${watchGroups.length} 个币种`, `${active.length} conditions · ${watchGroups.length} symbols`)}</span></div></div>
    <div className="wmGrid">
      <ConceptCard title={t("正在盯盘", "Active Watches")} meta={t("WebSocket 实时核对 OKX 价格", "Checked against OKX prices over WebSocket")} action={<Pill tone={active.length ? "good" : "neutral"}>{active.length}</Pill>}>
        <div className="wmWatchList">{watchGroups.map((group) => {
          const item = group.primary;
          if (!item) return null;
          const expires = new Date(item.expiresAt || 0).getTime();
          const minutes = Math.max(0, Math.round((expires - Date.now()) / 60000));
          return <article className={`wmWatchGroup ${directionOf(item)}`} key={group.symbol}><i/><div><header><b>{item.symbol}</b><Pill tone={directionTone(item)}>{directionLabel(item)}</Pill><Pill>{purposeLabel(item)}</Pill><span className="wmAnalysisAt">{t("最新分析", "Latest analysis")} {formatDateTime(group.analysisAt || item.createdAt)}</span></header><div className="wmWatchContext"><span>{t("当前原判断", "Current thesis")}</span><p>{thesisText(item)}</p></div><div className="wmWatchDecision"><span><small>{t("正在等待", "Waiting for")}</small><strong>{watchDescription(item)}</strong></span><span><small>{t("命中意味着", "If triggered")}</small><p>{meaningText(item)}</p></span></div><small>{t("剩余", "Time left")} {minutes >= 60 ? `${Math.round(minutes / 60)}h` : `${minutes}m`} · {t("命中后重新分析方向、入场与风控，不会直接下单", "Re-analyze direction, entry and risk after the trigger; no direct order")}</small>{arr(group.secondary).length > 0 && <div className="wmSecondary"><b>{t("同一判断下的辅助条件", "Supporting conditions for this thesis")}</b>{arr(group.secondary).map((secondary) => <div key={secondary.id}><span><span className="wmSecondaryHead"><Pill tone={directionTone(secondary)}>{directionLabel(secondary)}</Pill><Pill>{purposeLabel(secondary)}</Pill></span><strong>{watchDescription(secondary)}</strong><small>{meaningText(secondary)}</small></span><button type="button" title={t("撤销辅助条件", "Cancel supporting condition")} onClick={async()=>{if(await uiConfirm(`${t("确认撤销", "Cancel")} ${secondary.symbol} ${watchDescription(secondary)}？`))action(`/api/watch-triggers/${secondary.id}/cancel`,{});}}><XCircle/></button></div>)}</div>}</div><button type="button" title={t("撤销主观察哨", "Cancel primary watch")} onClick={async()=>{if(await uiConfirm(`${t("确认撤销主观察哨", "Cancel primary watch")} ${item.symbol} ${watchDescription(item)}？`))action(`/api/watch-triggers/${item.id}/cancel`,{});}}><XCircle/></button></article>;
        })}{!active.length && <div className="cp2Empty"><Eye/><b>{t("暂无正在盯盘的条件", "No active watches")}</b><span>{t("AI 只有实际调用登记工具后，条件才会出现在这里。", "A condition appears here only after the AI actually calls the watch-registration tool.")}</span></div>}</div>
      </ConceptCard>
      <ConceptCard title={t("5 分钟异常波动风险", "5-minute Abnormal-Move Risk")} meta={t("默认阈值：绝对涨跌 ≥ 5%", "Default threshold: absolute move ≥ 5%")}>
        <div className="wmAnomalyList">{anomalies.slice(0, 10).map((item) => <article key={item.symbol} className={item.status}><div><b>{item.symbol}</b><Pill tone={anomalyTone(item.status)}>{anomalyLabel(item.status)}</Pill></div><span><strong>{item.realizedMovePct == null ? "—" : `${item.realizedMovePct > 0 ? "+" : ""}${item.realizedMovePct}%`}</strong><small>{t("风险分", "risk score")} {item.riskScore ?? "—"}</small></span><p>{t(item.caveat,item.caveatEn||item.caveat)}</p></article>)}{!anomalies.length && <div className="cp2Empty"><Activity/><b>{t("短周期样本正在预热", "Short-window data is warming up")}</b><span>{t("样本不足时系统不会猜测异常波动。", "The system does not guess when samples are insufficient.")}</span></div>}</div>
      </ConceptCard>
    </div>
    <div className="wmGrid lower">
      <ConceptCard title={t("最近触发记录", "Recent Watch History")}><div className="wmHistory">{history.map((item) => <div key={item.id}><span className={item.status}/><b>{item.symbol} · {directionLabel(item)}</b><p>{watchDescription(item)}</p><small>{item.status === "triggered" ? `${t("已触发重新分析", "Re-analysis triggered")} · ${meaningText(item)}` : item.status === "superseded" ? t("已被最新分析取代", "Superseded by latest analysis") : humanize(item.status)} · {formatDateTime(item.triggeredAt || item.closedAt || item.updatedAt || item.createdAt)}</small></div>)}{!history.length && <div className="cp2Empty"><Clock3/><b>{t("暂无历史记录", "No history yet")}</b></div>}</div></ConceptCard>
      <ConceptCard title={t("最新重要快讯", "Latest Important Flashes")} meta={t("快讯只增加上下文，不直接决定交易", "News adds context; it never decides a trade by itself")}><div className="wmFlashList">{flashes.map((item) => <article key={item.id}><Pill tone={item.values?.important ? "warn" : "neutral"}>{item.values?.important ? t("重要", "Important") : t("快讯", "Flash")}</Pill><div><b>{localizeText(item.title)}</b><small>{formatDateTime(item.publishedAt)} · {item.sourceName || item.source || "ME News"}</small></div></article>)}{!flashes.length && <div className="cp2Empty"><Bell/><b>{t("暂无新快讯", "No new flashes")}</b></div>}</div></ConceptCard>
    </div>
  </div>;
}

export function ConceptMetric({ label, value, sub, tone = "", icon: Icon }) {
  return <div className={`cp2Metric ${tone}`}>{Icon && <span className="cp2MetricIcon"><Icon size={15}/></span>}<div><small>{label}</small><b>{value}</b>{sub && <em>{sub}</em>}</div></div>;
}

export function ConceptTable({ columns, rows, empty = t("暂无数据", "No data"), compact = false, onRowClick, activeId }) {
  if (!rows.length) return <div className="cp2Empty"><Database size={19}/><b>{empty}</b><span>{t("系统产生真实数据后会自动显示。", "Data appears automatically once the system generates it.")}</span></div>;
  return <div className="cp2TableWrap"><table className={`cp2Table ${compact ? "compact" : ""} ${onRowClick ? "rowClickable" : ""}`}><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || index} className={onRowClick && activeId != null && row.id === activeId ? "rowOn" : ""} onClick={onRowClick ? () => onRowClick(row) : undefined}>{columns.map((column) => <td key={column.key}>{column.render ? column.render(row) : (row[column.key] ?? "—")}</td>)}</tr>)}</tbody></table></div>;
}

function MiniLine({ values = [], tone = "green", height = 58 }) {
  const clean = values.map(Number).filter(Number.isFinite);
  // 无模拟数据:数据不足时给诚实空态,不再画一条编造的上升曲线;并用显式高度避免在宽卡里被拉伸变形
  if (clean.length <= 1) return <div className="cp2MiniLineEmpty" style={{ height: `${height}px` }}>{t("暂无曲线数据", "No chart data yet")}</div>;
  const points = clean;
  const min = Math.min(...points); const max = Math.max(...points); const span = Math.max(1, max - min);
  const path = points.map((value, index) => `${index ? "L" : "M"} ${index * (100 / Math.max(1, points.length - 1))} ${height - 5 - ((value - min) / span) * (height - 12)}`).join(" ");
  return <svg className={`cp2MiniLine ${tone}`} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ height: `${height}px` }}><path d={`${path} L 100 ${height} L 0 ${height} Z`} className="area"/><path d={path} className="line"/></svg>;
}

function Donut({ value = 0, label, sub, tone = "green", size = 94 }) {
  const safe = Math.max(0, Math.min(100, num(value)));
  return <div className={`cp2Donut ${tone}`} style={{ "--pct": `${safe * 3.6}deg`, width: size, height: size }}><div><b>{label ?? `${Math.round(safe)}%`}</b>{sub && <small>{sub}</small>}</div></div>;
}

function BarRows({ rows }) {
  const max = Math.max(1, ...rows.map((row) => Math.abs(num(row.value))));
  return <div className="cp2Bars">{rows.map((row) => <div key={row.label}><span>{row.label}</span><i><b style={{ width: `${Math.max(4, Math.abs(num(row.value)) / max * 100)}%` }}/></i><em>{row.display ?? row.value}</em></div>)}</div>;
}

export function AiDialogConcept({ data, action, ui }) {
  return <ChatPage data={data} action={action} ui={ui} concept/>;
}

export function IntelligenceConcept({ data, action, ui }) {
  const [category, setCategory] = useState("全部");
  const [selected, setSelected] = useState(0);
  const [detailTab, setDetailTab] = useState("关联资产");
  const [timeRange, setTimeRange] = useState("24h");
  const [minConf, setMinConf] = useState(0);
  const events = arr(data.events);
  const flashes = arr(data.newsFeed);
  const movers = arr(data.marketMovers?.movers);
  const knowledge = arr(data.knowledge);
  const items = [
    ...flashes.map((item, index) => ({
      ...item, id: item.id || `flash-${index}`, category: "快讯", source: item.sourceName || "ME News 快讯",
      title: item.title, confidence: num(item.confidence) <= 1 ? num(item.confidence) * 100 : num(item.confidence),
      impact: item.values?.impact ?? 0, createdAt: item.publishedAt, relatedSymbols: item.symbols || [],
      important: item.values?.important === true
    })),
    ...events.map((item, index) => ({ ...item, id: item.id || `event-${index}`, category: item.category || "宏观", title: item.title || item.name, source: item.source || "事件源", confidence: item.confidence, impact: item.impact })),
    ...movers.map((item, index) => {
      const grounded = item.narrative || {};
      const confidence = grounded.confidence === "high" ? 90 : grounded.confidence === "medium" ? 70 : grounded.confidence === "low" ? 45 : null;
      return {
        ...item,
        id: `mover-${index}`,
        category: "市场",
        title: `${item.symbol} ${num(item.changePct) >= 0 ? "+" : ""}${item.changePct ?? "—"}%`,
        source: grounded.evidenceId ? "Gemini 联网归因" : "异动扫描",
        summary: grounded.untrustedDisplay?.narrative || null,
        riskNote: grounded.untrustedDisplay?.risk || null,
        confidence,
        impact: Math.abs(num(item.changePct)) >= 5 ? 90 : 60,
        createdAt: grounded.attributedAt || data.marketMovers?.scannedAt,
        citations: arr(grounded.citations),
        searchProvider: grounded.searchProvider || null,
        providerAttributionVerified: grounded.providerAttributionVerified === true,
        sourceUrl: grounded.citations?.[0]?.url || null
      };
    }),
    ...knowledge.slice(0, 4).map((item, index) => ({ ...item, id: `knowledge-${index}`, category: "知识", title: item.title || item.name || "知识更新", source: "知识库", confidence: null, impact: null }))
  ];
  // 真实筛选:分类 + 置信度阈值 + 时间范围(有时间戳的才按范围过滤)
  const nowT = Date.now(); const rangeMs = timeRange === "7d" ? 7 * 86400000 : 86400000;
  const filtered = items.filter((item) => {
    if (category !== "全部" && item.category !== category) return false;
    if (minConf && num(item.confidence) < minConf) return false;
    const t = new Date(item.createdAt || item.due || item.time || 0).getTime();
    if (Number.isFinite(t) && t > 0 && (nowT - t) > rangeMs) return false;
    return true;
  });
  const active = filtered[selected] || filtered[0] || {};
  // 真实关联资产:优先取情报富化的 affectedSymbols,再取事件 relatedSymbols,异动取自身 symbol;都没有则诚实留空
  const activeSymbols = arr(active.intel?.affectedSymbols).length ? arr(active.intel.affectedSymbols) : arr(active.relatedSymbols).length ? arr(active.relatedSymbols) : (active.symbol ? [active.symbol] : []);
  const relatedPlans = arr(data.tradePlans).filter((p) => activeSymbols.some((s) => String(p.symbol || "").toUpperCase().includes(String(s).replace(/[/-].*/, "").toUpperCase())));
  return <div className="cp2IntelLayout">
    <aside className="cp2SideFilter">
      <b>{t("情报分类", "Intel categories")}</b>
      {["全部", "快讯", "宏观", "市场", "链上", "知识"].map((name) => <button key={name} className={category === name ? "active" : ""} onClick={() => { setCategory(name); setSelected(0); }}>{t(name, { "全部": "All", "快讯": "Flash", "宏观": "Macro", "市场": "Market", "链上": "On-chain", "知识": "Knowledge" }[name] || name)}<span>{name === "全部" ? items.length : items.filter((item) => item.category === name).length}</span></button>)}
      <div className="cp2FilterGroup"><small>{t("时间范围", "Time range")}</small><select value={timeRange} onChange={(e)=>setTimeRange(e.target.value)}><option value="24h">{t("24 小时", "24h")}</option><option value="7d">{t("7 天", "7d")}</option></select><small>{t("置信度", "Confidence")}</small><select value={minConf} onChange={(e)=>setMinConf(Number(e.target.value))}><option value={0}>{t("全部", "All")}</option><option value={70}>≥ 70%</option></select></div>
    </aside>
    <main className="cp2IntelFeed">
      <ConceptCard title={t("今日情报摘要", "Today's Intel Summary")} icon={Sparkles} meta={`${t("更新于", "Updated")} ${formatTime(flashes[0]?.observedAt || data.marketMovers?.scannedAt)}`}>
        <div className="cp2Metrics four compact">
          <ConceptMetric label={t("实时快讯", "Live flashes")} value={`${flashes.length} ${t("条", "items")}`} sub={t("30 秒快车道", "30s fast lane")}/>
          <ConceptMetric label={t("市场状态", "Market state")} value={data.marketRegime?.global?.label || t("观察中", "Observing")} sub={t("结构判断", "Structure read")}/>
          <ConceptMetric label={t("链上信号", "On-chain signal")} value={t("待同步", "Pending sync")} sub={t("未配置则不推断", "No inference if unconfigured")}/>
          <ConceptMetric label={t("异常波动", "Anomalies")} value={`${movers.length} ${t("个", "")}`} sub={t("实时扫描", "Live scan")}/>
        </div>
      </ConceptCard>
      {(() => {
        // 自动刷新状态条:读事件源刷新定时任务的真实 上次/下次,让用户看出事件源在按节奏自动抓,
        // 而不是"只有手动点刷新才更新"。任务不存在(旧库未排程)时不显示。
        const lanes = [
          ["task_sys_news_flash", t("快讯", "Flash")],
          ["task_sys_event_source_refresh", "RSS"],
          ["task_sys_event_refresh", t("深层整合", "Deep synthesis")]
        ].map(([id, label]) => [arr(data.tasks).find((x) => x.id === id), label]).filter(([task]) => task);
        if (!lanes.length) return null;
        const paused = lanes.every(([task]) => task.enabled === false);
        return <div className={`cp2AutoBar ${paused ? "off" : "on"}`}>
          <span className="cp2AutoDot"/>
          <b>{paused ? t("自动刷新已暂停", "Auto-refresh paused") : t("分层新闻流运行中", "Layered news feed running")}</b>
          <small>{lanes.map(([task, label]) => `${label} ${String(task.schedule || "").replace(/^Every\s*/i, "")}`).join(" · ")}</small>
        </div>;
      })()}
      <ConceptCard title={t("情报动态", "Intel Feed")} meta={`${filtered.length} ${t("条", "")}`}>
        <div className="cp2IntelList">{filtered.map((item, index) => {
          const freshAt = item.observedAt || item.lastUpdatedAt || item.createdAt;
          const freshMs = freshAt ? nowT - new Date(freshAt).getTime() : Infinity;
          const fresh = freshMs >= 0 && freshMs < 25 * 60 * 1000;
          return <button key={item.id} className={index === selected ? "active" : ""} onClick={() => setSelected(index)}><span className={`cp2IntelIcon ${toneOf(item.impact)}`}><Activity size={14}/></span><div><b>{item.title || t("未命名情报", "Untitled intel")}{item.important && <em className="cp2Fresh">{t("重要", "Important")}</em>}{fresh && <em className="cp2Fresh">{t("刚更新", "Just updated")}</em>}</b><small>{item.source} · {formatTime(item.createdAt || item.due || item.time)}{num(item.updateCount) > 1 ? ` · ${item.updateCount} ${t("条报道", "reports")}` : ""}</small><p>{item.summary || item.description || t("等待更多来源交叉验证。", "Awaiting cross-verification from more sources.")}</p></div><Pill tone={num(item.impact) >= 80 ? "bad" : num(item.impact) >= 50 ? "warn" : "good"}>{num(item.impact) >= 80 ? t("高", "High") : num(item.impact) >= 50 ? t("中", "Med") : t("低", "Low")}</Pill></button>;
        })}{!filtered.length && <div className="cp2Empty"><Sparkles size={20}/><b>{t("暂无情报动态", "No intel yet")}</b><span>{t("配置事件源后,新闻 / 链上 / 异动会在此汇总并交叉验证。", "Once event sources are configured, news / on-chain / anomalies are aggregated and cross-verified here.")}</span></div>}</div>
      </ConceptCard>
    </main>
    <aside className="cp2IntelDetail">
      <ConceptCard title={t("影响评估", "Impact Assessment")} icon={Target}>
        <div className="cp2DetailTabs">{["关联资产","关联计划"].map((tab)=><button key={tab} className={detailTab===tab?"active":""} onClick={()=>setDetailTab(tab)}>{t(tab, tab==="关联资产"?"Related assets":"Related plans")}</button>)}</div>
        <b className="cp2DetailTitle">{active.title || t("选择一条情报", "Select an intel item")}</b>
        {detailTab==="关联资产"
          ? <div className="cp2AssetRows">{activeSymbols.length ? activeSymbols.map((symbol)=>{const im=num(active.impact);return <div key={symbol}><span>{symbol}</span><Pill tone={im>=80?"bad":im>=50?"warn":"neutral"}>{im>=80?t("高", "High"):im>=50?t("中度", "Medium"):t("轻度", "Light")}</Pill><small>{active.intel?.sentiment||"—"}</small></div>;}) : <div className="cp2Empty" style={{minHeight:60}}><b>{t("该情报暂无明确关联资产", "No clearly related assets for this intel")}</b><span>{t("接入并富化事件源后自动标注。", "Auto-tagged once event sources are connected and enriched.")}</span></div>}</div>
          : <div className="cp2AssetRows">{relatedPlans.length ? relatedPlans.slice(0,6).map((p)=><div key={p.id}><span>{p.symbol}</span><Pill tone={toneOf(p.status)}>{humanize(p.status)}</Pill><small>{humanize(p.direction,"—")}</small></div>) : <div className="cp2Empty" style={{minHeight:60}}><b>{t("暂无关联交易计划", "No related trade plans")}</b><span>{t("该情报涉及币种当前无在途计划。", "No active plans for the symbols in this intel.")}</span></div>}</div>}
        <div className="cp2Relation"><b>{t("关联结论", "Conclusion")}</b><p>{active.summary || active.description || t("当前情报尚未形成可执行结论，只作为 AI 分析上下文。", "No actionable conclusion yet; used only as AI analysis context.")}</p></div>
        {active.category === "市场" && <div className={`cp2GeminiGrounding ${active.citations?.length ? "verified" : "pending"}`}>
          <header><Sparkles size={14}/><span><b>{t("Gemini 搜索证据", "Gemini search evidence")}</b><small>{active.providerAttributionVerified ? `${active.searchProvider || "Provider"} · ${t("提供商已归因", "provider attributed")}` : t("未取得可验证的来源归因", "No verifiable source attribution")}</small></span><Pill tone={active.citations?.length ? "good" : "warn"}>{active.citations?.length ? t(`${active.citations.length} 个来源`, `${active.citations.length} sources`) : t("仅行情事实", "Market facts only")}</Pill></header>
          {active.riskNote && <p><b>{t("消息面风险", "Narrative risk")}</b>{active.riskNote}</p>}
          {active.citations?.length > 0 ? <div>{active.citations.slice(0,5).map((citation)=><a key={citation.url} href={citation.url} target="_blank" rel="noreferrer"><span>{citation.title || citation.source}</span><small>{citation.source}</small><ChevronRight size={12}/></a>)}</div> : <p>{t("Gemini 没有返回可核验链接，因此这条归因只能作为低信任研究上下文，不能直接触发交易。", "Gemini returned no verifiable links, so this attribution remains low-trust research context and cannot directly trigger a trade.")}</p>}
          <footer>{t("外部网页内容永远不直接下单；还要经过证据完整性、DeepSeek 审查和确定性硬风控。", "External web content never places orders directly; evidence readiness, DeepSeek review, and deterministic hard-risk checks still apply.")}</footer>
        </div>}
        <button className="cp2Secondary" disabled={!active.title} onClick={async () => {
          // 把这条情报写入 AI 交易员的记忆(决策时注入系统提示词),让 Agent 在后续分析中考虑它。
          const body = `情报｜${active.title}｜${active.summary || active.description || ""}｜关联资产：${activeSymbols.join("、") || "—"}｜影响：${num(active.impact) >= 80 ? "高" : num(active.impact) >= 50 ? "中" : "低"}`;
          await action("/api/agent/memory", { layer: "semantic", title: `情报上下文：${active.title}`, content: body.slice(0, 500), tags: ["情报", "上下文"], source: "intel" });
          ui.notify?.(t("已加入 AI 交易员分析上下文", "Added to AI trader analysis context"));
        }}>{t("加入上下文", "Add to context")}</button>
        {active.sourceUrl && <a className="cp2Secondary" href={active.sourceUrl} target="_blank" rel="noreferrer">{t("查看来源", "Open source")}</a>}
        <button className="cp2Primary" onClick={() => action("/api/event-sources/refresh", {})}>{t("刷新情报", "Refresh intel")}</button>
      </ConceptCard>
    </aside>
  </div>;
}

function marketRows(data) {
  return buildMarketRows(data).slice(0, 12).map((item) => ({ ...item, change: item.changePct, volume: item.volume24h }));
}

// 全部 OKX USDT 永续合约清单(真实拉取),供行情选币与加自选使用。
function useInstruments() {
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

// 搜索式币对选择器:输入币种即时过滤,支持全部永续合约;点选回填。替代原生 prompt 与 12 个的硬编码下拉。
function PairPicker({ instruments, value, onPick, label = t("选择币对", "Select pair"), triggerClass = "cp2PairTrigger", align = "left" }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const qU = q.trim().toUpperCase();
  const list = (instruments || []).filter((s) => !qU || s.includes(qU)).slice(0, 80);
  const close = () => { setOpen(false); setQ(""); };
  return <div className="cp2PairPicker">
    <button type="button" className={triggerClass} onClick={() => setOpen((o) => !o)}>{value || label}<ChevronDown size={13}/></button>
    {open && <>
      <div className="cp2PairBackdrop" onClick={close}/>
      <div className={`cp2PairMenu ${align === "right" ? "alignRight" : ""}`}>
        <div className="cp2Search"><Search size={13}/><input autoFocus className="cp2SearchInput" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("输入币种，如 BTC / SOL", "Enter symbol, e.g. BTC / SOL")}/></div>
        <div className="cp2PairList">
          {list.map((s) => <button type="button" key={s} className={s === value ? "on" : ""} onClick={() => { onPick(s); close(); }}>{s}</button>)}
          {!list.length && <span className="cp2PairEmpty">{instruments && instruments.length ? t("无匹配币对", "No matching pairs") : t("合约清单加载中…", "Loading contracts…")}</span>}
        </div>
      </div>
    </>}
  </div>;
}

export function TradingOverviewConcept({ data, action, ui }) {
  const pf = data.portfolio || {};
  const positions = buildPositionView(data).positions; const fills = arr(data.fills); const orders = arr(data.executionOrders).length ? arr(data.executionOrders) : buildPositionView(data).openOrders;
  const markets = marketRows(data); const activeMarket = data.activeMarket || markets[0] || {};
  const equity = pf.totalEquityUsdt; const used = num(equity) - num(pf.availableMarginUsdt);
  const runtime = automationPresentation(data);
  const runtimeMetricTone = runtime.tone === "ok" ? "good" : runtime.tone === "danger" ? "bad" : runtime.tone === "warning" ? "warn" : "";
  return <div className="cp2Stack tradingCommandPage">
    <div className="cp2Metrics five">
      <ConceptMetric label={t("总资产", "Total equity")} value={equity == null ? t("未同步", "Not synced") : `${money(equity)} USDT`} sub={t("账户实时净值", "Live account equity")}/>
      <ConceptMetric label={t("今日盈亏", "Today's PnL")} value={`${num(pf.todayPnl) >= 0 ? "+" : ""}${money(pf.todayPnl, "0")} USDT`} sub={displayPct(pf.todayPnlPct, t("等待账户同步", "Awaiting account sync"))} tone={num(pf.todayPnl) >= 0 ? "good" : "bad"}/>
      <ConceptMetric label={t("可用保证金", "Available margin")} value={pf.availableMarginUsdt == null ? t("未同步", "Not synced") : `${money(pf.availableMarginUsdt)} USDT`} sub={equity ? `${t("可用", "Free")} ${Math.max(0, 100 - used / num(equity) * 100).toFixed(1)}%` : "—"}/>
      <ConceptMetric label={t("风险预算", "Risk budget")} value={data.system?.remainingDailyLossUsdt == null ? t("未授权", "Not authorized") : `${money(data.system.remainingDailyLossUsdt)} USDT`} sub={t("今日剩余", "Remaining today")}/>
      <ConceptMetric label={t("当前运行", "Runtime")} value={runtime.label} sub={runtime.entryPolicy} tone={runtimeMetricTone}/>
    </div>
    <div className="tradingPrimaryDeck">
    {(() => {
      // ③ 行为约束层:日/月盈利目标进度(UTC+8 自然日/月边界)+ 达标"落袋"提示 + 亏损触发反报复冷却。
      const closes = buildExecutionView(data).closedTrades.filter((trade) => Number.isFinite(Number(trade.netRealizedPnl)));
      const shift = (d) => new Date(new Date(d).getTime() + 8 * 3600000);
      const dk = (d) => { const s = shift(d); return `${s.getUTCFullYear()}-${s.getUTCMonth()}-${s.getUTCDate()}`; };
      const mk = (d) => { const s = shift(d); return `${s.getUTCFullYear()}-${s.getUTCMonth()}`; };
      const nowS = shift(new Date());
      const todayKey = `${nowS.getUTCFullYear()}-${nowS.getUTCMonth()}-${nowS.getUTCDate()}`, monKey = `${nowS.getUTCFullYear()}-${nowS.getUTCMonth()}`;
      const todayPnl = closes.filter((trade) => dk(trade.createdAt) === todayKey).reduce((sum, trade) => sum + Number(trade.netRealizedPnl), 0);
      const monthPnl = closes.filter((trade) => mk(trade.createdAt) === monKey).reduce((sum, trade) => sum + Number(trade.netRealizedPnl), 0);
      const dailyGoal = Number(data.system?.dailyGoalUsdt) > 0 ? Number(data.system.dailyGoalUsdt) : null;
      const monthlyGoal = Number(data.system?.monthlyGoalUsdt) > 0 ? Number(data.system.monthlyGoalUsdt) : null;
      const monthlyGoalDays = Number(data.system?.monthlyGoalDays) || new Date(nowS.getUTCFullYear(), nowS.getUTCMonth() + 1, 0).getDate();
      const dayPct = dailyGoal > 0 ? Math.max(0, Math.min(100, (todayPnl / dailyGoal) * 100)) : 0;
      const monPct = monthlyGoal > 0 ? Math.max(0, Math.min(100, (monthPnl / monthlyGoal) * 100)) : 0;
      const goalMet = dailyGoal > 0 && todayPnl >= dailyGoal, revenge = dailyGoal > 0 && todayPnl <= -0.5 * dailyGoal;
      return <ConceptCard title={t("🎯 目标进度 · 行为约束", "🎯 Goal Progress · Behavioral Guardrails")} meta={t("日/月盈利目标(UTC+8)· 只做监控,不进 AI 决策", "Daily/monthly profit goals (UTC+8) · monitoring only, not fed into AI decisions")} action={<button className="cp2Link" onClick={async () => {
        const d = await uiPrompt(t("每日盈利目标(USDT,留空=不设)", "Daily profit goal (USDT, blank = none)"), data.system?.dailyGoalUsdt != null ? String(data.system.dailyGoalUsdt) : "");
        if (d === null) return;
        action("/api/system/goals", { dailyGoalUsdt: d === "" ? null : Number(d) });
      }}>{t("设置目标", "Set goals")}</button>}>
        <div className="bcGrid">
          <div className="bcGoal"><div className="bcTop"><span>{t("今日已实现", "Realized today")}</span><b className={todayPnl >= 0 ? "good" : "bad"}>{money(todayPnl)} / {dailyGoal?money(dailyGoal):t("未设置","Not set")}</b></div><div className="bcBar"><i style={{ width: `${dayPct}%`, background: todayPnl < 0 ? "var(--bad,#c8492f)" : "var(--good,#2e9e6b)" }} /></div></div>
          <div className="bcGoal"><div className="bcTop"><span>{t(`本月已实现 · 日目标 × ${monthlyGoalDays} 天`, `Realized this month · daily × ${monthlyGoalDays} days`)}</span><b className={monthPnl >= 0 ? "good" : "bad"}>{money(monthPnl)} / {monthlyGoal?money(monthlyGoal):t("随日目标自动设置","Derived from daily goal")}</b></div><div className="bcBar"><i style={{ width: `${monPct}%`, background: "var(--accent)" }} /></div></div>
        </div>
        {goalMet && <div className="bcAlert good">{t("🎯 已达今日盈利目标——落袋为安,见好就收,别把利润还回去。", "🎯 Daily profit goal reached — lock in gains, quit while ahead, don't give profits back.")}</div>}
        {revenge && <div className="bcAlert bad">{t("⚠ 当日亏损已达日目标的 50%——高度警惕报复性交易,建议停手冷静、今日降频降仓。", "⚠ Today's loss hit 50% of the daily goal — beware revenge trading; step back, calm down, cut frequency and size today.")}</div>}
      </ConceptCard>;
    })()}
    <div className="cp2TradingHero">
      <ConceptCard title={activeMarket.symbol || "BTC/USDT"} meta={t("实时行情 · 交易所公开数据", "Live market · public exchange data")} className="cp2ChartCard" action={<button className="cp2Link" onClick={() => ui.setActive("marketAccount")}>{t("查看完整行情 ›", "Full market ›")}</button>}>
        <div className="cp2Quote"><b>{activeMarket.price == null ? t("待同步", "Pending sync") : money(activeMarket.price)}</b><Pill tone={num(activeMarket.changePct) >= 0 ? "good" : "bad"}>{activeMarket.changePct == null ? "—" : `${num(activeMarket.changePct) >= 0 ? "+" : ""}${num(activeMarket.changePct).toFixed(2)}%`}</Pill></div>
        <div className="cp2CandleBox"><TradingViewChart symbol={activeMarket.symbol || "BTC/USDT"} interval="60"/></div>
      </ConceptCard>
      <ConceptCard title={t("账户与持仓", "Account & Positions")} meta={`${positions.length} ${t("个持仓", "positions")}`}>
        <div className="cp2Allocation"><Donut value={equity ? Math.max(0,Math.min(100, used/num(equity)*100)) : 0} label={positions.length ? `${positions.length} ${t("仓", "pos")}` : t("空仓", "Flat")} sub={equity ? t("保证金占用", "Margin used") : t("持仓", "Positions")}/><div><b>{equity == null ? t("未同步", "Not synced") : `${money(equity)} USDT`}</b><small>{t("总账户权益", "Total account equity")}</small><span className="good">{`${num(pf.unrealizedPnl) >= 0 ? "+" : ""}${money(pf.unrealizedPnl, "0")} ${t("未实现", "unrealized")}`}</span></div></div>
        <ConceptTable compact columns={[{key:"symbol",label:t("资产", "Asset")},{key:"quantity",label:t("数量", "Qty"),render:r=>r.quantity??r.size??"—"},{key:"unrealizedPnl",label:t("浮盈亏", "Unrealized"),render:r=>money(r.unrealizedPnl)}]} rows={positions.slice(0,4)} empty={t("暂无持仓", "No positions")}/>
      </ConceptCard>
    </div>
    </div>
    <div className="cp2Grid two wideLeft">
      <ConceptCard title={t("活动与交易流水", "Activity & Trade Flow")} meta={`${fills.length + orders.length} ${t("条", "")}`} action={<button className="cp2Link" onClick={() => ui.setActive("tradeJournal")}>{t("查看全部 ›", "View all ›")}</button>}>
        <ConceptTable columns={[{key:"createdAt",label:t("时间", "Time"),render:r=>formatTime(r.createdAt)},{key:"kind",label:t("类型", "Type"),render:r=>humanize(r.kind||r.type||t("订单", "Order"))},{key:"detail",label:t("内容", "Detail"),render:r=>`${r.symbol||"—"} · ${humanize(r.side||r.direction||r.status)}`},{key:"amount",label:t("数量/金额", "Qty/Amount"),render:r=>r.quantity??r.size??money(r.notional)},{key:"status",label:t("状态", "Status"),render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status,t("已记录", "Recorded"))}</Pill>}]} rows={[...orders,...fills].slice(0,8)} empty={t("暂无交易活动", "No trade activity")}/>
      </ConceptCard>
      <ConceptCard title={t("AI 当前判断", "AI Current Read")} icon={Bot}>
        <div className="cp2InsightList"><div><TrendingUp size={14}/><span><b>{t("市场趋势", "Market trend")}</b><small>{data.marketRegime?.global?.label ? localizeText(data.marketRegime.global.label) : t("等待真实行情形成判断", "Awaiting live data to form a read")}</small></span></div><div><Target size={14}/><span><b>{t("关键价位", "Key level")}</b><small>{activeMarket.price ? `${t("当前参考", "Ref")} ${money(activeMarket.price)}` : t("待同步", "Pending sync")}</small></span></div><div><AlertTriangle size={14}/><span><b>{t("关注事件", "Watch event")}</b><small>{arr(data.events)[0]?.title ? localizeText(arr(data.events)[0].title) : t("暂无高影响事件", "No high-impact events")}</small></span></div></div>
      </ConceptCard>
    </div>
  </div>;
}

export function MarketConcept({ data, action }) {
  const markets = marketRows(data); const watchlist = arr(data.watchlist); const instruments = useInstruments();
  const [symbol, setSymbol] = useState(markets[0]?.symbol || watchlist[0] || "BTC/USDT"); const [tf, setTf] = useState("1h"); const [insightTab,setInsightTab]=useState("positioning");
  const selected = markets.find((item) => item.symbol === symbol) || markets[0] || {};
  const mediumTerm = data.mediumTermAnalytics || {};
  const mediumSymbol = arr(mediumTerm.symbols).find((item) => item.symbol === symbol) || null;
  const leverageLabels = {
    leverage_build_up:["价格未动、杠杆堆积","Leverage build-up without price confirmation"], long_build:["多头增仓","Long build"], long_build_crowded:["多头增仓且拥挤","Crowded long build"],
    short_build:["空头增仓","Short build"], short_build_crowded:["空头增仓且拥挤","Crowded short build"], short_covering:["空头去杠杆/回补","Short covering"],
    long_deleveraging:["多头去杠杆","Long deleveraging"], price_move_without_oi_confirmation:["价格移动但 OI 未确认","Price move without OI confirmation"],
    deleveraging_without_direction:["无方向去杠杆","Directionless deleveraging"], stable_or_mixed:["稳定/混合","Stable or mixed"]
  };
  const stateLabel = (value) => { const pair = leverageLabels[value]; return pair ? t(pair[0], pair[1]) : humanize(value, t("样本不足", "Insufficient")); };
  // 自选列表按真实的 watchlist 逐条渲染(带上有的行情),让历史误加的脏交易对(如「/USDT」)也能被移除。
  const allMarkets = arr(data.markets);
  const wlSymbols = watchlist.length ? watchlist : markets.map((m) => m.symbol);
  const wlRows = wlSymbols.map((sym) => { const m = markets.find((x) => x.symbol === sym) || allMarkets.find((x) => x.symbol === sym) || {}; return { id: sym, symbol: sym, price: m.price ?? m.last, change: m.changePct ?? m.change24hPct }; });
  const addWatch = (sym) => { if (sym) action("/api/watchlist", { symbol: sym }); };
  return <div className="cp2MarketLayout marketIntelligenceWorkbench">
    <ConceptCard className="cp2MainChart" title={selected.symbol || symbol} meta={`${tf} · ${t("公开行情", "Public data")}`} action={<div className="cp2FormActions"><button className="cp2Secondary" onClick={() => action("/api/reconciler/run", { mode: "manual_ui" })}>{t("手动对账", "Reconcile")}</button><button className="cp2IconButton" onClick={() => action("/api/market/regime", {}, "GET")}><RefreshCw size={13}/></button></div>}>
      <div className="cp2ChartToolbar"><PairPicker instruments={instruments} value={symbol} onPick={setSymbol}/>{["1m","5m","15m","1h","4h","1D"].map((name) => <button className={name === tf ? "active" : ""} onClick={() => setTf(name)} key={name}>{name}</button>)}</div>
      <div className="cp2Quote large"><b>{selected.price == null ? t("待同步", "Pending sync") : money(selected.price)}</b><Pill tone={num(selected.change) >= 0 ? "good" : "bad"}>{selected.change == null ? "—" : `${num(selected.change)>=0?"+":""}${num(selected.change).toFixed(2)}%`}</Pill></div>
      <div className="cp2CandleBox tall"><TradingViewChart symbol={symbol} interval={{ "1m": "1m", "5m": "5m", "15m": "15m", "1h": "60", "4h": "240", "1D": "D" }[tf] || "60"}/></div>
    </ConceptCard>
    <aside className="cp2MarketRail">
      <ConceptCard title={t("自选列表", "Watchlist")} meta={`${wlRows.length} ${t("个", "")}`} action={<PairPicker instruments={instruments} value="" label={t("＋ 添加", "＋ Add")} onPick={addWatch} triggerClass="cp2Link" align="right"/>}><ConceptTable compact columns={[{key:"symbol",label:t("交易对", "Pair"),render:r=><button className="cp2Link" onClick={()=>setSymbol(r.symbol)}>{r.symbol}</button>},{key:"price",label:t("价格", "Price"),render:r=>money(r.price)},{key:"change",label:"24h",render:r=><span className={num(r.change)>=0?"good":"bad"}>{r.change==null?"—":`${num(r.change)>=0?"+":""}${num(r.change).toFixed(2)}%`}</span>},{key:"remove",label:"",render:r=>watchlist.length>1&&watchlist.includes(r.symbol)?<button className="cp2IconButton" title={t("移除自选", "Remove")} onClick={()=>action(`/api/watchlist/${encodeURIComponent(r.symbol)}`,{},"DELETE")}>×</button>:null}]} rows={wlRows} empty={t("行情待同步", "Market pending sync")}/></ConceptCard>
      <ConceptCard title={t("市场快照", "Market Snapshot")}><div className="cp2Kv column"><span>{t("24h 高", "24h High")}<b>{money(selected.high24h ?? selected.high)}</b></span><span>{t("24h 低", "24h Low")}<b>{money(selected.low24h ?? selected.low)}</b></span><span>{t("24h 成交额", "24h Turnover")}<b>{selected.volume ? String(selected.volume) : "—"}</b></span><span>{t("资金费率", "Funding rate")}<b>{selected.fundingRate == null ? t("待同步", "Pending") : `${num(selected.fundingRate) >= 0 ? "+" : ""}${num(selected.fundingRate).toFixed(4)}%`}</b></span></div></ConceptCard>
    </aside>
    <section className="marketResearchDeck">
      <header><div><small>MARKET EVIDENCE</small><b>{t("把二级指标收进一个研究台", "Secondary evidence in one research deck")}</b><span>{t("一次只看一类问题，避免七张卡片同时争夺注意力。", "Inspect one question at a time instead of scanning seven competing cards.")}</span></div><nav>{[["positioning",t("市场定位","Positioning")],["flow",t("资金与持仓","Flow & OI")],["btc",t("BTC 风险","BTC risk")],["events",t("事件波动","Event volatility")]].map(([key,label])=><button key={key} className={insightTab===key?"active":""} onClick={()=>setInsightTab(key)}>{label}</button>)}</nav></header>
      <div className={`cp2MarketBottom ${insightTab}`}>
      {insightTab==="positioning"&&<ConceptCard title={t("未平仓量", "Open Interest")}><div className="cp2BigNumber">{selected.openInterest == null ? "—" : money(selected.openInterest)}<small>{t("公开合约数据", "Public contract data")}</small></div><MiniLine values={arr(selected.candles).slice(-24).map(item=>item.volume)} height={52}/></ConceptCard>}
      {insightTab==="positioning"&&<ConceptCard title={t("多空比", "Long/Short Ratio")}>{(()=>{const r=data.marketRegime?.smartMoney?.topTraderLongShortRatio;if(r==null)return <div className="cp2BigNumber small">{t("待同步", "Pending")}<small>{t("大户多空比未取", "Top-trader ratio unavailable")}</small></div>;const rn=num(r);const longPct=Math.round(rn/(1+rn)*100);return <><div className="cp2BigNumber">{rn.toFixed(2)}<small>{longPct>=55?t("多头占优", "Longs lead"):longPct<=45?t("空头占优", "Shorts lead"):t("多空均衡", "Balanced")}</small></div><BarRows rows={[{label:t("多头", "Long"),value:longPct},{label:t("空头", "Short"),value:100-longPct}]}/></>;})()}</ConceptCard>}
      {insightTab==="positioning"&&<ConceptCard title={t("OKX 市场广度", "OKX Market Breadth")}>{(()=>{const gm=data.marketRegime?.global;if(gm?.breadthPct==null)return <div className="cp2Centered"><div className="cp2BigNumber small">{t("待评估", "Pending")}<small>{t("OKX 永续广度未取", "OKX swap breadth unavailable")}</small></div></div>;return <div className="cp2Centered"><Donut value={num(gm.breadthPct)} label={`${gm.breadthPct}%`} sub={`${gm.advancing||0}/${gm.instruments||0} ${t("上涨", "advancing")}`}/></div>;})()}</ConceptCard>}
      {insightTab==="positioning"&&<ConceptCard title={t("全球市场动态", "Global Movers")}><ConceptTable compact columns={[{key:"symbol",label:t("资产", "Asset")},{key:"change",label:t("涨跌", "Change"),render:r=><span className={num(r.change)>=0?"good":"bad"}>{r.change==null?"—":`${num(r.change).toFixed(2)}%`}</span>}]} rows={markets.slice(0,5)} empty={t("暂无行情", "No market data")}/></ConceptCard>}
      {insightTab==="flow"&&<ConceptCard title={t("OI / Funding / Price + 中频 CVD", "OI / Funding / Price + Medium-term CVD")} meta={t("5分钟事实 · 单合约口径", "5m facts · instrument-level scope")}>
        <div className="cp2Kv column">{["15m","1h","4h"].map((window) => { const row=mediumSymbol?.windows?.[window]; return <span key={window}><strong>{window}</strong><b>{row?.status!=="ok"?`${t("样本积累中","Building samples")} ${row?.samples??0}/${row?.expected??"—"}`:`${stateLabel(row.leverageState)} · P ${row.priceChangePct}% · OI ${row.oiChangePct}% · F ${row.fundingEndPct??"—"}% · CVD ${row.cvdImbalancePct==null?"—":`${row.cvdImbalancePct}%`}`}</b></span>; })}</div>
      </ConceptCard>}
      {insightTab==="btc"&&<ConceptCard title={t("BTC 相关性 / Beta", "BTC Correlation / Beta")} meta={t("15分钟收益率 · 严格窗口覆盖", "15m returns · strict window coverage")}>
        {symbol==="BTC/USDT"?<div className="cp2BigNumber small">{t("基准资产","Benchmark asset")}<small>Beta = 1</small></div>:<div className="cp2Kv column">{["24h","3d","7d"].map((window)=>{const row=mediumSymbol?.btcRisk?.[window];return <span key={window}><strong>{window}</strong><b>{row?.status==="ok"?`Corr ${row.correlation} · β ${row.beta} · ${row.coveragePct}%`:t("样本不足","Insufficient samples")}</b></span>;})}</div>}
        {mediumTerm.portfolioBtcRisk?.status&&!['no_positions','insufficient'].includes(mediumTerm.portfolioBtcRisk.status)&&<small className="cp2MethodNote">{t("组合净/毛 BTC Beta 等效敞口", "Portfolio net/gross BTC beta-equivalent exposure")}: {mediumTerm.portfolioBtcRisk.netBtcEquivalentUsdt} / {mediumTerm.portfolioBtcRisk.grossBtcBetaExposureUsdt} USDT ({mediumTerm.portfolioBtcRisk.status})</small>}
      </ConceptCard>}
      {insightTab==="events"&&<ConceptCard title={t("BTC 宏观事件波动统计", "BTC Macro Event Volatility")} meta={t("至少5次同类事件才输出统计", "At least 5 same-type events required")}>
        <div className="cp2Kv column">{Object.entries(mediumTerm.eventVolatility?.byType||{}).slice(0,4).map(([type,row])=><span key={type}><strong>{type}</strong><b>{row.status==="usable"?`n=${row.samples} · 1H RV med ${row.medianPost1hRealizedVolPct}% · p90 ${row.p90Post1hRealizedVolPct}% · ×${row.medianPost1hVolExpansionRatio} ${row.typicalReaction} (${row.confidence})`:`${t("样本不足","Insufficient")} ${row.samples}/${row.minimumSamples}`}</b></span>)}{!Object.keys(mediumTerm.eventVolatility?.byType||{}).length&&<span><strong>{t("状态","Status")}</strong><b>{t("等待精确高影响事件完成 T+4H 观察","Awaiting T+4h observations for exact high-impact events")}</b></span>}</div>
      </ConceptCard>}
      </div>
    </section>
  </div>;
}

export function PositionsConcept({ data }) {
  const positionView = buildPositionView(data); const positions = positionView.positions; const pf = data.portfolio || {};
  const exposure = positionView.exposureUsdt;
  const pnl = positionView.unrealizedPnlUsdt;
  const margin = positionView.marginUsdt;
  const lev = positions.length ? positions.reduce((sum, item) => sum + num(item.leverage), 0) / positions.length : 0;
  const positionKey=(item)=>String(item.id||item.positionId||item.instId||item.symbol||"");
  const [selectedId,setSelectedId]=useState(positionKey(positions[0]||{}));
  useEffect(()=>{if(positions.length&&!positions.some(item=>positionKey(item)===selectedId))setSelectedId(positionKey(positions[0]));},[positions,selectedId]);
  const selected=positions.find(item=>positionKey(item)===selectedId)||positions[0]||{};
  const selectedNotional=positionNotionalUsdt(selected);
  const selectedSide=/short|空|卖|sell/i.test(String(selected.direction||selected.side));
  const selectedPnl=num(selected.unrealizedPnl);
  const liqDistance=selected.liqDistancePct??selected.liquidationDistancePct;
  return <div className="cp2Stack positionCommandPage">
    <div className="cp2Metrics four"><ConceptMetric label={t("持仓市值", "Position value")} value={positions.length ? `${money(exposure)} USDT` : "—"} sub={`${positions.length} ${t("个仓位", "positions")}`}/><ConceptMetric label={t("未实现盈亏", "Unrealized PnL")} value={positions.length ? `${pnl>=0?"+":""}${money(pnl)} USDT` : "—"} sub={displayPct(pf.todayPnlPct,t("等待同步", "Awaiting sync"))} tone={pnl>=0?"good":"bad"}/><ConceptMetric label={t("保证金占用", "Margin used")} value={margin ? `${money(margin)} USDT` : "—"} sub={pf.totalEquityUsdt ? `${(margin/num(pf.totalEquityUsdt)*100).toFixed(1)}%` : t("未同步", "Not synced")}/><ConceptMetric label={t("平均杠杆", "Avg leverage")} value={lev ? `${lev.toFixed(2)}x` : "—"} sub={t("组合口径", "Portfolio basis")}/></div>
    <div className="positionWorkbench">
      <ConceptCard title={t("持仓登记簿", "Position Registry")} meta={`${positions.length} ${t("个真实仓位", "live positions")}`} className="positionRegistry">
        <div className="positionRegistryList">{positions.map(item=>{const key=positionKey(item);const itemPnl=num(item.unrealizedPnl);return <button key={key} className={key===positionKey(selected)?"active":""} onClick={()=>setSelectedId(key)}><span><b>{item.symbol||"—"}</b><small>{humanize(item.direction||item.side)} · {item.leverage?`${item.leverage}x`:t("现货/未标注","Spot/unlabeled")}</small></span><em className={itemPnl>=0?"good":"bad"}>{itemPnl>=0?"+":""}{money(itemPnl)} U</em><i>{money(positionNotionalUsdt(item))} U</i></button>;})}{!positions.length&&<div className="cp2Empty"><WalletCards/><b>{t("当前没有持仓", "No open positions")}</b><span>{t("账户同步后，真实仓位会在这里逐笔登记。", "Synced live positions will be registered here.")}</span></div>}</div>
      </ConceptCard>
      <ConceptCard title={selected.symbol||t("持仓事实", "Position Truth")} meta={t("价格、保护与归属集中在一个事实面板", "Price, protection, and ownership in one fact panel")} className="positionTruth">
        {positions.length?<><div className="positionTruthHead"><div><Pill tone={selectedSide?"bad":"good"}>{selectedSide?t("做空","Short"):t("做多","Long")}</Pill><b>{selected.quantity??selected.size??"—"}</b><small>{t("持仓数量", "position size")}</small></div><div><strong className={selectedPnl>=0?"good":"bad"}>{selectedPnl>=0?"+":""}{money(selectedPnl)} U</strong><small>{t("未实现盈亏", "unrealized PnL")}</small></div></div><div className="positionPriceRail"><span><small>{t("开仓均价", "Entry")}</small><b>{money(selected.entryPrice??selected.entry)}</b></span><i/><span><small>{t("当前价格", "Mark")}</small><b>{money(selected.markPrice??selected.mark)}</b></span><i/><span><small>{t("强平价格", "Liquidation")}</small><b>{money(selected.liquidationPrice)}</b></span></div><div className="positionFactGrid"><span><small>{t("名义价值", "Notional")}</small><b>{money(selectedNotional)} U</b></span><span><small>{t("保证金", "Margin")}</small><b>{money(selected.marginUsdt??selected.margin)} U</b></span><span><small>{t("杠杆", "Leverage")}</small><b>{selected.leverage?`${selected.leverage}x`:"—"}</b></span><span><small>{t("强平距离", "Liq distance")}</small><b>{liqDistance==null?"—":displayPct(liqDistance)}</b></span></div><div className="positionOwnership"><ShieldCheck/><span><b>{selected.source==="execution_engine"?t("AI 托管仓位", "AI-managed position"):t("手动 / 外部仓位", "Manual / external position")}</b><small>{selected.source==="execution_engine"?t("系统持续检查保护单和退出条件", "The system continuously checks protection and exit conditions"):t("这里只同步事实，不声称由 AI 管理", "Facts are synced here without claiming AI management")}</small></span></div></>:<div className="cp2Empty"><Database/><b>{t("等待真实持仓", "Awaiting a live position")}</b><span>{t("不会用模拟数字填充此区域。", "This area is never filled with simulated numbers.")}</span></div>}
      </ConceptCard>
      <aside className="positionPortfolioRail">
        <ConceptCard title={t("组合健康", "Portfolio Health")}><div className="cp2Centered"><Donut value={pf.totalEquityUsdt ? Math.max(0,100-margin/num(pf.totalEquityUsdt)*100) : 0} label={pf.totalEquityUsdt ? `${Math.round(Math.max(0,100-margin/num(pf.totalEquityUsdt)*100))}%` : "—"} sub={t("可用缓冲", "Available buffer")}/></div><div className="cp2Checklist vertical"><span>{pf.totalEquityUsdt!=null?<CheckCircle2/>:<AlertTriangle/>}{t("保证金已同步", "Margin synced")}</span><span>{Number(pf.availableMarginUsdt)>0?<CheckCircle2/>:<AlertTriangle/>}{t("可用风险缓冲", "Available risk buffer")}</span><span>{!arr(data.positions).some(p=>{const d=Number(p.liqDistancePct);return Number.isFinite(d)&&d<12;})?<ShieldCheck/>:<AlertTriangle/>}{t("强平距离安全", "Safe liq distance")}</span></div></ConceptCard>
        <ConceptCard title={t("敞口分布", "Exposure Mix")}><BarRows rows={positions.slice(0,5).map(item=>{const notional=positionNotionalUsdt(item);return {label:item.symbol,value:notional,display:`${money(notional)} U`};})}/></ConceptCard>
      </aside>
    </div>
    <ConceptCard title={t("账户权益轨迹", "Account Equity Trail")} meta={t("权威账户快照 · 不是前端重算", "Authoritative account snapshots · not recomputed by the client")} className="positionEquityTrail"><MiniLine values={arr(data.accountSnapshots).map(item=>item.totalEquityUsdt)} height={118}/></ConceptCard>
  </div>;
}

export function OrdersConcept({ data, action, ui }) {
  const orders = arr(data.executionOrders).length ? arr(data.executionOrders) : arr(data.orders); const fills = arr(data.fills); const plans = arr(data.tradePlans);
  const [selectedId, setSelectedId] = useState(orders[0]?.id || ""); const selected = orders.find((item)=>item.id===selectedId) || orders[0] || {};
  return <div className="cp2Stack"><div className="cp2Metrics four"><ConceptMetric label={t("待执行订单", "Pending orders")} value={String(orders.filter((item)=>/pending|open|new/i.test(String(item.status))).length)} sub={`${t("共", "of")} ${orders.length} ${t("条", "")}`}/><ConceptMetric label={t("待审批", "Awaiting approval")} value={String(plans.filter((item)=>item.status==="awaiting_approval").length)} sub={t("人工确认", "Manual confirm")}/><ConceptMetric label={t("今日成交", "Fills today")} value={String(fills.length)} sub={t("交易所回报", "Exchange reports")}/><ConceptMetric label={t("已拒绝", "Rejected")} value={String(orders.filter((item)=>/reject|cancel/i.test(String(item.status))).length)} sub={t("风控或人工", "Risk or manual")}/></div>
    <div className="cp2OrdersLayout"><ConceptCard title={t("订单簿", "Order Book")} meta={`${orders.length} ${t("条", "")}`} className="cp2OrdersTable"><ConceptTable columns={[{key:"id",label:t("订单号", "Order ID"),render:r=><button className="cp2Link" onClick={()=>setSelectedId(r.id)}>{String(r.id||"—").slice(0,12)}</button>},{key:"symbol",label:t("交易对", "Pair")},{key:"side",label:t("方向", "Side"),render:r=>humanize(r.side||r.direction)},{key:"quantity",label:t("数量", "Qty"),render:r=>r.quantity??r.size??"—"},{key:"price",label:t("价格", "Price"),render:r=>money(r.price)},{key:"status",label:t("状态", "Status"),render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status)}</Pill>},{key:"createdAt",label:t("时间", "Time"),render:r=>formatTime(r.createdAt)}]} rows={orders} empty={t("暂无订单", "No orders")}/></ConceptCard>
      <ConceptCard title={t("执行链路", "Execution Path")} className="cp2Execution"><div className="cp2Timeline">{[t("计划", "Plan"),t("风控", "Risk"),t("路由", "Route"),t("订单", "Order"),t("成交", "Fill"),t("保护单", "Protect")].map((name,index)=><div key={index} className={(index===0?plans.length>0:index===1?(plans.some(p=>/approved|executing|passed/i.test(String(p.status)))||arr(data.riskChecks).length>0):index<=3?orders.length>0:index===4?fills.length>0:orders.some(o=>/stop|protect|止/i.test(String(o.type||o.kind||o.purpose||""))))?"done":""}><i>{index+1}</i><span><b>{name}</b><small>{index===0?(plans[0]?.status?humanize(plans[0].status):t("等待计划", "Awaiting plan")):index===1?t("执行前复查", "Pre-trade check"):index===2?t("选择交易所", "Select venue"):index===3?humanize(selected.status,t("待执行", "Pending")):index===4?`${fills.length} ${t("笔成交", "fills")}`:t("止损/止盈", "SL/TP")}</small></span></div>)}</div></ConceptCard>
      <ConceptCard title={t("订单详情", "Order Detail")} className="cp2OrderDetail"><div className="cp2Kv column">{[[t("订单号", "Order ID"),selected.id],[t("交易对", "Pair"),selected.symbol],[t("方向", "Side"),humanize(selected.side||selected.direction)],[t("类型", "Type"),humanize(selected.type)],[t("数量", "Qty"),selected.filledQuantity??selected.quantity??selected.size],[t("委托价", "Limit price"),money(selected.price)],[t("状态", "Status"),humanize(selected.status)],[t("创建时间", "Created"),formatDateTime(selected.createdAt)]].map(([k,v])=><span key={k}>{k}<b>{v||"—"}</b></span>)}</div><button className="cp2Secondary" onClick={()=>ui.setActive("chat")}>{t("交给 AI 修改", "Ask AI to modify")}</button>{executionExitAction(selected)&&<button className="cp2Danger" onClick={()=>requestExecutionExit(action,selected,"manual_ui")}>{executionExitAction(selected).label}</button>}</ConceptCard>
    </div>
    <ConceptCard title={t("成交明细", "Fills")} meta={`${fills.length} ${t("条 · 超 20 条容器内滚动", "· scrolls past 20")}`}><div className="cp2ScrollList tall"><ConceptTable compact columns={[{key:"createdAt",label:t("成交时间", "Fill time"),render:r=>formatDateTime(r.createdAt)},{key:"orderId",label:t("订单号", "Order ID")},{key:"symbol",label:t("交易对", "Pair")},{key:"side",label:t("方向", "Side"),render:r=>humanize(r.side||r.kind)},{key:"quantity",label:t("成交数量", "Fill qty"),render:r=>r.quantity??r.size??"—"},{key:"price",label:t("成交价格", "Fill price"),render:r=>money(r.price)},{key:"fee",label:t("手续费", "Fee"),render:r=>money(r.fee)}]} rows={fills} empty={t("暂无成交", "No fills")}/></div></ConceptCard></div>;
}

// AI 交易行为画像:量化画像(data.behaviorProfile)+ 按需 LLM 叙述 + 喂回"行为镜"透镜。
export function BehaviorProfileConcept({ data, action }) {
  const p = data.behaviorProfile || {};
  const [narr, setNarr] = useState(data.behaviorNarrative || null);
  const [busy, setBusy] = useState(false);
  const fmtMin = (m) => m == null ? "—" : m < 60 ? `${Math.round(m)}m` : `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, "0")}m`;

  if (!p.trades) return <div className="cp2Wrap"><ConceptCard title={t("AI 交易行为画像", "AI Trading Behavior Profile")} meta={t("让 AI 照镜子看自己的交易模式", "Let the AI look in the mirror at its own trading patterns")}><div className="emptyPanel">{p.note ? localizeText(p.note) : t("暂无已平仓交易——行为画像会随成交累积。", "No closed trades yet — the profile builds up as fills accumulate.")}</div></ConceptCard></div>;

  const o = p.overall || {};
  const generate = async () => { setBusy(true); try { const r = await action("/api/behavior-profile/narrative", {}); if (r?.narrative) setNarr(r.narrative); } finally { setBusy(false); } };
  const adopt = async () => { if (narr?.disciplines?.length && await uiConfirm(t("把这几条纪律固化为『行为镜』透镜、注入 AI 决策提示词?", "Lock these disciplines in as a \"behavior mirror\" lens and inject them into the AI decision prompt?"))) action("/api/behavior-profile/adopt-discipline", { disciplines: narr.disciplines }); };

  const pts = arr(p.scatter).filter((s) => Number.isFinite(s.holdMinutes) && Number.isFinite(s.roiPct));
  const maxHold = Math.max(60, ...pts.map((s) => s.holdMinutes));
  const maxRoi = Math.max(5, ...pts.map((s) => Math.abs(s.roiPct)));

  return (
    <div className="cp2Wrap bpWrap">
      <ConceptCard title={t("AI 交易行为画像", "AI Trading Behavior Profile")} meta={t("基于真实成交/入场理由/亏损归因 · 让 AI 照镜子", "From real fills / entry rationale / loss attribution · a mirror for the AI")}>
        <div className="bpHero">
          <div className="bpPersona"><b>{narr?.persona ? narr.persona.slice(0, 14) : t("待生成", "Not generated")}</b><small>{p.trades} {t("笔已平仓", "closed")}</small></div>
          <div className="cp2Metrics compact" style={{ flex: 1 }}>
            <ConceptMetric label={t("胜率", "Win rate")} value={`${o.winRatePct}%`} tone={o.winRatePct >= 50 ? "good" : "bad"} />
            <ConceptMetric label={t("盈亏比", "Profit factor")} value={o.profitFactor ?? "—"} />
            <ConceptMetric label={t("期望值/笔", "Expectancy/trade")} value={money(o.expectancyUsdt)} tone={num(o.expectancyUsdt) >= 0 ? "good" : "bad"} />
            <ConceptMetric label={t("平均持仓", "Avg hold")} value={fmtMin(o.avgHoldMinutes)} />
          </div>
        </div>
      </ConceptCard>

      {arr(p.flags).length > 0 && (
        <ConceptCard title={t("⚠ 致命习惯(自动检出 · 证据驱动)", "⚠ Fatal Habits (auto-detected · evidence-driven)")}>
          <div className="bpFlags">{p.flags.map((f) => <div className={`bpFlag ${f.severity}`} key={f.key}><b>{f.title}</b><span>{f.detail}</span></div>)}</div>
        </ConceptCard>
      )}

      <ConceptCard title={t("📈 持仓时长 × 收益率 × 杠杆(点大小=杠杆 · 红绿=盈亏)", "📈 Hold Time × Return × Leverage (dot size = leverage · red/green = PnL)")}>
        {pts.length ? <svg className="bpScatter" viewBox="0 0 520 220" width="100%">
          <line x1="40" y1="110" x2="510" y2="110" stroke="var(--border)" /><line x1="40" y1="12" x2="40" y2="208" stroke="var(--border)" />
          <text x="46" y="22" fontSize="10" fill="var(--text-3)">{t("收益%", "Return %")}</text><text x="452" y="128" fontSize="10" fill="var(--text-3)">{t("持仓时长→", "Hold time →")}</text>
          {pts.map((s, i) => <circle key={i} cx={40 + (s.holdMinutes / maxHold) * 460} cy={110 - (s.roiPct / maxRoi) * 92} r={Math.max(5, Math.min(20, (s.leverage || 5) * 1.2))} fill={s.win ? "#2e9e6b" : "#c8492f"} opacity="0.62" />)}
        </svg> : <div className="emptyPanel">{t("持仓时长/收益数据不足", "Not enough hold-time / return data")}</div>}
      </ConceptCard>

      <ConceptCard title={t("🔬 拆解", "🔬 Breakdown")}>
        <div className="bpCols">
          <div><div className="bpColH">{t("按方向", "By direction")}</div>{Object.entries(p.byDirection || {}).map(([k, v]) => <div className="bpRow" key={k}><span>{k === "long" ? t("做多", "Long") : t("做空", "Short")}</span><span className={v.pnl >= 0 ? "good" : "bad"}>{t("胜率", "Win")} {v.winRatePct}% · {money(v.pnl)}</span></div>)}</div>
          <div><div className="bpColH">{t("按 regime", "By regime")}</div>{Object.entries(p.byRegime || {}).map(([k, v]) => <div className="bpRow" key={k}><span>{k}</span><span className={v.winRatePct >= 50 ? "good" : "bad"}>{t("胜率", "Win")} {v.winRatePct}% · {v.n}{t("笔", "")}</span></div>)}</div>
          <div><div className="bpColH">{t("亏损归因", "Loss attribution")}</div>{Object.entries(p.lossAttribution || {}).map(([k, v]) => <div className="bpRow" key={k}><span>{k}</span><span>{v} {t("笔", "")}</span></div>)}{!Object.keys(p.lossAttribution || {}).length && <div className="muted">{t("暂无亏损归因", "No loss attribution")}</div>}</div>
        </div>
      </ConceptCard>

      <ConceptCard title={t("🪞 AI 画像叙述(deepseek 生成)", "🪞 AI Profile Narrative (deepseek-generated)")} action={<button className="cp2Primary" onClick={generate} disabled={busy}>{busy ? t("生成中…", "Generating…") : narr ? t("刷新画像", "Refresh profile") : t("生成画像", "Generate profile")}</button>}>
        {narr ? <div className="bpNarr">
          <div className="bpSec"><b>{t("交易性格", "Trading persona")}</b><p>{narr.persona}</p></div>
          {arr(narr.fatalHabits).length > 0 && <div className="bpSec"><b>{t("致命习惯", "Fatal habits")}</b><ul>{narr.fatalHabits.map((h, i) => <li key={i}>{h}</li>)}</ul></div>}
          {narr.blindSpots && <div className="bpSec"><b>{t("数据盲区", "Data blind spots")}</b><p>{narr.blindSpots}</p></div>}
          {arr(narr.disciplines).length > 0 && <div className="bpSec"><b>{t("下一步可执行纪律", "Next actionable disciplines")}</b><ul>{narr.disciplines.map((d, i) => <li key={i}>{d}</li>)}</ul>
            <button className="cp2Primary" style={{ marginTop: 8 }} onClick={adopt}>{t("🔁 把这几条喂回决策条令(行为镜)", "🔁 Feed these back into the decision doctrine (behavior mirror)")}</button></div>}
        </div> : <div className="emptyPanel">{t("点「生成画像」让 deepseek 基于你的真实成交+入场理由+复盘,归纳交易性格、致命习惯与可执行纪律。", "Click \"Generate profile\" to have deepseek distill your trading persona, fatal habits, and actionable disciplines from real fills + entry rationale + reviews.")}</div>}
      </ConceptCard>
    </div>
  );
}

export function JournalConcept({ data }) {
  const fills = arr(data.fills); const reviews = arr(data.reviews); const performance = data.performance || {};
  const wins = fills.filter((item)=>num(item.realizedPnl)>0); const losses = fills.filter((item)=>num(item.realizedPnl)<0); const net = fills.reduce((sum,item)=>sum+num(item.realizedPnl),0);
  return <div className="cp2Stack"><div className="cp2Metrics six"><ConceptMetric label={t("已实现盈亏", "Realized PnL")} value={`${net>=0?"+":""}${money(net,"0")}`} tone={net>=0?"good":"bad"}/><ConceptMetric label={t("胜率", "Win rate")} value={fills.length?`${(wins.length/fills.length*100).toFixed(1)}%`:"—"}/><ConceptMetric label={t("盈亏比", "Profit factor")} value={performance.profitFactor!=null?num(performance.profitFactor).toFixed(2):"—"}/><ConceptMetric label={t("平均每笔", "Avg/trade")} value={performance.avgPnlUsdt!=null?`${num(performance.avgPnlUsdt)>=0?"+":""}${money(performance.avgPnlUsdt,"0")}`:"—"} tone={performance.avgPnlUsdt!=null?(num(performance.avgPnlUsdt)>=0?"good":"bad"):undefined}/><ConceptMetric label={t("最大交易回撤", "Max trade DD")} value={performance.realizedMaxDrawdownUsdt==null?"—":`${money(performance.realizedMaxDrawdownUsdt)} U`} tone="bad"/><ConceptMetric label={t("复盘覆盖", "Review coverage")} value={fills.length?`${Math.min(100,reviews.filter((item)=>item.type==="trade"&&item.status==="completed").length/fills.length*100).toFixed(0)}%`:"—"}/></div>
    {(() => {
      // ④ 月度聚合:按月 rollup(净盈亏/交易数/胜率)+ "日目标命中天数"(日盈利≥日目标的天数,比单纯胜率更贴稳定盈利)。
      const closes = fills.filter((f) => f.kind === "close" && Number.isFinite(Number(f.realizedPnl)));
      if (!closes.length) return null;
      const shift = (d) => new Date(new Date(d).getTime() + 8 * 3600000);
      const dailyGoal = num(data.system?.dailyGoalUsdt, 0);
      const months = {}, dayPnl = {};
      for (const f of closes) {
        const s = shift(f.createdAt);
        const mKey = `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, "0")}`;
        const dKey = `${mKey}-${String(s.getUTCDate()).padStart(2, "0")}`;
        (months[mKey] ||= { net: 0, n: 0, wins: 0, days: new Set(), goalDays: new Set() });
        const m = months[mKey]; m.net += Number(f.realizedPnl); m.n++; if (Number(f.realizedPnl) > 0) m.wins++; m.days.add(dKey);
        dayPnl[dKey] = (dayPnl[dKey] || 0) + Number(f.realizedPnl);
      }
      for (const [dKey, pnl] of Object.entries(dayPnl)) { const mKey = dKey.slice(0, 7); if (months[mKey] && dailyGoal > 0 && pnl >= dailyGoal) months[mKey].goalDays.add(dKey); }
      const rows = Object.entries(months).sort((a, b) => b[0].localeCompare(a[0])).map(([month, m]) => ({ month, net: m.net, n: m.n, winRate: m.n ? Math.round((m.wins / m.n) * 100) : 0, tradeDays: m.days.size, goalDays: m.goalDays.size }));
      return <ConceptCard title={t("📅 月度聚合", "📅 Monthly Rollup")} meta={t("按月 · 日目标命中率(UTC+8)", "By month · daily-goal hit rate (UTC+8)")}>
        <ConceptTable columns={[
          { key: "month", label: t("月份", "Month") },
          { key: "net", label: t("净盈亏", "Net PnL"), render: (r) => <span className={r.net >= 0 ? "good" : "bad"}>{money(r.net)}</span> },
          { key: "n", label: t("交易数", "Trades") },
          { key: "winRate", label: t("胜率", "Win rate"), render: (r) => `${r.winRate}%` },
          { key: "goalDays", label: t("日目标命中", "Goal hits"), render: (r) => `${r.goalDays}/${r.tradeDays} ${t("天", "days")}` }
        ]} rows={rows} empty={t("暂无月度数据", "No monthly data")} />
      </ConceptCard>;
    })()}
    <div className="cp2Grid journalMain"><ConceptCard title={t("已平仓交易", "Closed Trades")} meta={t("超 20 条容器内滚动", "Scrolls past 20")} className="span2"><div className="cp2ScrollList tall"><ConceptTable columns={[{key:"createdAt",label:t("时间", "Time"),render:r=>formatDateTime(r.createdAt)},{key:"symbol",label:t("交易对", "Pair")},{key:"side",label:t("方向", "Side"),render:r=>humanize(r.side||r.kind)},{key:"quantity",label:t("数量", "Qty"),render:r=>r.quantity??r.size??"—"},{key:"price",label:t("成交价", "Fill price"),render:r=>money(r.price)},{key:"realizedPnl",label:t("已实现盈亏", "Realized PnL"),render:r=><span className={num(r.realizedPnl)>=0?"good":"bad"}>{money(r.realizedPnl)}</span>},{key:"status",label:t("状态", "Status"),render:()=><Pill tone="good">{t("已成交", "Filled")}</Pill>}]} rows={fills} empty={t("暂无已平仓交易", "No closed trades")}/></div></ConceptCard><ConceptCard title={t("业绩拆解", "Performance Breakdown")}><div className="cp2Centered"><Donut value={fills.length?wins.length/fills.length*100:0} label={fills.length?`${(wins.length/fills.length*100).toFixed(0)}%`:"—"} sub={t("胜率", "Win rate")}/></div><BarRows rows={[{label:t("盈利交易", "Winners"),value:wins.length,display:`${wins.length} ${t("笔", "")}`},{label:t("亏损交易", "Losers"),value:losses.length,display:`${losses.length} ${t("笔", "")}`},{label:t("复盘完成", "Reviews done"),value:reviews.length,display:`${reviews.length} ${t("份", "")}`}]} /></ConceptCard></div>
    <div className="cp2Grid two wideLeft"><ConceptCard title={t("交易复盘详情", "Trade Reviews")}><div className="cp2ReviewGrid">{reviews.slice(0,3).map((review,index)=><article key={review.id||index}><small>{review.symbol||t("组合", "Portfolio")} · {formatDateTime(review.createdAt)}</small><b>{review.title||review.summary||t("交易复盘", "Trade review")}</b><p>{review.lesson||review.notes||t("等待复盘结论。", "Awaiting review conclusion.")}</p></article>)}{!reviews.length&&<div className="cp2Empty"><BookOpen/><b>{t("暂无复盘", "No reviews")}</b><span>{t("平仓后会自动进入复盘队列。", "Closed trades auto-enter the review queue.")}</span></div>}</div></ConceptCard><ConceptCard title={t("纪律检查", "Discipline Check")}><div className="cp2Checklist vertical"><span><CheckCircle2/>{t("风险预算执行", "Risk budget enforced")}</span><span><CheckCircle2/>{t("止损保护覆盖", "Stop-loss coverage")}</span><span><AlertTriangle/>{t("复盘样本仍需积累", "Review sample still building")}</span></div></ConceptCard></div></div>;
}

// 迷你走势线(指标卡内嵌,极小):给"已实现盈亏"配累计曲线。
function Spark({ values = [], pos = true, w = 66, h = 26 }) {
  const v = (values || []).filter((x) => Number.isFinite(x));
  if (v.length < 2) return null;
  const min = Math.min(...v), max = Math.max(...v), rng = (max - min) || 1;
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * (w - 2) + 1},${(h - 3) - ((x - min) / rng) * (h - 6) + 1.5}`).join(" ");
  const last = v[v.length - 1];
  return <svg className="erSpark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"><polyline points={pts} fill="none" stroke={pos ? "var(--pos)" : "var(--neg)"} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/><circle cx={w - 1} cy={(h - 3) - ((last - min) / rng) * (h - 6) + 1.5} r="1.7" fill={pos ? "var(--pos)" : "var(--neg)"}/></svg>;
}
// 迷你环(指标卡内嵌):给"胜率"配一个小环。
function MiniRing({ pct = 0, tone = "pos" }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return <span className={`erRing ${tone}`} style={{ "--p": `${p * 3.6}deg` }} />;
}

// 持仓时长 vs 收益率 散点(点大小=杠杆,绿盈红亏):重设计——零轴中线、网格、坐标、图例,诊断离场时机。
function HoldScatter({ points = [] }) {
  const pts = (points || []).filter((s) => Number.isFinite(s.holdMinutes) && Number.isFinite(s.roiPct));
  const [activeIndex,setActiveIndex]=useState(null);
  if (!pts.length) return <div className="emptyPanel">{t("持仓/收益数据不足", "Not enough hold-time / return data")}</div>;
  const maxHold = Math.max(60, ...pts.map((s) => s.holdMinutes));
  const maxRoi = Math.max(4, ...pts.map((s) => Math.abs(s.roiPct)));
  const W = 620, H = 250, L = 46, R = 18, T = 18, B = 32, midY = T + (H - T - B) / 2;
  const px = (m) => L + (m / maxHold) * (W - L - R);
  const py = (r) => midY - (r / maxRoi) * ((H - T - B) / 2);
  const fmtH = (m) => m >= 60 ? `${Math.round(m / 60)}h` : `${Math.round(m)}m`;
  const avgHold=pts.reduce((sum,item)=>sum+item.holdMinutes,0)/pts.length;
  const active=activeIndex==null?null:pts[activeIndex];
  return <div className="erScatterWrap">
    <svg className="erScatter" viewBox={`0 0 ${W} ${H}`} width="100%">
      <rect x={L} y={T} width={W-L-R} height={midY-T} fill="rgba(31,122,80,.045)" rx="5"/><rect x={L} y={midY} width={W-L-R} height={H-B-midY} fill="rgba(194,66,51,.04)" rx="5"/>
      {[0.25, 0.5, 0.75, 1].map((f, i) => <line key={`x${i}`} x1={L + (W - L - R) * f} y1={T} x2={L + (W - L - R) * f} y2={H - B} stroke="var(--hairline)" opacity="0.8" />)}
      {[.5,1].map((f,i)=><React.Fragment key={`y${i}`}><line x1={L} y1={py(maxRoi*f)} x2={W-R} y2={py(maxRoi*f)} stroke="var(--hairline)" opacity=".65"/><line x1={L} y1={py(-maxRoi*f)} x2={W-R} y2={py(-maxRoi*f)} stroke="var(--hairline)" opacity=".65"/></React.Fragment>)}
      <line x1={L} y1={midY} x2={W - R} y2={midY} stroke="var(--border-strong)" strokeDasharray="5 4" />
      <line x1={L} y1={T} x2={L} y2={H - B} stroke="var(--hairline)" />
      <line x1={px(avgHold)} y1={T} x2={px(avgHold)} y2={H-B} stroke="var(--accent)" strokeDasharray="3 4" opacity=".7"/><text x={Math.min(W-R-4,px(avgHold)+5)} y={T+10} fontSize="9" fill="var(--accent)">{t("平均", "Avg")} {fmtH(avgHold)}</text>
      <text x={L - 7} y={T + 8} fontSize="9" fill="var(--text-4)" textAnchor="end">+{maxRoi.toFixed(0)}%</text><text x={L - 7} y={midY+3} fontSize="9" fill="var(--text-4)" textAnchor="end">0%</text>
      <text x={L - 7} y={H - B} fontSize="9" fill="var(--text-4)" textAnchor="end">−{maxRoi.toFixed(0)}%</text>
      {[0,.25,.5,.75,1].map((f, i) => <text key={i} x={L + (W - L - R) * f} y={H - 9} fontSize="9" fill="var(--text-4)" textAnchor={i===0?"start":i===4?"end":"middle"}>{fmtH(maxHold * f)}</text>)}
      <text x={L+7} y={T+14} fontSize="9" fill="var(--pos)">{t("盈利区", "Profitable")}</text><text x={L+7} y={H-B-8} fontSize="9" fill="var(--neg)">{t("亏损区", "Losing")}</text>
      {pts.map((s, i) => <circle key={`${s.symbol||"trade"}-${s.closedAt||i}`} tabIndex="0" role="button" aria-label={`${s.symbol||t("交易","Trade")} ${s.roiPct}%`} onMouseEnter={()=>setActiveIndex(i)} onMouseLeave={()=>setActiveIndex(null)} onFocus={()=>setActiveIndex(i)} onBlur={()=>setActiveIndex(null)} onClick={()=>setActiveIndex(activeIndex===i?null:i)} className={activeIndex===i?"active":""} cx={px(s.holdMinutes)} cy={py(s.roiPct)} r={Math.max(4.5, Math.min(13, (s.leverage || 3) * .85))} fill={s.win ? "var(--pos)" : "var(--neg)"} fillOpacity={activeIndex===i?".82":".48"} stroke={s.win ? "var(--pos)" : "var(--neg)"} strokeWidth={activeIndex===i?2:1} strokeOpacity=".85" />)}
    </svg>
    <div className="erLegend"><span><i className="dot pos" />{t("盈利", "Win")}</span><span><i className="dot neg" />{t("亏损", "Loss")}</span><span><i className="line"/>{t("平均持仓", "Average hold")}</span><span className="muted">{t("圆点越大代表杠杆越高", "Larger dots indicate higher leverage")}</span></div>
    <div className={`erPointDetail ${active?"visible":""}`} aria-live="polite">{active?<><span><small>{t("交易对","Pair")}</small><b>{active.symbol||"—"}</b></span><span><small>{t("方向","Side")}</small><b>{active.direction==="short"?t("做空","Short"):t("做多","Long")}</b></span><span><small>{t("持仓时间","Hold time")}</small><b>{fmtH(active.holdMinutes)}</b></span><span><small>{t("收益率","Return")}</small><b className={active.roiPct>=0?"good":"bad"}>{active.roiPct>=0?"+":""}{num(active.roiPct).toFixed(2)}%</b></span><span><small>{t("已实现盈亏","Realized PnL")}</small><b className={num(active.pnl)>=0?"good":"bad"}>{active.pnl==null?"—":`${num(active.pnl)>=0?"+":""}${money(active.pnl)} U`}</b></span><span><small>{t("杠杆","Leverage")}</small><b>{active.leverage?`${active.leverage}x`:"—"}</b></span><span><small>{t("入场 → 平仓","Entry → exit")}</small><b>{active.entryPrice==null&&active.exitPrice==null?"—":`${money(active.entryPrice)} → ${money(active.exitPrice)}`}</b></span><span><small>{t("平仓时间","Closed at")}</small><b>{active.closedAt?formatDateTime(active.closedAt):"—"}</b></span></>:<span className="hint">{t("悬停或点击圆点查看真实交易详情","Hover or tap a dot to inspect the real trade")}</span>}</div>
  </div>;
}
// 胜率横条(按方向/regime),直观可视。
function WinBars({ data = {}, labelMap }) {
  const entries = Object.entries(data || {});
  if (!entries.length) return <div className="muted">{t("暂无数据", "No data")}</div>;
  return <div className="erWinBars">{entries.map(([k, v]) => { const wr = Math.round(v.winRatePct || 0); return <div className="erWinRow" key={k}><span className="erWinLabel">{labelMap ? labelMap(k) : k}</span><div className="erWinTrack"><i style={{ width: `${wr}%`, background: wr >= 50 ? "var(--pos)" : "var(--neg)" }} /></div><span className="erWinVal">{wr}%{v.pnl != null ? ` · ${money(v.pnl)}` : v.n != null ? ` · ${v.n}${t("笔", "")}` : ""}</span></div>; })}</div>;
}
// 亏损归因分段条。
function SplitBar({ data = {} }) {
  const colors = { "策略": "var(--neg)", "执行": "#c98a2a", "市场异常": "var(--text-3)" };
  const entries = Object.entries(data || {}).filter(([, v]) => Number(v) > 0);
  const total = entries.reduce((s, [, v]) => s + Number(v), 0);
  if (!total) return <div className="muted">{t("暂无亏损归因", "No loss attribution")}</div>;
  return <div><div className="erSplit">{entries.map(([k, v]) => <span key={k} style={{ flex: Number(v), background: colors[k] || "var(--text-3)" }} title={`${k} ${v}`} />)}</div><div className="erSplitLegend">{entries.map(([k, v]) => <span key={k}><i style={{ background: colors[k] || "var(--text-3)" }} />{k} {v}</span>)}</div></div>;
}
function buildDiagnosticBreakdown(points=[]){
  const group=(key)=>{const out={};for(const trade of points){const name=trade[key]||t("未知","Unknown");const row=out[name]||{n:0,wins:0,pnl:0};row.n+=1;if(trade.win)row.wins+=1;row.pnl+=num(trade.pnl);out[name]=row;}return Object.fromEntries(Object.entries(out).map(([key,row])=>[key,{n:row.n,winRatePct:row.n?Math.round(row.wins/row.n*100):0,pnl:Number(row.pnl.toFixed(2))}]));};
  const losses={};for(const trade of points.filter(item=>!item.win)){const key=trade.lossAttribution||t("未归因","Unattributed");losses[key]=(losses[key]||0)+1;}
  return {byDirection:group("direction"),byRegime:group("regime"),lossAttribution:losses};
}
function PerformanceDiagnostics({points=[]}){
  const breakdown=buildDiagnosticBreakdown(points);
  const directions=Object.entries(breakdown.byDirection);const regimes=Object.entries(breakdown.byRegime);const causes=Object.entries(breakdown.lossAttribution).sort((a,b)=>b[1]-a[1]);
  const bestDirection=directions.sort((a,b)=>num(b[1].pnl)-num(a[1].pnl))[0];const weakestRegime=regimes.sort((a,b)=>num(a[1].pnl)-num(b[1].pnl))[0];
  const insight=points.length<3?t("样本仍少，暂不形成稳定行为结论。","The sample is still too small for a stable behavioral conclusion."):t(`${bestDirection?.[0]==="short"?"做空":"做多"}净收益相对更好；${weakestRegime?.[0]||"未知环境"}表现较弱${causes[0]?`；主要亏损归因为${causes[0][0]}`:""}。`,`${bestDirection?.[0]==="short"?"Short":"Long"} trades have the stronger net result; ${weakestRegime?.[0]||"unknown regime"} is weaker${causes[0]?`; the leading loss cause is ${causes[0][0]}`:""}.`);
  return <div className="erDiagnosticGrid"><ConceptCard title={t("持仓时长与收益率","Hold Time vs Return")} meta={t(`${points.length} 笔真实平仓生命周期 · 离场时机诊断`,`${points.length} real closed-trade lifecycles · exit-timing diagnostic`)}><HoldScatter points={points}/></ConceptCard><ConceptCard title={t("绩效拆解","Performance Breakdown")} meta={t("方向 · 市场环境 · 亏损原因","Side · regime · loss cause")} className="erBreakdownCard"><div className="erBreakdownStack"><section><div className="erBkH">{t("多空方向","Long vs short")}</div><WinBars data={breakdown.byDirection} labelMap={(key)=>key==="short"?t("做空","Short"):t("做多","Long")}/></section><section><div className="erBkH">{t("市场环境","Market regime")}</div><WinBars data={breakdown.byRegime}/></section><section><div className="erBkH">{t("亏损原因","Loss causes")}</div><SplitBar data={breakdown.lossAttribution}/></section></div><div className="erDeterministicInsight"><Database/><span><b>{t("数据结论","Data conclusion")}</b>{insight}</span></div></ConceptCard></div>;
}
// 紧凑行为画像(取代占地过大的整块 BehaviorProfileConcept):画像+致命习惯 / 散点 / 拆解,功能保留。
function BehaviorCompact({ data, action, showDiagnostics = true }) {
  const p = data.behaviorProfile || {};
  const [narr, setNarr] = useState(data.behaviorNarrative || null);
  const [busy, setBusy] = useState(false);
  const generate = async () => { setBusy(true); try { const r = await action("/api/behavior-profile/narrative", {}); if (r?.narrative) setNarr(r.narrative); } finally { setBusy(false); } };
  const adopt = async () => { if (narr?.disciplines?.length && await uiConfirm(t("把这几条纪律固化为『行为镜』透镜、注入 AI 决策提示词?", "Lock these disciplines in as a \"behavior mirror\" lens and inject them into the AI decision prompt?"))) action("/api/behavior-profile/adopt-discipline", { disciplines: narr.disciplines }); };
  if (!p.trades) return <ConceptCard title={t("AI 行为画像", "AI Behavior Profile")}><div className="emptyPanel">{p.note ? localizeText(p.note) : t("暂无已平仓交易——行为画像会随成交累积。", "No closed trades yet — the profile builds up as fills accumulate.")}</div></ConceptCard>;
  return <>
    <div className={`cp2Grid erBehaviorTop ${showDiagnostics?"":"single"}`}>
      <ConceptCard title={t("AI 行为画像", "AI Behavior Profile")} meta={`${p.trades} ${t("笔已平仓 · AI 照镜子", "closed · the AI's mirror")}`} action={<button className="cp2Primary" onClick={generate} disabled={busy}>{busy ? t("生成中…", "Generating…") : narr ? t("刷新", "Refresh") : t("生成画像", "Generate")}</button>}>
        <div className="erPersona">{narr?.persona ? narr.persona.slice(0, 90) : t("点「生成画像」让 AI 归纳交易性格、致命习惯与可执行纪律。", "Click Generate to distill the trading persona, fatal habits and disciplines.")}</div>
        {arr(p.flags).length > 0 && <div className="erFlags">{p.flags.map((f) => <div className={`erFlag ${f.severity}`} key={f.key}><b>{f.title}</b><span>{f.detail}</span></div>)}</div>}
        {narr && arr(narr.disciplines).length > 0 && <div className="erDisc"><small>{t("可执行纪律", "Actionable disciplines")}</small><ul>{narr.disciplines.map((d, i) => <li key={i}>{d}</li>)}</ul><button className="cp2Primary" onClick={adopt}>{t("🔁 喂回决策条令", "🔁 Feed back to doctrine")}</button></div>}
      </ConceptCard>
      {showDiagnostics&&<ConceptCard title={t("持仓时长 vs 收益率", "Hold Time vs Return")} meta={t("离场时机诊断", "Exit-timing diagnostic")}><HoldScatter points={p.scatter} /></ConceptCard>}
    </div>
    {showDiagnostics&&<ConceptCard title={t("拆解", "Breakdown")} meta={t("方向 · regime · 亏损归因", "Direction · regime · loss attribution")}>
      <div className="erBreakdown">
        <div><div className="erBkH">{t("按方向", "By direction")}</div><WinBars data={p.byDirection} labelMap={(k) => k === "long" ? t("做多", "Long") : t("做空", "Short")} /></div>
        <div><div className="erBkH">{t("按 regime", "By regime")}</div><WinBars data={p.byRegime} /></div>
        <div><div className="erBkH">{t("亏损归因", "Loss attribution")}</div><SplitBar data={p.lossAttribution} /></div>
      </div>
    </ConceptCard>}
  </>;
}

// 原始委托与成交独立为可追溯台账；执行与复盘主页面只保留聚合状态、绩效、复盘、诊断和行为改进。
export function ExecutionLedgerConcept({ data, action, ui }) {
  const execution = buildExecutionView(data);
  const { orders, fills, totals } = execution;
  const plans = arr(data.tradePlans);
  const [selectedId, setSelectedId] = useState(orders[0]?.id || "");
  const [fillView, setFillView] = useState("all");
  const [historyRange,setHistoryRange]=useState("all");
  const [historySymbol,setHistorySymbol]=useState("all");
  const [historyDirection,setHistoryDirection]=useState("all");
  const rangeDays={"7d":7,"30d":30,"90d":90}[historyRange];
  const historyMatch=(item,dateValue)=>{const symbolOk=historySymbol==="all"||item.symbol===historySymbol;const rawDirection=String(item.direction||item.side||"").toLowerCase();const direction=rawDirection.includes("short")||rawDirection.includes("空")||rawDirection.includes("sell")?"short":"long";const directionOk=historyDirection==="all"||direction===historyDirection;if(!symbolOk||!directionOk)return false;if(!rangeDays)return true;const time=new Date(dateValue||item.createdAt||0).getTime();return Number.isFinite(time)&&time>=Date.now()-rangeDays*86400000;};
  const filteredOrders=orders.filter(item=>historyMatch(item,item.createdAt));
  const filteredFills=fills.filter(item=>historyMatch(item,item.createdAt));
  const shownFills=fillView==="closed"?filteredFills.filter(item=>item.kind==="close"):filteredFills;
  const selected=filteredOrders.find(item=>item.id===selectedId)||filteredOrders[0]||{};
  const historySymbols=[...new Set([...orders,...fills].map(item=>item.symbol).filter(Boolean))].sort();
  const inFlight=countOpenExecutions(orders);
  const totalFees=fills.reduce((sum,row)=>sum+num(row.feeUsdt??row.fee),0);
  const feeOf=(row)=>row.feeUsdt??row.fee;
  const dirPill=(dir)=>{const short=/short|空|卖|sell/i.test(String(dir));return <Pill tone={short?"bad":"good"}>{short?t("空","Short"):t("多","Long")}</Pill>;};
  const ORDER_STATUS={closed:[t("已平仓","Closed"),"good"],filled:[t("已成交","Filled"),"good"],protecting:[t("持仓中","Active"),"good"],entry_filled:[t("已入场","Entered"),"good"],cancelled:[t("已取消","Cancelled"),"neutral"],canceled:[t("已取消","Cancelled"),"neutral"],blocked:[t("风控拦截","Blocked"),"bad"],risk_rejected:[t("风控拒绝","Rejected"),"bad"],failed:[t("执行失败","Failed"),"bad"],slippage_rejected:[t("滑点拒绝","Slippage"),"warn"],pending:[t("待执行","Pending"),"warn"],awaiting_approval:[t("待批准","Awaiting"),"warn"],executing:[t("执行中","Executing"),"warn"]};
  const orderStatus=(status)=>ORDER_STATUS[status]||[humanize(status),toneOf(status)];
  const pathDone=(index)=>index===0?plans.length>0:index===1?plans.some(plan=>/approved|executing|passed/i.test(String(plan.status)))||arr(data.riskChecks).length>0:index<=3?orders.length>0:index===4?fills.length>0:Boolean(selected.stopLoss||selected.takeProfits?.length);
  const exitAction=executionExitAction(selected);
  const scrollTo=(id)=>document.getElementById(`el-${id}`)?.scrollIntoView({behavior:"smooth",block:"start"});
  return <div className="cp2Stack erPage erRefined erLedgerPage">
    <header className="erPageHeader erLedgerHeader"><div><span>{t("执行记录","Execution records")}</span><h2>{t("委托与成交","Orders & Fills")}</h2><p>{t("集中核对 AI 委托、执行状态、保护链路与 OKX 真实成交；所有记录均可相互追溯。","A focused audit trail for AI orders, execution status, protection, and real OKX fills, with end-to-end traceability.")}</p></div><button type="button" className="erHeaderLink" onClick={()=>ui.setActive("tradeJournal")}>{t("返回执行与复盘","Back to Execution & Review")}<ChevronRight size={14}/></button></header>
    <div className="erControlBar erLedgerControl"><nav aria-label={t("记录章节","Record sections")}><button type="button" onClick={()=>scrollTo("orders")}><i>01</i>{t("AI 委托记录","AI orders")}</button><button type="button" onClick={()=>scrollTo("fills")}><i>02</i>{t("成交流水","Fill ledger")}</button></nav><div className="erHistoryFilters"><label>{t("时间范围","Time range")}<select value={historyRange} onChange={event=>setHistoryRange(event.target.value)}><option value="all">{t("全部时间","All time")}</option><option value="7d">{t("近 7 日","Last 7 days")}</option><option value="30d">{t("近 30 日","Last 30 days")}</option><option value="90d">{t("近 90 日","Last 90 days")}</option></select></label><label>{t("交易对","Pair")}<select value={historySymbol} onChange={event=>setHistorySymbol(event.target.value)}><option value="all">{t("全部交易对","All pairs")}</option>{historySymbols.map(symbol=><option value={symbol} key={symbol}>{symbol}</option>)}</select></label><label>{t("方向","Side")}<select value={historyDirection} onChange={event=>setHistoryDirection(event.target.value)}><option value="all">{t("多空全部","Long & short")}</option><option value="long">{t("只看做多","Long only")}</option><option value="short">{t("只看做空","Short only")}</option></select></label></div></div>
    <div className="erExecSummary erLedgerSummary"><div><small>{t("AI 委托","AI orders")}</small><b>{totals.orders} {t("笔","")}</b><span>{data.executionOrderStatus?.lastChangedAt?`${t("最近状态变化","Last status change")} ${formatDateTime(data.executionOrderStatus.lastChangedAt)}`:t("暂无状态变化","No status changes yet")}</span></div><div><small>{t("在途执行","In-flight")}</small><b>{inFlight} {t("笔","")}</b><span>{t("等待交易所状态推进","Awaiting exchange status updates")}</span></div><div><small>{t("真实成交","Real fills")}</small><b>{totals.fills} {t("条","")}</b><span>{t("开仓、减仓与平仓成交","Entries, reductions, and closes")}</span></div><div><small>{t("累计手续费","Total fees")}</small><b>{money(totalFees)} U</b><span>{t("真实费用与估算费用明确标识","Actual and estimated fees are labelled")}</span></div></div>
    <section id="el-orders" className="erZone"><div className="erZoneLabel"><span>{t("AI 委托记录","AI Order Log")}</span><small>{t("选择委托后核对完整执行路径","Select an order to inspect its full execution path")}</small></div><div className="erExecutionMaster"><ConceptCard title={t("AI 委托记录","AI Order Log")} meta={`${filteredOrders.length} ${t("笔记录", "orders")}`} className="erOrdersCard"><ConceptTable onRowClick={row=>setSelectedId(row.id)} activeId={selected.id} columns={[{key:"createdAt",label:t("时间","Time"),render:row=>formatTime(row.createdAt)},{key:"symbol",label:t("交易对","Pair")},{key:"direction",label:t("方向","Side"),render:row=>dirPill(row.direction)},{key:"quantity",label:t("数量","Qty"),render:row=>row.filledQuantity??row.quantity??row.size??"—"},{key:"entryPrice",label:t("入场价","Entry"),render:row=>money(row.entryPrice??row.price)},{key:"stopLoss",label:t("止损","Stop"),render:row=>money(row.stopLoss)},{key:"tp",label:t("止盈","Target"),render:row=>money((row.takeProfits||[])[0])},{key:"status",label:t("状态","Status"),render:row=>{const [label,tone]=orderStatus(row.status);return <Pill tone={tone}>{label}</Pill>;}}]} rows={filteredOrders} empty={t("当前筛选下暂无 AI 委托","No AI orders match the current filters")}/></ConceptCard><ConceptCard title={t("委托详情","Order Detail")} action={selected.status&&<Pill tone={orderStatus(selected.status)[1]}>{orderStatus(selected.status)[0]}</Pill>} className="erOrderDetailCard"><div className="cp2Kv column">{[[t("交易对 / 方向","Pair / side"),selected.symbol?`${selected.symbol} · ${/short|空/.test(String(selected.direction))?t("空","Short"):t("多","Long")}`:"—"],[t("数量","Quantity"),selected.filledQuantity??selected.quantity??selected.size],[t("名义金额","Notional"),selected.notionalUsdt==null?"—":`${money(selected.notionalUsdt)} U`],[t("预计保证金","Estimated margin"),selected.projectedMargin?.incrementalMargin==null?"—":`${money(selected.projectedMargin.incrementalMargin)} U`],[t("成交后保证金使用","Post-trade margin use"),selected.projectedMargin?.projectedUtilizationPct==null?"—":`${num(selected.projectedMargin.projectedUtilizationPct).toFixed(1)}%`],[t("入场 / 止损 / 止盈","Entry / stop / target"),`${money(selected.entryPrice??selected.price)} / ${money(selected.stopLoss)} / ${money((selected.takeProfits||[])[0])}`],[t("策略","Strategy"),humanize(selected.strategy)],[t("创建时间","Created"),formatDateTime(selected.createdAt)]].map(([key,value])=><span key={key}>{key}<b>{value||"—"}</b></span>)}</div><div className="erDetailActions"><button className="cp2Secondary" onClick={()=>ui.setActive("chat")}>{t("交给 AI 修改","Ask AI to modify")}</button>{exitAction&&<button className="cp2Danger" onClick={()=>requestExecutionExit(action,selected,"manual_ui")}>{exitAction.label}</button>}</div></ConceptCard></div><ConceptCard title={t("执行链路","Execution Path")} meta={t("与真实执行顺序一致","Matches the real execution order")} action={selected.id&&<Pill tone="warn">{orderStatus(selected.status)[0]}</Pill>} className="erPathCard"><div className="erPath">{[t("计划","Plan"),t("风控","Risk"),t("路由","Route"),t("订单","Order"),t("成交","Fill"),t("保护单","Protection")].map((name,index)=><div key={name} className={pathDone(index)?"done":""}><i>{pathDone(index)?"✓":index+1}</i><span><b>{name}</b><small>{index===0?humanize(plans[0]?.status,t("等待计划","Awaiting plan")):index===1?t("执行前复查","Pre-trade check"):index===2?"OKX":index===3?orderStatus(selected.status)[0]:index===4?`${fills.length} ${t("笔成交","fills")}`:t("止损 / 止盈","SL / TP")}</small></span></div>)}</div></ConceptCard></section>
    <section id="el-fills" className="erZone"><div className="erZoneLabel"><span>{t("成交流水","Fill Ledger")}</span><small>{t("OKX 真实成交、费用和价格毛盈亏","Real OKX fills, costs, and gross price PnL")}</small></div><ConceptCard title={t("成交流水","Fills")} meta={<span>{shownFills.length} {t("条","")} · {t("手续费明确区分真实与估算","fees distinguish actual from estimated")}</span>} action={<div className="erToggle"><button className={fillView==="all"?"on":""} onClick={()=>setFillView("all")}>{t("全部成交","All")}</button><button className={fillView==="closed"?"on":""} onClick={()=>setFillView("closed")}>{t("仅已平仓","Closed")}</button></div>}><div className="cp2ScrollList tall"><ConceptTable compact columns={[{key:"createdAt",label:t("时间","Time"),render:row=>formatDateTime(row.createdAt)},{key:"symbol",label:t("交易对","Pair")},{key:"kind",label:t("开平","Open/Close"),render:row=><Pill tone={row.kind==="close"?"warn":"neutral"}>{row.kind==="close"?t("平仓","Close"):t("开仓","Open")}</Pill>},{key:"direction",label:t("方向","Side"),render:row=>dirPill(row.direction)},{key:"quantity",label:t("数量","Qty"),render:row=>row.quantity??row.size??"—"},{key:"price",label:t("成交价","Price"),render:row=>money(row.price)},{key:"fee",label:t("手续费","Fee"),render:row=><span>{money(feeOf(row))}{row.estimatedFee?` ${t("估","est.")}`:""}</span>},{key:"realizedPnl",label:t("价格毛盈亏","Gross price PnL"),render:row=>row.kind==="close"||row.realizedPnl!=null?<span className={num(row.realizedPnl)>=0?"good":"bad"}>{money(row.realizedPnl)}</span>:"—"}]} rows={shownFills} empty={t("当前筛选下暂无成交","No fills match the current filters")}/></div></ConceptCard></section>
  </div>;
}

export function ExecutionReviewConcept({ data, action, ui, view = "overview", initialReviewId = "", initialOwnerPane = "" }) {
  const execution = buildExecutionView(data);
  const { orders, fills, closedTrades, reviews, performance } = execution;
  const plans = arr(data.tradePlans); const bp = data.behaviorProfile || {};
  const [historyRange,setHistoryRange]=useState("all"); const [historySymbol,setHistorySymbol]=useState("all"); const [historyDirection,setHistoryDirection]=useState("all");
  const lifecycleCount = num(performance.trades);
  const net = num(performance.totalPnlUsdt);
  const o = bp.overall || {};
  const winPct = num(performance.winRatePct);
  const avg = performance.avgPnlUsdt != null ? num(performance.avgPnlUsdt) : num(o.expectancyUsdt);
  const pendingApproval = plans.filter((i) => i.status === "awaiting_approval").length;
  const inFlight = countOpenExecutions(orders);
  const positions = buildPositionView(data).positions;
  const protectedPositions = positions.filter((row) => row.stopLoss != null || row.stopLossPrice != null || row.protectionVerified === true || /protected|verified|ok/i.test(String(row.protectionStatus || ""))).length;
  const tradeReviews = reviews;
  const [selectedReviewId,setSelectedReviewId]=useState(initialReviewId||tradeReviews[0]?.id||"");
  useEffect(()=>{if(initialReviewId&&tradeReviews.some(review=>review.id===initialReviewId))setSelectedReviewId(initialReviewId);},[initialReviewId,tradeReviews]);
  const rangeDays={"7d":7,"30d":30,"90d":90}[historyRange];
  const historyMatch=(item,dateValue)=>{const symbolOk=historySymbol==="all"||item.symbol===historySymbol;const rawDirection=String(item.direction||item.side||"").toLowerCase();const direction=rawDirection.includes("short")||rawDirection.includes("空")||rawDirection.includes("sell")?"short":"long";const directionOk=historyDirection==="all"||direction===historyDirection;if(!symbolOk||!directionOk)return false;if(!rangeDays)return true;const time=new Date(dateValue||item.closedAt||item.completedAt||item.createdAt||0).getTime();return Number.isFinite(time)&&time>=Date.now()-rangeDays*86400000;};
  const diagnosticPoints=arr(bp.scatter).filter(item=>historyMatch(item,item.closedAt));
  const filteredReviews=tradeReviews.filter(item=>historyMatch(item,item.completedAt||item.createdAt));
  const pendingReviews=filteredReviews.filter((item) => !isCompletedTradeReview(item));
  const selectedReview=filteredReviews.find(item=>item.id===selectedReviewId)||filteredReviews[0]||{};
  const tradeForReview=(review)=>closedTrades.find((trade)=>trade.tradeLifecycleKey===review.tradeLifecycleKey||trade.executionOrderId===review.executionOrderId||(review.fillIds||[]).some((id)=>trade.fillIds?.includes(id)));
  const reviewNetPnl=(review)=>netReviewResult(review,tradeForReview(review));
  const reviewHasResult=(review)=>reviewNetPnl(review)!=null;
  const selectedTrade=tradeForReview(selectedReview);
  const selectedReviewPnl=reviewNetPnl(selectedReview);
  const selectedEntryFee=selectedTrade?.entryFeeUsdt??selectedReview.entryFeeUsdt;
  const selectedCloseFee=selectedTrade?.feeUsdt??selectedReview.feeUsdt;
  const selectedReviewFees=selectedEntryFee==null&&selectedCloseFee==null?null:Math.abs(num(selectedEntryFee))+Math.abs(num(selectedCloseFee));
  const reviewLearning=data.reviewLearningAnalytics||{};
  const ownerLoop=data.ownerReviewLoop||{};
  const ownerReviewEnabled=data.user?.isOwner===true;
  const ownerSummary=ownerLoop.summary||{};
  const ownerImprovements=arr(ownerLoop.improvements);
  const ownerLessons=arr(ownerLoop.lessons);
  const candidateOwnerLessons=ownerLessons.filter(item=>["candidate","candidate_legacy","observing"].includes(item.status));
  const [ownerBusy,setOwnerBusy]=useState("");
  const [ownerEvidenceForms,setOwnerEvidenceForms]=useState({});
  const [ownerPane,setOwnerPane]=useState(initialOwnerPane||((ownerSummary.pendingOwner||ownerImprovements.length)?"improvements":"lessons"));
  const [selectedOwnerLessonId,setSelectedOwnerLessonId]=useState(candidateOwnerLessons[0]?.id||"");
  useEffect(()=>{if(!candidateOwnerLessons.some(item=>item.id===selectedOwnerLessonId))setSelectedOwnerLessonId(candidateOwnerLessons[0]?.id||"");},[selectedOwnerLessonId,candidateOwnerLessons]);
  const selectedMemoryLearning=arr(reviewLearning.byMemory).find(item=>item.memoryId===selectedReview.memoryItemId);
  const selectedLesson=ownerLessons.find(item=>item.id===(selectedReview.lessonCandidateId||selectedReview.memoryItemId));
  const selectedAssessment=selectedReview.structuredAssessment||{};
  const ownerStateLabel=(value)=>({evidence_accumulating:t("积累证据","Collecting evidence"),pending_owner:t("等待 Owner","Awaiting Owner"),accepted:t("已接受","Accepted"),rejected:t("已拒绝","Rejected"),validating:t("验证中","Validating"),verified:t("验证有效","Verified"),ineffective:t("验证无效","Ineffective"),candidate:t("候选教训","Candidate lesson"),candidate_legacy:t("旧版待审核","Legacy unreviewed"),observing:t("继续观察","Observing"),active:t("已批准生效","Approved & active"),retired:t("已停用","Retired")}[value]||humanize(value));
  const destinationLabel=(value)=>({strategy:t("策略库","Strategy library"),agent:t("AI 交易员","AI trader"),risk:t("风控设置","Risk settings"),system:t("系统 / 代码","System / code"),observation:t("仅观察","Observation")}[value]||humanize(value));
  const lessonOriginLabel=(value)=>({llm_deep_review:t("LLM 深度复盘","LLM deep review"),structured_review:t("结构化规则复盘","Structured review"),deterministic_review:t("基础规则复盘","Rule-based review"),legacy_unreviewed:t("升级前历史记录","Pre-upgrade history")}[value]||t("来源待确认","Source unknown"));
  const lessonOutcomeLabel=(value)=>({win:t("盈利","Win"),loss:t("亏损","Loss"),flat:t("持平","Flat")}[value]||t("结果待核验","Outcome unverified"));
  const lessonDirectionLabel=(value)=>value==="long"?t("做多","Long"):value==="short"?t("做空","Short"):t("方向不限","Any side");
  const evidenceQualityLabel=(value)=>({strong:t("强","Strong"),adequate:t("基本充分","Adequate"),limited:t("有限","Limited"),legacy_unknown:t("旧版未知","Legacy unknown")}[value]||humanize(value,"—"));
  const ownerForm=(item)=>ownerEvidenceForms[item.id]||{};
  const updateOwnerForm=(item,patch)=>setOwnerEvidenceForms(current=>({...current,[item.id]:{...(current[item.id]||{}),...patch}}));
  const runOwnerAction=async(kind,item,command,extra={})=>{const payload={action:command,...extra};if(command==="verify"){payload.ownerAttested=true;if(item.destination!=="strategy"){const note=String(ownerForm(item).verificationNote||"").trim();if(!note){ui.notify?.(t("请先填写可核验的测试、版本或观察证据","Add verifiable test, release, or observation evidence first"));return;}payload.validationEvidence=[{type:"owner_note",value:note}];}}const key=`${kind}:${item.id}:${command}`;setOwnerBusy(key);try{await action(kind==="lesson"?`/api/review/lessons/${item.id}/action`:`/api/review/improvements/${item.id}/action`,payload);}finally{setOwnerBusy("");}};
  const startOwnerPaper=async(item)=>{const form=ownerForm(item);const candidateId=item.validation?.candidateStrategyRef?.versionId;const candidate=arr(item.validation?.availableEvidence?.candidateVersions).find(row=>row.id===candidateId);const symbols=arr(candidate?.symbols);const symbol=String(form.paperSymbol||symbols[0]||"").trim();if(!symbol){ui.notify?.(t("候选版本没有允许的交易对，无法启动纯前向模拟","The candidate has no allowed symbol for a pure-forward session"));return;}const key=`paper:${item.id}`;setOwnerBusy(key);try{const result=await action(`/api/review/improvements/${item.id}/paper/start`,{symbol});if(result?.session?.id)updateOwnerForm(item,{paperSessionId:result.session.status==="passed"?result.session.id:form.paperSessionId||"",paperStartResult:{id:result.session.id,status:result.session.status,symbol:result.session.symbol||symbol}});}finally{setOwnerBusy("");}};
  const recordStrategyStage=async(item,stage,outcome)=>{const form=ownerForm(item);const payload={stageName:stage.name,outcome,note:String(form.failureNote||"").trim()};if(outcome==="failed"&&!payload.note){ui.notify?.(t("请先填写未通过原因","Enter the failure reason first"));return;}if(outcome==="passed"&&stage.name==="backtest"){const candidate=arr(item.validation?.availableEvidence?.candidateVersions).find(row=>row.id===form.candidateVersionId);if(!candidate){ui.notify?.(t("请选择系统列出的候选版本","Select an authoritative candidate version"));return;}Object.assign(payload,{candidateVersionId:candidate.id,candidateDefinitionHash:candidate.definitionHash,evidenceId:candidate.backtestId});}if(outcome==="passed"&&stage.name==="paper"){if(!form.paperSessionId){ui.notify?.(t("请选择已通过的真实模拟盘会话","Select a passed authoritative paper session"));return;}payload.evidenceId=form.paperSessionId;}if(outcome==="passed"&&stage.name==="small_live"){payload.evidenceReviewIds=arr(form.liveReviewIds);if(!payload.evidenceReviewIds.length){ui.notify?.(t("请选择已完整费用对账的小额实盘复盘","Select reconciled small-live reviews"));return;}}await runOwnerAction("improvement",item,"record_stage",payload);};
  const renderOwnerEvidenceForm=(item,nextStage)=>{if(item.state!=="validating")return null;const form=ownerForm(item);if(item.destination!=="strategy")return <div className="erEvidenceForm"><label>{t("验证证据","Validation evidence")}<textarea value={form.verificationNote||""} onChange={event=>updateOwnerForm(item,{verificationNote:event.target.value})} placeholder={t("填写测试名称、版本号、观测结果及可复核位置","Test name, release, result, and where it can be verified")}/></label></div>;if(!nextStage)return null;const available=item.validation?.availableEvidence||{};const candidateId=item.validation?.candidateStrategyRef?.versionId;const candidate=arr(available.candidateVersions).find(row=>row.id===candidateId);const paperSymbols=arr(candidate?.symbols);const paperSessions=arr(available.paperSessions);const passedPaper=paperSessions.filter(row=>row.status==="passed");return <div className="erEvidenceForm"><b>{t(`下一阶段：${nextStage.label||nextStage.name}`,`Next: ${nextStage.label||nextStage.name}`)}</b>{nextStage.name==="backtest"&&<label>{t("候选策略版本（来自策略库）","Candidate version (Strategy Library)")}<select value={form.candidateVersionId||""} onChange={event=>updateOwnerForm(item,{candidateVersionId:event.target.value})}><option value="">{t("请选择","Select")}</option>{arr(available.candidateVersions).map(row=><option value={row.id} key={row.id}>{row.label} · {row.id}</option>)}</select><small>{arr(available.candidateVersions).length?t("系统会自动核对版本 Hash 与其权威样本外回测。","The system verifies the immutable hash and authoritative OOS backtest."):t("暂无合格候选版本，请先在策略库生成并发布一个不同于当前实盘的版本。","No eligible candidate. Generate and publish a version distinct from live in Strategy Library.")}</small></label>}{nextStage.name==="paper"&&<fieldset className="erPaperStarter"><legend>{t("启动候选版本的纯前向模拟","Start pure-forward simulation")}</legend><small>{t("系统会绑定候选版本、不可变 Hash、Owner 与本次实验；不会复用其他实验的旧会话。","The session is bound to candidate version, immutable hash, Owner, and this attempt; another experiment's session is never reused.")}</small>{paperSymbols.length>0&&<label>{t("允许的交易对","Allowed symbol")}<select value={form.paperSymbol||paperSymbols[0]} onChange={event=>updateOwnerForm(item,{paperSymbol:event.target.value})}>{paperSymbols.map(symbol=><option value={symbol} key={symbol}>{symbol}</option>)}</select></label>}<button type="button" className="cp2Secondary" disabled={Boolean(ownerBusy)||!paperSymbols.length} onClick={()=>startOwnerPaper(item)}>{ownerBusy===`paper:${item.id}`?t("正在启动…","Starting…"):t("启动纯前向模拟","Start pure-forward paper")}<Rocket size={12}/></button>{paperSessions.length>0&&<div className="erPaperSessions">{paperSessions.map(row=><span key={row.id}><i className={row.status}/><b>{row.symbol||"—"}</b><small>{humanize(row.status)} · {row.id}</small></span>)}</div>}<label>{t("选择已通过的会话作为证据","Select a passed session as evidence")}<select value={form.paperSessionId||""} onChange={event=>updateOwnerForm(item,{paperSessionId:event.target.value})}><option value="">{passedPaper.length?t("请选择已通过会话","Select passed session"):t("尚无已通过会话","No passed session yet")}</option>{passedPaper.map(row=><option value={row.id} key={row.id}>{row.label} · {row.symbol||"—"}</option>)}</select></label></fieldset>}{nextStage.name==="small_live"&&<fieldset><legend>{t("完整费用对账的小额实盘复盘","Financially reconciled small-live reviews")}</legend>{arr(available.liveReviews).map(row=>{const checked=arr(form.liveReviewIds).includes(row.id);return <label className="erEvidenceCheck" key={row.id}><input type="checkbox" checked={checked} onChange={()=>updateOwnerForm(item,{liveReviewIds:checked?arr(form.liveReviewIds).filter(id=>id!==row.id):[...arr(form.liveReviewIds),row.id]})}/><span>{row.symbol||"—"} · {money(row.netRealizedPnl)} U · {formatDateTime(row.completedAt)}</span></label>;})}<small>{arr(available.liveReviews).length?t(`已选择 ${arr(form.liveReviewIds).length} 笔；门槛由该实验的成功标准决定。`,`Selected ${arr(form.liveReviewIds).length}; the experiment criteria set the threshold.`):t("尚无属于该候选版本且费用完整对账的真实复盘。","No reconciled live reviews belong to this candidate yet.")}</small></fieldset>}<label>{t("若未通过，请填写原因","Failure reason (when failing)")}<textarea value={form.failureNote||""} onChange={event=>updateOwnerForm(item,{failureNote:event.target.value})} placeholder={t("记录失败指标、样本或异常，作为下一代候选的依据","Record failed metrics, sample, or anomaly for the next candidate")}/></label><div><button type="button" className="cp2Primary" disabled={Boolean(ownerBusy)} onClick={()=>recordStrategyStage(item,nextStage,"passed")}>{t("核验并记录通过","Verify & pass")}</button><button type="button" className="cp2Secondary" disabled={Boolean(ownerBusy)} onClick={()=>recordStrategyStage(item,nextStage,"failed")}>{t("记录未通过","Record failure")}</button></div></div>;};
  const copyEngineeringTask=async(item)=>{if(!item.engineeringTask)return;try{if(!globalThis.navigator?.clipboard?.writeText)throw new Error("clipboard_unavailable");await globalThis.navigator.clipboard.writeText(JSON.stringify(item.engineeringTask,null,2));ui.notify?.(t("工程修复任务已复制，可交给代码维护流程处理","Engineering task copied for the code-maintenance workflow"));}catch{ui.notify?.(t("复制失败，请从卡片手动复制问题、建议和验收标准","Copy failed; copy the problem, proposal, and acceptance criteria manually"));}};
  const openLessonReview=(item)=>{if(!item.reviewId||!tradeReviews.some(review=>review.id===item.reviewId)){ui.notify?.(t("当前快照中尚未包含对应交易复盘，请刷新后重试","The source review is not present in the current snapshot; refresh and try again"));return;}ui.setActive(`tradeReviewDetail:${item.reviewId}`);};
  const lessonScopeValues=(item)=>{const scope=item.applicability||{};return [scope.symbol,lessonDirectionLabel(scope.direction),scope.timeframe,scope.setupType,scope.strategyProductId,scope.regime].filter(Boolean);};
  const historySymbols=[...new Set([...arr(bp.scatter),...fills,...tradeReviews].map(item=>item.symbol).filter(Boolean))].sort();
  const behaviorAlerts = arr(bp.flags).length;
  const latestReconciliation = arr(data.reconciliationReports).slice().sort((a,b)=>new Date(b.createdAt||b.updatedAt||0)-new Date(a.createdAt||a.updatedAt||0))[0] || null;
  const reconciliationOk = latestReconciliation?.status === "ok";
  const reconciliationLabel = !latestReconciliation ? t("尚未运行", "Not run yet") : reconciliationOk ? t("对账正常", "Reconciled") : t("对账需处理", "Needs attention");
  const tradeDataStatus = data.tradeDataStatus || {};
  const allClosedLifecycles = num(tradeDataStatus.closedLifecycleTotal ?? performance.grossClosedTradeLifecycles);
  const pendingFinancial = num(tradeDataStatus.pendingFinancialReconciliation ?? performance.pendingFinancialReconciliation);
  const reconciledLifecycles = num(tradeDataStatus.financiallyReconciledTrades ?? performance.financiallyReconciledTrades ?? lifecycleCount);
  // 累计已实现盈亏曲线(按时间正序),给首格配迷你走势。
  const cumPnl = (() => { const seq = closedTrades.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)); let s = 0; return seq.map((trade) => (s += num(trade.netRealizedPnl))); })();
  const monthlyRows = (() => {
    const shift = (date) => new Date(new Date(date).getTime() + 8 * 3600000);
    const dailyGoal = num(data.system?.dailyGoalUsdt, 0);
    const months = {}, dayPnl = {};
    for (const fill of closedTrades) {
      const shifted = shift(fill.createdAt);
      const month = `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
      const day = `${month}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
      (months[month] ||= { net: 0, trades: 0, wins: 0, days: new Set(), goalDays: new Set() });
      months[month].net += num(fill.netRealizedPnl); months[month].trades += 1;
      if (num(fill.netRealizedPnl) > 0) months[month].wins += 1;
      months[month].days.add(day); dayPnl[day] = (dayPnl[day] || 0) + num(fill.netRealizedPnl);
    }
    for (const [day, pnl] of Object.entries(dayPnl)) if (dailyGoal > 0 && pnl >= dailyGoal) months[day.slice(0, 7)]?.goalDays.add(day);
    return Object.entries(months).sort((a, b) => b[0].localeCompare(a[0])).map(([month, row]) => ({
      month, net: row.net, trades: row.trades, winRate: row.trades ? Math.round(row.wins / row.trades * 100) : 0,
      tradeDays: row.days.size, goalDays: row.goalDays.size
    }));
  })();
  const anchors=view==="reviews"?[["reviews",t("交易复盘","Trade reviews")],["diagnostics",t("原因诊断","Diagnostics")],["behavior",t("行为改进","Behavior")]]:[["attention",t("当前重点","Priorities")],["performance",t("交易表现","Performance")]];
  const scrollTo=(id)=>document.getElementById(`er-${id}`)?.scrollIntoView({behavior:"smooth",block:"start"});
  const selectedOwnerLesson=candidateOwnerLessons.find(item=>item.id===selectedOwnerLessonId)||candidateOwnerLessons[0]||null;
  const pageTitle=view==="reviews"?t("交易复盘详情","Trade Review Workbench"):view==="owner"?t("Owner 优化工作台","Owner Review Workspace"):t("执行与复盘","Execution & Review");
  const pageSubtitle=view==="reviews"?t("逐笔查看结果、根因、后续采用效果与事实证据。","Inspect each result, root cause, subsequent outcomes, and supporting facts."):view==="owner"?t("把复盘发现转成可审批、可验证、不会自行生效的改进工作。","Turn review findings into approvable, testable improvements that never activate themselves."):t("只保留当前重点和真实表现；详细工作进入独立页面。","Keep priorities and real performance here; open dedicated workspaces for detailed review.");
  return <div className="cp2Stack erPage erRefined">
    <header className="erPageHeader"><div><span>{view==="owner"?t("Owner 专属","Owner only"):t("交易驾驶舱","Trading cockpit")}</span><h2>{pageTitle}</h2><p>{pageSubtitle}</p></div>{view==="overview"?<div className="erHeaderState"><i className={reconciliationOk?"ok":"warn"}/><span><small>{t("OMS ↔ OKX","OMS ↔ OKX")}</small><b>{reconciliationLabel}</b></span></div>:<button type="button" className="erHeaderLink" onClick={()=>ui.setActive("tradeJournal")}><ChevronLeft size={14}/>{t("返回执行与复盘","Back to Execution & Review")}</button>}</header>
    {view!=="owner"&&<div className="erControlBar"><nav aria-label={t("页面章节","Page sections")}>{anchors.map(([id,label],index)=><button type="button" key={id} onClick={()=>scrollTo(id)}><i>{String(index+1).padStart(2,"0")}</i>{label}</button>)}</nav>{view==="reviews"&&<div className="erHistoryFilters"><label>{t("复盘口径","Review window")}<select value={historyRange} onChange={event=>setHistoryRange(event.target.value)}><option value="all">{t("全部时间","All time")}</option><option value="7d">{t("近 7 日","Last 7 days")}</option><option value="30d">{t("近 30 日","Last 30 days")}</option><option value="90d">{t("近 90 日","Last 90 days")}</option></select></label><label>{t("交易对","Pair")}<select value={historySymbol} onChange={event=>setHistorySymbol(event.target.value)}><option value="all">{t("全部交易对","All pairs")}</option>{historySymbols.map(symbol=><option value={symbol} key={symbol}>{symbol}</option>)}</select></label><label>{t("方向","Side")}<select value={historyDirection} onChange={event=>setHistoryDirection(event.target.value)}><option value="all">{t("多空全部","Long & short")}</option><option value="long">{t("只看做多","Long only")}</option><option value="short">{t("只看做空","Short only")}</option></select></label></div>}</div>}

    {view==="overview"&&<><section id="er-attention" className="erZone"><div className="erZoneLabel"><span>{t("当前重点","What Needs Attention")}</span><small>{t("先确认风险、持仓保护和待处理事项","Check risk, position protection, and pending work first")}</small></div>
      <div className="erExecSummary">
        <div><small>{t("在途执行", "In-flight")}</small><b>{inFlight} {t("笔", "")}</b><span>{t("等待 OKX 状态推进", "Awaiting OKX state updates")}</span></div>
        <div><small>{t("待批准计划", "Awaiting approval")}</small><b>{pendingApproval} {t("笔", "")}</b><span>{t("需要 Owner 决定", "Owner decision required")}</span></div>
        <div><small>{t("持仓保护", "Position protection")}</small><b>{protectedPositions} / {positions.length}</b><span>{t("按真实保护委托核验", "Verified from real protection orders")}</span></div>
        <div><small>{t("执行对账", "Execution reconciliation")}</small><b className={reconciliationOk ? "good" : latestReconciliation ? "bad" : ""}>{reconciliationLabel}</b><span>{latestReconciliation?.createdAt?formatDateTime(latestReconciliation.createdAt):t("等待首次 OKX 对账报告", "Awaiting the first OKX reconciliation report")}</span></div>
      </div>
      <div className="erPriorityGrid"><ConceptCard title={t("需要优先处理","Priority Actions")} meta={t("按处理紧迫度排序","Ordered by urgency")}><div className="erAttentionList"><article className={reconciliationOk?"ok":latestReconciliation?"critical":"warn"}><i>{reconciliationOk?"✓":"!"}</i><span><b>{reconciliationLabel}</b><small>{reconciliationOk?t("最新报告确认 OMS 委托、OKX 订单与持仓一致。","The latest report confirms OMS orders, OKX orders, and positions are aligned."):latestReconciliation?t("最新对账报告存在差异；系统会继续按权威 OKX 状态收口。","The latest report contains differences; reconciliation continues against authoritative OKX state."):t("当前页面还没有收到对账报告，不能把它显示成‘对账失败’。","No reconciliation report has reached this page yet, so this is not shown as a failure.")}</small></span></article><article className={pendingApproval?"warn":"ok"}><i>{pendingApproval?pendingApproval:"✓"}</i><span><b>{pendingApproval?t(`${pendingApproval} 笔计划等待批准`,`${pendingApproval} plans await approval`):t("没有待批准计划","No plans await approval")}</b><small>{pendingApproval?t("需要 Owner 明确批准后才会继续。","Owner approval is required before execution continues."):t("当前没有需要人工决策的计划。","No plans currently need an owner decision.")}</small></span></article><article className={pendingReviews.length?"warn":"ok"}><i>{pendingReviews.length||"✓"}</i><span><b>{pendingReviews.length?t(`${pendingReviews.length} 笔交易等待复盘`,`${pendingReviews.length} trades await review`):t("复盘队列已处理","Review queue is clear")}</b><small>{pendingReviews.length?t("建议先完成最近亏损或异常交易。","Review recent losses or abnormal trades first."):t("已完成当前筛选范围内的复盘。","Reviews are complete for the current filter.")}</small></span></article></div></ConceptCard><ConceptCard title={t("当前交易状态","Current Trading State")} meta={t("聚合信息，不替代真实委托记录","Summary only; not a substitute for the order ledger")}><div className="erCurrentState"><span>{t("持仓","Positions")}<b>{positions.length}</b></span><span>{t("已保护","Protected")}<b className={protectedPositions===positions.length?"good":"bad"}>{protectedPositions}/{positions.length}</b></span><span>{t("在途执行","In-flight")}<b>{inFlight}</b></span><span>{t("累计成交","Fills")}<b>{tradeDataStatus.fillTotal??fills.length}</b></span></div><button type="button" className="cp2Secondary erLedgerCta" onClick={()=>ui.setActive("tradeLedger")}>{t("查看 AI 委托与成交流水","Open AI Orders & Fills")}<ChevronRight size={14}/></button></ConceptCard></div>
    </section>

    <section id="er-performance" className="erZone"><div className="erZoneLabel"><span>{t("交易表现","Trading Performance")}</span><small>{t("真实成交与账户结果","Real fills and account outcomes")}</small></div>
      <div className={`erFinancialCoverage ${pendingFinancial?"warn":"ok"}`}><Database/><span><b>{pendingFinancial?t(`已平仓 ${allClosedLifecycles} 笔，其中 ${reconciledLifecycles} 笔已完成费用核算`,`${allClosedLifecycles} closed; ${reconciledLifecycles} fully cost-reconciled`):t(`${reconciledLifecycles} 笔已平仓交易均已完成费用核算`,`${reconciledLifecycles} closed trades are fully cost-reconciled`)}</b><small>{pendingFinancial?t(`另有 ${pendingFinancial} 笔仍在回补开仓费、平仓费或资金费；下方净绩效只统计已完整核算部分，不会把未知费用当成 0。`,`${pendingFinancial} still need entry fees, close fees, or funding. Net performance below includes only fully reconciled trades; unknown costs are never treated as zero.`):t("净绩效来自服务端完整生命周期，不由页面上的有限成交流水重新计算。","Net performance comes from complete server-side lifecycles, never reconstructed from the bounded UI fill list.")}</small></span></div>
      <div className="erKpi">
        <div className="erStat erStatWide"><div className="erStatCol"><small>{t("已核算净盈亏", "Reconciled net PnL")}</small><b className={reconciledLifecycles ? net >= 0 ? "good" : "bad" : ""}>{reconciledLifecycles ? `${net >= 0 ? "+" : ""}${money(net, "0")}` : "—"}</b></div>{reconciledLifecycles ? <Spark values={cumPnl} pos={net >= 0} /> : <span className="erStatPending">{pendingFinancial ? t("等待费用核算", "Awaiting cost reconciliation") : t("等待已平仓交易", "Awaiting closed trades")}</span>}</div>
        <div className="erStat withRing"><MiniRing pct={winPct} tone={winPct >= 50 ? "pos" : "neg"} /><div className="erStatCol"><small>{t("胜率", "Win rate")}</small><b>{lifecycleCount ? `${winPct}%` : "—"}</b></div></div>
        <div className="erStat"><div className="erStatCol"><small>{t("盈亏因子", "Profit factor")}</small><b>{performance.profitFactor != null ? num(performance.profitFactor).toFixed(2) : (o.profitFactor ?? "—")}</b></div></div>
        <div className="erStat"><div className="erStatCol"><small>{t("平均每笔", "Avg/trade")}</small><b className={reconciledLifecycles ? avg >= 0 ? "good" : "bad" : ""}>{reconciledLifecycles ? `${avg >= 0 ? "+" : ""}${money(avg, "0")}` : "—"}</b></div></div>
        <div className="erStat"><div className="erStatCol"><small>{t("最大交易回撤", "Max trade DD")}</small><b className="bad">{performance.realizedMaxDrawdownUsdt == null ? "—" : `${money(performance.realizedMaxDrawdownUsdt)} U${performance.realizedMaxDrawdownPctOfCurrentEquity == null ? "" : ` · ${displayPct(performance.realizedMaxDrawdownPctOfCurrentEquity)}`}`}</b></div></div>
        <div className="erStat"><div className="erStatCol"><small>{t("已平仓 / 已核算", "Closed / reconciled")}</small><b>{allClosedLifecycles}<span className="erUnit"> / {reconciledLifecycles}</span></b></div></div>
        <div className="erStat"><div className="erStatCol"><small>{t("待批准", "Awaiting")}</small><b>{pendingApproval}<span className="erUnit"> {t("笔", "")}</span></b></div></div>
      </div>
      <div className="erPerformanceTop">
        <ConceptCard title={t("真实绩效", "Real Performance")} meta={pendingFinancial?t("仅含已完成费用核算的生命周期", "Fully cost-reconciled lifecycles only"):t("真实成交 · 净手续费与资金费", "Real fills · net of fees and funding")}><div className="erPerformanceHeadline"><span>{t("累计净交易结果", "Cumulative net result")}</span><b className={net >= 0 ? "good" : "bad"}>{reconciledLifecycles?`${net >= 0 ? "+" : ""}${money(net, "0")} U`:"—"}</b></div>{reconciledLifecycles?<Spark values={cumPnl} pos={net >= 0} />:<div className="erPerformanceEmpty">{pendingFinancial?t("已有真实平仓，但费用核算尚未完整；完成前不显示假 0 曲线。","Real closes exist, but cost reconciliation is incomplete. No fake zero curve is shown."):t("尚无完整核算的已平仓交易。","No fully reconciled closed trade yet.")}</div>}</ConceptCard>
        <ConceptCard title={t("待复盘队列", "Review Queue")} action={<Pill tone={pendingReviews.length ? "warn" : "good"}>{pendingReviews.length} {t("笔", "")}</Pill>}><div className="erReviewQueue">{pendingReviews.slice(0, 4).map((review, index) => <article key={review.id || index}><span><b>{review.symbol || t("组合", "Portfolio")}</b><small>{formatDateTime(review.createdAt)}</small></span><p>{review.lesson || review.summary || review.notes || t("等待事实回补与深度归因。", "Awaiting fact enrichment and attribution.")}</p></article>)}{!pendingReviews.length && <div className="cp2Empty"><BookOpen/><b>{t("没有待复盘交易", "No pending reviews")}</b><span>{t("平仓确认后会自动进入。", "Confirmed closes enter automatically.")}</span></div>}</div></ConceptCard>
      </div>
      <div className="erPerformanceMiddle">
        <ConceptCard title={t("月度统计", "Monthly Rollup")} meta={t("北京时间 · 包含日目标达成", "UTC+8 · includes daily-goal hits")}><ConceptTable compact columns={[{ key: "month", label: t("月份", "Month") }, { key: "net", label: t("净盈亏", "Net PnL"), render: row => <span className={row.net >= 0 ? "good" : "bad"}>{money(row.net)} U</span> }, { key: "trades", label: t("交易", "Trades") }, { key: "winRate", label: t("胜率", "Win rate"), render: row => `${row.winRate}%` }, { key: "tradeDays", label: t("交易日", "Days") }, { key: "goalDays", label: t("日目标", "Goal"), render: row => `${row.goalDays}/${row.tradeDays}` }]} rows={monthlyRows} empty={t("暂无月度数据", "No monthly data")} /></ConceptCard>
        <ConceptCard title={t("纪律检查", "Discipline Check")}><div className="cp2Checklist vertical"><span><CheckCircle2 />{t("风险预算执行", "Risk budget enforced")}</span><span><CheckCircle2 />{t("止损保护覆盖", "Stop-loss coverage")}<small>{protectedPositions}/{positions.length}</small></span><span className={lifecycleCount < 20 ? "warn" : ""}><AlertTriangle />{lifecycleCount < 20 ? t("复盘样本仍需积累", "Review sample still building") : t("复盘样本达到基础门槛", "Review sample reached the basic threshold")}</span></div></ConceptCard>
      </div>
    </section>
    <section className="erWorkspaceRoutes" aria-label={t("独立工作页面","Dedicated workspaces")}>
      <article><div><span><BookOpen/></span><small>{t("逐笔复盘","TRADE REVIEWS")}</small><b>{t("交易复盘详情","Trade Review Workbench")}</b><p>{t(`${tradeReviews.length} 笔复盘 · ${pendingReviews.length} 笔等待完成`,`${tradeReviews.length} reviews · ${pendingReviews.length} awaiting completion`)}</p></div><button type="button" onClick={()=>ui.setActive("tradeReviewDetail")}>{t("打开独立页面","Open workspace")}<ChevronRight/></button></article>
      {ownerReviewEnabled&&<article className="owner"><div><span><Target/></span><small>{t("Owner 专属","OWNER WORKSPACE")}</small><b>{t("Owner 优化清单","Owner Improvement Queue")}</b><p>{t(`${ownerImprovements.length} 个优化项 · ${candidateOwnerLessons.length} 条候选教训`,`${ownerImprovements.length} improvements · ${candidateOwnerLessons.length} candidate lessons`)}</p></div><button type="button" onClick={()=>ui.setActive("ownerReviewWorkspace")}>{t("打开独立页面","Open workspace")}<ChevronRight/></button></article>}
    </section></>}
    {view==="reviews"&&<><section id="er-reviews" className="erZone"><div className="erZoneLabel"><span>{t("交易复盘详情","Trade Review Workbench")}</span><small>{t("结果、根因、改进与事实证据","Outcome, root cause, action, and evidence")}</small></div>
      <ConceptCard title={t("交易复盘详情", "Trade Review Workbench")} meta={t("平仓确认后自动进入队列 · 保留完整复盘正文", "Confirmed closes enter automatically · full review text retained")} className="erReviewCard">
        {filteredReviews.length ? <div className="erReviewWorkbench">
          <div className="erReviewIndex">{filteredReviews.slice(0,12).map((review,index)=>{const reviewPnl=reviewNetPnl(review);return <button type="button" className={selectedReview.id===review.id?"active":""} key={review.id||index} onClick={()=>setSelectedReviewId(review.id)}><span><b>{review.symbol||t("组合","Portfolio")}</b><Pill tone={toneOf(review.status)}>{humanize(review.status)}</Pill></span><strong className={reviewPnl==null?"":reviewPnl>=0?"good":"bad"}>{reviewHasResult(review)?`${reviewPnl>=0?"+":""}${money(reviewPnl)} U`:"—"}</strong><small>{formatDateTime(review.completedAt||review.createdAt)}</small><p>{review.summary||review.title||t("等待复盘结论。","Awaiting review conclusion.")}</p></button>;})}</div>
          <article className="erReviewDetail">
            <header><div><span>{selectedReview.direction?/short|空/i.test(String(selectedReview.direction))?t("做空","Short"):t("做多","Long"):t("已平仓交易","Closed trade")}</span><h3>{selectedReview.title||`${selectedReview.symbol||t("交易","Trade")} ${t("复盘","review")}`}</h3><small>{formatDateTime(selectedReview.completedAt||selectedReview.createdAt)} · {selectedReview.fillIds?.length||selectedReview.partialCloseCount||1} {t("笔平仓成交","close fills")}</small></div><div className="erReviewResult"><small>{t("净交易结果","Net trade result")}</small><b className={selectedReviewPnl>=0?"good":"bad"}>{reviewHasResult(selectedReview)?`${selectedReviewPnl>=0?"+":""}${money(selectedReviewPnl)} U`:"—"}</b></div></header>
            <div className="erReviewFacts erReviewFactsSix"><span>{t("过程 × 结果","Process × outcome")}<b>{selectedAssessment.matrix?.label||t("等待结构化评分","Awaiting assessment")}</b></span><span>{t("过程评分","Process score")}<b>{selectedAssessment.processScore==null?"—":`${selectedAssessment.processScore}/100`}</b></span><span>{t("主要归因","Primary cause")}<b>{selectedAssessment.rootCauses?.[0]?.label||selectedReview.attribution||t("待归因","Pending")}</b></span><span>{t("证据质量","Evidence quality")}<b>{humanize(selectedAssessment.evidenceQuality,"—")}</b></span><span>{t("开/平仓手续费","Entry / close fees")}<b>{selectedReviewFees==null?"—":`${money(selectedReviewFees)} U`}</b></span><span>{t("资金费","Funding")}<b>{selectedTrade?.fundingFeeUsdt==null&&selectedReview.fundingFeeUsdt==null?"—":`${money(selectedTrade?.fundingFeeUsdt??selectedReview.fundingFeeUsdt)} U`}</b></span></div>
            <section><i>01</i><div><b>{t("结果摘要","Outcome Summary")}</b><p>{selectedReview.summary||t("等待成交事实回补与结果汇总。","Awaiting fill facts and outcome summary.")}</p></div></section>
            <section><i>02</i><div><b>{t("深度判断与根因","Deep Analysis & Root Cause")}</b><p>{selectedReview.deepReflection||selectedReview.lesson||selectedReview.notes||t("深度复盘仍在队列中；完成后会在这里展示完整判断。","Deep review is still queued; the full analysis will appear here when complete.")}</p></div></section>
            <section><i>03</i><div><b>{t("下次如何改进","Action for Next Time")}</b><p>{selectedReview.lesson||t("等待形成可执行的改进结论。","Awaiting an actionable improvement conclusion.")}</p></div></section>
            <section className="erLearningEvidence"><i>04</i><div><b>{t("后续决策采用与效果","Subsequent Use & Outcomes")}</b>{selectedMemoryLearning ? <><div className="erLearningMetrics"><span>{t("采用后平仓","Closed after use")}<strong>{selectedMemoryLearning.outcomes?.trades||0}</strong></span><span>{t("采用后胜率","Win rate after use")}<strong>{selectedMemoryLearning.outcomes?.winRatePct==null?"—":`${selectedMemoryLearning.outcomes.winRatePct}%`}</strong></span><span>{t("采用后盈亏因子","PF after use")}<strong>{selectedMemoryLearning.outcomes?.profitFactor??"—"}</strong></span><span>{t("采用后最大回撤","DD after use")}<strong>{selectedMemoryLearning.outcomes?.maxDrawdownUsdt==null?"—":`${money(selectedMemoryLearning.outcomes.maxDrawdownUsdt)} U`}</strong></span></div><div className="erLearningBaseline"><span>{t("同类未采用对照","Comparable without use")}<b>{selectedMemoryLearning.comparableBaseline?.trades||0} {t("笔"," trades")}</b></span><span>{t("胜率","Win rate")}<b>{selectedMemoryLearning.comparableBaseline?.winRatePct==null?"—":`${selectedMemoryLearning.comparableBaseline.winRatePct}%`}</b></span><span>{t("盈亏因子","Profit factor")}<b>{selectedMemoryLearning.comparableBaseline?.profitFactor??"—"}</b></span><span>{t("最大交易回撤","Max trade DD")}<b>{selectedMemoryLearning.comparableBaseline?.maxDrawdownUsdt==null?"—":`${money(selectedMemoryLearning.comparableBaseline.maxDrawdownUsdt)} U`}</b></span></div></>:<p>{t("尚无后续交易明确采用这条复盘；系统不会把‘已经写过复盘’冒充为‘已经证明有效’。","No subsequent trade has explicitly applied this review; the system does not mistake a written review for proven improvement.")}</p>}<small className="erLearningVerdict">{selectedMemoryLearning?.enoughEvidence?t(`已达到基础同类对照样本门槛：胜率差 ${selectedMemoryLearning.deltas?.winRatePct>=0?"+":""}${selectedMemoryLearning.deltas?.winRatePct??"—"}%，盈亏因子差 ${selectedMemoryLearning.deltas?.profitFactor==null?"—":`${selectedMemoryLearning.deltas.profitFactor>=0?"+":""}${selectedMemoryLearning.deltas.profitFactor}`}，最大回撤差 ${selectedMemoryLearning.deltas?.maxDrawdownUsdt>=0?"+":""}${selectedMemoryLearning.deltas?.maxDrawdownUsdt??"—"} U。仅表示相关性，不等于因果证明。`,`Comparable threshold met: win-rate delta ${selectedMemoryLearning.deltas?.winRatePct??"—"}%, PF delta ${selectedMemoryLearning.deltas?.profitFactor??"—"}, max-DD delta ${selectedMemoryLearning.deltas?.maxDrawdownUsdt??"—"} U. This shows association, not causation.`):t(`样本不足：采用组与同交易对、同策略、同周期对照组各至少需要 ${reviewLearning.minComparableSample||5} 笔。`,`Insufficient sample: both the applied and same-pair/strategy/timeframe control cohorts need at least ${reviewLearning.minComparableSample||5} trades.`)}</small></div></section>
            {selectedLesson&&<div className="erLessonDecision"><span><small>{t("教训生命周期","Lesson lifecycle")}</small><b>{ownerStateLabel(selectedLesson.status)}</b><p>{selectedLesson.status==="active"?t("只有已批准的教训才会在相同交易对、方向、周期与策略情景中注入下一轮决策。","Only approved lessons are injected into future decisions for matching symbol, direction, timeframe, and strategy contexts."):t("批准不是修改策略；它只允许 AI 在真正相似的行情中把这条历史经验作为参考。","Approval does not change a strategy; it only lets AI reference this history in genuinely similar contexts.")}</p></span>{["candidate","candidate_legacy","observing"].includes(selectedLesson.status)&&<div><button type="button" className="cp2Primary" disabled={Boolean(ownerBusy)} onClick={()=>runOwnerAction("lesson",selectedLesson,"approve")}>{t("用于相似行情","Use in matching contexts")}</button>{selectedLesson.status!=="observing"&&<button type="button" className="cp2Secondary" disabled={Boolean(ownerBusy)} onClick={()=>runOwnerAction("lesson",selectedLesson,"observe")}>{t("继续观察","Keep observing")}</button>}<button type="button" className="cp2Secondary" disabled={Boolean(ownerBusy)} onClick={()=>runOwnerAction("lesson",selectedLesson,"reject")}>{t("拒绝","Reject")}</button></div>}</div>}
            <footer><span><Database/>{t("事实来源：真实平仓成交、执行轨迹、持仓期行情与已核验消息", "Evidence: real close fills, execution trail, in-trade market data, and verified news")}</span><small className="mono">{selectedReview.tradeLifecycleKey||selectedReview.executionOrderId||selectedReview.id}</small></footer>
          </article>
        </div>:<div className="cp2Empty"><BookOpen/><b>{t("暂无复盘", "No reviews")}</b><span>{t("平仓确认后会自动进入复盘队列。", "Confirmed closes auto-enter the review queue.")}</span></div>}
      </ConceptCard>
    </section>
    <section id="er-diagnostics" className="erZone"><div className="erZoneLabel"><span>{t("复盘诊断","Review Diagnostics")}</span><small>{t("相同筛选口径下的持仓、收益与亏损原因","Hold time, returns, and loss causes under the same filter")}</small></div><PerformanceDiagnostics points={diagnosticPoints}/></section>
    <section id="er-behavior" className="erZone"><div className="erZoneLabel"><span>{t("行为改进","Behavioral Improvement")}</span><small>{t(`${behaviorAlerts} 条行为提醒 · 纪律采纳需人工确认`,`${behaviorAlerts} behavior alerts · adopting disciplines requires confirmation`)}</small></div><BehaviorCompact data={data} action={action} showDiagnostics={false}/></section></>}
    {view==="owner"&&ownerReviewEnabled&&<section id="er-improvements" className="erZone erOwnerWorkspace"><div className="erZoneLabel"><span>{t("Owner 优化清单","Owner Improvement Queue")}</span><small>{t("复盘发现只形成建议；策略、Prompt、风控和代码都不会被系统自行修改","Reviews create proposals only; the system never changes strategy, prompts, risk, or code on its own")}</small></div>
      <div className="erOwnerSummary"><span><small>{t("结构化复盘","Structured reviews")}</small><b>{ownerSummary.structuredReviews||0}</b></span><span><small>{t("候选教训","Candidate lessons")}</small><b>{ownerSummary.candidateLessons||0}</b></span><span><small>{t("等待 Owner","Awaiting Owner")}</small><b>{ownerSummary.pendingOwner||0}</b></span><span><small>{t("验证中","Validating")}</small><b>{ownerSummary.validating||0}</b></span></div>
      <div className="erOwnerModeSwitch" role="tablist" aria-label={t("Owner 工作区内容","Owner workspace views")}><button type="button" role="tab" aria-selected={ownerPane==="improvements"} className={ownerPane==="improvements"?"active":""} onClick={()=>setOwnerPane("improvements")}><Target/><span><b>{t("需要决策的优化项","Improvement proposals")}</b><small>{ownerImprovements.length} {t("项","items")}</small></span></button><button type="button" role="tab" aria-selected={ownerPane==="lessons"} className={ownerPane==="lessons"?"active":""} onClick={()=>setOwnerPane("lessons")}><Sparkles/><span><b>{t("候选教训","Candidate lessons")}</b><small>{candidateOwnerLessons.length} {t("条","items")}</small></span></button></div>
      {ownerPane==="improvements"?<ConceptCard title={t("需要决策的优化项","Improvement proposals")} meta={t("本页内部滚动，不再把整个网页无限拉长","This workspace scrolls internally instead of extending the whole page")} className="erOwnerPanel">
          <div className="erImprovementList erOwnerPanelScroll">{ownerImprovements.slice(0,30).map(item=>{
            const nextStage=item.validation?.stages?.find(stage=>!/passed|completed|verified/i.test(String(stage.status)));
            return <article key={item.id}>
              <header><div><Pill tone={item.state==="pending_owner"?"warn":item.state==="verified"?"good":item.state==="rejected"||item.state==="ineffective"?"bad":"neutral"}>{ownerStateLabel(item.state)}</Pill><Pill>{destinationLabel(item.destination)}</Pill></div><small>{item.evidenceCount||0} {t("笔证据","evidence items")}</small></header>
              <b>{item.title}</b><p>{item.problem}</p><small>{item.proposal}</small>
              {item.successCriteria?.length>0&&<ul>{item.successCriteria.slice(0,3).map((criterion,index)=><li key={index}>{criterion}</li>)}</ul>}
              {item.validation&&<div className="erValidationStages">{item.validation.candidateStrategyRef?.versionId&&<span><i className="done"/>{t("候选版本","Candidate version")} · {item.validation.candidateStrategyRef.versionId}</span>}{item.validation.stages.map(stage=><span key={stage.name}><i className={/passed|completed|verified/i.test(String(stage.status))?"done":""}/>{stage.label||humanize(stage.name)} · {humanize(stage.status)}</span>)}</div>}
              {renderOwnerEvidenceForm(item,nextStage)}
              <footer>
                {item.state==="pending_owner"&&<><button type="button" className="cp2Primary" disabled={Boolean(ownerBusy)} onClick={()=>runOwnerAction("improvement",item,"accept")}>{t("接受建议","Accept")}</button><button type="button" className="cp2Secondary" disabled={Boolean(ownerBusy)} onClick={()=>runOwnerAction("improvement",item,"more_evidence")}>{t("继续积累","More evidence")}</button><button type="button" className="cp2Secondary" disabled={Boolean(ownerBusy)} onClick={()=>runOwnerAction("improvement",item,"reject")}>{t("拒绝","Reject")}</button></>}
                {item.state==="accepted"&&<button type="button" className="cp2Primary" disabled={Boolean(ownerBusy)} onClick={()=>runOwnerAction("improvement",item,"start_validation")}>{t("开始验证","Start validation")}</button>}
                {item.state==="validating"&&<><button type="button" className="cp2Primary" disabled={Boolean(ownerBusy)||item.destination==="strategy"&&!item.validation?.readyForOwnerVerification} title={item.destination==="strategy"&&!item.validation?.readyForOwnerVerification?t("回测、模拟盘和小额验证全部通过后才能确认有效","Backtest, paper, and small-live validation must all pass first"):""} onClick={()=>runOwnerAction("improvement",item,"verify")}>{t("确认有效","Mark effective")}</button><button type="button" className="cp2Secondary" disabled={Boolean(ownerBusy)} onClick={()=>runOwnerAction("improvement",item,"ineffective")}>{t("确认无效","Mark ineffective")}</button></>}
                {item.state==="ineffective"&&item.destination==="strategy"&&<button type="button" className="cp2Primary" disabled={Boolean(ownerBusy)} onClick={()=>runOwnerAction("improvement",item,"retry_validation")}>{t("创建下一代候选验证","Create next candidate attempt")}</button>}
                {item.engineeringTask&&<button type="button" className="cp2Secondary" onClick={()=>copyEngineeringTask(item)}>{t("复制工程任务","Copy engineering task")}</button>}
              </footer>
            </article>;
          })}{!ownerImprovements.length&&<div className="cp2Empty"><CheckCircle2/><b>{t("暂无需要处理的优化项","No improvement proposals need attention")}</b><span>{t("系统会先积累可核验复盘证据，不会因一笔盈亏就要求修改策略。","The system waits for verifiable review evidence and never proposes a strategy change from one outcome alone.")}</span></div>}</div>
        </ConceptCard>:<ConceptCard title={t("候选教训","Candidate lessons")} meta={t("左侧选记录，右侧只查看一条；不再把全部详情向下堆叠","Select a record on the left and inspect one detail at a time")} className="erOwnerPanel">
          <div className="erLessonGuide"><Sparkles/><span><b>{t("这里不是策略开关","This is not a strategy switch")}</b><small>{t("批准后，AI 只会在交易对、方向、周期和策略情景匹配时参考；不会自动改策略、仓位、风控或代码。","After approval, AI may reference it only in a matching symbol, side, timeframe, and strategy context. It never edits strategy, sizing, risk, or code.")}</small></span></div>
          <div className="erLessonWorkbench">
            <aside className="erLessonIndex" aria-label={t("候选教训列表","Candidate lesson list")}>{candidateOwnerLessons.slice(0,40).map(item=>{const scopeValues=lessonScopeValues(item);const preview=item.llmAdvice||item.systemSuggestion||item.lessonText||item.content;return <button type="button" className={selectedOwnerLesson?.id===item.id?"active":""} key={item.id} onClick={()=>setSelectedOwnerLessonId(item.id)}><span><b>{item.title||t("未命名复盘教训","Untitled review lesson")}</b><Pill tone={item.hasLlmAdvice?"good":item.origin==="legacy_unreviewed"?"warn":"neutral"}>{lessonOriginLabel(item.origin)}</Pill></span><p>{preview||t("尚未形成可执行建议。","No actionable advice yet.")}</p><small>{scopeValues.slice(0,3).join(" · ")||t("适用范围待补齐","Applicability pending")} · {formatDateTime(item.updatedAt||item.createdAt)}</small></button>;})}{!candidateOwnerLessons.length&&<div className="cp2Empty"><BookOpen/><b>{t("暂无候选教训","No candidate lessons")}</b><span>{t("新的完整复盘会先进入这里，而不是直接影响下一笔交易。","New complete reviews arrive here first instead of affecting the next trade automatically.")}</span></div>}</aside>
            {selectedOwnerLesson&&(()=>{const item=selectedOwnerLesson;const assessment=item.assessment||{};const scopeValues=lessonScopeValues(item);const legacy=item.origin==="legacy_unreviewed";return <article className="erLessonDetail">
              <header><div><Pill tone={item.hasLlmAdvice?"good":legacy?"warn":"neutral"}>{lessonOriginLabel(item.origin)}</Pill><Pill tone="warn">{ownerStateLabel(item.status)}</Pill></div><small>{formatDateTime(item.updatedAt||item.createdAt)}</small></header>
              <div className="erLessonTitle"><b>{item.title||t("未命名复盘教训","Untitled review lesson")}</b><div>{scopeValues.slice(0,3).map(value=><span key={value}>{value}</span>)}</div></div>
              <div className="erLessonExpanded">
              {legacy&&<div className="erLessonLegacy"><AlertTriangle/><span><b>{t("旧版记录需要更谨慎","Extra care required for legacy history")}</b><small>{item.legacyCaveat||t("无法确认它是否经过当前结构化事实与 LLM 复盘流程。","It cannot be proven to have passed the current structured-fact and LLM review pipeline.")}</small></span></div>}
              <div className="erLessonFacts"><span><small>{t("交易结果","Trade outcome")}</small><b className={assessment.outcome==="win"?"good":assessment.outcome==="loss"?"bad":""}>{lessonOutcomeLabel(assessment.outcome)}{assessment.netRealizedPnl!=null?` · ${assessment.netRealizedPnl>=0?"+":""}${money(assessment.netRealizedPnl)} U`:""}</b></span><span><small>{t("过程判断","Process assessment")}</small><b>{assessment.matrixLabel||t("旧版未结构化","Legacy · unstructured")}</b></span><span><small>{t("证据质量","Evidence quality")}</small><b>{evidenceQualityLabel(assessment.evidenceQuality)}{assessment.processScore!=null?` · ${assessment.processScore}/100`:""}</b></span></div>
              <section><div><Database/><b>{t("发生了什么","What happened")}</b></div><p>{item.factSummary||item.lessonText||t("没有可独立核验的结构化摘要。","No independently verifiable structured summary is available.")}</p></section>
              <section><div><Target/><b>{t("系统诊断","System diagnosis")}</b></div><p>{item.diagnosis?.label?`${item.diagnosis.label}${item.diagnosis.confidence!=null?` · ${Math.round(item.diagnosis.confidence*100)}%`:""}${item.diagnosis.evidence?`：${item.diagnosis.evidence}`:""}`:t("旧版记录没有结构化根因，不应仅凭盈亏反推方法对错。","Legacy history has no structured root cause; outcome alone cannot prove the method right or wrong.")}</p></section>
              <section className={item.hasLlmAdvice?"llm":"system"}><div>{item.hasLlmAdvice?<Sparkles/>:<Wrench/>}<b>{item.hasLlmAdvice?t("LLM 给出的复盘建议","LLM review advice"):t("系统给出的验证建议","System validation advice")}</b></div><p>{item.llmAdvice||item.systemSuggestion||t("这条旧版记录没有可确认来源的独立建议；建议查看原始复盘，无法验证时保持隔离。","This legacy record has no independently sourced advice. Inspect the source review and keep it isolated if it cannot be verified.")}</p></section>
              <div className="erLessonScope"><div><Eye/><span><b>{t("批准后只在以下场景参考","Used only in these matching contexts")}</b><small>{scopeValues.length?scopeValues.join(" · "):t("适用范围不完整，不建议批准","Applicability is incomplete; approval is not recommended")}</small></span></div><p>{t("实时行情与硬风控始终优先；AI 还必须在交易计划中记录是否真正采用了这条教训以及它如何影响判断。","Live evidence and hard risk controls always take priority. AI must also record whether this lesson was actually applied and how it affected the plan.")}</p></div>
              <footer><button type="button" className="cp2Primary" disabled={Boolean(ownerBusy)||!scopeValues.length} onClick={()=>runOwnerAction("lesson",item,"approve")}>{t("确认用于相似行情","Allow in matching contexts")}</button>{item.status!=="observing"&&<button type="button" className="cp2Secondary" disabled={Boolean(ownerBusy)} onClick={()=>runOwnerAction("lesson",item,"observe")}>{t("继续观察","Keep observing")}</button>}<button type="button" className="cp2Secondary" disabled={Boolean(ownerBusy)} onClick={()=>runOwnerAction("lesson",item,"reject")}>{t("拒绝","Reject")}</button>{item.reviewId&&<button type="button" className="cp2Secondary" onClick={()=>openLessonReview(item)}>{t("查看原交易复盘","Open source review")}</button>}</footer>
              </div>
            </article>;})()}
          </div>
        </ConceptCard>}
    </section>}
    {view==="owner"&&!ownerReviewEnabled&&<ConceptCard title={t("Owner 优化工作台","Owner Review Workspace")}><div className="cp2Empty"><ShieldCheck/><b>{t("仅 Owner 可以访问","Owner access required")}</b><span>{t("该页面包含策略与教训审批动作，不向普通账户开放。","This page contains strategy and lesson approval actions and is not available to regular accounts.")}</span></div></ConceptCard>}
  </div>;
}

export function TradeReviewWorkbenchConcept(props){return <ExecutionReviewConcept {...props} view="reviews"/>;}
export function OwnerReviewWorkspaceConcept(props){return <ExecutionReviewConcept {...props} view="owner"/>;}

// 生效中的条令:列出已直接注入 Agent 决策的透镜(active)与铁律(已批准),点开看全文。
function ActiveDoctrineCard({ data, compact = false }){
  const k=data.knowledge||{};
  const lenses=arr(k.lenses).filter(l=>l.active);
  const rules=arr(k.ruleProposals).filter(r=>r.status==="已批准"||r.status==="approved");
  const [open,setOpen]=useState(null);
  const rowText=r=>r.description||r.rule||r.detail||r.condition||t("（无正文）", "(no content)");
  return <ConceptCard title={t("生效中的条令", "Active Doctrine")} meta={`${lenses.length+rules.length} ${t("项", "active")}`} className={`cp2DoctrineCard ${compact?"compact":""}`}>
    <div className="cp2DoctrineStats"><span><i className="lens">{lenses.length}</i>{t("分析透镜", "Analysis lenses")}</span><span><i className="iron">{rules.length}</i>{t("风控铁律", "Risk rules")}</span></div>
    {!compact&&<p className="cp2Intro">{t("这些已", "These are ")}<b>{t("直接注入 Agent 每次决策", "injected directly into every agent decision")}</b>{t("——透镜塑造分析、铁律不可违，无需\"生成候选\"。点条目看全文。", " — lenses shape analysis, iron rules cannot be broken, no \"generate candidate\" needed. Click an item for the full text.")}</p>}
    {!lenses.length&&!rules.length&&<div className="cp2DoctrineEmpty"><ShieldCheck size={18}/><span>{t("尚无已批准条令", "No approved doctrine yet")}</span><small>{t("候选透镜和规则需独立审批后才会生效", "Candidate lenses and rules require independent approval")}</small></div>}
    <div className="cp2DoctrineList">
      {lenses.map(l=><div key={l.id} className={`cp2DoctrineRow ${open===l.id?"on":""}`}>
        <button onClick={()=>setOpen(open===l.id?null:l.id)}><span className="cp2DocTag lens">{t("透镜", "Lens")}</span><b>{localizeText(l.name)}</b><ChevronDown size={13}/></button>
        {open===l.id&&<p>{l.promptText||l.description||t("（无正文）", "(no content)")}</p>}
      </div>)}
      {rules.map(r=><div key={r.id} className={`cp2DoctrineRow ${open===r.id?"on":""}`}>
        <button onClick={()=>setOpen(open===r.id?null:r.id)}><span className="cp2DocTag iron">{t("铁律", "Iron rule")}</span><b>{localizeText(r.name)}</b><ChevronDown size={13}/></button>
        {open===r.id&&<p>{rowText(r)}</p>}
      </div>)}
    </div>
    {compact&&(lenses.length>0||rules.length>0)&&<p className="cp2DoctrineFoot">{t("仅展示已批准并正在生效的条令；点击条目查看正文。", "Only approved, active doctrine is shown. Select an item for details.")}</p>}
  </ConceptCard>;
}

export function KnowledgeConcept({ data, action, ui }) {
  const k=data.knowledge||{}; const sources=arr(k.sources); const methods=arr(k.tradingMethods); const knowledgeCandidates=arr(k.candidates); const knowledgeSkills=arr(k.tradingSkills); const rules=arr(k.ruleProposals); const chunks=arr(k.chunks);
  const pendingRules=rules.filter(rule=>!rule.status||rule.status==="待审批"||rule.status==="candidate");
  const approvedRules=rules.filter(rule=>rule.status==="已批准"||rule.status==="approved");
  const hardRules=approvedRules.filter(rule=>rule.enforcementStatus==="entry_enforced");
  const advisoryRules=approvedRules.filter(rule=>rule.enforcementStatus==="advisory_uncompiled"||!rule.enforcementStatus);
  const publishedStrategies=knowledgeSkills.filter(isPublishedKnowledgeStrategy);
  const incubatingStrategies=knowledgeSkills.filter(skill=>!isPublishedKnowledgeStrategy(skill));
  const lensCandidates=knowledgeCandidates.filter(item=>item.type==="lens"&&!['ignored','rejected'].includes(item.status));
  const workflowCandidates=knowledgeCandidates.filter(item=>item.type==="workflow"&&!['ignored','rejected'].includes(item.status));
  const strategyCandidates=knowledgeCandidates.filter(item=>item.type==="strategy"&&!['ignored','rejected'].includes(item.status));
  const lenses=arr(k.lenses); const workflows=arr(k.workflows);
  const pendingImportedTools=arr(data.skills).filter(item=>item.kind!=="strategy"&&!isPublishedImportedSkill(item));
  const [section,setSection]=useState("reference");
  const concepts=arr(k.conceptCards);
  const [conceptSource,setConceptSource]=useState("all");
  const [conceptCategory,setConceptCategory]=useState("all");
  const conceptSourceIds=useMemo(()=>new Set(concepts.flatMap(item=>arr(item.sourceRefs).concat(item.sourceId||[])).filter(Boolean)),[concepts]);
  const graphSources=useMemo(()=>sources.filter(source=>conceptSourceIds.has(source.id)),[sources,conceptSourceIds]);
  const sourceFilteredConcepts=useMemo(()=>concepts.filter(item=>{
    const refs=arr(item.sourceRefs).concat(item.sourceId||[]);
    return conceptSource==="all"||refs.includes(conceptSource);
  }),[concepts,conceptSource]);
  const conceptCategories=useMemo(()=>[...new Set(sourceFilteredConcepts.map(item=>item.category||t("其他", "Other")))],[sourceFilteredConcepts]);
  const visibleConcepts=useMemo(()=>sourceFilteredConcepts.filter(item=>conceptCategory==="all"||(item.category||t("其他", "Other"))===conceptCategory),[sourceFilteredConcepts,conceptCategory]);
  const visibleNames=useMemo(()=>new Set(visibleConcepts.map(item=>String(item.name||item.title||"").trim()).filter(Boolean)),[visibleConcepts]);
  const relationCount=useMemo(()=>{
    const links=new Set();
    visibleConcepts.forEach(item=>arr(item.relatedTo).forEach(target=>{
      const from=String(item.name||item.title||"").trim(); const to=String(target||"").trim();
      if(from&&to&&visibleNames.has(to)) links.add([from,to].sort().join("→"));
    }));
    return links.size;
  },[visibleConcepts,visibleNames]);
  const sourceCountForConcepts=useMemo(()=>new Set(visibleConcepts.flatMap(item=>arr(item.sourceRefs).concat(item.sourceId||[])).filter(Boolean)).size,[visibleConcepts]);
  const importedSources=useMemo(()=>sources.filter(source=>!["doctrine","manual_curated"].includes(source.type)),[sources]);
  const sourceStages=useMemo(()=>importedSources.map(source=>{
    const sourceConcepts=concepts.filter(item=>arr(item.sourceRefs).concat(item.sourceId||[]).includes(source.id));
    const sourceRules=rules.filter(item=>arr(item.sourceRefs).concat(item.sourceId||[]).includes(source.id));
    const sourceChunks=chunks.filter(item=>item.sourceId===source.id);
    const sourceFailed=/fail|error|失败|错误|无可用|empty|unsupported/i.test(String(source.status||""));
    const processing=String(source.status||"").toLowerCase()==="processing";
    const structured=sourceConcepts.length>0||sourceRules.length>0;
    const stage=sourceFailed?0:processing?1:structured?3:2;
    const tone=sourceFailed?"bad":processing?"neutral":structured?"good":"info";
    const stageLabel=sourceFailed?t("导入未完成","Import incomplete"):processing?t("正在解析","Parsing"):structured?t("知识基础已建立","Knowledge base ready"):t("已可检索","Searchable");
    const effect=sourceFailed?t("当前不会影响分析或交易；它无法被检索，也不会进入 Agent 的证据包。","It currently affects neither analysis nor trading; it cannot be searched or enter an agent evidence bundle."):processing?t("正在提取正文并建立索引；完成前不会进入分析。","Text extraction and indexing are in progress; it cannot enter analysis yet."):structured?t("可检索、可引用，并已形成概念关联或待审批规则；被引用时会进入 Gemini 的证据包，但不会绕过策略验证或硬风控。","It is searchable and citable, with concept links or pending rules. Citations may enter Gemini evidence bundles, but never bypass strategy validation or hard risk controls."):t("可以搜索、提问和引用；概念关系与规则仍在后台整理。","It can be searched, queried, and cited while concept links and rules are still being organized.");
    return {source,stage,tone,stageLabel,effect,sourceChunks:sourceChunks.length,sourceConcepts:sourceConcepts.length,sourceRules:sourceRules.length,canRetry:sourceFailed};
  }),[importedSources,concepts,rules,chunks]);
  const runSourceNext=(row)=>{
    if(row.canRetry)return action(`/api/knowledge/sources/${row.source.id}/parse-real`,{});
  };
  const convert=async (source) =>{if(await uiConfirm(`${t("从《", "Generate optional artifacts from 《")}${source.title||source.name}${t("》提取可选的策略、分析透镜和工作流候选？", "》?")}`))action("/api/knowledge/convert",{sourceId:source.id});};
  const latestSkillForMethod=(method)=>knowledgeSkills
    .filter(skill=>skill.sourceMethodId===method.id)
    .sort((a,b)=>Number(b.version||0)-Number(a.version||0))[0]||null;
  const runSkillNext=async(skill)=>{
    if(!skill?.id)return;
    if(["compiled","historical_rejected"].includes(skill.status))return action(`/api/knowledge/skills/${skill.id}/validate`,{});
    if(skill.status==="historical_validated")return action(`/api/knowledge/skills/${skill.id}/paper`,{});
    if(skill.status==="paper_validating")return action("/api/knowledge/skills/sync",{});
    if(skill.status==="paper_validated"){
      if(await uiConfirm(t(`批准「${skill.name}」当前指纹版本进入小额实盘试用？`,`Approve the current fingerprint of “${skill.name}” for limited live probation?`)))return action(`/api/knowledge/skills/${skill.id}/approve`,{});
    }
  };
  const skillNextLabel=(skill)=>!skill?t("编译为可测试版本","Compile testable version"):({compiled:t("运行历史验证","Run historical validation"),historical_rejected:t("重跑历史验证","Retry historical validation"),historical_validated:t("启动纯前向模拟","Start forward validation"),paper_validating:t("同步前向进度","Sync forward progress"),paper_validated:t("批准小额试用","Approve probation")}[skill.status]||"");
  const artifactForCandidate=(candidate)=>candidate.type==="lens"?lenses.find(item=>item.id===candidate.adoptedArtifactId):workflows.find(item=>item.id===candidate.adoptedArtifactId);
  const candidateActions=(candidate)=>{
    const artifact=artifactForCandidate(candidate);
    const approved=candidate.type==="workflow"&&isApprovedKnowledgeWorkflow(artifact);
    if(approved)return <span className="cp2LiveTag"><CheckCircle2 size={12}/>{t("已发布到能力库","Published to Capabilities")}</span>;
    if(candidate.status==="candidate")return <span className="cp2FormActions"><button className="cp2Link" onClick={()=>action(`/api/knowledge/candidates/${candidate.id}/ignore`,{})}>{t("忽略","Ignore")}</button><button className="cp2Link" onClick={()=>action(`/api/knowledge/candidates/${candidate.id}/adopt`,{})}>{t("采纳为草稿","Adopt draft")}</button></span>;
    if(candidate.status==="adopted"&&["lens","workflow"].includes(candidate.type))return <button className="cp2Link" onClick={()=>action(`/api/knowledge/candidates/${candidate.id}/approve-prompt`,{})}>{t("审批当前版本","Approve version")}</button>;
    return <Pill tone="neutral">{humanize(candidate.status)}</Pill>;
  };
  const processingCount=sourceStages.filter(row=>row.stage===1).length; const failedSourceCount=sourceStages.filter(row=>row.stage===0).length;
  const knowledgeNext=!importedSources.length?{tone:"neutral",title:t("导入第一份知识","Import your first source"),detail:t("导入书籍、PDF、DOCX、网页或 GitHub 后，系统会解析正文、建立检索索引，再形成概念关系和待审批规则。","After importing a book, PDF, DOCX, webpage, or GitHub source, the system parses the text, builds a search index, then forms concept links and pending rules."),action:t("导入知识","Import knowledge"),run:()=>ui.openPanel("knowledgeImport")}:failedSourceCount?{tone:"warn",title:t(`${failedSourceCount} 个来源需要重新解析`,`${failedSourceCount} sources need parsing again`),detail:t("失败来源不会进入检索或 Agent 证据包。请在下方来源卡直接重试。","Failed sources cannot enter retrieval or agent evidence bundles. Retry them directly from the source cards below."),action:t("管理来源","Manage sources"),run:()=>ui.openPanel("knowledgeList")}:processingCount?{tone:"neutral",title:t(`${processingCount} 个来源正在建立索引`,`${processingCount} sources are being indexed`),detail:t("解析完成后会自动变成可检索，不需要手动开启第二条流水线。","They become searchable automatically after parsing; there is no second pipeline to start manually."),action:t("查看来源","View sources"),run:()=>ui.openPanel("knowledgeList")}:pendingRules.length?{tone:"warn",title:t(`知识已可用，下一步审批 ${pendingRules.length} 条候选规则`,`Knowledge is ready; review ${pendingRules.length} candidate rules next`),detail:t("规则必须去重并由 Owner 批准后才会生效；未批准内容仍可用于检索，但不会成为硬风控。","Rules take effect only after deduplication and Owner approval. Unapproved content remains searchable but never becomes a hard control."),action:t("管理规则","Manage rules"),run:()=>ui.openPanel("ruleLibrary")}:{tone:"good",title:t("知识基础已完成","Knowledge foundation is ready"),detail:t("现在可以检索、引用和查看知识图谱。交易方法继续在本页实验室完成历史与纯前向验证；工具或工作流也先在本页审核。只有毕业版本才进入策略库或能力库。","You can now search, cite, and explore the graph. Methods continue through historical and forward validation in this lab; tools and workflows are reviewed here too. Only graduated versions enter Strategy or Capability catalogs."),action:t("孵化交易方法","Incubate methods"),run:()=>setSection("methods")};
  const sectionTabs=[
    ["reference",t("AI 参考知识","AI Reference"),BookOpen,sourceStages.filter(row=>row.stage>=2).length],
    ["rules",t("交易纪律","Trading Rules"),ShieldCheck,rules.length],
    ["methods",t("交易方法实验室","Method Lab"),BarChart3,methods.length],
    ["workflows",t("工具与工作流实验室","Tool & Workflow Lab"),Wrench,workflowCandidates.length+lensCandidates.length+pendingImportedTools.length]
  ];
  const statusLabel=(skill)=>({compiled:t("待历史验证","Awaiting backtest"),historical_rejected:t("历史验证未通过","Backtest failed"),historical_validated:t("待前向验证","Awaiting forward test"),paper_validating:t("前向验证中","Forward-testing"),paper_rejected:t("前向验证未通过","Forward test failed"),paper_validated:t("待批准试用","Awaiting probation approval"),probation:t("小额试用","Live probation"),active:t("已发布","Published"),degraded:t("已降级","Degraded")}[skill?.status]||humanize(skill?.status,t("尚未编译","Not compiled")));
  return <div className="cp2Stack cp2KnowledgeIncubator">
    <header className="cp2KnowledgeHeader"><div><small>{t("知识孵化中心","KNOWLEDGE INCUBATOR")}</small><h2>{t("先在这里理解、筛选和验证，再进入正式目录","Understand, curate, and validate here before publishing")}</h2><p>{t("可检索知识可以立刻供 AI 参考；规则必须审批，方法与工作流必须验证。未毕业的产物不会出现在策略库或能力库。","Searchable knowledge can inform AI immediately. Rules require approval; methods and workflows require validation. Unqualified artifacts never appear in Strategy or Capability catalogs.")}</p></div><button type="button" className="cp2Primary" onClick={()=>ui.openPanel("knowledgeImport")}><Plus size={13}/>{t("导入知识","Import")}</button></header>
    <nav className="cp2KnowledgeTabs" aria-label={t("知识库分区","Knowledge sections")}>{sectionTabs.map(([key,label,Icon,count])=><button type="button" key={key} className={section===key?"active":""} onClick={()=>setSection(key)}><Icon size={15}/><span><b>{label}</b><small>{count} {t("项","")}</small></span></button>)}</nav>
    <div className="cp2KnowledgeFunnel" aria-label={t("知识毕业漏斗","Knowledge graduation funnel")}><span><b>{t("导入并可检索","Import & retrieve")}</b><small>{t("AI 可引用，不会直接下单","AI may cite; cannot trade")}</small></span><ChevronRight/><span><b>{t("形成候选","Create candidate")}</b><small>{t("规则 / 方法 / 工作流","Rule / method / workflow")}</small></span><ChevronRight/><span><b>{t("审批或验证","Approve or validate")}</b><small>{t("反例、历史、纯前向","Counterexamples, OOS, forward")}</small></span><ChevronRight/><span className="graduate"><b>{t("毕业发布","Graduate")}</b><small>{t("策略库 / 能力库","Strategy / Capability catalog")}</small></span></div>

    {section==="reference"&&<>
      <section className={`cp2KnowledgeNext ${knowledgeNext.tone}`}><div className="cp2KnowledgeNextStage"><small>{t("已导入来源","IMPORTED SOURCES")}</small><b>{importedSources.length}</b></div><div className="cp2KnowledgeNextBody"><small>{t("当前最值得做","RECOMMENDED NEXT")}</small><b>{knowledgeNext.title}</b><p>{knowledgeNext.detail}</p><div><span>{t("可检索","Searchable")} <b>{sourceStages.filter(row=>row.stage>=2).length}</b></span><span>{t("概念","Concepts")} <b>{concepts.length}</b></span><span>{t("待审批规则","Pending rules")} <b>{pendingRules.length}</b></span></div></div><button type="button" onClick={knowledgeNext.run}>{knowledgeNext.action}<ChevronRight/></button></section>
      <div className="cp2KnowledgeTruth"><Info size={15}/><p><b>{t("做到“导入并可检索”，AI 就已经能参考书里的知识。","Once imported and searchable, AI can already reference the source.")}</b>{t("生成扩展候选不是必经步骤；不生成也不影响检索、引用和方法提取。","Generating extension candidates is optional and does not affect retrieval, citation, or method extraction.")}</p></div>
      {sourceStages.length>0&&<section className="cp2KnowledgeSourceStages compact"><header><div><small>SOURCE STATUS</small><b>{t("每份知识当前能做什么","What each source can do now")}</b></div><p>{t("这里只展示检索与结构化状态，不混入策略上岗状态。","Only retrieval and structure status are shown here; strategy deployment is separate.")}</p></header><div>{sourceStages.map(row=><article className={row.tone} key={row.source.id}><div className="cp2KnowledgeSourceHead"><span><BookOpen size={16}/></span><div><b title={localizeText(row.source.title||row.source.name)}>{localizeText(row.source.title||row.source.name)}</b><small>{humanize(row.source.type,t("知识源","Knowledge source"))}</small></div><Pill tone={row.tone}>{row.stage===0?t("需处理","Needs attention"):row.stageLabel}</Pill></div><div className="cp2KnowledgeStageTrack">{[1,2,3].map(stage=><i key={stage} className={stage<=row.stage?"done":""}/>)}</div><div className="cp2KnowledgeSourceEffect"><p>{row.effect}</p></div>{row.canRetry&&<button className="cp2KnowledgeNextButton" type="button" onClick={()=>runSourceNext(row)}>{t("重新解析","Parse again")}<ChevronRight size={13}/></button>}<footer><span>{t("片段","Chunks")} <b>{row.sourceChunks}</b></span><span>{t("概念","Concepts")} <b>{row.sourceConcepts}</b></span><button className="cp2Link" onClick={()=>convert(row.source)}>{t("生成扩展候选（可选）","Optional extensions")}</button></footer></article>)}</div></section>}
      <div className="cp2KnowledgeAtlas"><ConceptCard title={t("概念与知识网络","Concept & Knowledge Network")} meta={`${visibleConcepts.length}/${concepts.length} ${t("个概念","concepts")}`} icon={GitBranch} className="cp2KnowledgeGraphCard" action={graphSources.length>0?<select className="cp2InlineSelect cp2GraphSourceSelect" value={conceptSource} onChange={event=>{setConceptSource(event.target.value);setConceptCategory("all");}}><option value="all">{t("全部知识源","All sources")}</option>{graphSources.map(source=><option key={source.id} value={source.id}>{localizeText(source.title||source.name)}</option>)}</select>:null}><div className="cp2GraphLead"><span>{t("节点越大，关联越多；点击节点查看交易含义。","Larger nodes have more links; select one to inspect its trading meaning.")}</span></div><ConceptGraph concepts={visibleConcepts} maxNodes={40}/></ConceptCard><aside className="cp2KnowledgeAtlasRail"><ConceptCard title={t("知识网络概览","Knowledge Network Overview")}><div className="cp2NetworkStats"><span><b>{visibleConcepts.length}</b><small>{t("概念","Concepts")}</small></span><span><b>{relationCount}</b><small>{t("关系","Links")}</small></span><span><b>{sourceCountForConcepts}</b><small>{t("来源","Sources")}</small></span></div><div className="cp2NetworkCategories"><button className={conceptCategory==="all"?"active":""} onClick={()=>setConceptCategory("all")}>{t("全部","All")} <b>{sourceFilteredConcepts.length}</b></button>{conceptCategories.map(category=><button key={category} className={conceptCategory===category?"active":""} onClick={()=>setConceptCategory(category)}>{localizeText(category)} <b>{sourceFilteredConcepts.filter(item=>(item.category||t("其他","Other"))===category).length}</b></button>)}</div></ConceptCard><ActiveDoctrineCard data={data} compact/></aside></div>
    </>}

    {section==="rules"&&<><div className="cp2KnowledgeTruth"><ShieldCheck size={15}/><p><b>{t("规则是知识对交易产生约束的唯一审批入口。","Rules are the only approval path for knowledge to constrain trading.")}</b>{t("待审批规则不会阻断交易；已批准且可编译的规则进入确定性风控，不可编译的只作为 Agent 提示。","Pending rules never block trades. Approved compilable rules enter deterministic risk control; non-compilable rules remain Agent guidance.")}</p></div><div className="cp2KnowledgeGrid"><ConceptCard title={t("规则状态与实际作用","Rule Status & Actual Effect")} meta={`${approvedRules.length}/${rules.length} ${t("已批准","approved")}`} action={<button className="cp2Link" onClick={()=>ui.openPanel("ruleLibrary")}>{t("管理 / 去重","Manage / dedupe")}</button>}><div className="cp2RuleUsageStats"><span><b>{pendingRules.length}</b><small>{t("待审批","Pending")}</small></span><span><b>{hardRules.length}</b><small>{t("硬拦截","Hard blocks")}</small></span><span><b>{advisoryRules.length}</b><small>{t("仅提示","Advisory")}</small></span></div><ol className="cp2RuleUsageFlow"><li>{t("解析先产生候选纪律。","Parsing first creates candidate discipline.")}</li><li>{t("去重后由 Owner 审批。","Owner approves after deduplication.")}</li><li>{t("运行时展示命中规则与真实动作。","Runtime shows the matched rule and actual action.")}</li></ol></ConceptCard><ConceptCard title={t("规则清单","Rule List")} meta={`${rules.length} ${t("条","")}`}><ConceptTable compact columns={[{key:"name",label:t("规则","Rule"),render:r=>localizeText(r.name)},{key:"status",label:t("审批","Approval"),render:r=><Pill tone={approvedRules.includes(r)?"good":"warn"}>{humanize(r.status,t("待审批","Pending"))}</Pill>},{key:"effect",label:t("运行作用","Runtime effect"),render:r=>r.enforcementStatus==="entry_enforced"?t("确定性拦截","Deterministic block"):approvedRules.includes(r)?t("Agent 提示","Agent guidance"):t("尚不生效","Inactive") }]} rows={rules.slice(0,20)} empty={t("导入资料后会在这里出现候选纪律。","Candidate discipline appears here after import.")}/></ConceptCard></div></>}

    {section==="methods"&&<><div className="cp2KnowledgeTruth"><BarChart3 size={15}/><p><b>{t("方法先留在实验室，验证通过后才进入策略库。","Methods stay in the lab until validation earns Strategy Library publication.")}</b>{t("编译失败或历史验证未通过是实验状态，不是正式策略故障；策略库只展示已毕业版本。","Compile or backtest failures are experiment states, not official strategy failures. Strategy Library shows graduates only.")}</p></div><div className="cp2KnowledgeWorkbench"><ConceptCard title={t("方法孵化队列","Method Incubation Queue")} meta={`${incubatingStrategies.length} ${t("个测试版本","test versions")}`}><div className="cp2ArtifactList">{methods.map(method=>{const skill=latestSkillForMethod(method);const next=skillNextLabel(skill);return <article key={method.id}><header><div><b>{localizeText(method.name)}</b><small>{localizeText(method.source?.title||method.sourceTitle||t("来自已导入知识","From imported knowledge"))}</small></div><Pill tone={skill?.status?.includes("rejected")||skill?.status==="compile_failed"?"bad":skill?.status?.includes("validated")?"good":"neutral"}>{statusLabel(skill)}</Pill></header><p>{[method.entry,method.stop,method.takeProfit].filter(Boolean).slice(0,2).join(" · ")||t("等待提取为可测试条件","Awaiting testable conditions")}</p>{next&&<button className="cp2Link" onClick={()=>skill?runSkillNext(skill):action(`/api/knowledge/methods/${method.id}/compile`,{})}>{next}<ChevronRight size={12}/></button>}</article>})}{!methods.length&&<div className="cp2Empty"><BookOpen/><b>{t("暂无交易方法","No methods yet")}</b><span>{t("知识可检索后，系统会在这里展示提取出的可测试方法。","Testable methods appear here after the source becomes searchable.")}</span></div>}</div></ConceptCard><aside><ConceptCard title={t("已毕业到策略库","Published to Strategy Library")} meta={`${publishedStrategies.length} ${t("项","")}`}><ConceptTable compact columns={[{key:"name",label:t("策略","Strategy")},{key:"version",label:t("版本","Version"),render:r=>`v${r.version||1}`},{key:"status",label:t("状态","Status"),render:()=><Pill tone="good">{t("正式目录","Published")}</Pill>}]} rows={publishedStrategies.slice(0,8)} empty={t("暂无毕业版本；实验结果仍安全地留在本页。","No graduates yet; experiments remain safely on this page.")}/><button className="cp2KnowledgeCatalogLink" onClick={()=>ui.setActive("researchCenter:strategy")}>{t("打开策略库正式目录","Open Strategy Library")}<ChevronRight/></button></ConceptCard>{strategyCandidates.length>0&&<ConceptCard title={t("可选策略扩展候选","Optional Strategy Candidates")}><ConceptTable compact columns={[{key:"name",label:t("候选","Candidate")},{key:"status",label:t("操作","Action"),render:r=>candidateActions(r)}]} rows={strategyCandidates.slice(0,8)}/></ConceptCard>}</aside></div></>}

    {section==="workflows"&&<><div className="cp2KnowledgeTruth"><Wrench size={15}/><p><b>{t("工具、分析透镜和工作流先在这里审批与验证。","Tools, analysis lenses, and workflows are approved and validated here first.")}</b>{t("只有服务端确认当前内容指纹、启用状态和审批记录全部一致，才会发布到能力库并允许 Agent 调用。","Only server-verified content fingerprint, active status, and approval can publish an artifact to Capabilities and make it callable.")}</p></div><div className="cp2KnowledgeWorkbench"><ConceptCard title={t("工具与工作流孵化队列","Tool & Workflow Incubation Queue")} meta={`${workflowCandidates.length+lensCandidates.length+pendingImportedTools.length} ${t("项","")}`} action={<button className="cp2Link" onClick={()=>ui.openPanel("skillImport")}>{t("导入 Skill","Import Skill")}</button>}><ConceptTable compact columns={[{key:"name",label:t("候选","Candidate"),render:r=>localizeText(r.name||r.title)},{key:"type",label:t("类型","Type"),render:r=>humanize(r.type||r.kind)},{key:"status",label:t("状态 / 操作","Status / action"),render:r=>r.type==="workflow"||r.type==="lens"?candidateActions(r):<Pill tone="warn">{t("待扫描与验证","Awaiting scan")}</Pill>}]} rows={[...workflowCandidates,...lensCandidates,...pendingImportedTools].slice(0,20)} empty={t("暂无待孵化的工具或工作流。","No tools or workflows await incubation.")}/></ConceptCard><aside><ConceptCard title={t("已毕业到能力库","Published to Capability Library")} meta={`${workflows.filter(isApprovedKnowledgeWorkflow).length} ${t("项","")}`}><ConceptTable compact columns={[{key:"name",label:t("能力","Capability"),render:r=>localizeText(r.name||r.title)},{key:"type",label:t("类型","Type"),render:()=>t("工作流","Workflow")},{key:"status",label:t("状态","Status"),render:()=><Pill tone="good">{t("运行时已批准","Runtime approved")}</Pill>}]} rows={workflows.filter(isApprovedKnowledgeWorkflow).slice(0,8)} empty={t("暂无已发布能力；未批准内容不会进入 Agent Prompt。","No published capability; unapproved content never enters the Agent prompt.")}/><button className="cp2KnowledgeCatalogLink" onClick={()=>ui.setActive("researchCenter:capabilities")}>{t("打开能力库正式目录","Open Capability Library")}<ChevronRight/></button></ConceptCard></aside></div></>}
  </div>;
}

function InstallCapabilityDialog({ onClose, notify }) {
  const [source,setSource]=useState("github"); const [kind,setKind]=useState("skill"); const [url,setUrl]=useState("");
  const SOURCES=[["github",t("GitHub 仓库", "GitHub repo")],["clawhub","ClawHub"],["cli",t("CLI 工具", "CLI tool")],["mcp",t("MCP 服务", "MCP service")]];
  const KINDS=[["skill",t("Skill 技能", "Skill")],["plugin",t("插件", "Plugin")],["cli","CLI"],["mcp","MCP"]];
  const ph={github:"https://github.com/owner/repo",clawhub:"@scope/skill-name",cli:"npx some-cli  或  brew install some-tool",mcp:"npx -y @modelcontextprotocol/server-…  或  https://…"}[source];
  const submit=()=>{
    if(!url.trim()){notify?.(t("请先填写来源地址/标识", "Enter a source URL/identifier first"));return;}
    // UI 入口:诚实登记为"待接入",后端拉取+沙箱校验+注册链路开发中,绝不假装安装成功
    notify?.(t(`已登记安装请求(${source}·${kind})· 后端安装链路开发中,接入后自动校验并注册`, `Install request registered (${source}·${kind}) · backend install pipeline in progress; auto-verified and registered once available`));
    onClose();
  };
  return <div className="cp2Modal" onClick={onClose}><div className="cp2ModalCard" onClick={e=>e.stopPropagation()}>
    <div className="cp2ModalHead"><b>{t("安装能力", "Install Capability")}</b><button className="cp2ModalX" onClick={onClose}>×</button></div>
    <p className="cp2Intro">{t("从外部来源安装 Skill / 插件 / CLI / MCP。后端拉取与沙箱校验链路开发中,提交后进入待接入队列。", "Install a Skill / plugin / CLI / MCP from an external source. Backend fetch and sandbox verification are in progress; submissions enter a pending queue.")}</p>
    <label className="cp2FieldLabel">{t("来源", "Source")}</label>
    <div className="cp2ChipRow">{SOURCES.map(([id,l])=><button key={id} className={source===id?"active":""} onClick={()=>setSource(id)}>{l}</button>)}</div>
    <label className="cp2FieldLabel">{t("类型", "Type")}</label>
    <div className="cp2ChipRow">{KINDS.map(([id,l])=><button key={id} className={kind===id?"active":""} onClick={()=>setKind(id)}>{l}</button>)}</div>
    <label className="cp2FieldLabel">{t("来源地址 / 标识", "Source URL / identifier")}</label>
    <input className="cp2Input" value={url} onChange={e=>setUrl(e.target.value)} placeholder={ph}/>
    <div className="cp2ModalNote"><AlertTriangle size={12}/> {t("从外部仓库拉取代码执行有安全风险,正式接入将走白名单 + 沙箱校验后再注册。", "Fetching and running code from external repos carries security risk; production onboarding goes through allowlist + sandbox verification before registration.")}</div>
    <div className="cp2ModalFoot"><button className="cp2Secondary" onClick={onClose}>{t("取消", "Cancel")}</button><button className="cp2Primary" onClick={submit}>{t("登记安装", "Register install")}</button></div>
  </div></div>;
}

export function CapabilitiesConcept({ data, action, ui }) {
  // Web 与 App 共用同一目录、去重键、调用统计和健康分类。
  const items = buildCapabilityCatalogRows(data, t);
  const healthLabel=value=>({healthy:t("运行正常","Healthy"),degraded:t("需要检查","Degraded"),blocked:t("最近阻断","Last blocked"),untested:t("未有运行证据","Untested"),not_applicable:t("配置项","Configuration")}[value]||humanize(value));
  const healthTone=value=>value==="healthy"?"good":value==="degraded"?"bad":value==="blocked"?"warn":"neutral";
  // 状态词汇跨中英混用(技能=已启用/已拉取、连接器=configured/missing_credentials、MCP=connected/registered),
  // 判定必须同时认中英,否则按钮(启用/停用)与计数会错。
  const isEnabled=i=>i.enabled;
  const isDisabled=i=>i.disabled;
  const isCandidate=i=>i.candidate;
  const TYPES=[["全部工具",()=>true],["分析工具",i=>/分析|analy|工具|tool/i.test(String(i.kind))&&!/MCP/i.test(String(i.kind))],["工作流",i=>/工作流|workflow|flow/i.test(String(i.kind))],["工具 (MCP)",i=>/MCP/i.test(String(i.kind))]];
  const STATUSES=[["全部状态",()=>true],["已启用",isEnabled],["候选中",isCandidate],["已停用",isDisabled]];
  const [typeF,setTypeF]=useState("全部工具"); const [statusF,setStatusF]=useState("全部状态"); const [detailTab,setDetailTab]=useState("概览"); const [installing,setInstalling]=useState(false); const [q,setQ]=useState("");
  const typeFn=(TYPES.find(t=>t[0]===typeF)||TYPES[0])[1]; const statusFn=(STATUSES.find(s=>s[0]===statusF)||STATUSES[0])[1];
  const shown=items.filter(i=>typeFn(i)&&statusFn(i)&&(!q||String(i.name).toLowerCase().includes(q.toLowerCase())));
  const [selectedId,setSelectedId]=useState(items[0]?.id||""); const selected=shown.find(i=>i.id===selectedId)||items.find(i=>i.id===selectedId)||shown[0]||items[0]||{};
  const selectedGuidance=selected.kind==="MCP"?t("连接与凭证统一在“系统设置”处理；能力库只展示它能否被 Agent 调用。","Manage connection and credentials in System Settings; Capabilities shows whether the agent can call it."):/^tool_/.test(String(selected.id||""))?t("这是交易所/数据连接器；去“系统设置 · OKX 配置”修复连接或凭证。","This is an exchange/data connector. Repair connection or credentials under Settings · OKX."):selected.disabled?t("当前已停用；确认权限和用途后，可在详情底部重新启用。","It is disabled. Review its permissions and purpose, then re-enable it below."):["degraded","blocked"].includes(selected.health)?t("先在“调用日志”查看最近失败或阻断，再按详情底部入口处理；系统不会只给出“待修复”而没有去向。","Open Call log for the last error or block, then use the action below. The page never leaves “needs repair” without a destination."):t("当前没有需要处理的能力故障；调用量与运行健康分别统计。","No capability fault needs attention. Call volume and runtime health are tracked separately.");
  return <div className="cp2Stack">
    <div className="cp2Metrics four"><ConceptMetric label={t("全部工具", "All tools")} value={String(items.length)}/><ConceptMetric label={t("已启用", "Enabled")} value={String(items.filter(isEnabled).length)} tone="good"/><ConceptMetric label={t("候选中", "Candidate")} value={String(items.filter(isCandidate).length)} tone="warn"/><ConceptMetric label={t("已停用", "Disabled")} value={String(items.filter(isDisabled).length)} tone="bad"/></div>
    <div className="cp2CapabilitiesLayout">
      <aside className="cp2SideFilter">
        <b>{t("类型", "Type")}</b>{TYPES.map(([name,fn])=><button key={name} className={typeF===name?"active":""} onClick={()=>setTypeF(name)}>{t(name, {"全部工具":"All tools","分析工具":"Analysis","工作流":"Workflow","工具 (MCP)":"MCP"}[name]||name)}<span>{items.filter(fn).length}</span></button>)}
        <b>{t("状态", "Status")}</b>{STATUSES.map(([name,fn])=><button key={name} className={statusF===name?"active":""} onClick={()=>setStatusF(name)}>{t(name, {"全部状态":"All","已启用":"Enabled","候选中":"Candidate","已停用":"Disabled"}[name]||name)}<span>{items.filter(fn).length}</span></button>)}
      </aside>
      <ConceptCard title={t("工具列表", "Tool List")} meta={`${shown.length}/${items.length} ${t("项", "")} · ${data.analysisEngine?.toolUsageStatsSince?`${t("统计自","since")} ${formatDateTime(data.analysisEngine.toolUsageStatsSince)}`:t("尚未标记统计起点","stats start unknown")}`} className="cp2CapabilityTable" action={<button className="cp2Link" onClick={()=>setInstalling(true)}><Plus size={12}/> {t("安装工具", "Install tool")}</button>}>
        <div className="cp2Search"><Search size={13}/><input className="cp2SearchInput" value={q} onChange={e=>setQ(e.target.value)} placeholder={t("搜索工具名称", "Search tool name")}/></div>
        <div className="cp2ScrollList tall"><ConceptTable onRowClick={r=>setSelectedId(r.id)} activeId={selected.id} columns={[{key:"name",label:t("工具名称", "Tool"),render:r=><button className={`cp2Link ${r.id===selected.id?"on":""}`} onClick={()=>setSelectedId(r.id)}>{localizeText(r.name)}</button>},{key:"kind",label:t("类型", "Type"),render:r=>humanize(r.kind)},{key:"status",label:t("状态", "Status"),render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status,r.enabled===false?t("已停用", "Disabled"):t("可用", "Available"))}</Pill>},{key:"health",label:t("运行健康", "Runtime health"),render:r=><Pill tone={healthTone(r.health)}>{healthLabel(r.health)}</Pill>},{key:"runs",label:t("记录调用", "Recorded calls"),render:r=>r.callMetric==="not_applicable"?"—":r.runs??r.runCount??0}]} rows={shown} empty={t("无匹配工具", "No matching tools")}/></div>
      </ConceptCard>
      <ConceptCard title={t("工具详情", "Tool Detail")} className="cp2CapabilityDetail">
        <div className="cp2CapabilityTitle"><span><Wrench size={18}/></span><div><b>{selected.name?localizeText(selected.name):t("选择工具", "Select a tool")}</b><small>{humanize(selected.kind)}</small></div><Pill tone={toneOf(selected.status)}>{humanize(selected.status,t("可用", "Available"))}</Pill></div>
        <div className={`cp2CapabilityGuidance ${["degraded","blocked"].includes(selected.health)||selected.disabled?"warn":""}`}><Info/><span><b>{["degraded","blocked"].includes(selected.health)||selected.disabled?t("当前处理建议","What to do"):t("当前说明","Current status")}</b><small>{selectedGuidance}</small></span></div>
        <div className="cp2DetailTabs">{["概览","输入输出","调用日志"].map(tab=><button key={tab} className={detailTab===tab?"active":""} onClick={()=>setDetailTab(tab)}>{t(tab, {"概览":"Overview","输入输出":"I/O","调用日志":"Call log"}[tab]||tab)}</button>)}</div>
        {detailTab==="概览"&&<><p>{selected.description||selected.summary?localizeText(selected.description||selected.summary):t("系统工具会在 Agent 工作流中按权限调用。", "System tools are called with permissions inside the agent workflow.")}</p><div className="cp2Kv column"><span>{t("版本", "Version")}<b>{selected.version||"—"}</b></span><span>{t("来源", "Source")}<b>{selected.source||selected.packageName||t("内置", "Built-in")}</b></span><span>{t("权限级别", "Permission")}<b>{humanize(selected.permission||selected.riskLevel,t("受控", "Controlled"))}</b></span><span>{t("最近运行", "Last run")}<b>{formatDateTime(selected.lastRunAt)}</b></span></div></>}
        {detailTab==="输入输出"&&<div className="cp2Kv column"><span>{t("输入", "Input")}<b>{humanize(selected.inputSchema||selected.input,t("未声明", "Undeclared"))}</b></span><span>{t("输出", "Output")}<b>{humanize(selected.outputSchema||selected.output,t("未声明", "Undeclared"))}</b></span><span>{t("参数", "Params")}<b>{Object.keys(selected.parameters||{}).length?`${Object.keys(selected.parameters).length} ${t("项", "")}`:t("未声明", "Undeclared")}</b></span></div>}
        {detailTab==="调用日志"&&<div className="cp2Kv column"><span>{t("运行健康", "Runtime health")}<b>{healthLabel(selected.health)}</b></span><span>{t("记录调用", "Recorded calls")}<b>{selected.callMetric==="not_applicable"?"—":selected.runs??selected.runCount??0}</b></span><span>{t("模型主动 / 系统预检", "Model / preflight")}<b>{selected.usage?.legacyUnsplit?t(`旧记录 ${selected.usage.legacyUnsplitCalls||selected.runs||0} 次未拆分`,`Legacy ${selected.usage.legacyUnsplitCalls||selected.runs||0} calls are unsplit`):`${selected.usage?.sourceCalls?.model||0} / ${selected.usage?.sourceCalls?.preflight||0}`}</b></span><span>{t("系统直接 / 健康评测", "System / evaluation")}<b>{`${selected.usage?.sourceCalls?.system||0} / ${selected.usage?.sourceCalls?.evaluation||selected.evalMetrics?.calls||0}`}</b></span><span>{t("成功 / 阻断 / 失败 / 历史未分类", "Success / blocked / error / legacy unknown")}<b>{selected.usage?`${selected.usage.success||0} / ${selected.usage.blocked||0} / ${selected.usage.error||0} / ${selected.usage.unclassified||0}`:"—"}</b></span><span>{t("最近运行", "Last run")}<b>{formatDateTime(selected.lastRunAt)}</b></span><span>{t("统计说明", "Metric scope")}<b>{selected.callMetric==="not_applicable"?t("配置型连接器不按工具调用计数", "Configuration connectors are not counted as tool calls"):selected.usage?.legacyUnsplit?t("升级前历史记录无法可靠拆分来源或结果；新调用将精确分类", "Legacy call sources or outcomes may be unknown; new calls are classified precisely"):t("调用量与本轮能力覆盖率分开统计", "Call totals are separate from per-run capability coverage")}</b></span></div>}
        {(()=>{const sid=String(selected.id||"");
          if(selected.kind==="MCP") return <button className="cp2Secondary" onClick={()=>ui.notify?.(t("MCP 连接在『系统设置』管理，此处只读展示", "MCP connections are managed in System Settings; read-only here"))}>{t("MCP · 系统设置管理", "MCP · managed in Settings")}</button>;
          if(/^tool_/.test(sid)) return <button className="cp2Secondary" onClick={()=>ui.setActive("systemSettings:exchange")}>{t("去『系统设置 · OKX 配置』", "Open Settings · OKX")}</button>;
          if(selected.native) return isEnabled(selected)
            ? <button className="cp2Secondary" onClick={()=>action(`/api/skills/${sid}/disable`,{})}>{t("停用工具", "Disable tool")}</button>
            : <button className="cp2Primary" onClick={()=>action(`/api/skills/${sid}/enable`,{})}>{t("启用工具", "Enable tool")}</button>;
          return <button className="cp2Secondary" onClick={()=>ui.openPanel("skillImport")}>{t("管理 Skill", "Manage Skill")}</button>;
        })()}
      </ConceptCard>
    </div>
    {installing&&<InstallCapabilityDialog onClose={()=>setInstalling(false)} notify={ui.notify}/>}
  </div>;
}

// 策略库:所有会输出交易主张(方向/入场/止损)的策略——蒸馏产出 / 导入 / LLM 生成,
// 复用能力库同款三栏布局(筛选/列表/详情)保证不溢出、样式统一;底部嵌入回测研究。
function StrategyCatalogConcept({ data, action, ui }) {
  // 策略产品（AI 实盘计划使用）与指标研究模型（回测信号）严格分层，避免把“能产生信号”
  // 误写成“已经有实盘证据的策略”。导入/蒸馏策略仍保留，但不会混入原生产品成绩。
  const productSummary=data.strategyCatalog?.productSummary||{};
  const minForwardTrades=Number(data.paperReport?.minForwardTrades||30);
  const strategyCatalog=buildStrategyCatalogRows(data,t);
  const products=strategyCatalog.products;
  const strategies=strategyCatalog.rows;
  const originLabel=(o)=>t(o, {"策略产品":"Strategy product","指标研究模型":"Research model","蒸馏":"Distilled","LLM/手写":"LLM/Manual","导入":"Imported","其他":"Other"}[o]||o);
  const isActive=s=>s.status==="validated_active"||/^(active|trusted|adopted)$/i.test(String(s.status));
  const isValidating=s=>s.status==="owner_live_observation"||/probation|paper|compiled|pending|trial|validating|candidate|research/i.test(String(s.status));
  const isRetired=s=>/retired|superseded|disabled|compile_failed|replaced|reject/i.test(String(s.status));
  const STATUSES=[["全部",()=>true],["证据达标",isActive],["验证/观察中",isValidating],["已停用",isRetired]];
  const ORIGINS=[["全部类型",()=>true],["策略产品",s=>s.recordType==="product"],["研究模型",s=>s.recordType==="research"],["外部/蒸馏",s=>!["product","research"].includes(s.recordType)]];
  const [statusF,setStatusF]=useState("全部"); const [originF,setOriginF]=useState("全部类型"); const [q,setQ]=useState("");
  const sFn=(STATUSES.find(x=>x[0]===statusF)||STATUSES[0])[1]; const oFn=(ORIGINS.find(x=>x[0]===originF)||ORIGINS[0])[1];
  const shown=strategies.filter(s=>sFn(s)&&oFn(s)&&(!q||String(s.name).toLowerCase().includes(q.toLowerCase())));
  const [selId,setSelId]=useState(strategies[0]?.id||""); const sel=shown.find(s=>s.id===selId)||strategies.find(s=>s.id===selId)||shown[0]||strategies[0]||{};
  const runSelected=()=>{
    if(sel.recordType==="research") return action("/api/strategy/research",{},"POST");
    if(sel.status==="paper_validating") return action("/api/paper/run",{},"POST");
    if(sel.status==="historical_validated") return action(`/api/knowledge/skills/${sel.id}/paper`,{},"POST");
    if(["compiled","historical_rejected","degraded"].includes(sel.status)) return action(`/api/knowledge/skills/${sel.id}/validate`,{},"POST");
    return action("/api/knowledge/skills/sync",{},"POST");
  };
  const runSelectedLabel=sel.status==="paper_validating"?t("推进纯前向验证","Advance forward validation"):sel.status==="historical_validated"?t("启动纯前向验证","Start forward validation"):["compiled","historical_rejected","degraded"].includes(sel.status)?t("运行历史验证","Run historical validation"):sel.recordType==="research"?t("运行指标研究","Run signal research"):t("同步策略状态","Sync strategy state");
  return <div className="cp2Stack">
    <div className="cp2Metrics four"><ConceptMetric label={t("版本化策略产品", "Versioned products")} value={String(productSummary.total??products.length)} sub={t("AI 实盘计划使用", "Used by AI live plans")}/><ConceptMetric label={t("证据达标运行", "Evidence-qualified")} value={String(productSummary.validatedActive??0)} tone="good" sub={t("不是主观评级", "Not a subjective rating")}/><ConceptMetric label={t("实盘观察", "Live observation")} value={String(productSummary.liveObservation??0)} tone="warn" sub={t("明确标记为未验证", "Explicitly unvalidated")}/><ConceptMetric label={t("证据门槛通过", "Evidence gate passed")} value={String(productSummary.evidenceQualified??0)} tone={productSummary.evidenceQualified?"good":"warn"} sub={t("按已平仓版本样本计算", "From version-pinned closed trades")}/></div>
    <div className="cp2StrategyNotice"><ShieldCheck size={17}/><div><b>{t("策略产品与研究模型已分层", "Strategy products and research models are separated")}</b><span>{t("前五个策略产品已进入所有者授权的实盘观察，但在样本、盈亏因子和 R 期望全部达标前，系统不会把它们标成“已验证”。", "The five products are in owner-authorized live observation. None is marked validated until sample, profit-factor and R-expectancy gates all pass.")}</span></div></div>
    <div className="cp2CapabilitiesLayout">
      <aside className="cp2SideFilter">
        <b>{t("状态", "Status")}</b>{STATUSES.map(([name,fn])=><button key={name} className={statusF===name?"active":""} onClick={()=>setStatusF(name)}>{t(name, {"全部":"All","证据达标":"Qualified","验证/观察中":"Validating","已停用":"Retired"}[name]||name)}<span>{strategies.filter(fn).length}</span></button>)}
        <b>{t("类型", "Type")}</b>{ORIGINS.map(([name,fn])=><button key={name} className={originF===name?"active":""} onClick={()=>setOriginF(name)}>{t(name, {"全部类型":"All types","策略产品":"Products","研究模型":"Research models","外部/蒸馏":"External / distilled"}[name]||name)}<span>{strategies.filter(fn).length}</span></button>)}
      </aside>
      <ConceptCard title={t("策略目录", "Strategy Catalog")} meta={`${shown.length}/${strategies.length} ${t("条", "")}`} className="cp2CapabilityTable" action={<button className="cp2Link" onClick={()=>ui.openPanel("skillImport")}><Plus size={12}/> {t("导入研究策略", "Import research strategy")}</button>}>
        <div className="cp2Search"><Search size={13}/><input className="cp2SearchInput" value={q} onChange={e=>setQ(e.target.value)} placeholder={t("搜索策略名称", "Search strategy name")}/></div>
        <div className="cp2ScrollList tall"><ConceptTable onRowClick={r=>setSelId(r.id)} activeId={sel.id} columns={[{key:"name",label:t("策略", "Strategy"),render:r=><button className={`cp2Link ${r.id===sel.id?"on":""}`} onClick={()=>setSelId(r.id)}>{localizeText(r.name)}{r.version&&<small className="cp2VersionTag">v{r.version}</small>}</button>},{key:"dir",label:t("方向·周期", "Side·TF"),render:r=>`${strategyDirectionLabel(r.direction)} · ${r.timeframe||"—"}`},{key:"origin",label:t("类型", "Type"),render:r=>originLabel(r.origin)},{key:"status",label:t("状态", "Status"),render:r=><Pill tone={r.recordType==="product"?productStateTone(r.status):skillStatusTone(r.status)}>{r.recordType==="product"?productStateLabel(r.status):skillStatusLabel(r.status)}</Pill>},{key:"pf",label:t("PF", "PF"),render:r=>r.profitFactor??r.backtest?.profitFactor??"—"}]} rows={shown} empty={t("无匹配策略", "No matching strategies")}/></div>
      </ConceptCard>
      <ConceptCard title={t("策略详情", "Strategy Detail")} className="cp2CapabilityDetail">
        <div className="cp2CapabilityTitle"><span><Activity size={18}/></span><div><b>{sel.name?localizeText(sel.name):t("选择策略", "Select a strategy")}</b><small>{[sel.version&&`v${sel.version}`,sel.direction&&strategyDirectionLabel(sel.direction),sel.timeframe].filter(Boolean).join(" · ")||"—"}</small></div>{sel.status&&<Pill tone={sel.recordType==="product"?productStateTone(sel.status):skillStatusTone(sel.status)}>{sel.recordType==="product"?productStateLabel(sel.status):skillStatusLabel(sel.status)}</Pill>}</div>
        <p>{sel.entry||sel.description||sel.summary?localizeText(sel.entry||sel.description||sel.summary):t("选择一条策略查看其进场/止损/止盈逻辑与验证状态。", "Select a strategy to view its entry / stop-loss / take-profit logic and validation status.")}</p>
        {sel.recordType==="product"?<>
          <div className="cp2StrategyProof"><span><small>{t("计划", "Plans")}</small><b>{sel.metrics?.plans??0}</b></span><span><small>{t("已平仓", "Closed")}</small><b>{sel.metrics?.closedTrades??0}</b></span><span><small>{t("胜率", "Win rate")}</small><b>{sel.winRatePct!=null?`${sel.winRatePct}%`:"—"}</b></span><span><small>PF</small><b>{sel.profitFactor??"—"}</b></span><span><small>{t("净结果", "Net PnL")}</small><b>{sel.metrics?.netPnlUsdt==null?"—":`${money(sel.metrics.netPnlUsdt)} U`}</b></span></div>
          <b className="cp2DetailLabel">{t("执行流程（策略定义）", "Execution flow (contract)")}</b>
          <div className="cp2StrategyFlow">{sel.stages.map((stage,index)=><React.Fragment key={stage.id||index}><article><i>{index+1}</i><b>{localizeText(stage.label)}</b><small>{arr(stage.evidence).map(localizeText).join(" · ")}</small></article>{index<sel.stages.length-1&&<ChevronRight/>}</React.Fragment>)}</div>
          <b className="cp2DetailLabel">{t("证据晋级门槛", "Evidence promotion gate")}</b>
          <div className="cp2EvidenceChecks">{arr(sel.evidence?.checks).map(check=><span className={check.passed?"pass":"wait"} key={check.key}>{check.passed?<CheckCircle2/>:<Clock3/>}<b>{productEvidenceLabel(check.key)}</b><small>{String(check.actual??"—")} / {String(check.required)}</small></span>)}</div>
          <div className="cp2Kv column"><span>{t("当前依据", "Current basis")}<b>{localizeText(sel.lifecycleReason||"—")}</b></span><span>{t("版本最大回撤", "Version max drawdown")}<b>{sel.metrics?.maxDrawdownPct!=null?`${sel.metrics.maxDrawdownPct}%`:sel.metrics?.maxDrawdownUsdt!=null?`${money(sel.metrics.maxDrawdownUsdt)} U`:"—"}</b></span><span>{t("适用市场", "Applicable regimes")}<b>{sel.regimes.map(localizeText).join(t("、",", "))||"—"}</b></span><span>{t("失效条件", "Invalidation")}<b>{sel.invalidations.map(localizeText).join(t("；","; "))||"—"}</b></span><span>{t("版本指纹", "Version fingerprint")}<b className="cp2Hash">{sel.contentHash?.slice(0,16)||"—"}…</b></span></div>
        </>:<>
          {sel.status==="paper_validating"&&<div className="cp2ForwardProgress">
            <div><span>{t("纯前向模拟进度", "Pure forward progress")}</span><b>{sel.paperSession?.metrics?.trades??0} / {minForwardTrades} {t("笔已完成交易", "closed trades")}</b></div>
            <progress max={minForwardTrades} value={Math.min(minForwardTrades,Number(sel.paperSession?.metrics?.trades||0))}/>
            <small>{sel.paperSession?.paperPosition?t(`当前有一笔模拟${sel.paperSession.direction==="short"?"空":"多"}仓尚未平仓；只有平仓后才计入进度。`,`One simulated ${sel.paperSession.direction==="short"?"short":"long"} position is open. Progress increases only after it closes.`):t("当前没有未平模拟仓；等待策略产生并完成下一笔交易。", "No simulated position is open; waiting for the next complete trade.")}</small>
          </div>}
          <div className="cp2Kv column"><span>{t("类型", "Type")}<b>{sel.origin?originLabel(sel.origin):"—"}</b></span><span>{t("模型家族", "Model family")}<b>{humanize(sel.template,"—")}</b></span><span>{t("研究阶段", "Research stage")}<b>{skillStatusLabel(sel.status||sel.backtestStatus)}</b></span>{sel.lifecycleReason&&<span>{t("阶段依据", "Stage basis")}<b>{localizeText(sel.lifecycleReason)}</b></span>}<span>{t("真实归因样本", "Attributed live samples")}<b>{sel.liveTrades??"—"}</b></span><span>{t("盈亏因子", "Profit factor")}<b>{sel.profitFactor??sel.backtest?.profitFactor??"—"}</b></span></div>
          <button className="cp2Secondary" onClick={runSelected}><Play size={12}/> {runSelectedLabel}</button>
        </>}
      </ConceptCard>
    </div>
  </div>;
}

const STUDIO_STATUS={compiled:["已编译","Compiled"],tests_passed:["自动测试通过","Tests passed"],tests_failed:["自动测试未通过","Tests failed"],backtest_passed:["样本外回测通过","OOS passed"],backtest_failed:["样本外回测未通过","OOS failed"],published:["已发布","Published"]};
const studioStatusLabel=(value)=>{const pair=STUDIO_STATUS[value];return pair?t(pair[0],pair[1]):humanize(value,"—");};
const studioStatusTone=(value)=>/published|backtest_passed/.test(String(value))?"good":/failed/.test(String(value))?"bad":"warn";

function StrategyStudioConcept({ data, action }) {
  const studio=data.strategyStudio||{};
  const drafts=arr(studio.drafts);
  const [prompt,setPrompt]=useState("");
  const [selectedId,setSelectedId]=useState(drafts[0]?.id||"");
  const selected=drafts.find(row=>row.id===selectedId)||drafts[0]||{};
  const blueprint=selected.blueprint||{};
  const latestBt=arr(studio.backtests).find(row=>row.id===selected.latestBacktestId);
  const generate=async()=>{
    if(prompt.trim().length<12) return;
    const result=await action("/api/strategy/studio/drafts",{prompt},"POST");
    if(result?.draft?.id){setSelectedId(result.draft.id);setPrompt("");if(result.suite?.status==="passed") await action(`/api/strategy/studio/drafts/${result.draft.id}/backtest`,{},"POST");}
  };
  return <div className="cp2Stack">
    <div className="cp2StrategyNotice"><Sparkles size={17}/><div><b>{t("自然语言只负责表达，确定性编译器负责执行", "Natural language describes intent; the deterministic compiler defines execution")}</b><span>{t("系统只编译到白名单信号模板，自动检查参数、未来数据隔离、成本与风控合同。生成草稿不会直接启动实盘。", "The system compiles only to allowlisted signal templates and checks parameters, look-ahead isolation, costs, and risk contracts. Creating a draft never starts live trading.")}</span></div></div>
    <div className="cp2StudioGrid">
      <ConceptCard title={t("用自然语言创建策略", "Create from natural language")} meta={t("草稿，不会下单", "Draft only") }>
        <textarea className="cp2StrategyPrompt" value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder={t("例如：ADA/USDT 1小时，RSI 14 从30下方重新站上30时做多，止损2%，止盈2.5R。", "Example: Long ADA/USDT on 1h when RSI(14) crosses back above 30; 2% stop and 2.5R target.")}/>
        <div className="cp2PromptHints"><span>{t("建议写清", "Include")}</span><b>{t("交易对 · 周期 · 多空方向 · 入场规则 · 止损 · 止盈", "Symbol · timeframe · side · entry · stop · target")}</b></div>
        <button className="cp2Primary" disabled={prompt.trim().length<12} onClick={generate}><Sparkles size={13}/> {t("生成、测试并自动回测", "Generate, test, and backtest")}</button>
      </ConceptCard>
      <ConceptCard title={t("策略草稿", "Strategy drafts")} meta={`${drafts.length}`}>
        <div className="cp2DraftList">{drafts.length?drafts.slice(0,20).map(row=><button key={row.id} className={row.id===selected.id?"active":""} onClick={()=>setSelectedId(row.id)}><span><b>{localizeText(row.blueprint?.name)}</b><small>{row.authoring?.channel==="agent_chat"?t("AI 对话创建","Created in AI chat"):t("工作室创建","Created in Studio")} · {row.blueprint?.symbols?.join(" / ")} · {row.blueprint?.timeframe} · {humanize(row.blueprint?.direction)}</small></span><Pill tone={studioStatusTone(row.status)}>{studioStatusLabel(row.status)}</Pill></button>):<div className="cp2Empty"><Sparkles/><b>{t("还没有策略草稿", "No strategy drafts yet")}</b><span>{t("左侧描述第一条策略。", "Describe your first strategy on the left.")}</span></div>}</div>
      </ConceptCard>
    </div>
    {selected.id&&<div className="cp2StudioDetail">
      <ConceptCard title={t("系统理解的可执行规则", "Compiled execution rules")} action={<Pill tone={studioStatusTone(selected.status)}>{studioStatusLabel(selected.status)}</Pill>}>
        <div className="cp2StrategyProof"><span><small>{t("信号模板", "Signal model")}</small><b>{t(blueprint.templateName||"—",blueprint.templateNameEn||blueprint.templateName||"—")}</b></span><span><small>{t("交易范围", "Universe")}</small><b>{arr(blueprint.symbols).join(" / ")||"—"}</b></span><span><small>{t("周期 / 方向", "Timeframe / side")}</small><b>{blueprint.timeframe} · {humanize(blueprint.direction)}</b></span><span><small>{t("止损 / 止盈", "Stop / target")}</small><b>{blueprint.exitPolicy?.stopLossPct}% · {blueprint.exitPolicy?.takeProfitR}R</b></span><span><small>{t("基础策略产品", "Base product")}</small><b>{humanize(blueprint.baseProductId)}</b></span></div>
        <div className="cp2Kv column"><span>{t("入场参数", "Entry parameters")}<b>{JSON.stringify(blueprint.params||{})}</b></span><span>{t("成本假设", "Cost assumptions")}<b>{t(`手续费 ${blueprint.costs?.feePct}% · 滑点 ${blueprint.costs?.slippagePct}% · 资金费率/8h ${blueprint.costs?.fundingPct8h}%`,`Fee ${blueprint.costs?.feePct}% · slippage ${blueprint.costs?.slippagePct}% · funding/8h ${blueprint.costs?.fundingPct8h}%`)}</b></span><span>{t("版本指纹", "Draft fingerprint")}<b className="cp2Hash">{selected.contentHash?.slice(0,20)}…</b></span></div>
      </ConceptCard>
      <ConceptCard title={t("自动生成的测试", "Generated tests")} meta={`${selected.generatedTests?.passed||0}/${selected.generatedTests?.total||0}`}>
        <div className="cp2GeneratedTests">{arr(selected.generatedTests?.tests).map(test=><div key={test.id} className={test.passed?"pass":"fail"}>{test.passed?<CheckCircle2/>:<AlertTriangle/>}<span><b>{t(test.name,test.nameEn||test.name)}</b><small>{t(test.detail,test.detailEn||test.detail)}</small></span></div>)}</div>
        <button className="cp2Secondary" onClick={()=>action(`/api/strategy/studio/drafts/${selected.id}/tests`,{},"POST")}><RefreshCw size={12}/> {t("重新运行自动测试", "Re-run generated tests")}</button>
      </ConceptCard>
      <ConceptCard title={t("样本外回测证据", "Out-of-sample evidence")} action={latestBt&&<Pill tone={latestBt.passed?"good":"bad"}>{latestBt.passed?t("通过","Passed"):t("未通过","Failed")}</Pill>}>
        {latestBt?<><div className="cp2StrategyProof"><span><small>{t("样本外交易", "OOS trades")}</small><b>{latestBt.oos?.trades??0}</b></span><span><small>{t("样本外期望", "OOS expectancy")}</small><b>{latestBt.oos?.expectancyR??"—"}R</b></span><span><small>{t("盈亏因子", "Profit factor")}</small><b>{latestBt.oos?.profitFactor??"—"}</b></span><span><small>{t("最大回撤", "Max drawdown")}</small><b>{latestBt.oos?.maxDrawdownPct??"—"}%</b></span><span><small>{t("正向分段", "Positive folds")}</small><b>{latestBt.positiveFolds}/{latestBt.activeFolds}</b></span></div><MiniLine values={arr(latestBt.oos?.equityCurve)} height={100}/><small className="cp2MethodNote">{localizeText(latestBt.methodology)} · purge {latestBt.purgeBars} · embargo {latestBt.embargoBars}</small></>:<div className="cp2Empty"><BarChart3/><b>{t("尚未运行历史回测", "Historical backtest not run")}</b><span>{t("自动测试通过后，用 OKX 历史收盘 K 线运行训练段与三段样本外验证。", "After generated tests pass, use OKX closed candles for training and three OOS folds.")}</span></div>}
        <div className="cp2ButtonRow"><button className="cp2Primary" disabled={selected.generatedTests?.status!=="passed"} onClick={()=>action(`/api/strategy/studio/drafts/${selected.id}/backtest`,{},"POST")}><Play size={12}/> {t("运行样本外回测", "Run OOS backtest")}</button><button className="cp2Secondary" disabled={!latestBt?.passed||Boolean(selected.publishVersionId)} onClick={()=>action(`/api/strategy/studio/drafts/${selected.id}/publish`,{},"POST")}><Plus size={12}/> {selected.publishVersionId?t("已发布到市场","Published"):t("发布到内部市场","Publish internally")}</button></div>
      </ConceptCard>
    </div>}
  </div>;
}

function StrategyMarketplaceConcept({ data, action }) {
  const market=data.strategyStudio?.marketplace||{};
  const listings=arr(market.listings);
  const [source,setSource]=useState("all");
  const shown=listings.filter(row=>source==="all"||row.source===source);
  return <div className="cp2Stack">
    <div className="cp2Metrics four"><ConceptMetric label={t("市场策略", "Market strategies")} value={String(market.summary?.total??0)}/><ConceptMetric label={t("官方策略", "Official")} value={String(market.summary?.official??0)}/><ConceptMetric label={t("工作室发布", "Studio-published")} value={String(market.summary?.studio??0)}/><ConceptMetric label={t("当前启用", "Enabled")} value={String(market.summary?.enabled??0)} tone="good"/></div>
    <div className="cp2StrategyNotice"><ShieldCheck/><div><b>{t("这是系统内部策略目录，不依赖对外 MCP", "This is an internal strategy catalog and does not depend on external MCP")}</b><span>{t("启用只代表策略进入 AI 可选集；每笔计划仍必须匹配实时结构、绑定不可变版本，并通过账户容量、授权和全部硬风控。", "Enabling only makes a strategy eligible for AI selection. Every plan must still match live structure, pin an immutable version, and pass capacity, mandate, and all hard-risk checks.")}</span></div></div>
    <div className="cp2MarketFilters"><button className={source==="all"?"active":""} onClick={()=>setSource("all")}>{t("全部", "All")}</button><button className={source==="official"?"active":""} onClick={()=>setSource("official")}>{t("官方", "Official")}</button><button className={source==="strategy_studio"?"active":""} onClick={()=>setSource("strategy_studio")}>{t("我的工作室", "My studio")}</button></div>
    <div className="cp2MarketplaceGrid">{shown.map(row=>{const def=row.definition||{};const oos=row.validation?.oos;return <ConceptCard key={row.id} title={t(row.title||def.name,row.titleEn||def.name||row.title)} action={<Pill tone={row.evidenceLevel==="live_validated"?"good":"warn"}>{row.evidenceLevel==="live_validated"?t("实盘证据达标","Live-validated"):row.evidenceLevel==="oos_passed"?t("样本外通过","OOS passed"):t("实盘观察中","Live observation")}</Pill>}>
      <p>{t(row.summary||def.description,row.summaryEn||row.summary||def.description)}</p>
      <div className="cp2MarketplaceTags">{arr(row.tags).slice(0,6).map(tag=><span key={tag}>{humanize(tag)}</span>)}</div>
      <div className="cp2Kv column"><span>{t("版本", "Version")}<b>{row.strategyVersionId}</b></span><span>{t("方向 / 周期", "Side / timeframe")}<b>{humanize(def.direction)} · {arr(def.timeframes).join("/")||def.timeframe||"—"}</b></span><span>{t("证据", "Evidence")}<b>{row.source==="official"?`${row.metrics?.closedTrades??0} ${t("笔实盘平仓","live closes")}`:`${oos?.trades??0} ${t("笔样本外交易","OOS trades")} · ${oos?.expectancyR??"—"}R`}</b></span>{row.source!=="official"&&<span>{t("当前信号", "Current signal")}<b>{Object.entries(row.runtimeBySymbol||{}).map(([symbol,runtime])=>`${symbol} ${runtime.ready?t("已触发","ready"):t("未就绪","not ready")}`).join(" · ")||"—"}</b></span>}<span>{t("不可变指纹", "Immutable fingerprint")}<b className="cp2Hash">{row.contentHash?.slice(0,16)}…</b></span></div>
      {row.source==="official"?<button className="cp2Secondary" disabled>{row.enabled?t("系统当前可用","Available to system"):t("当前已暂停","Paused")}</button>:<button className={row.enabled?"cp2Secondary":"cp2Primary"} onClick={()=>action(`/api/strategy/market/${encodeURIComponent(row.strategyVersionId)}/${row.enabled?"disable":"enable"}`,{},"POST")}>{row.enabled?t("从 AI 可选集移除","Remove from AI set"):t("加入 AI 可选集","Add to AI set")}</button>}
    </ConceptCard>;})}</div>
  </div>;
}

export function StrategyLibraryConcept({ data, action, ui, initialTab = "catalog" }) {
  const [tab,setTab]=useState(initialTab);
  const tabs=[["catalog",t("策略目录","Catalog")],["studio",t("策略工作室","Strategy Studio")],["market",t("内部策略市场","Internal Market")],["research",t("回测研究","Backtest Research")]];
  return <div className="cp2Stack"><div className="cp2StrategyTabs">{tabs.map(([key,label])=><button key={key} className={tab===key?"active":""} onClick={()=>setTab(key)}>{label}</button>)}</div>{tab==="catalog"?<StrategyCatalogConcept data={data} action={action} ui={ui}/>:tab==="studio"?<StrategyStudioConcept data={data} action={action}/>:tab==="market"?<StrategyMarketplaceConcept data={data} action={action}/>:<StrategyConcept data={data} action={action}/>}</div>;
}

const RESEARCH_EVIDENCE_LABELS={historical_backtest:["历史回测","Historical backtest"],optimizer_oos:["自动研究 · 样本外","Automated research · OOS"],studio_oos:["策略工作室 · 样本外","Strategy Studio · OOS"],forward_paper:["纯前向模拟","Pure forward simulation"]};
const researchEvidenceLabel=(value)=>{const pair=RESEARCH_EVIDENCE_LABELS[value];return pair?t(pair[0],pair[1]):humanize(value,"—");};
const researchStatusLabel=(value)=>({validated:t("高置信样本外","High-confidence OOS"),oos_ok:t("样本外通过","OOS passed"),completed:t("已完成","Completed"),ok:t("已完成","Completed"),failed:t("未通过","Failed"),no_qualified_strategy:t("无合格策略","No qualified strategy"),running:t("验证中","Validating"),passed:t("已通过","Passed")}[value]||humanize(value,"—"));

export function StrategyConcept({ data, action }) {
  const research=data.backtestResearch||{};
  const historical=arr(research.historical).length?arr(research.historical):arr(data.backtests).map((row,index)=>({...row,id:row.id||`legacy-${index}`,name:row.name||row.strategyName||row.strategy||`${t("回测","Backtest")} ${index+1}`,evidenceType:row.kind==="strategy_blueprint"?"studio_oos":"historical_backtest",parameters:row.parameters||row.params||{}}));
  const forward=arr(research.forward);
  const summary=research.summary||{};
  const [selectedId,setSelectedId]=useState(historical[0]?.id||"");
  useEffect(()=>{if(historical.length&&!historical.some(row=>row.id===selectedId))setSelectedId(historical[0].id);},[historical,selectedId]);
  const active=historical.find(row=>row.id===selectedId)||historical[0]||null;
  const equity=arr(active?.equityCurve).map(item=>typeof item==="object"?(item.value??item.equity):item);
  const drawdown=arr(active?.drawdownCurve).map(item=>typeof item==="object"?(item.value??item.drawdown):item);
  const folds=arr(active?.folds).map((fold,index)=>({id:`fold-${index}`,name:`${t("分段","Fold")} ${index+1}`,trades:fold.trades,expectancyR:fold.expectancyR,profitFactor:fold.profitFactor,maxDrawdownPct:fold.maxDrawdownPct}));
  const statusTone=active?.passed===false||/failed|no_qualified/.test(String(active?.status))?"bad":/running|ok/.test(String(active?.status))?"warn":"good";
  return <div className="cp2Stack">
    <div className="cp2ResearchSummary">
      <div><small>{t("历史证据","Historical evidence")}</small><b>{summary.totalHistoricalEvidence??historical.length}</b></div>
      <div><small>{t("自动样本外","Automated OOS")}</small><b>{summary.optimizerOos??historical.filter(row=>row.evidenceType==="optimizer_oos").length}</b></div>
      <div><small>{t("工作室样本外","Studio OOS")}</small><b>{summary.studioOos??historical.filter(row=>row.evidenceType==="studio_oos").length}</b></div>
      <div><small>{t("纯前向验证中","Forward validating")}</small><b>{summary.forwardRunning??forward.filter(row=>row.status==="running").length}</b></div>
    </div>
    <div className="cp2StrategyToolbar cp2ResearchToolbar">
      <select value={active?.id||""} onChange={event=>setSelectedId(event.target.value)} disabled={!historical.length}>{historical.length?historical.map(row=><option key={row.id} value={row.id}>{researchEvidenceLabel(row.evidenceType)} · {localizeText(row.name)}</option>):<option>{t("暂无历史研究证据","No historical research evidence")}</option>}</select>
      {active?<><Pill tone={statusTone}>{researchStatusLabel(active.status)}</Pill><span>{active.symbol||"—"} · {active.timeframe||"—"} · {active.direction?t(active.direction==="short"?"做空":"做多",active.direction):"—"}</span><span className="cp2ResearchTime">{active.createdAt?formatDateTime(active.createdAt):t("时间未记录","Time unavailable")}</span></>:<span>{t("运行自动研究或在策略工作室完成样本外回测后，这里会形成可核验记录。","Run automated research or complete a Strategy Studio OOS backtest to create verifiable evidence here.")}</span>}
      <button className="cp2Primary" onClick={()=>action("/api/strategy/research",{},"POST")}><Play size={13}/> {t("运行自动研究","Run automated research")}</button>
    </div>
    {active?<>
      <div className="cp2ResearchEvidenceHead"><div><small>{t("证据类型","Evidence type")}</small><b>{researchEvidenceLabel(active.evidenceType)}</b></div><div><small>{t("方法","Method")}</small><b>{localizeText(active.methodology||t("统一成本模型下的历史验证","Historical validation with the unified cost model"))}</b></div><div><small>{t("样本","Sample")}</small><b>{active.trades??"—"} {t("笔交易","trades")}</b></div></div>
      <div className="cp2StrategyLayout cp2ResearchLayout"><ConceptCard title={t("样本表现","Sample Performance")}><div className="cp2Metrics two compact"><ConceptMetric label={t("累计收益","Total return")} value={displayPct(active.totalReturnPct,"—")} tone={num(active.totalReturnPct)>=0?"good":"bad"}/><ConceptMetric label={t("R 期望","R expectancy")} value={active.expectancyR==null?"—":`${active.expectancyR}R`} tone={num(active.expectancyR)>=0?"good":"bad"}/><ConceptMetric label={t("盈亏因子","Profit factor")} value={active.profitFactor??"—"}/><ConceptMetric label={t("最大回撤","Max drawdown")} value={active.maxDrawdownPct==null?"—":`${active.maxDrawdownPct}%`} tone="bad"/></div><MiniLine values={equity} height={145}/></ConceptCard>
        <ConceptCard title={t("回撤与置信","Drawdown & Confidence")}><MiniLine values={drawdown} tone="orange" height={120}/><div className="cp2Kv column"><span>{t("胜率","Win rate")}<b>{active.winRatePct==null?"—":`${active.winRatePct}%`}</b></span><span>{t("90%置信下界","90% lower bound")}<b>{active.expectancyLower90R==null?"—":`${active.expectancyLower90R}R`}</b></span><span>{t("正向样本外分段","Positive OOS folds")}<b>{active.positiveFolds==null?"—":`${active.positiveFolds}/${active.activeFolds??"—"}`}</b></span><span>{t("市场状态","Market regime")}<b>{localizeText(active.regime||"—")}</b></span></div></ConceptCard>
        <ConceptCard title={t("策略参数","Parameters")}><div className="cp2Kv column">{Object.entries(active.parameters||{}).slice(0,10).map(([key,value])=><span key={key}>{humanize(key)}<b>{String(value)}</b></span>)}{!Object.keys(active.parameters||{}).length&&<span>{t("参数记录","Parameter record")}<b>{t("未提供","Unavailable")}</b></span>}</div></ConceptCard>
      </div>
      <div className="cp2Grid cp2ResearchBottom"><ConceptCard title={t("样本外分段","Out-of-sample Folds")}><ConceptTable compact columns={[{key:"name",label:t("分段","Fold")},{key:"trades",label:t("交易","Trades"),render:row=>row.trades??"—"},{key:"expectancy",label:t("期望","Expectancy"),render:row=>row.expectancyR==null?"—":`${row.expectancyR}R`},{key:"pf",label:"PF",render:row=>row.profitFactor??"—"},{key:"dd",label:t("回撤","Drawdown"),render:row=>row.maxDrawdownPct==null?"—":`${row.maxDrawdownPct}%` }]} rows={folds} empty={t("该证据没有独立分段记录","No separate fold records for this evidence")}/></ConceptCard>
        <ConceptCard title={t("纯前向模拟 · 独立证据","Pure Forward Simulation · Separate Evidence")} meta={t("不会冒充历史回测","Never counted as historical backtest")}><div className="cp2ForwardResearchList">{forward.slice(0,9).map(row=><div key={row.id}><span><b>{localizeText(row.name)}</b><small>{row.timeframe||"—"} · {row.seeded?t("历史预热（不计纯前向证据）","Seeded warm-up (not pure-forward evidence)"):t("纯前向","Pure forward")}{row.openPosition?` · ${t("持仓进行中","position open")}`:""}</small></span><em>{row.completedTrades}/{row.minimumTrades}</em><progress max="100" value={row.progressPct}/><Pill tone={row.status==="passed"?"good":row.status==="failed"?"bad":"warn"}>{researchStatusLabel(row.status)}</Pill></div>)}{!forward.length&&<div className="cp2Empty"><Activity/><b>{t("暂无纯前向会话","No pure-forward sessions")}</b><span>{t("自动研究选出合格策略后会创建模拟会话。","Qualifying automated research creates paper sessions.")}</span></div>}</div></ConceptCard>
      </div>
    </>:<ConceptCard title={t("回测研究","Backtest Research")}><div className="cp2Empty"><BarChart3/><b>{t("尚无历史研究证据","No historical research evidence yet")}</b><span>{t("这里不会用占位曲线或模拟数字填充。点击“运行自动研究”后，真实OKX收盘K线样本外结果会显示在这里。","No placeholder curves or simulated metrics are shown. Run automated research to populate real OOS results from closed OKX candles.")}</span></div></ConceptCard>}
  </div>;
}

export function RiskPostureConcept({ data, ui }) {
  const pf=data.portfolio||{}; const pr=data.portfolioRisk||{}; const mandate=data.agentStatus?.activeMandate||arr(data.mandates)[0]||{}; const rules=arr(data.riskRules); const incidents=arr(data.riskIncidents); const openIncidents=incidents.filter(i=>i.status==="open"); const eventWindows=arr(data.eventRiskWindows); const blockingWindows=eventWindows.filter(item=>item.blocking);
  const runtime=automationPresentation(data);
  const eventPhase=(row)=>row.phase==="pre_release_blackout"?t("公布前静默", "Pre-release blackout"):row.phase==="post_release"?t("公布后观察", "Post-release window"):row.phase==="time_unconfirmed"?t("时间待确认", "Time unconfirmed"):t("提前监控", "Monitoring");
  const eventTiming=(row)=>{const minutes=Math.round(Math.abs(Number(row.deltaMs)||0)/60000);if(row.phase==="post_release")return t(`已公布 ${minutes} 分钟`,`Released ${minutes} min ago`);if(row.phase==="time_unconfirmed")return t("仅日期，不触发分钟级硬闸","Date only; no minute-level hard gate");return t(`${minutes} 分钟后`,`In ${minutes} min`);};
  // 字段名兼容(同 MandateConcept):后端存 max_leverage/validUntil,旧驼峰读不到 → 回退兼容,否则杠杆/有效期显示"—"。
  const mandMaxLev=mandate.maxLeverage??mandate.max_leverage; const mandExpires=mandate.expiresAt??mandate.validUntil??mandate.valid_until;
  const mandWeekLoss=mandate.maxWeeklyLossPct??mandate.max_weekly_loss_pct??5;
  return <div className="cp2Stack riskCommandPage"><section className="riskOperatingBoard"><div className={`cp2RiskBanner ${runtime.tone}`} title={runtime.detail}><ShieldCheck size={24}/><div className="riskRuntimeLead"><small>{t("当前风险姿态", "CURRENT RISK POSTURE")}</small><b>{runtime.label}</b><em>{runtime.detail}</em></div><span>{t("新开仓", "New entries")} <strong>{runtime.entryPolicy}</strong></span><span>{t("今日剩余预算", "Budget left today")} <strong>{data.system?.remainingDailyLossUsdt==null?t("未授权", "Not authorized"):`${money(data.system.remainingDailyLossUsdt)} U`}</strong></span><span>{t("账户同步", "Account sync")} <strong>{pf.totalEquityUsdt?t("已同步", "Synced"):t("待同步", "Pending")}</strong></span><span>{t("事件窗口", "Event windows")} <strong>{blockingWindows.length}/{eventWindows.length}</strong></span><span>{t("待处理告警", "Open incidents")} <strong>{openIncidents.length}</strong></span><button onClick={()=>ui.openPanel("riskIncidents")}>{t("查看告警", "Incidents")}</button></div>
    <div className="cp2Grid two riskCards"><ConceptCard title={t("组合风险", "Portfolio Risk")}><div className="riskExposureHero"><Donut value={num(pr.leverageUtilizationPct)} label={displayPct(pr.leverageUtilizationPct,"—")} sub={t("杠杆利用", "Leverage used")}/><div><small>{t("总敞口", "Total exposure")}</small><b>{pr.totalExposureUsdt==null?"—":`${money(pr.totalExposureUsdt)} U`}</b><span>{t("最大回撤", "Max drawdown")} {displayPct(pf.maxDrawdownPct,"—")}</span></div></div><div className="cp2Kv column"><span>{t("相关性风险", "Correlation risk")}<b>{humanize(pr.correlationRisk,t("待评估", "TBD"))}</b></span><span>{t("组合状态", "Portfolio state")}<b>{openIncidents.length?t(`${openIncidents.length} 项需关注`,`${openIncidents.length} need attention`):t("无开放事故", "No open incidents")}</b></span></div><MiniLine height={65}/></ConceptCard>
      <ConceptCard title={t("交易权限限制", "Trading Permission Limits")}><div className="cp2Kv column"><span>{t("允许交易", "Allowed pairs")}<b>{arr(mandate.allowedSymbols).join(t("、", ", "))||t("未授权", "None")}</b></span><span>{t("杠杆范围", "Leverage range")}<b>{mandMaxLev?`1x – ${mandMaxLev}x`:"—"}</b></span><span>{t("单笔风险", "Per-trade risk")}<b>{mandate.maxSingleTradeRiskPct==null?"—":`${mandate.maxSingleTradeRiskPct}%`}</b></span><span>{t("单日亏损上限", "Daily loss limit")}<b>{mandate.maxDailyLossPct==null?"—":`${mandate.maxDailyLossPct}%`}</b></span><span>{t("近7日亏损上限", "Rolling 7-day loss limit")}<b>{mandate.id?`${mandWeekLoss}%`:"—"}</b></span><span>{t("权限有效期", "Permission expiry")}<b>{formatDateTime(mandExpires)}</b></span></div></ConceptCard>
    </div></section>
    <div className="cp2Grid two"><ConceptCard title={t("风险规则", "Risk Rules")}><ConceptTable compact columns={[{key:"name",label:t("规则", "Rule"),render:r=>localizeText(r.name)},{key:"scope",label:t("范围", "Scope"),render:r=>humanize(r.scope)},{key:"level",label:t("级别", "Level")},{key:"enabled",label:t("状态", "Status"),render:r=><Pill tone={r.enabled===false?"warn":"good"}>{r.enabled===false?t("停用", "Off"):t("启用", "On")}</Pill>}]} rows={rules.slice(0,7)} empty={t("暂无风险规则", "No risk rules")}/></ConceptCard><ConceptCard title={t("事件风险窗口", "Event Risk Windows")} meta={`${blockingWindows.length} ${t("个正在阻断 ·", "blocking ·")} ${eventWindows.length} ${t("个有效窗口", "active windows")}`} action={<button className="cp2Link" onClick={()=>ui.setActive("eventsTasks:events")}>{t("查看事件日历", "Open calendar")}</button>}><p className="cp2EventWindowNote">{t("这里只显示后端已验证的高影响事件；红色状态会真实阻止新开仓，普通风险告警在上方单独统计。", "Only server-verified high-impact events appear here. Red states actively block new entries; generic risk incidents are counted separately above.")}</p><ConceptTable compact columns={[{key:"title",label:t("事件", "Event"),render:r=><span className="cp2EventName"><b>{localizeText(r.title)}</b><small>{localizeText(r.sourceName)}</small></span>},{key:"phase",label:t("当前阶段", "Phase"),render:r=><Pill tone={r.blocking?"bad":"warn"}>{eventPhase(r)}</Pill>},{key:"dueAt",label:t("时间", "Time"),render:r=><span className="cp2EventTime"><b>{formatDateTime(r.dueAt)}</b><small>{eventTiming(r)}</small></span>},{key:"impact",label:t("影响", "Impact"),render:r=>r.impact},{key:"relatedSymbols",label:t("影响范围", "Scope"),render:r=>r.marketWide?t("全市场", "Market-wide"):arr(r.relatedSymbols).slice(0,3).join(t("、", ", "))||"—"}]} rows={eventWindows.slice(0,7)} empty={t("当前没有处于有效期内的已验证高影响事件", "No verified high-impact event is currently inside its active window")}/></ConceptCard></div>
    </div>;
}

// 自动保护设置：用用户能直接理解的结果描述，不暴露内部“运行时阈值/硬闸”术语。
const RISK_THRESH_FIELDS=[
  {key:"minRewardRisk",label:"最低盈亏比",labelEn:"Minimum reward-to-risk",unit:"R",unitEn:"R",min:1,max:5,step:0.1,hint:"设有固定止盈时，低于这个比例不会开仓；动态退出计划会明确提示无法预先验证",hintEn:"Plans with fixed targets are blocked below this ratio; dynamic-exit plans are explicitly marked unverifiable"},
  {key:"protectMaxConsecLosses",label:"连续亏损达到",labelEn:"Pause after consecutive losses",unit:"笔",unitEn:"losses",min:1,max:100,step:1,hint:"达到后暂停新增仓位；允许 1–100，默认 3",hintEn:"Pause new positions after this many losses; configurable from 1–100, default 3"},
  {key:"protectCooldownHours",label:"连续亏损后暂停",labelEn:"Loss-streak pause",unit:"小时",unitEn:"hours",min:0.5,max:48,step:0.5,hint:"暂停期间只能降低风险",hintEn:"Only risk-reducing actions are allowed during the pause"},
  {key:"protectMaxDrawdownPct",label:"近期回撤达到",labelEn:"Pause at recent drawdown",unit:"%",unitEn:"%",min:3,max:50,step:0.5,hint:"按账户权益计算，达到后暂停新增仓位",hintEn:"Measured against equity; reaching it pauses new positions"},
  {key:"protectDrawdownLockHours",label:"回撤后暂停",labelEn:"Drawdown pause",unit:"小时",unitEn:"hours",min:1,max:72,step:1,hint:"到期后重新评估是否允许开仓",hintEn:"New entries are reassessed when the pause ends"},
  {key:"trailActivatePct",label:"盈利达到后开始跟踪止损",labelEn:"Start trailing stop at profit",unit:"%",unitEn:"%",min:0.3,max:10,step:0.1,hint:"达到这个浮盈比例后开始保护利润",hintEn:"Start protecting profit after this unrealized gain"},
  {key:"trailDistancePct",label:"跟踪止损距离",labelEn:"Trailing distance",unit:"%",unitEn:"%",min:0.3,max:5,step:0.1,hint:"止损与最新价格保持的距离",hintEn:"Distance maintained behind the latest price"},
  {key:"eventBlackoutMinutes",label:"重大事件前暂停新开仓",labelEn:"Pause new entries before major events",unit:"分钟",unitEn:"min",min:0,max:240,step:5,hint:"仅对有精确发布时间的高影响事件生效，公布后刷新事实再评估",hintEn:"Applies only to high-impact events with exact release times; reassess after the release"}
  ,{key:"entryOrderTtlMinutes",label:"未成交委托有效期",labelEn:"Unfilled order lifetime",unit:"分钟",unitEn:"min",min:5,max:1440,step:5,hint:"超过此时间仍未成交会主动撤单",hintEn:"Cancel an entry that remains unfilled beyond this time"}
  ,{key:"entryStaleDeviationPct",label:"未成交委托最大偏离",labelEn:"Maximum unfilled-order deviation",unit:"%",unitEn:"%",min:1,max:30,step:0.5,hint:"现价偏离原入场过大时撤单并重新分析",hintEn:"Cancel and reassess when price moves too far from the planned entry"}
];
export function MandateConcept({ data, action, ui }) {
  const mandate=data.agentStatus?.activeMandate||(data.mandates||[]).find(item=>["active","running"].includes(item.status))||arr(data.mandates)[0]||{};
  const history=arr(data.mandates); const live=data.config?.liveTrading||{}; const activeGray=arr(data.grayReleasePolicies).find(item=>item.enabled)||arr(data.grayReleasePolicies).find(item=>item.id==="gray_live_small_notional")||{};
  const currentMode=data.automationState?.selectedMode||data.automationState?.requestedMode||(data.automationState?.mode==="full_auto_small"?"full_auto":data.automationState?.mode==="semi_auto"?"semi_auto":"observe");
  const runtime=automationPresentation(data);
  const cap=data.tradingCapacity||{};
  const orderDefault=mandate.maxOrderNotionalUsdt??mandate.max_notional_usdt??activeGray.maxNotionalUsdt??50;
  const remainingDays=mandate.validUntil?Math.max(1,Math.ceil((new Date(mandate.validUntil)-Date.now())/86400000)):7;
  const makeMandate=()=>({name:mandate.name||t("主账户交易权限","Primary account trading permissions"),allowedSymbols:arr(mandate.allowedSymbols).length?arr(mandate.allowedSymbols).map(s=>String(s).toUpperCase()):["BTC/USDT","ETH/USDT"],minLeverage:mandate.min_leverage??mandate.minLeverage??1,maxLeverage:mandate.max_leverage??mandate.maxLeverage??1,positionPct:mandate.positionPct??mandate.equityPct??30,singleRisk:mandate.maxSingleTradeRiskPct??2,dailyLoss:mandate.maxDailyLossPct??1,weeklyLoss:mandate.maxWeeklyLossPct??mandate.max_weekly_loss_pct??5,maxOrderNotional:orderDefault,maxSymbolNotional:mandate.maxSymbolNotionalUsdt??orderDefault,maxPortfolioNotional:mandate.maxPortfolioNotionalUsdt??mandate.maxSymbolNotionalUsdt??orderDefault,maxConcurrentPositions:mandate.maxConcurrentPositions??3,maxMarginUtilizationPct:mandate.maxMarginUtilizationPct??mandate.max_margin_utilization_pct??70,allowAddPosition:mandate.allowAddPosition===true||mandate.allow_add_position===true,validDays:remainingDays});
  const makeLive=()=>({acknowledged:Boolean(live.acknowledged),maxNotionalUsdt:live.maxNotionalUsdt??activeGray.maxNotionalUsdt??50});
  const makeGoalProtection=()=>({dailyGoalUsdt:data.system?.dailyGoalUsdt??"",enabled:data.system?.dailyGoalBreakevenEnabled===true});
  const goalProtectionEvent=data.system?.dailyGoalProtectionLastEvent||null;
  const [mandateForm,setMandateForm]=useState(makeMandate); const [liveForm,setLiveForm]=useState(makeLive); const [thresholdForm,setThresholdForm]=useState(data.riskThresholds||{}); const [goalProtection,setGoalProtection]=useState(makeGoalProtection); const [mode,setMode]=useState(currentMode); const [saving,setSaving]=useState(false);
  useEffect(()=>setMandateForm(makeMandate()),[mandate.id,mandate.version]);
  useEffect(()=>setLiveForm(makeLive()),[live.acknowledged,live.maxNotionalUsdt]);
  useEffect(()=>setThresholdForm(data.riskThresholds||{}),[JSON.stringify(data.riskThresholds||{})]);
  useEffect(()=>setGoalProtection(makeGoalProtection()),[data.system?.dailyGoalUsdt,data.system?.dailyGoalBreakevenEnabled]);
  useEffect(()=>setMode(currentMode),[currentMode]);
  const mandateBase=makeMandate(); const liveBase=makeLive(); const goalProtectionBase=makeGoalProtection();
  const mandateDirty=JSON.stringify(mandateForm)!==JSON.stringify(mandateBase); const liveDirty=JSON.stringify(liveForm)!==JSON.stringify(liveBase); const thresholdDirty=RISK_THRESH_FIELDS.some(f=>Number(thresholdForm[f.key])!==Number((data.riskThresholds||{})[f.key])); const goalProtectionDirty=JSON.stringify(goalProtection)!==JSON.stringify(goalProtectionBase); const modeDirty=mode!==currentMode; const dirty=mandateDirty||liveDirty||thresholdDirty||goalProtectionDirty||modeDirty;
  const updateMandate=(key,value)=>setMandateForm(current=>({...current,[key]:value})); const updateLive=(key,value)=>setLiveForm(current=>({...current,[key]:value}));
  const chooseMode=(next)=>setMode(next);
  const positive=value=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;
  const permissionOrder=positive(mandateForm.maxOrderNotional); const validationOrder=mode!=="observe"?positive(liveForm.maxNotionalUsdt):null; const fundOrder=cap.freshForExecution?positive(cap.maxNotional):null;
  const effectiveCandidates=[permissionOrder,validationOrder,fundOrder].filter(Number.isFinite); const effectiveNow=effectiveCandidates.length?Math.min(...effectiveCandidates):null;
  const gates=mode==="observe"?[[true,t("当前模式不会发送真实订单","Current mode never sends live orders")]]:[
    [liveForm.acknowledged,t("真实资金风险已确认","Real-money risk acknowledged")],
    [Boolean(mandate.id),t("交易范围与风险限制","Trading scope and risk limits")],[data.readiness?.checks?.find(c=>c.key==="private_rest_positions")?.configured??false,t("OKX 账户已同步","OKX account synced")],[data.readiness?.checks?.find(c=>c.key==="withdraw_permission_detection")?.configured??false,t("API 禁止提现","API cannot withdraw")],[!data.system?.killSwitch,t("未触发紧急停止","Emergency stop clear")],[data.readiness?.checks?.find(c=>c.key==="audit_chain")?.configured??false,t("审计记录链完整","Audit record chain healthy")]
  ];
  const gatePass=gates.filter(([ok])=>ok).length;
  const reset=()=>{setMandateForm(makeMandate());setLiveForm(makeLive());setThresholdForm(data.riskThresholds||{});setGoalProtection(makeGoalProtection());setMode(currentMode);};
  async function saveAll(){
    const symbols=arr(mandateForm.allowedSymbols).map(value=>String(value).trim().toUpperCase()).filter(Boolean);
    const maxLev=Number(mandateForm.maxLeverage); const minLev=Number(mandateForm.minLeverage); const order=Number(mandateForm.maxOrderNotional); const symbol=Number(mandateForm.maxSymbolNotional); const portfolio=Number(mandateForm.maxPortfolioNotional);
    if(!symbols.length)return ui.notify?.(t("至少选择一个允许交易的交易对","Select at least one allowed trading pair"));
    if(![minLev,maxLev,order,symbol,portfolio].every(v=>Number.isFinite(v)&&v>0)||minLev>maxLev)return ui.notify?.(t("请检查杠杆和金额：必须大于 0，且最低杠杆不能高于最高杠杆","Check leverage and amounts: all must be positive, and minimum leverage cannot exceed maximum leverage"));
    if(symbol<order||portfolio<symbol)return ui.notify?.(t("额度关系不正确：单个交易对累计上限不能小于单笔上限，组合累计上限不能小于单个交易对上限","Invalid limit order: the per-pair limit must cover one order, and the portfolio limit must cover the per-pair limit"));
    if(!positive(liveForm.maxNotionalUsdt))return ui.notify?.(t("真实订单单笔上限必须大于 0","The live order limit must be greater than zero"));
    if(mode!=="observe"&&!liveForm.acknowledged)return ui.notify?.(t("进入真实资金交易前必须确认风险","Acknowledge real-money risk before enabling live trading"));
    const dailyGoal=positive(goalProtection.dailyGoalUsdt);
    if(goalProtection.enabled&&!dailyGoal)return ui.notify?.(t("启用每日目标保本前，必须明确设置大于 0 的每日盈利目标","Set an explicit daily profit goal greater than zero before enabling goal-based break-even protection"));
    for(const field of RISK_THRESH_FIELDS){const value=Number(thresholdForm[field.key]);if(!Number.isFinite(value)||value<field.min||value>field.max)return ui.notify?.(t(`${field.label} 必须在 ${field.min}–${field.max} 之间`,`${field.labelEn} must be between ${field.min} and ${field.max}`));}
    if(modeDirty&&mode!=="observe"&&!await uiConfirm(mode==="full_auto"?t("确认切换到自动执行？符合全部交易与风险限制的机会将使用真实资金自动下单。","Switch to automatic execution? Eligible opportunities that pass every trading and risk limit will use real funds automatically."):t("确认切换到逐笔确认？批准后的计划会使用真实资金下单。","Switch to approval-required execution? Approved plans will place real-money orders.")))return;
    const mandateBody={name:mandateForm.name,exchanges:["OKX"],marketTypes:["perpetual_usdt"],allowedSymbols:symbols,strategies:arr(mandate.strategies).length?mandate.strategies:["trend_following","mean_reversion","momentum","breakout"],maxLeverageBySymbol:Object.fromEntries(symbols.map(item=>[item,maxLev])),max_leverage:maxLev,min_leverage:minLev,minLeverage:minLev,sizingMode:"balance_pct",positionPct:Math.max(1,Math.min(100,Number(mandateForm.positionPct))),maxSingleTradeRiskPct:Number(mandateForm.singleRisk),maxDailyLossPct:Number(mandateForm.dailyLoss),maxWeeklyLossPct:Number(mandateForm.weeklyLoss),maxOrderNotionalUsdt:order,maxSymbolNotionalUsdt:symbol,maxPortfolioNotionalUsdt:portfolio,maxConcurrentPositions:Number(mandateForm.maxConcurrentPositions),maxMarginUtilizationPct:Number(mandateForm.maxMarginUtilizationPct),allowAddPosition:mandateForm.allowAddPosition===true,allow_add_position:mandateForm.allowAddPosition===true,validUntil:new Date(Date.now()+Math.max(1,Math.min(365,Number(mandateForm.validDays)))*86400000).toISOString()};
    const thresholdBody={};RISK_THRESH_FIELDS.forEach(field=>{thresholdBody[field.key]=Number(thresholdForm[field.key]);});
    const liveBody={requestedMode:mode,acknowledged:liveForm.acknowledged,maxNotionalUsdt:Number(liveForm.maxNotionalUsdt),allowedSymbols:[]};
    setSaving(true);let completed=0;let pendingBlockers=[];
    try{
      const call=async(label,url,body,method="POST")=>{const result=await action(url,body,method);if(result?.ok===false)throw new Error(`${label}：${result.error||"save_failed"}`);if(!result||!Object.keys(result).length)throw new Error(`${label}：save_failed`);completed+=1;return result;};
      if(thresholdDirty)await call(t("自动保护","Automatic protections"),"/api/risk/thresholds",thresholdBody);
      if(mandateDirty){const savedMandate=await call(t("交易权限","Trading permissions"),mandate.id?`/api/mandates/${mandate.id}`:"/api/mandates",mandateBody,mandate.id?"PATCH":"POST");if(!mandate.id&&savedMandate?.id)await call(t("激活交易权限","Activate trading permissions"),`/api/mandates/${savedMandate.id}/activate`,{});}
      if(liveDirty||modeDirty){const liveResult=await call(t("执行方式","Execution mode"),"/api/config/live-trading",liveBody);pendingBlockers=arr(liveResult.pendingBlockers);}
      if(goalProtectionDirty)await call(t("每日目标保护","Daily goal protection"),"/api/system/goals",{dailyGoalUsdt:dailyGoal,dailyGoalBreakevenEnabled:goalProtection.enabled});
      ui.notify?.(pendingBlockers.length?t(`设置已保存；当前暂缓新开仓，恢复后自动按原模式运行：${pendingBlockers.join("、")}`,`Settings saved. New entries are temporarily paused and will resume automatically: ${pendingBlockers.join(", ")}`):t("资金与交易控制已保存并生效","Capital and trading controls saved and applied"));
    }catch(error){
      // 如果第一项写入就被后端拒绝，立即把所有控件还原到服务器当前值，避免“已保存的执行方式”
      // 暂时显示用户刚点选、但实际上并未持久化的模式。部分成功时则重新拉取真实生效值。
      if(!completed)reset();else await ui.refresh?.(false);
      const reason=error?.message&&error.message!=="save_failed"?`：${error.message}`:"";
      ui.notify?.(`${completed?t("部分设置已保存，后续步骤失败；已重新读取当前生效值","Some settings were saved, but a later step failed. Current effective values were reloaded"):t("保存失败，当前设置未更新","Save failed; settings were not updated")}${reason}`);
    }finally{setSaving(false);}
  }
  const field=(key,label,labelEn,unit="",hint="",hintEn="",options={})=><label className="tcField"><span><b>{t(label,labelEn)}</b>{hint&&<small>{t(hint,hintEn)}</small>}</span><div className="tcInput"><input type="number" min={options.min} max={options.max} step={options.step||"any"} value={mandateForm[key]??""} onChange={event=>updateMandate(key,event.target.value)}/>{unit&&<i>{unit}</i>}</div></label>;
  return <div className="cp2Stack tcPage">
    <div className="tcIntro"><div><CircleDollarSign/><span><b>{t("资金与交易控制","Capital & Trading Controls")}</b><small>{t("账户容量、交易额度、实盘方式与自动保护的唯一配置入口","The single source for account capacity, trading limits, live execution, and automatic protection")}</small></span></div><Pill tone={mandate.status==="active"?"good":"warn"}>{mandate.id?t(`权限 v${mandate.version||1}`,`Permissions v${mandate.version||1}`):t("尚未创建权限","Permissions not configured")}</Pill></div>
    <div className="tcEffective">
      <div className="primary"><small>{t("当前有效单笔上限","Effective limit per order")}</small><b>{effectiveNow==null?"—":`${money(effectiveNow)} U`}</b><span>{cap.freshForExecution?t("已计入最新账户可用资金","Includes current account capacity"):t("账户数据不够新，下单前会重新同步","Account data is stale and will be refreshed before execution")}</span></div>
      <div><small>{t("单个交易对累计上限","Cumulative limit per pair")}</small><b>{positive(mandateForm.maxSymbolNotional)==null?"—":`${money(mandateForm.maxSymbolNotional)} U`}</b><span>{t("该交易对现有仓位 + 在途委托","Existing exposure plus pending entries for the pair")}</span></div>
      <div><small>{t("全部持仓累计上限","Portfolio notional limit")}</small><b>{positive(mandateForm.maxPortfolioNotional)==null?"—":`${money(mandateForm.maxPortfolioNotional)} U`}</b><span>{t("所有交易对名义金额合计","Combined notional across all pairs")}</span></div>
      <div><small>{t("允许杠杆","Allowed leverage")}</small><b>{mandateForm.minLeverage}x – {mandateForm.maxLeverage}x</b><span>{t("每个计划仍按止损距离缩小仓位","Each plan can still be downsized from its stop distance")}</span></div>
    </div>
    <div className="tcLayout">
      <main className="tcMain">
        <ConceptCard title={t("交易范围与资金边界","Trading Scope & Capital Limits")} meta={t("定义 AI 可以交易什么，以及单笔、单币种和组合最多能用多少","Define what the AI may trade and the maximum per order, pair, and portfolio")} className="tcSection tcScopeSection">
          <div className="tcIdentity"><label className="tcField"><span><b>{t("权限名称","Permission name")}</b></span><div className="tcInput"><input value={mandateForm.name} onChange={event=>updateMandate("name",event.target.value)}/></div></label>{field("validDays","有效期","Valid for",t("天","days"),t("保存时从当前时间重新计算","Recalculated from save time"),"Recalculated from save time",{min:1,max:365,step:1})}</div>
          <label className="tcField tcWide"><span><b>{t("允许交易的永续合约","Allowed perpetual markets")}</b><small>{t("系统只会在这个清单内提出和执行交易","The system can propose and execute trades only from this list")}</small></span><SymbolMultiSelect value={mandateForm.allowedSymbols} onChange={value=>updateMandate("allowedSymbols",value)}/></label>
          <b className="tcSubhead">{t("金额与仓位","Amounts & Positioning")}</b><div className="tcFieldGrid three">{field("maxOrderNotional","每笔委托上限","Maximum per order","USDT",t("限制一次新开仓委托的名义金额","Caps the notional of one new entry order"),"Caps the notional of one new entry order",{min:1})}{field("maxSymbolNotional","单个交易对累计上限","Cumulative limit per pair","USDT",t("现有仓位与在途委托合并计算","Existing exposure and pending entries are combined"),"Existing exposure and pending entries are combined",{min:1})}{field("maxPortfolioNotional","全部持仓累计上限","Portfolio notional limit","USDT",t("所有交易对合并计算","Combined across all pairs"),"Combined across all pairs",{min:1})}{field("positionPct","每单最多使用账户权益","Maximum equity used per order","%",t("保证金比例，不是最终名义金额","Margin allocation, not final notional"),"Margin allocation, not final notional",{min:1,max:100,step:1})}{field("maxConcurrentPositions","最多同时持仓","Maximum concurrent positions",t("个","positions"),"","",{min:1,max:20,step:1})}{field("maxMarginUtilizationPct","成交后保证金使用率上限","Post-trade margin-use ceiling","%",t("每次下单前按 OKX 实时账户重新计算","Recalculated from the live OKX account before each order"),"Recalculated from the live OKX account before each order",{min:1,max:100,step:1})}</div>
          <b className="tcSubhead">{t("杠杆与亏损边界","Leverage & Loss Limits")}</b><div className="tcFieldGrid three">{field("minLeverage","最低杠杆","Minimum leverage","x","","",{min:1,step:1})}{field("maxLeverage","最高杠杆","Maximum leverage","x",t("AI 只能在此范围内选择","The AI can choose only within this range"),"The AI can choose only within this range",{min:1,step:1})}{field("singleRisk","单笔最多亏损","Maximum loss per trade","%",t("按止损距离反推仓位","Position size is derived from stop distance"),"Position size is derived from stop distance",{min:0,step:.1})}{field("dailyLoss","单日亏损上限","Daily loss limit","%","","",{min:0,step:.1})}{field("weeklyLoss","近 7 日亏损上限","Rolling 7-day loss limit","%","","",{min:.1,max:20,step:.1})}<label className="tcSwitch"><input type="checkbox" checked={mandateForm.allowAddPosition} onChange={event=>updateMandate("allowAddPosition",event.target.checked)}/><i/><span><b>{t("允许同币种追加仓位","Allow adding to an existing pair")}</b><small>{t("关闭时，同一交易对只允许一个仓位或在途入场计划","When off, each pair may have only one position or pending entry")}</small></span></label></div>
        </ConceptCard>
        <ConceptCard title={t("运行模式","Operating Mode")} meta={t("你只需要在三种方式中选择一种","Choose one of three clear behaviors")} className="tcSection tcModeSection">
          <div className="tcModeBoundary"><Info/><span><b>{t("模式决定计划通过后是否下单", "The mode decides what happens after a plan passes")}</b><small>{t("系统异常只会临时暂停新开仓，不会偷偷改写你的选择；原因解除后会自动恢复。", "A runtime issue only pauses new entries temporarily and never rewrites your choice. The mode resumes automatically after recovery.")}</small></span></div>
          <div className="cp2ModeCards tcModes">{[["observe",t("只分析","Analyze only"),t("继续发现机会和生成计划，不向 OKX 提交订单","Keep finding opportunities and building plans without sending orders to OKX")],["semi_auto",t("逐笔确认","Approve each trade"),t("每笔计划由你批准后才使用真实资金","Each plan needs your approval before using real funds")],["full_auto",t("自动交易","Automatic trading"),t("通过全部事实、交易权限和硬风控后自动执行","Execute automatically only after all facts, permissions, and hard-risk checks pass")]].map(([id,label,desc])=><button type="button" className={mode===id?"active":""} key={id} onClick={()=>chooseMode(id)}><i/><span><b>{label}</b><small>{desc}</small></span></button>)}</div>
          {mode!=="observe"&&<div className="tcFieldGrid two"><label className="tcSwitch"><input type="checkbox" checked={liveForm.acknowledged} onChange={event=>updateLive("acknowledged",event.target.checked)}/><i/><span><b>{t("我已了解真实资金交易风险","I understand the risks of live trading")}</b><small>{t("首次进入真实交易模式时确认；以后不作为日常开关","Confirm once before live trading; this is not a day-to-day mode switch")}</small></span></label><label className="tcField"><span><b>{t("真实订单单笔上限","Maximum per live order")}</b><small>{t("系统会同时执行上方单笔、单币种、组合和账户容量限制，最终取最严格值","The strictest of the order, pair, portfolio, and account-capacity limits always applies")}</small></span><div className="tcInput"><input type="number" min="1" value={liveForm.maxNotionalUsdt} onChange={event=>updateLive("maxNotionalUsdt",event.target.value)}/><i>USDT</i></div></label></div>}
          <div className="tcReady"><span><b>{t("实盘交易检查","Live trading checks")}</b><small>{t("全部通过后才会发送真实订单","Real orders require every check to pass")}</small></span><strong className={gatePass===gates.length?"good":"warn"}>{gatePass}/{gates.length} {t("通过","passed")}</strong><div>{gates.map(([ok,label])=><em className={ok?"ok":"bad"} key={label}>{ok?<CheckCircle2/>:<AlertTriangle/>}{label}</em>)}</div></div>
        </ConceptCard>
        <ConceptCard title={t("自动保护","Automatic Protection")} meta={t("达到条件后暂停新增仓位或开始保护盈利","Pause new entries or protect profit when a condition is reached")} className="tcSection tcProtection">
          <div className="tcDerivedGoal">{t(`月度目标无需单独设置：系统自动按每日目标 × 当月 ${data.system?.monthlyGoalDays || 30} 天计算，目前为 ${data.system?.monthlyGoalUsdt ? `${money(data.system.monthlyGoalUsdt)} USDT` : "未设置"}。`,`No separate monthly setting: it is daily goal × ${data.system?.monthlyGoalDays || 30} days, currently ${data.system?.monthlyGoalUsdt ? `${money(data.system.monthlyGoalUsdt)} USDT` : "not set"}.`)}</div>
          <div className="tcGoalProtection"><label className="tcField"><span><b>{t("每日盈利目标","Daily profit goal")}</b><small>{t("必须明确保存；未设置时不会启用基于金额的保本规则","Must be explicitly saved; amount-based break-even protection stays off when unset")}</small></span><div className="tcInput"><input type="number" min="0.01" step="0.01" placeholder={t("未设置","Not set")} value={goalProtection.dailyGoalUsdt} onChange={event=>setGoalProtection(current=>({...current,dailyGoalUsdt:event.target.value}))}/><i>USDT</i></div></label><label className="tcSwitch"><input type="checkbox" checked={goalProtection.enabled} onChange={event=>setGoalProtection(current=>({...current,enabled:event.target.checked}))}/><i/><span><b>{t("单个持仓浮盈达到目标后，止损至少保护到开仓价","Protect at least the entry price when one position reaches the goal")}</b><small>{t("只管理 AI 开立的仓位；已有更有利止损时不修改，原止盈与跟踪止损保持不变","Applies only to AI-managed positions; better stops are preserved, and take-profit/trailing rules remain unchanged")}</small></span></label>{goalProtectionEvent&&<div className={`tcGoalEvent ${goalProtectionEvent.status==="move_failed"?"bad":"good"}`}><ShieldCheck/><span><b>{goalProtectionEvent.symbol} · {goalProtectionEvent.status==="move_failed"?t("最近一次保本改单失败","Latest break-even move failed"):goalProtectionEvent.status==="already_protected"?t("已有更有利止损，无需修改","A better stop was already active"):t("止损已由 OKX 确认","Stop confirmed by OKX")}</b><small>{formatDateTime(goalProtectionEvent.at)}{goalProtectionEvent.stopPrice?` · ${t("止损","Stop")} ${goalProtectionEvent.stopPrice}`:""}</small></span></div>}</div>
          <div className="tcFieldGrid two">{RISK_THRESH_FIELDS.map(item=><label className="tcField" key={item.key}><span><b>{t(item.label,item.labelEn)}</b><small>{t(item.hint,item.hintEn)}</small></span><div className="tcInput"><input type="number" min={item.min} max={item.max} step={item.step} value={thresholdForm[item.key]??""} onChange={event=>setThresholdForm(current=>({...current,[item.key]:event.target.value}))}/><i>{t(item.unit,item.unitEn)}</i></div></label>)}</div>
        </ConceptCard>
        <div className="tcSaveBar"><span>{dirty?<><b>{t("有未保存的更改","Unsaved changes")}</b><small>{[mandateDirty&&t("交易权限","permissions"),(liveDirty||modeDirty)&&t("运行模式","operating mode"),(thresholdDirty||goalProtectionDirty)&&t("自动保护","automatic protection")].filter(Boolean).join(t("、",", "))}</small></>:<><b>{t("当前显示的设置已生效","The displayed settings are active")}</b><small>{t("保存会创建新的交易权限版本，并立即用于后续计划","Saving creates a new permission version for future plans")}</small></>}</span><div><button type="button" className="cp2Secondary" disabled={!dirty||saving} onClick={reset}>{t("放弃更改","Discard")}</button><button type="button" className="cp2Primary" disabled={!dirty||saving} onClick={saveAll}>{saving?t("正在保存…","Saving…"):t("保存全部设置","Save all settings")}</button></div></div>
      </main>
      <aside className="tcAside">
        <ConceptCard title={t("OKX 账户事实","OKX Account Facts")} meta={cap.freshForExecution?t("可用于执行","Fresh for execution"):t("执行前需刷新","Refresh before execution")}><div className="cp2Kv column"><span>{t("账户权益","Account equity")}<b>{cap.ok?`${money(cap.equity)} U`:"—"}</b></span><span>{t("可用保证金","Available margin")}<b>{cap.ok?`${money(cap.availableMargin)} U`:"—"}</b></span><span>{t("当前保证金使用率","Current margin use")}<b>{cap.ok?`${num(cap.currentUtilizationPct).toFixed(1)}%`:"—"}</b></span><span>{t(`按 ${cap.leverage||1}x 估算的新增容量`,`Estimated new capacity at ${cap.leverage||1}x`)}<b>{cap.ok?`${money(cap.maxNotional)} U`:"—"}</b></span></div><p className="tcFactNote">{t("这只是当前快照。每笔真实订单发出前，系统会再次读取账户余额、持仓和在途委托并重新计算。","This is a current snapshot only. Before every live order, the system reloads balance, positions, and pending entries and recalculates capacity.")}</p></ConceptCard>
        <ConceptCard title={t("额度含义","How the limits differ")}><ol className="tcExplain"><li><b>{t("每笔委托上限","Per-order limit")}</b><span>{t("限制一次开仓请求","Caps one entry request")}</span></li><li><b>{t("单个交易对累计上限","Per-pair cumulative limit")}</b><span>{t("限制该币种已有仓位与在途委托合计","Caps existing plus pending exposure for one pair")}</span></li><li><b>{t("全部持仓累计上限","Portfolio limit")}</b><span>{t("限制账户所有交易对的总敞口","Caps total exposure across the account")}</span></li><li><b>{t("真实订单单笔上限","Live-order limit")}</b><span>{t("逐笔确认和自动交易共用的额外单笔边界","An additional per-order boundary shared by approval and automatic modes")}</span></li></ol></ConceptCard>
        <ConceptCard title={t("当前运行状态","Current Runtime State")}><div className={`tcRuntimePrimary ${runtime.tone}`}><span><small>{t("当前实际状态","EFFECTIVE NOW")}</small><b>{runtime.label}</b><p>{runtime.detail}</p></span></div><div className="tcRuntimeTarget"><span><small>{t("你选择的模式","YOUR MODE")}</small><b>{runtime.targetLabel}</b></span><small>{runtime.targetIsEffective?t("当前正在按该模式运行。","The system is currently following this mode."):runtime.recoveryLabel}</small></div>{runtime.blockerDetails.length>0&&<div className="tcRuntimeReasons"><b>{t("当前限制原因与恢复进度","Current restriction and recovery progress")}</b><div>{runtime.blockerDetails.map((item,index)=><article key={item.code||item.label||index}><Pill tone="warn">{localizeText(item.label||item)}</Pill>{item.detail&&<p>{localizeText(item.detail)}</p>}{item.recovery&&<small><RefreshCw/>{localizeText(item.recovery)}</small>}</article>)}</div></div>}<div className="tcRuntimeTopHint"><Activity/>{t("系统异常会自动暂停新开仓，但仍会管理已有仓位；恢复方式会在这里明确显示。", "Runtime issues pause new entries automatically while existing positions remain managed. Recovery is always explained here.")}</div></ConceptCard>
      </aside>
    </div>
    <ConceptCard title={t("交易权限变更记录","Trading Permission History")}><ConceptTable compact columns={[{key:"createdAt",label:t("时间","Time"),render:row=>formatDateTime(row.updatedAt||row.createdAt)},{key:"name",label:t("权限版本","Permission set"),render:row=>localizeText(row.name)},{key:"version",label:t("版本","Version"),render:row=>`v${row.version||1}`},{key:"status",label:t("状态","Status"),render:row=><Pill tone={toneOf(row.status)}>{humanize(row.status)}</Pill>}]} rows={history.slice(0,8)} empty={t("暂无权限变更","No permission changes")}/></ConceptCard>
  </div>;
}

export function RulesConcept({ data, action, ui }) {
  const rules=arr(data.riskRules); const [selectedId,setSelectedId]=useState(rules[0]?.id||""); const selected=rules.find(r=>r.id===selectedId)||rules[0]||{};
  const CATS=[["全部规则",()=>true],["账户风险",r=>/account|账户|margin|保证金|equity|净值|drawdown|回撤/i.test(`${r.scope} ${r.name}`)],["交易风险",r=>/trade|交易|position|仓|leverage|杠杆|entry|开仓/i.test(`${r.scope} ${r.name}`)],["事件风险",r=>/event|事件|news|新闻|funding|资金费/i.test(`${r.scope} ${r.name}`)],["系统风险",r=>/system|系统|api|连接|slippage|滑点/i.test(`${r.scope} ${r.name}`)]];
  const [catF,setCatF]=useState("全部规则"); const [q,setQ]=useState("");
  const catFn=(CATS.find(c=>c[0]===catF)||CATS[0])[1]; const shown=rules.filter(r=>catFn(r)&&(!q||String(r.name).toLowerCase().includes(q.toLowerCase())));
  return <div className="cp2RulesLayout"><aside className="cp2SideFilter"><b>{t("规则库", "Rule Library")}</b>{CATS.map(([name,fn])=><button className={catF===name?"active":""} key={name} onClick={()=>setCatF(name)}>{t(name, {"全部规则":"All rules","账户风险":"Account risk","交易风险":"Trade risk","事件风险":"Event risk","系统风险":"System risk"}[name]||name)}<span>{rules.filter(fn).length}</span></button>)}<button className="cp2Secondary" onClick={()=>ui.openPanel("riskRules")}><Plus size={12}/> {t("新建规则", "New rule")}</button></aside>
    <main className="cp2RulesMain"><ConceptCard title={t("规则列表", "Rule List")} meta={`${shown.length}/${rules.length} ${t("条", "")}`} action={<button className="cp2Primary" onClick={()=>ui.openPanel("riskRules")}>{t("保存版本", "Save version")}</button>}><div className="cp2Search"><Search size={13}/><input className="cp2SearchInput" value={q} onChange={e=>setQ(e.target.value)} placeholder={t("搜索规则名称", "Search rule name")}/></div><div className="cp2ScrollList"><ConceptTable columns={[{key:"name",label:t("规则名称", "Rule"),render:r=><button className={`cp2Link ${r.id===selected.id?"on":""}`} onClick={()=>setSelectedId(r.id)}>{localizeText(r.name)}</button>},{key:"scope",label:t("作用范围", "Scope"),render:r=>humanize(r.scope)},{key:"level",label:t("优先级", "Priority")},{key:"action",label:t("触发动作", "Action"),render:r=>humanize(r.action)},{key:"enabled",label:t("状态", "Status"),render:r=><button className={`cp2Switch ${r.enabled===false?"":"on"}`} onClick={()=>action(`/api/risk/rules/${r.id}`,{enabled:r.enabled===false},"PATCH")}><i/></button>},{key:"updatedAt",label:t("更新时间", "Updated"),render:r=>formatDateTime(r.updatedAt||r.createdAt)}]} rows={shown} empty={t("无匹配规则", "No matching rules")}/></div></ConceptCard>
      <div className="cp2Grid ruleBottom"><ConceptCard title={`${t("规则编辑", "Edit Rule")} · ${selected.name?localizeText(selected.name):t("未选择", "None selected")}`}><div className="cp2Kv"><span>{t("作用范围", "Scope")}<b>{humanize(selected.scope)}</b></span><span>{t("优先级", "Priority")}<b>{selected.level||"—"}</b></span><span>{t("动作", "Action")}<b>{humanize(selected.action)}</b></span><span>{t("状态", "Status")}<b>{selected.enabled===false?t("停用", "Off"):t("启用", "On")}</b></span></div><div className="cp2CodeBox">{selected.condition||selected.description?localizeText(selected.condition||selected.description):t("尚未配置结构化条件。", "No structured condition configured yet.")}</div><button className="cp2Secondary" onClick={()=>ui.openPanel("riskRules")}>{t("打开完整编辑器", "Open full editor")}</button></ConceptCard><ConceptCard title={t("命中记录", "Hit Log")}><ConceptTable compact columns={[{key:"createdAt",label:t("时间", "Time"),render:r=>formatTime(r.createdAt)},{key:"symbol",label:t("资产", "Asset")},{key:"decision",label:t("结果", "Result"),render:r=><Pill tone={toneOf(r.decision)}>{humanize(r.decision)}</Pill>}]} rows={arr(data.riskChecks).slice(0,7)} empty={t("暂无命中记录", "No hits yet")}/></ConceptCard><ConceptCard title={t("来源与版本", "Source & Version")}><div className="cp2Kv column"><span>{t("规则来源", "Source")}<b>{selected.source||t("内置", "Built-in")}</b></span><span>{t("当前版本", "Version")}<b>{selected.version||"v1"}</b></span><span>{t("最近变更", "Last change")}<b>{formatDateTime(selected.updatedAt||selected.createdAt)}</b></span><span>{t("覆盖对象", "Coverage")}<b>{humanize(selected.scope,t("全账户", "All accounts"))}</b></span></div></ConceptCard></div></main></div>;
}

export function LiveConcept({ data, ui }) {
  const checks=arr(data.readiness?.checks); const drills=arr(data.drillRuns); const ready=checks.filter(c=>c.configured); const runtime=automationPresentation(data);
  return <div className="cp2Stack"><div className={`cp2RiskBanner ${checks.length&&ready.length===checks.length?"good":"warn"}`}><ShieldCheck/><b>{t("实盘就绪状态", "Live readiness")} {ready.length}/{checks.length}</b><span>{t("所有关键安全闸通过后才会真实写单", "Real orders only after all key safety gates pass")}</span><span>{t("配置完成度", "Config complete")} <strong>{data.readiness?.configurationCompletionPct??0}%</strong></span><button onClick={()=>ui.openPanel("mandate")}>{t("查看缺失项", "View gaps")}</button></div>
    <div className="cp2Grid liveTop">
      <ConceptCard title={t("当前执行方式", "Current Execution Mode")}><div className={`tcRuntimePrimary ${runtime.tone}`}><span><small>{t("你选择的模式", "YOUR MODE")}</small><b>{runtime.targetLabel}</b><p>{runtime.detail}</p></span><Pill tone={runtime.tone==="ok"?"good":runtime.tone==="warning"?"warn":runtime.tone==="danger"?"bad":"neutral"}>{runtime.entryPolicy}</Pill></div><button className="cp2Primary" onClick={()=>ui.setActive("riskMandate")}>{t("修改运行模式与交易限制", "Change mode and trading limits")}</button><p className="tcFactNote">{t("是否下单、是否逐笔确认都由这三种模式决定；内部安全检查会自动运行，不需要你再管理额外开关。", "Order submission and per-trade confirmation are decided by these three modes; internal safety checks run automatically without extra switches.")}</p></ConceptCard>
      <ConceptCard title={t("就绪检查", "Readiness Checks")} meta={`${ready.length}/${checks.length} ${t("通过", "passed")}`}><div className="cp2ScrollList" style={{maxHeight:520}}><div className="cp2Checklist vertical">{checks.map(c=><span className={c.configured?"":"warn"} key={c.key}>{c.configured?<CheckCircle2/>:<AlertTriangle/>}{localizeText(c.label)}<small>{c.configured?t("通过", "Passed"):t("待配置", "Pending")}</small></span>)}{!checks.length&&<span><AlertTriangle/>{t("待配置就绪检查", "Readiness checks pending")}<small>—</small></span>}</div></div></ConceptCard>
    </div>
    <div className="cp2Grid two liveBottom">
      <ConceptCard title={t("安全演练记录", "Safety Drill History")}><ConceptTable compact columns={[{key:"createdAt",label:t("时间", "Time"),render:r=>formatDateTime(r.createdAt)},{key:"name",label:t("演练", "Drill"),render:r=>r.name||r.scenario},{key:"status",label:t("结果", "Result"),render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status)}</Pill>}]} rows={drills.slice(0,6)} empty={t("暂无演练记录", "No drills yet")}/></ConceptCard>
      <ConceptCard title={t("回退条件", "Rollback Triggers")}><div className="cp2Checklist vertical"><span><AlertTriangle/>{t("连续订单失败", "Consecutive order failures")}</span><span><AlertTriangle/>{t("对账不一致", "Reconciliation mismatch")}</span><span><AlertTriangle/>{t("行情数据陈旧", "Stale market data")}</span><span><AlertTriangle/>{t("风控检查异常", "Risk-check anomaly")}</span></div></ConceptCard>
    </div></div>;
}

export function OperationsOverviewConcept({ data, action, ui }) {
  const tasks=arr(data.tasks); const runs=arr(data.jobRuns); const events=arr(data.events); const audits=arr(data.auditLogs); const incidents=arr(data.riskIncidents);
  // 市场数据延迟:从真实行情时间戳算最新新鲜度(marketStreamStatus 无 freshnessLabel 字段——旧代码取空恒"待同步")
  const marketFresh=(()=>{const ages=arr(data.markets).map(m=>Date.now()-new Date(m.updatedAt||m.syncedAt||m.microSyncedAt||0).getTime()).filter(a=>Number.isFinite(a)&&a>=0&&a<6e10);if(!ages.length)return"待同步";const min=Math.min(...ages);return min<8000?"实时":min<180000?`${Math.round(min/1000)}s 前`:"待同步";})();
  // 审计链:configured=verifyAuditChain().ok。false 是"校验发现断点"(不是"待配置")——用「待复核」并可点开审计链详情
  const auditCheck=data.readiness?.checks?.find(c=>c.key==="audit_chain");
  const auditVal=auditCheck?(auditCheck.configured?"正常":"待复核"):"待同步";
  const services=[
    {label:t("API 健康", "API health"),value:data.system?.apiHealth||"待配置",sub:t("系统入口", "Entry point"),icon:ShieldCheck},
    {label:t("WebSocket 连接", "WebSocket"),value:data.realtimeStarted?"正常":"待配置",sub:t("实时连接", "Realtime link"),icon:Activity},
    {label:t("市场数据延迟", "Market latency"),value:marketFresh,sub:t("公开行情", "Public data"),icon:Clock3},
    {label:t("用户同步状态", "Account sync"),value:arr(data.accountSnapshots).some(s=>s.status==="ok")?"正常":"待配置",sub:t("账户快照", "Account snapshot"),icon:Users},
    {label:t("审计链校验", "Audit chain"),value:auditVal,sub:t("哈希链", "Hash chain"),icon:FileText}
  ];
  const opsVal=(v)=>t(v, {"待配置":"Unconfigured","正常":"OK","实时":"Live","待同步":"Pending","待复核":"Needs review"}[v]||humanize(v));
  const recentRuns=[...runs].sort((a,b)=>new Date(b.finishedAt||b.createdAt||0)-new Date(a.finishedAt||a.createdAt||0)).slice(0,5);
  return <div className="cp2Stack operationsCommandPage"><section className="opsControlBoard"><div className="opsHealthMatrix"><header><small>SYSTEM HEALTH MATRIX</small><b>{t("服务健康矩阵", "Service health matrix")}</b><span>{t("配置状态、实时连接和事实同步统一检查", "Configuration, live connectivity, and fact sync in one view")}</span></header>{services.map(service=>{const Icon=service.icon;const tone=toneOf(service.value);return <article key={service.label} className={tone}><Icon/><span><small>{service.sub}</small><b>{service.label}</b></span><em>{opsVal(service.value)}</em></article>;})}</div><div className="opsRunTrace"><header><small>RECENT RUN TRACE</small><b>{t("最近运行轨迹", "Recent run trace")}</b><span>{t("任务是否真的执行，比“系统托管”标签更重要", "Actual execution matters more than a generic managed label")}</span></header><div>{recentRuns.map((run,index)=><article key={run.id||index}><i>{index+1}</i><span><b>{localizeText(run.taskName||run.name||run.handler||t("系统任务","System task"))}</b><small>{formatDateTime(run.finishedAt||run.createdAt)} · {humanize(run.status)}</small></span><Pill tone={toneOf(run.status)}>{humanize(run.status,t("已记录","Recorded"))}</Pill></article>)}{!recentRuns.length&&<div className="cp2Empty"><Clock3/><b>{t("暂无运行记录", "No run records")}</b><span>{t("任务首次执行后在这里形成时间线。", "A timeline appears after the first task run.")}</span></div>}</div></div></section>
    <div className="cp2Grid opsTop"><ConceptCard title={t("任务与自动化", "Tasks & Automation")} className="span2"><ConceptTable compact columns={[{key:"name",label:t("任务名称", "Task"),render:r=>localizeText(r.name)},{key:"type",label:t("类型", "Type"),render:r=>humanize(r.type)},{key:"lastRunAt",label:t("上次运行", "Last run"),render:r=>formatDateTime(r.lastRunAt)},{key:"nextRunAt",label:t("下次运行", "Next run"),render:r=>formatDateTime(r.nextRunAt)},{key:"status",label:t("状态", "Status"),render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status,r.enabled===false?t("已暂停", "Paused"):t("运行中", "Running"))}</Pill>},{key:"action",label:t("操作", "Action"),render:r=><button className="cp2Link" onClick={()=>action(`/api/tasks/${r.id}/run`,{})}>{t("立即运行", "Run now")}</button>}]} rows={tasks.slice(0,8)} empty={t("暂无任务", "No tasks")}/></ConceptCard><ConceptCard title={t("事件日历", "Event Calendar")}><ConceptTable compact columns={[{key:"due",label:t("时间", "Time"),render:r=>localizeText(formatDateTime(r.due||r.startAt))},{key:"title",label:t("事件", "Event"),render:r=>localizeText(r.title)},{key:"impact",label:t("影响", "Impact"),render:r=><Pill tone={num(r.impact)>=80?"bad":"warn"}>{r.impactLabel?humanize(r.impactLabel):(r.impact!=null?r.impact:t("待评估", "TBD"))}</Pill>}]} rows={events.slice(0,7)} empty={t("暂无事件", "No events")}/></ConceptCard></div>
    <div className="cp2Grid two wideLeft"><ConceptCard title={t("审计与运行轨迹", "Audit & Run Trail")} action={<button className="cp2Link" onClick={()=>ui.setActive("auditSystem")}>{t("查看审计 ›", "View audit ›")}</button>}><ConceptTable compact columns={[{key:"createdAt",label:t("时间", "Time"),render:r=>formatDateTime(r.createdAt)},{key:"actor",label:t("操作者", "Actor"),render:r=>localizeText(r.actor||r.userName||r.role||t("系统", "System"))},{key:"action",label:t("动作", "Action"),render:r=>localizeText(r.action)},{key:"resource",label:t("资源", "Resource"),render:r=>r.resource||r.target||"—"},{key:"status",label:t("结果", "Result"),render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status,t("已记录", "Recorded"))}</Pill>}]} rows={audits.slice(0,9)} empty={t("暂无审计记录", "No audit records")}/></ConceptCard><ConceptCard title={t("对账与恢复", "Reconcile & Recovery")}><div className="cp2RecoveryCards"><article><RefreshCw/><span><b>{t("对账不一致", "Reconcile mismatch")}</b><small>{arr(data.reconciliationReports).filter(r=>/failed|mismatch/i.test(String(r.status))).length} {t("项", "")}</small></span></article><article><Activity/><span><b>{t("OMS 恢复能力", "OMS recovery")}</b><small>{arr(data.executionOrders).filter(o=>/unknown|未知/i.test(String(o.status))).length?`${arr(data.executionOrders).filter(o=>/unknown|未知/i.test(String(o.status))).length} ${t("单待恢复", "orders to recover")}`:t("无待恢复单", "None to recover")}</small></span></article><article><AlertTriangle/><span><b>{t("僵尸订单清理", "Zombie order cleanup")}</b><small>{incidents.length} {t("个待观察", "to watch")}</small></span></article><article><Database/><span><b>{t("Outbox 积压", "Outbox backlog")}</b><small>{runs.filter(r=>/pending/i.test(String(r.status))).length} {t("条", "")}</small></span></article></div></ConceptCard></div></div>;
}

// 添加日程事件(向前看):录入已知日期的未来事件(FOMC/CPI/代币解锁/上币等)。
function ScheduledEventDialog({ action, onClose, notify }){
  const [f,setF]=useState({title:"",due:"",category:"宏观",impact:75,note:""}); const [busy,setBusy]=useState(false);
  const up=(k,v)=>setF(c=>({...c,[k]:v}));
  async function submit(){
    if(!f.title.trim())return notify?.(t("请填写事件名称", "Enter an event name"));
    if(!f.due)return notify?.(t("请选择日期时间", "Pick a date/time"));
    setBusy(true);
    const r=await action("/api/events/scheduled",{title:f.title.trim(),due:new Date(f.due).toISOString(),category:f.category,impact:Number(f.impact),note:f.note.trim()});
    setBusy(false);
    if(r&&!r.error){ notify?.(t("日程事件已添加", "Scheduled event added")); onClose(); }
  }
  return <div className="cp2Modal" onClick={onClose}><div className="cp2ModalCard" onClick={e=>e.stopPropagation()}>
    <div className="cp2ModalHead"><b>{t("添加日程事件", "Add Scheduled Event")}</b><button className="cp2ModalX" onClick={onClose}>×</button></div>
    <p className="cp2Intro">{t("录入已知日期的未来事件——会落到事件日历,并提示 Agent 在事件前降敞口（条令 S7）。", "Log a known future event — it lands on the event calendar and prompts the agent to cut exposure before it (doctrine S7).")}</p>
    <label className="cp2FieldLabel">{t("事件名称", "Event name")}</label><input className="cp2Input" value={f.title} onChange={e=>up("title",e.target.value)} placeholder={t("如 美联储 FOMC 议息 / XX 代币解锁", "e.g. FOMC meeting / XX token unlock")} autoFocus/>
    <label className="cp2FieldLabel">{t("日期时间（本地）", "Date/time (local)")}</label><input className="cp2Input" type="datetime-local" value={f.due} onChange={e=>up("due",e.target.value)}/>
    <label className="cp2FieldLabel">{t("类别", "Category")}</label><div className="cp2ChipRow">{["宏观","衍生品","币圈","项目"].map(c=><button key={c} type="button" className={f.category===c?"active":""} onClick={()=>up("category",c)}>{t(c, {"宏观":"Macro","衍生品":"Derivatives","币圈":"Crypto","项目":"Project"}[c]||c)}</button>)}</div>
    <label className="cp2FieldLabel">{t("影响度（0–100，≥70 触发事件静默）", "Impact (0–100, ≥70 triggers blackout)")}</label><input className="cp2Input" type="number" min="0" max="100" value={f.impact} onChange={e=>up("impact",e.target.value)}/>
    <label className="cp2FieldLabel">{t("备注（可选）", "Note (optional)")}</label><input className="cp2Input" value={f.note} onChange={e=>up("note",e.target.value)} placeholder={t("影响逻辑 / 关注点", "Impact rationale / focus")}/>
    <div className="cp2ModalFoot"><button className="cp2Secondary" onClick={onClose}>{t("取消", "Cancel")}</button><button className="cp2Primary" disabled={busy} onClick={submit}>{busy?t("添加中…", "Adding…"):t("添加", "Add")}</button></div>
  </div></div>;
}

export function EventsConcept({ data, action, ui }) {
  const [schedOpen,setSchedOpen]=useState(false);
  const events=buildEventRows(data,t);
  const brief=data.dailyMarketBrief||null; const [selectedId,setSelectedId]=useState(events[0]?.id||""); const selected=events.find(e=>e.id===selectedId)||events[0]||{};
  // 真实月视图:按事件真实日期落格,支持上/下月切换(monthOffset:0=本月,-1上月,+1下月)
  const [monthOffset,setMonthOffset]=useState(0); const [calView,setCalView]=useState("month");
  const _now=new Date(); const _anchor=new Date(_now.getFullYear(),_now.getMonth()+monthOffset,1);
  const _y=_anchor.getFullYear(); const _m=_anchor.getMonth(); const _isThisMonth=monthOffset===0;
  const monthLabel=t(`${_y} 年 ${_m+1} 月`, `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][_m]} ${_y}`);
  const _startWd=new Date(_y,_m,1).getDay(); const _dim=new Date(_y,_m+1,0).getDate(); const _prevDim=new Date(_y,_m,0).getDate();
  const _byDay={}; events.forEach(e=>{const d=new Date(e.due||e.startAt||e.createdAt); if(!isNaN(d.getTime())&&d.getFullYear()===_y&&d.getMonth()===_m){(_byDay[d.getDate()]||(_byDay[d.getDate()]=[])).push(e);}});
  const days=Array.from({length:42},(_,index)=>{const dn=index-_startWd+1; const inMonth=dn>=1&&dn<=_dim; return {n:inMonth?dn:(dn<1?_prevDim+dn:dn-_dim),out:!inMonth,today:_isThisMonth&&inMonth&&dn===_now.getDate(),events:inMonth?(_byDay[dn]||[]):[]};});
  const _todayIdx=days.findIndex(d=>d.today); const _wkStart=_todayIdx>=0?Math.floor(_todayIdx/7)*7:0;
  const shownDays=calView==="week"?days.slice(_wkStart,_wkStart+7):days;
  return <div className="cp2EventsLayout">{schedOpen&&<ScheduledEventDialog action={action} onClose={()=>setSchedOpen(false)} notify={ui.notify}/>}<main><div className="cp2CalendarToolbar"><button className={calView==="month"?"active":""} onClick={()=>setCalView("month")}>{t("月视图", "Month")}</button><button className={calView==="week"?"active":""} onClick={()=>setCalView("week")}>{t("周视图", "Week")}</button><div className="cp2CalNav"><button className="cp2CalArrow" onClick={()=>setMonthOffset(o=>o-1)} title={t("上个月", "Prev month")}><ChevronLeft size={15}/></button><span>{monthLabel}</span><button className="cp2CalArrow" onClick={()=>setMonthOffset(o=>o+1)} title={t("下个月", "Next month")}><ChevronRight size={15}/></button>{monthOffset!==0&&<button className="cp2CalToday" onClick={()=>setMonthOffset(0)}>{t("回到本月", "Today")}</button>}</div><button className="cp2Link" style={{marginLeft:"auto"}} onClick={()=>setSchedOpen(true)}><Plus size={12}/> {t("添加日程", "Add event")}</button><small className="cp2CalHint">{t("按真实事件日期排布", "Laid out by real event dates")}</small></div><div className="cp2Calendar"><div className="week">{["周日","周一","周二","周三","周四","周五","周六"].map((d,wi)=><b key={d}>{t(d, ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][wi])}</b>)}</div><div className="days">{shownDays.map((day,index)=><div key={index} className={`${day.out?"out":""} ${day.today?"today":""}`}><small>{day.n}</small>{day.events.slice(0,3).map(e=><button key={e.id} className={selected.id===e.id?"active":""} onClick={()=>setSelectedId(e.id)}><i className={toneOf(e.impact)}/>{formatTime(e.due||e.startAt)} {localizeText(e.shortTitle||e.title)}</button>)}{day.events.length>3&&<em className="cp2CalMore">+{day.events.length-3}</em>}</div>)}</div></div><div className="cp2Grid two"><ConceptCard title={t("即将发生的事件", "Upcoming Events")}><ConceptTable compact columns={[{key:"due",label:t("时间", "Time"),render:r=>localizeText(formatDateTime(r.due||r.startAt))},{key:"title",label:t("事件", "Event"),render:r=>localizeText(r.title)},{key:"category",label:t("类型", "Type"),render:r=>humanize(r.category)},{key:"impact",label:t("影响", "Impact"),render:r=><Pill tone={num(r.impact)>=80?"bad":"warn"}>{r.impactLabel?humanize(r.impactLabel):(r.impact!=null?r.impact:t("待评估", "TBD"))}</Pill>}]} rows={events.slice(0,7)} empty={t("暂无事件", "No events")}/></ConceptCard><ConceptCard title={t("事件源健康状态", "Event Source Health")}><ConceptTable compact columns={[{key:"name",label:t("来源", "Source"),render:r=>localizeText(r.name)},{key:"category",label:t("类别", "Category"),render:r=>humanize(r.category)},{key:"status",label:t("状态", "Status"),render:r=><Pill tone={toneOf(r.health||r.status)}>{humanize(r.health||r.status,t("正常", "OK"))}</Pill>}]} rows={(arr(data.marketIntelligenceSourceHealth).length?arr(data.marketIntelligenceSourceHealth):arr(data.eventSources).map(s=>({...s,status:s.lastStatus||s.status}))).slice(0,9)} empty={t("暂无事件源", "No event sources")}/></ConceptCard></div></main>
    <aside><ConceptCard title={t("Daily 市场日报", "Daily Market Brief")} meta={brief?formatDateTime(brief.asOf):t("尚未生成","Not generated")}><p className="cp2Intro">{t("只作为分析背景，不会直接触发交易。","Analysis context only; never triggers a trade directly.")}</p>{brief?<><div className="cp2Kv column"><span>{t("版本","Version")}<b>v{brief.version}</b></span><span>{t("证据事实","Evidence facts")}<b>{arr(brief.evidenceFactIds).length}</b></span><span>{t("宏观周期判断","Macro cycle read")}<b>{brief.macroContext?.economicCyclePhase==="insufficient_verified_macro_data"?t("数据不足，不下结论","Insufficient data; no conclusion"):localizeText(brief.macroContext?.economicCyclePhase||t("待生成","Pending"))}</b></span><span>{t("加密市场风险偏好","Crypto risk appetite")}<b>{localizeText(brief.macroContext?.cryptoRiskAppetite||t("未知","Unknown"))}</b></span><span>{t("过期/异常必要源","Stale required sources")}<b>{arr(brief.dataQuality?.staleRequiredSources).length}</b></span></div><div className="cp2InsightList">{arr(brief.topNews).slice(0,3).map(item=><div key={item.factId}><Target size={14}/><span><b>{localizeText(item.title)}</b><small>{item.summary?localizeText(item.summary):formatDateTime(item.publishedAt)}</small></span></div>)}</div>{arr(brief.constraints).slice(0,3).map((item,index)=><p className="cp2Intro" key={index}>⚠ {localizeText(item.reason)}</p>)}</>:<p className="cp2Intro">{t("情报刷新任务运行后自动生成。","Generated automatically after the intelligence refresh task runs.")}</p>}</ConceptCard><ConceptCard title={t("事件详情", "Event Detail")}><Pill tone={num(selected.impact)>=80?"bad":"warn"}>{selected.impactLabel?humanize(selected.impactLabel):t("待评估", "TBD")}</Pill><h3>{selected.title?localizeText(selected.title):t("选择日历事件", "Select a calendar event")}</h3><p>{selected.description||selected.summary?localizeText(selected.description||selected.summary):t("暂无事件说明。", "No event description.")}</p><div className="cp2Kv column"><span>{t("时间", "Time")}<b>{formatDateTime(selected.due||selected.startAt)}</b></span><span>{t("时间精度", "Time precision")}<b>{humanize(selected.timePrecision,"—")}</b></span><span>{t("类别", "Category")}<b>{humanize(selected.category,"—")}</b></span><span>{t("来源", "Source")}<b>{localizeText(selected.source,"—")}</b></span><span>{t("关联资产", "Related assets")}<b>{arr(selected.relatedSymbols).join(" · ")||"—"}</b></span></div><button className="cp2Secondary" onClick={()=>ui.openPanel("eventSources")}>{t("编辑事件", "Edit event")}</button><button className="cp2Primary" onClick={()=>ui.openPanel("eventRule")}>{t("创建规则", "Create rule")}</button></ConceptCard></aside></div>;
}

export function TasksConcept({ data, action, ui }) {
  const tasks=arr(data.tasks); const runs=arr(data.jobRuns); const [selectedId,setSelectedId]=useState(tasks[0]?.id||""); const selected=tasks.find(t=>t.id===selectedId)||tasks[0]||{};
  const latestTaskRun=(task)=>runs.find(run=>run.taskId===task.id||(run.handler&&run.handler===(task.handler||task.type))||(run.taskName&&run.taskName===task.name));
  const taskRuntime=(task)=>{if(task.enabled===false)return {label:t("已暂停","Paused"),tone:"warn"};const run=latestTaskRun(task);if(!run)return {label:t("等待首次运行","Awaiting first run"),tone:"neutral"};if(/running|processing/i.test(String(run.status)))return {label:t("执行中","Running"),tone:"info"};if(/fail|error|timeout|reject/i.test(String(run.status)))return {label:t("最近失败","Last run failed"),tone:"bad"};return {label:t("运行正常","Healthy"),tone:"good"};};
  // 真实自主主链路(按因果执行顺序,不是任务数组的偶然前5个):同步→巡检决策→执行→持仓监控→核算→复盘。
  const CHAIN_ORDER=["market_signal_refresh","okx_readonly_sync","agent_cycle","execution_poll","position_monitor","accounting_refresh","reconcile","trade_reflection"];
  const chainRows=tasks.filter(t=>CHAIN_ORDER.includes(t.handler||t.type)).sort((a,b)=>CHAIN_ORDER.indexOf(a.handler||a.type)-CHAIN_ORDER.indexOf(b.handler||b.type)).slice(0,6);
  // 真实调度健康:按成功率变色,不恒绿;用真实失败数替代写死的"队列延迟 实时"。
  const okRuns=runs.filter(r=>/ok|success|done/i.test(String(r.status))).length;
  const failRuns=runs.filter(r=>/fail|error|timeout|reject/i.test(String(r.status))).length;
  const successPct=runs.length?okRuns/runs.length*100:null;
  const schedHealthy=failRuns===0||(successPct!=null&&successPct>=90);
  return <div className="cp2Stack"><div className={`cp2RiskBanner ${schedHealthy?"good":"warn"}`}>{schedHealthy?<CheckCircle2/>:<AlertTriangle/>}<b>{schedHealthy?t("调度健康", "Scheduler healthy"):t("调度有失败", "Scheduler has failures")}</b><span>{t("任务总数", "Total tasks")} <strong>{tasks.length}</strong></span><span>{t("成功率", "Success rate")} <strong>{successPct!=null?`${successPct.toFixed(1)}%`:"—"}</strong></span><span>{t("失败", "Failures")} <strong>{failRuns}</strong></span><span>{t("执行中", "Running")} <strong>{runs.filter(r=>/running/i.test(String(r.status))).length}</strong></span></div>
    <div className="cp2TasksLayout"><ConceptCard title={t("任务列表", "Task List")} meta={t("“系统托管”表示归属，不代表运行结果", "System-managed is ownership, not runtime health")} action={<button className="cp2Link" onClick={()=>ui.openPanel("taskManager")}><Plus size={11}/> {t("新建任务", "New task")}</button>}><div className="cp2ScrollList tall"><ConceptTable compact columns={[{key:"name",label:t("任务名称", "Task"),render:r=><button className={`cp2Link ${r.id===selected.id?"on":""}`} onClick={()=>setSelectedId(r.id)}>{localizeText(r.name)}</button>},{key:"owner",label:t("归属", "Owner"),render:r=><Pill tone="neutral">{r.systemManaged?t("系统托管","System-managed"):t("用户任务","User task")}</Pill>},{key:"handler",label:t("处理器", "Handler"),render:r=>humanize(r.handler||r.type)},{key:"schedule",label:t("调度", "Schedule")},{key:"nextRunAt",label:t("下次运行", "Next run"),render:r=>formatDateTime(r.nextRunAt)},{key:"runtime",label:t("运行状态", "Runtime"),render:r=>{const state=taskRuntime(r);return <Pill tone={state.tone}>{state.label}</Pill>;}},{key:"enabled",label:t("控制", "Control"),render:r=>r.systemManaged?<span className="cp2ManagedLock" title={t("系统关键任务不可在此关闭","Critical system tasks cannot be disabled here")}><ShieldCheck/>{t("受保护","Protected")}</span>:<button className={`cp2Switch ${r.enabled===false?"":"on"}`} onClick={()=>action(`/api/tasks/${r.id}/${r.enabled===false?"resume":"pause"}`,r.enabled===false?{}:{reason:"manual_ui"})}><i/></button>}]} rows={tasks} empty={t("暂无任务", "No tasks")}/></div></ConceptCard>
      <div className="cp2TasksRail">
        <ConceptCard title={`${t("调度规则", "Schedule Rule")} · ${selected.name?localizeText(selected.name):t("未选择", "None selected")}`}><div className="cp2Kv column"><span>{t("任务 ID", "Task ID")}<b>{selected.id||"—"}</b></span><span>{t("处理器", "Handler")}<b>{humanize(selected.handler||selected.type)}</b></span><span>{t("调度表达式", "Schedule expr")}<b>{selected.schedule||"—"}</b></span><span>{t("下次运行", "Next run")}<b>{formatDateTime(selected.nextRunAt)}</b></span><span>{t("状态", "Status")}<b>{selected.enabled===false?t("已暂停", "Paused"):t("已启用", "Enabled")}</b></span></div><button className="cp2Secondary" onClick={()=>ui.openPanel("taskManager")}>{t("编辑任务", "Edit task")}</button><button className="cp2Primary" disabled={!selected.id} onClick={()=>action(`/api/tasks/${selected.id}/run`,{})}><Play size={12}/> {t("立即运行", "Run now")}</button></ConceptCard>
        <ConceptCard title={t("近期运行", "Recent Runs")}><ConceptTable compact columns={[{key:"createdAt",label:t("时间", "Time"),render:r=>formatTime(r.createdAt)},{key:"name",label:t("任务", "Task"),render:r=>localizeText(r.name||r.taskName||humanize(r.handler))},{key:"durationMs",label:t("耗时", "Duration"),render:r=>r.durationMs?`${r.durationMs} ms`:"—"},{key:"status",label:t("结果", "Result"),render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status)}</Pill>}]} rows={runs.slice(0,10)} empty={t("暂无运行记录", "No runs yet")}/></ConceptCard>
      </div></div>
    <ConceptCard title={t("自主主链路", "Autonomous Main Chain")} meta={t("按真实执行顺序：同步→巡检决策→执行→风控→核算→复盘", "In real execution order: sync → scan/decide → execute → risk → accounting → review")}><div className="cp2Dependency">{chainRows.map((task,index)=><React.Fragment key={task.id||index}><article className={task.id===selected.id?"active":""} onClick={()=>setSelectedId(task.id)}><span><Wrench/></span><b>{localizeText(task.name)}</b><small>{humanize(task.handler||task.type)}</small></article>{index<chainRows.length-1&&<ChevronRight/>}</React.Fragment>)}{!chainRows.length&&<span className="cp2Intro">{t("主链路任务未就绪", "Main-chain tasks not ready")}</span>}</div></ConceptCard></div>;
}

export function AuditConcept({ data }) {
  const logs=arr(data.auditLogs); const [selectedId,setSelectedId]=useState(logs[0]?.id||""); const [q,setQ]=useState("");
  const auditCheck=data.readiness?.checks?.find(c=>c.key==="audit_chain");
  const wormCheck=data.readiness?.checks?.find(c=>c.key==="audit_worm");
  const auditHealthy=auditCheck?.configured===true;
  const shown=logs.filter(l=>!q||[l.actor,l.userName,l.role,l.action,l.resource,l.target,l.id].some(v=>String(v||"").toLowerCase().includes(q.toLowerCase())));
  const selected=logs.find(l=>l.id===selectedId)||shown[0]||logs[0]||{};
  return <div className="cp2Stack"><ConceptCard title={t("审计查询", "Audit Query")}><div className="cp2FilterBar"><span>{t("时间范围", "Time range")} <b>{t("全部", "All")}</b></span><div className="cp2Search"><Search size={13}/><input className="cp2SearchInput" value={q} onChange={e=>setQ(e.target.value)} placeholder={t("搜索操作者 / 动作 / 资源 / 记录 ID", "Search actor / action / resource / record ID")}/></div><button className="cp2Secondary" onClick={()=>setQ("")}>{t("重置", "Reset")}</button></div></ConceptCard>
    <div className="cp2AuditLayout"><ConceptCard title={`${t("审计记录", "Audit Records")} · ${shown.length}/${logs.length} ${t("条", "")}`} meta={t("超 20 条容器内滚动", "Scrolls past 20")}><div className="cp2ScrollList tall"><ConceptTable columns={[{key:"createdAt",label:t("时间", "Time"),render:r=>formatDateTime(r.createdAt)},{key:"actor",label:t("操作者", "Actor"),render:r=>localizeText(r.actor||r.userName||r.role||t("系统", "System"))},{key:"action",label:t("动作", "Action"),render:r=>localizeText(r.action)},{key:"resource",label:t("资源", "Resource"),render:r=>r.resource||r.target||"—"},{key:"status",label:t("结果", "Result"),render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status,t("成功", "Success"))}</Pill>},{key:"id",label:t("记录 ID", "Record ID"),render:r=><button className="cp2Link" onClick={()=>setSelectedId(r.id)}>{String(r.id).slice(0,12)}</button>}]} rows={shown} empty={t("无匹配审计记录", "No matching records")}/></div></ConceptCard>
      <ConceptCard title={t("事件详情", "Event Detail")}><div className="cp2AuditDetail"><div className="cp2Kv column"><span>{t("事件 ID", "Event ID")}<b>{selected.id||"—"}</b></span><span>{t("时间", "Time")}<b>{formatDateTime(selected.createdAt)}</b></span><span>{t("操作者", "Actor")}<b>{localizeText(selected.actor||selected.userName||selected.role||t("系统", "System"))}</b></span><span>{t("动作", "Action")}<b>{localizeText(selected.action)}</b></span><span>{t("资源", "Resource")}<b>{selected.resource||selected.target||"—"}</b></span><span>{t("哈希", "Hash")}<b>{selected.hash?String(selected.hash).slice(0,18):"—"}</b></span></div><b>{t("请求上下文", "Request context")}</b><pre>{JSON.stringify(selected.context||selected.payload||{},null,2)}</pre><b>{t("相关事件", "Related events")}</b><div className="cp2Checklist vertical">{logs.slice(0,4).map((l,index)=><span key={l.id||index}><i className={toneOf(l.status)}/>{formatTime(l.createdAt)} {localizeText(l.action)}</span>)}</div></div></ConceptCard></div>
    <div className="cp2Grid two"><ConceptCard title={t("完整性校验", "Integrity Check")}><div className="cp2Compliance"><ShieldCheck/><span><b>{t("审计链状态", "Audit chain status")}</b><small>{auditHealthy?t("本地哈希链校验通过", "Local hash-chain verification passed"):t("完整性校验失败；系统已阻止新开仓，请保留原库证据", "Integrity check failed; new entries are blocked. Preserve the original database evidence")}</small></span></div></ConceptCard><ConceptCard title={t("数据保留策略", "Data Retention")}><div className="cp2Compliance"><Clock3/><span><b>{t("本地记录持续保留", "Local records retained continuously")}</b><small>{wormCheck?.configured?t("外部 WORM 已配置", "External WORM is configured"):t("外部 WORM 未配置；本地校验不等于不可篡改存储", "External WORM is not configured; local verification is not immutable storage")}</small></span></div></ConceptCard></div></div>;
}

export function NotificationsConcept({ data, action }) {
  const notes=arr(data.notifications); const [category,setCategory]=useState("全部"); const [statusF,setStatusF]=useState("全部状态"); const filtered=notes.filter(n=>(category==="全部"||String(n.category||n.type||"系统").includes(category))&&(statusF==="全部状态"||(statusF==="未读"?!n.read:n.read))); const [selectedId,setSelectedId]=useState(notes[0]?.id||""); const selected=filtered.find(n=>n.id===selectedId)||filtered[0]||{};
  const unread=notes.filter(n=>!n.read).length;
  return <div className="cp2Stack"><div className="cp2Metrics four"><ConceptMetric label={t("未读", "Unread")} value={String(unread)} tone={unread?"bad":"good"} icon={Bell}/><ConceptMetric label={t("严重", "Critical")} value={String(notes.filter(n=>/critical|严重|高危/i.test(String(n.severity||n.level))).length)} tone="bad"/><ConceptMetric label={t("已确认", "Acked")} value={String(notes.filter(n=>n.read).length)} tone="good"/><ConceptMetric label={t("已静默", "Muted")} value={String(notes.filter(n=>n.muted).length)}/></div>
    <div className="cp2NotificationsLayout"><aside className="cp2SideFilter"><b>{t("分类筛选", "Filter")}</b>{["全部","交易","系统","风控","任务","安全"].map(name=><button className={category===name?"active":""} onClick={()=>setCategory(name)} key={name}>{t(name, {"全部":"All","交易":"Trades","系统":"System","风控":"Risk","任务":"Tasks","安全":"Security"}[name]||name)}<span>{name==="全部"?notes.length:notes.filter(n=>String(n.category||n.type||"系统").includes(name)).length}</span></button>)}</aside>
      <ConceptCard title={t("通知收件箱", "Inbox")} meta={`${filtered.length} ${t("条", "")}`}><div className="cp2FilterBar compact"><select value={statusF} onChange={e=>setStatusF(e.target.value)}><option value="全部状态">{t("全部状态", "All statuses")}</option><option value="未读">{t("未读", "Unread")}</option><option value="已读">{t("已读", "Read")}</option></select><div className="cp2Search"><Search size={13}/><span>{t("搜索通知标题或内容", "Search title or content")}</span></div><button className="cp2Secondary" onClick={()=>action("/api/notifications/read",{})}>{t("全部已读", "Mark all read")}</button></div><div className="cp2NotificationList">{filtered.map(n=><button className={n.id===selected.id?"active":""} key={n.id} onClick={()=>setSelectedId(n.id)}><i className={toneOf(n.severity||n.level)}/><div><span><b>{n.title?localizeText(n.title):t("系统通知", "System notice")}</b><Pill tone={toneOf(n.severity||n.level)}>{humanize(n.severity||n.level,t("一般", "Normal"))}</Pill></span><p>{n.message||n.body?localizeText(n.message||n.body):"—"}</p><small>{formatDateTime(n.createdAt)} · {localizeText(n.source||n.category||t("系统", "System"))}</small></div></button>)}</div></ConceptCard>
      <ConceptCard title={t("通知详情", "Notification Detail")}><Pill tone={toneOf(selected.severity||selected.level)}>{humanize(selected.severity||selected.level,t("一般", "Normal"))}</Pill><h3>{selected.title?localizeText(selected.title):t("选择一条通知", "Select a notification")}</h3><p>{selected.message||selected.body?localizeText(selected.message||selected.body):t("暂无通知内容。", "No notification content.")}</p><div className="cp2Kv column"><span>{t("通知 ID", "Notice ID")}<b>{selected.id||"—"}</b></span><span>{t("来源", "Source")}<b>{localizeText(selected.source||selected.category||t("系统", "System"))}</b></span><span>{t("时间", "Time")}<b>{formatDateTime(selected.createdAt)}</b></span><span>{t("状态", "Status")}<b>{selected.read?t("已读", "Read"):t("未读", "Unread")}</b></span></div><button className="cp2Primary" disabled={!selected.id||selected.read} onClick={()=>action("/api/notifications/read",{id:selected.id})}>{selected.read?t("已读", "Read"):t("标记已读", "Mark read")}</button></ConceptCard></div>
    <ConceptCard title={t("投递渠道健康状态", "Delivery Channel Health")}><div className="cp2ChannelGrid">{[[t("邮件", "Email"),data.config?.integrations?.alerts?.hasWebhook],[t("飞书", "Lark"),data.larkConfigured],[t("短信", "SMS"),false],["Telegram",data.telegramConfigured]].map(([name,ok])=><div key={name}><Bell/><span><b>{name}</b><small>{ok?t("正常", "OK"):t("未配置", "Off")}</small></span><Pill tone={ok?"good":"warn"}>{ok?t("可用", "Available"):t("待配置", "Pending")}</Pill></div>)}</div></ConceptCard></div>;
}

function AgentSettingsConcept({ data, action, ui }) {
  const profiles=arr(data.agentProfiles).slice().sort((a,b)=>num(a.order)-num(b.order));
  const [selectedId,setSelectedId]=useState(profiles[0]?.id||"");
  const selected=profiles.find(profile=>profile.id===selectedId)||profiles[0]||{};
  const localizedProfile=(profile)=>({
    ...profile,
    name:localizeText(profile.name,""),
    role:localizeText(profile.role,""),
    mission:localizeText(profile.mission,""),
    declaration:localizeText(profile.declaration,""),
    personality:localizeText(profile.personality,""),
    memoryPolicy:typeof profile.memoryPolicy==="string"?localizeText(profile.memoryPolicy,""):profile.memoryPolicy,
    boundaries:Array.isArray(profile.boundaries)?profile.boundaries.map(item=>localizeText(item,"")):profile.boundaries
  });
  const [draft,setDraft]=useState(()=>localizedProfile(selected));
  const choose=(profile)=>{setSelectedId(profile.id);setDraft(localizedProfile(profile));};
  useEffect(()=>{if(!selectedId&&profiles[0])choose(profiles[0]);},[selectedId,profiles[0]?.id]);
  const update=(key,value)=>setDraft(current=>({...current,[key]:value}));
  const structured=(value,original)=>{
    if(typeof value!=="string"||(!Array.isArray(original)&&!(original&&typeof original==="object")))return value;
    try{return JSON.parse(value);}catch{return Array.isArray(original)?value.split("\n").map(item=>item.trim()).filter(Boolean):original;}
  };
  const save=()=>selected.id&&action(`/api/agent/profiles/${selected.id}`,{
    name:draft.name,role:draft.role,mission:draft.mission,declaration:draft.declaration,
    personality:draft.personality,boundaries:structured(draft.boundaries,selected.boundaries),memoryPolicy:structured(draft.memoryPolicy,selected.memoryPolicy),
    enabled:draft.enabled!==false
  },"PATCH");
  if(!profiles.length)return <ConceptCard title={t("Agent 配置","Agent Configuration")}><div className="cp2Empty"><Bot/><b>{t("Agent 配置尚未加载","Agent profiles have not loaded")}</b><span>{data.resourceState?.systemSettings==="error"?t("系统设置数据加载失败；请刷新后重试。","System settings failed to load. Refresh and try again."):t("正在从系统设置读取真实 Agent 角色；不会显示空白编辑器。","Loading real agent roles from System Settings; an empty editor is never shown as valid data.")}</span><button className="cp2Secondary" onClick={()=>ui.refresh?.(true)}>{t("重新加载","Reload")}</button></div></ConceptCard>;
  return <div className="cp2AgentSettings">
    <ConceptCard title={t("Agent 列表", "Agent List")} action={<Pill>{profiles.length} {t("个", "")}</Pill>}>
      <div className="cp2Search"><Search/><span>{t("搜索 Agent 名称或角色", "Search agent name or role")}</span></div>
      <div className="cp2AgentList">{profiles.map(profile=><button className={profile.id===selected.id?"active":""} key={profile.id} onClick={()=>choose(profile)}><span className="cp2AgentIcon"><Bot/></span><div><b>{localizeText(profile.name)}</b><small>{localizeText(profile.role)}</small></div><em>{profile.enabled===false?t("已停用", "Disabled"):t("已启用", "Enabled")}</em><i>{String(profile.order||"").padStart(2,"0")}</i></button>)}</div>
    </ConceptCard>
    <ConceptCard title={`${t("编辑 Agent", "Edit Agent")}：${selected.name?localizeText(selected.name):t("未选择", "None")}`} action={<div className="cp2FormActions"><button className="cp2Secondary" onClick={()=>selected.id&&action(`/api/agent/profiles/${selected.id}`,{enabled:selected.enabled===false},"PATCH")}>{selected.enabled===false?t("启用", "Enable"):t("停用", "Disable")}</button><button className="cp2Primary" onClick={save}>{t("应用", "Apply")}</button></div>}>
      <div className="cp2AgentEditor">
        <label>{t("Agent 名称", "Agent name")}<input value={draft.name||""} onChange={event=>update("name",event.target.value)}/></label>
        <label>{t("角色说明", "Role")}<input value={draft.role||""} onChange={event=>update("role",event.target.value)}/></label>
        <label className="full">{t("使命", "Mission")}<textarea rows="3" value={draft.mission||""} onChange={event=>update("mission",event.target.value)}/></label>
        <label className="full">{t("系统声明", "System declaration")}<textarea rows="3" value={draft.declaration||""} onChange={event=>update("declaration",event.target.value)}/></label>
        <label>{t("人格风格", "Personality")}<input value={draft.personality||""} onChange={event=>update("personality",event.target.value)}/></label>
        <label>{t("记忆策略", "Memory policy")}<input value={typeof draft.memoryPolicy==="string"?draft.memoryPolicy:JSON.stringify(draft.memoryPolicy||{})} onChange={event=>update("memoryPolicy",event.target.value)}/></label>
        <label className="full">{t("安全边界", "Safety boundaries")}<textarea rows="3" value={typeof draft.boundaries==="string"?draft.boundaries:JSON.stringify(draft.boundaries||{},null,2)} onChange={event=>update("boundaries",event.target.value)}/></label>
      </div>
      <div className="cp2AgentTools"><b>{t("工具权限", "Tool permissions")}</b><div>{arr(selected.tools).map(tool=><Pill key={typeof tool==="string"?tool:tool.name}>{typeof tool==="string"?tool:tool.name}</Pill>)}{!arr(selected.tools).length&&<span>{t("未声明专属工具", "No dedicated tools declared")}</span>}</div></div>
    </ConceptCard>
    <aside className="cp2AgentAside">
      <ConceptCard title={t("版本历史", "Version History")}><div className="cp2Timeline">{profiles.filter(p=>p.id===selected.id).map((profile,index)=><div className="done" key={profile.id||index}><i>✓</i><span><b>{t("当前版本", "Current version")}</b><small>{formatDateTime(profile.updatedAt||profile.createdAt)}</small></span></div>)}</div></ConceptCard>
      <ConceptCard title={t("测试沙箱", "Test Sandbox")}><div className="cp2CodeBox">{t("保存后可前往 AI 交易员，通过真实对话验证当前 Agent 配置。", "After saving, go to the AI Trader and validate this agent config through a real conversation.")}</div><button className="cp2Secondary" onClick={()=>ui.setActive("chat")}>{t("前往测试", "Go test")}</button></ConceptCard>
    </aside>
  </div>;
}

// 用户管理弹窗:新增用户 / 重置他人密码 / Owner 改自己密码。替代原生 prompt()。
function UserManageDialog({ mode, user, action, onClose, notify }) {
  const [f, setF] = useState({ email: "", name: "", password: "", role: "交易用户", freeMonths: 0, newPassword: "" });
  const [busy, setBusy] = useState(false);
  const up = (k, v) => setF((c) => ({ ...c, [k]: v }));
  const title = mode === "create" ? t("新增用户", "Add User") : mode === "ownerpw" ? t("修改 Owner 登录密码", "Change Owner Password") : `${t("重置密码", "Reset Password")} · ${user?.name || user?.email || ""}`;
  async function submit() {
    if (busy) return;
    let req;
    if (mode === "create") {
      if (!f.email.trim()) return notify?.(t("请填写邮箱", "Enter an email"));
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) return notify?.(t("邮箱格式不正确", "Invalid email format"));
      if (f.password.length < 10) return notify?.(t("初始密码至少 10 位", "Initial password must be at least 10 characters"));
      req = ["/api/admin/users", { email: f.email.trim(), name: f.name.trim() || f.email.split("@")[0], password: f.password, role: f.role, freeMonths: Number(f.freeMonths) || 0 }];
    } else if (mode === "reset") {
      if (f.password.length < 10) return notify?.(t("临时密码至少 10 位", "Temporary password must be at least 10 characters"));
      req = [`/api/admin/users/${user.id}/reset-password`, { password: f.password }];
    } else { // ownerpw
      if (f.newPassword.length < 12) return notify?.(t("Owner 密码至少 12 位", "Owner password must be at least 12 characters"));
      req = ["/api/admin/password", { password: f.newPassword }];
    }
    setBusy(true);
    const r = await action(req[0], req[1]);
    setBusy(false);
    if (!r || r.error) return; // action 自身已提示错误
    onClose();
  }
  return <div className="cp2Modal" onClick={onClose}><div className="cp2ModalCard" onClick={(e) => e.stopPropagation()}>
    <div className="cp2ModalHead"><b>{title}</b><button className="cp2ModalX" onClick={onClose}>×</button></div>
    {mode === "create" && <>
      <label className="cp2FieldLabel">{t("邮箱", "Email")}</label>
      <input className="cp2Input" type="email" value={f.email} onChange={(e) => up("email", e.target.value)} placeholder="user@example.com" autoFocus />
      <label className="cp2FieldLabel">{t("姓名（可留空，默认取邮箱前缀）", "Name (optional, defaults to email prefix)")}</label>
      <input className="cp2Input" value={f.name} onChange={(e) => up("name", e.target.value)} placeholder={t("选填", "Optional")} />
      <label className="cp2FieldLabel">{t("初始密码（至少 10 位）", "Initial password (min 10 chars)")}</label>
      <input className="cp2Input" type="text" value={f.password} onChange={(e) => up("password", e.target.value)} placeholder={t("用户登录后应自行更换", "User should change it after logging in")} />
      <label className="cp2FieldLabel">{t("角色", "Role")}</label>
      <div className="cp2ChipRow">{["交易用户", "管理员"].map((r) => <button key={r} className={f.role === r ? "active" : ""} onClick={() => up("role", r)}>{t(r, {"交易用户":"Trader","管理员":"Admin"}[r]||r)}</button>)}</div>
      <label className="cp2FieldLabel">{t("赠送免费授权（月，0 = 不赠送）", "Free grant (months, 0 = none)")}</label>
      <input className="cp2Input" type="number" min="0" max="60" value={f.freeMonths} onChange={(e) => up("freeMonths", e.target.value)} />
    </>}
    {mode === "reset" && <>
      <p className="cp2Intro">{t("为该用户设置一个临时密码，TA 登录后需在「账户 → 修改密码」自行更换。", "Set a temporary password for this user; they must change it under Account → Change Password after logging in.")}</p>
      <label className="cp2FieldLabel">{t("临时密码（至少 10 位）", "Temporary password (min 10 chars)")}</label>
      <input className="cp2Input" type="text" value={f.password} onChange={(e) => up("password", e.target.value)} autoFocus />
    </>}
    {mode === "ownerpw" && <>
      <p className="cp2Intro">{t("修改 Owner 登录密码后会立即退出登录，请用新密码重新登录。", "Changing the Owner password logs you out immediately; sign in again with the new password.")}</p>
      <label className="cp2FieldLabel">{t("新密码（至少 12 位）", "New password (min 12 chars)")}</label>
      <input className="cp2Input" type="text" value={f.newPassword} onChange={(e) => up("newPassword", e.target.value)} autoFocus />
    </>}
    <div className="cp2ModalFoot"><button className="cp2Secondary" onClick={onClose}>{t("取消", "Cancel")}</button><button className="cp2Primary" disabled={busy} onClick={submit}>{busy ? t("提交中…", "Submitting…") : t("确定", "Confirm")}</button></div>
  </div></div>;
}

function UsersSettingsConcept({ data, action, ui }) {
  const users=arr(data.users); const subscriptions=arr(data.subscriptions); const profiles=arr(data.agentProfiles);
  const [selectedId,setSelectedId]=useState(users[0]?.id||""); const selected=users.find(user=>user.id===selectedId)||users[0]||{};
  const subscription=subscriptions.find(item=>item.userId===selected.id||item.tenantId===selected.tenantId)||{};
  const [dialog,setDialog]=useState(null); // {mode,user}
  const regMode=data.registrationMode||"closed"; const applications=arr(data.registrationApplications); const capacity=data.registrationCapacity||{};
  const [lastInviteCode,setLastInviteCode]=useState("");
  const setRegistrationMode=async (mode)=>{
    if(mode!=="closed"&&!await uiConfirm(t("公开入口只会收集独立客户实例申请，不会把访客加入 Owner 交易工作区。确认切换？", "The public entry only collects isolated-instance applications; it never adds visitors to the Owner workspace. Continue?")))return;
    action("/api/admin/registration",{mode});
  };
  const createInvite=async ()=>{const result=await action("/api/admin/registration/invites",{label:"Owner 邀请",maxUses:1});if(result?.code)setLastInviteCode(result.code);};
  const changePassword=()=>setDialog({mode:selected.isOwner?"ownerpw":"reset",user:selected});
  return <div className="cp2Stack">
    {dialog&&<UserManageDialog mode={dialog.mode} user={dialog.user} action={action} notify={ui.notify} onClose={()=>setDialog(null)}/>}
    <div className="cp2Metrics six"><ConceptMetric label={t("活跃用户", "Active users")} value={`${users.filter(u=>u.status!=="disabled").length}/${users.length}`}/><ConceptMetric label={t("订阅计划", "Plans")} value={String(arr(data.subscriptionPlans).length)} sub={t("套餐", "Tiers")}/><ConceptMetric label={t("到期时间", "Expiry")} value={formatDateTime(subscription.currentPeriodEnd)} sub={t("当前选中用户", "Selected user")}/><ConceptMetric label={t("用户数", "Users")} value={String(users.length)} sub={t("本实例", "This instance")}/><ConceptMetric label={t("使用额度", "Usage")} value={`${arr(data.llmRuns).length}`} sub={t("模型调用", "Model calls")}/><ConceptMetric label={t("即将到期", "Expiring soon")} value={String(subscriptions.filter(s=>s.currentPeriodEnd&&new Date(s.currentPeriodEnd).getTime()-Date.now()<30*86400000).length)} sub={t("30 天内", "Within 30 days")}/></div>
    <div className="cp2UsersLayout">
      <ConceptCard title={t("用户列表", "User List")} action={<button className="cp2Primary" onClick={()=>setDialog({mode:"create"})}><Plus size={12}/> {t("新增用户", "Add user")}</button>}>
        <div className="cp2Search"><Search/><span>{t("搜索姓名 / 邮箱 / 角色", "Search name / email / role")}</span></div>
        <ConceptTable columns={[{key:"name",label:t("用户", "User"),render:r=><button className="cp2UserName" onClick={()=>setSelectedId(r.id)}><i>{r.avatar?<img src={r.avatar} alt=""/>:String(r.name||r.email||"?").charAt(0)}</i><span><b>{r.name||r.email}</b><small>{r.email}</small></span></button>},{key:"role",label:t("角色", "Role"),render:r=><select value={r.role||"交易用户"} disabled={r.isOwner} onChange={event=>action(`/api/admin/users/${r.id}`,{role:event.target.value},"PATCH")}><option value="交易用户">{t("交易用户", "Trader")}</option><option value="管理员">{t("管理员", "Admin")}</option></select>},{key:"status",label:t("状态", "Status"),render:r=><Pill tone={r.status==="disabled"?"warn":"good"}>{r.status==="disabled"?t("已停用", "Disabled"):t("正常", "Active")}</Pill>},{key:"createdAt",label:t("创建时间", "Created"),render:r=>formatDateTime(r.createdAt)}]} rows={users} empty={t("暂无用户", "No users")}/>
      </ConceptCard>
      <ConceptCard title={t("用户详情", "User Detail")} action={<div className="cp2FormActions"><button className="cp2Secondary" disabled={selected.isOwner} onClick={()=>action(`/api/admin/users/${selected.id}`,{status:selected.status==="disabled"?"active":"disabled"},"PATCH")}>{selected.status==="disabled"?t("启用用户", "Enable user"):t("停用用户", "Disable user")}</button><button className="cp2Secondary" onClick={changePassword}>{selected.isOwner?t("修改 Owner 密码", "Change Owner password"):t("重置密码", "Reset password")}</button></div>}>
        <div className="cp2UserDetailHead"><i>{selected.avatar?<img src={selected.avatar} alt=""/>:String(selected.name||selected.email||"?").charAt(0)}</i><span><b>{selected.name||t("选择用户", "Select a user")}</b><small>{selected.email||"—"}</small></span><Pill tone={selected.status==="disabled"?"warn":"good"}>{selected.status==="disabled"?t("已停用", "Disabled"):t("正常", "Active")}</Pill></div>
        <div className="cp2Kv column"><span>{t("角色", "Role")}<b>{selected.isOwner?t("Owner（不可改）", "Owner (locked)"):<select className="cp2InlineSelect" value={selected.role||"交易用户"} onChange={e=>action(`/api/admin/users/${selected.id}`,{role:e.target.value},"PATCH")}><option value="交易用户">{t("交易用户", "Trader")}</option><option value="管理员">{t("管理员", "Admin")}</option></select>}</b></span><span>{t("租户 ID", "Tenant ID")}<b>{selected.tenantId||"—"}</b></span><span>{t("创建时间", "Created")}<b>{formatDateTime(selected.createdAt)}</b></span><span>{t("最近更新", "Updated")}<b>{formatDateTime(selected.updatedAt)}</b></span></div>
        <b className="cp2Subhead">{t("角色权限", "Role Permissions")}</b><div className="cp2TokenBox">{["资产只读","风险设置","交易审批","知识库访问",...(selected.isOwner?["系统管理","用户管理"]:[])].map(name=><Pill key={name}>{t(name, {"资产只读":"Read assets","风险设置":"Risk settings","交易审批":"Trade approval","知识库访问":"Knowledge access","系统管理":"System admin","用户管理":"User admin"}[name]||name)}</Pill>)}</div>
        <div className="cp2SubscriptionCard"><div><small>{t("订阅计划", "Plan")}</small><b>{subscription.planId||t("未订阅", "None")}</b></div><div><small>{t("到期时间", "Expiry")}</small><b>{formatDateTime(subscription.currentPeriodEnd)}</b></div><div><small>{t("席位（本租户用户）", "Seats (tenant users)")}</small><b>{users.filter(u=>u.tenantId&&u.tenantId===selected.tenantId).length||1} {t("人", "")}</b></div><button className="cp2Secondary" disabled={selected.isOwner} onClick={()=>action(`/api/admin/users/${selected.id}/grant-free`,{months:12})}>{t("续期 12 月", "Renew 12 mo")}</button></div>
        <div className="cp2Usage"><span>{t("使用额度", "Usage")} <b>{arr(data.llmRuns).filter(run=>run.userId===selected.id).length} {t("次模型调用", "model calls")}</b></span><small style={{color:"var(--text-4)",fontSize:"10.5px"}}>{t("无配额上限（一实例一客户）", "No quota cap (one instance per client)")}</small></div>
      </ConceptCard>
      <aside><ConceptCard title={t("订阅概况", "Subscription Overview")}><div className="cp2Kv column"><span>{t("有效订阅", "Active subs")}<b>{subscriptions.filter(s=>["active","trialing"].includes(s.status)).length}</b></span><span>{t("免费授权", "Free grants")}<b>{subscriptions.filter(s=>s.source==="owner_grant").length}</b></span><span>{t("Agent 启用", "Agents on")}<b>{profiles.filter(p=>p.enabled!==false).length}/{profiles.length}</b></span></div>
        <b className="cp2Subhead">{t("客户实例申请", "Customer Applications")}</b>
        <div className="cp2ChipRow">{[["closed",t("关闭", "Closed")],["invite",t("邀请", "Invite")],["waitlist",t("公开候补", "Public waitlist")],["auto",t("自动开通", "Automatic")]].map(([mode,label])=><button key={mode} className={regMode===mode?"active":""} onClick={()=>setRegistrationMode(mode)}>{label}</button>)}</div>
        <div className="cp2Kv column"><span>{t("当前模式", "Current mode")}<b>{regMode}</b></span><span>{t("可用容量", "Available capacity")}<b>{capacity.available??0}/{capacity.max??0}</b></span><span>{t("待处理申请", "Pending applications")}<b>{applications.filter(item=>!["active","rejected","archived"].includes(item.status)).length}</b></span></div>
        <button className="cp2Secondary" onClick={createInvite}>{t("生成一次性邀请码", "Create one-time invite")}</button>
        {lastInviteCode&&<div className="cp2TokenBox"><b>{lastInviteCode}</b><small>{t("明文只显示这一次，请立即安全交付。", "Shown once only; deliver it securely now.")}</small></div>}
      </ConceptCard>
      <ConceptCard title={t("开通申请队列", "Onboarding Queue")}>
        {applications.slice(0,10).map(item=><div className="cp2SubscriptionCard" key={item.id}><div><small>{item.email}</small><b>{item.name||item.id}</b><small>{item.status}</small></div><div className="cp2FormActions">{!item.emailVerifiedAt&&<button className="cp2Secondary" onClick={()=>action(`/api/admin/registration/applications/${item.id}/verify-email`,{})}>{t("人工验邮箱", "Verify email")}</button>}{["waitlisted","capacity_waitlist","provision_failed"].includes(item.status)&&<button className="cp2Primary" disabled={!capacity.canProvision} onClick={()=>action(`/api/admin/registration/applications/${item.id}`,{status:"approved"},"PATCH")}>{t("批准", "Approve")}</button>}{item.status==="approved"&&<button className="cp2Primary" onClick={()=>action(`/api/admin/registration/applications/${item.id}/payment`,{planId:item.planId})}>{t("生成支付单", "Request payment")}</button>}{item.status==="paid"&&<Pill tone="good">{t("可开通实例", "Ready to provision")}</Pill>}{!["active","paid","provisioning","refund_pending","refunded","rejected","archived"].includes(item.status)&&<button className="cp2Secondary" onClick={()=>action(`/api/admin/registration/applications/${item.id}`,{status:"rejected"},"PATCH")}>{t("拒绝", "Reject")}</button>}</div></div>)}
        {!applications.length&&<p className="cp2Intro">{t("暂无客户实例申请。", "No customer applications yet.")}</p>}
      </ConceptCard></aside>
    </div>
  </div>;
}

export function SettingsConcept({ data, action, ui, activeTab, onTabChange }) {
  const isOwner = data.user?.isOwner === true;
  const [baseSection, setBaseSection] = useState("environment");
  const [pendingBaseSection, setPendingBaseSection] = useState("");
  const config = data.config || {};
  const exchanges = arr(data.exchangeAccounts);
  const agents = arr(data.agentProfiles);
  const users = arr(data.users);
  const subscriptions = arr(data.subscriptions);
  const snapshots = arr(data.accountSnapshots);
  const integrations = config.integrations || {};
  const providerCount = Object.values(config.llm?.providers || {}).filter((provider) => provider.hasKey).length;
  const connectedExchange = exchanges.some((exchange) => exchange.exchange === "OKX" && exchange.readEnabled);
  const enabledAgents = agents.filter((agent) => agent.enabled !== false && !/disabled|停用/i.test(String(agent.status || ""))).length;
  const runtime = automationPresentation(data);
  const runtimeTone = runtime.tone === "ok" ? "good" : runtime.tone === "danger" ? "bad" : runtime.tone === "warning" ? "warn" : "neutral";
  const notificationsConfigured = Boolean(integrations.telegram?.configured || integrations.lark?.hasWebhook || integrations.alerts?.hasWebhook);
  const activeSubscriptions = subscriptions.filter((item) => ["active", "trialing"].includes(String(item.status || "").toLowerCase()));
  const userStatus = isOwner ? t("Owner 工作区", "Owner workspace") : activeSubscriptions.length ? t("订阅有效", "Subscription active") : t("待订阅", "Subscription pending");
  const userTone = isOwner || activeSubscriptions.length ? "good" : "warn";
  const baseSections = [
    { id: "environment", icon: Server, label: t("环境与服务", "Environment & Services"), note: t("运行环境、端口与沙箱", "Runtime, port, and sandbox") },
    { id: "network", icon: Globe2, label: t("网络代理", "Network Proxy"), note: t("服务端外部连接", "Outbound server access") },
    { id: "data_backup", icon: Database, label: t("数据与备份", "Data & Backup"), note: t("一致性快照与恢复", "Snapshots and recovery") },
    { id: "security", icon: ShieldCheck, label: t("登录与凭证安全", "Sign-in & Credential Security"), note: t("登录保护与 Owner 密码", "Sign-in protection and owner password") }
  ];
  const tabs = [
    ["overview", t("系统概览", "Overview")],
    ["base", t("基础配置", "Basics")],
    ["exchange", t("OKX 配置", "OKX Settings")],
    ["notifications", t("通知渠道", "Notifications")],
    ["models", t("模型与密钥", "Models & Keys")],
    ["agents", t("Agent 配置", "Agents")],
    ...(isOwner ? [["users", t("用户与订阅", "Users & Subscriptions")]] : [])
  ];
  const tab = tabs.some(([id]) => id === activeTab) ? activeTab : "overview";

  useEffect(() => {
    if (tab !== "base") return undefined;
    const sections = baseSections.map(({ id }) => document.getElementById(`settings-base-${id}`)).filter(Boolean);
    if (!sections.length) return undefined;
    const scroller = sections[0].closest(".content") || window;
    const updateActiveSection = () => {
      const isWindow = scroller === window;
      const viewportTop = isWindow ? 0 : scroller.getBoundingClientRect().top;
      const atBottom = isWindow
        ? window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4
        : scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
      if (atBottom) {
        setBaseSection(sections[sections.length - 1].dataset.settingsSection);
        return;
      }
      const activationLine = viewportTop + 180;
      const active = sections.slice().reverse().find((section) => section.getBoundingClientRect().top <= activationLine) || sections[0];
      setBaseSection(active.dataset.settingsSection);
    };
    updateActiveSection();
    scroller.addEventListener("scroll", updateActiveSection, { passive: true });
    window.addEventListener("resize", updateActiveSection);
    return () => {
      scroller.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("resize", updateActiveSection);
    };
  }, [tab]);

  useEffect(() => {
    if (tab !== "base" || !pendingBaseSection) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(`settings-base-${pendingBaseSection}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      setPendingBaseSection("");
    });
    return () => cancelAnimationFrame(frame);
  }, [tab, pendingBaseSection]);

  const scrollToBaseSection = (section) => {
    setBaseSection(section);
    document.getElementById(`settings-base-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const openBaseSection = (section) => {
    setBaseSection(section);
    setPendingBaseSection(section);
    onTabChange("base");
  };

  const overviewCards = [
    {
      id: "environment", icon: Server, title: t("环境与服务", "Environment & Services"),
      description: t("核心运行环境与服务通道", "Core runtime and service channels"), status: t("服务可用", "Available"), tone: "good",
      metrics: [[t("运行环境", "Environment"), config.runtime?.environment || t("本地", "Local")], [t("数据库", "Database"), "SQLite"], [t("实时传输", "Realtime"), "WebSocket / SSE"]],
      onOpen: () => openBaseSection("environment"), actionLabel: t("打开基础配置", "Open basics")
    },
    {
      id: "models", icon: KeyRound, title: t("模型与密钥", "Models & Keys"),
      description: t("对话、分析与嵌入模型", "Chat, analysis, and embedding models"), status: providerCount ? t("已配置", "Configured") : t("待配置", "Needs setup"), tone: providerCount ? "good" : "warn",
      metrics: [[t("当前模型", "Active model"), config.llm?.activeProvider || t("未配置", "Unconfigured")], [t("嵌入模型", "Embedding model"), config.llm?.embeddingModel || t("未配置", "Unconfigured")], ["API Key", `${providerCount} ${t("个", "")}`]],
      onOpen: () => onTabChange("models"), actionLabel: t("管理模型", "Manage models")
    },
    {
      id: "exchange", icon: WalletCards, title: t("OKX 配置", "OKX Settings"),
      description: t("凭证、权限、IP 白名单与账户模式的唯一入口", "The single place for credentials, permissions, IP allowlists, and account mode"), status: connectedExchange ? t("已接入", "Connected") : t("待配置", "Needs setup"), tone: connectedExchange ? "good" : "warn",
      metrics: [[t("交易所", "Exchange"), "OKX"], [t("账户读取", "Account read"), connectedExchange ? t("已开启", "Enabled") : t("未连接", "Disconnected")], [t("连接数量", "Connections"), String(exchanges.length)]],
      onOpen: () => onTabChange("exchange"), actionLabel: t("管理 OKX", "Manage OKX")
    },
    {
      id: "notifications", icon: Bell, title: t("通知渠道", "Notification Channels"),
      description: t("Telegram、飞书与外部告警的唯一入口", "The single place for Telegram, Lark, and external alerts"), status: notificationsConfigured ? t("已配置", "Configured") : t("待配置", "Needs setup"), tone: notificationsConfigured ? "good" : "warn",
      metrics: [["Telegram", integrations.telegram?.configured ? t("已开启", "Enabled") : t("未配置", "Off")], [t("飞书", "Lark"), integrations.lark?.hasWebhook ? t("已开启", "Enabled") : t("未配置", "Off")], ["Webhook", integrations.alerts?.hasWebhook ? t("已开启", "Enabled") : t("未配置", "Off")]],
      onOpen: () => onTabChange("notifications"), actionLabel: t("管理通知", "Manage notifications")
    },
    {
      id: "agents", icon: Bot, title: t("Agent 配置", "Agent Configuration"),
      description: t("角色、模型与工具权限", "Roles, models, and tool permissions"), status: agents.length ? t("运行中", "Running") : t("暂无 Agent", "No agents"), tone: agents.length ? "good" : "warn",
      metrics: [[t("Agent 总数", "Total agents"), String(agents.length)], [t("已启用", "Enabled"), String(enabledAgents)], [t("已停用", "Disabled"), String(Math.max(0, agents.length - enabledAgents))]],
      onOpen: () => onTabChange("agents"), actionLabel: t("管理 Agent", "Manage agents")
    },
    {
      id: "users", icon: Users, title: t("用户与订阅", "Users & Subscriptions"),
      description: t("账户、角色与订阅状态", "Accounts, roles, and subscription status"), status: userStatus, tone: userTone,
      metrics: [[t("当前用户", "Current user"), data.user?.name || "—"], [t("用户数量", "Users"), String(users.length || 1)], [t("订阅计划", "Subscriptions"), String(subscriptions.length)]],
      onOpen: isOwner ? () => onTabChange("users") : null, actionLabel: t("管理用户", "Manage users")
    },
    {
      id: "backup", icon: Database, title: t("备份与维护", "Backup & Maintenance"),
      description: t("配置与交易事实恢复能力", "Recovery for settings and trade facts"), status: t("服务可用", "Available"), tone: "good",
      metrics: [[t("恢复点", "Restore points"), String(snapshots.length)], [t("备份方式", "Backup mode"), t("在线快照", "Online snapshot")], [t("运行影响", "Runtime impact"), t("无需停机", "No downtime")]],
      onOpen: () => openBaseSection("data_backup"), actionLabel: t("管理备份", "Manage backups")
    }
  ];

  const activeTabLabel = tabs.find(([id]) => id === tab)?.[1] || t("系统概览", "Overview");
  return <div className="cp2Settings productSettings" data-workspace="settings">
    <header className="uxProductHeader">
      <div className="uxProductIdentity"><small>06 / SYSTEM SETTINGS</small><h1>{t("系统设置", "System Settings")}</h1><p>{t("每项配置只有一个权威入口；先看当前健康，再修改并确认影响范围", "Every setting has one authoritative home; inspect current health before changing and confirming its impact")}</p></div>
      <aside className="uxProductCurrent" aria-label={t("当前设置页面", "Current settings section")}><small>CURRENT WORKSPACE</small><b>{activeTabLabel}</b><span>{t("配置状态与实际运行状态分开显示，只有服务端确认后才视为生效", "Configuration state and effective runtime state stay separate; changes are effective only after server confirmation")}</span></aside>
    </header>
    <nav className="uxTabs cp2SettingsTabs" aria-label={t("系统设置导航", "System settings navigation")}>{tabs.map(([id, label]) => <button type="button" role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} key={id} onClick={() => onTabChange(id)}>{label}</button>)}</nav>

    {tab === "overview" && <section className="cp2SettingsOverview">
      <header className="cp2SettingsPageHead cp2OverviewHead">
        <div><small>{t("SYSTEM OVERVIEW", "SYSTEM OVERVIEW")}</small><h2>{t("系统运行概览", "System overview")}</h2><p>{t("在一个页面检查关键服务的配置与运行状态；需要修改时再进入对应配置。", "Check the configuration and operating state of key services in one place, then open the relevant settings when changes are needed.")}</p></div>
        <div className={`cp2OverviewHealth ${runtimeTone}`}><i/><span><small>{t("当前运行状态", "Current operating state")}</small><b>{runtime.label}</b></span></div>
      </header>
      <div className="cp2OverviewGrid">{overviewCards.map(({ id, icon: Icon, title, description, status, tone, metrics, onOpen, actionLabel }) => <article className="cp2OverviewCard" key={id}>
        <header><span className={`cp2OverviewIcon ${tone}`}><Icon size={18}/></span><div><b>{title}</b><small>{description}</small></div><Pill tone={tone}>{status}</Pill></header>
        <div className="cp2OverviewFacts">{metrics.map(([label, value]) => <span key={label}><small>{label}</small><b title={String(value)}>{value}</b></span>)}</div>
        {onOpen && <button type="button" className="cp2OverviewOpen" onClick={onOpen}>{actionLabel}<ChevronRight size={14}/></button>}
      </article>)}</div>
    </section>}

    {tab === "base" && <section className="cp2SettingsBasePage">
      <header className="cp2SettingsPageHead">
        <div><small>{t("BASIC CONFIGURATION", "BASIC CONFIGURATION")}</small><h2>{t("基础配置", "Basic configuration")}</h2><p>{t("四个基础模块集中在同一页面；左侧目录用于快速定位，每个模块独立保存。", "All four foundational modules live on one page. Use the directory to jump between them; each module saves independently.")}</p></div>
        <div className="cp2BaseCount"><b>4</b><span>{t("个配置模块", "configuration modules")}</span></div>
      </header>
      <div className="cp2SettingsBase">
        <aside className="cp2SideFilter cp2BaseDirectory" aria-label={t("基础配置页内目录", "Basic configuration page directory")}>
          <div><small>{t("本页目录", "ON THIS PAGE")}</small><b>{t("基础配置", "Basic configuration")}</b></div>
          {baseSections.map(({ id, icon: Icon, label, note }, index) => <button type="button" className={baseSection === id ? "active" : ""} aria-current={baseSection === id ? "location" : undefined} key={id} onClick={() => scrollToBaseSection(id)}><i><Icon size={15}/></i><span><b>{String(index + 1).padStart(2, "0")} · {label}</b><small>{note}</small></span><ChevronRight size={13}/></button>)}
        </aside>
        <div className="cp2BaseSections">{baseSections.map(({ id }) => <section id={`settings-base-${id}`} data-settings-section={id} className="cp2SettingsPanel cp2BaseSection" key={id}><SystemConfigPanel data={data} action={action} section={id}/></section>)}</div>
      </div>
    </section>}

    {tab === "exchange" && <div className="cp2SettingsForm"><section className="cp2SettingsPanel"><SystemConfigPanel data={data} action={action} section="exchange"/></section></div>}
    {tab === "notifications" && <div className="cp2SettingsForm"><section className="cp2SettingsPanel"><SystemConfigPanel data={data} action={action} section="notifications"/></section></div>}
    {tab === "models" && <div className="cp2SettingsForm"><section className="cp2SettingsPanel"><SystemConfigPanel data={data} action={action} section="llm"/></section></div>}
    {tab === "agents" && <AgentSettingsConcept data={data} action={action} ui={ui}/>}
    {tab === "users" && isOwner && <UsersSettingsConcept data={data} action={action} ui={ui}/>}
  </div>;
}
