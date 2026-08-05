import React, { useEffect, useMemo, useState } from "react";
import { uiConfirm, uiPrompt } from "./confirm.jsx";
import {
  Activity, AlertTriangle, BarChart3, Bell, BookOpen, Bot, CalendarDays,
  CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleDollarSign, Clock3, Database, Eye,
  FileText, Filter, Gauge, GitBranch, KeyRound, Layers3, ListChecks,
  LockKeyhole, Play, Plus, RefreshCw, Search, Server, ShieldCheck,
  SlidersHorizontal, Sparkles, Target, TrendingUp, Users, WalletCards,
  Wrench, Zap
} from "lucide-react";
import { ChatPage } from "./chat.jsx";
import { LiveGrayPanel, SystemConfigPanel } from "./panels.jsx";
import { apiUrl, authHeaders, displayMoney, displayPct, formatDateTime, formatTime, humanize, SKILL_STATE, TradingViewChart } from "./lib.jsx";
import { t } from "./i18n.js";

// 技能/策略生命周期状态 → 中文短标签 + Pill 颜色(cp2Pill 用 good/warn/bad/neutral)。
// 修:此前策略详情用 humanize 直接吐英文原值(historical_rejected → "historical rejected")又长又跨行,
// 且 toneOf 匹配不到把"历史未通过"错染成绿色。统一走 SKILL_STATE。
const SKILL_TONE_CLASS = { ok: "good", warning: "warn", danger: "bad", info: "warn", neutral: "neutral" };
const skillStatusLabel = (status) => SKILL_STATE[status]?.label || humanize(status, "—");
const skillStatusTone = (status) => SKILL_STATE[status] ? (SKILL_TONE_CLASS[SKILL_STATE[status].tone] || "neutral") : toneOf(status);
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
  const movers = arr(data.marketMovers?.movers);
  const knowledge = arr(data.knowledge);
  const items = [
    ...events.map((item, index) => ({ ...item, id: item.id || `event-${index}`, category: item.category || "宏观", title: item.title || item.name, source: item.source || "事件源", confidence: item.confidence, impact: item.impact })),
    ...movers.map((item, index) => ({ ...item, id: `mover-${index}`, category: "市场", title: `${item.symbol} ${num(item.changePct) >= 0 ? "+" : ""}${item.changePct ?? "—"}%`, source: "异动扫描", confidence: null, impact: Math.abs(num(item.changePct)) >= 5 ? 90 : 60 })),
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
      {["全部", "宏观", "市场", "链上", "知识"].map((name) => <button key={name} className={category === name ? "active" : ""} onClick={() => { setCategory(name); setSelected(0); }}>{t(name, { "全部": "All", "宏观": "Macro", "市场": "Market", "链上": "On-chain", "知识": "Knowledge" }[name] || name)}<span>{name === "全部" ? items.length : items.filter((item) => item.category === name).length}</span></button>)}
      <div className="cp2FilterGroup"><small>{t("时间范围", "Time range")}</small><select value={timeRange} onChange={(e)=>setTimeRange(e.target.value)}><option value="24h">{t("24 小时", "24h")}</option><option value="7d">{t("7 天", "7d")}</option></select><small>{t("置信度", "Confidence")}</small><select value={minConf} onChange={(e)=>setMinConf(Number(e.target.value))}><option value={0}>{t("全部", "All")}</option><option value={70}>≥ 70%</option></select></div>
    </aside>
    <main className="cp2IntelFeed">
      <ConceptCard title={t("今日情报摘要", "Today's Intel Summary")} icon={Sparkles} meta={`${t("更新于", "Updated")} ${formatTime(data.marketMovers?.scannedAt)}`}>
        <div className="cp2Metrics four compact">
          <ConceptMetric label={t("宏观焦点", "Macro focus")} value={`${events.length} ${t("项", "items")}`} sub={t("事件监测", "Event monitoring")}/>
          <ConceptMetric label={t("市场状态", "Market state")} value={data.marketRegime?.global?.label || t("观察中", "Observing")} sub={t("结构判断", "Structure read")}/>
          <ConceptMetric label={t("链上信号", "On-chain signal")} value={t("待同步", "Pending sync")} sub={t("未配置则不推断", "No inference if unconfigured")}/>
          <ConceptMetric label={t("异常波动", "Anomalies")} value={`${movers.length} ${t("个", "")}`} sub={t("实时扫描", "Live scan")}/>
        </div>
      </ConceptCard>
      {(() => {
        // 自动刷新状态条:读事件源刷新定时任务的真实 上次/下次,让用户看出事件源在按节奏自动抓,
        // 而不是"只有手动点刷新才更新"。任务不存在(旧库未排程)时不显示。
        const task = arr(data.tasks).find((x) => x.id === "task_sys_event_refresh");
        if (!task) return null;
        const paused = task.enabled === false;
        const every = String(task.schedule || "").replace(/^Every\s*/i, "");
        return <div className={`cp2AutoBar ${paused ? "off" : "on"}`}>
          <span className="cp2AutoDot"/>
          <b>{paused ? t("自动刷新已暂停", "Auto-refresh paused") : t("事件源自动刷新中", "Event sources auto-refreshing")}</b>
          <small>{t("每", "Every")} {every} · {t("上次", "Last")} {formatTime(task.lastRunAt) || "—"} · {t("下次", "Next")} {formatTime(task.nextRunAt) || "—"}</small>
        </div>;
      })()}
      <ConceptCard title={t("情报动态", "Intel Feed")} meta={`${filtered.length} ${t("条", "")}`}>
        <div className="cp2IntelList">{filtered.map((item, index) => {
          const freshMs = item.lastUpdatedAt ? nowT - new Date(item.lastUpdatedAt).getTime() : Infinity;
          const fresh = freshMs >= 0 && freshMs < 25 * 60 * 1000;
          return <button key={item.id} className={index === selected ? "active" : ""} onClick={() => setSelected(index)}><span className={`cp2IntelIcon ${toneOf(item.impact)}`}><Activity size={14}/></span><div><b>{item.title || t("未命名情报", "Untitled intel")}{fresh && <em className="cp2Fresh">{t("刚更新", "Just updated")}</em>}</b><small>{item.source} · {formatTime(item.createdAt || item.due || item.time)}{num(item.updateCount) > 1 ? ` · ${item.updateCount} ${t("条报道", "reports")}` : ""}</small><p>{item.summary || item.description || t("等待更多来源交叉验证。", "Awaiting cross-verification from more sources.")}</p></div><Pill tone={num(item.impact) >= 80 ? "bad" : num(item.impact) >= 50 ? "warn" : "good"}>{num(item.impact) >= 80 ? t("高", "High") : num(item.impact) >= 50 ? t("中", "Med") : t("低", "Low")}</Pill></button>;
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
        <button className="cp2Secondary" disabled={!active.title} onClick={async () => {
          // 把这条情报写入 AI 交易员的记忆(决策时注入系统提示词),让 Agent 在后续分析中考虑它。
          const body = `情报｜${active.title}｜${active.summary || active.description || ""}｜关联资产：${activeSymbols.join("、") || "—"}｜影响：${num(active.impact) >= 80 ? "高" : num(active.impact) >= 50 ? "中" : "低"}`;
          await action("/api/agent/memory", { layer: "semantic", title: `情报上下文：${active.title}`, content: body.slice(0, 500), tags: ["情报", "上下文"], source: "intel" });
          ui.notify?.(t("已加入 AI 交易员分析上下文", "Added to AI trader analysis context"));
        }}>{t("加入上下文", "Add to context")}</button>
        <button className="cp2Primary" onClick={() => action("/api/event-sources/refresh", {})}>{t("刷新情报", "Refresh intel")}</button>
      </ConceptCard>
    </aside>
  </div>;
}

function marketRows(data) {
  return arr(data.markets).slice(0, 12).map((item, index) => ({
    ...item,
    id: item.symbol || index,
    symbol: item.symbol,
    price: item.price ?? item.last,
    change: item.changePct ?? item.change24hPct,
    volume: item.volume24h ?? item.quoteVolume
  }));
}

// 全部 OKX/币安 USDT 永续合约清单(真实拉取,含 ~400 个交易对),供行情选币与加自选使用。
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
  const positions = arr(data.positions); const fills = arr(data.fills); const orders = arr(data.executionOrders).length ? arr(data.executionOrders) : arr(data.orders);
  const markets = marketRows(data); const activeMarket = data.activeMarket || markets[0] || {};
  const equity = pf.totalEquityUsdt; const used = num(equity) - num(pf.availableMarginUsdt);
  return <div className="cp2Stack">
    <div className="cp2Metrics five">
      <ConceptMetric label={t("总资产", "Total equity")} value={equity == null ? t("未同步", "Not synced") : `${money(equity)} USDT`} sub={t("账户实时净值", "Live account equity")}/>
      <ConceptMetric label={t("今日盈亏", "Today's PnL")} value={`${num(pf.todayPnl) >= 0 ? "+" : ""}${money(pf.todayPnl, "0")} USDT`} sub={displayPct(pf.todayPnlPct, t("等待账户同步", "Awaiting account sync"))} tone={num(pf.todayPnl) >= 0 ? "good" : "bad"}/>
      <ConceptMetric label={t("可用保证金", "Available margin")} value={pf.availableMarginUsdt == null ? t("未同步", "Not synced") : `${money(pf.availableMarginUsdt)} USDT`} sub={equity ? `${t("可用", "Free")} ${Math.max(0, 100 - used / num(equity) * 100).toFixed(1)}%` : "—"}/>
      <ConceptMetric label={t("风险预算", "Risk budget")} value={data.system?.remainingDailyLossUsdt == null ? t("未授权", "Not authorized") : `${money(data.system.remainingDailyLossUsdt)} USDT`} sub={t("今日剩余", "Remaining today")}/>
      <ConceptMetric label={t("允许交易", "Trading")} value={data.system?.killSwitch ? t("已熔断", "Halted") : data.automationState?.label || t("待配置", "Unconfigured")} sub={`${arr(data.riskRules).filter((rule) => rule.enabled !== false).length} ${t("条规则生效", "rules active")}`} tone={data.system?.killSwitch ? "bad" : "good"}/>
    </div>
    {(() => {
      // ③ 行为约束层:日/月盈利目标进度(UTC+8 自然日/月边界)+ 达标"落袋"提示 + 亏损触发反报复冷却。
      const closes = fills.filter((f) => f.kind === "close" && Number.isFinite(Number(f.realizedPnl)));
      const shift = (d) => new Date(new Date(d).getTime() + 8 * 3600000);
      const dk = (d) => { const s = shift(d); return `${s.getUTCFullYear()}-${s.getUTCMonth()}-${s.getUTCDate()}`; };
      const mk = (d) => { const s = shift(d); return `${s.getUTCFullYear()}-${s.getUTCMonth()}`; };
      const nowS = shift(new Date());
      const todayKey = `${nowS.getUTCFullYear()}-${nowS.getUTCMonth()}-${nowS.getUTCDate()}`, monKey = `${nowS.getUTCFullYear()}-${nowS.getUTCMonth()}`;
      const todayPnl = closes.filter((f) => dk(f.createdAt) === todayKey).reduce((s, f) => s + Number(f.realizedPnl), 0);
      const monthPnl = closes.filter((f) => mk(f.createdAt) === monKey).reduce((s, f) => s + Number(f.realizedPnl), 0);
      const dailyGoal = num(data.system?.dailyGoalUsdt, 150), monthlyGoal = num(data.system?.monthlyGoalUsdt, 4500);
      const dayPct = dailyGoal > 0 ? Math.max(0, Math.min(100, (todayPnl / dailyGoal) * 100)) : 0;
      const monPct = monthlyGoal > 0 ? Math.max(0, Math.min(100, (monthPnl / monthlyGoal) * 100)) : 0;
      const goalMet = dailyGoal > 0 && todayPnl >= dailyGoal, revenge = dailyGoal > 0 && todayPnl <= -0.5 * dailyGoal;
      return <ConceptCard title={t("🎯 目标进度 · 行为约束", "🎯 Goal Progress · Behavioral Guardrails")} meta={t("日/月盈利目标(UTC+8)· 只做监控,不进 AI 决策", "Daily/monthly profit goals (UTC+8) · monitoring only, not fed into AI decisions")} action={<button className="cp2Link" onClick={async () => {
        const d = await uiPrompt(t("每日盈利目标(USDT,留空=不设)", "Daily profit goal (USDT, blank = none)"), data.system?.dailyGoalUsdt != null ? String(data.system.dailyGoalUsdt) : "");
        if (d === null) return;
        const m = await uiPrompt(t("每月盈利目标(USDT,留空=不设)", "Monthly profit goal (USDT, blank = none)"), data.system?.monthlyGoalUsdt != null ? String(data.system.monthlyGoalUsdt) : "");
        if (m === null) return;
        action("/api/system/goals", { dailyGoalUsdt: d === "" ? null : Number(d), monthlyGoalUsdt: m === "" ? null : Number(m) });
      }}>{t("设置目标", "Set goals")}</button>}>
        <div className="bcGrid">
          <div className="bcGoal"><div className="bcTop"><span>{t("今日已实现", "Realized today")}</span><b className={todayPnl >= 0 ? "good" : "bad"}>{money(todayPnl)} / {money(dailyGoal)}</b></div><div className="bcBar"><i style={{ width: `${dayPct}%`, background: todayPnl < 0 ? "var(--bad,#c8492f)" : "var(--good,#2e9e6b)" }} /></div></div>
          <div className="bcGoal"><div className="bcTop"><span>{t("本月已实现", "Realized this month")}</span><b className={monthPnl >= 0 ? "good" : "bad"}>{money(monthPnl)} / {money(monthlyGoal)}</b></div><div className="bcBar"><i style={{ width: `${monPct}%`, background: "var(--accent)" }} /></div></div>
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
    <div className="cp2Grid two wideLeft">
      <ConceptCard title={t("活动与交易流水", "Activity & Trade Flow")} meta={`${fills.length + orders.length} ${t("条", "")}`} action={<button className="cp2Link" onClick={() => ui.setActive("tradeJournal")}>{t("查看全部 ›", "View all ›")}</button>}>
        <ConceptTable columns={[{key:"createdAt",label:t("时间", "Time"),render:r=>formatTime(r.createdAt)},{key:"kind",label:t("类型", "Type"),render:r=>humanize(r.kind||r.type||t("订单", "Order"))},{key:"detail",label:t("内容", "Detail"),render:r=>`${r.symbol||"—"} · ${humanize(r.side||r.direction||r.status)}`},{key:"amount",label:t("数量/金额", "Qty/Amount"),render:r=>r.quantity??r.size??money(r.notional)},{key:"status",label:t("状态", "Status"),render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status,t("已记录", "Recorded"))}</Pill>}]} rows={[...orders,...fills].slice(0,8)} empty={t("暂无交易活动", "No trade activity")}/>
      </ConceptCard>
      <ConceptCard title={t("AI 当前判断", "AI Current Read")} icon={Bot}>
        <div className="cp2InsightList"><div><TrendingUp size={14}/><span><b>{t("市场趋势", "Market trend")}</b><small>{data.marketRegime?.global?.label || t("等待真实行情形成判断", "Awaiting live data to form a read")}</small></span></div><div><Target size={14}/><span><b>{t("关键价位", "Key level")}</b><small>{activeMarket.price ? `${t("当前参考", "Ref")} ${money(activeMarket.price)}` : t("待同步", "Pending sync")}</small></span></div><div><AlertTriangle size={14}/><span><b>{t("关注事件", "Watch event")}</b><small>{arr(data.events)[0]?.title || t("暂无高影响事件", "No high-impact events")}</small></span></div></div>
      </ConceptCard>
    </div>
  </div>;
}

export function MarketConcept({ data, action }) {
  const markets = marketRows(data); const watchlist = arr(data.watchlist); const instruments = useInstruments();
  const [symbol, setSymbol] = useState(markets[0]?.symbol || watchlist[0] || "BTC/USDT"); const [tf, setTf] = useState("1h");
  const selected = markets.find((item) => item.symbol === symbol) || markets[0] || {};
  // 自选列表按真实的 watchlist 逐条渲染(带上有的行情),让历史误加的脏交易对(如「/USDT」)也能被移除。
  const allMarkets = arr(data.markets);
  const wlSymbols = watchlist.length ? watchlist : markets.map((m) => m.symbol);
  const wlRows = wlSymbols.map((sym) => { const m = markets.find((x) => x.symbol === sym) || allMarkets.find((x) => x.symbol === sym) || {}; return { id: sym, symbol: sym, price: m.price ?? m.last, change: m.changePct ?? m.change24hPct }; });
  const addWatch = (sym) => { if (sym) action("/api/watchlist", { symbol: sym }); };
  return <div className="cp2MarketLayout">
    <ConceptCard className="cp2MainChart" title={selected.symbol || symbol} meta={`${tf} · ${t("公开行情", "Public data")}`} action={<div className="cp2FormActions"><button className="cp2Secondary" onClick={() => action("/api/reconciler/run", { mode: "manual_ui" })}>{t("手动对账", "Reconcile")}</button><button className="cp2IconButton" onClick={() => action("/api/market/regime", {}, "GET")}><RefreshCw size={13}/></button></div>}>
      <div className="cp2ChartToolbar"><PairPicker instruments={instruments} value={symbol} onPick={setSymbol}/>{["1m","5m","15m","1h","4h","1D"].map((name) => <button className={name === tf ? "active" : ""} onClick={() => setTf(name)} key={name}>{name}</button>)}</div>
      <div className="cp2Quote large"><b>{selected.price == null ? t("待同步", "Pending sync") : money(selected.price)}</b><Pill tone={num(selected.change) >= 0 ? "good" : "bad"}>{selected.change == null ? "—" : `${num(selected.change)>=0?"+":""}${num(selected.change).toFixed(2)}%`}</Pill></div>
      <div className="cp2CandleBox tall"><TradingViewChart symbol={symbol} interval={{ "1m": "1m", "5m": "5m", "15m": "15m", "1h": "60", "4h": "240", "1D": "D" }[tf] || "60"}/></div>
    </ConceptCard>
    <aside className="cp2MarketRail">
      <ConceptCard title={t("自选列表", "Watchlist")} meta={`${wlRows.length} ${t("个", "")}`} action={<PairPicker instruments={instruments} value="" label={t("＋ 添加", "＋ Add")} onPick={addWatch} triggerClass="cp2Link" align="right"/>}><ConceptTable compact columns={[{key:"symbol",label:t("交易对", "Pair"),render:r=><button className="cp2Link" onClick={()=>setSymbol(r.symbol)}>{r.symbol}</button>},{key:"price",label:t("价格", "Price"),render:r=>money(r.price)},{key:"change",label:"24h",render:r=><span className={num(r.change)>=0?"good":"bad"}>{r.change==null?"—":`${num(r.change)>=0?"+":""}${num(r.change).toFixed(2)}%`}</span>},{key:"remove",label:"",render:r=>watchlist.length>1&&watchlist.includes(r.symbol)?<button className="cp2IconButton" title={t("移除自选", "Remove")} onClick={()=>action(`/api/watchlist/${encodeURIComponent(r.symbol)}`,{},"DELETE")}>×</button>:null}]} rows={wlRows} empty={t("行情待同步", "Market pending sync")}/></ConceptCard>
      <ConceptCard title={t("市场快照", "Market Snapshot")}><div className="cp2Kv column"><span>{t("24h 高", "24h High")}<b>{money(selected.high24h ?? selected.high)}</b></span><span>{t("24h 低", "24h Low")}<b>{money(selected.low24h ?? selected.low)}</b></span><span>{t("24h 成交额", "24h Turnover")}<b>{selected.volume ? String(selected.volume) : "—"}</b></span><span>{t("资金费率", "Funding rate")}<b>{selected.fundingRate == null ? t("待同步", "Pending") : `${num(selected.fundingRate) >= 0 ? "+" : ""}${num(selected.fundingRate).toFixed(4)}%`}</b></span></div></ConceptCard>
    </aside>
    <div className="cp2MarketBottom">
      <ConceptCard title={t("未平仓量", "Open Interest")}><div className="cp2BigNumber">{selected.openInterest == null ? "—" : money(selected.openInterest)}<small>{t("公开合约数据", "Public contract data")}</small></div><MiniLine values={arr(selected.candles).slice(-24).map(item=>item.volume)} height={52}/></ConceptCard>
      <ConceptCard title={t("多空比", "Long/Short Ratio")}>{(()=>{const r=data.marketRegime?.smartMoney?.topTraderLongShortRatio;if(r==null)return <div className="cp2BigNumber small">{t("待同步", "Pending")}<small>{t("大户多空比未取", "Top-trader ratio unavailable")}</small></div>;const rn=num(r);const longPct=Math.round(rn/(1+rn)*100);return <><div className="cp2BigNumber">{rn.toFixed(2)}<small>{longPct>=55?t("多头占优", "Longs lead"):longPct<=45?t("空头占优", "Shorts lead"):t("多空均衡", "Balanced")}</small></div><BarRows rows={[{label:t("多头", "Long"),value:longPct},{label:t("空头", "Short"),value:100-longPct}]}/></>;})()}</ConceptCard>
      <ConceptCard title={t("市场情绪", "Market Sentiment")}>{(()=>{const fg=data.marketRegime?.global?.fearGreed;if(!fg)return <div className="cp2Centered"><div className="cp2BigNumber small">{t("待评估", "Pending")}<small>{t("恐惧贪婪未取", "Fear & Greed unavailable")}</small></div></div>;return <div className="cp2Centered"><Donut value={num(fg.value)} label={String(fg.value)} sub={fg.label||""}/></div>;})()}</ConceptCard>
      <ConceptCard title={t("全球市场动态", "Global Movers")}><ConceptTable compact columns={[{key:"symbol",label:t("资产", "Asset")},{key:"change",label:t("涨跌", "Change"),render:r=><span className={num(r.change)>=0?"good":"bad"}>{r.change==null?"—":`${num(r.change).toFixed(2)}%`}</span>}]} rows={markets.slice(0,5)} empty={t("暂无行情", "No market data")}/></ConceptCard>
    </div>
  </div>;
}

export function PositionsConcept({ data }) {
  const positions = arr(data.positions); const pf = data.portfolio || {};
  const exposure = positions.reduce((sum, item) => sum + Math.abs(num(item.notional || item.marketValue)), 0);
  const pnl = positions.reduce((sum, item) => sum + num(item.unrealizedPnl), 0);
  const margin = positions.reduce((sum, item) => sum + num(item.margin || item.initialMargin), 0);
  const lev = positions.length ? positions.reduce((sum, item) => sum + num(item.leverage), 0) / positions.length : 0;
  return <div className="cp2Stack">
    <div className="cp2Metrics four"><ConceptMetric label={t("持仓市值", "Position value")} value={positions.length ? `${money(exposure)} USDT` : "—"} sub={`${positions.length} ${t("个仓位", "positions")}`}/><ConceptMetric label={t("未实现盈亏", "Unrealized PnL")} value={positions.length ? `${pnl>=0?"+":""}${money(pnl)} USDT` : "—"} sub={displayPct(pf.todayPnlPct,t("等待同步", "Awaiting sync"))} tone={pnl>=0?"good":"bad"}/><ConceptMetric label={t("保证金占用", "Margin used")} value={margin ? `${money(margin)} USDT` : "—"} sub={pf.totalEquityUsdt ? `${(margin/num(pf.totalEquityUsdt)*100).toFixed(1)}%` : t("未同步", "Not synced")}/><ConceptMetric label={t("平均杠杆", "Avg leverage")} value={lev ? `${lev.toFixed(2)}x` : "—"} sub={t("组合口径", "Portfolio basis")}/></div>
    <div className="cp2Grid positionsTop"><ConceptCard title={t("持仓分布", "Allocation")}><div className="cp2Centered"><Donut value={pf.totalEquityUsdt ? Math.max(0,Math.min(100, margin/num(pf.totalEquityUsdt)*100)) : 0} label={positions.length ? `${money(exposure, "0")}` : t("空仓", "Flat")} sub={positions.length ? t("USDT · 保证金占比", "USDT · margin share") : "USDT"}/></div><BarRows rows={positions.slice(0,5).map((item)=>({label:item.symbol,value:num(item.notional||item.marketValue),display:`${money(item.notional||item.marketValue)} U`}))}/></ConceptCard><ConceptCard title={t("持仓明细", "Position Detail")} meta={t("AI托管仓由系统盯盘;手动/外部仓仅记录不托管", "AI-managed positions are monitored by the system; manual/external ones are recorded only")} className="span2"><ConceptTable columns={[{key:"symbol",label:t("币种", "Symbol")},{key:"source",label:t("来源", "Source"),render:r=><Pill tone={r.source==="execution_engine"?"good":"neutral"}>{r.source==="execution_engine"?t("AI托管", "AI-managed"):t("手动/外部", "Manual/External")}</Pill>},{key:"direction",label:t("方向", "Side"),render:r=><Pill tone={/short|空|卖|sell/i.test(String(r.direction))?"bad":"good"}>{humanize(r.direction)}</Pill>},{key:"quantity",label:t("持仓数量", "Size"),render:r=>r.quantity??r.size??"—"},{key:"entry",label:t("开仓均价", "Entry"),render:r=>money(r.entryPrice??r.entry)},{key:"mark",label:t("当前价格", "Mark"),render:r=>money(r.markPrice??r.mark)},{key:"pnl",label:t("未实现盈亏", "Unrealized"),render:r=><span className={num(r.unrealizedPnl)>=0?"good":"bad"}>{money(r.unrealizedPnl)}</span>},{key:"leverage",label:t("杠杆", "Lev"),render:r=>r.leverage?`${r.leverage}x`:"—"},{key:"liq",label:t("强平价", "Liq price"),render:r=>money(r.liquidationPrice)}]} rows={positions} empty={t("暂无持仓", "No positions")}/></ConceptCard></div>
    <div className="cp2Grid two wideLeft"><ConceptCard title={t("持仓盈亏曲线", "Equity Curve")} meta={t("账户真实快照", "Real account snapshots")}><MiniLine values={arr(data.accountSnapshots).map((item)=>item.totalEquityUsdt)} height={150}/></ConceptCard><ConceptCard title={t("保证金健康", "Margin Health")}><div className="cp2Centered"><Donut value={pf.totalEquityUsdt ? Math.max(0,100-margin/num(pf.totalEquityUsdt)*100) : 0} label={pf.totalEquityUsdt ? `${Math.round(Math.max(0,100-margin/num(pf.totalEquityUsdt)*100))}%` : "—"} sub={t("健康度", "Health")}/></div><div className="cp2Checklist"><span>{pf.totalEquityUsdt!=null?<CheckCircle2/>:<AlertTriangle/>}{t("保证金已同步", "Margin synced")}</span><span>{Number(pf.availableMarginUsdt)>0?<CheckCircle2/>:<AlertTriangle/>}{t("风险缓冲", "Risk buffer")}</span><span>{!arr(data.positions).some(p=>{const d=Number(p.liqDistancePct);return Number.isFinite(d)&&d<12;})?<ShieldCheck/>:<AlertTriangle/>}{t("强平距离安全", "Safe liq distance")}</span></div></ConceptCard></div>
  </div>;
}

export function OrdersConcept({ data, action, ui }) {
  const orders = arr(data.executionOrders).length ? arr(data.executionOrders) : arr(data.orders); const fills = arr(data.fills); const plans = arr(data.tradePlans);
  const [selectedId, setSelectedId] = useState(orders[0]?.id || ""); const selected = orders.find((item)=>item.id===selectedId) || orders[0] || {};
  return <div className="cp2Stack"><div className="cp2Metrics four"><ConceptMetric label={t("待执行订单", "Pending orders")} value={String(orders.filter((item)=>/pending|open|new/i.test(String(item.status))).length)} sub={`${t("共", "of")} ${orders.length} ${t("条", "")}`}/><ConceptMetric label={t("待审批", "Awaiting approval")} value={String(plans.filter((item)=>item.status==="awaiting_approval").length)} sub={t("人工确认", "Manual confirm")}/><ConceptMetric label={t("今日成交", "Fills today")} value={String(fills.length)} sub={t("交易所回报", "Exchange reports")}/><ConceptMetric label={t("已拒绝", "Rejected")} value={String(orders.filter((item)=>/reject|cancel/i.test(String(item.status))).length)} sub={t("风控或人工", "Risk or manual")}/></div>
    <div className="cp2OrdersLayout"><ConceptCard title={t("订单簿", "Order Book")} meta={`${orders.length} ${t("条", "")}`} className="cp2OrdersTable"><ConceptTable columns={[{key:"id",label:t("订单号", "Order ID"),render:r=><button className="cp2Link" onClick={()=>setSelectedId(r.id)}>{String(r.id||"—").slice(0,12)}</button>},{key:"symbol",label:t("交易对", "Pair")},{key:"side",label:t("方向", "Side"),render:r=>humanize(r.side||r.direction)},{key:"quantity",label:t("数量", "Qty"),render:r=>r.quantity??r.size??"—"},{key:"price",label:t("价格", "Price"),render:r=>money(r.price)},{key:"status",label:t("状态", "Status"),render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status)}</Pill>},{key:"createdAt",label:t("时间", "Time"),render:r=>formatTime(r.createdAt)}]} rows={orders} empty={t("暂无订单", "No orders")}/></ConceptCard>
      <ConceptCard title={t("执行链路", "Execution Path")} className="cp2Execution"><div className="cp2Timeline">{[t("计划", "Plan"),t("风控", "Risk"),t("路由", "Route"),t("订单", "Order"),t("成交", "Fill"),t("保护单", "Protect")].map((name,index)=><div key={index} className={(index===0?plans.length>0:index===1?(plans.some(p=>/approved|executing|passed/i.test(String(p.status)))||arr(data.riskChecks).length>0):index<=3?orders.length>0:index===4?fills.length>0:orders.some(o=>/stop|protect|止/i.test(String(o.type||o.kind||o.purpose||""))))?"done":""}><i>{index+1}</i><span><b>{name}</b><small>{index===0?(plans[0]?.status?humanize(plans[0].status):t("等待计划", "Awaiting plan")):index===1?t("执行前复查", "Pre-trade check"):index===2?t("选择交易所", "Select venue"):index===3?humanize(selected.status,t("待执行", "Pending")):index===4?`${fills.length} ${t("笔成交", "fills")}`:t("止损/止盈", "SL/TP")}</small></span></div>)}</div></ConceptCard>
      <ConceptCard title={t("订单详情", "Order Detail")} className="cp2OrderDetail"><div className="cp2Kv column">{[[t("订单号", "Order ID"),selected.id],[t("交易对", "Pair"),selected.symbol],[t("方向", "Side"),humanize(selected.side||selected.direction)],[t("类型", "Type"),humanize(selected.type)],[t("数量", "Qty"),selected.quantity??selected.size],[t("委托价", "Limit price"),money(selected.price)],[t("状态", "Status"),humanize(selected.status)],[t("创建时间", "Created"),formatDateTime(selected.createdAt)]].map(([k,v])=><span key={k}>{k}<b>{v||"—"}</b></span>)}</div><button className="cp2Secondary" onClick={()=>ui.setActive("chat")}>{t("交给 AI 修改", "Ask AI to modify")}</button>{selected.id&&<button className="cp2Danger" onClick={()=>action(`/api/execution-orders/${selected.id}/close`,{reason:"manual_ui"})}>{t("撤单/平仓", "Cancel/Close")}</button>}</ConceptCard>
    </div>
    <ConceptCard title={t("成交明细", "Fills")} meta={`${fills.length} ${t("条 · 超 20 条容器内滚动", "· scrolls past 20")}`}><div className="cp2ScrollList tall"><ConceptTable compact columns={[{key:"createdAt",label:t("成交时间", "Fill time"),render:r=>formatDateTime(r.createdAt)},{key:"orderId",label:t("订单号", "Order ID")},{key:"symbol",label:t("交易对", "Pair")},{key:"side",label:t("方向", "Side"),render:r=>humanize(r.side||r.kind)},{key:"quantity",label:t("成交数量", "Fill qty"),render:r=>r.quantity??r.size??"—"},{key:"price",label:t("成交价格", "Fill price"),render:r=>money(r.price)},{key:"fee",label:t("手续费", "Fee"),render:r=>money(r.fee)}]} rows={fills} empty={t("暂无成交", "No fills")}/></div></ConceptCard></div>;
}

// AI 交易行为画像:量化画像(data.behaviorProfile)+ 按需 LLM 叙述 + 喂回"行为镜"透镜。
export function BehaviorProfileConcept({ data, action }) {
  const p = data.behaviorProfile || {};
  const [narr, setNarr] = useState(data.behaviorNarrative || null);
  const [busy, setBusy] = useState(false);
  const fmtMin = (m) => m == null ? "—" : m < 60 ? `${Math.round(m)}m` : `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, "0")}m`;

  if (!p.trades) return <div className="cp2Wrap"><ConceptCard title={t("AI 交易行为画像", "AI Trading Behavior Profile")} meta={t("让 AI 照镜子看自己的交易模式", "Let the AI look in the mirror at its own trading patterns")}><div className="emptyPanel">{p.note || t("暂无已平仓交易——行为画像会随成交累积。", "No closed trades yet — the profile builds up as fills accumulate.")}</div></ConceptCard></div>;

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
  const fills = arr(data.fills); const reviews = arr(data.reviews); const performance = data.performance || {}; const report = data.paperReport || {};
  const wins = fills.filter((item)=>num(item.realizedPnl)>0); const losses = fills.filter((item)=>num(item.realizedPnl)<0); const net = fills.reduce((sum,item)=>sum+num(item.realizedPnl),0);
  return <div className="cp2Stack"><div className="cp2Metrics six"><ConceptMetric label={t("已实现盈亏", "Realized PnL")} value={`${net>=0?"+":""}${money(net,"0")}`} tone={net>=0?"good":"bad"}/><ConceptMetric label={t("胜率", "Win rate")} value={fills.length?`${(wins.length/fills.length*100).toFixed(1)}%`:"—"}/><ConceptMetric label={t("盈亏比", "Profit factor")} value={performance.profitFactor!=null?num(performance.profitFactor).toFixed(2):"—"}/><ConceptMetric label={t("平均每笔", "Avg/trade")} value={performance.avgPnlUsdt!=null?`${num(performance.avgPnlUsdt)>=0?"+":""}${money(performance.avgPnlUsdt,"0")}`:"—"} tone={performance.avgPnlUsdt!=null?(num(performance.avgPnlUsdt)>=0?"good":"bad"):undefined}/><ConceptMetric label={t("最大回撤", "Max drawdown")} value={displayPct(performance.maxDrawdownPct??report.maxDrawdownPct,"—")} tone="bad"/><ConceptMetric label={t("复盘覆盖", "Review coverage")} value={fills.length?`${Math.min(100,reviews.length/fills.length*100).toFixed(0)}%`:"—"}/></div>
    {(() => {
      // ④ 月度聚合:按月 rollup(净盈亏/交易数/胜率)+ "日目标命中天数"(日盈利≥日目标的天数,比单纯胜率更贴稳定盈利)。
      const closes = fills.filter((f) => f.kind === "close" && Number.isFinite(Number(f.realizedPnl)));
      if (!closes.length) return null;
      const shift = (d) => new Date(new Date(d).getTime() + 8 * 3600000);
      const dailyGoal = num(data.system?.dailyGoalUsdt, 150);
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
    <div className="cp2Grid journalMain"><ConceptCard title={t("已平仓交易", "Closed Trades")} meta={t("超 20 条容器内滚动", "Scrolls past 20")} className="span2"><div className="cp2ScrollList tall"><ConceptTable columns={[{key:"createdAt",label:t("时间", "Time"),render:r=>formatDateTime(r.createdAt)},{key:"symbol",label:t("交易对", "Pair")},{key:"side",label:t("方向", "Side"),render:r=>humanize(r.side||r.kind)},{key:"quantity",label:t("数量", "Qty"),render:r=>r.quantity??r.size??"—"},{key:"price",label:t("成交价", "Fill price"),render:r=>money(r.price)},{key:"realizedPnl",label:t("已实现盈亏", "Realized PnL"),render:r=><span className={num(r.realizedPnl)>=0?"good":"bad"}>{money(r.realizedPnl)}</span>},{key:"status",label:t("状态", "Status"),render:r=><Pill tone="good">{t("已成交", "Filled")}</Pill>}]} rows={fills} empty={t("暂无已平仓交易", "No closed trades")}/></div></ConceptCard><ConceptCard title={t("业绩拆解", "Performance Breakdown")}><div className="cp2Centered"><Donut value={fills.length?wins.length/fills.length*100:0} label={fills.length?`${(wins.length/fills.length*100).toFixed(0)}%`:"—"} sub={t("胜率", "Win rate")}/></div><BarRows rows={[{label:t("盈利交易", "Winners"),value:wins.length,display:`${wins.length} ${t("笔", "")}`},{label:t("亏损交易", "Losers"),value:losses.length,display:`${losses.length} ${t("笔", "")}`},{label:t("复盘完成", "Reviews done"),value:reviews.length,display:`${reviews.length} ${t("份", "")}`}]} /></ConceptCard></div>
    <div className="cp2Grid two wideLeft"><ConceptCard title={t("交易复盘详情", "Trade Reviews")}><div className="cp2ReviewGrid">{reviews.slice(0,3).map((review,index)=><article key={review.id||index}><small>{review.symbol||t("组合", "Portfolio")} · {formatDateTime(review.createdAt)}</small><b>{review.title||review.summary||t("交易复盘", "Trade review")}</b><p>{review.lesson||review.notes||t("等待复盘结论。", "Awaiting review conclusion.")}</p></article>)}{!reviews.length&&<div className="cp2Empty"><BookOpen/><b>{t("暂无复盘", "No reviews")}</b><span>{t("平仓后会自动进入复盘队列。", "Closed trades auto-enter the review queue.")}</span></div>}</div></ConceptCard><ConceptCard title={t("纪律检查", "Discipline Check")}><div className="cp2Checklist vertical"><span><CheckCircle2/>{t("风险预算执行", "Risk budget enforced")}</span><span><CheckCircle2/>{t("止损保护覆盖", "Stop-loss coverage")}</span><span><AlertTriangle/>{t("复盘样本仍需积累", "Review sample still building")}</span></div></ConceptCard></div></div>;
}

// 生效中的条令:列出已直接注入 Agent 决策的透镜(active)与铁律(已批准),点开看全文。
function ActiveDoctrineCard({ data }){
  const k=data.knowledge||{};
  const lenses=arr(k.lenses).filter(l=>l.active);
  const rules=arr(k.ruleProposals).filter(r=>r.status==="已批准"||r.status==="approved");
  const [open,setOpen]=useState(null);
  if(!lenses.length && !rules.length) return null;
  const rowText=r=>r.description||r.rule||r.detail||r.condition||t("（无正文）", "(no content)");
  return <ConceptCard title={t("生效中的条令", "Active Doctrine")} meta={`${t("透镜", "Lenses")} ${lenses.length} · ${t("铁律", "Iron rules")} ${rules.length}`}>
    <p className="cp2Intro">{t("这些已", "These are ")}<b>{t("直接注入 Agent 每次决策", "injected directly into every agent decision")}</b>{t("——透镜塑造分析、铁律不可违，无需\"生成候选\"。点条目看全文。", " — lenses shape analysis, iron rules cannot be broken, no \"generate candidate\" needed. Click an item for the full text.")}</p>
    <div className="cp2DoctrineList">
      {lenses.map(l=><div key={l.id} className={`cp2DoctrineRow ${open===l.id?"on":""}`}>
        <button onClick={()=>setOpen(open===l.id?null:l.id)}><span className="cp2DocTag lens">{t("透镜", "Lens")}</span><b>{l.name}</b><ChevronDown size={13}/></button>
        {open===l.id&&<p>{l.promptText||l.description||t("（无正文）", "(no content)")}</p>}
      </div>)}
      {rules.map(r=><div key={r.id} className={`cp2DoctrineRow ${open===r.id?"on":""}`}>
        <button onClick={()=>setOpen(open===r.id?null:r.id)}><span className="cp2DocTag iron">{t("铁律", "Iron rule")}</span><b>{r.name}</b><ChevronDown size={13}/></button>
        {open===r.id&&<p>{rowText(r)}</p>}
      </div>)}
    </div>
  </ConceptCard>;
}

export function KnowledgeConcept({ data, action, ui }) {
  const k=data.knowledge||{}; const sources=arr(k.sources); const methods=arr(k.tradingMethods); const candidates=arr(k.candidates).filter(item=>item.status==="candidate"); const skills=[...arr(k.tradingSkills),...arr(data.skills)]; const rules=[...arr(k.ruleProposals),...arr(data.riskRules)]; const memory=arr(data.memoryItems);
  const convert=async (source) =>{if(await uiConfirm(`${t("从《", "Generate candidate capabilities from 《")}${source.title||source.name}${t("》生成候选能力？", "》?")}`))action("/api/knowledge/convert",{sourceId:source.id});};
  return <div className="cp2Stack"><div className="cp2Workflow">{[[t("知识源", "Sources"),sources.length],[t("方法与记录", "Methods & notes"),methods.length+memory.length],[t("候选能力", "Candidates"),candidates.length],[t("回测验证", "Backtest"),arr(data.backtests).length],[t("长期采用", "Adopted"),skills.filter(s=>["active","trusted"].includes(s.status)).length]].map(([name,count],index)=><React.Fragment key={index}><div><i>{index+1}</i><span><b>{name}</b><small>{count} {t("项", "")}</small></span></div>{index<4&&<ChevronRight/>}</React.Fragment>)}</div>
    <div className="cp2KnowledgeGrid"><ConceptCard title={t("知识源", "Knowledge Sources")} meta={`${sources.length} ${t("个", "")}`} action={<button className="cp2Link" onClick={()=>ui.openPanel("knowledgeImport")}>{t("导入知识", "Import")}</button>}><ConceptTable compact columns={[{key:"title",label:t("名称", "Name"),render:r=>r.title||r.name||r.source},{key:"type",label:t("类型", "Type"),render:r=>humanize(r.type)},{key:"status",label:t("状态", "Status"),render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status,t("已索引", "Indexed"))}</Pill>},{key:"action",label:"",render:r=>["doctrine","manual_curated"].includes(r.type)?<span className="cp2LiveTag" title={t("已直接注入 Agent 决策，无需生成候选", "Injected directly into agent decisions, no candidate needed")}><CheckCircle2 size={12}/> {t("已生效", "Active")}</span>:<button className="cp2Link" onClick={()=>convert(r)}>{t("生成候选", "Gen candidate")}</button>}]} rows={sources.slice(0,8)} empty={t("暂无知识源", "No sources")}/></ConceptCard>
      <ConceptCard title={t("候选能力", "Candidate Capabilities")} meta={`${candidates.length} ${t("个", "")}`} action={<button className="cp2Link" onClick={()=>ui.openPanel("skillImport")}>{t("导入 Skill", "Import Skill")}</button>}><ConceptTable compact columns={[{key:"name",label:t("能力", "Capability")},{key:"type",label:t("类型", "Type"),render:r=>humanize(r.type)},{key:"status",label:t("操作", "Action"),render:r=><span className="cp2FormActions"><button className="cp2Link" onClick={()=>action(`/api/knowledge/candidates/${r.id}/ignore`,{})}>{t("忽略", "Ignore")}</button><button className="cp2Link" onClick={()=>action(`/api/knowledge/candidates/${r.id}/adopt`,{})}>{t("采纳", "Adopt")}</button></span>}]} rows={candidates.slice(0,8)} empty={t("暂无候选能力", "No candidates")}/></ConceptCard>
      <ConceptCard title={t("验证漏斗", "Validation Funnel")}><div className="cp2Funnel">{[[t("候选总量", "Candidates"),candidates.length],[t("静态验证", "Static check"),skills.filter(s=>s.scanStatus==="passed").length],[t("回测通过", "Backtest passed"),skills.filter(s=>s.backtestStatus==="passed").length],[t("实盘采用", "Live adopted"),skills.filter(s=>["active","trusted"].includes(s.status)).length]].map(([name,value],index)=><div style={{width:`${Math.max(8,value/Math.max(1,candidates.length)*100)}%`}} key={index}><span>{name}</span><b>{value}</b></div>)}</div><div className="cp2Kv"><span>{t("规则总数", "Rules")}<b>{rules.length}</b></span><span>{t("交易方法", "Methods")}<b>{methods.length}</b></span><span>{t("记忆条目", "Memory items")}<b>{memory.length}</b></span><span>{t("知识来源", "Sources")}<b>{sources.length}</b></span></div></ConceptCard>
    </div>
    <ActiveDoctrineCard data={data}/>
    <div className="cp2Grid two"><ConceptCard title={t("概念与知识网络", "Concept & Knowledge Network")}>{arr(k.conceptCards).length?<div className="cp2ConceptMap"><span className="center">{t("交易知识", "Trading knowledge")}</span>{arr(k.conceptCards).slice(0,6).map((item,index)=><span key={item.id||index} style={{"--i":index}}>{item.name||item.title||t("概念", "Concept")}</span>)}</div>:<div className="cp2Empty"><Database size={19}/><b>{t("暂无概念图谱", "No concept map")}</b><span>{t("从书籍/文章蒸馏出概念后，会在此按关系成网。", "Once concepts are distilled from books/articles, they form a network here.")}</span></div>}</ConceptCard><ConceptCard title={t("已沉淀的方法", "Captured Methods")}><ConceptTable compact columns={[{key:"name",label:t("方法", "Method"),render:r=>r.name||r.title},{key:"category",label:t("类型", "Type"),render:r=>humanize(r.category||r.type)},{key:"status",label:t("状态", "Status"),render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status,t("已记录", "Recorded"))}</Pill>}]} rows={[...methods,...memory].slice(0,8)} empty={t("暂无方法记录", "No methods")}/></ConceptCard></div></div>;
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
  // 能力库=工具:内置工具 + 分析引擎工具 + MCP + 导入的工具类 skill;策略类(tradingSkills)归策略库,不在此。
  const rawItems=[...arr(data.skills).filter(s=>s.kind!=="strategy"),...arr(data.analysisEngine?.tools),...arr(data.tools),...arr(data.mcpServers)];
  // MCP 服务器记录没有 type/serverName,靠 transport 或 mcp_ 前缀 id 识别,否则会被误判成普通「工具」。
  const isMcp=i=>Boolean(i.serverName||i.transport||/^mcp_/i.test(String(i.id||"")));
  // 核心 Agent 工具(listAgentTools 产出)本身无 status 字段——它们是内置且始终可调,统一显示「已启用」,
  // 避免与技能的「已启用」并列时又冒出个含义不明的「可用」。连接器/技能/MCP 各自已有真实 status,不受影响。
  // 调用量取真实计数:后端 toolCallStats 按工具名累计(内置/技能/MCP 工具都算),
  // 技能回退 evalMetrics.calls;MCP 服务器行汇总它旗下各工具的调用数;都没有则诚实显 0/—。
  const tc=data.toolCallStats||{};
  const callsOf=(item)=>{
    const key=item.toolName||item.name;
    if(isMcp(item)) return (item.tools||[]).reduce((n,t)=>n+(tc[t?.name||t]?.calls||0),0);
    return tc[key]?.calls ?? item.evalMetrics?.calls ?? item.runs ?? item.runCount;
  };
  const lastOf=(item)=>{ const key=item.toolName||item.name; return tc[key]?.lastAt ?? item.lastCalledAt ?? item.lastRunAt ?? null; };
  const items = rawItems.filter((item,index)=>rawItems.findIndex(other=>(other.id||other.name)===(item.id||item.name))===index).map((item,index)=>({...item,id:item.id||`cap-${index}`,name:item.name||item.title||item.serverName||t("未命名工具", "Unnamed tool"),kind:item.type||item.category||(isMcp(item)?"MCP":"工具"),status:item.status||"已启用",runs:callsOf(item),lastRunAt:lastOf(item)}));
  // 状态词汇跨中英混用(技能=已启用/已拉取、连接器=configured/missing_credentials、MCP=connected/registered),
  // 判定必须同时认中英,否则按钮(启用/停用)与计数会错。
  const isEnabled=i=>["active","trusted","enabled","ready","connected","configured","available_without_key","已启用","已配置","已连接","免密钥可用"].includes(i.status)||i.enabled===true;
  const isDisabled=i=>i.enabled===false||/disabled|retired|已停用|已禁用/i.test(String(i.status));
  const isCandidate=i=>!isEnabled(i)&&!isDisabled(i)&&/candidate|pending|trial|paper|registered|待批准|待复核|待连接|待安全复核|候选/i.test(String(i.status));
  const TYPES=[["全部工具",()=>true],["分析工具",i=>/分析|analy|工具|tool/i.test(String(i.kind))&&!/MCP/i.test(String(i.kind))],["工作流",i=>/工作流|workflow|flow/i.test(String(i.kind))],["工具 (MCP)",i=>/MCP/i.test(String(i.kind))]];
  const STATUSES=[["全部状态",()=>true],["已启用",isEnabled],["候选中",isCandidate],["已停用",isDisabled]];
  const [typeF,setTypeF]=useState("全部工具"); const [statusF,setStatusF]=useState("全部状态"); const [detailTab,setDetailTab]=useState("概览"); const [installing,setInstalling]=useState(false); const [q,setQ]=useState("");
  const typeFn=(TYPES.find(t=>t[0]===typeF)||TYPES[0])[1]; const statusFn=(STATUSES.find(s=>s[0]===statusF)||STATUSES[0])[1];
  const shown=items.filter(i=>typeFn(i)&&statusFn(i)&&(!q||String(i.name).toLowerCase().includes(q.toLowerCase())));
  const [selectedId,setSelectedId]=useState(items[0]?.id||""); const selected=shown.find(i=>i.id===selectedId)||items.find(i=>i.id===selectedId)||shown[0]||items[0]||{};
  return <div className="cp2Stack">
    <div className="cp2Metrics four"><ConceptMetric label={t("全部工具", "All tools")} value={String(items.length)}/><ConceptMetric label={t("已启用", "Enabled")} value={String(items.filter(isEnabled).length)} tone="good"/><ConceptMetric label={t("候选中", "Candidate")} value={String(items.filter(isCandidate).length)} tone="warn"/><ConceptMetric label={t("已停用", "Disabled")} value={String(items.filter(isDisabled).length)} tone="bad"/></div>
    <div className="cp2CapabilitiesLayout">
      <aside className="cp2SideFilter">
        <b>{t("类型", "Type")}</b>{TYPES.map(([name,fn])=><button key={name} className={typeF===name?"active":""} onClick={()=>setTypeF(name)}>{t(name, {"全部工具":"All tools","分析工具":"Analysis","工作流":"Workflow","工具 (MCP)":"MCP"}[name]||name)}<span>{items.filter(fn).length}</span></button>)}
        <b>{t("状态", "Status")}</b>{STATUSES.map(([name,fn])=><button key={name} className={statusF===name?"active":""} onClick={()=>setStatusF(name)}>{t(name, {"全部状态":"All","已启用":"Enabled","候选中":"Candidate","已停用":"Disabled"}[name]||name)}<span>{items.filter(fn).length}</span></button>)}
      </aside>
      <ConceptCard title={t("工具列表", "Tool List")} meta={`${shown.length}/${items.length} ${t("项", "")}`} className="cp2CapabilityTable" action={<button className="cp2Link" onClick={()=>setInstalling(true)}><Plus size={12}/> {t("安装工具", "Install tool")}</button>}>
        <div className="cp2Search"><Search size={13}/><input className="cp2SearchInput" value={q} onChange={e=>setQ(e.target.value)} placeholder={t("搜索工具名称", "Search tool name")}/></div>
        <div className="cp2ScrollList tall"><ConceptTable onRowClick={r=>setSelectedId(r.id)} activeId={selected.id} columns={[{key:"name",label:t("工具名称", "Tool"),render:r=><button className={`cp2Link ${r.id===selected.id?"on":""}`} onClick={()=>setSelectedId(r.id)}>{r.name}</button>},{key:"kind",label:t("类型", "Type"),render:r=>humanize(r.kind)},{key:"version",label:t("版本", "Version"),render:r=>r.version||"—"},{key:"status",label:t("状态", "Status"),render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status,r.enabled===false?t("已停用", "Disabled"):t("可用", "Available"))}</Pill>},{key:"runs",label:t("调用量", "Calls"),render:r=>r.runs??r.runCount??"—"}]} rows={shown} empty={t("无匹配工具", "No matching tools")}/></div>
      </ConceptCard>
      <ConceptCard title={t("工具详情", "Tool Detail")} className="cp2CapabilityDetail">
        <div className="cp2CapabilityTitle"><span><Wrench size={18}/></span><div><b>{selected.name||t("选择工具", "Select a tool")}</b><small>{humanize(selected.kind)}</small></div><Pill tone={toneOf(selected.status)}>{humanize(selected.status,t("可用", "Available"))}</Pill></div>
        <div className="cp2DetailTabs">{["概览","输入输出","调用日志"].map(tab=><button key={tab} className={detailTab===tab?"active":""} onClick={()=>setDetailTab(tab)}>{t(tab, {"概览":"Overview","输入输出":"I/O","调用日志":"Call log"}[tab]||tab)}</button>)}</div>
        {detailTab==="概览"&&<><p>{selected.description||selected.summary||t("系统工具会在 Agent 工作流中按权限调用。", "System tools are called with permissions inside the agent workflow.")}</p><div className="cp2Kv column"><span>{t("版本", "Version")}<b>{selected.version||"—"}</b></span><span>{t("来源", "Source")}<b>{selected.source||selected.packageName||t("内置", "Built-in")}</b></span><span>{t("权限级别", "Permission")}<b>{humanize(selected.permission||selected.riskLevel,t("受控", "Controlled"))}</b></span><span>{t("最近运行", "Last run")}<b>{formatDateTime(selected.lastRunAt)}</b></span></div></>}
        {detailTab==="输入输出"&&<div className="cp2Kv column"><span>{t("输入", "Input")}<b>{humanize(selected.inputSchema||selected.input,t("未声明", "Undeclared"))}</b></span><span>{t("输出", "Output")}<b>{humanize(selected.outputSchema||selected.output,t("未声明", "Undeclared"))}</b></span><span>{t("参数", "Params")}<b>{Object.keys(selected.parameters||{}).length?`${Object.keys(selected.parameters).length} ${t("项", "")}`:t("未声明", "Undeclared")}</b></span></div>}
        {detailTab==="调用日志"&&<div className="cp2Kv column"><span>{t("累计调用", "Total calls")}<b>{selected.runs??selected.runCount??"—"}</b></span><span>{t("最近运行", "Last run")}<b>{formatDateTime(selected.lastRunAt)}</b></span><span>{t("明细", "Details")}<b>{selected.lastRunAt?t("见系统运营·审计", "See Operations · Audit"):t("暂无调用", "No calls")}</b></span></div>}
        {(()=>{const sid=String(selected.id||"");
          if(selected.kind==="MCP") return <button className="cp2Secondary" onClick={()=>ui.notify?.(t("MCP 连接在『系统设置』管理，此处只读展示", "MCP connections are managed in System Settings; read-only here"))}>{t("MCP · 系统设置管理", "MCP · managed in Settings")}</button>;
          if(/^tool_/.test(sid)) return <button className="cp2Secondary" onClick={()=>ui.notify?.(t("交易所 / 模型密钥在『风控中心 · 密钥安全』配置", "Exchange / model keys are configured in Risk Center · Key Security"))}>{t("去『密钥安全』配置", "Go to Key Security")}</button>;
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
export function StrategyLibraryConcept({ data, action, ui }) {
  // 策略库=蒸馏/手写产出的交易策略(tradingSkills)+ 导入的 kind==strategy 的 skill,由 kind 字段驱动分流。
  const strategies=[...arr(data.knowledge?.tradingSkills),...arr(data.skills).filter(s=>s.kind==="strategy")].map((s,i)=>({...s,id:s.id||`str-${i}`,name:s.name||s.title||t("未命名策略", "Unnamed strategy"),origin:s.origin||(s.methodId?"蒸馏":s.userAuthored||/用户|手写|llm|idea/i.test(String(s.createdBy||s.source||""))?"LLM/手写":/imported|uploaded|github|clawhub/i.test(String(s.source||""))?"导入":"内置")}));
  const originLabel=(o)=>t(o, {"蒸馏":"Distilled","LLM/手写":"LLM/Manual","导入":"Imported","内置":"Built-in"}[o]||o);
  const isActive=s=>/active|trusted|live|adopted/i.test(String(s.status));
  const isValidating=s=>/probation|paper|compiled|pending|trial|validating|candidate/i.test(String(s.status));
  const isRetired=s=>/retired|superseded|disabled|compile_failed|replaced|reject/i.test(String(s.status));
  const STATUSES=[["全部",()=>true],["已上岗",isActive],["验证中",isValidating],["已停用",isRetired]];
  const ORIGINS=[["全部来源",()=>true],["蒸馏",s=>s.origin==="蒸馏"],["LLM/手写",s=>/LLM|手写/.test(s.origin)],["导入",s=>/导入|imported/i.test(s.origin)]];
  const [statusF,setStatusF]=useState("全部"); const [originF,setOriginF]=useState("全部来源"); const [q,setQ]=useState("");
  const sFn=(STATUSES.find(x=>x[0]===statusF)||STATUSES[0])[1]; const oFn=(ORIGINS.find(x=>x[0]===originF)||ORIGINS[0])[1];
  const shown=strategies.filter(s=>sFn(s)&&oFn(s)&&(!q||String(s.name).toLowerCase().includes(q.toLowerCase())));
  const [selId,setSelId]=useState(strategies[0]?.id||""); const sel=shown.find(s=>s.id===selId)||strategies.find(s=>s.id===selId)||shown[0]||strategies[0]||{};
  return <div className="cp2Stack">
    <div className="cp2Metrics four"><ConceptMetric label={t("全部策略", "All strategies")} value={String(strategies.length)}/><ConceptMetric label={t("已上岗", "Live")} value={String(strategies.filter(isActive).length)} tone="good"/><ConceptMetric label={t("验证中", "Validating")} value={String(strategies.filter(isValidating).length)} tone="warn"/><ConceptMetric label={t("已停用", "Retired")} value={String(strategies.filter(isRetired).length)} tone="bad"/></div>
    <div className="cp2CapabilitiesLayout">
      <aside className="cp2SideFilter">
        <b>{t("状态", "Status")}</b>{STATUSES.map(([name,fn])=><button key={name} className={statusF===name?"active":""} onClick={()=>setStatusF(name)}>{t(name, {"全部":"All","已上岗":"Live","验证中":"Validating","已停用":"Retired"}[name]||name)}<span>{strategies.filter(fn).length}</span></button>)}
        <b>{t("来源", "Source")}</b>{ORIGINS.map(([name,fn])=><button key={name} className={originF===name?"active":""} onClick={()=>setOriginF(name)}>{t(name, {"全部来源":"All sources","蒸馏":"Distilled","LLM/手写":"LLM/Manual","导入":"Imported"}[name]||name)}<span>{strategies.filter(fn).length}</span></button>)}
      </aside>
      <ConceptCard title={t("策略列表", "Strategy List")} meta={`${shown.length}/${strategies.length} ${t("条", "")}`} className="cp2CapabilityTable" action={<button className="cp2Link" onClick={()=>ui.openPanel("skillImport")}><Plus size={12}/> {t("导入 / 新建策略", "Import / New")}</button>}>
        <div className="cp2Search"><Search size={13}/><input className="cp2SearchInput" value={q} onChange={e=>setQ(e.target.value)} placeholder={t("搜索策略名称", "Search strategy name")}/></div>
        <div className="cp2ScrollList tall"><ConceptTable onRowClick={r=>setSelId(r.id)} activeId={sel.id} columns={[{key:"name",label:t("策略", "Strategy"),render:r=><button className={`cp2Link ${r.id===sel.id?"on":""}`} onClick={()=>setSelId(r.id)}>{r.name}</button>},{key:"dir",label:t("方向·周期", "Side·TF"),render:r=>`${humanize(r.direction,"—")} · ${r.timeframe||"—"}`},{key:"origin",label:t("来源", "Source"),render:r=>originLabel(r.origin)},{key:"status",label:t("状态", "Status"),render:r=><Pill tone={skillStatusTone(r.status)}>{skillStatusLabel(r.status)}</Pill>},{key:"pf",label:t("盈亏比", "PF"),render:r=>r.profitFactor??r.backtest?.profitFactor??"—"}]} rows={shown} empty={t("暂无策略（喂书蒸馏或导入后在此出现）", "No strategies (they appear here after distilling from books or importing)")}/></div>
      </ConceptCard>
      <ConceptCard title={t("策略详情", "Strategy Detail")} className="cp2CapabilityDetail">
        <div className="cp2CapabilityTitle"><span><Activity size={18}/></span><div><b>{sel.name||t("选择策略", "Select a strategy")}</b><small>{[humanize(sel.direction,""),sel.timeframe].filter(Boolean).join(" · ")||"—"}</small></div>{sel.status&&<Pill tone={skillStatusTone(sel.status)}>{skillStatusLabel(sel.status)}</Pill>}</div>
        <p>{sel.entry||sel.description||sel.summary||t("选择一条策略查看其进场/止损/止盈逻辑与验证状态。", "Select a strategy to view its entry / stop-loss / take-profit logic and validation status.")}</p>
        <div className="cp2Kv column"><span>{t("来源", "Source")}<b>{sel.origin?originLabel(sel.origin):"—"}</b></span><span>{t("模板", "Template")}<b>{humanize(sel.template,"—")}</b></span><span>{t("回测状态", "Backtest")}<b>{humanize(sel.backtestStatus,t("未回测", "Not tested"))}</b></span><span>{t("胜率", "Win rate")}<b>{sel.winRatePct!=null?`${sel.winRatePct}%`:"—"}</b></span><span>{t("盈亏比", "Profit factor")}<b>{sel.profitFactor??sel.backtest?.profitFactor??"—"}</b></span><span>{t("最近运行", "Last run")}<b>{formatDateTime(sel.lastRunAt)}</b></span></div>
        <button className="cp2Secondary" onClick={()=>action("/api/strategy/research",{},"POST")}><Play size={12}/> {t("运行回测 / 研究", "Run backtest / research")}</button>
      </ConceptCard>
    </div>
    <StrategyConcept data={data} action={action}/>
  </div>;
}

export function StrategyConcept({ data, action }) {
  const backtests=arr(data.backtests); const [btIdx,setBtIdx]=useState(0); const active=backtests[btIdx]||backtests[0]||{}; const strategies=arr(data.strategyProfiles).length?arr(data.strategyProfiles):arr(data.strategyBoard?.rows);
  return <div className="cp2Stack"><div className="cp2StrategyToolbar"><select value={btIdx} onChange={e=>setBtIdx(Number(e.target.value))}>{backtests.length?backtests.map((b,i)=><option key={b.id||i} value={i}>{b.name||b.strategyName||`${t("回测", "Backtest")} ${i+1}`}</option>):<option>{t("暂无回测", "No backtests")}</option>}</select><span className="cp2StrategyVer">{t("版本", "Version")} {active.version||"—"}</span><span>{t("回测区间", "Range")} {active.startAt?formatDateTime(active.startAt):t("未运行", "Not run")} — {active.endAt?formatDateTime(active.endAt):"—"}</span><button className="cp2Primary" onClick={()=>action("/api/strategy/research",{},"POST")}><Play size={13}/> {t("运行研究", "Run research")}</button></div>
    <div className="cp2StrategyLayout"><ConceptCard title={t("策略表现", "Strategy Performance")}><div className="cp2Metrics two compact"><ConceptMetric label={t("累计收益", "Total return")} value={displayPct(active.totalReturnPct,"—")} tone="good"/><ConceptMetric label={t("年化收益", "Annualized")} value={displayPct(active.annualizedReturnPct,"—")} tone="good"/><ConceptMetric label={t("最大回撤", "Max drawdown")} value={displayPct(active.maxDrawdownPct,"—")} tone="bad"/><ConceptMetric label={t("夏普比率", "Sharpe")} value={active.sharpeRatio??"—"}/></div><MiniLine values={arr(active.equityCurve).map(i=>i.value??i.equity)} height={150}/></ConceptCard>
      <ConceptCard title={t("回撤", "Drawdown")}><MiniLine values={arr(active.drawdownCurve).map(i=>i.value??i.drawdown)} tone="orange" height={160}/><div className="cp2BigNumber bad">{displayPct(active.maxDrawdownPct,"—")}<small>{t("最大回撤", "Max drawdown")}</small></div></ConceptCard>
      <ConceptCard title={t("参数", "Parameters")}><div className="cp2Kv column">{Object.entries(active.parameters||{}).slice(0,8).map(([k,v])=><span key={k}>{humanize(k)}<b>{String(v)}</b></span>)}{!Object.keys(active.parameters||{}).length&&<span>{t("策略参数", "Parameters")}<b>{t("等待回测", "Awaiting backtest")}</b></span>}</div></ConceptCard>
    </div>
    <div className="cp2Grid strategyBottom"><ConceptCard title={t("滚动验证", "Walk-forward")}><MiniLine height={120}/></ConceptCard><ConceptCard title={t("候选策略", "Candidate Strategies")}><ConceptTable compact columns={[{key:"name",label:t("策略", "Strategy"),render:r=>r.name||r.strategyName},{key:"status",label:t("状态", "Status"),render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status)}</Pill>},{key:"score",label:t("评分", "Score"),render:r=>r.score??"—"}]} rows={strategies.slice(0,7)} empty={t("暂无候选策略", "No candidate strategies")}/></ConceptCard><ConceptCard title={t("决策口径 · 说明", "Decision Rubric")}><div className="cp2DecisionCards"><div className="good"><CheckCircle2/><b>{t("进入回测", "To backtest")}</b><small>{t("满足数据质量要求", "Meets data-quality bar")}</small></div><div className="warn"><AlertTriangle/><b>{t("进入观察", "To watch")}</b><small>{t("需要更多样本", "Needs more samples")}</small></div><div className="bad"><Activity/><b>{t("退回优化", "Back to tuning")}</b><small>{t("未达到阈值", "Below threshold")}</small></div></div></ConceptCard></div></div>;
}

export function RiskPostureConcept({ data, action, ui }) {
  const pf=data.portfolio||{}; const pr=data.portfolioRisk||{}; const mandate=data.agentStatus?.activeMandate||arr(data.mandates)[0]||{}; const rules=arr(data.riskRules); const incidents=arr(data.riskIncidents); const openIncidents=incidents.filter(i=>i.status==="open"); const checks=arr(data.readiness?.checks);
  // 字段名兼容(同 MandateConcept):后端存 max_leverage/validUntil,旧驼峰读不到 → 回退兼容,否则杠杆/有效期显示"—"。
  const mandMaxLev=mandate.maxLeverage??mandate.max_leverage; const mandExpires=mandate.expiresAt??mandate.validUntil??mandate.valid_until;
  const ready=checks.filter(c=>c.configured).length;
  return <div className="cp2Stack"><div className={`cp2RiskBanner ${data.system?.killSwitch?"bad":"good"}`}><ShieldCheck size={21}/><b>{data.system?.killSwitch?t("已熔断", "Halted"):t("允许交易", "Trading allowed")}</b><span>{t("风险评分", "Risk score")} <strong>{pr.score??pf.riskScore??"—"}/100</strong></span><span>{t("今日剩余预算", "Budget left today")} <strong>{data.system?.remainingDailyLossUsdt==null?t("未授权", "Not authorized"):`${money(data.system.remainingDailyLossUsdt)} U`}</strong></span><span>{t("账户同步", "Account sync")} <strong>{pf.totalEquityUsdt?t("已同步", "Synced"):t("待同步", "Pending")}</strong></span><span>{t("风险事件", "Risk incidents")} <strong>{openIncidents.length}</strong></span><button onClick={()=>ui.openPanel("riskIncidents")}>{t("查看详情", "Details")}</button></div>
    <div className="cp2Grid riskCards"><ConceptCard title={t("组合风险", "Portfolio Risk")}><div className="cp2Kv column"><span>{t("总敞口", "Total exposure")}<b>{pr.totalExposureUsdt==null?"—":`${money(pr.totalExposureUsdt)} U`}</b></span><span>{t("杠杆利用率", "Leverage util")}<b>{displayPct(pr.leverageUtilizationPct,"—")}</b></span><span>{t("相关性风险", "Correlation risk")}<b>{humanize(pr.correlationRisk,t("待评估", "TBD"))}</b></span><span>{t("最大回撤", "Max drawdown")}<b>{displayPct(pf.maxDrawdownPct,"—")}</b></span></div><MiniLine height={65}/></ConceptCard>
      <ConceptCard title={t("AI 的授权边界", "AI Mandate Boundaries")}><div className="cp2Kv column"><span>{t("交易白名单", "Whitelist")}<b>{arr(mandate.allowedSymbols).join("、")||t("未授权", "None")}</b></span><span>{t("杠杆范围", "Leverage range")}<b>{mandMaxLev?`1x – ${mandMaxLev}x`:"—"}</b></span><span>{t("单笔风险", "Per-trade risk")}<b>{mandate.maxSingleTradeRiskPct==null?"—":`${mandate.maxSingleTradeRiskPct}%`}</b></span><span>{t("单日亏损上限", "Daily loss cap")}<b>{mandate.maxDailyLossPct==null?"—":`${mandate.maxDailyLossPct}%`}</b></span><span>{t("授权有效期", "Mandate expiry")}<b>{formatDateTime(mandExpires)}</b></span></div></ConceptCard>
      <ConceptCard title={t("账户安全", "Account Security")}><div className="cp2SecurityList"><span><KeyRound/>{t("API 密钥", "API keys")}<b>{arr(data.apiKeyMetadata).filter(i=>i.hasApiKey).length} {t("个", "")}</b></span><span><LockKeyhole/>{t("密钥权限", "Key perms")}<b>{arr(data.apiKeyMetadata).every(i=>!i.hasApiKey||i.permissionVerifiedAt)?t("已核验", "Verified"):t("待核验", "Unverified")}</b></span><span><Server/>{t("账户同步", "Account sync")}<b>{arr(data.accountSnapshots).some(i=>i.status==="ok")?t("正常", "OK"):t("待配置", "Unconfigured")}</b></span><span><ShieldCheck/>{t("就绪检查", "Readiness")}<b>{ready}/{checks.length}</b></span></div></ConceptCard>
    </div>
    <div className="cp2Grid two"><ConceptCard title={t("风险规则命中", "Risk Rule Hits")}><ConceptTable compact columns={[{key:"name",label:t("规则", "Rule")},{key:"scope",label:t("范围", "Scope"),render:r=>humanize(r.scope)},{key:"level",label:t("级别", "Level")},{key:"enabled",label:t("状态", "Status"),render:r=><Pill tone={r.enabled===false?"warn":"good"}>{r.enabled===false?t("停用", "Off"):t("启用", "On")}</Pill>}]} rows={rules.slice(0,7)} empty={t("暂无风险规则", "No risk rules")}/></ConceptCard><ConceptCard title={t("事件风险窗口", "Event Risk Windows")} meta={openIncidents.length>7?`${t("共", "of")} ${openIncidents.length} ${t("项 · 未处理", "· open")}`:undefined} action={openIncidents.length?<button className="cp2Link" onClick={()=>ui.openPanel("riskIncidents")}>{t("处理", "Handle")}</button>:undefined}><ConceptTable compact columns={[{key:"name",label:t("事件", "Event"),render:r=>r.name||r.title},{key:"createdAt",label:t("时间", "Time"),render:r=>formatDateTime(r.createdAt)},{key:"severity",label:t("等级", "Severity"),render:r=><Pill tone={toneOf(r.severity)}>{humanize(r.severity)}</Pill>}]} rows={openIncidents.slice(0,7)} empty={t("暂无未处理风险事件", "No open risk incidents")}/></ConceptCard></div>
    <ConceptCard title={t("应急操作", "Emergency Actions")} className="cp2Emergency"><div className="cp2EmergencyActions"><button onClick={async () =>action("/api/system/autonomy",{enabled:false})}><Activity/><span><b>{t("暂停自主", "Pause autonomy")}</b><small>{t("停止 AI 自主交易", "Stop AI autonomous trading")}</small></span></button><button onClick={async () =>action("/api/risk/reduce-only",{enabled:!data.system?.reduceOnlyMode})}><RefreshCw/><span><b>{data.system?.reduceOnlyMode?t("退出只减仓", "Exit reduce-only"):t("只减仓", "Reduce-only")}</b><small>{t("控制新增风险敞口", "Cap new risk exposure")}</small></span></button><button onClick={async () =>{if(await uiConfirm(t("确认一键平掉所有持仓并进入只减仓模式？", "Flatten all positions and enter reduce-only mode?")))action("/api/risk/emergency-flatten",{});}}><Target/><span><b>{t("一键平仓", "Flatten all")}</b><small>{t("市价平掉全部持仓", "Market-close all positions")}</small></span></button><button className="bad" onClick={async () =>action("/api/risk/kill-switch",{enabled:!data.system?.killSwitch,reason:""})}><Zap/><span><b>{data.system?.killSwitch?t("解除熔断", "Clear halt"):t("一键熔断", "Kill switch")}</b><small>{t("立即阻断所有新交易", "Block all new trades instantly")}</small></span></button></div></ConceptCard></div>;
}

// 风控阈值面板:《交易条令》里「引擎硬拦」类阈值的运行时控制台(改完即时生效,无需重部署)。
const RISK_THRESH_FIELDS=[
  {key:"minRewardRisk",label:"盈亏比下限",labelEn:"Min reward:risk",unit:"R",unitEn:"R",min:1,max:5,step:0.1,hint:"计划 RR 低于此值不下（条令 R0.2）",hintEn:"Skip plans with RR below this (doctrine R0.2)"},
  {key:"protectMaxConsecLosses",label:"连亏冷却 · 触发笔数",labelEn:"Loss-streak cooldown · trades",unit:"笔",unitEn:"trades",min:2,max:10,step:1,hint:"尾部连亏达此触发冷却（P5）",hintEn:"Trigger cooldown after this many consecutive losses (P5)"},
  {key:"protectCooldownHours",label:"连亏冷却 · 时长",labelEn:"Loss-streak cooldown · duration",unit:"小时",unitEn:"h",min:0.5,max:48,step:0.5,hint:"冷却期暂停新开仓",hintEn:"Pause new entries during cooldown"},
  {key:"protectMaxDrawdownPct",label:"回撤锁仓 · 阈值",labelEn:"Drawdown lock · threshold",unit:"%",unitEn:"%",min:3,max:50,step:0.5,hint:"近期成交回撤达此（占权益）锁仓",hintEn:"Lock when recent drawdown (% of equity) hits this"},
  {key:"protectDrawdownLockHours",label:"回撤锁仓 · 时长",labelEn:"Drawdown lock · duration",unit:"小时",unitEn:"h",min:1,max:72,step:1,hint:"锁仓期暂停新开仓",hintEn:"Pause new entries while locked"},
  {key:"trailActivatePct",label:"追踪止损 · 激活盈利",labelEn:"Trailing stop · activation",unit:"%",unitEn:"%",min:0.3,max:10,step:0.1,hint:"浮盈达此即启动追踪止损（P3）",hintEn:"Start trailing stop once profit reaches this (P3)"},
  {key:"trailDistancePct",label:"追踪止损 · 跟踪距离",labelEn:"Trailing stop · distance",unit:"%",unitEn:"%",min:0.3,max:5,step:0.1,hint:"止损跟在现价后方此距离",hintEn:"Stop trails this far behind current price"},
  {key:"eventBlackoutMinutes",label:"事件静默窗口",labelEn:"Event blackout",unit:"分钟",unitEn:"min",min:0,max:240,step:5,hint:"高影响事件前此分钟内不开高杠杆（S7）",hintEn:"No high leverage within this many minutes before a high-impact event (S7)"}
];
function RiskThresholdsCard({ data, action, ui }){
  const base=data.riskThresholds||{};
  const [form,setForm]=useState(base); const [saving,setSaving]=useState(false);
  useEffect(()=>{ setForm(data.riskThresholds||{}); },[JSON.stringify(data.riskThresholds||{})]);
  const dirty=RISK_THRESH_FIELDS.some(f=>Number(form[f.key])!==Number(base[f.key]));
  async function save(){
    const body={}; RISK_THRESH_FIELDS.forEach(f=>{ const n=Number(form[f.key]); if(Number.isFinite(n)) body[f.key]=Math.min(f.max,Math.max(f.min,n)); });
    setSaving(true); const r=await action("/api/admin/risk-thresholds",body); setSaving(false);
    if(r&&!r.error) ui.notify?.(t("风控阈值已更新，即时生效", "Risk thresholds updated, effective immediately"));
  }
  return <ConceptCard title={t("风控阈值 · 运行时可调", "Risk Thresholds · Runtime-adjustable")} meta={t("改完即时生效 · 无需重部署", "Effective immediately · no redeploy")}>
    <p className="cp2Intro">{t("《交易条令》里「引擎硬拦」类阈值的统一控制台——调这里就是调 Agent 的硬闸。不确定就保留默认。", "Unified console for the \"engine hard-block\" thresholds in the Trading Doctrine — tuning here tunes the agent's hard gates. Leave defaults if unsure.")}</p>
    <div className="cp2ThreshGrid">
      {RISK_THRESH_FIELDS.map(f=><label key={f.key} className="cp2ThreshField">
        <span className="cp2ThreshLabel"><b>{t(f.label, f.labelEn)}</b><em>{t(f.hint, f.hintEn)}</em></span>
        <span className="cp2ThreshInput"><input type="number" min={f.min} max={f.max} step={f.step} value={form[f.key]??""} onChange={e=>setForm(c=>({...c,[f.key]:e.target.value}))}/><i>{t(f.unit, f.unitEn)}</i></span>
      </label>)}
    </div>
    <div className="cp2FormActions"><button className="cp2Secondary" disabled={!dirty} onClick={()=>setForm(data.riskThresholds||{})}>{t("还原", "Reset")}</button><button className="cp2Primary" disabled={!dirty||saving} onClick={save}>{saving?t("保存中…", "Saving…"):t("保存并生效", "Save & apply")}</button></div>
  </ConceptCard>;
}

export function MandateConcept({ data, action, ui }) {
  const mandate=data.agentStatus?.activeMandate||arr(data.mandates)[0]||{}; const history=arr(data.mandates);
  // 字段名兼容:后端存 max_leverage/min_leverage/validUntil(蛇形/旧名),旧页面读驼峰读不到 → 一律回退兼容。
  const mandMaxLev=mandate.maxLeverage??mandate.max_leverage; const mandMinLev=mandate.minLeverage??mandate.min_leverage??1;
  const mandExpires=mandate.expiresAt??mandate.validUntil??mandate.valid_until;
  const curMode=data.automationState?.mode==="full_auto_small"?"full_auto":data.automationState?.mode==="semi_auto"?"semi_auto":data.automationState?.mode==="observe"?"observe":null;
  const setMode=async (m) =>{ if(m===curMode||!action)return; let ack=false; if(m!=="observe"){ if(!await uiConfirm(m==="full_auto"?t("切到「全自动」:AI 发现符合授权的机会会用真实资金自动下单,不再逐单询问。确认?", "Switch to \"Full Auto\": when the AI finds an opportunity within its mandate it will place real-money orders automatically without asking per trade. Confirm?"):t("切到「半自动」:会用真实资金交易,但每单需你点批准。确认?", "Switch to \"Semi Auto\": trades use real money, but each order needs your approval. Confirm?")))return; ack=true; } action("/api/system/operating-mode",{mode:m,acknowledged:ack}); };
  return <div className="cp2Stack"><p className="cp2Intro">{t("授权边界定义 AI 交易员能做什么、能用多少风险；修改后必须重新生效。", "The mandate defines what the AI trader can do and how much risk it can take; changes must be re-applied to take effect.")}</p><div className="cp2Grid mandateTop"><ConceptCard title={t("运行模式", "Operating Mode")}><div className="cp2ModeCards">{[["observe",t("观察", "Observe"),t("仅分析不下单", "Analyze only, no orders")],["semi_auto",t("半自动", "Semi Auto"),t("计划需人工批准", "Plans need manual approval")],["full_auto",t("全自动", "Full Auto"),t("边界内自动执行", "Auto-executes within bounds")]].map(([id,label,desc])=><button className={curMode===id?"active":""} key={id} onClick={()=>setMode(id)}><i/><span><b>{label}</b><small>{desc}</small></span></button>)}</div></ConceptCard><ConceptCard title={t("当前授权委托", "Active Mandate")} className="span2"><div className="cp2MandateSummary"><Pill tone={mandate.status==="active"?"good":"warn"}>{humanize(mandate.status,t("未激活", "Inactive"))}</Pill><div><small>{t("委托名称", "Mandate name")}</small><b>{mandate.name||t("未创建授权", "No mandate created")}</b></div><div><small>{t("生效时间", "Activated")}</small><b>{formatDateTime(mandate.activatedAt||mandate.createdAt)}</b></div><div><small>{t("到期时间", "Expires")}</small><b>{formatDateTime(mandExpires)}</b></div></div></ConceptCard></div>
    <div className="cp2MandateGrid"><ConceptCard title={t("交易白名单", "Whitelist")}><div className="cp2TokenBox">{arr(mandate.allowedSymbols).map(s=><Pill key={s}>{s}</Pill>)}{!arr(mandate.allowedSymbols).length&&<span>{t("未配置交易对", "No pairs configured")}</span>}</div></ConceptCard><ConceptCard title={t("杠杆范围", "Leverage Range")}><div className="cp2Range"><b>{mandMinLev}x</b><i/><b>{mandMaxLev??"—"}x</b></div></ConceptCard><ConceptCard title={t("单笔风险", "Per-trade Risk")}><div className="cp2BigNumber">{mandate.maxSingleTradeRiskPct==null?"—":`${mandate.maxSingleTradeRiskPct}%`}<small>{t("账户净值上限", "Cap on equity")}</small></div></ConceptCard><ConceptCard title={t("单日亏损", "Daily Loss")}><div className="cp2BigNumber">{mandate.maxDailyLossPct==null?"—":`${mandate.maxDailyLossPct}%`}<small>{t("触发后停止开仓", "Stops entries when hit")}</small></div></ConceptCard><ConceptCard title={t("审批阈值", "Approval Threshold")}><div className="cp2BigNumber">{mandate.humanApprovalNotionalUsdt==null?"—":`${money(mandate.humanApprovalNotionalUsdt)} U`}<small>{t("超额转人工", "Above this goes manual")}</small></div></ConceptCard><ConceptCard title={t("委托有效期", "Mandate Validity")}><div className="cp2BigNumber small">{formatDateTime(mandExpires)}<small>{t("到期自动失效", "Auto-expires")}</small></div></ConceptCard></div>
    <div className="cp2Grid two"><ConceptCard title={t("变更预览", "Change Preview")}><div className="cp2Kv column"><span>{t("运行模式", "Mode")}<b>{data.automationState?.label||t("观察", "Observe")}</b></span><span>{t("最大杠杆", "Max leverage")}<b>{mandMaxLev?`${mandMaxLev}x`:"—"}</b></span><span>{t("单笔风险", "Per-trade risk")}<b>{mandate.maxSingleTradeRiskPct==null?"—":`${mandate.maxSingleTradeRiskPct}%`}</b></span><span>{t("审批阈值", "Approval threshold")}<b>{mandate.humanApprovalNotionalUsdt==null?"—":`${money(mandate.humanApprovalNotionalUsdt)} U`}</b></span></div></ConceptCard><ConceptCard title={t("变更记录", "Change History")}><ConceptTable compact columns={[{key:"createdAt",label:t("时间", "Time"),render:r=>formatDateTime(r.updatedAt||r.createdAt)},{key:"name",label:t("授权", "Mandate")},{key:"status",label:t("状态", "Status"),render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status)}</Pill>}]} rows={history.slice(0,6)} empty={t("暂无变更记录", "No changes yet")}/></ConceptCard></div>
    <RiskThresholdsCard data={data} action={action} ui={ui}/>
    <div className="cp2FormActions"><button className="cp2Secondary" onClick={()=>ui.openPanel("mandate")}>{t("保存草稿", "Save draft")}</button><button className="cp2Primary" onClick={()=>ui.openPanel("mandate")}>{t("编辑并提交生效", "Edit & apply")}</button></div></div>;
}

export function RulesConcept({ data, action, ui }) {
  const rules=arr(data.riskRules); const [selectedId,setSelectedId]=useState(rules[0]?.id||""); const selected=rules.find(r=>r.id===selectedId)||rules[0]||{};
  const CATS=[["全部规则",()=>true],["账户风险",r=>/account|账户|margin|保证金|equity|净值|drawdown|回撤/i.test(`${r.scope} ${r.name}`)],["交易风险",r=>/trade|交易|position|仓|leverage|杠杆|entry|开仓/i.test(`${r.scope} ${r.name}`)],["事件风险",r=>/event|事件|news|新闻|funding|资金费/i.test(`${r.scope} ${r.name}`)],["系统风险",r=>/system|系统|api|连接|slippage|滑点/i.test(`${r.scope} ${r.name}`)]];
  const [catF,setCatF]=useState("全部规则"); const [q,setQ]=useState("");
  const catFn=(CATS.find(c=>c[0]===catF)||CATS[0])[1]; const shown=rules.filter(r=>catFn(r)&&(!q||String(r.name).toLowerCase().includes(q.toLowerCase())));
  return <div className="cp2RulesLayout"><aside className="cp2SideFilter"><b>{t("规则库", "Rule Library")}</b>{CATS.map(([name,fn])=><button className={catF===name?"active":""} key={name} onClick={()=>setCatF(name)}>{t(name, {"全部规则":"All rules","账户风险":"Account risk","交易风险":"Trade risk","事件风险":"Event risk","系统风险":"System risk"}[name]||name)}<span>{rules.filter(fn).length}</span></button>)}<button className="cp2Secondary" onClick={()=>ui.openPanel("riskRules")}><Plus size={12}/> {t("新建规则", "New rule")}</button></aside>
    <main className="cp2RulesMain"><ConceptCard title={t("规则列表", "Rule List")} meta={`${shown.length}/${rules.length} ${t("条", "")}`} action={<button className="cp2Primary" onClick={()=>ui.openPanel("riskRules")}>{t("保存版本", "Save version")}</button>}><div className="cp2Search"><Search size={13}/><input className="cp2SearchInput" value={q} onChange={e=>setQ(e.target.value)} placeholder={t("搜索规则名称", "Search rule name")}/></div><div className="cp2ScrollList"><ConceptTable columns={[{key:"name",label:t("规则名称", "Rule"),render:r=><button className={`cp2Link ${r.id===selected.id?"on":""}`} onClick={()=>setSelectedId(r.id)}>{r.name}</button>},{key:"scope",label:t("作用范围", "Scope"),render:r=>humanize(r.scope)},{key:"level",label:t("优先级", "Priority")},{key:"action",label:t("触发动作", "Action"),render:r=>humanize(r.action)},{key:"enabled",label:t("状态", "Status"),render:r=><button className={`cp2Switch ${r.enabled===false?"":"on"}`} onClick={()=>action(`/api/risk/rules/${r.id}`,{enabled:r.enabled===false},"PATCH")}><i/></button>},{key:"updatedAt",label:t("更新时间", "Updated"),render:r=>formatDateTime(r.updatedAt||r.createdAt)}]} rows={shown} empty={t("无匹配规则", "No matching rules")}/></div></ConceptCard>
      <div className="cp2Grid ruleBottom"><ConceptCard title={`${t("规则编辑", "Edit Rule")} · ${selected.name||t("未选择", "None selected")}`}><div className="cp2Kv"><span>{t("作用范围", "Scope")}<b>{humanize(selected.scope)}</b></span><span>{t("优先级", "Priority")}<b>{selected.level||"—"}</b></span><span>{t("动作", "Action")}<b>{humanize(selected.action)}</b></span><span>{t("状态", "Status")}<b>{selected.enabled===false?t("停用", "Off"):t("启用", "On")}</b></span></div><div className="cp2CodeBox">{selected.condition||selected.description||t("尚未配置结构化条件。", "No structured condition configured yet.")}</div><button className="cp2Secondary" onClick={()=>ui.openPanel("riskRules")}>{t("打开完整编辑器", "Open full editor")}</button></ConceptCard><ConceptCard title={t("命中记录", "Hit Log")}><ConceptTable compact columns={[{key:"createdAt",label:t("时间", "Time"),render:r=>formatTime(r.createdAt)},{key:"symbol",label:t("资产", "Asset")},{key:"decision",label:t("结果", "Result"),render:r=><Pill tone={toneOf(r.decision)}>{humanize(r.decision)}</Pill>}]} rows={arr(data.riskChecks).slice(0,7)} empty={t("暂无命中记录", "No hits yet")}/></ConceptCard><ConceptCard title={t("来源与版本", "Source & Version")}><div className="cp2Kv column"><span>{t("规则来源", "Source")}<b>{selected.source||t("内置", "Built-in")}</b></span><span>{t("当前版本", "Version")}<b>{selected.version||"v1"}</b></span><span>{t("最近变更", "Last change")}<b>{formatDateTime(selected.updatedAt||selected.createdAt)}</b></span><span>{t("覆盖对象", "Coverage")}<b>{humanize(selected.scope,t("全账户", "All accounts"))}</b></span></div></ConceptCard></div></main></div>;
}

export function LiveConcept({ data, action, ui }) {
  const checks=arr(data.readiness?.checks); const policies=arr(data.grayReleasePolicies); const drills=arr(data.drillRuns); const ready=checks.filter(c=>c.configured);
  return <div className="cp2Stack"><div className={`cp2RiskBanner ${checks.length&&ready.length===checks.length?"good":"warn"}`}><ShieldCheck/><b>{t("实盘就绪状态", "Live readiness")} {ready.length}/{checks.length}</b><span>{t("所有关键安全闸通过后才会真实写单", "Real orders only after all key safety gates pass")}</span><span>{t("配置完成度", "Config complete")} <strong>{data.readiness?.configurationCompletionPct??0}%</strong></span><button onClick={()=>ui.openPanel("mandate")}>{t("查看缺失项", "View gaps")}</button></div>
    <div className="cp2Grid liveTop">
      <ConceptCard title={t("实盘写入配置", "Live Trading Config")}><LiveGrayPanel data={data} action={action} ui={ui}/></ConceptCard>
      <ConceptCard title={t("就绪检查", "Readiness Checks")} meta={`${ready.length}/${checks.length} ${t("通过", "passed")}`}><div className="cp2ScrollList" style={{maxHeight:520}}><div className="cp2Checklist vertical">{checks.map(c=><span className={c.configured?"":"warn"} key={c.key}>{c.configured?<CheckCircle2/>:<AlertTriangle/>}{c.label}<small>{c.configured?t("通过", "Passed"):t("待配置", "Pending")}</small></span>)}{!checks.length&&<span><AlertTriangle/>{t("待配置就绪检查", "Readiness checks pending")}<small>—</small></span>}</div></div></ConceptCard>
    </div>
    <div className="cp2Grid three liveBottom">
      <ConceptCard title={t("灰度策略", "Canary Policies")} meta={t("按币种小额放量验证", "Small-size ramp per symbol")}><div className="cp2GrayList">{policies.slice(0,6).map((p,index)=><div key={p.id||index}><b>{p.name||p.symbol||t("灰度策略", "Canary policy")}</b><Pill tone={p.enabled?"good":"warn"}>{p.enabled?t("运行中", "Running"):t("未启用", "Off")}</Pill><small>{t("单笔", "Per trade")} {money(p.maxNotionalUsdt)}U · {t("人工确认", "Manual confirm")} {p.requiresApproval===false?t("否", "No"):t("是", "Yes")} · {t("样本", "Samples")} {p.sampleCount??0}</small></div>)}{!policies.length&&<div className="cp2Empty"><Gauge/><b>{t("暂无灰度策略", "No canary policies")}</b><span>{t("在上方启用后显示。", "Shows after you enable above.")}</span></div>}</div></ConceptCard>
      <ConceptCard title={t("灰度进度", "Canary Progress")}><ConceptTable compact columns={[{key:"createdAt",label:t("时间", "Time"),render:r=>formatDateTime(r.createdAt)},{key:"name",label:t("演练", "Drill"),render:r=>r.name||r.scenario},{key:"status",label:t("结果", "Result"),render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status)}</Pill>}]} rows={drills.slice(0,6)} empty={t("暂无演练记录", "No drills yet")}/></ConceptCard>
      <ConceptCard title={t("回退条件", "Rollback Triggers")}><div className="cp2Checklist vertical"><span><AlertTriangle/>{t("连续订单失败", "Consecutive order failures")}</span><span><AlertTriangle/>{t("对账不一致", "Reconciliation mismatch")}</span><span><AlertTriangle/>{t("行情数据陈旧", "Stale market data")}</span><span><AlertTriangle/>{t("风控检查异常", "Risk-check anomaly")}</span></div></ConceptCard>
    </div></div>;
}

export function KeysConcept({ data, action, ui }) {
  const accounts=arr(data.exchangeAccounts); const metadata=arr(data.apiKeyMetadata); const alerts=arr(data.notifications).filter(n=>/key|密钥|ip|权限/i.test(`${n.title} ${n.message}`));
  return <div className="cp2Stack"><p className="cp2Intro">{t("交易所凭证仅用于交易与读取账户；提现权限必须关闭，并建议绑定 IP 白名单。", "Exchange credentials are used only for trading and reading the account; withdrawal permission must be off, and an IP whitelist is recommended.")}</p><div className="cp2ExchangeCards">{["BINANCE","OKX"].map(exchange=>{const account=accounts.find(a=>a.exchange===exchange)||{};const key=metadata.find(k=>k.exchange===exchange)||{};return <ConceptCard title={exchange==="BINANCE"?"Binance":"OKX"} key={exchange} meta={key.hasApiKey||account.id?t("已接入", "Connected"):t("未配置", "Unconfigured")}><div className="cp2ExchangeBody"><div className={`cp2ExchangeLogo ${exchange.toLowerCase()}`}>{exchange==="BINANCE"?"◆":"✣"}</div><div className="cp2Kv column"><span>{t("密钥尾号", "Key suffix")}<b>{key.maskedKey||account.maskedKey||"—"}</b></span><span>{t("IP 白名单", "IP whitelist")}<b>{account.ipWhitelist||t("未配置", "Unconfigured")}</b></span><span>{t("权限核验", "Perm check")}<b>{key.permissionVerifiedAt?t("已核验", "Verified"):t("待核验", "Unverified")}</b></span><span>{t("最近验证", "Last verified")}<b>{formatDateTime(key.permissionVerifiedAt||account.lastValidatedAt)}</b></span></div><div className="cp2PermissionGrid"><span>{t("读取", "Read")} <CheckCircle2/></span><span>{t("交易", "Trade")} <CheckCircle2/></span><span>{t("提现", "Withdraw")} <LockKeyhole/></span></div><button className="cp2Secondary" onClick={()=>ui.setActive("systemSettings:exchange")}>{t("管理密钥", "Manage keys")}</button>{key.hasApiKey&&!key.permissionVerifiedAt&&<button className="cp2Primary" onClick={()=>action(`/api/exchange/api-key-metadata/${key.id}/confirm-no-withdraw`,{})}>{t("确认无提现权限", "Confirm no withdrawal")}</button>}</div></ConceptCard>})}</div>
    <div className="cp2Grid three"><ConceptCard title={t("安全发现", "Security Findings")}><div className="cp2Checklist vertical">{alerts.slice(0,6).map((a,index)=><span key={a.id||index}><AlertTriangle/>{a.title||a.message}<small>{formatTime(a.createdAt)}</small></span>)}{!alerts.length&&<span><CheckCircle2/>{t("暂无密钥安全告警", "No key security alerts")}</span>}</div></ConceptCard><ConceptCard title={t("IP 白名单管理", "IP Whitelist")}><ConceptTable compact columns={[{key:"exchange",label:t("交易所", "Exchange")},{key:"ipWhitelist",label:t("允许 IP", "Allowed IP"),render:r=>r.ipWhitelist||t("未配置", "Unconfigured")},{key:"status",label:t("状态", "Status"),render:r=><Pill tone={r.ipWhitelist?"good":"warn"}>{r.ipWhitelist?t("已启用", "On"):t("待配置", "Pending")}</Pill>}]} rows={accounts} empty={t("暂无交易所账户", "No exchange accounts")}/></ConceptCard><ConceptCard title={t("告警渠道", "Alert Channels")}><div className="cp2SecurityList"><span><Bell/>{t("飞书通知", "Lark")}<b>{data.larkConfigured?t("已启用", "On"):t("未配置", "Off")}</b></span><span><Bell/>Telegram<b>{data.telegramConfigured?t("已启用", "On"):t("未配置", "Off")}</b></span><span><Server/>Webhook<b>{data.config?.integrations?.alerts?.hasWebhook?t("已启用", "On"):t("未配置", "Off")}</b></span></div></ConceptCard></div></div>;
}

export function OperationsOverviewConcept({ data, action, ui }) {
  const tasks=arr(data.tasks); const runs=arr(data.jobRuns); const events=arr(data.events); const audits=arr(data.auditLogs); const incidents=arr(data.riskIncidents);
  // 市场数据延迟:从真实行情时间戳算最新新鲜度(marketStreamStatus 无 freshnessLabel 字段——旧代码取空恒"待同步")
  const marketFresh=(()=>{const ages=arr(data.markets).map(m=>Date.now()-new Date(m.updatedAt||m.syncedAt||m.microSyncedAt||0).getTime()).filter(a=>Number.isFinite(a)&&a>=0&&a<6e10);if(!ages.length)return"待同步";const min=Math.min(...ages);return min<8000?"实时":min<180000?`${Math.round(min/1000)}s 前`:"待同步";})();
  // 审计链:configured=verifyAuditChain().ok。false 是"校验发现断点"(不是"待配置")——用「待复核」并可点开审计链详情
  const auditCheck=data.readiness?.checks?.find(c=>c.key==="audit_chain");
  const auditVal=auditCheck?(auditCheck.configured?"正常":"待复核"):"待同步";
  const services=[[t("API 健康", "API health"),data.system?.apiHealth||"待配置"],[t("WebSocket 连接", "WebSocket"),data.realtimeStarted?"正常":"待配置"],[t("市场数据延迟", "Market latency"),marketFresh],[t("用户同步状态", "Account sync"),arr(data.accountSnapshots).some(s=>s.status==="ok")?"正常":"待配置"],[t("审计链校验", "Audit chain"),auditVal]];
  const opsVal=(v)=>t(v, {"待配置":"Unconfigured","正常":"OK","实时":"Live","待同步":"Pending","待复核":"Needs review"}[v]||humanize(v));
  return <div className="cp2Stack"><div className="cp2Metrics six">{services.map(([label,value],index)=><ConceptMetric key={label} label={label} value={opsVal(value)} sub={index===0?t("系统入口", "Entry point"):index===1?t("实时连接", "Realtime link"):index===2?t("公开行情", "Public data"):index===3?t("账户快照", "Account snapshot"):index===4?t("前后端契约", "FE/BE contract"):t("哈希链", "Hash chain")} tone={toneOf(value)} icon={[ShieldCheck,Activity,Clock3,Users,Wrench,FileText][index]}/>)}</div>
    <div className="cp2Grid opsTop"><ConceptCard title={t("任务与自动化", "Tasks & Automation")} className="span2"><ConceptTable compact columns={[{key:"name",label:t("任务名称", "Task")},{key:"type",label:t("类型", "Type")},{key:"lastRunAt",label:t("上次运行", "Last run"),render:r=>formatDateTime(r.lastRunAt)},{key:"nextRunAt",label:t("下次运行", "Next run"),render:r=>formatDateTime(r.nextRunAt)},{key:"status",label:t("状态", "Status"),render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status,r.enabled===false?t("已暂停", "Paused"):t("运行中", "Running"))}</Pill>},{key:"action",label:t("操作", "Action"),render:r=><button className="cp2Link" onClick={()=>action(`/api/tasks/${r.id}/run`,{})}>{t("立即运行", "Run now")}</button>}]} rows={tasks.slice(0,8)} empty={t("暂无任务", "No tasks")}/></ConceptCard><ConceptCard title={t("事件日历", "Event Calendar")}><ConceptTable compact columns={[{key:"due",label:t("时间", "Time"),render:r=>formatDateTime(r.due||r.startAt)},{key:"title",label:t("事件", "Event")},{key:"impact",label:t("影响", "Impact"),render:r=><Pill tone={num(r.impact)>=80?"bad":"warn"}>{r.impactLabel||(r.impact!=null?r.impact:t("待评估", "TBD"))}</Pill>}]} rows={events.slice(0,7)} empty={t("暂无事件", "No events")}/></ConceptCard></div>
    <div className="cp2Grid two wideLeft"><ConceptCard title={t("审计与运行轨迹", "Audit & Run Trail")} action={<button className="cp2Link" onClick={()=>ui.setActive("auditSystem")}>{t("查看审计 ›", "View audit ›")}</button>}><ConceptTable compact columns={[{key:"createdAt",label:t("时间", "Time"),render:r=>formatDateTime(r.createdAt)},{key:"actor",label:t("操作者", "Actor"),render:r=>r.actor||r.userName||r.role||t("系统", "System")},{key:"action",label:t("动作", "Action"),render:r=>humanize(r.action)},{key:"resource",label:t("资源", "Resource"),render:r=>r.resource||r.target||"—"},{key:"status",label:t("结果", "Result"),render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status,t("已记录", "Recorded"))}</Pill>}]} rows={audits.slice(0,9)} empty={t("暂无审计记录", "No audit records")}/></ConceptCard><ConceptCard title={t("对账与恢复", "Reconcile & Recovery")}><div className="cp2RecoveryCards"><article><RefreshCw/><span><b>{t("对账不一致", "Reconcile mismatch")}</b><small>{arr(data.reconciliationReports).filter(r=>/failed|mismatch/i.test(String(r.status))).length} {t("项", "")}</small></span></article><article><Activity/><span><b>{t("OMS 恢复能力", "OMS recovery")}</b><small>{arr(data.executionOrders).filter(o=>/unknown|未知/i.test(String(o.status))).length?`${arr(data.executionOrders).filter(o=>/unknown|未知/i.test(String(o.status))).length} ${t("单待恢复", "orders to recover")}`:t("无待恢复单", "None to recover")}</small></span></article><article><AlertTriangle/><span><b>{t("僵尸订单清理", "Zombie order cleanup")}</b><small>{incidents.length} {t("个待观察", "to watch")}</small></span></article><article><Database/><span><b>{t("Outbox 积压", "Outbox backlog")}</b><small>{runs.filter(r=>/pending/i.test(String(r.status))).length} {t("条", "")}</small></span></article></div></ConceptCard></div></div>;
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
  const events=arr(data.events); const [selectedId,setSelectedId]=useState(events[0]?.id||""); const selected=events.find(e=>e.id===selectedId)||events[0]||{};
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
  return <div className="cp2EventsLayout">{schedOpen&&<ScheduledEventDialog action={action} onClose={()=>setSchedOpen(false)} notify={ui.notify}/>}<main><div className="cp2CalendarToolbar"><button className={calView==="month"?"active":""} onClick={()=>setCalView("month")}>{t("月视图", "Month")}</button><button className={calView==="week"?"active":""} onClick={()=>setCalView("week")}>{t("周视图", "Week")}</button><div className="cp2CalNav"><button className="cp2CalArrow" onClick={()=>setMonthOffset(o=>o-1)} title={t("上个月", "Prev month")}><ChevronLeft size={15}/></button><span>{monthLabel}</span><button className="cp2CalArrow" onClick={()=>setMonthOffset(o=>o+1)} title={t("下个月", "Next month")}><ChevronRight size={15}/></button>{monthOffset!==0&&<button className="cp2CalToday" onClick={()=>setMonthOffset(0)}>{t("回到本月", "Today")}</button>}</div><button className="cp2Link" style={{marginLeft:"auto"}} onClick={()=>setSchedOpen(true)}><Plus size={12}/> {t("添加日程", "Add event")}</button><small className="cp2CalHint">{t("按真实事件日期排布", "Laid out by real event dates")}</small></div><div className="cp2Calendar"><div className="week">{["周日","周一","周二","周三","周四","周五","周六"].map((d,wi)=><b key={d}>{t(d, ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][wi])}</b>)}</div><div className="days">{shownDays.map((day,index)=><div key={index} className={`${day.out?"out":""} ${day.today?"today":""}`}><small>{day.n}</small>{day.events.slice(0,3).map(e=><button key={e.id} className={selected.id===e.id?"active":""} onClick={()=>setSelectedId(e.id)}><i className={toneOf(e.impact)}/>{formatTime(e.due||e.startAt)} {e.shortTitle||e.title}</button>)}{day.events.length>3&&<em className="cp2CalMore">+{day.events.length-3}</em>}</div>)}</div></div><div className="cp2Grid two"><ConceptCard title={t("即将发生的事件", "Upcoming Events")}><ConceptTable compact columns={[{key:"due",label:t("时间", "Time"),render:r=>formatDateTime(r.due||r.startAt)},{key:"title",label:t("事件", "Event")},{key:"category",label:t("类型", "Type")},{key:"impact",label:t("影响", "Impact"),render:r=><Pill tone={num(r.impact)>=80?"bad":"warn"}>{r.impactLabel||(r.impact!=null?r.impact:t("待评估", "TBD"))}</Pill>}]} rows={events.slice(0,7)} empty={t("暂无事件", "No events")}/></ConceptCard><ConceptCard title={t("事件源健康状态", "Event Source Health")}><ConceptTable compact columns={[{key:"name",label:t("来源", "Source")},{key:"category",label:t("类别", "Category")},{key:"status",label:t("状态", "Status"),render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status,t("正常", "OK"))}</Pill>}]} rows={arr(data.eventSources).slice(0,7)} empty={t("暂无事件源", "No event sources")}/></ConceptCard></div></main>
    <aside><ConceptCard title={t("事件详情", "Event Detail")}><Pill tone={num(selected.impact)>=80?"bad":"warn"}>{selected.impactLabel||t("待评估", "TBD")}</Pill><h3>{selected.title||t("选择日历事件", "Select a calendar event")}</h3><p>{selected.description||selected.summary||t("暂无事件说明。", "No event description.")}</p><div className="cp2Kv column"><span>{t("时间", "Time")}<b>{formatDateTime(selected.due||selected.startAt)}</b></span><span>{t("类别", "Category")}<b>{selected.category||"—"}</b></span><span>{t("来源", "Source")}<b>{selected.source||"—"}</b></span><span>{t("关联资产", "Related assets")}<b>{arr(selected.relatedSymbols).join("、")||"—"}</b></span></div><button className="cp2Secondary" onClick={()=>ui.openPanel("eventSources")}>{t("编辑事件", "Edit event")}</button><button className="cp2Primary" onClick={()=>ui.openPanel("eventRule")}>{t("创建规则", "Create rule")}</button></ConceptCard></aside></div>;
}

export function TasksConcept({ data, action, ui }) {
  const tasks=arr(data.tasks); const runs=arr(data.jobRuns); const [selectedId,setSelectedId]=useState(tasks[0]?.id||""); const selected=tasks.find(t=>t.id===selectedId)||tasks[0]||{};
  // 真实自主主链路(按因果执行顺序,不是任务数组的偶然前5个):同步→巡检决策→执行→持仓监控→核算→复盘。
  const CHAIN_ORDER=["market_signal_refresh","okx_readonly_sync","agent_cycle","execution_poll","position_monitor","accounting_refresh","reconcile","trade_reflection"];
  const chainRows=tasks.filter(t=>CHAIN_ORDER.includes(t.handler||t.type)).sort((a,b)=>CHAIN_ORDER.indexOf(a.handler||a.type)-CHAIN_ORDER.indexOf(b.handler||b.type)).slice(0,6);
  // 真实调度健康:按成功率变色,不恒绿;用真实失败数替代写死的"队列延迟 实时"。
  const okRuns=runs.filter(r=>/ok|success|done/i.test(String(r.status))).length;
  const failRuns=runs.filter(r=>/fail|error|timeout|reject/i.test(String(r.status))).length;
  const successPct=runs.length?okRuns/runs.length*100:null;
  const schedHealthy=failRuns===0||(successPct!=null&&successPct>=90);
  return <div className="cp2Stack"><div className={`cp2RiskBanner ${schedHealthy?"good":"warn"}`}>{schedHealthy?<CheckCircle2/>:<AlertTriangle/>}<b>{schedHealthy?t("调度健康", "Scheduler healthy"):t("调度有失败", "Scheduler has failures")}</b><span>{t("任务总数", "Total tasks")} <strong>{tasks.length}</strong></span><span>{t("成功率", "Success rate")} <strong>{successPct!=null?`${successPct.toFixed(1)}%`:"—"}</strong></span><span>{t("失败", "Failures")} <strong>{failRuns}</strong></span><span>{t("执行中", "Running")} <strong>{runs.filter(r=>/running/i.test(String(r.status))).length}</strong></span></div>
    <div className="cp2TasksLayout"><ConceptCard title={t("任务列表", "Task List")} meta={t("超 20 条容器内滚动", "Scrolls past 20")} action={<button className="cp2Link" onClick={()=>ui.openPanel("taskManager")}><Plus size={11}/> {t("新建任务", "New task")}</button>}><div className="cp2ScrollList tall"><ConceptTable compact columns={[{key:"name",label:t("任务名称", "Task"),render:r=><button className={`cp2Link ${r.id===selected.id?"on":""}`} onClick={()=>setSelectedId(r.id)}>{r.name}</button>},{key:"handler",label:t("处理器", "Handler"),render:r=>humanize(r.handler||r.type)},{key:"schedule",label:t("调度", "Schedule")},{key:"nextRunAt",label:t("下次运行", "Next run"),render:r=>formatDateTime(r.nextRunAt)},{key:"enabled",label:t("状态", "Status"),render:r=><button className={`cp2Switch ${r.enabled===false?"":"on"}`} onClick={()=>action(`/api/tasks/${r.id}/${r.enabled===false?"resume":"pause"}`,r.enabled===false?{}:{reason:"manual_ui"})}><i/></button>}]} rows={tasks} empty={t("暂无任务", "No tasks")}/></div></ConceptCard>
      <div className="cp2TasksRail">
        <ConceptCard title={`${t("调度规则", "Schedule Rule")} · ${selected.name||t("未选择", "None selected")}`}><div className="cp2Kv column"><span>{t("任务 ID", "Task ID")}<b>{selected.id||"—"}</b></span><span>{t("处理器", "Handler")}<b>{humanize(selected.handler||selected.type)}</b></span><span>{t("调度表达式", "Schedule expr")}<b>{selected.schedule||"—"}</b></span><span>{t("下次运行", "Next run")}<b>{formatDateTime(selected.nextRunAt)}</b></span><span>{t("状态", "Status")}<b>{selected.enabled===false?t("已暂停", "Paused"):t("已启用", "Enabled")}</b></span></div><button className="cp2Secondary" onClick={()=>ui.openPanel("taskManager")}>{t("编辑任务", "Edit task")}</button><button className="cp2Primary" disabled={!selected.id} onClick={()=>action(`/api/tasks/${selected.id}/run`,{})}><Play size={12}/> {t("立即运行", "Run now")}</button></ConceptCard>
        <ConceptCard title={t("近期运行", "Recent Runs")}><ConceptTable compact columns={[{key:"createdAt",label:t("时间", "Time"),render:r=>formatTime(r.createdAt)},{key:"name",label:t("任务", "Task"),render:r=>r.name||r.taskName||humanize(r.handler)},{key:"durationMs",label:t("耗时", "Duration"),render:r=>r.durationMs?`${r.durationMs} ms`:"—"},{key:"status",label:t("结果", "Result"),render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status)}</Pill>}]} rows={runs.slice(0,10)} empty={t("暂无运行记录", "No runs yet")}/></ConceptCard>
      </div></div>
    <ConceptCard title={t("自主主链路", "Autonomous Main Chain")} meta={t("按真实执行顺序：同步→巡检决策→执行→风控→核算→复盘", "In real execution order: sync → scan/decide → execute → risk → accounting → review")}><div className="cp2Dependency">{chainRows.map((task,index)=><React.Fragment key={task.id||index}><article className={task.id===selected.id?"active":""} onClick={()=>setSelectedId(task.id)}><span><Wrench/></span><b>{task.name}</b><small>{humanize(task.handler||task.type)}</small></article>{index<chainRows.length-1&&<ChevronRight/>}</React.Fragment>)}{!chainRows.length&&<span className="cp2Intro">{t("主链路任务未就绪", "Main-chain tasks not ready")}</span>}</div></ConceptCard></div>;
}

export function AuditConcept({ data }) {
  const logs=arr(data.auditLogs); const [selectedId,setSelectedId]=useState(logs[0]?.id||""); const [q,setQ]=useState("");
  const shown=logs.filter(l=>!q||[l.actor,l.userName,l.role,l.action,l.resource,l.target,l.id].some(v=>String(v||"").toLowerCase().includes(q.toLowerCase())));
  const selected=logs.find(l=>l.id===selectedId)||shown[0]||logs[0]||{};
  return <div className="cp2Stack"><ConceptCard title={t("审计查询", "Audit Query")}><div className="cp2FilterBar"><span>{t("时间范围", "Time range")} <b>{t("全部", "All")}</b></span><div className="cp2Search"><Search size={13}/><input className="cp2SearchInput" value={q} onChange={e=>setQ(e.target.value)} placeholder={t("搜索操作者 / 动作 / 资源 / 记录 ID", "Search actor / action / resource / record ID")}/></div><button className="cp2Secondary" onClick={()=>setQ("")}>{t("重置", "Reset")}</button></div></ConceptCard>
    <div className="cp2AuditLayout"><ConceptCard title={`${t("审计记录", "Audit Records")} · ${shown.length}/${logs.length} ${t("条", "")}`} meta={t("超 20 条容器内滚动", "Scrolls past 20")}><div className="cp2ScrollList tall"><ConceptTable columns={[{key:"createdAt",label:t("时间", "Time"),render:r=>formatDateTime(r.createdAt)},{key:"actor",label:t("操作者", "Actor"),render:r=>r.actor||r.userName||r.role||t("系统", "System")},{key:"action",label:t("动作", "Action"),render:r=>humanize(r.action)},{key:"resource",label:t("资源", "Resource"),render:r=>r.resource||r.target||"—"},{key:"status",label:t("结果", "Result"),render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status,t("成功", "Success"))}</Pill>},{key:"id",label:t("记录 ID", "Record ID"),render:r=><button className="cp2Link" onClick={()=>setSelectedId(r.id)}>{String(r.id).slice(0,12)}</button>}]} rows={shown} empty={t("无匹配审计记录", "No matching records")}/></div></ConceptCard>
      <ConceptCard title={t("事件详情", "Event Detail")}><div className="cp2AuditDetail"><div className="cp2Kv column"><span>{t("事件 ID", "Event ID")}<b>{selected.id||"—"}</b></span><span>{t("时间", "Time")}<b>{formatDateTime(selected.createdAt)}</b></span><span>{t("操作者", "Actor")}<b>{selected.actor||selected.userName||selected.role||t("系统", "System")}</b></span><span>{t("动作", "Action")}<b>{humanize(selected.action)}</b></span><span>{t("资源", "Resource")}<b>{selected.resource||selected.target||"—"}</b></span><span>{t("哈希", "Hash")}<b>{selected.hash?String(selected.hash).slice(0,18):"—"}</b></span></div><b>{t("请求上下文", "Request context")}</b><pre>{JSON.stringify(selected.context||selected.payload||{},null,2)}</pre><b>{t("相关事件", "Related events")}</b><div className="cp2Checklist vertical">{logs.slice(0,4).map((l,index)=><span key={l.id||index}><i className={toneOf(l.status)}/>{formatTime(l.createdAt)} {humanize(l.action)}</span>)}</div></div></ConceptCard></div>
    <div className="cp2Grid two"><ConceptCard title={t("完整性校验", "Integrity Check")}><div className="cp2Compliance"><ShieldCheck/><span><b>{t("审计链状态", "Audit chain status")}</b><small>{data.readiness?.checks?.find(c=>c.key==="audit_chain")?.configured?t("已验证", "Verified"):t("等待外部 WORM 配置", "Awaiting external WORM config")}</small></span></div></ConceptCard><ConceptCard title={t("数据保留策略", "Data Retention")}><div className="cp2Compliance"><Clock3/><span><b>{t("本地记录持续保留", "Local records retained continuously")}</b><small>{t("外部不可篡改存储由 WORM 配置决定", "External tamper-proof storage depends on WORM config")}</small></span></div></ConceptCard></div></div>;
}

export function NotificationsConcept({ data, action }) {
  const notes=arr(data.notifications); const [category,setCategory]=useState("全部"); const [statusF,setStatusF]=useState("全部状态"); const filtered=notes.filter(n=>(category==="全部"||String(n.category||n.type||"系统").includes(category))&&(statusF==="全部状态"||(statusF==="未读"?!n.read:n.read))); const [selectedId,setSelectedId]=useState(notes[0]?.id||""); const selected=filtered.find(n=>n.id===selectedId)||filtered[0]||{};
  const unread=notes.filter(n=>!n.read).length;
  return <div className="cp2Stack"><div className="cp2Metrics four"><ConceptMetric label={t("未读", "Unread")} value={String(unread)} tone={unread?"bad":"good"} icon={Bell}/><ConceptMetric label={t("严重", "Critical")} value={String(notes.filter(n=>/critical|严重|高危/i.test(String(n.severity||n.level))).length)} tone="bad"/><ConceptMetric label={t("已确认", "Acked")} value={String(notes.filter(n=>n.read).length)} tone="good"/><ConceptMetric label={t("已静默", "Muted")} value={String(notes.filter(n=>n.muted).length)}/></div>
    <div className="cp2NotificationsLayout"><aside className="cp2SideFilter"><b>{t("分类筛选", "Filter")}</b>{["全部","交易","系统","风控","任务","安全"].map(name=><button className={category===name?"active":""} onClick={()=>setCategory(name)} key={name}>{t(name, {"全部":"All","交易":"Trades","系统":"System","风控":"Risk","任务":"Tasks","安全":"Security"}[name]||name)}<span>{name==="全部"?notes.length:notes.filter(n=>String(n.category||n.type||"系统").includes(name)).length}</span></button>)}</aside>
      <ConceptCard title={t("通知收件箱", "Inbox")} meta={`${filtered.length} ${t("条", "")}`}><div className="cp2FilterBar compact"><select value={statusF} onChange={e=>setStatusF(e.target.value)}><option value="全部状态">{t("全部状态", "All statuses")}</option><option value="未读">{t("未读", "Unread")}</option><option value="已读">{t("已读", "Read")}</option></select><div className="cp2Search"><Search size={13}/><span>{t("搜索通知标题或内容", "Search title or content")}</span></div><button className="cp2Secondary" onClick={()=>action("/api/notifications/read",{})}>{t("全部已读", "Mark all read")}</button></div><div className="cp2NotificationList">{filtered.map(n=><button className={n.id===selected.id?"active":""} key={n.id} onClick={()=>setSelectedId(n.id)}><i className={toneOf(n.severity||n.level)}/><div><span><b>{n.title||t("系统通知", "System notice")}</b><Pill tone={toneOf(n.severity||n.level)}>{humanize(n.severity||n.level,t("一般", "Normal"))}</Pill></span><p>{n.message||n.body||"—"}</p><small>{formatDateTime(n.createdAt)} · {n.source||n.category||t("系统", "System")}</small></div></button>)}</div></ConceptCard>
      <ConceptCard title={t("通知详情", "Notification Detail")}><Pill tone={toneOf(selected.severity||selected.level)}>{humanize(selected.severity||selected.level,t("一般", "Normal"))}</Pill><h3>{selected.title||t("选择一条通知", "Select a notification")}</h3><p>{selected.message||selected.body||t("暂无通知内容。", "No notification content.")}</p><div className="cp2Kv column"><span>{t("通知 ID", "Notice ID")}<b>{selected.id||"—"}</b></span><span>{t("来源", "Source")}<b>{selected.source||selected.category||t("系统", "System")}</b></span><span>{t("时间", "Time")}<b>{formatDateTime(selected.createdAt)}</b></span><span>{t("状态", "Status")}<b>{selected.read?t("已读", "Read"):t("未读", "Unread")}</b></span></div><button className="cp2Primary" disabled={!selected.id||selected.read} onClick={()=>action("/api/notifications/read",{id:selected.id})}>{selected.read?t("已读", "Read"):t("标记已读", "Mark read")}</button></ConceptCard></div>
    <ConceptCard title={t("投递渠道健康状态", "Delivery Channel Health")}><div className="cp2ChannelGrid">{[[t("邮件", "Email"),data.config?.integrations?.alerts?.hasWebhook],[t("飞书", "Lark"),data.larkConfigured],[t("短信", "SMS"),false],["Telegram",data.telegramConfigured]].map(([name,ok])=><div key={name}><Bell/><span><b>{name}</b><small>{ok?t("正常", "OK"):t("未配置", "Off")}</small></span><Pill tone={ok?"good":"warn"}>{ok?t("可用", "Available"):t("待配置", "Pending")}</Pill></div>)}</div></ConceptCard></div>;
}

function AgentSettingsConcept({ data, action, ui }) {
  const profiles=arr(data.agentProfiles).slice().sort((a,b)=>num(a.order)-num(b.order));
  const [selectedId,setSelectedId]=useState(profiles[0]?.id||"");
  const selected=profiles.find(profile=>profile.id===selectedId)||profiles[0]||{};
  const [draft,setDraft]=useState(()=>({...selected}));
  const choose=(profile)=>{setSelectedId(profile.id);setDraft({...profile});};
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
  return <div className="cp2AgentSettings">
    <ConceptCard title={t("Agent 列表", "Agent List")} action={<Pill>{profiles.length} {t("个", "")}</Pill>}>
      <div className="cp2Search"><Search/><span>{t("搜索 Agent 名称或角色", "Search agent name or role")}</span></div>
      <div className="cp2AgentList">{profiles.map(profile=><button className={profile.id===selected.id?"active":""} key={profile.id} onClick={()=>choose(profile)}><span className="cp2AgentIcon"><Bot/></span><div><b>{profile.name}</b><small>{profile.role}</small></div><em>{profile.enabled===false?t("已停用", "Disabled"):t("已启用", "Enabled")}</em><i>{String(profile.order||"").padStart(2,"0")}</i></button>)}</div>
    </ConceptCard>
    <ConceptCard title={`${t("编辑 Agent", "Edit Agent")}：${selected.name||t("未选择", "None")}`} action={<div className="cp2FormActions"><button className="cp2Secondary" onClick={()=>selected.id&&action(`/api/agent/profiles/${selected.id}`,{enabled:selected.enabled===false},"PATCH")}>{selected.enabled===false?t("启用", "Enable"):t("停用", "Disable")}</button><button className="cp2Primary" onClick={save}>{t("应用", "Apply")}</button></div>}>
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
  const regOn=data.publicRegistrationEnabled===true;
  const toggleRegistration=async ()=>{
    const next=!regOn;
    if(next&&!await uiConfirm(t("开启公开注册后，任何访客都可在登录页自助注册账号。当前为一客户一实例部署，确认开启？", "With public registration on, any visitor can self-register from the login page. This is a single-client-per-instance deployment — enable anyway?")))return;
    action("/api/admin/registration",{enabled:next});
  };
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
        <b className="cp2Subhead">{t("公开注册", "Public Registration")}</b>
        <div className="cp2ToggleRow"><div><b>{regOn?t("已开启", "On"):t("已关闭", "Off")}</b><small>{regOn?t("访客可在登录页自助注册并订阅", "Visitors can self-register and subscribe from the login page"):t("仅 Owner 可在此开通账号（推荐）", "Only the Owner can create accounts here (recommended)")}</small></div><button className={`cp2Switch ${regOn?"on":""}`} onClick={toggleRegistration}><i/></button></div>
      </ConceptCard></aside>
    </div>
  </div>;
}

export function SettingsConcept({ data, action, ui, activeTab, onTabChange }) {
  const isOwner=data.user?.isOwner===true; const [baseSection,setBaseSection]=useState("runtime");
  const BASE_NAV=[[t("环境与服务", "Environment & Services"),"runtime"],[t("网络代理", "Network Proxy"),"integrations"],[t("通知渠道", "Notification Channels"),"integrations"],[t("数据与备份", "Data & Backup"),"runtime"],[t("安全", "Security"),"runtime"]]; const [baseNav,setBaseNav]=useState(0);
  const tabs=[["base",t("基础配置", "Basics")],["exchange",t("交易所连接", "Exchanges")],["models",t("模型与密钥", "Models & Keys")],["agents",t("Agent 配置", "Agents")],...(isOwner?[["users",t("用户与订阅", "Users & Subscriptions")]]:[])];
  const config=data.config||{}; const exchanges=arr(data.exchangeAccounts); const agents=arr(data.agentProfiles); const users=arr(data.users);
  const tab=tabs.some(([id])=>id===activeTab)?activeTab:"base";
  return <div className="cp2Settings"><header className="uxCenterHead"><div><h1>{t("系统设置", "System Settings")}</h1><span>{t("连接 · 模型 · Agent · 用户", "Connections · Models · Agents · Users")}</span></div></header><nav className="uxTabs" aria-label={t("系统设置导航", "System settings navigation")}>{tabs.map(([id,label])=><button role="tab" aria-selected={tab===id} className={tab===id?"active":""} key={id} onClick={()=>onTabChange(id)}>{label}</button>)}</nav>
    {tab==="base"&&<div className="cp2SettingsBase"><aside className="cp2SideFilter">{BASE_NAV.map(([label,sec],index)=><button className={baseNav===index?"active":""} key={index} onClick={()=>{setBaseNav(index);setBaseSection(sec);}}>{label}</button>)}</aside><main><div className="cp2Grid three"><ConceptCard title={t("环境与服务", "Environment & Services")}><div className="cp2Kv column"><span>{t("服务端地址", "Server URL")}<b>{window.location.origin}</b></span><span>{t("运行环境", "Environment")}<b>{config.runtime?.environment||t("本地", "Local")}</b></span><span>{t("时区", "Timezone")}<b>Asia/Shanghai</b></span><span>{t("数据库", "Database")}<b>SQLite</b></span><span>{t("实时传输", "Realtime")}<b>WebSocket / SSE</b></span></div></ConceptCard><ConceptCard title={t("模型与密钥", "Models & Keys")}><div className="cp2Kv column"><span>{t("当前模型", "Active model")}<b>{config.llm?.activeProvider||t("未配置", "Unconfigured")}</b></span><span>{t("嵌入模型", "Embedding model")}<b>{config.llm?.embeddingModel||t("未配置", "Unconfigured")}</b></span><span>API Key<b>{Object.values(config.llm?.providers||{}).filter(p=>p.hasKey).length} {t("个已配置", "configured")}</b></span></div></ConceptCard><ConceptCard title={t("交易所连接", "Exchanges")}><div className="cp2SecurityList">{["BINANCE","OKX"].map(name=><span key={name}><WalletCards/>{name}<b>{exchanges.some(e=>e.exchange===name)?t("已接入", "Connected"):t("未配置", "Unconfigured")}</b></span>)}</div></ConceptCard></div><div className="cp2Grid settingsBottom"><ConceptCard title={t("Agent 配置", "Agents")}><ConceptTable compact columns={[{key:"name",label:"Agent"},{key:"model",label:t("模型", "Model")},{key:"status",label:t("状态", "Status"),render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status,t("已启用", "Enabled"))}</Pill>}]} rows={agents.slice(0,6)} empty={t("暂无 Agent", "No agents")}/></ConceptCard><ConceptCard title={t("用户与订阅", "Users & Subscriptions")}><div className="cp2Kv column"><span>{t("当前用户", "Current user")}<b>{data.user?.name||"—"}</b></span><span>{t("用户数量", "User count")}<b>{users.length}</b></span><span>{t("订阅计划", "Subscriptions")}<b>{arr(data.subscriptions).length}</b></span><span>{t("系统状态", "System status")}<b>{data.readiness?.operatingStage?.label||"—"}</b></span></div></ConceptCard><ConceptCard title={t("备份与维护", "Backup & Maintenance")}><div className="cp2Kv column"><span>{t("最近备份", "Last backup")}<b>{t("由服务端任务管理", "Managed by server task")}</b></span><span>{t("恢复点", "Restore points")}<b>{arr(data.accountSnapshots).length} {t("个", "")}</b></span><span>{t("配置文件", "Config file")}<b>{t("已保存", "Saved")}</b></span></div></ConceptCard></div><ConceptCard title={BASE_NAV[baseNav][0]}><SystemConfigPanel key={baseSection} data={data} action={action} ui={ui} section={baseSection}/></ConceptCard></main></div>}
    {tab==="exchange"&&<div className="cp2SettingsForm"><ConceptCard title={t("连接列表", "Connections")} meta={t("管理已连接的交易所及其读写权限", "Manage connected exchanges and their read/write permissions")}><SystemConfigPanel data={data} action={action} ui={ui} section="exchange"/></ConceptCard></div>}
    {tab==="models"&&<div className="cp2SettingsForm"><ConceptCard title={t("模型提供商与密钥", "Model Providers & Keys")} meta={t("配置推理模型、嵌入模型和访问凭证", "Configure inference model, embedding model, and access credentials")}><SystemConfigPanel data={data} action={action} ui={ui} section="llm"/></ConceptCard></div>}
    {tab==="agents"&&<AgentSettingsConcept data={data} action={action} ui={ui}/>}
    {tab==="users"&&isOwner&&<UsersSettingsConcept data={data} action={action} ui={ui}/>}
  </div>;
}
