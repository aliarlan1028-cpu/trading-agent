import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpen,
  BrainCircuit,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Database,
  Eye,
  FileText,
  Gauge,
  GitBranch,
  Globe2,
  Hourglass,
  KeyRound,
  Layers,
  LineChart,
  ListChecks,
  Lock,
  PlugZap,
  Plus,
  RefreshCw,
  Pencil,
  Rocket,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  SquareActivity,
  Target,
  Timer,
  TrendingUp,
  UserCog,
  WalletCards,
  UserPlus,
  Gift,
  Crown,
  X,
  Zap
} from "lucide-react";
import { pageCopy, formatMoney, displayMoney, displayPrice, displayPct, pct, asArray, safeList, readFileAsDataUrl, formatDateTime, formatDate, formatTime, formatDuration, orderStatus, humanize, humanizeList, humanizePhase, shortId, statusTone, compactAction, systemStatus, exchangeState, useApi, PageHeader, Card, SectionTitle, MetricCard, MiniSparkline, CandleChart, TradingViewChart, LinePriceChart, StatusBadge, ProgressBar, DataTable, RiskLine, MiniChart, SemiGauge, InsightNote, SymbolChips } from "./lib.jsx";

// 驾驶舱：仪表盘（总览）+ 复盘 合并为一个导航页，用子标签切换，共享同一页头。
export function CockpitPage({ data, action, ui, cockpitTab = "overview", setCockpitTab }) {
  return (
    <div className="pageStack">
      <div className="cockpitHead">
        <PageHeader active="cockpit" />
        <div className="settingsSubNav cockpitTabs" role="tablist" aria-label="驾驶舱导航">
          <button type="button" role="tab" aria-selected={cockpitTab === "overview"} className={cockpitTab === "overview" ? "active" : ""} onClick={() => setCockpitTab("overview")}>
            <Gauge size={15} /> 总览
          </button>
          <button type="button" role="tab" aria-selected={cockpitTab === "review"} className={cockpitTab === "review" ? "active" : ""} onClick={() => setCockpitTab("review")}>
            <ClipboardList size={15} /> 复盘
          </button>
        </div>
      </div>
      {cockpitTab === "review"
        ? <ReviewPage data={data} action={action} ui={ui} embedded />
        : <MarketAccountPage data={data} action={action} ui={ui} embedded />}
    </div>
  );
}

// Terminal 页头：H1 + 英文代号 + 副标题 + 右侧动作。
function TermHead({ title, code, sub, right }) {
  return (
    <div className="termHead">
      <div className="termHeadMain">
        <h1>{title} <span className="termCode">{code}</span></h1>
        {sub && <p>{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function MarketAccountPage({ data, action, ui, embedded = false }) {
  const [pnlWindow, setPnlWindow] = useState("本月");
  const [symbolSel, setSymbolSel] = useState(null);
  const [tf, setTf] = useState("1H");
  const [ordTab, setOrdTab] = useState("open");
  const [addOpen, setAddOpen] = useState(false);
  const [instruments, setInstruments] = useState([]);
  const [instrQuery, setInstrQuery] = useState("");
  const marketList = (data.markets || []).filter((m) => m && m.symbol);
  const watchlist = (data.watchlist && data.watchlist.length) ? data.watchlist : ["BTC/USDT", "ETH/USDT", "SOL/USDT"];
  const activeSymbol = symbolSel || (marketList.find((m) => m.symbol === symbolSel)?.symbol) || watchlist[0] || "BTC/USDT";
  const market = marketList.find((m) => m.symbol === activeSymbol) || { symbol: activeSymbol, candles: [] };
  const tvInterval = { "1m": "1", "15m": "15", "1H": "60", "4H": "240", "1D": "D" }[tf] || "60";
  useEffect(() => {
    if (addOpen && !instruments.length) {
      Promise.resolve(action("/api/market/instruments", {}, "GET")).then((r) => setInstruments(r?.instruments || [])).catch(() => {});
    }
  }, [addOpen]);
  async function addWatch(sym) { await action("/api/watchlist", { symbol: sym }); setAddOpen(false); setInstrQuery(""); setSymbolSel(sym); }
  async function removeWatch(sym) { await action(`/api/watchlist/${encodeURIComponent(sym)}`, {}, "DELETE"); if (activeSymbol === sym) setSymbolSel(null); }
  const pr = data.portfolioRisk || { portfolioVolPct: null, positions: [], correlations: [] };
  const latestReconcile = data.reconciliationReports?.[0];
  const latestSnapshot = data.accountSnapshots?.[0];
  const configuredAccounts = (data.exchangeAccounts || []).filter((account) => account.readEnabled).length;
  const totalAccounts = data.exchangeAccounts?.length || 0;
  const hasAccountData = latestSnapshot || data.portfolio.totalEquityUsdt !== null && data.portfolio.totalEquityUsdt !== undefined;
  const availableMargin = hasAccountData ? (data.portfolio.availableMarginUsdt ?? data.portfolio.availableMargin ?? 0) : null;
  const usedMargin = hasAccountData ? Math.max(0, Number(data.portfolio.totalEquityUsdt || 0) - Number(availableMargin || 0)) : null;
  const marginRate = data.portfolio.totalEquityUsdt ? (usedMargin / Math.max(1, data.portfolio.totalEquityUsdt)) * 100 : null;
  const performance = data.performance || {};
  const monthlyPnl = pnlWindow === "本月" ? performance.totalPnlUsdt : performance.totalPnlUsdt;
  const openExecutions = performance.openExecutions || (data.executionOrders || []).filter((item) => !["filled", "closed", "cancelled", "rejected"].includes(String(item.status || "").toLowerCase())).length;
  const riskChecks = data.riskChecks || [];
  const blockedChecks = riskChecks.filter((item) => ["blocked", "rejected", "risk_rejected"].includes(String(item.decision || item.result || item.status || "").toLowerCase())).length;
  const accountHealthRows = [
    ["交易所账户", `${configuredAccounts} / ${totalAccounts}`, configuredAccounts ? "ok" : "warning"],
    ["私有账户快照", latestSnapshot ? formatDateTime(latestSnapshot.createdAt) : "未同步", latestSnapshot ? "ok" : "warning"],
    ["对账状态", configuredAccounts ? humanize(latestReconcile?.status, "未对账") : "待配置", latestReconcile?.status === "ok" ? "ok" : "warning"],
    ["实盘写入", data.system?.liveTradingEnabled ? "开启" : "关闭", data.system?.liveTradingEnabled ? "danger" : "warning"],
    ["在途执行", `${openExecutions} 个`, openExecutions ? "warning" : "ok"],
    ["近期风控阻断", `${blockedChecks} 次`, blockedChecks ? "warning" : "ok"]
  ];
  // 收益质量只做一行摘要 + 去复盘入口，胜率/盈亏比的完整拆解由复盘页承载，避免与复盘重复展示。
  const qualityRows = [
    ["交易样本", performance.trades ? `${performance.trades} 笔已平仓 · 胜率 ${performance.winRatePct}% · 盈亏比 ${performance.profitFactor ?? "-"}` : "暂无已平仓交易，完成闭环后到复盘拆解"],
    ["最大回撤", data.portfolio.maxDrawdownPct !== null && data.portfolio.maxDrawdownPct !== undefined ? displayPct(-Math.abs(Number(data.portfolio.maxDrawdownPct))) : "未同步"],
    ["月交易次数", data.portfolio.monthlyTrades !== null && data.portfolio.monthlyTrades !== undefined ? `${data.portfolio.monthlyTrades} / ${data.portfolio.monthlyTradeLimit || "不限"}` : "未设置"],
    ["风险等级", data.portfolio.riskLabel || "未同步"]
  ];
  const actionItems = [
    configuredAccounts ? "运行一次手动对账，确认账户快照与交易所一致。" : "先在系统设置中添加只读交易所 API。",
    performance.trades ? "按策略、品种、时段拆分胜率和盈亏比，定位优势场景。" : "完成真实或模拟闭环后，累计可复盘交易样本。",
    blockedChecks ? "查看被风控阻断的计划，调整授权边界或策略参数。" : "保持当前硬风控，通过小额灰度累积样本。",
    openExecutions ? "检查在途执行单是否需要撤单、改价或转入只减仓。" : "当前没有在途执行压力。"
  ];

  const regime = data.marketRegime || {};
  const gm = regime.global || {};
  const sm = regime.smartMoney || {};
  const hasRegime = gm.ok || sm.ok;

  const configured = configuredAccounts > 0;
  const stripCells = [
    { label: "总资产 USDT", value: displayMoney(data.portfolio.totalEquityUsdt), sub: latestSnapshot ? `快照 ${formatDateTime(latestSnapshot.createdAt)}` : "同步后显示" },
    { label: "今日盈亏", value: configured ? displayMoney(data.portfolio.todayPnl) : "未同步", sub: configured ? displayPct(data.portfolio.todayPnlPct) : "接入后同步", tone: configured ? (Number(data.portfolio.todayPnl || 0) >= 0 ? "positive" : "negative") : "" },
    { label: "未实现盈亏", value: configured ? displayMoney(data.portfolio.weekPnl) : "未同步", sub: configured ? displayPct(data.portfolio.weekPnlPct) : "接入后同步", tone: configured ? (Number(data.portfolio.weekPnl || 0) >= 0 ? "positive" : "negative") : "" },
    { label: `累计盈亏·${pnlWindow}`, value: displayMoney(monthlyPnl), sub: `${performance.trades || 0} 笔已平仓`, tone: Number(monthlyPnl || 0) >= 0 ? "positive" : "warning" },
    { label: "可用保证金", value: displayMoney(availableMargin), sub: `占用 ${displayMoney(usedMargin)}` },
    { label: "保证金率", hint: "账户净值与已用保证金的比值。越高越安全；接近 100% 表示几乎没用杠杆，偏低则爆仓风险上升。", value: marginRate === null ? "未同步" : `${formatMoney(marginRate, 1)}%` },
    { label: "对账", value: configured ? humanize(latestReconcile?.status, "未对账") : "待配置", tone: latestReconcile?.status === "ok" ? "positive" : "warning", onClick: () => configured ? action("/api/reconciler/run", { mode: "manual_ui" }) : ui.setActive("systemSettings") }
  ];

  // 系统结论（顶部大卡）：由风控/熔断/持仓/阻断次数派生。
  const sys = data.system || {};
  const conclusion = sys.killSwitch ? { label: "已熔断", tone: "danger" }
    : sys.autonomyEnabled === false ? { label: "人工暂停", tone: "warning" }
      : blockedChecks > 0 ? { label: "降级运行（风险可控）", tone: "warning" }
        : configured ? { label: "正常运行", tone: "positive" } : { label: "待接入交易所", tone: "warning" };
  const riskLabel = /高|中|低/.test(data.portfolio?.riskLabel || "") ? data.portfolio.riskLabel : (sys.killSwitch ? "高风险" : blockedChecks > 0 ? "中风险" : "低风险");
  const riskTone = riskLabel.includes("高") ? "danger" : riskLabel.includes("中") ? "warning" : "ok";
  const conclusionReasons = [
    configured ? `今日剩余亏损预算 ${sys.remainingDailyLossUsdt !== null && sys.remainingDailyLossUsdt !== undefined ? `${displayMoney(sys.remainingDailyLossUsdt)} USDT` : "未授权"}` : "尚未连接交易所，当前为占位状态",
    (data.positions || []).length ? `${(data.positions || []).length} 个持仓，关注波动与杠杆` : "当前无持仓，账户承压较低",
    blockedChecks ? `近期风控阻断 ${blockedChecks} 次，已自动降级` : "近期风控检查全部通过"
  ];

  const positions = data.positions || [];
  const posRows = positions.map((p, index) => {
    const isShort = p.direction === "short" || p.direction === "空";
    const pnlNum = Number(p.pnl || 0);
    return {
      id: p.id || `${p.symbol}-${index}`,
      symbol: <span className="posSym">{p.symbol}{p.exchange ? <small>{p.exchange}</small> : null}</span>,
      dir: <span className={isShort ? "negative" : "positive"}>{isShort ? "做空" : "做多"}</span>,
      size: displayMoney(p.size, 4, "-"),
      entry: displayMoney(p.entry, 2, "-"),
      mark: displayMoney(p.mark, 2, "-"),
      pnl: <span className={pnlNum >= 0 ? "positive" : "negative"}>{pnlNum >= 0 ? "+" : ""}{displayMoney(pnlNum, 2, "-")}</span>,
      lev: p.leverage ? `${p.leverage}x` : "-"
    };
  });
  const winTone = performance.winRatePct >= 50 ? "positive" : "warning";
  const cumPnl = Number(performance.totalPnlUsdt || 0);

  // ---- Terminal「市场与账户」派生数据 ----
  const chgPos = Number(market.changePct || 0) >= 0;
  const symbolTabs = marketList.slice(0, 4).map((m) => m.symbol);
  const lastCandle = (market.candles || [])[(market.candles || []).length - 1] || {};
  const ocv = (a, b) => lastCandle[a] ?? lastCandle[b];
  const ohlc = { o: ocv("open", "o"), h: ocv("high", "h"), l: ocv("low", "l"), c: ocv("close", "c") ?? market.price };
  const metrics = [
    { label: "总资产 USDT", value: displayMoney(data.portfolio.totalEquityUsdt), sub: latestSnapshot ? `快照 ${formatTime(latestSnapshot.createdAt)}` : "同步后显示" },
    { label: "可用保证金", value: displayMoney(availableMargin), sub: marginRate === null ? "—" : `可用率 ${formatMoney(100 - marginRate, 1)}%` },
    { label: "今日盈亏", value: (configured && data.portfolio.todayPnl != null) ? `${Number(data.portfolio.todayPnl) >= 0 ? "+" : ""}${displayMoney(data.portfolio.todayPnl, 2)}` : "未同步", sub: configured ? displayPct(data.portfolio.todayPnlPct) : "接入后同步", tone: !configured || data.portfolio.todayPnl == null ? "" : (Number(data.portfolio.todayPnl) >= 0 ? "pos" : "neg") },
    { label: "未实现盈亏", value: (configured && data.portfolio.unrealizedPnl != null) ? `${Number(data.portfolio.unrealizedPnl) >= 0 ? "+" : ""}${displayMoney(data.portfolio.unrealizedPnl, 2)}` : "未同步", sub: configured && data.portfolio.unrealizedPnl != null ? "浮动盈亏" : "接入后同步", tone: !configured || data.portfolio.unrealizedPnl == null ? "" : (Number(data.portfolio.unrealizedPnl) >= 0 ? "pos" : "neg") },
    { label: "对账状态", value: configured ? humanize(latestReconcile?.status, "未对账") : "待配置", tone: latestReconcile?.status === "ok" ? "pos" : "warn", onClick: () => configured ? action("/api/reconciler/run", { mode: "manual_ui" }) : ui.setActive("systemSettings") }
  ];
  const snapRows = [
    ["最新价", displayPrice(market.price), ""],
    ["24h 涨跌", displayPct(market.changePct), chgPos ? "pos" : "neg"],
    ["24h 高 / 低", (market.high24h != null || ohlc.h != null) ? `${displayPrice(market.high24h ?? ohlc.h)} / ${displayPrice(market.low24h ?? ohlc.l)}` : "未同步", ""],
    ["资金费率", market.fundingRate == null ? "未同步" : `${Number(market.fundingRate).toFixed(4)}%`, Number(market.fundingRate) >= 0 ? "pos" : "neg"],
    ["未平仓 OI", market.openInterest ? formatMoney(market.openInterest, 0) : "未同步", ""],
    ["成交量 24h", market.volume24h || (market.volume ? formatMoney(market.volume, 0) : "未同步"), ""],
    ["买盘占比", market.bookImbalancePct == null ? "未同步" : `${market.bookImbalancePct}%`, Number(market.bookImbalancePct) >= 50 ? "pos" : "neg"],
    ["市场状态", gm.interpretation ? "多头趋势" : (market.regime || "观察"), "badge"]
  ];
  const openOrders = (data.orders || data.executionOrders || []).filter((o) => !["closed", "canceled", "cancelled", "filled", "filled_closed", "rejected"].includes(String(o.status || "").toLowerCase()));
  const recentFills = (data.fills || []).slice(0, 6);
  const walletVals = [
    ["总资产", displayMoney(data.portfolio.totalEquityUsdt)],
    ["可用", displayMoney(availableMargin)],
    ["占用", displayMoney(usedMargin)],
    ["冻结", displayMoney(data.portfolio.frozenMarginUsdt ?? 0, 2, "0.00")]
  ];
  const usagePct = marginRate === null ? 0 : Math.min(100, Math.max(0, marginRate));
  const marginTone = usagePct >= 80 ? "neg" : usagePct >= 50 ? "warn" : "pos";
  const marginToneLabel = usagePct >= 80 ? "偏高" : usagePct >= 50 ? "中等" : "健康";
  const donutDash = 2 * Math.PI * 31;
  const donutOffset = donutDash * (1 - usagePct / 100);

  return (
    <div className="pageStack termPage marketPage">
      {!embedded && (
        <div className="termHead">
          <div className="termHeadMain">
            <h1>市场与账户 <span className="termCode">MARKET · ACCOUNT</span></h1>
            <p>实时监控市场行情、持仓与账户余额，掌握整体资金动向</p>
          </div>
          <button className="termRefresh mono" onClick={() => action("/api/market/regime", {}, "GET")}><RefreshCw size={12} /> {formatTime(new Date().toISOString())}</button>
        </div>
      )}

      {/* Row 1 — 指标行 */}
      <div className="metricRow">
        {metrics.map((m) => (
          <div key={m.label} className={`metricCell ${m.onClick ? "clickable" : ""}`} {...(m.onClick ? { role: "button", tabIndex: 0, onClick: m.onClick } : {})}>
            <span className="metricLabel">{m.label}</span>
            <strong className={`metricVal mono ${m.tone || ""}`}>{m.value}</strong>
            <div className="metricSub">
              <span className={m.tone || ""}>{m.sub}</span>
              {m.spark && <MiniSparkline candles={market.candles} />}
            </div>
          </div>
        ))}
      </div>

      {/* Row 2 — 行情 + 市场快照 */}
      <div className="termGrid r2">
        <div className="termCard chartCard">
          <div className="chartHead">
            <div className="wlTabs">
              {watchlist.map((s) => (
                <div key={s} className={`wlTab ${activeSymbol === s ? "active" : ""}`}>
                  <button className="wlTabSel" onClick={() => setSymbolSel(s)}>{s.replace("/USDT", "")}</button>
                  {watchlist.length > 1 && <button className="wlTabDel" title="移除关注" onClick={() => removeWatch(s)}>×</button>}
                </div>
              ))}
              <div className="wlAddWrap">
                <button className="wlAdd" title="添加币对" onClick={() => setAddOpen((v) => !v)}><Plus size={13} /></button>
                {addOpen && (
                  <div className="wlDropdown">
                    <div className="wlSearch"><Search size={13} /><input autoFocus value={instrQuery} onChange={(e) => setInstrQuery(e.target.value)} placeholder="搜索 OKX 永续，如 SUI" /></div>
                    <div className="wlList">
                      {instruments
                        .filter((it) => !watchlist.includes(it.symbol))
                        .filter((it) => !instrQuery.trim() || it.symbol.toLowerCase().includes(instrQuery.trim().toLowerCase()))
                        .slice(0, 40)
                        .map((it) => (
                          <button className="wlOption" key={it.symbol} onClick={() => addWatch(it.symbol)}>
                            <span>{it.symbol}</span>
                            <small>{(it.exchanges || []).join(" · ")}</small>
                          </button>
                        ))}
                      {!instruments.length && <div className="wlEmpty">正在拉取 OKX 合约清单…</div>}
                      {instruments.length > 0 && !instruments.filter((it) => !watchlist.includes(it.symbol) && (!instrQuery.trim() || it.symbol.toLowerCase().includes(instrQuery.trim().toLowerCase()))).length && <div className="wlEmpty">无匹配合约</div>}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="segCtl tf">
              {["1m", "15m", "1H", "4H", "1D"].map((t) => <button key={t} className={tf === t ? "active" : ""} onClick={() => setTf(t)}>{t}</button>)}
            </div>
          </div>
          <div className="priceHead">
            <b className="mono">{displayPrice(market.price)}</b>
            <span className={`priceChg ${chgPos ? "pos" : "neg"} mono`}>{chgPos ? "▲" : "▼"} {displayPct(market.changePct)}</span>
            <span className="ohlcRow mono">{activeSymbol}</span>
          </div>
          <div className="chartBox tv">
            <TradingViewChart symbol={activeSymbol} interval={tvInterval} />
          </div>
        </div>
        <div className="termCard snapCard">
          <div className="secLabel">市场快照</div>
          <div className="snapList">
            {snapRows.map(([k, v, tone]) => (
              <div className="snapRow" key={k}>
                <span>{k}</span>
                {tone === "badge"
                  ? <b className="snapBadge pos">{v}</b>
                  : <b className={`mono ${tone || ""}`}>{v}</b>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Row 3 — 持仓 + 委托/成交 */}
      <div className="termGrid r3">
        <div className="termCard">
          <div className="secLabel">持仓（{positions.length}）</div>
          {positions.length ? (
            <div className="posTable">
              <div className="posHead mono">
                <span>SYMBOL</span><span>SIDE</span><span>QTY</span><span>ENTRY</span><span>MARK</span><span>UPNL</span><span>LEV</span>
              </div>
              {positions.map((p, i) => {
                const short = p.direction === "short" || p.direction === "空";
                const pnlN = Number(p.pnl || 0);
                return (
                  <div className="posRow mono" key={p.id || `${p.symbol}-${i}`}>
                    <span className="posSym">{p.symbol}{p.exchange ? <small>{p.exchange}</small> : null}</span>
                    <span><b className={`sideTag ${short ? "neg" : "pos"}`}>{short ? "做空" : "做多"}</b></span>
                    <span>{displayMoney(p.size, 4, "-")}</span>
                    <span>{displayMoney(p.entry, 2, "-")}</span>
                    <span>{displayMoney(p.mark, 2, "-")}</span>
                    <span className={pnlN >= 0 ? "pos" : "neg"}>{pnlN >= 0 ? "+" : ""}{displayMoney(pnlN, 2, "-")}</span>
                    <span>{p.leverage ? `${p.leverage}x` : "-"}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="emptyPanel">{configured ? "当前没有持仓。" : "先在系统设置连接交易所（只读即可），这里显示你的真实持仓。"}</div>
          )}
        </div>
        <div className="termCard">
          <div className="secLabel ordSwitch">
            <button className={ordTab === "open" ? "active" : ""} onClick={() => setOrdTab("open")}>当前委托 {openOrders.length}</button>
            <button className={ordTab === "fills" ? "active" : ""} onClick={() => setOrdTab("fills")}>最近成交 {recentFills.length}</button>
          </div>
          <div className="ordList">
            {(ordTab === "open" ? openOrders : recentFills).slice(0, 6).map((o, i) => {
              const buy = /buy|long|做多|多/i.test(String(o.side || o.direction || ""));
              return (
                <div className="ordRow mono" key={o.id || i}>
                  <span className="ordSym">{o.symbol}</span>
                  <b className={`sideTag ${buy ? "pos" : "neg"}`}>{buy ? "买" : "卖"}</b>
                  <span className="ordType">{humanize(o.type || o.kind || o.status, "—")}</span>
                  <span className="ordPx">{displayMoney(o.price ?? o.avgPrice ?? o.entry, 2, "—")}</span>
                  <span className="ordTime">{formatTime(o.createdAt)}</span>
                </div>
              );
            })}
            {!(ordTab === "open" ? openOrders : recentFills).length && <div className="emptyPanel">{ordTab === "open" ? "当前无挂单。" : "暂无成交记录。"}</div>}
          </div>
        </div>
      </div>

      {/* Row 4 — 账户余额 / 保证金率 / 强平安全 / 交易所同步 */}
      <div className="termGrid r4">
        <div className="termCard balCard">
          <div className="balLabel">账户余额 USDT</div>
          <div className="balGrid">
            {walletVals.map(([k, v]) => <div key={k}><div className="balK mono">{k}</div><b className="mono">{v}</b></div>)}
          </div>
        </div>
        <div className="termCard donutCard">
          <svg viewBox="0 0 80 80" className="donutSvg">
            <circle cx="40" cy="40" r="31" fill="none" stroke="#EDE7DB" strokeWidth="8" />
            <circle cx="40" cy="40" r="31" fill="none" stroke="#D06A22" strokeWidth="8" strokeLinecap="round" strokeDasharray={donutDash} strokeDashoffset={donutOffset} transform="rotate(-90 40 40)" />
          </svg>
          <div>
            <div className="balLabel">保证金率</div>
            <b className="donutVal mono">{marginRate === null ? "—" : `${formatMoney(usagePct, 1)}%`}</b>
            <div className={`donutRisk ${marginTone}`}>风险 {marginToneLabel}</div>
          </div>
        </div>
        <div className="termCard">
          <div className="balLabel">强平安全</div>
          <div className="liqTop"><span>距强平</span><b className="mono">{marginRate === null ? "—" : `${formatMoney(100 - usagePct, 1)}%`}</b></div>
          <div className="liqBar2"><span className="liqMark2" style={{ left: `${usagePct}%` }} /></div>
          <div className="liqLegend2 mono"><span>SAFE</span><span>WARN</span><span>LIQ</span></div>
        </div>
        <div className="termCard">
          <div className="balLabel">交易所同步</div>
          <div className="exSyncList">
            {(data.exchangeAccounts || []).map((a) => (
              <div className="exSyncRow2" key={a.id}>
                <span>{a.exchange}</span>
                <span className={`exSyncState ${a.readEnabled ? "on" : "off"} mono`}><i />{a.readEnabled ? "synced" : "未配置"}</span>
              </div>
            ))}
            {!(data.exchangeAccounts || []).length && <div className="emptyPanel">未接入交易所</div>}
          </div>
        </div>
      </div>

      {/* 系统监控明细 —— 大盘/聪明钱/波动预算等（折叠，功能保留）*/}
      <details className="cpCard cpDetails cpMoreDetails">
        <summary><span className="cpSummaryTitle"><Eye size={15} /> 系统监控明细（AI 在盯，你平时不用看）</span><ChevronDown size={14} className="cpChevron" /></summary>
        <div className="cockpitGrid">
          <Card className="cpCard">
            <SectionTitle icon={Gauge} title="账户健康" />
            <div className="healthGrid tight">
              {accountHealthRows.map(([label, value, tone]) => <div key={label}><span>{label}</span><strong>{value}</strong><StatusBadge tone={tone}>{tone === "ok" ? "正常" : tone === "danger" ? "高危" : "待处理"}</StatusBadge></div>)}
            </div>
          </Card>

          <Card className="cpCard">
            <SectionTitle icon={Target} title="风险承压" />
            <div className="qualityGrid">
              <RiskLine label="今日亏损预算" value={data.system.remainingDailyLossUsdt === null || data.system.remainingDailyLossUsdt === undefined ? "未授权" : `${displayMoney(data.system.remainingDailyLossUsdt)} USDT`} />
              <RiskLine label="持仓数量" value={`${positions.length} 个`} />
              <RiskLine label="当前委托" value={`${data.orders?.length || 0} 个`} />
              <RiskLine label="系统状态" value={systemStatus(data).label} />
            </div>
          </Card>

          <Card className="cpCard">
            <SectionTitle icon={Activity} title="合约微观结构" action={<button className="iconButton" title="刷新微观结构" onClick={() => action(`/api/exchange/OKX/microstructure?symbol=${encodeURIComponent(market.symbol || "BTC/USDT")}`, {}, "GET")}><RefreshCw size={14} /></button>} />
            <div className="microGrid">
              <div><span className="term" title="永续合约里多头付给空头（或反之）的周期费用。绝对值越大，说明多空越拥挤，反向挤压风险越高。">资金费率</span><strong className={Number(market.fundingRate) >= 0 ? "positive" : "negative"}>{market.fundingRate === null || market.fundingRate === undefined ? "未同步" : `${Number(market.fundingRate).toFixed(4)}%`}</strong></div>
              <div><span className="term" title="未平仓合约的总量（Open Interest）。OI 上升且价格同向，说明趋势有真金白银承接。">未平仓量 OI</span><strong>{market.openInterest ? formatMoney(market.openInterest, 0) : "未同步"}</strong></div>
              <div><span className="term" title="订单簿里买单量占买卖总量的比例。大于 50% 表示买盘占优，小于 50% 卖盘占优。">买盘占比</span><strong className={Number(market.bookImbalancePct) >= 50 ? "positive" : "negative"}>{market.bookImbalancePct === null || market.bookImbalancePct === undefined ? "未同步" : `${market.bookImbalancePct}%`}</strong></div>
              <div><span>24h 涨跌</span><strong className={Number(market.changePct) >= 0 ? "positive" : "negative"}>{displayPct(market.changePct)}</strong></div>
            </div>
          </Card>

          <Card className="cpCard">
            <SectionTitle icon={Globe2} title="大盘与聪明钱" action={<button className="iconButton" title="刷新大盘与聪明钱" onClick={() => action("/api/market/regime", {}, "GET")}><RefreshCw size={14} /></button>} />
            {hasRegime ? (
              <>
                <div className="microGrid">
                  <div><span>BTC 主导率</span><strong>{gm.btcDominancePct != null ? `${gm.btcDominancePct}%` : "未取"}</strong></div>
                  <div><span>总市值 24h</span><strong className={gm.mcap24hChangePct == null ? "" : Number(gm.mcap24hChangePct) >= 0 ? "positive" : "negative"}>{gm.mcap24hChangePct != null ? displayPct(gm.mcap24hChangePct) : "未取"}</strong></div>
                  <div><span>恐惧贪婪</span><strong className={gm.fearGreed == null ? "" : gm.fearGreed.value <= 25 ? "negative" : gm.fearGreed.value >= 75 ? "warning" : ""}>{gm.fearGreed ? `${gm.fearGreed.value} · ${gm.fearGreed.label}` : "未取"}</strong></div>
                  <div><span>大户持仓多空比</span><strong className={sm.topTraderLongShortRatio == null ? "" : sm.topTraderLongShortRatio >= 1 ? "positive" : "negative"}>{sm.topTraderLongShortRatio ?? "未取"}</strong></div>
                  <div><span>散户多空比</span><strong>{sm.retailLongShortRatio ?? "未取"}</strong></div>
                  <div><span>主动买卖比</span><strong className={sm.takerBuySellRatio == null ? "" : sm.takerBuySellRatio >= 1 ? "positive" : "negative"}>{sm.takerBuySellRatio ?? "未取"}</strong></div>
                  <div><span>近期爆仓 多/空</span><strong className={sm.liquidations == null ? "" : sm.liquidations.dominantSide === "short" ? "positive" : sm.liquidations.dominantSide === "long" ? "negative" : ""}>{sm.liquidations ? `${sm.liquidations.longLiqCount} / ${sm.liquidations.shortLiqCount}` : "未取"}</strong></div>
                </div>
                {(gm.interpretation || sm.interpretation) && <p className="regimeReadout">{[gm.interpretation, sm.ok ? sm.interpretation : null].filter(Boolean).join("；")}</p>}
              </>
            ) : (
              <div className="emptyPanel">点右上角刷新：拉取 BTC 主导率、总市值趋势、恐惧贪婪与大户/散户多空比，让 Agent 先判大盘再看个币。</div>
            )}
          </Card>

          <Card className="cpCard">
            <SectionTitle icon={Gauge} title="组合波动预算" />
            {pr.portfolioVolPct !== null && pr.portfolioVolPct !== undefined ? (
              <>
                <div className="microGrid">
                  <div><span>组合日波动</span><strong>{pr.portfolioVolPct}%</strong></div>
                  <div><span>波动预算</span><strong>{pr.budgetPct}%</strong></div>
                  <div><span>预算使用</span><strong className={pr.utilizationPct > 100 ? "negative" : pr.utilizationPct > 80 ? "warning" : "positive"}>{pr.utilizationPct}%</strong></div>
                  <div><span>持仓数</span><strong>{pr.positions.length}</strong></div>
                </div>
                <ProgressBar value={Math.min(100, pr.utilizationPct || 0)} tone={pr.utilizationPct > 100 ? "red" : "blue"} />
              </>
            ) : (
              <div className="emptyPanel">{pr.status === "no_equity" ? "同步私有账户净值后，按组合波动预算给每个仓位定量。" : "暂无持仓；开仓后显示组合波动与预算使用。"}</div>
            )}
          </Card>

          <Card className="cpCard">
            <SectionTitle icon={ListChecks} title="建议下一步动作" />
            <div className="actionList">{actionItems.map((item, index) => <div key={item}><b>{index + 1}</b><span>{item}</span></div>)}</div>
          </Card>
        </div>
      </details>
    </div>
  );
}

export function EventsTasksPage({ data, action, ui, embedded = false, mode = "all" }) {
  const showEvents = mode === "all" || mode === "events";
  const showTasks = mode === "all" || mode === "tasks";
  const events = data.events || [];
  const tasks = data.tasks || [];
  const [selectedEventId, setSelectedEventId] = useState("");
  const [taskFilter, setTaskFilter] = useState("全部");
  const eventRows = events.reduce((acc, event) => {
    const key = `${event.title}:${event.category}`;
    if (!acc.some((item) => `${item.title}:${item.category}` === key)) acc.push(event);
    return acc;
  }, []).slice(0, 5);
  const primaryEvent = eventRows.find((event) => event.id === selectedEventId) || eventRows[0] || events[0] || {};
  const filteredTasks = taskFilter === "全部" ? tasks : tasks.filter((task) => task.type === taskFilter);
  const eventRuleTemplates = [
    { name: "高影响事件前停止开仓", scope: "event", level: "L1", action: "pause_opening", event: "宏观事件（影响 ≥ 80）", condition: "事件前 30 分钟", description: "重大宏观事件公布前 30 分钟暂停新开仓，事件落地后人工确认恢复" },
    { name: "资金费率异常告警", scope: "event", level: "L2", action: "notify", event: "资金费率", condition: "|费率| > 0.1% / 8h", description: "永续合约资金费率绝对值超过 0.1% 时推送告警，提示极端多空失衡" },
    { name: "交易所大额流入告警", scope: "event", level: "L2", action: "notify", event: "链上事件", condition: "单笔 > 5000 BTC 流入交易所", description: "监测到大额 BTC 流入交易所地址时告警，提示潜在抛压" }
  ];
  const eventRuleRows = (data.riskRules || []).filter((rule) => rule.scope === "event").map((rule) => ({
    id: rule.id,
    rule: rule.name,
    event: rule.event || "事件条件",
    condition: rule.condition || rule.description || "-",
    action: humanize(rule.action),
    status: <StatusBadge tone={rule.enabled === false ? "warning" : "ok"}>{rule.enabled === false ? "已停用" : "启用"}</StatusBadge>,
    op: <button className="linkCell" onClick={() => ui.openPanel("riskRules")}>管理</button>
  }));
  const taskTabs = [
    ["全部", tasks.length],
    ["Cron", tasks.filter((task) => task.type === "Cron").length],
    ["Every", tasks.filter((task) => task.type === "Every").length],
    ["At", tasks.filter((task) => task.type === "At").length]
  ];
  const dueTs = primaryEvent.due ? new Date(primaryEvent.due).getTime() : null;
  const cdDiff = dueTs ? dueTs - Date.now() : null;
  const cd = cdDiff && cdDiff > 0 ? { d: Math.floor(cdDiff / 86400000), h: Math.floor((cdDiff % 86400000) / 3600000), m: Math.floor((cdDiff % 3600000) / 60000) } : null;
  const jobRuns = data.jobRuns || [];
  const impactTone = (im) => im >= 80 ? "neg" : im >= 50 ? "warn" : "";
  return (
    <div className="pageStack termPage eventsPage">
      {!embedded && (
        <div className="termHead">
          <div className="termHeadMain">
            <h1>事件与任务 <span className="termCode">EVENTS · TASKS</span></h1>
            <p>宏观与链上事件雷达、焦点事件倒计时，以及定时任务的调度与运行日志</p>
          </div>
          <button className="termRefresh mono" onClick={() => action("/api/event-sources/refresh", {})}><RefreshCw size={12} /> 刷新事件源</button>
        </div>
      )}
      <div className="termGrid evTop">
        {showEvents && (
        <div className="termCard">
          <div className="evCardHead"><Target size={15} className="evHeadIcon" /> 重要事件雷达</div>
          <div className="termDateStrip">{eventRows.map((event, index) => <button className={(selectedEventId ? selectedEventId === event.id : index === 0) ? "active" : ""} key={event.id} onClick={() => setSelectedEventId(event.id)}><b className="mono">{formatDate(event.due, "待定")}</b><span>{event.category}</span></button>)}</div>
          {!eventRows.length && <div className="emptyPanel emptyPanelAction"><strong>暂无真实事件卡</strong><button className="secondaryButton" onClick={() => action("/api/event-sources/refresh", {})}><RefreshCw size={14} /> 刷新事件源</button></div>}
          <div className="evTimeline">
            {eventRows.map((event) => (
              <button className={`evItem ${(selectedEventId ? selectedEventId === event.id : eventRows[0]?.id === event.id) ? "on" : ""}`} key={event.id} title={event.rawTitle || event.title} onClick={() => setSelectedEventId(event.id)}>
                <span className="evTime mono">{formatDateTime(event.due, "待定")}</span>
                <span className="evTitle">{event.shortTitle || event.title}</span>
                <b className={`evBadge ${impactTone(event.impact)}`}>{event.impactLabel || "中影响"}</b>
                <b className="evCat">{event.category}</b>
              </button>
            ))}
          </div>
        </div>
        )}

        {showEvents && (
        <div className="termCard focusCard">
          <div className="focusTop">
            <span className="focusName">{primaryEvent.shortTitle || primaryEvent.title || "暂无焦点事件"} <b className={`evBadge ${impactTone(primaryEvent.impact)}`}>{primaryEvent.impactLabel || "待评估"}</b></span>
            <button className="agLink" onClick={() => ui.openPanel("eventSources")}>事件详情 ›</button>
          </div>
          <div className="focusSub">{primaryEvent.due ? `预计发布 ${formatDateTime(primaryEvent.due)} · 倒计时` : "待定发布时间"}</div>
          <div className="cd3">
            {cd
              ? <>
                  <div className="cd3b"><b className="mono">{String(cd.d).padStart(2, "0")}</b><span>天</span></div>
                  <div className="cd3b"><b className="mono">{String(cd.h).padStart(2, "0")}</b><span>时</span></div>
                  <div className="cd3b hot"><b className="mono">{String(cd.m).padStart(2, "0")}</b><span>分</span></div>
                </>
              : <div className="cd3b full"><b className="mono">{formatDateTime(primaryEvent.due, "待定")}</b><span>待发布</span></div>}
          </div>
          <div className="focusMetrics">
            <div><span>影响等级</span><b className={`sg ${impactTone(primaryEvent.impact)}`}>{primaryEvent.impactLabel || "待评估"}</b></div>
            <div><span>市场敏感度</span><b className="mono">{primaryEvent.impact ? `${(Number(primaryEvent.impact) / 10).toFixed(1)}/10` : "—"}</b></div>
            <div><span>置信度</span><b className="mono pos">{primaryEvent.confidence ? `${primaryEvent.confidence}%` : "—"}</b></div>
          </div>
          {(primaryEvent.relatedSymbols || []).length > 0 && <div className="assetChips">{(primaryEvent.relatedSymbols || []).map((symbol) => <span key={symbol}>{symbol}</span>)}</div>}
          <p className="focusAdvice">{primaryEvent.action || "暂无事件建议；刷新真实事件源后显示。"}</p>
        </div>
        )}
      </div>

      <div className="termGrid evBot">
        {showTasks && (
        <div className="termCard">
          <div className="evCardHead spread"><span><Timer size={15} className="evHeadIcon" /> 定时任务</span><button className="termMiniBtn dark" onClick={() => ui.openPanel("taskManager")}><Plus size={13} /> 新建任务</button></div>
          <div className="ordSwitch taskFilterRow">{taskTabs.map(([name, count]) => <button className={taskFilter === name ? "active" : ""} key={name} onClick={() => setTaskFilter(name)}>{name} {count}</button>)}</div>
          <div className="taskList">
            <div className="taskRowHead mono"><span>任务</span><span>触发</span><span>下次</span><span>状态</span><span>操作</span></div>
            {filteredTasks.slice(0, 6).map((task) => (
              <div className="taskRow" key={task.id}>
                <span className="taskName">{task.name}</span>
                <span className="mono taskSched">{task.schedule || "Every 1h"}</span>
                <span className="mono taskNext">{formatDateTime(task.nextRunAt, task.nextRun || "-")}</span>
                <span><b className={`evBadge ${task.enabled === false ? "warn" : "ok"}`}>{humanize(task.status || (task.enabled === false ? "已暂停" : "运行"))}</b></span>
                <span className="rowActions"><button className="linkCell" onClick={() => action(`/api/tasks/${task.id}/run`, {})}>运行</button><button className="linkCell" onClick={() => action(`/api/tasks/${task.id}/${task.enabled === false ? "resume" : "pause"}`, task.enabled === false ? {} : { reason: "manual_ui" })}>{task.enabled === false ? "恢复" : "暂停"}</button></span>
              </div>
            ))}
            {!filteredTasks.length && <div className="emptyPanel">暂无定时任务。</div>}
          </div>
        </div>
        )}
        {showTasks && (
        <div className="termCard">
          <div className="evCardHead spread"><span><ClipboardList size={15} className="evHeadIcon" /> 任务运行日志</span><button className="agLink" onClick={() => ui.setActive("auditSystem")}>全部日志 ›</button></div>
          <div className="logList">
            {jobRuns.slice(0, 8).map((run) => {
              const ok = String(run.status || "").toLowerCase() === "ok";
              const bad = ["failed", "error"].includes(String(run.status || "").toLowerCase());
              return (
                <div className="logRow" key={run.id}>
                  <span className="logTime mono">{formatTime(run.createdAt)}</span>
                  <span className={`logDot ${ok ? "ok" : bad ? "bad" : "warn"}`} />
                  <span className="logName">{run.name || humanize(run.handler || run.taskName, "任务")}</span>
                  <b className={`evBadge ${ok ? "ok" : bad ? "neg" : "warn"}`}>{ok ? "成功" : bad ? "失败" : humanize(run.status, "触发")}</b>
                  <span className="logDetail mono">{typeof run.output === "string" ? run.output.slice(0, 40) : (run.summary || "")}</span>
                </div>
              );
            })}
            {!jobRuns.length && <div className="emptyPanel">暂无运行记录。</div>}
          </div>
        </div>
        )}
      </div>

      {showEvents && (
      <details className="cpCard cpDetails cpMoreDetails">
        <summary><span className="cpSummaryTitle"><GitBranch size={15} /> 事件规则（触发时自动执行动作）</span><ChevronDown size={14} className="cpChevron" /></summary>
        <div className="detailsBody">
          <div className="secLabel taskHead" style={{ marginBottom: 8 }}>事件规则<button className="termMiniBtn" onClick={() => ui.openPanel("eventRule")}><Plus size={13} /> 新建规则</button></div>
          {!eventRuleRows.length ? (
            <div className="emptyPanel emptyPanelGuide">
              <strong>还没有事件规则</strong>
              <small>规则会在事件触发时自动执行动作（告警 / 暂停开仓）。从模板一键创建：</small>
              <div className="templateChips">
                {eventRuleTemplates.map((template) => <button key={template.name} onClick={() => action("/api/risk/rules", template)}>{template.name}</button>)}
              </div>
            </div>
          ) : (
            <DataTable columns={[
              { key: "rule", label: "规则名称" }, { key: "event", label: "触发事件" }, { key: "condition", label: "触发条件" }, { key: "action", label: "执行动作" }, { key: "status", label: "状态" }, { key: "op", label: "操作" }
            ]} rows={eventRuleRows} />
          )}
        </div>
      </details>
      )}
    </div>
  );
}

export function latestAnalysisRows(data) {
  const bundle = data.analysisBundles?.[0];
  if (!bundle) return [];
  const views = (bundle.expertViews || []).map((view, index) => ({
    id: `${bundle.id || "analysis"}:${index}`,
    name: view.domain || "分析视角",
    type: "分析",
    quote: view.view || bundle.summary || "-",
    confidence: view.confidence ? `${Math.round(view.confidence * 100)}%` : "-",
    source: bundle.id || "本次运行"
  }));
  const citations = (bundle.citations || []).map((citation) => ({
    id: `citation:${citation}`,
    name: citation,
    type: "引用",
    quote: "来自真实导入知识库的引用标识",
    confidence: "-",
    source: bundle.id || "本次运行"
  }));
  return [...views, ...citations].slice(0, 6);
}

export function KnowledgeSkillsPage({ data, action, ui, embedded = false }) {
  const [ruleTab, setRuleTab] = useState("graph");
  const [rag, setRag] = useState("");
  const knowledge = data.knowledge || {};
  const sourceCount = knowledge.sources?.length || 0;
  const conceptCount = knowledge.conceptCards?.length || 0;
  const ruleCount = knowledge.ruleProposals?.length || 0;
  const chunkCount = knowledge.chunks?.length || 0;
  const skills = data.skills || [];
  const enabledSkills = skills.filter((skill) => skill.status === "已启用").length;
  const mcp = data.mcpServers || [];
  const mcpConnected = mcp.filter((item) => item.status === "connected").length;
  const embed = data.embeddingStatus || { mode: "lexical" };
  const cites = latestAnalysisRows(data) || [];
  const stats = [
    { Icon: BookOpen, bg: "#EAF0FB", color: "#2A6FDB", label: "知识文档", value: sourceCount, sub: `${chunkCount} 片段` },
    { Icon: Settings, bg: "#E6F1EA", color: "#1F7A50", label: "专家规则", value: ruleCount, sub: "已抽取" },
    { Icon: Sparkles, bg: "#F0EAFB", color: "#7A4FD0", label: "已安装技能", value: enabledSkills, sub: `共 ${skills.length}` },
    { Icon: RefreshCw, bg: "#FBEDDF", color: "#D06A22", label: "检索模式", text: embed.mode === "semantic" ? "语义向量" : "词频匹配" }
  ];
  return (
    <div className="pageStack termPage knowPage">
      {!embedded && <TermHead title="知识与技能" code="KNOWLEDGE · SKILLS" sub="喂知识、装技能、接工具，让 AI 交易员持续变强" />}

      <div className="kStatRow">
        {stats.map((s) => (
          <div className="kStat" key={s.label}>
            <span className="kStatIcon" style={{ background: s.bg, color: s.color }}><s.Icon size={18} /></span>
            <div>
              <div className="kStatK">{s.label}</div>
              {s.text ? <div className="kStatText">{s.text}</div> : <div className="kStatV mono">{s.value}</div>}
              {s.sub && !s.text && <div className="kStatS">{s.sub}</div>}
            </div>
          </div>
        ))}
      </div>

      {(knowledge.strategyHypotheses || []).length > 0 && (
        <div className="termCard hypoCard">
          <div className="kHead"><span className="secLabel">策略假设 · 来自书籍，回测通过才可实盘</span><span className="hypoLegend mono">{(knowledge.strategyHypotheses || []).filter((h) => h.status === "已验证").length} 已验证 / {(knowledge.strategyHypotheses || []).length} 条</span></div>
          <div className="hypoList">
            {(knowledge.strategyHypotheses || []).slice(0, 10).map((h) => (
              <div className={`hypoRow ${h.status === "已验证" ? "ok" : (h.status === "未通过" || h.status === "回测失败") ? "bad" : ""}`} key={h.id}>
                <div className="hypoMain">
                  <div className="hypoTop"><b>{h.name}</b><span className="hypoTag">{humanize(h.kind)}</span><span className="hypoTf mono">{h.symbolScope} · {h.timeframe} · {h.direction}</span></div>
                  <div className="hypoCond mono">入 {h.entry || "-"} ｜ 损 {h.stop || "-"} ｜ 盈 {h.takeProfit || "-"}</div>
                  {h.backtest && h.backtest.expectancyR != null && <div className="hypoBt mono">回测：{h.backtest.trades} 笔 · 胜率 {h.backtest.winRatePct}% · 期望 {h.backtest.expectancyR}R · 盈亏比 {h.backtest.profitFactor ?? "-"}（近似）</div>}
                </div>
                <div className="hypoRight">
                  <StatusBadge tone={h.status === "已验证" ? "ok" : h.status === "待回测" ? "warning" : "neutral"}>{h.status}</StatusBadge>
                  <button className="miniBtn" onClick={() => action(`/api/knowledge/hypotheses/${h.id}/backtest`, {})}><BarChart3 size={13} /> 回测</button>
                </div>
              </div>
            ))}
          </div>
          <div className="hypoNote">书里的 setup 只是假设，未经样本外回测不会用于实盘。回测用最接近的内置策略近似验证其方向/周期是否有历史边际。</div>
        </div>
      )}

      <div className="kGrid3">
        <div className="termCard">
          <div className="kHead"><span className="secLabel">专家知识库</span><button className="agLink" onClick={() => ui.openPanel("knowledgeList")}>全部知识 ›</button></div>
          <div className="kbList">
            {(knowledge.sources || []).slice(0, 6).map((s) => (
              <button className="kbRow" key={s.id} onClick={() => ui.openPanel("knowledgeList")}>
                <span className="kbIcon"><Globe2 size={15} /></span>
                <div className="kbInfo"><b>{s.domain || s.type || "知识"}</b><div>{s.title}</div></div>
                <b className="mono kbCount">{humanize(s.status)}</b>
              </button>
            ))}
            {!sourceCount && <div className="emptyPanel">暂无知识来源，导入书籍/网页/PDF 后可检索</div>}
          </div>
          <button className="kImportBtn" onClick={() => ui.openPanel("knowledgeImport")}><Plus size={15} /> 导入知识</button>
        </div>

        <div className="termCard">
          <div className="kHead"><div className="kSeg"><button className={ruleTab === "graph" ? "on" : ""} onClick={() => setRuleTab("graph")}>概念图谱</button><button className={ruleTab === "rules" ? "on" : ""} onClick={() => setRuleTab("rules")}>规则库</button></div><button className="agLink" onClick={() => ui.openPanel("ruleLibrary")}>全部规则 ›</button></div>
          <div className="kGraph"><div className="kHub"><b>知识图谱</b><small>{conceptCount} 概念 · {ruleCount} 规则</small></div>{(knowledge.conceptCards || []).slice(0, 6).map((c, i) => <span className={`kNode ${i < 2 ? "pri" : ""}`} key={c.id}>{c.name}</span>)}</div>
          <div className="kRuleCards">
            {(knowledge.ruleProposals || []).slice(0, 4).map((r) => <button className="kRuleCard" key={r.id} onClick={() => ui.openPanel("ruleLibrary")}><div className="kRuleTop"><b>{r.name}</b><span className="kRuleDot" /></div><div>{r.description || "基于专家知识库生成"}</div></button>)}
            {!ruleCount && <div className="emptyPanel" style={{ gridColumn: "1 / -1" }}>导入资料后自动抽取概念与规则</div>}
          </div>
        </div>

        <div className="termCard">
          <div className="kHead"><span className="secLabel">Skills 中心</span><button className="agLink" onClick={() => ui.openPanel("skillImport")}>全部技能 ›</button></div>
          <div className="kSkillList">
            {skills.slice(0, 3).map((sk) => <div className="kSkillRow" key={sk.id}><span className="kSkillIcon"><Sparkles size={14} /></span><div className="kSkillInfo"><b>{sk.name}</b> <span className="mono">{sk.native ? "内置" : `v${sk.version}`}</span></div><span className="evBadge ok">{sk.status || "已启用"}</span></div>)}
            {!skills.length && <div className="emptyPanel">暂无 Skill，从 GitHub / Skill.md 导入</div>}
          </div>
          <div className="kImportBtns"><button onClick={() => ui.openPanel("skillImport")}><GitBranch size={13} /> GitHub 导入</button><button onClick={() => ui.openPanel("skillImport")}>粘贴 Skill.md</button></div>
          <div className="kMcp"><div className="kMcpTop"><b>MCP 工具</b><span className="mono">{mcpConnected}/{mcp.length} 已连接</span></div><div className="kMcpChips">{mcp.slice(0, 4).map((m) => <span className={`kMcpChip ${m.status === "connected" ? "on" : ""}`} key={m.id}>{m.name}</span>)}{mcp.length > 4 && <span className="kMcpChip more">+{mcp.length - 4}</span>}{!mcp.length && <span className="kMcpChip more">未接入</span>}</div></div>
        </div>
      </div>

      <div className="termCard">
        <div className="kHead">
          <span className="secLabel">本次决策引用知识</span>
          <div className="kRagBar">
            <input value={rag} onChange={(e) => setRag(e.target.value)} placeholder="RAG 检索：例如 CPI 前后如何控仓？" onKeyDown={(e) => { if (e.key === "Enter" && rag.trim()) action("/api/knowledge/rag-query", { query: rag.trim(), topK: 5 }); }} />
            <button className="termMiniBtn dark" disabled={!rag.trim()} onClick={() => action("/api/knowledge/rag-query", { query: rag.trim(), topK: 5 })}><Search size={13} /> 检索</button>
          </div>
        </div>
        <div className="kCite">
          <div className="kCiteHead"><span>知识 / 规则 / 技能</span><span>类型</span><span>引用片段</span><span className="r">置信度</span><span className="r">来源</span></div>
          {cites.map((c, i) => <div className="kCiteRow" key={i}><span className="cb">{c.name}</span><span><b className="evBadge">{c.type}</b></span><span className="ell">{c.quote}</span><span className="r pos mono">{c.confidence}</span><span className="r">{c.source}</span></div>)}
          {!cites.length && <div className="emptyPanel">尚无引用；发起一次 RAG 检索或对话后显示本次决策引用的知识片段</div>}
        </div>
      </div>
    </div>
  );
}

function KnowledgeBaseTab({ data, action, ui, sourceCount, conceptCount, ruleCount, chunkCount, knowledge }) {
  const [query, setQuery] = useState("");
  const embed = data.embeddingStatus || { mode: "lexical", provider: null, model: null, totalChunks: chunkCount, embeddedChunks: 0, coveragePct: 0 };
  const importActions = (
    <button className="textButton" onClick={() => ui.openPanel("knowledgeList")}>全部知识 <ChevronRight size={14} /></button>
  );
  return (
    <>
      <div className="metricGrid four">
        <MetricCard icon={FileText} label="知识来源" value={String(sourceCount)} sub={`${chunkCount} 个可检索片段`} tone="positive" />
        <MetricCard icon={Layers} label="概念卡" value={String(conceptCount)} sub="已抽取概念" tone="positive" />
        <MetricCard icon={Settings} label="专家规则" value={String(ruleCount)} sub="待审批 / 已批准" tone="positive" />
        <MetricCard icon={BrainCircuit} label="检索模式" value={embed.mode === "semantic" ? "语义向量" : "词频匹配"} sub={embed.mode === "semantic" ? `${embed.model} · 覆盖 ${embed.coveragePct}%` : "配置 OpenAI/Gemini Key 可升级"} tone={embed.mode === "semantic" ? "positive" : ""} />
      </div>

      <Card>
        <SectionTitle icon={Search} title="知识检索（RAG）" action={
          <div className="titleActions">
            <StatusBadge tone={embed.mode === "semantic" ? "ok" : "warning"}>{embed.mode === "semantic" ? `语义检索 · 已向量化 ${embed.embeddedChunks}/${embed.totalChunks}` : "词频检索"}</StatusBadge>
            {embed.provider && embed.coveragePct < 100 && embed.totalChunks > 0 && <button className="secondaryButton" onClick={() => action("/api/knowledge/reembed", {})}><Sparkles size={14} /> 重新向量化</button>}
          </div>
        } />
        <div className="ragQueryBar">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：CPI 公布前后 BTC 应该如何控制仓位？" onKeyDown={(event) => { if (event.key === "Enter" && query.trim()) action("/api/knowledge/rag-query", { query: query.trim(), topK: 5 }); }} />
          <button className="primaryButton" disabled={!query.trim()} onClick={() => action("/api/knowledge/rag-query", { query: query.trim(), topK: 5 })}><Search size={14} /> 检索</button>
        </div>
        <DataTable columns={[
          { key: "name", label: "知识/规则/技能" }, { key: "type", label: "类型" }, { key: "quote", label: "引用片段", width: "2fr" }, { key: "confidence", label: "相关度" }, { key: "source", label: "来源" }
        ]} rows={(latestAnalysisRows(data) || [])} />
      </Card>

      <div className="knowledgeGrid">
        <Card>
          <SectionTitle title="专家知识库" action={importActions} />
          <div className="knowledgeCategoryList">
            {(knowledge.sources || []).slice(0, 6).map((source) => <button className="knowledgeCategory" key={source.id} onClick={() => ui.openPanel("knowledgeList")}><div><Globe2 size={22} /></div><span><strong>{source.domain || source.type}</strong><small>{source.title}</small></span><b>{humanize(source.status)}</b></button>)}
            {!knowledge.sources?.length && (
              <div className="emptyPanel emptyPanelAction">
                <strong>暂无真实知识来源</strong>
                <span>把交易类书籍与资料喂给 AI：可粘贴文本、导入网页链接、上传 PDF/EPUB/DOCX/MD/TXT，或填写本地文件路径。AI 会拆成「纪律规则（直接生效）」与「可回测策略假设（需先回测验证）」两类。</span>
              </div>
            )}
          </div>
          <button className="primaryButton knowledgeImportBtn" onClick={() => ui.openPanel("knowledgeImport")}><Plus size={17} /> 导入知识</button>
        </Card>
        <Card className="graphCard">
          <SectionTitle title="概念与规则" action={<button className="textButton" onClick={() => ui.openPanel("ruleLibrary")}>全部规则 <ChevronRight size={14} /></button>} />
          {ruleCount || conceptCount ? (
            <div className="conceptGraph">
              <div className="conceptHub"><b>知识图谱</b><small>{conceptCount} 个概念 · {ruleCount} 条规则</small></div>
              <div className="conceptNodeGrid">
                {(knowledge.conceptCards || []).slice(0, 6).map((concept, index) => <span className={index < 2 ? "primary" : ""} key={concept.id}>{concept.name}</span>)}
              </div>
            </div>
          ) : (
            <div className="emptyPanel emptyPanelAction">
              <strong>还没有概念或规则</strong>
              <span>导入资料后会自动切片并抽取概念；也可以在导入时生成待审批规则草案。</span>
              <button className="secondaryButton" onClick={() => ui.openPanel("knowledgeImport")}>导入并生成图谱</button>
            </div>
          )}
          <div className="ruleTiles">
            {(knowledge.ruleProposals || []).slice(0, 4).map((rule) => <button key={rule.id} onClick={() => ui.openPanel("ruleLibrary")}><strong>{rule.name}</strong><small>{rule.description || "基于专家知识库生成"}</small><StatusBadge tone={rule.status === "已批准" ? "ok" : "warning"}>{humanize(rule.status, "待审批")}</StatusBadge></button>)}
          </div>
        </Card>
      </div>

      <Card>
        <SectionTitle icon={RefreshCw} title="最近更新" action={<button className="textButton" onClick={() => ui.setActive("auditSystem")}>全部更新 <ChevronRight size={14} /></button>} />
        <div className="updateList">
          {data.auditLogs?.filter((item) => item.action?.includes("知识") || item.action?.includes("导入") || item.action?.includes("RAG") || item.action?.includes("解析")).slice(0, 5).map((item) => <div key={item.id}><b>{formatTime(item.createdAt)}</b><span>{item.action}</span><StatusBadge>{item.severity}</StatusBadge><small>{item.actor}</small></div>)}
          {!data.auditLogs?.some((item) => item.action?.includes("知识") || item.action?.includes("导入") || item.action?.includes("RAG") || item.action?.includes("解析")) && (
            <div className="emptyPanel emptyPanelAction">
              <strong>暂无真实知识更新</strong>
              <span>完成一次知识导入后，这里会显示审计记录。</span>
              <button className="secondaryButton" onClick={() => ui.openPanel("knowledgeImport")}>导入第一条知识</button>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}

function McpManager({ data, action }) {
  const [form, setForm] = useState({ name: "", url: "", apiKey: "" });
  const servers = data.mcpServers || [];
  const status = data.mcpStatus || {};
  const countLabel = `${status.connected || 0}/${status.total || 0} 已连接 · ${status.tools || 0} 个工具`;
  async function register(event) {
    event.preventDefault();
    if (!form.name.trim() || !form.url.trim()) return;
    const created = await action("/api/mcp", { name: form.name.trim(), url: form.url.trim(), apiKey: form.apiKey.trim() || undefined });
    if (created?.id) {
      await action(`/api/mcp/${created.id}/connect`, {});
      setForm({ name: "", url: "", apiKey: "" });
    }
  }
  return (
    <Card>
      <SectionTitle title="MCP 工具服务" action={<small className="muted">{countLabel}</small>} />
      <form className="ragQueryBar" style={{ flexWrap: "wrap" }} onSubmit={register}>
        <input placeholder="名称，如 Tavily 搜索" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="MCP Server 端点 URL" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
        <input placeholder="API Key（可选，Bearer）" type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
        <button className="primaryButton" type="submit"><Plus size={14} /> 注册并连接</button>
      </form>
      <div className="mcpServerGrid">
        {servers.map((s) => {
          const tone = s.status === "connected" ? "ok" : s.status === "error" ? "danger" : "warning";
          const sub = `${s.toolCount || 0} 工具${s.lastError ? ` · ${s.lastError}` : ""}`;
          return (
            <div className="mcpServerItem" key={s.id}>
              <div className="mcpServerMeta"><strong>{s.name}</strong><small title={s.url}>{s.url}</small><small>{sub}</small></div>
              <StatusBadge tone={tone}>{humanize(s.status, s.status)}</StatusBadge>
              <span className="rowActions">
                <button className="linkCell" onClick={() => action(`/api/mcp/${s.id}/connect`, {})}>连接</button>
                {s.status === "connected" ? <button className="linkCell" onClick={() => action(`/api/mcp/${s.id}/disable`, {})}>停用</button> : null}
              </span>
            </div>
          );
        })}
        {servers.length ? null : <div className="emptyPanel">暂无 MCP Server。注册后点「连接」发现工具，已连接的工具会接入 AI 交易员。</div>}
      </div>
      <InsightNote icon={PlugZap} title="工具接入">已连接的 MCP 工具以 mcp__ 前缀接入 AI 交易员的决策循环。例：Tavily 搜索 MCP（需 API Key）给 Agent 加查实时新闻、研报的能力。</InsightNote>
    </Card>
  );
}

function SkillCenterTab({ data, action, ui, enabledSkills, connectedMcp }) {
  return (
    <>
      <div className="metricGrid four">
        <MetricCard icon={Sparkles} label="已启用技能" value={String(enabledSkills)} sub={`共 ${data.skills?.length || 0} 个技能`} tone="positive" />
        <MetricCard icon={PlugZap} label="MCP 已连接" value={`${connectedMcp}/${data.mcpServers?.length || 0}`} sub="外部工具服务" tone={connectedMcp ? "positive" : ""} />
        <MetricCard icon={Activity} label="Skill 运行" value={`${data.skillRuns?.length || 0} 次`} sub="沙箱执行样本" />
        <MetricCard icon={Shield} label="权限与隔离" value="沙箱执行" sub="依赖扫描 + 无网络运行" />
      </div>

      <div className="knowledgeGrid">
        <Card className="skillCenterCard">
          <SectionTitle title="Skills 中心" action={<button className="textButton" onClick={() => ui.openPanel("skillImport")}>全部技能 <ChevronRight size={14} /></button>} />
          <InsightNote icon={Sparkles} title="技能生效方式">已启用的技能会作为可调用工具接入 AI 交易员的决策循环；内置技能只读，需要扫描并安装后生效。</InsightNote>
          <div className="skillList">
            {(data.skills || []).slice(0, 6).map((skill) => <div key={skill.id}><Sparkles size={18} /><strong>{skill.name}</strong><small>{skill.native ? "内置" : `v${skill.version}`}</small><StatusBadge tone={skill.status === "已启用" ? "ok" : "warning"}>{skill.status || "已启用"}</StatusBadge></div>)}
            {!data.skills?.length && (
              <div className="emptyPanel emptyPanelAction">
                <strong>暂无已导入 Skill</strong>
                <span>从其他 Skill 库下载能帮到你的技能：填写 GitHub 仓库、Skill.md 链接，或直接粘贴 Skill.md 内容后再扫描安装。</span>
                <button className="secondaryButton" onClick={() => ui.openPanel("skillImport")}>导入 Skill</button>
              </div>
            )}
          </div>
          <div className="importButtons"><button onClick={() => ui.openPanel("skillImport")}>从 GitHub 导入</button><button onClick={() => ui.openPanel("skillImport")}>粘贴 Skill.md</button></div>
        </Card>
        <Card>
          <SectionTitle icon={RefreshCw} title="最近技能更新" action={<button className="textButton" onClick={() => ui.setActive("auditSystem")}>全部更新 <ChevronRight size={14} /></button>} />
          <div className="updateList">
            {data.auditLogs?.filter((item) => item.action?.includes("Skill") || item.action?.includes("MCP") || item.action?.includes("沙箱")).slice(0, 5).map((item) => <div key={item.id}><b>{formatTime(item.createdAt)}</b><span>{item.action}</span><StatusBadge>{item.severity}</StatusBadge><small>{item.actor}</small></div>)}
            {!data.auditLogs?.some((item) => item.action?.includes("Skill") || item.action?.includes("MCP") || item.action?.includes("沙箱")) && (
              <div className="emptyPanel emptyPanelAction">
                <strong>暂无真实技能更新</strong>
                <span>完成一次 Skill 或 MCP 导入后，这里会显示审计记录。</span>
                <button className="secondaryButton" onClick={() => ui.openPanel("skillImport")}>导入第一个 Skill</button>
              </div>
            )}
          </div>
        </Card>
      </div>

      <McpManager data={data} action={action} />
    </>
  );
}

function RiskQuadrants({ rules = [] }) {
  const quadrantOf = (scope) => {
    const s = String(scope || "").toLowerCase();
    if (/account|portfolio|loss|margin|equity/.test(s)) return "account";
    if (/event/.test(s)) return "event";
    if (/system|knowledge|kill|api/.test(s)) return "system";
    return "trade";
  };
  const quadrants = [
    { key: "account", title: "账户风险", icon: WalletCards, tone: "" },
    { key: "trade", title: "交易风险", icon: TrendingUp, tone: "" },
    { key: "event", title: "事件风险", icon: Bell, tone: "warning" },
    { key: "system", title: "系统风险", icon: Shield, tone: "positive" }
  ];
  const buckets = { account: [], trade: [], event: [], system: [] };
  for (const rule of rules) buckets[quadrantOf(rule.scope)].push(rule);
  return (
    <div className="riskQuadrantGrid">
      {quadrants.map(({ key, title, icon: Icon, tone }) => (
        <div className="riskQuadrant" key={key}>
          <header><span className={`quadIcon ${tone}`}><Icon size={16} /></span><strong>{title}</strong><b>{buckets[key].length}</b></header>
          {buckets[key].length ? buckets[key].map((rule) => (
            <div className="quadRule" key={rule.id}>
              <div><strong>{rule.name}</strong><small>{rule.level || "-"} · {humanize(rule.action, rule.action || "-")}</small></div>
              <StatusBadge tone={rule.enabled === false ? "warning" : "ok"}>{rule.enabled === false ? "停用" : "启用"}</StatusBadge>
            </div>
          )) : <div className="quadEmpty">无规则</div>}
        </div>
      ))}
    </div>
  );
}

export function RiskAuthPage({ data, action, ui, embedded = false }) {
  const mandate = data.agentStatus?.activeMandate || data.mandates?.[0] || {};
  const latestRisk = data.riskChecks?.[0] || {};
  const grayPolicy = data.grayReleasePolicies?.[0] || {};
  const rawRiskScore = latestRisk.riskScore ?? data.portfolio.riskScore;
  const hasRiskScore = rawRiskScore !== null && rawRiskScore !== undefined && rawRiskScore !== "" && Number.isFinite(Number(rawRiskScore));
  const riskScore = hasRiskScore ? Number(rawRiskScore) : 0;
  const riskLevel = data.portfolio.riskLabel || (riskScore >= 70 ? "高风险" : riskScore >= 40 ? "中风险" : "低风险");
  const riskBannerTone = /高/.test(riskLevel) ? "neg" : /中/.test(riskLevel) ? "warn" : "pos";
  const mandateTone = mandate.status === "running" || mandate.status === "active" ? "ok" : statusTone(mandate.status);
  const validFrom = mandate.validFrom || mandate.valid_from;
  const validUntil = mandate.validUntil || mandate.valid_until;
  const mandateValidity = validFrom && validUntil
    ? `${formatDate(validFrom)} ~ ${formatDate(validUntil)}`
    : validUntil
      ? `截至 ${formatDate(validUntil)}`
      : validFrom
        ? `${formatDate(validFrom)} 起`
        : "未记录";
  const riskRules = data.riskRules || [];
  const scopeOf = (s) => { const t = String(s || "").toLowerCase(); if (/account|portfolio|loss|margin|equity/.test(t)) return "account"; if (/event/.test(t)) return "event"; if (/system|knowledge|kill|api/.test(t)) return "system"; return "trade"; };
  const ruleGroups = [
    { key: "account", title: "账户风险", Icon: WalletCards, bg: "#EAF0FB", color: "#2A6FDB" },
    { key: "trade", title: "交易风险", Icon: TrendingUp, bg: "#E6F1EA", color: "#1F7A50" },
    { key: "event", title: "事件风险", Icon: Bell, bg: "#FBEDDF", color: "#D06A22" },
    { key: "system", title: "系统风险", Icon: Shield, bg: "#F0EAFB", color: "#7A4FD0" }
  ].map((g) => ({ ...g, rules: riskRules.filter((r) => scopeOf(r.scope) === g.key) }));
  const maxLev = mandate.max_leverage || (mandate.maxLeverageBySymbol && Object.values(mandate.maxLeverageBySymbol).length ? Math.max(1, ...Object.values(mandate.maxLeverageBySymbol)) : null);
  const mandateRows2 = [
    { Icon: Layers, k: "授权范围", v: humanizeList(mandate.marketTypes, "未设置") },
    { Icon: WalletCards, k: "交易所", v: safeList(mandate.exchanges, "未授权") },
    { Icon: ListChecks, k: "白名单", v: (mandate.allowedSymbols || []).length ? `${mandate.allowedSymbols.length} 币` : "未授权" },
    { Icon: TrendingUp, k: "最大杠杆", v: maxLev ? `${maxLev}x` : "未授权" },
    { Icon: Target, k: "单日最大亏损", v: `${mandate.maxDailyLossPct || "-"}%`, color: "neg" },
    { Icon: CheckCircle2, k: "审批阈值", v: mandate.id ? `≥${formatMoney(mandate.humanApprovalNotionalUsdt || mandate.manual_approval_threshold_usdt || 0, 0)}` : "未授权" },
    { Icon: CalendarClock, k: "有效期", v: mandateValidity },
    { Icon: Activity, k: "状态", v: humanize(mandate.status, "未授权"), color: mandateTone === "ok" ? "pos" : "" }
  ];
  const budget = data.system.remainingDailyLossUsdt;
  const budgetCap = mandate.maxDailyLossPct && data.portfolio.totalEquityUsdt ? (Number(mandate.maxDailyLossPct) / 100) * Number(data.portfolio.totalEquityUsdt) : null;
  const budgetPct = budgetCap && budget != null ? Math.max(0, Math.min(100, (Number(budget) / budgetCap) * 100)) : null;
  const limitRows = [
    ["灰度实盘额度", grayPolicy.enabled ? `${formatMoney(grayPolicy.maxNotionalUsdt, 0)} USDT` : "未启用"],
    ["最大杠杆", maxLev ? `${maxLev}x` : "—"],
    ["单笔风险上限", `${mandate.maxSingleTradeRiskPct ?? "-"}%`],
    ["最近风控结论", latestRisk.summary || humanize(latestRisk.decision, "暂无")]
  ];
  const exAccounts = data.exchangeAccounts || [];
  const keyPerms = [
    ["读取行情", "允许", "pos"], ["读取账户", "允许", "pos"],
    ["交易下单", data.system?.liveTradingEnabled ? "允许" : "关闭", data.system?.liveTradingEnabled ? "pos" : ""],
    ["提现权限", "禁止", "neg"]
  ];
  const authHist = (data.auditLogs || []).filter((item) => item.target?.includes("mandate") || item.action?.includes("授权") || item.action?.includes("风控") || item.action?.includes("熔断")).slice(0, 4);
  return (
    <div className="pageStack termPage riskPage">
      {!embedded && <TermHead title="风控与授权" code="RISK · MANDATE" sub="授权边界、风险规则与账户安全，一处管住 AI 的手" />}
      <div className="termGrid riskTop">
        <div className="termCard">
          <div className="kHead"><span className="mandTitle">授权委托 <em className="mono">MANDATE</em></span><span className={`evBadge ${mandateTone === "ok" ? "ok" : "warn"}`}>● {humanize(mandate.status, "未授权")}</span></div>
          <div className="mandList">
            {mandateRows2.map((r) => <div className="mandRow" key={r.k}><span className="mandK"><r.Icon size={14} /> {r.k}</span><b className={`mono ${r.color || ""}`}>{r.v}</b></div>)}
          </div>
          <button className="agLink" onClick={() => ui.openPanel("mandate")}>查看委托详情与审计 ›</button>
        </div>

        <div className="rrGrid">
          {ruleGroups.map((g) => (
            <div className="termCard rrCard" key={g.key}>
              <div className="rrHead"><span className="rrIcon" style={{ background: g.bg, color: g.color }}><g.Icon size={14} /></span><b>{g.title}</b><span className="rrCount">{g.rules.length}</span></div>
              {g.rules.slice(0, 3).map((r) => <div className="rrRow" key={r.id}><span>{(r.name || "规则").slice(0, 12)}</span><b>{humanize(r.action, r.level || "-")}</b></div>)}
              {!g.rules.length && <div className="rrEmpty">无规则</div>}
              <div className="rrOk"><span className="rrDot" />正常</div>
            </div>
          ))}
        </div>

        <div className="termCard riskWallCard">
          <div className="kHead"><b className="rwTitle">风险状态墙</b><span className="rwTime mono">实时 {formatTime(latestRisk.createdAt || data.system.updatedAt)}</span></div>
          <div className={`riskBanner ${riskBannerTone}`}>
            <span className="riskBannerIcon"><ShieldCheck size={19} /></span>
            <div className="riskBannerMain"><div className="riskBannerK">当前风险等级</div><b>{riskLevel} · {riskBannerTone === "pos" ? "正常" : riskBannerTone === "warn" ? "关注" : "高危"}</b></div>
            <div className="riskBannerScore"><b className="mono">{hasRiskScore ? riskScore : "—"}</b><span className="mono">/100</span></div>
          </div>
          <div className="rwBudget">
            <div className="rwBudgetTop"><span>剩余亏损预算（今日）</span><b className="mono">{budget == null ? "未授权" : `${displayMoney(budget, 0)} · ${budgetPct != null ? budgetPct.toFixed(0) + "%" : "—"}`}</b></div>
            <div className="rwBudgetBar"><i style={{ width: `${budgetPct ?? 0}%` }} /></div>
          </div>
          <div className="rwLimits">
            <div className="rwLimitsHead"><b>当前生效限制</b><button className="agLink" onClick={() => ui.openPanel("riskRules")}>查看全部 ›</button></div>
            {limitRows.map(([k, v]) => <div className="rwLimitRow" key={k}><span>{k}</span><b className="mono">{v}</b></div>)}
          </div>
          <div className="riskBtns"><button className="rbPause" onClick={() => action("/api/system/autonomy", { enabled: false })}>暂停自主</button><button className="rbReduce" onClick={() => action("/api/risk/reduce-only", { enabled: true })}>只减仓</button><button className="rbKill" onClick={() => action("/api/risk/kill-switch", { enabled: true })}>一键熔断</button></div>
        </div>
      </div>

      <div className="termGrid riskBot">
        <div className="termCard">
          <div className="balLabel">API 与账户安全</div>
          {exAccounts.map((a) => <div className="secRow" key={a.id}><span>{a.exchange}</span><span className="secRowR"><b className={`evBadge ${a.readEnabled ? "ok" : "warn"}`}>{a.readEnabled ? "已连接" : "未配置"}</b></span></div>)}
          <div className="secRow"><span>邮件通知</span><b className={`evBadge ${data.integrations?.alerts?.hasWebhook ? "ok" : "warn"}`}>{data.integrations?.alerts?.hasWebhook ? "已启用" : "未配置"}</b></div>
        </div>
        <div className="termCard">
          <div className="secLabelSpread"><span className="balLabel" style={{ marginBottom: 0 }}>IP 白名单</span><button className="agLink" onClick={() => ui.openPanel("exchange")}>管理</button></div>
          <div className="secRow"><span className="mono">建议绑定交易所 IP</span><b className="evBadge warn">未设置</b></div>
        </div>
        <div className="termCard">
          <div className="balLabel">密钥权限</div>
          {keyPerms.map(([k, v, tone]) => <div className="secRow" key={k}><span>{k}</span><b className={`sg ${tone}`}>{v}</b></div>)}
        </div>
        <div className="termCard">
          <div className="secLabelSpread"><span className="balLabel" style={{ marginBottom: 0 }}>授权历史</span><button className="agLink" onClick={() => ui.download("/api/audit-logs/export?format=csv", "audit-logs.csv")}>导出</button></div>
          {authHist.map((item) => <div className="authRow" key={item.id}><span className="authDot" /><div className="authInfo"><b>{item.action}</b><div>{item.actor}</div></div><span className="authTime mono">{formatTime(item.createdAt)}</span></div>)}
          {!authHist.length && <div className="emptyPanel">暂无授权变更记录</div>}
        </div>
      </div>
    </div>
  );
}

export function ReviewPage({ data, action, ui, embedded = false }) {
  const [reviewTab, setReviewTab] = useState("strategy");
  const performance = data.performance || {};
  const reviews = data.reviews || [];
  const tradePlans = data.tradePlans || [];
  const executionOrders = data.executionOrders || data.orders || [];
  const skillRuns = data.skillRuns || [];
  const agentRuns = data.agentRuns || [];
  const riskChecks = data.riskChecks || [];
  const analytics = data.reviewAnalytics || {};
  const breakdowns = analytics.breakdowns || {};
  const cost = analytics.cost || {};
  const attribution = analytics.attribution || {};
  const failedRuns = agentRuns.filter((run) => ["failed", "error"].includes(String(run.status || "").toLowerCase())).length;
  const blockedRisk = riskChecks.filter((item) => ["blocked", "rejected", "risk_rejected"].includes(String(item.decision || item.result || item.status || "").toLowerCase())).length;
  const latestReview = reviews[0] || {};
  const optimizationItems = [
    blockedRisk ? `近期有 ${blockedRisk} 次风控阻断，优先复盘入场、止损和授权边界。` : "近期没有明显风控阻断，继续小样本验证策略稳定性。",
    failedRuns ? `有 ${failedRuns} 次 Agent 运行失败，需要检查模型、工具调用和网络配置。` : "Agent 运行链路暂未暴露失败集中点。",
    performance.trades ? `胜率 ${performance.winRatePct}%、盈亏比 ${performance.profitFactor ?? "未计算"}，下一步按策略和市场状态拆分表现。` : "交易样本不足，先建立最小交易日志闭环。",
    skillRuns.length ? "已有 Skill 运行记录，可按成功率、耗时和输出质量筛选高价值 Skill。" : "Skill 尚未形成运行样本，建议先用知识解析和风控复盘类 Skill。"
  ];
  const tradeRows = tradePlans.slice(0, 8).map((plan) => {
    const order = executionOrders.find((item) => item.planId === plan.id || item.id === plan.executionOrderId) || {};
    return {
      id: plan.id,
      time: formatTime(plan.createdAt),
      symbol: plan.symbol || order.symbol || "-",
      direction: humanize(plan.direction || order.side, "-"),
      status: <StatusBadge tone={statusTone(order.status || plan.status)}>{humanize(order.status || plan.status, "未执行")}</StatusBadge>,
      risk: humanize(plan.lastRiskCheck?.decision || plan.status, "未检查"),
      review: <button className="linkCell" onClick={() => ui.openPanel("executionDetail")}>详情</button>
    };
  });
  const skillRows = skillRuns.slice(0, 8).map((run) => ({
    id: run.id,
    time: formatTime(run.createdAt),
    skill: run.skillName || run.name || run.skillId || "Skill",
    status: <StatusBadge tone={statusTone(run.status)}>{humanize(run.status, "已记录")}</StatusBadge>,
    output: run.output || run.summary || run.resultSummary || "-"
  }));
  return (
    <div className="pageStack">
      {!embedded && <PageHeader active="review" />}
      <div className="metricGrid five">
        <MetricCard icon={BarChart3} label="累计盈亏" value={displayMoney(performance.totalPnlUsdt)} sub={`${performance.trades || 0} 笔已平仓`} tone={Number(performance.totalPnlUsdt || 0) >= 0 ? "positive" : "warning"} />
        <MetricCard icon={Target} label="胜率" value={performance.trades ? `${performance.winRatePct}%` : "暂无数据"} sub="按已平仓交易统计" />
        <MetricCard icon={Gauge} label="盈亏比" value={performance.profitFactor ?? "暂无数据"} sub="Profit Factor" />
        <MetricCard icon={BrainCircuit} label="Agent 运行" value={`${agentRuns.length} 次`} sub={`${failedRuns} 次失败`} tone={failedRuns ? "warning" : "positive"} />
        <MetricCard icon={Sparkles} label="Skill 复盘" value={`${skillRuns.length} 次`} sub="运行样本" />
      </div>

      <div className="reviewGrid">
        <Card className="reviewFocus">
          <SectionTitle icon={ListChecks} title="自我优化线索" action={<span className="sectionActions"><button className="secondaryButton" title="补全字段" onClick={() => action("/api/review/backfill-fields", {})}><RefreshCw size={14} /> 补全字段</button><button className="secondaryButton" title="创建改进闭环" onClick={() => action("/api/review/strategy-improvement", {})}><BrainCircuit size={14} /> 创建改进闭环</button></span>} />
          <div className="actionList">{optimizationItems.map((item, index) => <div key={item}><b>{index + 1}</b><span>{item}</span></div>)}</div>
        </Card>
        <Card>
          <SectionTitle icon={ClipboardList} title="最近复盘结论" />
          {latestReview.id ? (
            <div className="reviewNote">
              <strong>{latestReview.title || latestReview.id}</strong>
              <p>{latestReview.summary || latestReview.content || "已记录复盘，但缺少摘要。"}</p>
              <small>{formatDateTime(latestReview.createdAt)}</small>
            </div>
          ) : <div className="emptyPanel emptyPanelAction"><strong>暂无复盘报告</strong><span>完成交易闭环或运行复盘 Agent 后，这里会沉淀结论。</span></div>}
        </Card>
      </div>

      <div className="subTabBar">
        <button className={reviewTab === "strategy" ? "active" : ""} onClick={() => setReviewTab("strategy")}><Rocket size={15} /> 策略与验证</button>
        <button className={reviewTab === "perf" ? "active" : ""} onClick={() => setReviewTab("perf")}><BarChart3 size={15} /> 绩效拆解</button>
        <button className={reviewTab === "trades" ? "active" : ""} onClick={() => setReviewTab("trades")}><ClipboardList size={15} /> 交易与行为</button>
      </div>

      {reviewTab === "strategy" && (
        <>
          <StrategyResearchCard data={data} action={action} />
          <PaperValidationCard data={data} action={action} />
          <BacktestCard data={data} action={action} />
        </>
      )}

      {reviewTab === "perf" && (
        <>
          <div className="reviewGrid">
            <Card>
              <SectionTitle icon={BarChart3} title="拆分胜率与盈亏比" />
              <div className="segmentGrid">
                <SegmentList title="按策略" rows={breakdowns.strategy} />
                <SegmentList title="按币种" rows={breakdowns.symbol} />
                <SegmentList title="按时段" rows={breakdowns.session} />
                <SegmentList title="按行情 Regime" rows={breakdowns.regime} />
              </div>
            </Card>
            <Card>
              <SectionTitle icon={Gauge} title="交易质量指标" />
              <RiskLine label="平均 MAE" value={cost.avgMaeUsdt === null || cost.avgMaeUsdt === undefined ? "未记录" : `${displayMoney(cost.avgMaeUsdt)} USDT`} />
              <RiskLine label="平均 MFE" value={cost.avgMfeUsdt === null || cost.avgMfeUsdt === undefined ? "未记录" : `${displayMoney(cost.avgMfeUsdt)} USDT`} />
              <RiskLine label="平均滑点" value={cost.avgSlippageBps === null || cost.avgSlippageBps === undefined ? "未记录" : `${formatMoney(cost.avgSlippageBps, 2)} bps`} />
              <RiskLine label="手续费合计" value={`${displayMoney(cost.totalFeesUsdt)} USDT`} />
              <RiskLine label="资金费率合计" value={`${displayMoney(cost.totalFundingUsdt)} USDT`} />
              <RiskLine label="平均持仓时长" value={cost.avgHoldingMinutes === null || cost.avgHoldingMinutes === undefined ? "未记录" : `${formatMoney(cost.avgHoldingMinutes, 0)} 分钟`} />
            </Card>
          </div>
          <Card>
            <SectionTitle icon={AlertTriangle} title="亏损聚类" />
            <div className="clusterList">
              {(analytics.lossClusters || []).map((cluster) => <div key={cluster.key}><strong>{cluster.key}</strong><span>{cluster.count} 笔 · {displayMoney(cluster.pnl)} USDT</span><small>{cluster.suggestion}</small></div>)}
              {!analytics.lossClusters?.length && <div className="emptyPanel">暂无可聚类亏损样本。</div>}
            </div>
          </Card>
        </>
      )}

      {reviewTab === "trades" && (
        <>
          <div className="reviewGrid">
            <Card>
              <SectionTitle title="交易记录复盘" />
              <DataTable columns={[
                { key: "time", label: "时间" }, { key: "symbol", label: "交易对" }, { key: "direction", label: "方向" }, { key: "status", label: "执行" }, { key: "risk", label: "风控" }, { key: "review", label: "操作" }
              ]} rows={tradeRows} />
            </Card>
            <Card>
              <SectionTitle title="执行质量" action={<button className="textButton" onClick={() => ui.setActive("auditSystem")}>看日志中心 <ChevronRight size={14} /></button>} />
              <RiskLine label="在途执行单" value={`${(data.executionOrders || []).filter((item) => !["closed", "cancelled", "rejected"].includes(String(item.status || "").toLowerCase())).length} 个`} />
              <RiskLine label="风控阻断" value={`${blockedRisk} 次`} />
              <RiskLine label="Agent 运行失败" value={`${failedRuns} 次`} />
              <RiskLine label="详细日志" value="已集中到审计与通知" />
            </Card>
          </div>
          <Card>
            <SectionTitle title="贡献复盘" action={<button className="textButton" onClick={() => ui.setActive("knowledgeSkills")}>管理 Skill <ChevronRight size={14} /></button>} />
            <div className="reviewGrid nested">
              <DataTable columns={[
                { key: "time", label: "时间" }, { key: "skill", label: "Skill" }, { key: "status", label: "状态" }, { key: "output", label: "输出摘要", width: "1.8fr" }
              ]} rows={skillRows} />
              <div className="contributionList">
                {(attribution.rules || []).slice(0, 6).map((rule) => <div key={rule.id}><strong>{rule.name}</strong><span>{rule.checks} 次检查 · {rule.blocked} 次阻断</span><small>{rule.contribution}</small></div>)}
                {(attribution.skills || []).slice(0, 6).map((skill) => <div key={skill.id}><strong>{skill.name}</strong><span>{skill.runs} 次运行 · 成功率 {skill.successRatePct ?? "未验证"}</span><small>{skill.contribution}</small></div>)}
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function EquitySparkline({ values = [] }) {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1e-9, max - min);
  const path = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 100;
    const y = 44 - ((value - min) / range) * 40;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
  return <svg className="equityCurve" viewBox="0 0 100 48" preserveAspectRatio="none"><path d={path} /></svg>;
}

function PaperValidationCard({ data, action }) {
  const report = data.paperReport || { minForwardTrades: 8, sessions: [] };
  const sessions = report.sessions || [];
  const tone = { passed: "ok", failed: "danger", running: "warning" };
  const label = { passed: "已通过", failed: "未通过", running: "验证中" };
  return (
    <Card>
      <SectionTitle icon={GitBranch} title="模拟盘前向验证（回测 → 模拟盘 → 小额实盘）" action={<span className="sectionActions"><button className="secondaryButton" title="从已验证策略开盘" onClick={() => action("/api/paper/spawn-from-profiles", {})}><Plus size={14} /> 从已验证策略开盘</button><button className="secondaryButton" title="前向推进" onClick={() => action("/api/paper/run", {})}><RefreshCw size={14} /> 前向推进</button></span>} />
      {sessions.length ? (
        <DataTable columns={[
          { key: "symbol", label: "交易对" }, { key: "strategy", label: "策略", width: "1.4fr" }, { key: "progress", label: "前向交易" }, { key: "exp", label: "前向期望" }, { key: "dd", label: "最大回撤" }, { key: "status", label: "状态" }
        ]} rows={sessions.map((s) => ({
          id: s.id,
          symbol: `${s.symbol} · ${s.timeframe}`,
          strategy: `${s.label}${s.seeded ? " · 含预热" : ""}`,
          progress: `${s.metrics?.trades ?? 0} / ${report.minForwardTrades}`,
          exp: s.metrics?.expectancyR !== null && s.metrics?.expectancyR !== undefined ? `${s.metrics.expectancyR}R` : "-",
          dd: s.metrics?.maxDrawdownPct !== null && s.metrics?.maxDrawdownPct !== undefined ? `${s.metrics.maxDrawdownPct}%` : "-",
          status: <StatusBadge tone={tone[s.status] || "warning"}>{label[s.status] || s.status}</StatusBadge>
        }))} />
      ) : (
        <div className="emptyPanel emptyPanelAction">
          <strong>还没有模拟盘会话</strong>
          <span>先在上方「自适应策略研究」跑出已验证策略，再点「从已验证策略开盘」——系统会对这些策略开纯前向模拟盘，随真实行情累积样本，通过后才建议放大实盘。</span>
          <button className="secondaryButton" onClick={() => action("/api/paper/spawn-from-profiles", {})}>从已验证策略开盘</button>
        </div>
      )}
      <InsightNote icon={Rocket} title="前向验证">只在会话创建后到来的 K 线上模拟成交，无法过拟合历史；前向满 {report.minForwardTrades} 笔且期望为正、回撤可控才通过。开启 REQUIRE_PAPER_VALIDATION 后，未通过的交易对将禁止开实盘新仓。</InsightNote>
    </Card>
  );
}

function StrategyResearchCard({ data, action }) {
  const profiles = data.strategyProfiles || [];
  const confTone = { validated: "ok", low: "warning", none: "danger" };
  const confLabel = { validated: "已验证", low: "低置信", none: "无合格策略" };
  return (
    <Card>
      <SectionTitle icon={BrainCircuit} title="自适应策略研究（样本外验证）" action={<button className="secondaryButton" title="运行研究" onClick={() => action("/api/strategy/research", {})}><Rocket size={14} /> 运行研究</button>} />
      {profiles.length ? (
        <DataTable columns={[
          { key: "symbol", label: "交易对" }, { key: "character", label: "币种性格" }, { key: "strategy", label: "优选策略", width: "1.4fr" }, { key: "oos", label: "样本外期望" }, { key: "winrate", label: "样本外胜率" }, { key: "conf", label: "置信度" }
        ]} rows={profiles.map((p) => ({
          id: p.id,
          symbol: `${p.symbol} · ${p.timeframe}`,
          character: p.tokenProfile ? `${p.tokenProfile.character === "trend" ? "趋势型" : p.tokenProfile.character === "meanrev" ? "回归型" : "混合"} · 波动${p.tokenProfile.volState === "high" ? "高" : p.tokenProfile.volState === "low" ? "低" : "中"}` : "-",
          strategy: `${p.label}${p.direction === "short" ? " · 做空" : p.direction === "long" ? " · 做多" : ""}`,
          oos: p.oosScore !== null && p.oosScore !== undefined ? `${p.oosScore}R（${p.oos?.trades ?? "-"} 笔·${p.oosFolds || "-"}）` : "-",
          winrate: p.oos?.winRatePct !== null && p.oos?.winRatePct !== undefined ? `${p.oos.winRatePct}%` : "-",
          conf: <StatusBadge tone={confTone[p.confidence] || "warning"}>{confLabel[p.confidence] || p.confidence}</StatusBadge>
        }))} />
      ) : (
        <div className="emptyPanel emptyPanelAction">
          <strong>还没有策略画像</strong>
          <span>点击「运行研究」：在趋势/均值回归/突破多套策略上做 train→test 样本外寻优，胜出者自动写入 Agent 记忆并参与后续决策。每 6 小时也会自动跑一次。</span>
        </div>
      )}
      <InsightNote icon={Search} title="样本外验证">用前 70% 数据寻优、后 30% 验证，降低过拟合风险；低置信表示样本外交易太少，不足以采信。</InsightNote>
    </Card>
  );
}

function BacktestCard({ data, action }) {
  const [form, setForm] = useState({ symbol: "BTC/USDT", timeframe: "1h", fastPeriod: 10, slowPeriod: 30, stopLossPct: 2, takeProfitR: 2 });
  const latest = (data.backtests || [])[0];
  const positive = latest && Number(latest.netReturnPct) >= 0;
  return (
    <Card>
      <SectionTitle icon={LineChart} title="策略回测" action={<button className="secondaryButton" title="运行回测" onClick={() => action("/api/backtest/run", { ...form, fastPeriod: Number(form.fastPeriod), slowPeriod: Number(form.slowPeriod), stopLossPct: Number(form.stopLossPct), takeProfitR: Number(form.takeProfitR) })}><Rocket size={14} /> 运行回测</button>} />
      <div className="dashboardToolbar">
        <div className="filterGroup">{["15m", "1h", "4h", "1d"].map((tf) => <button className={form.timeframe === tf ? "active" : ""} key={tf} onClick={() => setForm((current) => ({ ...current, timeframe: tf }))}>{tf}</button>)}</div>
        <span>SMA({form.fastPeriod}/{form.slowPeriod}) 金叉开多 · 止损 {form.stopLossPct}% · 止盈 {form.takeProfitR}R</span>
      </div>
      {latest ? (
        <>
          <div className="btMetrics">
            <div><span>交易笔数</span><strong>{latest.trades}</strong></div>
            <div><span>胜率</span><strong>{latest.winRatePct === null ? "-" : `${latest.winRatePct}%`}</strong></div>
            <div><span>盈亏比</span><strong>{latest.profitFactor ?? "-"}</strong></div>
            <div><span>期望</span><strong>{latest.expectancyR ?? "-"}R</strong></div>
            <div><span>最大回撤</span><strong className="negative">{latest.maxDrawdownPct ?? "-"}%</strong></div>
            <div><span>净收益</span><strong className={positive ? "positive" : "negative"}>{displayPct(latest.netReturnPct)}</strong></div>
          </div>
          <EquitySparkline values={latest.equityCurve} />
          <p className="muted">{latest.symbol} {latest.timeframe} · {latest.candles} 根 K 线 · {latest.strategy}{latest.note ? ` · ${latest.note}` : ""}</p>
        </>
      ) : (
        <div className="emptyPanel emptyPanelAction">
          <strong>还没有回测结果</strong>
          <span>点击「运行回测」在历史 K 线上验证策略，得到胜率、盈亏比与最大回撤——上实盘前先用它证明策略有效。</span>
        </div>
      )}
    </Card>
  );
}

function SegmentList({ title, rows = [] }) {
  return (
    <div className="segmentList">
      <h3>{title}</h3>
      {rows.slice(0, 4).map((row) => (
        <div key={row.key}>
          <strong>{row.key}</strong>
          <span>{row.trades} 笔 · 胜率 {row.winRatePct === null ? "暂无" : `${row.winRatePct}%`} · 盈亏比 {row.profitFactor ?? "暂无"}</span>
          <b className={Number(row.pnl || 0) >= 0 ? "positive" : "negative"}>{displayMoney(row.pnl)} USDT</b>
        </div>
      ))}
      {!rows.length && <div className="emptyPanel">暂无样本。</div>}
    </div>
  );
}

export function AuditSystemPage({ data, ui, embedded = false }) {
  const traces = data.traces || [];
  const jobRuns = data.jobRuns || [];
  const [traceTypeFilter, setTraceTypeFilter] = useState("全部");
  const [traceWindow, setTraceWindow] = useState("24h");
  const latestPlan = data.tradePlans?.[0] || {};
  const latestRisk = data.riskChecks?.[0] || latestPlan.lastRiskCheck || {};
  const latestOrder = data.orders?.[0] || data.executionOrders?.[0] || {};
  const auditOk = data.readiness?.checks?.find((item) => item.key === "audit_chain")?.configured ?? true;
  const successfulRuns = jobRuns.filter((run) => ["ok", "completed"].includes(String(run.status).toLowerCase())).length;
  const successRate = jobRuns.length ? `${((successfulRuns / jobRuns.length) * 100).toFixed(1)}%` : "暂无数据";
  const latencies = traces.map((trace) => Number(trace.latencyMs)).filter(Number.isFinite).sort((a, b) => a - b);
  const p95 = latencies.length ? formatDuration(latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]) : "暂无数据";
  const incidents = [...(data.riskIncidents || []), ...(data.alerts || [])].slice(0, 5);
  const cutoff = traceWindow === "24h" ? Date.now() - 24 * 60 * 60 * 1000 : 0;
  const filteredTraces = traces.filter((trace) => {
    const withinWindow = !cutoff || new Date(trace.createdAt).getTime() >= cutoff;
    const withinType = traceTypeFilter === "全部" || trace.type === traceTypeFilter;
    return withinWindow && withinType;
  });
  const traceTypes = ["全部", ...Array.from(new Set(traces.map((trace) => trace.type).filter(Boolean))).slice(0, 3)];
  const chainItems = [
    ["授权任务", latestPlan.mandateId, humanize(data.agentStatus?.activeMandate?.status, "未授权"), KeyRound, "MANDATE"],
    ["分析包", latestPlan.analysisBundleId, latestPlan.analysisBundleId ? "已生成" : "未生成", FileText, "ANALYSIS"],
    ["交易计划", latestPlan.id, humanize(latestPlan.status, "未生成"), ClipboardList, "PLAN"],
    ["风险校验", latestPlan.riskCheckId || latestRisk.id, humanize(latestRisk.decision || latestRisk.result, "未检查"), Shield, "RISK CHECK"],
    ["执行", latestOrder.id, humanize(latestOrder.status, "真实写关闭"), Rocket, "EXECUTE"],
    ["结算对账", data.reconciliationReports?.[0]?.id, humanize(data.reconciliationReports?.[0]?.status, "未对账"), RefreshCw, "RECONCILE"],
    ["复盘审查", data.reviews?.[0]?.id, data.reviews?.[0]?.id ? "已记录" : "未生成", Search, "REVIEW"]
  ];
  return (
    <div className="pageStack termPage">
      {!embedded && <TermHead title="审计与系统" code="AUDIT · SYSTEM" sub="全链路审计、工具调用日志与系统可观测性" />}
      <div className="metricGrid five">
        <MetricCard icon={Gauge} label="API 健康" value={data.system.apiHealth || "未知"} sub={`实现 ${data.readiness?.implementationCompletionPct || 0}%`} />
        <MetricCard icon={Activity} label="WebSocket 状态" value={data.realtimeStarted ? "运行中" : "未启动"} sub={data.realtimeStarted ? `${data.realtimeConnections?.filter((item) => item.status === "connected").length || 0} / ${data.realtimeConnections?.length || 0} 已连接` : "实时管理器未开启"} tone={data.realtimeStarted ? "positive" : "warning"} />
        <MetricCard icon={Zap} label="任务引擎" value={String(data.tasks?.filter((task) => task.enabled).length || 0)} sub="启用任务" />
        <MetricCard icon={RefreshCw} label="交易所同步" value={`${data.exchangeAccounts?.filter((item) => item.readEnabled).length || 0} / ${data.exchangeAccounts?.length || 0}`} sub="已配置只读账户" />
        <MetricCard icon={Shield} label="审计链" value={auditOk ? "正常" : "异常"} sub={`${data.auditLogs?.length || 0} 条日志`} />
      </div>

      <div className="termGrid auditTop">
      <div className="termCard">
        <div className="kHead"><span className="secLabel">Agent 运行审计链</span><button className="agLink" onClick={() => ui.openPanel("auditChain")}>完整链路 ›</button></div>
        <div className="acChain">
          {chainItems.map(([item, value, state, Icon, en]) => {
            const done = Boolean(value);
            return (
              <div className="acRow" key={item} title={value || "未生成"}>
                <span className={`acIcon ${done ? "done" : "pending"}`}>{Icon ? <Icon size={13} /> : null}</span>
                <div className="acInfo"><span className="acStep"><b>{item}</b> <em className="acEn mono">{en}</em></span><div className="acId mono">{shortId(value) || "—"} · {humanize(state)}</div></div>
                {done ? <CheckCircle2 size={14} className="acCheck" /> : <span className="acDash">—</span>}
              </div>
            );
          })}
        </div>
        <div className="acFoot"><span>整体耗时 <b className="mono">{formatDuration(traces[0]?.latencyMs) || "—"}</b></span><span>状态 <b className={latestRisk.passed ? "pos" : "warn"}>{humanize(latestRisk.decision || latestPlan.status, "运行中")}</b></span></div>
      </div>

      <div className="termCard">
        <div className="kHead"><span className="secLabel">决策与工具调用日志</span><button className="agLink" onClick={() => setTraceWindow((current) => current === "24h" ? "all" : "24h")}>{traceWindow === "24h" ? "近 24 小时" : "全部时间"} ›</button></div>
        <div className="acLog">
          <div className="acLogHead mono"><span>时间</span><span>AGENT/步骤</span><span>类型</span><span>详情</span><span className="r">状态</span></div>
          {filteredTraces.slice(0, 8).map((trace) => {
            const tool = trace.type?.includes("tool");
            return (
              <div className="acLogRow mono" key={trace.id}>
                <span className="acLogTime">{formatTime(trace.createdAt)}</span>
                <span className="acLogStep">{humanize(trace.type || "步骤")}</span>
                <span><b className={`evBadge ${tool ? "" : "ok"}`}>{tool ? "工具" : "决策"}</b></span>
                <span className="acLogDetail">{trace.title}</span>
                <span className="r pos">✓</span>
              </div>
            );
          })}
          {!filteredTraces.length && <div className="emptyPanel">近 24 小时暂无决策/工具调用记录。</div>}
        </div>
      </div>

      <div className="termCard">
        <div className="secLabel">执行审计</div>
        <div className="acExecGrid">
          <div><div className="acExecK">订单 ID</div><b className="mono">{shortId(latestOrder.id) || "—"}</b></div>
          <div className="r"><span className={`evBadge ${latestOrder.status ? "ok" : ""}`}>{humanize(latestOrder.status, "未生成")}</span></div>
          <div><div className="acExecK">交易计划 ID</div><b className="mono">{shortId(latestPlan.id) || "—"}</b></div>
          <div className="r"><div className="acExecK">风控校验</div><b className="mono">{shortId(latestPlan.riskCheckId || latestRisk.id) || "—"}</b></div>
        </div>
        <div className="acExecGrid divided">
          <div><div className="acExecK">交易对 · 方向</div><b className="mono">{latestPlan.symbol || latestOrder.symbol || "—"} {humanize(latestPlan.direction || latestOrder.side, "")}</b></div>
          <div className="r"><div className="acExecK">数量</div><b className="mono">{displayMoney(latestOrder.quantity ?? latestOrder.size, 4, "—")}</b></div>
          <div><div className="acExecK">成交均价</div><b className="mono">{displayMoney(latestOrder.avgPrice ?? latestOrder.price, 2, "—")}</b></div>
          <div className="r"><div className="acExecK">交易所</div><b>{latestPlan.exchange || latestOrder.exchange || "—"}</b></div>
        </div>
        <div className={`acReconcile ${data.reconciliationReports?.[0]?.status === "ok" ? "ok" : ""}`}>
          <span><CheckCircle2 size={14} /> {humanize(data.reconciliationReports?.[0]?.status, "未对账")}</span>
          <span className="mono">{data.reconciliationReports?.[0] ? `差异 ${displayMoney(data.reconciliationReports[0].diffUsdt ?? 0, 0)} · ${formatTime(data.reconciliationReports[0].createdAt)}` : "—"}</span>
        </div>
        <button className="agLink" onClick={() => ui.openPanel("executionDetail")}>查看详情 ›</button>
      </div>
      </div>

      <Card>
        <SectionTitle title="系统可观测性" action={<button className="textButton" onClick={() => ui.setActive("eventsTasks")}>全部事件 <ChevronRight size={14} /></button>} />
        <div className="observabilityGrid">
          <MiniChart title="任务成功率" value={successRate} sub={`${jobRuns.length} 次真实任务运行`} />
          <MiniChart title="任务延迟（P95）" value={p95} sub={`${latencies.length} 条 Trace 样本`} />
          <MiniChart title="告警数量" value={String(incidents.length)} sub="风险事件 + 外部告警" />
          <div className="incidentPanel">
            <h3>近期告警与事件</h3>
            {incidents.map((item) => <div key={item.id}><StatusBadge tone={statusTone(item.severity || item.status)}>{humanize(item.status || item.severity, "记录")}</StatusBadge><span>{item.title || item.message || item.action || item.id}{item.count > 1 ? ` ×${item.count}` : ""}</span><small>{formatTime(item.lastSeenAt || item.createdAt)}</small>{item.status === "open" && String(item.id).startsWith("incident") && <button className="linkCell" title="标记为已处理" onClick={() => action(`/api/risk/incidents/${item.id}/close`, {})}>标记已处理</button>}</div>)}
            {!incidents.length && <div className="emptyPanel">暂无真实告警。</div>}
          </div>
        </div>
      </Card>
    </div>
  );
}

export function AgentProfilesPage({ data, action, ui }) {
  const profiles = (data.agentProfiles || []).slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  const enabled = profiles.filter((profile) => profile.enabled !== false).length;
  const proposal = profiles.filter((profile) => profile.canProposeTrade).length;
  const risk = profiles.filter((profile) => profile.canApproveRisk).length;
  const phases = profiles.map((profile) => profile.phase).filter(Boolean);
  const comparison = [
    ["市场输入", "行情、事件、策略研究容易混在同一段分析里", "市场观察员和事件分析员先拆分事实、噪音和风险窗口"],
    ["交易计划", "LLM 可能直接给方向建议，计划结构不稳定", "策略研究员与交易计划员输出固定字段：方向、触发、止损、仓位、失效条件"],
    ["风险边界", "风控更多依赖统一规则，缺少角色复核语境", "风控官独立审查计划，只能批准/拒绝，不能替自己放宽规则"],
    ["执行过程", "批准后执行和持仓监控的责任不够清晰", "执行监督员盯订单状态，持仓管理员盯止损、保本、减仓和异常"],
    ["复盘记忆", "复盘更像记录结果，较难反哺下一轮", "复盘/记忆管理员把错误、有效条件和禁忌沉淀为下一轮上下文"]
  ];
  return (
    <div className="pageStack">
      <PageHeader active="agentProfiles" />
      <div className="metricGrid four">
        <MetricCard icon={BrainCircuit} label="交易 Agent" value={`${profiles.length} 个`} sub={`${enabled} 个启用`} />
        <MetricCard icon={ClipboardList} label="可提计划" value={`${proposal} 个`} sub="只生成结构化计划，不直接下单" />
        <MetricCard icon={Shield} label="风控审批" value={`${risk} 个`} sub="只允许风控官批准/拒绝" />
        <MetricCard icon={GitBranch} label="流程阶段" value={`${new Set(phases).size} 段`} sub="观察→复盘闭环" />
      </div>

      <Card className="agentManifesto">
        <SectionTitle icon={Sparkles} title="人格宣言" action={<button className="secondaryButton" onClick={() => ui.setActive("systemSettings")}>配置模型 <ChevronRight size={14} /></button>} />
        <blockquote>我不是来替你冒险的，我是来把风险变得可见、可控、可复盘的。</blockquote>
        <InsightNote icon={Shield} title="交易权限边界">所有 Agent 都只能提出结构化建议或审查结果；真实写单必须经过交易计划、硬风控、授权、执行引擎和交易写入网关。</InsightNote>
      </Card>

      <Card className="agentFlowBoard">
        <SectionTitle icon={GitBranch} title="8 Agent 编排链路" />
        <div className="agentFlowRail">
          {profiles.map((profile, index) => (
            <div className="agentFlowStep" key={profile.id}>
              <b>{String(index + 1).padStart(2, "0")}</b>
              <span>{profile.name}</span>
              <small>{profile.phase}</small>
            </div>
          ))}
        </div>
      </Card>

      <Card className="agentCompareCard">
        <SectionTitle icon={BarChart3} title="加入 8 Agent 前后对比" />
        <div className="agentCompareGrid">
          {comparison.map(([topic, before, after]) => (
            <div key={topic}>
              <strong>{topic}</strong>
              <p><b>以前</b>{before}</p>
              <p><b>现在</b>{after}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="agentProfileGrid">
        {profiles.map((profile) => (
          <Card className={`agentProfileCard ${profile.enabled === false ? "disabled" : ""}`} key={profile.id}>
            <div className="agentProfileHead">
              <div>
                <span>{profile.role}</span>
                <h2>{profile.name}</h2>
              </div>
              <StatusBadge tone={profile.enabled === false ? "warning" : "ok"}>{profile.enabled === false ? "停用" : "启用"}</StatusBadge>
            </div>
            <p>{profile.personality}</p>
            <RiskLine label="使命" value={profile.mission} />
            <RiskLine label="输出" value={profile.outputSchema} />
            <RiskLine label="记忆策略" value={profile.memoryPolicy} />
            <div className="agentToolList">
              {(profile.tools || []).map((tool) => <span key={tool}>{tool}</span>)}
            </div>
            <div className="agentBoundaryList">
              {(profile.boundaries || []).slice(0, 4).map((item) => <small key={item}>· {item}</small>)}
            </div>
            <footer>
              <button className="secondaryButton" onClick={() => action(`/api/agent/profiles/${profile.id}`, { enabled: profile.enabled === false }, "PATCH")}>{profile.enabled === false ? "启用" : "停用"}</button>
              <button className="textButton" onClick={() => {
                const next = window.prompt("更新人格宣言", profile.declaration || "");
                if (next !== null) action(`/api/agent/profiles/${profile.id}`, { declaration: next }, "PATCH");
              }}>编辑宣言</button>
            </footer>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function AgentProfilesPanel({ data, action }) {
  const profiles = (data.agentProfiles || []).slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  return (
    <Card>
      <SectionTitle icon={BrainCircuit} title="Agent Profile 配置" />
      <div className="adminAgentGrid">
        {profiles.map((profile) => (
          <div className={`adminAgentMini ${profile.enabled === false ? "disabled" : ""}`} key={profile.id}>
            <div>
              <b>{String(profile.order || "").padStart(2, "0")}</b>
              <strong>{profile.name}</strong>
              <small>{profile.role}</small>
            </div>
            <p>{profile.mission}</p>
            <button className="secondaryButton" onClick={() => action(`/api/agent/profiles/${profile.id}`, { enabled: profile.enabled === false }, "PATCH")}>{profile.enabled === false ? "启用" : "停用"}</button>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function AdminPage({ data, action, ui, embedded = false }) {
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showNewPlan, setShowNewPlan] = useState(false);
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "", role: "交易用户", freeMonths: 0 });
  const [newPlan, setNewPlan] = useState({ name: "", months: 1, priceUsdt: 0, features: "" });
  const [planDrafts, setPlanDrafts] = useState({});
  const [grantMonths, setGrantMonths] = useState(12);
  const [adminTab, setAdminTab] = useState("users");
  const [userSearch, setUserSearch] = useState("");
  const plans = data.subscriptionPlans || [];
  const users = data.users || [];
  const regEnabled = data.publicRegistrationEnabled === true;
  const filteredUsers = users.filter((user) => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return true;
    return [user.name, user.email, user.id, user.tenantId, user.role].some((v) => String(v || "").toLowerCase().includes(q));
  });
  const payments = data.paymentRequests || [];
  const subscriptions = data.subscriptions || [];
  const profiles = (data.agentProfiles || []).slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  const activeSubs = subscriptions.filter((item) => ["active", "trialing"].includes(item.status)).length;
  const ownerGrants = subscriptions.filter((item) => item.source === "owner_grant").length;
  const activeProfiles = profiles.filter((profile) => profile.enabled !== false).length;
  useEffect(() => {
    setPlanDrafts((current) => {
      const next = { ...current };
      for (const plan of plans) {
        if (!next[plan.id]) next[plan.id] = { ...plan, features: (plan.features || []).join("\n") };
      }
      return next;
    });
  }, [plans]);
  function subscriptionFor(user) {
    return subscriptions.find((item) => item.tenantId === user.tenantId || item.userId === user.id);
  }
  function updatePlanDraft(id, patch) {
    setPlanDrafts((current) => ({ ...current, [id]: { ...(current[id] || {}), ...patch } }));
  }
  function resetUserPassword(user) {
    const password = window.prompt(`为 ${user.email || user.name} 设置新的临时密码（至少 10 位）。设置后请让 TA 登录并在“账户 → 修改密码”里自行更换。`);
    if (!password) return;
    if (password.length < 10) { ui.notify?.("临时密码至少 10 位"); return; }
    action(`/api/admin/users/${user.id}/reset-password`, { password }, "POST");
  }
  function savePlan(plan) {
    const draft = planDrafts[plan.id] || plan;
    action(`/api/admin/subscription-plans/${plan.id}`, {
      name: draft.name,
      months: draft.months,
      priceUsdt: draft.priceUsdt,
      enabled: draft.enabled !== false,
      features: String(draft.features || "").split("\n").map((item) => item.trim()).filter(Boolean)
    }, "PATCH");
  }
  const adminTabs = [
    ["users", "用户", UserCog],
    ["billing", "套餐与支付", WalletCards],
    ["security", "安全维护", Shield]
  ];
  const initialOf = (u) => String(u.name || u.email || u.id || "?").trim().charAt(0).toUpperCase();
  return (
    <div className="pageStack">
      {!embedded && <PageHeader active="admin" />}

      <div className="ownerBar">
        <div className="ownerBarLead">
          <span className="ownerKicker">OWNER CONTROL CENTER</span>
          <h2>用户管理</h2>
        </div>
        <div className="ownerStats">
          <div><b>{users.length}</b><span>用户</span></div>
          <div><b>{activeSubs}</b><span>有效订阅</span></div>
          <div><b>{ownerGrants}</b><span>免费授权</span></div>
          <div><b>{activeProfiles}/{profiles.length}</b><span>Agent 启用</span></div>
        </div>
      </div>

      <div className="adminTabs" role="tablist" aria-label="Admin sections">
        {adminTabs.map(([id, label, Icon]) => (
          <button key={id} className={adminTab === id ? "active" : ""} onClick={() => setAdminTab(id)}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      {adminTab === "users" && (
        <div className="adminUsersWrap">
          <div className="userToolbar">
            <div className="adminSearch"><Search size={15} /><input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="搜索姓名 / 邮箱 / 租户 / 角色" /></div>
            <div className="userToolbarRight">
              <label className="grantDefault"><span>默认赠送</span><input type="number" min="1" value={grantMonths} onChange={(event) => setGrantMonths(event.target.value)} /><span>月</span></label>
              <button type="button" className={`regPill ${regEnabled ? "on" : ""}`} onClick={() => action("/api/config", { PUBLIC_REGISTRATION_ENABLED: regEnabled ? "false" : "true" })}>
                <span className="sw" /> 公开注册 {regEnabled ? "开" : "关"}
              </button>
              <button className="primaryButton" onClick={() => setShowCreate((value) => !value)}><UserPlus size={15} /> 开通账号</button>
            </div>
          </div>
          <div className="userHint">{regEnabled ? "公开注册已开启：访客可在登录页自助注册并订阅。" : "公开注册已关闭：仅 Owner 可在此开通账号。"}</div>

          {showCreate && (
            <div className="userCreatePanel">
              <div className="userCreateHead"><UserPlus size={15} /><strong>开通新账号</strong><button type="button" className="ghostClose" onClick={() => setShowCreate(false)}><X size={15} /></button></div>
              <div className="userCreateGrid">
                <label>姓名<input value={newUser.name} onChange={(event) => setNewUser({ ...newUser, name: event.target.value })} placeholder="用户姓名" /></label>
                <label>邮箱<input value={newUser.email} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} placeholder="user@example.com" /></label>
                <label>初始密码<input type="password" value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} placeholder="至少 10 位" /></label>
                <label>角色<select value={newUser.role} onChange={(event) => setNewUser({ ...newUser, role: event.target.value })}><option>交易用户</option><option>管理员</option></select></label>
                <label>免费月数<input type="number" min="0" value={newUser.freeMonths} onChange={(event) => setNewUser({ ...newUser, freeMonths: event.target.value })} /></label>
                <button className="primaryButton" onClick={() => { action("/api/admin/users", newUser); setShowCreate(false); }}>创建账号</button>
              </div>
            </div>
          )}

          <div className="userTable">
            <div className="userTableHead">
              <span>用户</span><span>角色</span><span>订阅</span><span>状态</span><span>操作</span>
            </div>
            {filteredUsers.map((user) => {
              const sub = subscriptionFor(user);
              const off = user.status === "disabled";
              return (
                <div className={`userTableRow ${user.isOwner ? "owner" : ""} ${off ? "off" : ""}`} key={user.id}>
                  <div className="uCell uIdentity">
                    <div className="uAvatar">{initialOf(user)}</div>
                    <div className="uMeta">
                      <strong>{user.name || user.email || user.id}{user.isOwner && <em className="ownerTag"><Crown size={11} /> Owner</em>}</strong>
                      <small>{user.email || "-"} · {user.tenantId}</small>
                    </div>
                  </div>
                  <div className="uCell">
                    <select value={user.role || "交易用户"} disabled={user.isOwner} onChange={(event) => action(`/api/admin/users/${user.id}`, { role: event.target.value }, "PATCH")}><option>交易用户</option><option>管理员</option></select>
                  </div>
                  <div className="uCell uSub">
                    <StatusBadge tone={sub?.status === "active" ? "ok" : "warning"}>{sub?.source === "owner_grant" ? "Owner 免费授权" : humanize(sub?.status, "未订阅")}</StatusBadge>
                    <small>{sub?.currentPeriodEnd ? `到期 ${formatDate(sub.currentPeriodEnd)}` : "长期有效"}</small>
                  </div>
                  <div className="uCell">
                    <button type="button" className={`statusPill ${off ? "off" : "on"}`} disabled={user.isOwner} onClick={() => action(`/api/admin/users/${user.id}`, { status: off ? "active" : "disabled" }, "PATCH")}>
                      <span className="dot" />{off ? "已停用" : "启用中"}
                    </button>
                  </div>
                  <div className="uCell uActions">
                    {user.isOwner ? <span className="muted">—</span> : (
                      <>
                        <button className="miniBtn" onClick={() => action(`/api/admin/users/${user.id}/grant-free`, { months: grantMonths })}><Gift size={13} /> 赠 {grantMonths} 月</button>
                        <button className="miniBtn" onClick={() => resetUserPassword(user)}><KeyRound size={13} /> 重置密码</button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            {!filteredUsers.length && <div className="userEmpty">没有匹配的用户</div>}
          </div>

          <div className="userTableFoot">
            <span>{userSearch ? `筛选出 ${filteredUsers.length} / ${users.length} 人` : `共 ${users.length} 人`}</span>
            <span className="mono">{activeSubs} 有效订阅 · {ownerGrants} 免费授权</span>
          </div>
        </div>
      )}

      {adminTab === "billing" && (
        <div className="adminBillingWrap">
          <div className="userToolbar">
            <div className="billingLead"><WalletCards size={16} /><strong>订阅套餐定价</strong><small>{plans.length} 个套餐 · {plans.filter((plan) => plan.enabled !== false).length} 启用</small></div>
            <button className="primaryButton" onClick={() => setShowNewPlan((value) => !value)}><Plus size={15} /> 新增套餐</button>
          </div>

          {showNewPlan && (
            <div className="userCreatePanel">
              <div className="userCreateHead"><Plus size={15} /><strong>新增套餐</strong><button type="button" className="ghostClose" onClick={() => setShowNewPlan(false)}><X size={15} /></button></div>
              <div className="planCreateGrid">
                <label>套餐名<input value={newPlan.name} onChange={(event) => setNewPlan({ ...newPlan, name: event.target.value })} placeholder="如：季度订阅" /></label>
                <label>周期 · 月<input type="number" min="1" value={newPlan.months} onChange={(event) => setNewPlan({ ...newPlan, months: event.target.value })} /></label>
                <label>价格 · USDT<input type="number" min="0" value={newPlan.priceUsdt} onChange={(event) => setNewPlan({ ...newPlan, priceUsdt: event.target.value })} /></label>
                <label className="planCreateFeats">套餐权益（每行一条）<textarea value={newPlan.features} onChange={(event) => setNewPlan({ ...newPlan, features: event.target.value })} placeholder={"交易驾驶舱\nAgent 团队\n知识库"} /></label>
                <button className="primaryButton" onClick={() => { action("/api/admin/subscription-plans", { ...newPlan, features: String(newPlan.features || "").split("\n").filter(Boolean) }); setShowNewPlan(false); }}>新增套餐</button>
              </div>
            </div>
          )}

          <div className="planGrid">
            {plans.map((plan) => {
              const draft = planDrafts[plan.id] || plan;
              const off = draft.enabled === false;
              const feats = String(draft.features || "").split("\n").map((s) => s.trim()).filter(Boolean);
              const setFeats = (arr) => updatePlanDraft(plan.id, { features: arr.join("\n") });
              return (
                <div className={`planCard ${off ? "off" : ""}`} key={plan.id}>
                  <div className="planCardTop">
                    <input className="planName" value={draft.name || ""} onChange={(event) => updatePlanDraft(plan.id, { name: event.target.value })} placeholder="套餐名称" />
                    <button type="button" className={`statusPill ${off ? "off" : "on"}`} title="点击启用/停用" onClick={() => updatePlanDraft(plan.id, { enabled: off })}><span className="dot" />{off ? "已停用" : "启用中"}</button>
                  </div>
                  <div className="planPrice"><b>{draft.priceUsdt ?? 0}</b><span>USDT</span><em>/ {draft.months || 1} 月</em></div>
                  <div className="planFields">
                    <label>周期 · 月<input type="number" min="1" value={draft.months || 1} onChange={(event) => updatePlanDraft(plan.id, { months: event.target.value })} /></label>
                    <label>价格 · USDT<input type="number" min="0" value={draft.priceUsdt ?? 0} onChange={(event) => updatePlanDraft(plan.id, { priceUsdt: event.target.value })} /></label>
                  </div>
                  <div className="featureTagBox">
                    {feats.map((f, i) => (
                      <span className="featureTag" key={i}><CheckCircle2 size={12} /> {f}<button type="button" title="移除" onClick={() => setFeats(feats.filter((_, j) => j !== i))}>×</button></span>
                    ))}
                    <input
                      className="featureTagInput"
                      placeholder={feats.length ? "加一条权益，回车确认" : "输入套餐权益，回车添加"}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === ",") {
                          event.preventDefault();
                          const t = event.target.value.trim();
                          if (t) { setFeats([...feats, t]); event.target.value = ""; }
                        } else if (event.key === "Backspace" && !event.target.value && feats.length) {
                          setFeats(feats.slice(0, -1));
                        }
                      }}
                    />
                  </div>
                  <button className="primaryButton planSave" onClick={() => savePlan(plan)}>保存</button>
                </div>
              );
            })}
          </div>

          <div className="payBlock">
            <div className="payHead"><Database size={15} /><strong>TRC20 支付请求</strong><small>{payments.length ? `${payments.length} 条` : "暂无"}</small></div>
            {payments.length ? (
              <div className="payTable">
                <div className="payRow head"><span>时间</span><span>金额</span><span>套餐</span><span>状态</span></div>
                {payments.slice(0, 8).map((payment) => (
                  <div className="payRow" key={payment.id}>
                    <span className="mono">{formatTime(payment.createdAt)}</span>
                    <strong className="mono">{displayMoney(payment.amount, 2, "0")} USDT</strong>
                    <small>{payment.planId}</small>
                    <StatusBadge tone={payment.status === "confirmed" ? "ok" : "warning"}>{humanize(payment.status)}</StatusBadge>
                  </div>
                ))}
              </div>
            ) : <div className="userEmpty">暂无支付请求</div>}
          </div>
        </div>
      )}

      {adminTab === "security" && (
        <div className="secGrid">
          <div className="secCard">
            <div className="secHead"><div className="secIcon"><KeyRound size={17} /></div><div className="secHeadText"><strong>修改管理员密码</strong><small>建议保存后退出并用新密码重新登录</small></div></div>
            <label className="secField"><span>新密码</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 12 位" /></label>
            <div className="secNote"><AlertTriangle size={13} /> 修改后当前会话可能仍短暂有效，请重新登录以确保生效。</div>
            <button className="primaryButton" disabled={password.length < 12} onClick={() => action("/api/admin/password", { password })}>保存密码</button>
          </div>
          <div className="secCard danger">
            <div className="secHead"><div className="secIcon danger"><RefreshCw size={17} /></div><div className="secHeadText"><strong>清空工作数据</strong><small>危险操作 · 不可撤销</small></div></div>
            <div className="resetLists">
              <div className="resetCol clear"><span className="resetLabel">将清空</span><div className="resetChips">{["行情", "计划", "持仓", "订单", "复盘", "记忆", "任务运行", "通知"].map((item) => <em key={item}>{item}</em>)}</div></div>
              <div className="resetCol keep"><span className="resetLabel">将保留</span><div className="resetChips">{["用户", "密钥", "系统配置", "风险规则", "Agent Profile", "套餐"].map((item) => <em key={item}>{item}</em>)}</div></div>
            </div>
            <label className="secField"><span>输入 <b>RESET</b> 确认</span><input value={confirmText} onChange={(event) => setConfirmText(event.target.value)} placeholder="RESET" /></label>
            <button className="danger" disabled={confirmText !== "RESET"} onClick={() => action("/api/system/reset-operational-data", { keepAudit: true })}>清空并开始投入</button>
          </div>
        </div>
      )}
    </div>
  );
}
