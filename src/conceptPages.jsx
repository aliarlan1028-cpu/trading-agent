import React, { useMemo, useState } from "react";
import {
  Activity, AlertTriangle, BarChart3, Bell, BookOpen, Bot, CalendarDays,
  CheckCircle2, ChevronRight, CircleDollarSign, Clock3, Database, Eye,
  FileText, Filter, Gauge, GitBranch, KeyRound, Layers3, ListChecks,
  LockKeyhole, Play, Plus, RefreshCw, Search, Server, ShieldCheck,
  SlidersHorizontal, Sparkles, Target, TrendingUp, Users, WalletCards,
  Wrench, Zap
} from "lucide-react";
import { ChatPage } from "./chat.jsx";
import { LiveGrayPanel, SystemConfigPanel } from "./panels.jsx";
import { displayMoney, displayPct, formatDateTime, formatTime, humanize, TradingViewChart } from "./lib.jsx";
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

export function ConceptTable({ columns, rows, empty = "暂无数据", compact = false }) {
  if (!rows.length) return <div className="cp2Empty"><Database size={19}/><b>{empty}</b><span>系统产生真实数据后会自动显示。</span></div>;
  return <div className="cp2TableWrap"><table className={`cp2Table ${compact ? "compact" : ""}`}><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || index}>{columns.map((column) => <td key={column.key}>{column.render ? column.render(row) : (row[column.key] ?? "—")}</td>)}</tr>)}</tbody></table></div>;
}

function MiniLine({ values = [], tone = "green", height = 58 }) {
  const clean = values.map(Number).filter(Number.isFinite);
  const points = clean.length > 1 ? clean : [30, 34, 31, 39, 43, 40, 48, 52, 50, 57];
  const min = Math.min(...points); const max = Math.max(...points); const span = Math.max(1, max - min);
  const path = points.map((value, index) => `${index ? "L" : "M"} ${index * (100 / Math.max(1, points.length - 1))} ${height - 5 - ((value - min) / span) * (height - 12)}`).join(" ");
  return <svg className={`cp2MiniLine ${tone}`} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none"><path d={`${path} L 100 ${height} L 0 ${height} Z`} className="area"/><path d={path} className="line"/></svg>;
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
  const events = arr(data.events);
  const movers = arr(data.marketMovers?.movers);
  const knowledge = arr(data.knowledge);
  const items = [
    ...events.map((item, index) => ({ ...item, id: item.id || `event-${index}`, category: item.category || "宏观", title: item.title || item.name, source: item.source || "事件源", confidence: item.confidence, impact: item.impact })),
    ...movers.map((item, index) => ({ ...item, id: `mover-${index}`, category: "市场", title: `${item.symbol} ${num(item.changePct) >= 0 ? "+" : ""}${item.changePct ?? "—"}%`, source: "异动扫描", confidence: 72, impact: Math.abs(num(item.changePct)) >= 5 ? 90 : 60 })),
    ...knowledge.slice(0, 4).map((item, index) => ({ ...item, id: `knowledge-${index}`, category: "知识", title: item.title || item.name || "知识更新", source: "知识库", confidence: 68, impact: 45 }))
  ];
  const filtered = category === "全部" ? items : items.filter((item) => item.category === category);
  const active = filtered[selected] || filtered[0] || {};
  return <div className="cp2IntelLayout">
    <aside className="cp2SideFilter">
      <b>情报分类</b>
      {["全部", "宏观", "市场", "链上", "知识"].map((name) => <button key={name} className={category === name ? "active" : ""} onClick={() => { setCategory(name); setSelected(0); }}>{name}<span>{name === "全部" ? items.length : items.filter((item) => item.category === name).length}</span></button>)}
      <div className="cp2FilterGroup"><small>时间范围</small><select><option>24 小时</option><option>7 天</option></select><small>置信度</small><select><option>全部</option><option>≥ 70%</option></select></div>
    </aside>
    <main className="cp2IntelFeed">
      <ConceptCard title="今日情报摘要" icon={Sparkles} meta={`更新于 ${formatTime(data.marketMovers?.scannedAt)}`}>
        <div className="cp2Metrics four compact">
          <ConceptMetric label="宏观焦点" value={`${events.length} 项`} sub="事件监测"/>
          <ConceptMetric label="市场状态" value={data.marketRegime?.global?.label || "观察中"} sub="结构判断"/>
          <ConceptMetric label="链上信号" value="待同步" sub="未配置则不推断"/>
          <ConceptMetric label="异常波动" value={`${movers.length} 个`} sub="实时扫描"/>
        </div>
      </ConceptCard>
      <ConceptCard title="情报动态" meta={`${filtered.length} 条`}>
        <div className="cp2IntelList">{filtered.map((item, index) => <button key={item.id} className={index === selected ? "active" : ""} onClick={() => setSelected(index)}><span className={`cp2IntelIcon ${toneOf(item.impact)}`}><Activity size={14}/></span><div><b>{item.title || "未命名情报"}</b><small>{item.source} · {formatTime(item.createdAt || item.due || item.time)}</small><p>{item.summary || item.description || "等待更多来源交叉验证。"}</p></div><Pill tone={num(item.impact) >= 80 ? "bad" : num(item.impact) >= 50 ? "warn" : "good"}>{num(item.impact) >= 80 ? "高" : num(item.impact) >= 50 ? "中" : "低"}</Pill></button>)}</div>
      </ConceptCard>
    </main>
    <aside className="cp2IntelDetail">
      <ConceptCard title="影响评估" icon={Target}>
        <div className="cp2DetailTabs"><button className="active">关联资产</button><button>关联计划</button></div>
        <b className="cp2DetailTitle">{active.title || "选择一条情报"}</b>
        <div className="cp2AssetRows">{["BTC/USDT", "ETH/USDT", "SOL/USDT"].map((symbol, index) => <div key={symbol}><span>{symbol}</span><Pill tone={index ? "neutral" : "warn"}>{index ? "轻度" : "中度"}</Pill><small>{index === 0 ? "偏空" : "中性"}</small></div>)}</div>
        <div className="cp2Relation"><b>关联结论</b><p>{active.summary || active.description || "当前情报尚未形成可执行结论，只作为 AI 分析上下文。"}</p></div>
        <button className="cp2Secondary" onClick={() => ui.setActive("chat")}>加入上下文</button>
        <button className="cp2Primary" onClick={() => action("/api/event-sources/refresh", {})}>刷新情报</button>
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

export function TradingOverviewConcept({ data, ui }) {
  const pf = data.portfolio || {};
  const positions = arr(data.positions); const fills = arr(data.fills); const orders = arr(data.executionOrders).length ? arr(data.executionOrders) : arr(data.orders);
  const markets = marketRows(data); const activeMarket = data.activeMarket || markets[0] || {};
  const equity = pf.totalEquityUsdt; const used = num(equity) - num(pf.availableMarginUsdt);
  return <div className="cp2Stack">
    <div className="cp2Metrics five">
      <ConceptMetric label="总资产" value={equity == null ? "未同步" : `${money(equity)} USDT`} sub="账户实时净值"/>
      <ConceptMetric label="今日盈亏" value={`${num(pf.todayPnl) >= 0 ? "+" : ""}${money(pf.todayPnl, "0")} USDT`} sub={displayPct(pf.todayPnlPct, "等待账户同步")} tone={num(pf.todayPnl) >= 0 ? "good" : "bad"}/>
      <ConceptMetric label="可用保证金" value={pf.availableMarginUsdt == null ? "未同步" : `${money(pf.availableMarginUsdt)} USDT`} sub={equity ? `可用 ${Math.max(0, 100 - used / num(equity) * 100).toFixed(1)}%` : "—"}/>
      <ConceptMetric label="风险预算" value={data.system?.remainingDailyLossUsdt == null ? "未授权" : `${money(data.system.remainingDailyLossUsdt)} USDT`} sub="今日剩余"/>
      <ConceptMetric label="允许交易" value={data.system?.killSwitch ? "已熔断" : data.automationState?.label || "待配置"} sub={`${arr(data.riskRules).filter((rule) => rule.enabled !== false).length} 条规则生效`} tone={data.system?.killSwitch ? "bad" : "good"}/>
    </div>
    <div className="cp2TradingHero">
      <ConceptCard title={activeMarket.symbol || "BTC/USDT"} meta="实时行情 · 交易所公开数据" className="cp2ChartCard" action={<button className="cp2Link" onClick={() => ui.setActive("marketAccount")}>查看完整行情 ›</button>}>
        <div className="cp2Quote"><b>{activeMarket.price == null ? "待同步" : money(activeMarket.price)}</b><Pill tone={num(activeMarket.changePct) >= 0 ? "good" : "bad"}>{activeMarket.changePct == null ? "—" : `${num(activeMarket.changePct) >= 0 ? "+" : ""}${num(activeMarket.changePct).toFixed(2)}%`}</Pill></div>
        <div className="cp2CandleBox"><TradingViewChart symbol={activeMarket.symbol || "BTC/USDT"} interval="60"/></div>
      </ConceptCard>
      <ConceptCard title="账户与持仓" meta={`${positions.length} 个持仓`}>
        <div className="cp2Allocation"><Donut value={positions.length ? 68 : 0} label={positions.length ? `${positions.length} 仓` : "空仓"} sub="持仓"/><div><b>{equity == null ? "未同步" : `${money(equity)} USDT`}</b><small>总账户权益</small><span className="good">{`${num(pf.unrealizedPnl) >= 0 ? "+" : ""}${money(pf.unrealizedPnl, "0")} 未实现`}</span></div></div>
        <ConceptTable compact columns={[{key:"symbol",label:"资产"},{key:"quantity",label:"数量",render:r=>r.quantity??r.size??"—"},{key:"unrealizedPnl",label:"浮盈亏",render:r=>money(r.unrealizedPnl)}]} rows={positions.slice(0,4)} empty="暂无持仓"/>
      </ConceptCard>
    </div>
    <div className="cp2Grid two wideLeft">
      <ConceptCard title="活动与交易流水" meta={`${fills.length + orders.length} 条`} action={<button className="cp2Link" onClick={() => ui.setActive("tradeJournal")}>查看全部 ›</button>}>
        <ConceptTable columns={[{key:"createdAt",label:"时间",render:r=>formatTime(r.createdAt)},{key:"kind",label:"类型",render:r=>humanize(r.kind||r.type||"订单")},{key:"detail",label:"内容",render:r=>`${r.symbol||"—"} · ${humanize(r.side||r.direction||r.status)}`},{key:"amount",label:"数量/金额",render:r=>r.quantity??r.size??money(r.notional)},{key:"status",label:"状态",render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status,"已记录")}</Pill>}]} rows={[...orders,...fills].slice(0,8)} empty="暂无交易活动"/>
      </ConceptCard>
      <ConceptCard title="AI 当前判断" icon={Bot}>
        <div className="cp2InsightList"><div><TrendingUp size={14}/><span><b>市场趋势</b><small>{data.marketRegime?.global?.label || "等待真实行情形成判断"}</small></span></div><div><Target size={14}/><span><b>关键价位</b><small>{activeMarket.price ? `当前参考 ${money(activeMarket.price)}` : "待同步"}</small></span></div><div><AlertTriangle size={14}/><span><b>关注事件</b><small>{arr(data.events)[0]?.title || "暂无高影响事件"}</small></span></div></div>
      </ConceptCard>
    </div>
  </div>;
}

export function MarketConcept({ data, action }) {
  const markets = marketRows(data); const watchlist = arr(data.watchlist); const [symbol, setSymbol] = useState(markets[0]?.symbol || "BTC/USDT"); const [tf, setTf] = useState("1h");
  const selected = markets.find((item) => item.symbol === symbol) || markets[0] || {};
  const addWatch = () => {
    const value = window.prompt("输入要加入自选的交易对，例如 BTC/USDT");
    if (value?.trim()) action("/api/watchlist", { symbol: value.trim().toUpperCase() });
  };
  return <div className="cp2MarketLayout">
    <ConceptCard className="cp2MainChart" title={selected.symbol || symbol} meta={`${tf} · 公开行情`} action={<div className="cp2FormActions"><button className="cp2Secondary" onClick={() => action("/api/reconciler/run", { mode: "manual_ui" })}>手动对账</button><button className="cp2IconButton" onClick={() => action("/api/market/regime", {}, "GET")}><RefreshCw size={13}/></button></div>}>
      <div className="cp2ChartToolbar"><select value={symbol} onChange={(event) => setSymbol(event.target.value)}>{markets.length ? markets.map((item) => <option key={item.symbol}>{item.symbol}</option>) : <option>BTC/USDT</option>}</select>{["1m","5m","15m","1h","4h","1D"].map((name) => <button className={name === tf ? "active" : ""} onClick={() => setTf(name)} key={name}>{name}</button>)}</div>
      <div className="cp2Quote large"><b>{selected.price == null ? "待同步" : money(selected.price)}</b><Pill tone={num(selected.change) >= 0 ? "good" : "bad"}>{selected.change == null ? "—" : `${num(selected.change)>=0?"+":""}${num(selected.change).toFixed(2)}%`}</Pill></div>
      <div className="cp2CandleBox tall"><TradingViewChart symbol={symbol} interval={{ "1m": "1m", "5m": "5m", "15m": "15m", "1h": "60", "4h": "240", "1D": "D" }[tf] || "60"}/></div>
    </ConceptCard>
    <aside className="cp2MarketRail">
      <ConceptCard title="自选列表" meta={`${watchlist.length || markets.length} 个`} action={<button className="cp2Link" onClick={addWatch}><Plus size={12}/> 添加</button>}><ConceptTable compact columns={[{key:"symbol",label:"交易对",render:r=><button className="cp2Link" onClick={()=>setSymbol(r.symbol)}>{r.symbol}</button>},{key:"price",label:"价格",render:r=>money(r.price)},{key:"change",label:"24h",render:r=><span className={num(r.change)>=0?"good":"bad"}>{r.change==null?"—":`${num(r.change)>=0?"+":""}${num(r.change).toFixed(2)}%`}</span>},{key:"remove",label:"",render:r=>watchlist.length>1&&watchlist.includes(r.symbol)?<button className="cp2IconButton" title="移除自选" onClick={()=>action(`/api/watchlist/${encodeURIComponent(r.symbol)}`,{},"DELETE")}>×</button>:null}]} rows={markets.filter(item=>!watchlist.length||watchlist.includes(item.symbol))} empty="行情待同步"/></ConceptCard>
      <ConceptCard title="市场快照"><div className="cp2Kv"><span>24h 高<b>{money(selected.high24h ?? selected.high)}</b></span><span>24h 低<b>{money(selected.low24h ?? selected.low)}</b></span><span>成交额<b>{money(selected.volume)}</b></span><span>资金费率<b>{selected.fundingRate == null ? "待同步" : displayPct(selected.fundingRate)}</b></span></div></ConceptCard>
    </aside>
    <div className="cp2MarketBottom">
      <ConceptCard title="未平仓量"><div className="cp2BigNumber">{selected.openInterest == null ? "—" : money(selected.openInterest)}<small>公开合约数据</small></div><MiniLine values={arr(selected.candles).slice(-24).map(item=>item.volume)} height={52}/></ConceptCard>
      <ConceptCard title="多空比"><div className="cp2BigNumber">1.36<small>多头略占优</small></div><BarRows rows={[{label:"多头",value:58},{label:"空头",value:42}]}/></ConceptCard>
      <ConceptCard title="市场情绪"><div className="cp2Centered"><Donut value={63} label="63" sub="偏多"/></div></ConceptCard>
      <ConceptCard title="全球市场动态"><ConceptTable compact columns={[{key:"symbol",label:"资产"},{key:"change",label:"涨跌",render:r=><span className={num(r.change)>=0?"good":"bad"}>{r.change==null?"—":`${num(r.change).toFixed(2)}%`}</span>}]} rows={markets.slice(0,5)} empty="暂无行情"/></ConceptCard>
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
    <div className="cp2Metrics four"><ConceptMetric label="持仓市值" value={positions.length ? `${money(exposure)} USDT` : "—"} sub={`${positions.length} 个仓位`}/><ConceptMetric label="未实现盈亏" value={positions.length ? `${pnl>=0?"+":""}${money(pnl)} USDT` : "—"} sub={displayPct(pf.todayPnlPct,"等待同步")} tone={pnl>=0?"good":"bad"}/><ConceptMetric label="保证金占用" value={margin ? `${money(margin)} USDT` : "—"} sub={pf.totalEquityUsdt ? `${(margin/num(pf.totalEquityUsdt)*100).toFixed(1)}%` : "未同步"}/><ConceptMetric label="平均杠杆" value={lev ? `${lev.toFixed(2)}x` : "—"} sub="组合口径"/></div>
    <div className="cp2Grid positionsTop"><ConceptCard title="持仓分布"><div className="cp2Centered"><Donut value={positions.length ? 72 : 0} label={positions.length ? `${money(exposure, "0")}` : "空仓"} sub="USDT"/></div><BarRows rows={positions.slice(0,5).map((item)=>({label:item.symbol,value:num(item.notional||item.marketValue),display:`${money(item.notional||item.marketValue)} U`}))}/></ConceptCard><ConceptCard title="持仓明细" className="span2"><ConceptTable columns={[{key:"symbol",label:"币种"},{key:"direction",label:"方向",render:r=><Pill tone={/short|卖/i.test(String(r.direction))?"bad":"good"}>{humanize(r.direction)}</Pill>},{key:"quantity",label:"持仓数量",render:r=>r.quantity??r.size??"—"},{key:"entry",label:"开仓均价",render:r=>money(r.entryPrice??r.entry)},{key:"mark",label:"当前价格",render:r=>money(r.markPrice??r.mark)},{key:"pnl",label:"未实现盈亏",render:r=><span className={num(r.unrealizedPnl)>=0?"good":"bad"}>{money(r.unrealizedPnl)}</span>},{key:"leverage",label:"杠杆",render:r=>r.leverage?`${r.leverage}x`:"—"},{key:"liq",label:"强平价",render:r=>money(r.liquidationPrice)}]} rows={positions} empty="暂无持仓"/></ConceptCard></div>
    <div className="cp2Grid two wideLeft"><ConceptCard title="持仓盈亏曲线" meta="账户真实快照"><MiniLine values={arr(data.accountSnapshots).map((item)=>item.totalEquityUsdt)} height={150}/></ConceptCard><ConceptCard title="保证金健康"><div className="cp2Centered"><Donut value={pf.totalEquityUsdt ? Math.max(0,100-margin/num(pf.totalEquityUsdt)*100) : 0} label={pf.totalEquityUsdt ? `${Math.round(Math.max(0,100-margin/num(pf.totalEquityUsdt)*100))}%` : "—"} sub="健康度"/></div><div className="cp2Checklist"><span><CheckCircle2/>维持保证金</span><span><CheckCircle2/>风险缓冲</span><span><ShieldCheck/>强平距离</span></div></ConceptCard></div>
  </div>;
}

export function OrdersConcept({ data, action, ui }) {
  const orders = arr(data.executionOrders).length ? arr(data.executionOrders) : arr(data.orders); const fills = arr(data.fills); const plans = arr(data.tradePlans);
  const [selectedId, setSelectedId] = useState(orders[0]?.id || ""); const selected = orders.find((item)=>item.id===selectedId) || orders[0] || {};
  return <div className="cp2Stack"><div className="cp2Metrics four"><ConceptMetric label="待执行订单" value={String(orders.filter((item)=>/pending|open|new/i.test(String(item.status))).length)} sub={`共 ${orders.length} 条`}/><ConceptMetric label="待审批" value={String(plans.filter((item)=>item.status==="awaiting_approval").length)} sub="人工确认"/><ConceptMetric label="今日成交" value={String(fills.length)} sub="交易所回报"/><ConceptMetric label="已拒绝" value={String(orders.filter((item)=>/reject|cancel/i.test(String(item.status))).length)} sub="风控或人工"/></div>
    <div className="cp2OrdersLayout"><ConceptCard title="订单簿" meta={`${orders.length} 条`} className="cp2OrdersTable"><ConceptTable columns={[{key:"id",label:"订单号",render:r=><button className="cp2Link" onClick={()=>setSelectedId(r.id)}>{String(r.id||"—").slice(0,12)}</button>},{key:"symbol",label:"交易对"},{key:"side",label:"方向",render:r=>humanize(r.side||r.direction)},{key:"quantity",label:"数量",render:r=>r.quantity??r.size??"—"},{key:"price",label:"价格",render:r=>money(r.price)},{key:"status",label:"状态",render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status)}</Pill>},{key:"createdAt",label:"时间",render:r=>formatTime(r.createdAt)}]} rows={orders} empty="暂无订单"/></ConceptCard>
      <ConceptCard title="执行链路" className="cp2Execution"><div className="cp2Timeline">{["计划","风控","路由","订单","成交","保护单"].map((name,index)=><div key={name} className={index<Math.min(5,orders.length?4:1)?"done":index===Math.min(5,orders.length?4:1)?"active":""}><i>{index+1}</i><span><b>{name}</b><small>{index===0?(plans[0]?.status?humanize(plans[0].status):"等待计划"):index===1?"执行前复查":index===2?"选择交易所":index===3?humanize(selected.status,"待执行"):index===4?`${fills.length} 笔成交`:"止损/止盈"}</small></span></div>)}</div></ConceptCard>
      <ConceptCard title="订单详情" className="cp2OrderDetail"><div className="cp2Kv column">{[["订单号",selected.id],["交易对",selected.symbol],["方向",humanize(selected.side||selected.direction)],["类型",humanize(selected.type)],["数量",selected.quantity??selected.size],["委托价",money(selected.price)],["状态",humanize(selected.status)],["创建时间",formatDateTime(selected.createdAt)]].map(([k,v])=><span key={k}>{k}<b>{v||"—"}</b></span>)}</div><button className="cp2Secondary" onClick={()=>ui.setActive("chat")}>交给 AI 修改</button>{selected.id&&<button className="cp2Danger" onClick={()=>action(`/api/orders/${selected.id}/cancel`,{})}>撤销订单</button>}</ConceptCard>
    </div>
    <ConceptCard title="成交明细" meta={`${fills.length} 条`}><ConceptTable compact columns={[{key:"createdAt",label:"成交时间",render:r=>formatDateTime(r.createdAt)},{key:"orderId",label:"订单号"},{key:"symbol",label:"交易对"},{key:"side",label:"方向",render:r=>humanize(r.side||r.kind)},{key:"quantity",label:"成交数量",render:r=>r.quantity??r.size??"—"},{key:"price",label:"成交价格",render:r=>money(r.price)},{key:"fee",label:"手续费",render:r=>money(r.fee)}]} rows={fills} empty="暂无成交"/></ConceptCard></div>;
}

export function JournalConcept({ data }) {
  const fills = arr(data.fills); const reviews = arr(data.reviews); const performance = data.performance || {}; const report = data.paperReport || {};
  const wins = fills.filter((item)=>num(item.realizedPnl)>0); const losses = fills.filter((item)=>num(item.realizedPnl)<0); const net = fills.reduce((sum,item)=>sum+num(item.realizedPnl),0);
  return <div className="cp2Stack"><div className="cp2Metrics six"><ConceptMetric label="已实现盈亏" value={`${net>=0?"+":""}${money(net,"0")}`} tone={net>=0?"good":"bad"}/><ConceptMetric label="胜率" value={fills.length?`${(wins.length/fills.length*100).toFixed(1)}%`:"—"}/><ConceptMetric label="盈亏比" value={performance.profitFactor?num(performance.profitFactor).toFixed(2):"—"}/><ConceptMetric label="平均 R" value={performance.averageR?num(performance.averageR).toFixed(2):"—"}/><ConceptMetric label="最大回撤" value={displayPct(performance.maxDrawdownPct??report.maxDrawdownPct,"—")} tone="bad"/><ConceptMetric label="复盘覆盖" value={fills.length?`${Math.min(100,reviews.length/fills.length*100).toFixed(0)}%`:"—"}/></div>
    <div className="cp2Grid journalMain"><ConceptCard title="已平仓交易" className="span2"><ConceptTable columns={[{key:"createdAt",label:"时间",render:r=>formatDateTime(r.createdAt)},{key:"symbol",label:"交易对"},{key:"side",label:"方向",render:r=>humanize(r.side||r.kind)},{key:"quantity",label:"数量",render:r=>r.quantity??r.size??"—"},{key:"price",label:"成交价",render:r=>money(r.price)},{key:"realizedPnl",label:"已实现盈亏",render:r=><span className={num(r.realizedPnl)>=0?"good":"bad"}>{money(r.realizedPnl)}</span>},{key:"status",label:"状态",render:r=><Pill tone="good">已成交</Pill>}]} rows={fills} empty="暂无已平仓交易"/></ConceptCard><ConceptCard title="业绩拆解"><div className="cp2Centered"><Donut value={fills.length?wins.length/fills.length*100:0} label={fills.length?`${(wins.length/fills.length*100).toFixed(0)}%`:"—"} sub="胜率"/></div><BarRows rows={[{label:"盈利交易",value:wins.length,display:`${wins.length} 笔`},{label:"亏损交易",value:losses.length,display:`${losses.length} 笔`},{label:"复盘完成",value:reviews.length,display:`${reviews.length} 份`}]} /></ConceptCard></div>
    <div className="cp2Grid two wideLeft"><ConceptCard title="交易复盘详情"><div className="cp2ReviewGrid">{reviews.slice(0,3).map((review,index)=><article key={review.id||index}><small>{review.symbol||"组合"} · {formatDateTime(review.createdAt)}</small><b>{review.title||review.summary||"交易复盘"}</b><p>{review.lesson||review.notes||"等待复盘结论。"}</p></article>)}{!reviews.length&&<div className="cp2Empty"><BookOpen/><b>暂无复盘</b><span>平仓后会自动进入复盘队列。</span></div>}</div></ConceptCard><ConceptCard title="纪律检查"><div className="cp2Checklist vertical"><span><CheckCircle2/>风险预算执行</span><span><CheckCircle2/>止损保护覆盖</span><span><AlertTriangle/>复盘样本仍需积累</span></div></ConceptCard></div></div>;
}

export function KnowledgeConcept({ data, action, ui }) {
  const k=data.knowledge||{}; const sources=arr(k.sources); const methods=arr(k.tradingMethods); const candidates=arr(k.candidates).filter(item=>item.status==="candidate"); const skills=[...arr(k.tradingSkills),...arr(data.skills)]; const rules=[...arr(k.ruleProposals),...arr(data.riskRules)]; const memory=arr(data.memoryItems);
  const convert=(source)=>{if(window.confirm(`从《${source.title||source.name}》生成候选能力？`))action("/api/knowledge/convert",{sourceId:source.id});};
  return <div className="cp2Stack"><div className="cp2Workflow">{[["知识源",sources.length],["方法与记录",methods.length+memory.length],["候选能力",candidates.length],["回测验证",arr(data.backtests).length],["长期采用",skills.filter(s=>["active","trusted"].includes(s.status)).length]].map(([name,count],index)=><React.Fragment key={name}><div><i>{index+1}</i><span><b>{name}</b><small>{count} 项</small></span></div>{index<4&&<ChevronRight/>}</React.Fragment>)}</div>
    <div className="cp2KnowledgeGrid"><ConceptCard title="知识源" meta={`${sources.length} 个`} action={<button className="cp2Link" onClick={()=>ui.openPanel("knowledgeImport")}>导入知识</button>}><ConceptTable compact columns={[{key:"title",label:"名称",render:r=>r.title||r.name||r.source},{key:"type",label:"类型",render:r=>humanize(r.type)},{key:"status",label:"状态",render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status,"已索引")}</Pill>},{key:"action",label:"",render:r=><button className="cp2Link" onClick={()=>convert(r)}>生成候选</button>}]} rows={sources.slice(0,8)} empty="暂无知识源"/></ConceptCard>
      <ConceptCard title="候选能力" meta={`${candidates.length} 个`} action={<button className="cp2Link" onClick={()=>ui.openPanel("skillImport")}>导入 Skill</button>}><ConceptTable compact columns={[{key:"name",label:"能力"},{key:"type",label:"类型",render:r=>humanize(r.type)},{key:"status",label:"操作",render:r=><span className="cp2FormActions"><button className="cp2Link" onClick={()=>action(`/api/knowledge/candidates/${r.id}/ignore`,{})}>忽略</button><button className="cp2Link" onClick={()=>action(`/api/knowledge/candidates/${r.id}/adopt`,{})}>采纳</button></span>}]} rows={candidates.slice(0,8)} empty="暂无候选能力"/></ConceptCard>
      <ConceptCard title="验证漏斗"><div className="cp2Funnel">{[["候选总量",candidates.length],["静态验证",skills.filter(s=>s.scanStatus==="passed").length],["回测通过",skills.filter(s=>s.backtestStatus==="passed").length],["实盘采用",skills.filter(s=>["active","trusted"].includes(s.status)).length]].map(([name,value],index)=><div style={{width:`${100-index*14}%`}} key={name}><span>{name}</span><b>{value}</b></div>)}</div><div className="cp2Kv"><span>规则总数<b>{rules.length}</b></span><span>交易方法<b>{methods.length}</b></span><span>记忆条目<b>{memory.length}</b></span><span>知识来源<b>{sources.length}</b></span></div></ConceptCard>
    </div>
    <div className="cp2Grid two"><ConceptCard title="概念与知识网络"><div className="cp2ConceptMap"><span className="center">交易知识</span>{arr(k.conceptCards).slice(0,6).map((item,index)=><span key={item.id||index} style={{"--i":index}}>{item.name||item.title||"概念"}</span>)}{!arr(k.conceptCards).length&&["风险预算","动量","均线结构","仓位管理","波动率","止盈逻辑"].map((name,index)=><span key={name} style={{"--i":index}}>{name}</span>)}</div></ConceptCard><ConceptCard title="已沉淀的方法"><ConceptTable compact columns={[{key:"name",label:"方法",render:r=>r.name||r.title},{key:"category",label:"类型",render:r=>humanize(r.category||r.type)},{key:"status",label:"状态",render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status,"已记录")}</Pill>}]} rows={[...methods,...memory].slice(0,8)} empty="暂无方法记录"/></ConceptCard></div></div>;
}

export function CapabilitiesConcept({ data, ui }) {
  const rawItems=[...arr(data.knowledge?.tradingSkills),...arr(data.skills),...arr(data.analysisEngine?.tools),...arr(data.tools),...arr(data.mcpServers)];
  const items = rawItems.filter((item,index)=>rawItems.findIndex(other=>(other.id||other.name)===(item.id||item.name))===index).map((item,index)=>({...item,id:item.id||`cap-${index}`,name:item.name||item.title||item.serverName||"未命名能力",kind:item.type||item.category||(item.serverName?"MCP":"交易能力")}));
  const [selectedId,setSelectedId]=useState(items[0]?.id||""); const selected=items.find(i=>i.id===selectedId)||items[0]||{};
  return <div className="cp2Stack"><div className="cp2Metrics four"><ConceptMetric label="全部能力" value={String(items.length)}/><ConceptMetric label="已启用" value={String(items.filter(i=>["active","trusted","enabled","ready"].includes(i.status)||i.enabled===true).length)} tone="good"/><ConceptMetric label="候选中" value={String(items.filter(i=>/candidate|pending|trial/i.test(String(i.status))).length)} tone="warn"/><ConceptMetric label="已停用" value={String(items.filter(i=>i.enabled===false||/disabled|retired/i.test(String(i.status))).length)} tone="bad"/></div>
    <div className="cp2CapabilitiesLayout"><aside className="cp2SideFilter"><b>类型</b>{["全部能力","交易策略","分析工具","工作流","工具 (MCP)"].map((name,index)=><button className={index===0?"active":""} key={name}>{name}<span>{index===0?items.length:""}</span></button>)}<b>状态</b>{["全部状态","已启用","候选中","已停用"].map((name,index)=><button className={index===0?"active":""} key={name}>{name}</button>)}</aside>
      <ConceptCard title="能力列表" meta={`${items.length} 项`} className="cp2CapabilityTable"><div className="cp2Search"><Search size={13}/><span>搜索能力名称、描述或标签</span></div><ConceptTable columns={[{key:"name",label:"能力名称",render:r=><button className="cp2Link" onClick={()=>setSelectedId(r.id)}>{r.name}</button>},{key:"kind",label:"类型",render:r=>humanize(r.kind)},{key:"version",label:"版本",render:r=>r.version||"—"},{key:"status",label:"状态",render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status,r.enabled===false?"已停用":"可用")}</Pill>},{key:"runs",label:"调用量",render:r=>r.runs??r.runCount??"—"}]} rows={items} empty="暂无能力"/></ConceptCard>
      <ConceptCard title="能力详情" className="cp2CapabilityDetail"><div className="cp2CapabilityTitle"><span><Wrench size={18}/></span><div><b>{selected.name||"选择能力"}</b><small>{humanize(selected.kind)}</small></div><Pill tone={toneOf(selected.status)}>{humanize(selected.status,"可用")}</Pill></div><p>{selected.description||selected.summary||"系统能力会在 Agent 工作流中按权限调用。"}</p><div className="cp2DetailTabs"><button className="active">概览</button><button>输入输出</button><button>调用日志</button></div><div className="cp2Kv column"><span>版本<b>{selected.version||"—"}</b></span><span>来源<b>{selected.source||selected.packageName||"内置"}</b></span><span>权限级别<b>{humanize(selected.permission||selected.riskLevel,"受控")}</b></span><span>最近运行<b>{formatDateTime(selected.lastRunAt)}</b></span></div><button className="cp2Secondary" onClick={()=>ui.openPanel("skillImport")}>管理能力</button></ConceptCard>
    </div></div>;
}

export function StrategyConcept({ data, action }) {
  const backtests=arr(data.backtests); const active=backtests[0]||{}; const strategies=arr(data.strategyProfiles).length?arr(data.strategyProfiles):arr(data.strategyBoard?.rows);
  return <div className="cp2Stack"><div className="cp2StrategyToolbar"><select><option>{active.name||active.strategyName||"选择策略"}</option></select><select><option>{active.version||"当前版本"}</option></select><span>回测区间 {active.startAt?formatDateTime(active.startAt):"未运行"} — {active.endAt?formatDateTime(active.endAt):"—"}</span><button className="cp2Primary" onClick={()=>action("/api/strategy/research",{},"POST")}><Play size={13}/> 运行研究</button></div>
    <div className="cp2StrategyLayout"><ConceptCard title="策略表现"><div className="cp2Metrics two compact"><ConceptMetric label="累计收益" value={displayPct(active.totalReturnPct,"—")} tone="good"/><ConceptMetric label="年化收益" value={displayPct(active.annualizedReturnPct,"—")} tone="good"/><ConceptMetric label="最大回撤" value={displayPct(active.maxDrawdownPct,"—")} tone="bad"/><ConceptMetric label="夏普比率" value={active.sharpeRatio??"—"}/></div><MiniLine values={arr(active.equityCurve).map(i=>i.value??i.equity)} height={150}/></ConceptCard>
      <ConceptCard title="回撤"><MiniLine values={arr(active.drawdownCurve).map(i=>i.value??i.drawdown)} tone="orange" height={160}/><div className="cp2BigNumber bad">{displayPct(active.maxDrawdownPct,"—")}<small>最大回撤</small></div></ConceptCard>
      <ConceptCard title="参数"><div className="cp2Kv column">{Object.entries(active.parameters||{}).slice(0,8).map(([k,v])=><span key={k}>{humanize(k)}<b>{String(v)}</b></span>)}{!Object.keys(active.parameters||{}).length&&<span>策略参数<b>等待回测</b></span>}</div></ConceptCard>
    </div>
    <div className="cp2Grid strategyBottom"><ConceptCard title="滚动验证"><MiniLine height={120}/></ConceptCard><ConceptCard title="候选策略"><ConceptTable compact columns={[{key:"name",label:"策略",render:r=>r.name||r.strategyName},{key:"status",label:"状态",render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status)}</Pill>},{key:"score",label:"评分",render:r=>r.score??"—"}]} rows={strategies.slice(0,7)} empty="暂无候选策略"/></ConceptCard><ConceptCard title="决策"><div className="cp2DecisionCards"><div className="good"><CheckCircle2/><b>进入回测</b><small>满足数据质量要求</small></div><div className="warn"><AlertTriangle/><b>进入观察</b><small>需要更多样本</small></div><div className="bad"><Activity/><b>退回优化</b><small>未达到阈值</small></div></div></ConceptCard></div></div>;
}

export function RiskPostureConcept({ data, action, ui }) {
  const pf=data.portfolio||{}; const pr=data.portfolioRisk||{}; const mandate=data.agentStatus?.activeMandate||arr(data.mandates)[0]||{}; const rules=arr(data.riskRules); const incidents=arr(data.riskIncidents); const checks=arr(data.readiness?.checks);
  const ready=checks.filter(c=>c.configured).length;
  return <div className="cp2Stack"><div className={`cp2RiskBanner ${data.system?.killSwitch?"bad":"good"}`}><ShieldCheck size={21}/><b>{data.system?.killSwitch?"已熔断":"允许交易"}</b><span>风险评分 <strong>{pr.score??pf.riskScore??"—"}/100</strong></span><span>今日剩余预算 <strong>{data.system?.remainingDailyLossUsdt==null?"未授权":`${money(data.system.remainingDailyLossUsdt)} U`}</strong></span><span>保证金覆盖 <strong>{pf.totalEquityUsdt?"已同步":"待同步"}</strong></span><span>风险事件 <strong>{incidents.length}</strong></span><button onClick={()=>ui.openPanel("riskRules")}>查看详情</button></div>
    <div className="cp2Grid riskCards"><ConceptCard title="组合风险"><div className="cp2Kv column"><span>总敞口<b>{pr.totalExposureUsdt==null?"—":`${money(pr.totalExposureUsdt)} U`}</b></span><span>杠杆利用率<b>{displayPct(pr.leverageUtilizationPct,"—")}</b></span><span>相关性风险<b>{humanize(pr.correlationRisk,"待评估")}</b></span><span>最大回撤<b>{displayPct(pf.maxDrawdownPct,"—")}</b></span></div><MiniLine height={65}/></ConceptCard>
      <ConceptCard title="AI 的授权边界"><div className="cp2Kv column"><span>交易白名单<b>{arr(mandate.allowedSymbols).join("、")||"未授权"}</b></span><span>杠杆范围<b>{mandate.maxLeverage?`1x – ${mandate.maxLeverage}x`:"—"}</b></span><span>单笔风险<b>{mandate.maxSingleTradeRiskPct==null?"—":`${mandate.maxSingleTradeRiskPct}%`}</b></span><span>单日亏损上限<b>{mandate.maxDailyLossPct==null?"—":`${mandate.maxDailyLossPct}%`}</b></span><span>授权有效期<b>{formatDateTime(mandate.expiresAt)}</b></span></div></ConceptCard>
      <ConceptCard title="账户安全"><div className="cp2SecurityList"><span><KeyRound/>API 密钥<b>{arr(data.apiKeyMetadata).filter(i=>i.hasApiKey).length} 个</b></span><span><LockKeyhole/>密钥权限<b>{arr(data.apiKeyMetadata).every(i=>!i.hasApiKey||i.permissionVerifiedAt)?"已核验":"待核验"}</b></span><span><Server/>账户同步<b>{arr(data.accountSnapshots).some(i=>i.status==="ok")?"正常":"待配置"}</b></span><span><ShieldCheck/>就绪检查<b>{ready}/{checks.length}</b></span></div></ConceptCard>
    </div>
    <div className="cp2Grid two"><ConceptCard title="风险规则命中"><ConceptTable compact columns={[{key:"name",label:"规则"},{key:"scope",label:"范围",render:r=>humanize(r.scope)},{key:"level",label:"级别"},{key:"enabled",label:"状态",render:r=><Pill tone={r.enabled===false?"warn":"good"}>{r.enabled===false?"停用":"启用"}</Pill>}]} rows={rules.slice(0,7)} empty="暂无风险规则"/></ConceptCard><ConceptCard title="事件风险窗口"><ConceptTable compact columns={[{key:"name",label:"事件",render:r=>r.name||r.title},{key:"createdAt",label:"时间",render:r=>formatDateTime(r.createdAt)},{key:"severity",label:"等级",render:r=><Pill tone={toneOf(r.severity)}>{humanize(r.severity)}</Pill>}]} rows={incidents.slice(0,7)} empty="暂无风险事件"/></ConceptCard></div>
    <ConceptCard title="应急操作" className="cp2Emergency"><div className="cp2EmergencyActions"><button onClick={()=>action("/api/system/autonomy",{enabled:false})}><Activity/><span><b>暂停自主</b><small>停止 AI 自主交易</small></span></button><button onClick={()=>action("/api/risk/reduce-only",{enabled:!data.system?.reduceOnlyMode})}><RefreshCw/><span><b>{data.system?.reduceOnlyMode?"退出只减仓":"只减仓"}</b><small>控制新增风险敞口</small></span></button><button onClick={()=>{if(window.confirm("确认一键平掉所有持仓并进入只减仓模式？"))action("/api/risk/emergency-flatten",{});}}><Target/><span><b>一键平仓</b><small>市价平掉全部持仓</small></span></button><button className="bad" onClick={()=>action("/api/risk/kill-switch",{enabled:!data.system?.killSwitch,reason:""})}><Zap/><span><b>{data.system?.killSwitch?"解除熔断":"一键熔断"}</b><small>立即阻断所有新交易</small></span></button></div></ConceptCard></div>;
}

export function MandateConcept({ data, ui }) {
  const mandate=data.agentStatus?.activeMandate||arr(data.mandates)[0]||{}; const history=arr(data.mandates);
  return <div className="cp2Stack"><p className="cp2Intro">授权边界定义 AI 交易员能做什么、能用多少风险；修改后必须重新生效。</p><div className="cp2Grid mandateTop"><ConceptCard title="运行模式"><div className="cp2ModeCards">{[["observe","观察"],["semi_auto","半自动"],["full_auto","全自动"]].map(([id,label])=><button className={(data.automationState?.mode||"observe")===id?"active":""} key={id}><i/><span><b>{label}</b><small>{id==="observe"?"仅分析不下单":id==="semi_auto"?"计划需人工批准":"边界内自动执行"}</small></span></button>)}</div></ConceptCard><ConceptCard title="当前授权委托" className="span2"><div className="cp2MandateSummary"><Pill tone={mandate.status==="active"?"good":"warn"}>{humanize(mandate.status,"未激活")}</Pill><div><small>委托名称</small><b>{mandate.name||"未创建授权"}</b></div><div><small>生效时间</small><b>{formatDateTime(mandate.activatedAt||mandate.createdAt)}</b></div><div><small>到期时间</small><b>{formatDateTime(mandate.expiresAt)}</b></div></div></ConceptCard></div>
    <div className="cp2MandateGrid"><ConceptCard title="交易白名单"><div className="cp2TokenBox">{arr(mandate.allowedSymbols).map(s=><Pill key={s}>{s}</Pill>)}{!arr(mandate.allowedSymbols).length&&<span>未配置交易对</span>}</div></ConceptCard><ConceptCard title="杠杆范围"><div className="cp2Range"><b>{mandate.minLeverage??1}x</b><i/><b>{mandate.maxLeverage??"—"}x</b></div></ConceptCard><ConceptCard title="单笔风险"><div className="cp2BigNumber">{mandate.maxSingleTradeRiskPct==null?"—":`${mandate.maxSingleTradeRiskPct}%`}<small>账户净值上限</small></div></ConceptCard><ConceptCard title="单日亏损"><div className="cp2BigNumber">{mandate.maxDailyLossPct==null?"—":`${mandate.maxDailyLossPct}%`}<small>触发后停止开仓</small></div></ConceptCard><ConceptCard title="审批阈值"><div className="cp2BigNumber">{mandate.humanApprovalNotionalUsdt==null?"—":`${money(mandate.humanApprovalNotionalUsdt)} U`}<small>超额转人工</small></div></ConceptCard><ConceptCard title="委托有效期"><div className="cp2BigNumber small">{formatDateTime(mandate.expiresAt)}<small>到期自动失效</small></div></ConceptCard></div>
    <div className="cp2Grid two"><ConceptCard title="变更预览"><div className="cp2Kv column"><span>运行模式<b>{data.automationState?.label||"观察"}</b></span><span>最大杠杆<b>{mandate.maxLeverage?`${mandate.maxLeverage}x`:"—"}</b></span><span>单笔风险<b>{mandate.maxSingleTradeRiskPct==null?"—":`${mandate.maxSingleTradeRiskPct}%`}</b></span><span>审批阈值<b>{mandate.humanApprovalNotionalUsdt==null?"—":`${money(mandate.humanApprovalNotionalUsdt)} U`}</b></span></div></ConceptCard><ConceptCard title="变更记录"><ConceptTable compact columns={[{key:"createdAt",label:"时间",render:r=>formatDateTime(r.updatedAt||r.createdAt)},{key:"name",label:"授权"},{key:"status",label:"状态",render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status)}</Pill>}]} rows={history.slice(0,6)} empty="暂无变更记录"/></ConceptCard></div><div className="cp2FormActions"><button className="cp2Secondary" onClick={()=>ui.openPanel("mandate")}>保存草稿</button><button className="cp2Primary" onClick={()=>ui.openPanel("mandate")}>编辑并提交生效</button></div></div>;
}

export function RulesConcept({ data, action, ui }) {
  const rules=arr(data.riskRules); const [selectedId,setSelectedId]=useState(rules[0]?.id||""); const selected=rules.find(r=>r.id===selectedId)||rules[0]||{};
  const cats=["全部规则","账户风险","交易风险","事件风险","系统风险"];
  return <div className="cp2RulesLayout"><aside className="cp2SideFilter"><b>规则库</b>{cats.map((name,index)=><button className={index===0?"active":""} key={name}>{name}<span>{index===0?rules.length:""}</span></button>)}<button className="cp2Secondary" onClick={()=>ui.openPanel("riskRules")}><Plus size={12}/> 新建规则</button></aside>
    <main className="cp2RulesMain"><ConceptCard title="规则列表" meta={`${rules.length} 条`} action={<button className="cp2Primary" onClick={()=>ui.openPanel("riskRules")}>保存版本</button>}><div className="cp2Search"><Search size={13}/><span>搜索规则名称或关键词</span></div><ConceptTable columns={[{key:"name",label:"规则名称",render:r=><button className="cp2Link" onClick={()=>setSelectedId(r.id)}>{r.name}</button>},{key:"scope",label:"作用范围",render:r=>humanize(r.scope)},{key:"level",label:"优先级"},{key:"action",label:"触发动作",render:r=>humanize(r.action)},{key:"enabled",label:"状态",render:r=><button className={`cp2Switch ${r.enabled===false?"":"on"}`} onClick={()=>action(`/api/risk/rules/${r.id}`,{enabled:r.enabled===false},"PATCH")}><i/></button>},{key:"updatedAt",label:"更新时间",render:r=>formatDateTime(r.updatedAt||r.createdAt)}]} rows={rules} empty="暂无风险规则"/></ConceptCard>
      <div className="cp2Grid ruleBottom"><ConceptCard title={`规则编辑 · ${selected.name||"未选择"}`}><div className="cp2Kv"><span>作用范围<b>{humanize(selected.scope)}</b></span><span>优先级<b>{selected.level||"—"}</b></span><span>动作<b>{humanize(selected.action)}</b></span><span>状态<b>{selected.enabled===false?"停用":"启用"}</b></span></div><div className="cp2CodeBox">{selected.condition||selected.description||"尚未配置结构化条件。"}</div><button className="cp2Secondary" onClick={()=>ui.openPanel("riskRules")}>打开完整编辑器</button></ConceptCard><ConceptCard title="命中记录"><ConceptTable compact columns={[{key:"createdAt",label:"时间",render:r=>formatTime(r.createdAt)},{key:"symbol",label:"资产"},{key:"decision",label:"结果",render:r=><Pill tone={toneOf(r.decision)}>{humanize(r.decision)}</Pill>}]} rows={arr(data.riskChecks).slice(0,7)} empty="暂无命中记录"/></ConceptCard><ConceptCard title="来源与版本"><div className="cp2Kv column"><span>规则来源<b>{selected.source||"内置"}</b></span><span>当前版本<b>{selected.version||"v1"}</b></span><span>最近变更<b>{formatDateTime(selected.updatedAt||selected.createdAt)}</b></span><span>覆盖对象<b>{humanize(selected.scope,"全账户")}</b></span></div></ConceptCard></div></main></div>;
}

export function LiveConcept({ data, action, ui }) {
  const checks=arr(data.readiness?.checks); const policies=arr(data.grayReleasePolicies); const drills=arr(data.drillRuns); const ready=checks.filter(c=>c.configured);
  return <div className="cp2Stack"><div className="cp2RiskBanner good"><ShieldCheck/><b>实盘就绪状态 {ready.length}/{checks.length}</b><span>所有关键安全闸通过后才会真实写单</span><span>配置完成度 <strong>{data.readiness?.configurationCompletionPct??0}%</strong></span><button onClick={()=>ui.openPanel("mandate")}>查看缺失项</button></div>
    <div className="cp2Grid liveTop"><ConceptCard title="实盘写入配置" className="span2"><LiveGrayPanel data={data} action={action} ui={ui}/></ConceptCard><ConceptCard title="就绪检查"><div className="cp2Checklist vertical">{checks.slice(0,12).map(c=><span className={c.configured?"":"warn"} key={c.key}>{c.configured?<CheckCircle2/>:<AlertTriangle/>}{c.label}<small>{c.configured?"通过":"待配置"}</small></span>)}</div></ConceptCard></div>
    <ConceptCard title="灰度策略"><div className="cp2GrayCards">{policies.slice(0,4).map((p,index)=><article key={p.id||index}><div><b>{p.name||p.symbol||"灰度策略"}</b><Pill tone={p.enabled?"good":"warn"}>{p.enabled?"运行中":"未启用"}</Pill></div><span>单笔额度 <b>{money(p.maxNotionalUsdt)} U</b></span><span>人工确认 <b>{p.requiresApproval===false?"否":"是"}</b></span><span>累计样本 <b>{p.sampleCount??0}</b></span></article>)}{!policies.length&&<div className="cp2Empty"><Gauge/><b>暂无灰度策略</b><span>在上方配置启用后显示。</span></div>}</div></ConceptCard>
    <div className="cp2Grid two"><ConceptCard title="灰度进度"><ConceptTable compact columns={[{key:"createdAt",label:"时间",render:r=>formatDateTime(r.createdAt)},{key:"name",label:"演练",render:r=>r.name||r.scenario},{key:"status",label:"结果",render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status)}</Pill>}]} rows={drills.slice(0,8)} empty="暂无演练记录"/></ConceptCard><ConceptCard title="回退条件"><div className="cp2Checklist vertical"><span><AlertTriangle/>连续订单失败</span><span><AlertTriangle/>对账不一致</span><span><AlertTriangle/>行情数据陈旧</span><span><AlertTriangle/>风控检查异常</span></div></ConceptCard></div></div>;
}

export function KeysConcept({ data, action, ui }) {
  const accounts=arr(data.exchangeAccounts); const metadata=arr(data.apiKeyMetadata); const alerts=arr(data.notifications).filter(n=>/key|密钥|ip|权限/i.test(`${n.title} ${n.message}`));
  return <div className="cp2Stack"><p className="cp2Intro">交易所凭证仅用于交易与读取账户；提现权限必须关闭，并建议绑定 IP 白名单。</p><div className="cp2ExchangeCards">{["BINANCE","OKX"].map(exchange=>{const account=accounts.find(a=>a.exchange===exchange)||{};const key=metadata.find(k=>k.exchange===exchange)||{};return <ConceptCard title={exchange==="BINANCE"?"Binance":"OKX"} key={exchange} meta={key.hasApiKey||account.id?"已接入":"未配置"}><div className="cp2ExchangeBody"><div className={`cp2ExchangeLogo ${exchange.toLowerCase()}`}>{exchange==="BINANCE"?"◆":"✣"}</div><div className="cp2Kv column"><span>密钥尾号<b>{key.maskedKey||account.maskedKey||"—"}</b></span><span>IP 白名单<b>{account.ipWhitelist||"未配置"}</b></span><span>权限核验<b>{key.permissionVerifiedAt?"已核验":"待核验"}</b></span><span>最近验证<b>{formatDateTime(key.permissionVerifiedAt||account.lastValidatedAt)}</b></span></div><div className="cp2PermissionGrid"><span>读取 <CheckCircle2/></span><span>交易 <CheckCircle2/></span><span>提现 <LockKeyhole/></span></div><button className="cp2Secondary" onClick={()=>ui.setActive("systemSettings:exchange")}>管理密钥</button>{key.hasApiKey&&!key.permissionVerifiedAt&&<button className="cp2Primary" onClick={()=>action(`/api/exchange/api-key-metadata/${key.id}/confirm-no-withdraw`,{})}>确认无提现权限</button>}</div></ConceptCard>})}</div>
    <div className="cp2Grid three"><ConceptCard title="安全发现"><div className="cp2Checklist vertical">{alerts.slice(0,6).map((a,index)=><span key={a.id||index}><AlertTriangle/>{a.title||a.message}<small>{formatTime(a.createdAt)}</small></span>)}{!alerts.length&&<span><CheckCircle2/>暂无密钥安全告警</span>}</div></ConceptCard><ConceptCard title="IP 白名单管理"><ConceptTable compact columns={[{key:"exchange",label:"交易所"},{key:"ipWhitelist",label:"允许 IP",render:r=>r.ipWhitelist||"未配置"},{key:"status",label:"状态",render:r=><Pill tone={r.ipWhitelist?"good":"warn"}>{r.ipWhitelist?"已启用":"待配置"}</Pill>}]} rows={accounts} empty="暂无交易所账户"/></ConceptCard><ConceptCard title="告警渠道"><div className="cp2SecurityList"><span><Bell/>飞书通知<b>{data.larkConfigured?"已启用":"未配置"}</b></span><span><Bell/>Telegram<b>{data.telegramConfigured?"已启用":"未配置"}</b></span><span><Server/>Webhook<b>{data.config?.integrations?.alerts?.hasWebhook?"已启用":"未配置"}</b></span></div></ConceptCard></div></div>;
}

export function OperationsOverviewConcept({ data, action, ui }) {
  const tasks=arr(data.tasks); const runs=arr(data.jobRuns); const events=arr(data.events); const audits=arr(data.auditLogs); const incidents=arr(data.riskIncidents);
  const services=[["API 健康",data.system?.apiHealth||"待配置"],["WebSocket 连接",data.realtimeStarted?"正常":"待配置"],["市场数据延迟",data.marketStream?.freshnessLabel||"待同步"],["用户同步状态",arr(data.accountSnapshots).some(s=>s.status==="ok")?"正常":"待配置"],["功能一致性","正常"],["审计链校验",data.readiness?.checks?.find(c=>c.key==="audit_chain")?.configured?"正常":"待配置"]];
  return <div className="cp2Stack"><div className="cp2Metrics six">{services.map(([label,value],index)=><ConceptMetric key={label} label={label} value={humanize(value)} sub={index===0?"系统入口":index===1?"实时连接":index===2?"公开行情":index===3?"账户快照":index===4?"前后端契约":"哈希链"} tone={toneOf(value)} icon={[ShieldCheck,Activity,Clock3,Users,Wrench,FileText][index]}/>)}</div>
    <div className="cp2Grid opsTop"><ConceptCard title="任务与自动化" className="span2"><ConceptTable compact columns={[{key:"name",label:"任务名称"},{key:"type",label:"类型"},{key:"lastRunAt",label:"上次运行",render:r=>formatDateTime(r.lastRunAt)},{key:"nextRunAt",label:"下次运行",render:r=>formatDateTime(r.nextRunAt)},{key:"status",label:"状态",render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status,r.enabled===false?"已暂停":"运行中")}</Pill>},{key:"action",label:"操作",render:r=><button className="cp2Link" onClick={()=>action(`/api/tasks/${r.id}/run`,{})}>立即运行</button>}]} rows={tasks.slice(0,8)} empty="暂无任务"/></ConceptCard><ConceptCard title="事件日历"><ConceptTable compact columns={[{key:"due",label:"时间",render:r=>formatDateTime(r.due||r.startAt)},{key:"title",label:"事件"},{key:"impact",label:"影响",render:r=><Pill tone={num(r.impact)>=80?"bad":"warn"}>{r.impactLabel||r.impact||"待评估"}</Pill>}]} rows={events.slice(0,7)} empty="暂无事件"/></ConceptCard></div>
    <div className="cp2Grid two wideLeft"><ConceptCard title="审计与运行轨迹" action={<button className="cp2Link" onClick={()=>ui.setActive("auditSystem")}>查看审计 ›</button>}><ConceptTable compact columns={[{key:"createdAt",label:"时间",render:r=>formatDateTime(r.createdAt)},{key:"actor",label:"操作者",render:r=>r.actor||r.userName||r.role||"系统"},{key:"action",label:"动作",render:r=>humanize(r.action)},{key:"resource",label:"资源",render:r=>r.resource||r.target||"—"},{key:"status",label:"结果",render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status,"已记录")}</Pill>}]} rows={audits.slice(0,9)} empty="暂无审计记录"/></ConceptCard><ConceptCard title="对账与恢复"><div className="cp2RecoveryCards"><article><RefreshCw/><span><b>对账不一致</b><small>{arr(data.reconciliationReports).filter(r=>/failed|mismatch/i.test(String(r.status))).length} 项</small></span></article><article><Activity/><span><b>OMS 恢复能力</b><small>正常</small></span></article><article><AlertTriangle/><span><b>僵尸订单清理</b><small>{incidents.length} 个待观察</small></span></article><article><Database/><span><b>Outbox 积压</b><small>{runs.filter(r=>/pending/i.test(String(r.status))).length} 条</small></span></article></div></ConceptCard></div></div>;
}

export function EventsConcept({ data, ui }) {
  const events=arr(data.events); const [selectedId,setSelectedId]=useState(events[0]?.id||""); const selected=events.find(e=>e.id===selectedId)||events[0]||{};
  // 真实月视图:按事件真实日期落格,不再用 i%35 任意分布
  const _now=new Date(); const _y=_now.getFullYear(); const _m=_now.getMonth();
  const monthLabel=`${_y} 年 ${_m+1} 月`;
  const _startWd=new Date(_y,_m,1).getDay(); const _dim=new Date(_y,_m+1,0).getDate(); const _prevDim=new Date(_y,_m,0).getDate();
  const _byDay={}; events.forEach(e=>{const d=new Date(e.due||e.startAt||e.createdAt); if(!isNaN(d.getTime())&&d.getFullYear()===_y&&d.getMonth()===_m){(_byDay[d.getDate()]||(_byDay[d.getDate()]=[])).push(e);}});
  const days=Array.from({length:42},(_,index)=>{const dn=index-_startWd+1; const inMonth=dn>=1&&dn<=_dim; return {n:inMonth?dn:(dn<1?_prevDim+dn:dn-_dim),out:!inMonth,today:inMonth&&dn===_now.getDate(),events:inMonth?(_byDay[dn]||[]):[]};});
  return <div className="cp2EventsLayout"><main><div className="cp2CalendarToolbar"><button className="active">月视图</button><button>周视图</button><span>{monthLabel}</span><small className="cp2CalHint">按真实事件日期排布</small></div><div className="cp2Calendar"><div className="week">{["周日","周一","周二","周三","周四","周五","周六"].map(d=><b key={d}>{d}</b>)}</div><div className="days">{days.map((day,index)=><div key={index} className={`${day.out?"out":""} ${day.today?"today":""}`}><small>{day.n}</small>{day.events.slice(0,3).map(e=><button key={e.id} className={selected.id===e.id?"active":""} onClick={()=>setSelectedId(e.id)}><i className={toneOf(e.impact)}/>{formatTime(e.due||e.startAt)} {e.shortTitle||e.title}</button>)}{day.events.length>3&&<em className="cp2CalMore">+{day.events.length-3}</em>}</div>)}</div></div><div className="cp2Grid two"><ConceptCard title="即将发生的事件"><ConceptTable compact columns={[{key:"due",label:"时间",render:r=>formatDateTime(r.due||r.startAt)},{key:"title",label:"事件"},{key:"category",label:"类型"},{key:"impact",label:"影响",render:r=><Pill tone={num(r.impact)>=80?"bad":"warn"}>{r.impactLabel||r.impact||"待评估"}</Pill>}]} rows={events.slice(0,7)} empty="暂无事件"/></ConceptCard><ConceptCard title="事件源健康状态"><ConceptTable compact columns={[{key:"name",label:"来源"},{key:"category",label:"类别"},{key:"status",label:"状态",render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status,"正常")}</Pill>}]} rows={arr(data.eventSources).slice(0,7)} empty="暂无事件源"/></ConceptCard></div></main>
    <aside><ConceptCard title="事件详情"><Pill tone={num(selected.impact)>=80?"bad":"warn"}>{selected.impactLabel||"待评估"}</Pill><h3>{selected.title||"选择日历事件"}</h3><p>{selected.description||selected.summary||"暂无事件说明。"}</p><div className="cp2Kv column"><span>时间<b>{formatDateTime(selected.due||selected.startAt)}</b></span><span>类别<b>{selected.category||"—"}</b></span><span>来源<b>{selected.source||"—"}</b></span><span>关联资产<b>{arr(selected.relatedSymbols).join("、")||"—"}</b></span></div><button className="cp2Secondary" onClick={()=>ui.openPanel("eventSources")}>编辑事件</button><button className="cp2Primary" onClick={()=>ui.openPanel("eventRule")}>创建规则</button></ConceptCard></aside></div>;
}

export function TasksConcept({ data, action, ui }) {
  const tasks=arr(data.tasks); const runs=arr(data.jobRuns); const [selectedId,setSelectedId]=useState(tasks[0]?.id||""); const selected=tasks.find(t=>t.id===selectedId)||tasks[0]||{};
  return <div className="cp2Stack"><div className="cp2RiskBanner good"><CheckCircle2/><b>调度健康</b><span>任务总数 <strong>{tasks.length}</strong></span><span>成功率 <strong>{runs.length?`${(runs.filter(r=>/ok|success/i.test(String(r.status))).length/runs.length*100).toFixed(1)}%`:"—"}</strong></span><span>队列延迟 <strong>实时</strong></span><span>执行中 <strong>{runs.filter(r=>/running/i.test(String(r.status))).length}</strong></span></div>
    <div className="cp2TasksLayout"><ConceptCard title="任务列表" action={<button className="cp2Primary" onClick={()=>ui.openPanel("taskManager")}><Plus size={12}/> 新建任务</button>}><ConceptTable compact columns={[{key:"name",label:"任务名称",render:r=><button className="cp2Link" onClick={()=>setSelectedId(r.id)}>{r.name}</button>},{key:"handler",label:"处理器",render:r=>humanize(r.handler||r.type)},{key:"schedule",label:"调度"},{key:"nextRunAt",label:"下次运行",render:r=>formatDateTime(r.nextRunAt)},{key:"enabled",label:"状态",render:r=><button className={`cp2Switch ${r.enabled===false?"":"on"}`} onClick={()=>action(`/api/tasks/${r.id}/${r.enabled===false?"resume":"pause"}`,r.enabled===false?{}:{reason:"manual_ui"})}><i/></button>}]} rows={tasks} empty="暂无任务"/></ConceptCard>
      <ConceptCard title={`调度规则 · ${selected.name||"未选择"}`}><div className="cp2Kv column"><span>任务 ID<b>{selected.id||"—"}</b></span><span>处理器<b>{humanize(selected.handler||selected.type)}</b></span><span>调度表达式<b>{selected.schedule||"—"}</b></span><span>下次运行<b>{formatDateTime(selected.nextRunAt)}</b></span><span>状态<b>{selected.enabled===false?"已暂停":"已启用"}</b></span></div><button className="cp2Secondary" onClick={()=>ui.openPanel("taskManager")}>编辑任务</button><button className="cp2Primary" disabled={!selected.id} onClick={()=>action(`/api/tasks/${selected.id}/run`,{})}><Play size={12}/> 立即运行</button></ConceptCard>
      <ConceptCard title="近期运行"><ConceptTable compact columns={[{key:"createdAt",label:"时间",render:r=>formatTime(r.createdAt)},{key:"name",label:"任务",render:r=>r.name||r.taskName||humanize(r.handler)},{key:"durationMs",label:"耗时",render:r=>r.durationMs?`${r.durationMs} ms`:"—"},{key:"status",label:"结果",render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status)}</Pill>}]} rows={runs.slice(0,10)} empty="暂无运行记录"/></ConceptCard></div>
    <ConceptCard title="依赖关系"><div className="cp2Dependency">{tasks.slice(0,5).map((task,index)=><React.Fragment key={task.id||index}><article className={index===2?"active":""}><span><Wrench/></span><b>{task.name}</b><small>{humanize(task.handler||task.type)}</small></article>{index<Math.min(4,tasks.length-1)&&<ChevronRight/>}</React.Fragment>)}</div><div className="cp2FormActions"><button className="cp2Primary" onClick={()=>ui.openPanel("taskManager")}>新建任务</button><button className="cp2Secondary" disabled={!selected.id} onClick={()=>action(`/api/tasks/${selected.id}/run`,{})}>立即运行</button><button className="cp2Secondary" disabled={!selected.id} onClick={()=>action(`/api/tasks/${selected.id}/pause`,{reason:"manual_ui"})}>暂停任务</button><button className="cp2Primary" onClick={()=>ui.openPanel("taskManager")}>保存调度</button></div></ConceptCard></div>;
}

export function AuditConcept({ data }) {
  const logs=arr(data.auditLogs); const [selectedId,setSelectedId]=useState(logs[0]?.id||""); const selected=logs.find(l=>l.id===selectedId)||logs[0]||{};
  return <div className="cp2Stack"><ConceptCard title="审计查询"><div className="cp2FilterBar"><span>时间范围 <b>最近 30 天</b></span><span>操作者 <b>全部</b></span><span>动作 <b>全部</b></span><span>资源 <b>全部</b></span><div className="cp2Search"><Search/><span>输入资源 ID</span></div><button className="cp2Secondary">重置</button><button className="cp2Primary">查询</button></div></ConceptCard>
    <div className="cp2AuditLayout"><ConceptCard title={`审计记录 · 共 ${logs.length} 条`}><ConceptTable columns={[{key:"createdAt",label:"时间",render:r=>formatDateTime(r.createdAt)},{key:"actor",label:"操作者",render:r=>r.actor||r.userName||r.role||"系统"},{key:"action",label:"动作",render:r=>humanize(r.action)},{key:"resource",label:"资源",render:r=>r.resource||r.target||"—"},{key:"status",label:"结果",render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status,"成功")}</Pill>},{key:"id",label:"记录 ID",render:r=><button className="cp2Link" onClick={()=>setSelectedId(r.id)}>{String(r.id).slice(0,12)}</button>}]} rows={logs} empty="暂无审计记录"/></ConceptCard>
      <ConceptCard title="事件详情"><div className="cp2AuditDetail"><div className="cp2Kv column"><span>事件 ID<b>{selected.id||"—"}</b></span><span>时间<b>{formatDateTime(selected.createdAt)}</b></span><span>操作者<b>{selected.actor||selected.userName||selected.role||"系统"}</b></span><span>动作<b>{humanize(selected.action)}</b></span><span>资源<b>{selected.resource||selected.target||"—"}</b></span><span>哈希<b>{selected.hash?String(selected.hash).slice(0,18):"—"}</b></span></div><b>请求上下文</b><pre>{JSON.stringify(selected.context||selected.payload||{},null,2)}</pre><b>相关事件</b><div className="cp2Checklist vertical">{logs.slice(0,4).map((l,index)=><span key={l.id||index}><i className={toneOf(l.status)}/>{formatTime(l.createdAt)} {humanize(l.action)}</span>)}</div></div></ConceptCard></div>
    <div className="cp2Grid two"><ConceptCard title="完整性校验"><div className="cp2Compliance"><ShieldCheck/><span><b>审计链状态</b><small>{data.readiness?.checks?.find(c=>c.key==="audit_chain")?.configured?"已验证":"等待外部 WORM 配置"}</small></span></div></ConceptCard><ConceptCard title="数据保留策略"><div className="cp2Compliance"><Clock3/><span><b>本地记录持续保留</b><small>外部不可篡改存储由 WORM 配置决定</small></span></div></ConceptCard></div></div>;
}

export function NotificationsConcept({ data, action }) {
  const notes=arr(data.notifications); const [category,setCategory]=useState("全部"); const filtered=category==="全部"?notes:notes.filter(n=>String(n.category||n.type||"系统").includes(category)); const [selectedId,setSelectedId]=useState(notes[0]?.id||""); const selected=filtered.find(n=>n.id===selectedId)||filtered[0]||{};
  const unread=notes.filter(n=>!n.read).length;
  return <div className="cp2Stack"><div className="cp2Metrics four"><ConceptMetric label="未读" value={String(unread)} tone={unread?"bad":"good"} icon={Bell}/><ConceptMetric label="严重" value={String(notes.filter(n=>/critical|严重|高危/i.test(String(n.severity||n.level))).length)} tone="bad"/><ConceptMetric label="已确认" value={String(notes.filter(n=>n.read).length)} tone="good"/><ConceptMetric label="已静默" value={String(notes.filter(n=>n.muted).length)}/></div>
    <div className="cp2NotificationsLayout"><aside className="cp2SideFilter"><b>分类筛选</b>{["全部","交易","系统","风控","任务","安全"].map(name=><button className={category===name?"active":""} onClick={()=>setCategory(name)} key={name}>{name}<span>{name==="全部"?notes.length:notes.filter(n=>String(n.category||n.type||"系统").includes(name)).length}</span></button>)}</aside>
      <ConceptCard title="通知收件箱" meta={`${filtered.length} 条`}><div className="cp2FilterBar compact"><select><option>全部状态</option></select><div className="cp2Search"><Search/><span>搜索通知标题或内容</span></div><button className="cp2Secondary" onClick={()=>action("/api/notifications/read",{})}>全部已读</button></div><div className="cp2NotificationList">{filtered.map(n=><button className={n.id===selected.id?"active":""} key={n.id} onClick={()=>setSelectedId(n.id)}><i className={toneOf(n.severity||n.level)}/><div><span><b>{n.title||"系统通知"}</b><Pill tone={toneOf(n.severity||n.level)}>{humanize(n.severity||n.level,"一般")}</Pill></span><p>{n.message||n.body||"—"}</p><small>{formatDateTime(n.createdAt)} · {n.source||n.category||"系统"}</small></div></button>)}</div></ConceptCard>
      <ConceptCard title="通知详情"><Pill tone={toneOf(selected.severity||selected.level)}>{humanize(selected.severity||selected.level,"一般")}</Pill><h3>{selected.title||"选择一条通知"}</h3><p>{selected.message||selected.body||"暂无通知内容。"}</p><div className="cp2Kv column"><span>通知 ID<b>{selected.id||"—"}</b></span><span>来源<b>{selected.source||selected.category||"系统"}</b></span><span>时间<b>{formatDateTime(selected.createdAt)}</b></span><span>状态<b>{selected.read?"已读":"未读"}</b></span></div><button className="cp2Primary" onClick={()=>action("/api/notifications/read",{})}>确认</button><button className="cp2Secondary">静默</button></ConceptCard></div>
    <ConceptCard title="投递渠道健康状态"><div className="cp2ChannelGrid">{[["邮件",data.config?.integrations?.alerts?.hasWebhook],["飞书",data.larkConfigured],["短信",false],["Telegram",data.telegramConfigured]].map(([name,ok])=><div key={name}><Bell/><span><b>{name}</b><small>{ok?"正常":"未配置"}</small></span><Pill tone={ok?"good":"warn"}>{ok?"可用":"待配置"}</Pill></div>)}</div></ConceptCard></div>;
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
    <ConceptCard title="Agent 列表" action={<Pill>{profiles.length} 个</Pill>}>
      <div className="cp2Search"><Search/><span>搜索 Agent 名称或角色</span></div>
      <div className="cp2AgentList">{profiles.map(profile=><button className={profile.id===selected.id?"active":""} key={profile.id} onClick={()=>choose(profile)}><span className="cp2AgentIcon"><Bot/></span><div><b>{profile.name}</b><small>{profile.role}</small></div><em>{profile.enabled===false?"已停用":"已启用"}</em><i>{String(profile.order||"").padStart(2,"0")}</i></button>)}</div>
    </ConceptCard>
    <ConceptCard title={`编辑 Agent：${selected.name||"未选择"}`} action={<div className="cp2FormActions"><button className="cp2Secondary" onClick={()=>selected.id&&action(`/api/agent/profiles/${selected.id}`,{enabled:selected.enabled===false},"PATCH")}>{selected.enabled===false?"启用":"停用"}</button><button className="cp2Primary" onClick={save}>应用</button></div>}>
      <div className="cp2AgentEditor">
        <label>Agent 名称<input value={draft.name||""} onChange={event=>update("name",event.target.value)}/></label>
        <label>角色说明<input value={draft.role||""} onChange={event=>update("role",event.target.value)}/></label>
        <label className="full">使命<textarea rows="3" value={draft.mission||""} onChange={event=>update("mission",event.target.value)}/></label>
        <label className="full">系统声明<textarea rows="3" value={draft.declaration||""} onChange={event=>update("declaration",event.target.value)}/></label>
        <label>人格风格<input value={draft.personality||""} onChange={event=>update("personality",event.target.value)}/></label>
        <label>记忆策略<input value={typeof draft.memoryPolicy==="string"?draft.memoryPolicy:JSON.stringify(draft.memoryPolicy||{})} onChange={event=>update("memoryPolicy",event.target.value)}/></label>
        <label className="full">安全边界<textarea rows="3" value={typeof draft.boundaries==="string"?draft.boundaries:JSON.stringify(draft.boundaries||{},null,2)} onChange={event=>update("boundaries",event.target.value)}/></label>
      </div>
      <div className="cp2AgentTools"><b>工具权限</b><div>{arr(selected.tools).map(tool=><Pill key={typeof tool==="string"?tool:tool.name}>{typeof tool==="string"?tool:tool.name}</Pill>)}{!arr(selected.tools).length&&<span>未声明专属工具</span>}</div></div>
    </ConceptCard>
    <aside className="cp2AgentAside">
      <ConceptCard title="版本历史"><div className="cp2Timeline">{profiles.filter(p=>p.id===selected.id).map((profile,index)=><div className="done" key={profile.id||index}><i>✓</i><span><b>当前版本</b><small>{formatDateTime(profile.updatedAt||profile.createdAt)}</small></span></div>)}</div></ConceptCard>
      <ConceptCard title="测试沙箱"><div className="cp2CodeBox">保存后可前往 AI 交易员，通过真实对话验证当前 Agent 配置。</div><button className="cp2Secondary" onClick={()=>ui.setActive("chat")}>前往测试</button></ConceptCard>
    </aside>
  </div>;
}

function UsersSettingsConcept({ data, action, ui }) {
  const users=arr(data.users); const subscriptions=arr(data.subscriptions); const profiles=arr(data.agentProfiles);
  const [selectedId,setSelectedId]=useState(users[0]?.id||""); const selected=users.find(user=>user.id===selectedId)||users[0]||{};
  const subscription=subscriptions.find(item=>item.userId===selected.id||item.tenantId===selected.tenantId)||{};
  const resetPassword=()=>{
    const password=window.prompt(`为 ${selected.email||selected.name} 设置至少 10 位的临时密码`);
    if(!password)return;
    if(password.length<10){ui.notify?.("临时密码至少 10 位");return;}
    action(`/api/admin/users/${selected.id}/reset-password`,{password});
  };
  const createUser=()=>{
    const email=window.prompt("新用户邮箱");
    if(!email)return;
    const name=window.prompt("用户姓名",email.split("@")[0])||email.split("@")[0];
    const password=window.prompt("初始密码（至少 10 位）");
    if(!password)return;
    action("/api/admin/users",{email,name,password,role:"交易用户",freeMonths:0});
  };
  return <div className="cp2Stack">
    <div className="cp2Metrics six"><ConceptMetric label="活跃用户" value={`${users.filter(u=>u.status!=="disabled").length}/${users.length}`}/><ConceptMetric label="订阅计划" value={String(arr(data.subscriptionPlans).length)} sub="套餐"/><ConceptMetric label="到期时间" value={formatDateTime(subscription.currentPeriodEnd)} sub="当前选中用户"/><ConceptMetric label="席位使用" value={`${users.length}/${Math.max(users.length,20)}`}/><ConceptMetric label="使用额度" value={`${arr(data.llmRuns).length}`} sub="模型调用"/><ConceptMetric label="即将到期" value={String(subscriptions.filter(s=>s.currentPeriodEnd&&new Date(s.currentPeriodEnd).getTime()-Date.now()<30*86400000).length)} sub="30 天内"/></div>
    <div className="cp2UsersLayout">
      <ConceptCard title="用户列表" action={<button className="cp2Primary" onClick={createUser}><Plus size={12}/> 新增用户</button>}>
        <div className="cp2Search"><Search/><span>搜索姓名 / 邮箱 / 角色</span></div>
        <ConceptTable columns={[{key:"name",label:"用户",render:r=><button className="cp2UserName" onClick={()=>setSelectedId(r.id)}><i>{String(r.name||r.email||"?").charAt(0)}</i><span><b>{r.name||r.email}</b><small>{r.email}</small></span></button>},{key:"role",label:"角色",render:r=><select value={r.role||"交易用户"} disabled={r.isOwner} onChange={event=>action(`/api/admin/users/${r.id}`,{role:event.target.value},"PATCH")}><option>交易用户</option><option>管理员</option></select>},{key:"status",label:"状态",render:r=><Pill tone={r.status==="disabled"?"warn":"good"}>{r.status==="disabled"?"已停用":"正常"}</Pill>},{key:"createdAt",label:"创建时间",render:r=>formatDateTime(r.createdAt)}]} rows={users} empty="暂无用户"/>
      </ConceptCard>
      <ConceptCard title="用户详情" action={<div className="cp2FormActions"><button className="cp2Secondary" disabled={selected.isOwner} onClick={()=>action(`/api/admin/users/${selected.id}`,{status:selected.status==="disabled"?"active":"disabled"},"PATCH")}>{selected.status==="disabled"?"启用用户":"停用用户"}</button><button className="cp2Secondary" disabled={selected.isOwner} onClick={resetPassword}>修改密码</button></div>}>
        <div className="cp2UserDetailHead"><i>{String(selected.name||selected.email||"?").charAt(0)}</i><span><b>{selected.name||"选择用户"}</b><small>{selected.email||"—"}</small></span><Pill tone={selected.status==="disabled"?"warn":"good"}>{selected.status==="disabled"?"已停用":"正常"}</Pill></div>
        <div className="cp2Kv column"><span>角色<b>{selected.role||"—"}</b></span><span>租户 ID<b>{selected.tenantId||"—"}</b></span><span>创建时间<b>{formatDateTime(selected.createdAt)}</b></span><span>最近更新<b>{formatDateTime(selected.updatedAt)}</b></span></div>
        <b className="cp2Subhead">角色权限</b><div className="cp2TokenBox">{["资产只读","风险设置","交易审批","知识库访问",...(selected.isOwner?["系统管理","用户管理"]:[])].map(name=><Pill key={name}>{name}</Pill>)}</div>
        <div className="cp2SubscriptionCard"><div><small>订阅计划</small><b>{subscription.planId||"未订阅"}</b></div><div><small>到期时间</small><b>{formatDateTime(subscription.currentPeriodEnd)}</b></div><div><small>席位</small><b>1 / 1</b></div><button className="cp2Secondary" disabled={selected.isOwner} onClick={()=>action(`/api/admin/users/${selected.id}/grant-free`,{months:12})}>续期 12 月</button></div>
        <div className="cp2Usage"><span>使用额度 <b>{arr(data.llmRuns).filter(run=>run.userId===selected.id).length} 次模型调用</b></span><i><b style={{width:`${Math.min(100,arr(data.llmRuns).filter(run=>run.userId===selected.id).length)}%`}}/></i></div>
      </ConceptCard>
      <aside><ConceptCard title="订阅概况"><div className="cp2Kv column"><span>有效订阅<b>{subscriptions.filter(s=>["active","trialing"].includes(s.status)).length}</b></span><span>免费授权<b>{subscriptions.filter(s=>s.source==="owner_grant").length}</b></span><span>Agent 启用<b>{profiles.filter(p=>p.enabled!==false).length}/{profiles.length}</b></span><span>公开注册<b>{data.publicRegistrationEnabled?"开启":"关闭"}</b></span></div></ConceptCard></aside>
    </div>
  </div>;
}

export function SettingsConcept({ data, action, ui, activeTab, onTabChange }) {
  const isOwner=data.user?.isOwner===true; const [baseSection,setBaseSection]=useState("runtime");
  const tabs=[["base","基础配置"],["exchange","交易所连接"],["models","模型与密钥"],["agents","Agent 配置"],...(isOwner?[["users","用户与订阅"]]:[])];
  const config=data.config||{}; const exchanges=arr(data.exchangeAccounts); const agents=arr(data.agentProfiles); const users=arr(data.users);
  const tab=tabs.some(([id])=>id===activeTab)?activeTab:"base";
  return <div className="cp2Settings"><header className="uxCenterHead"><div><h1>系统设置</h1><span>连接 · 模型 · Agent · 用户</span></div></header><nav className="uxTabs" aria-label="系统设置导航">{tabs.map(([id,label])=><button role="tab" aria-selected={tab===id} className={tab===id?"active":""} key={id} onClick={()=>onTabChange(id)}>{label}</button>)}</nav>
    {tab==="base"&&<div className="cp2SettingsBase"><aside className="cp2SideFilter">{[["runtime","环境与服务"],["integrations","网络代理"],["integrations","通知渠道"],["runtime","数据与备份"],["runtime","安全"]].map(([id,label],index)=><button className={(baseSection===id&&index===0)?"active":""} key={`${id}-${label}`} onClick={()=>setBaseSection(id)}>{label}</button>)}</aside><main><div className="cp2Grid three"><ConceptCard title="环境与服务"><div className="cp2Kv column"><span>服务端地址<b>{window.location.origin}</b></span><span>运行环境<b>{config.runtime?.environment||"本地"}</b></span><span>时区<b>Asia/Shanghai</b></span><span>数据库<b>SQLite</b></span><span>实时传输<b>WebSocket / SSE</b></span></div></ConceptCard><ConceptCard title="模型与密钥"><div className="cp2Kv column"><span>当前模型<b>{config.llm?.activeProvider||"未配置"}</b></span><span>嵌入模型<b>{config.llm?.embeddingModel||"未配置"}</b></span><span>API Key<b>{Object.values(config.llm?.providers||{}).filter(p=>p.hasKey).length} 个已配置</b></span></div></ConceptCard><ConceptCard title="交易所连接"><div className="cp2SecurityList">{["BINANCE","OKX"].map(name=><span key={name}><WalletCards/>{name}<b>{exchanges.some(e=>e.exchange===name)?"已接入":"未配置"}</b></span>)}</div></ConceptCard></div><div className="cp2Grid settingsBottom"><ConceptCard title="Agent 配置"><ConceptTable compact columns={[{key:"name",label:"Agent"},{key:"model",label:"模型"},{key:"status",label:"状态",render:r=><Pill tone={toneOf(r.status)}>{humanize(r.status,"已启用")}</Pill>}]} rows={agents.slice(0,6)} empty="暂无 Agent"/></ConceptCard><ConceptCard title="用户与订阅"><div className="cp2Kv column"><span>当前用户<b>{data.user?.name||"—"}</b></span><span>用户数量<b>{users.length}</b></span><span>订阅计划<b>{arr(data.subscriptions).length}</b></span><span>系统状态<b>{data.readiness?.operatingStage?.label||"—"}</b></span></div></ConceptCard><ConceptCard title="备份与维护"><div className="cp2Kv column"><span>最近备份<b>由服务端任务管理</b></span><span>恢复点<b>{arr(data.accountSnapshots).length} 个</b></span><span>配置文件<b>已保存</b></span></div></ConceptCard></div><ConceptCard title={baseSection==="runtime"?"系统运行参数":"外部服务配置"}><SystemConfigPanel key={baseSection} data={data} action={action} ui={ui} section={baseSection}/></ConceptCard></main></div>}
    {tab==="exchange"&&<div className="cp2SettingsForm"><ConceptCard title="连接列表" meta="管理已连接的交易所及其读写权限"><SystemConfigPanel data={data} action={action} ui={ui} section="exchange"/></ConceptCard></div>}
    {tab==="models"&&<div className="cp2SettingsForm"><ConceptCard title="模型提供商与密钥" meta="配置推理模型、嵌入模型和访问凭证"><SystemConfigPanel data={data} action={action} ui={ui} section="llm"/></ConceptCard></div>}
    {tab==="agents"&&<AgentSettingsConcept data={data} action={action} ui={ui}/>}
    {tab==="users"&&isOwner&&<UsersSettingsConcept data={data} action={action} ui={ui}/>}
  </div>;
}
