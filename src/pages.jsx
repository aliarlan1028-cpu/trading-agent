import React, { useEffect, useMemo, useState } from "react";
import { LiveGrayPanel } from "./panels.jsx";
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
  KeyRound,
  Layers,
  LineChart,
  ListChecks,
  PlugZap,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Target,
  Timer,
  Trash2,
  TrendingUp,
  UserCog,
  WalletCards,
  UserPlus,
  Gift,
  Crown,
  X,
  Zap
} from "lucide-react";
import { formatMoney, displayMoney, displayPrice, displayPct, safeList, formatDateTime, formatDate, formatTime, formatDuration, humanize, humanizeList, shortId, marginUsage, smartMoneyBias, SKILL_STATE, SKILL_STATE_HELP, EV_TONE, OPEN_EXECUTION_STATES, countOpenExecutions, statusTone, systemStatus, Card, SectionTitle, MetricCard, MiniSparkline, TradingViewChart, LivePrice, StatusBadge, ProgressBar, DataTable, RiskLine, MiniChart, InsightNote, FlagTip } from "./lib.jsx";

// 驾驶舱：仪表盘（总览）+ 复盘 合并为一个导航页，用子标签切换，共享同一页头。
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
  // 可用保证金只认服务端真实写入（OKX availEq）；缺失就是 null →“未同步”，
  // 绝不回退 0——旧逻辑 ??0 把缺数据伪装成“可用为零”，进而推出保证金率 100%、“距强平 0%”的假恐慌。
  const availableMargin = data.portfolio.availableMarginUsdt ?? null;
  // 保证金口径统一走 lib.marginUsage（已用=净值−可用−冻结；缺数据=null，不造假）。
  const { usedMarginUsdt: usedMargin, marginRatePct: marginRate } = marginUsage(data.portfolio);
  const performance = data.performance || {};
  const monthlyPnl = performance.totalPnlUsdt;
  // 在途 = 真正还在交易所挂着的执行单；必须排除 blocked/setup_rejected/dry_run/failed/protection_failed 这些终态或未提交态，
  // 否则被风控拦下的单会被误报成"在途待处理"。
  const openExecutions = performance.openExecutions ?? countOpenExecutions(data.executionOrders);
  const riskChecks = data.riskChecks || [];
  const blockedChecks = riskChecks.filter((item) => ["blocked", "rejected", "risk_rejected"].includes(String(item.decision || item.result || item.status || "").toLowerCase())).length;
  const accountHealthRows = [
    ["交易所账户", `${configuredAccounts} / ${totalAccounts}`, configuredAccounts ? "ok" : "warning"],
    ["私有账户快照", latestSnapshot ? formatDateTime(latestSnapshot.createdAt) : "未同步", latestSnapshot ? "ok" : "warning"],
    ["对账状态", configuredAccounts ? humanize(latestReconcile?.status, "未对账") : "待配置", latestReconcile?.status === "ok" ? "ok" : "warning"],
    // 实盘写入是主人主动开的授权开关，不是故障——开启用中性提醒色(warn)而非红色高危(danger)。
    ["实盘写入", data.system?.liveTradingEnabled ? "已开启" : "关闭", data.system?.liveTradingEnabled ? "warn" : ""],
    ["在途执行", `${openExecutions} 个`, openExecutions ? "warning" : "ok"],
    ["近期风控阻断", `${blockedChecks} 次`, blockedChecks ? "warning" : "ok"]
  ];
  // 收益质量只做一行摘要 + 去复盘入口，胜率/盈亏比的完整拆解由复盘页承载，避免与复盘重复展示。
  // 本月交易笔数从真实成交(fills)现算——portfolio.monthlyTrades 是后端从未写入的死字段。
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const monthlyTradeCount = (data.fills || []).filter((f) => f.kind === "close" && new Date(f.createdAt) >= monthStart).length;
  const qualityRows = [
    ["交易样本", performance.trades ? `${performance.trades} 笔已平仓 · 胜率 ${performance.winRatePct}% · 盈亏比 ${performance.profitFactor ?? "-"}` : "暂无已平仓交易，完成闭环后到复盘拆解"],
    ["本月平仓", `${monthlyTradeCount} 笔`],
    ["风险等级", /高|中|低/.test(data.portfolio?.riskLabel || "") ? data.portfolio.riskLabel : "未评估"]
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
    { label: "未实现盈亏", value: configured ? displayMoney(data.portfolio.unrealizedPnl) : "未同步", sub: configured ? "浮动盈亏" : "接入后同步", tone: configured ? (Number(data.portfolio.unrealizedPnl || 0) >= 0 ? "positive" : "negative") : "" },
    { label: "累计盈亏", value: displayMoney(monthlyPnl), sub: `${performance.trades || 0} 笔已平仓`, tone: Number(monthlyPnl || 0) >= 0 ? "positive" : "warning" },
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
  // 零样本不给安全结论：一次风控检查都没跑过时显示"未评估"，而不是绿色"低风险"。
  const riskLabel = /高|中|低/.test(data.portfolio?.riskLabel || "") ? data.portfolio.riskLabel
    : (sys.killSwitch ? "高风险" : blockedChecks > 0 ? "中风险" : riskChecks.length ? "低风险" : "未评估");
  const riskTone = riskLabel.includes("高") ? "danger" : riskLabel.includes("中") || riskLabel === "未评估" ? "warning" : "ok";
  const conclusionReasons = [
    configured ? `今日剩余亏损预算 ${sys.remainingDailyLossUsdt !== null && sys.remainingDailyLossUsdt !== undefined ? `${displayMoney(sys.remainingDailyLossUsdt)} USDT` : "未授权"}` : "尚未连接交易所，当前为占位状态",
    (data.positions || []).length ? `${(data.positions || []).length} 个持仓，关注波动与杠杆` : "当前无持仓",
    blockedChecks ? `近期风控阻断 ${blockedChecks} 次，已自动降级` : riskChecks.length ? `近期 ${riskChecks.length} 次风控检查无阻断` : "尚未产生风控检查记录"
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
    // 只认 tickers 频道的真实 24h 高低；不再用"最后一根 K 线的高低"冒充（周期不同，语义失真）。
    ["24h 高 / 低", market.high24h != null ? `${displayPrice(market.high24h)} / ${displayPrice(market.low24h)}` : "未同步", ""],
    ["资金费率", market.fundingRate == null ? "未同步" : `${Number(market.fundingRate).toFixed(4)}%`, Number(market.fundingRate) >= 0 ? "pos" : "neg"],
    // OKX oiCcy 是币本位数量，不是美元；标注单位并用当前价折算 ≈USD，消除"1.38 亿"无单位的误读。
    ["未平仓 OI", market.openInterest
      ? `${formatMoney(market.openInterest, 0)} 币${Number(market.price) > 0 ? ` ≈$${formatMoney(market.openInterest * Number(market.price), 0)}` : ""}`
      : "未同步", ""],
    // 后端此行来自现货 ticker 成交额（USDT），与本卡其余的永续字段口径不同——标注清楚，不冒充永续量。
    ["成交额 24h·现货", market.volume24h || "未同步", ""],
    // 口径：SWAP 订单簿买卖各 20 档张数占比，深度浅、噪声大，只作参考。
    ["买盘占比·20档", market.bookImbalancePct == null ? "未同步" : `${market.bookImbalancePct}%`, Number(market.bookImbalancePct) >= 50 ? "pos" : "neg"],
    // 大户多空比是 BTC 的（后端只取 symbols[0]）——明确标注归属，不再贴到任意币上；
    // 判定与 AI 页/移动端共用 smartMoneyBias（阈值一处定义）。
    ...(() => {
      const ratio = sm.topTraderLongShortRatio != null ? Number(sm.topTraderLongShortRatio) : null;
      const bias = smartMoneyBias(ratio);
      const tone = bias.tone === "pos" ? "badge" : bias.tone === "neg" ? "badgeNeg" : "badgeNeutral";
      return [["大盘多空 · BTC", ratio == null ? bias.label : `${bias.label}（${ratio}）`, tone]];
    })()
  ];
  const openOrders = (data.orders || data.executionOrders || []).filter((o) => !["closed", "canceled", "cancelled", "filled", "filled_closed", "rejected"].includes(String(o.status || "").toLowerCase()));
  const recentFills = (data.fills || []).slice(0, 6);
  const walletVals = [
    ["总资产", displayMoney(data.portfolio.totalEquityUsdt)],
    ["可用", availableMargin != null ? displayMoney(availableMargin) : "未同步"],
    ["占用", usedMargin != null ? displayMoney(usedMargin) : "未同步"],
    // 冻结只显示真实同步值（OKX frozenBal）；缺失就是未同步，不再写死 0.00。
    ["冻结", data.portfolio.frozenMarginUsdt != null ? displayMoney(data.portfolio.frozenMarginUsdt, 2) : "未同步"]
  ];
  const usagePct = marginRate === null ? null : Math.min(100, Math.max(0, marginRate));
  const marginTone = usagePct == null ? "" : usagePct >= 80 ? "neg" : usagePct >= 50 ? "warn" : "pos";
  const marginToneLabel = usagePct == null ? "未同步" : usagePct >= 80 ? "偏高" : usagePct >= 50 ? "中等" : "健康";
  const donutDash = 2 * Math.PI * 31;
  const donutOffset = donutDash * (1 - (usagePct ?? 0) / 100);
  // 真实的强平距离：取自 OKX 持仓的预估强平价 liqPx 与现价的最小距离；无持仓/无数据则不展示。
  // （旧显示"距强平 = 100 - 保证金率"是保证金率的算术补数，与强平价毫无关系，纯属吓人的假指标。）
  const liqDistances = (data.positions || [])
    .map((p) => {
      const liq = Number(p.liqPx);
      const mk = Number(p.mark || (data.markets || []).find((m) => m.symbol === p.symbol)?.price);
      if (!Number.isFinite(liq) || liq <= 0 || !Number.isFinite(mk) || mk <= 0) return null;
      return Math.abs(mk - liq) / mk * 100;
    })
    .filter((v) => v != null);
  const minLiqDistancePct = liqDistances.length ? Math.min(...liqDistances) : null;

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
            <LivePrice symbol={activeSymbol} fallbackPrice={market.price} fallbackChange={market.changePct}>
              {(price, change) => {
                const up = Number(change || 0) >= 0;
                return <>
                  <b className="mono">{displayPrice(price)}</b>
                  <span className={`priceChg ${up ? "pos" : "neg"} mono`}>{up ? "▲" : "▼"} {displayPct(change)}</span>
                </>;
              }}
            </LivePrice>
            <span className="ohlcRow mono">{activeSymbol}</span>
          </div>
          <div className="chartBox tv">
            <TradingViewChart symbol={activeSymbol} interval={tvInterval} livePrice={market.price} />
          </div>
        </div>
        <div className="termCard snapCard">
          <div className="secLabel">市场快照</div>
          <div className="snapList">
            <LivePrice symbol={activeSymbol} fallbackPrice={market.price} fallbackChange={market.changePct}>
              {(livePrice, liveChange) => (
                <>
                  <div className="snapRow"><span>最新价</span><b className="mono">{displayPrice(livePrice)}</b></div>
                  <div className="snapRow"><span>24h 涨跌</span><b className={`mono ${Number(liveChange) >= 0 ? "pos" : "neg"}`}>{displayPct(liveChange)}</b></div>
                </>
              )}
            </LivePrice>
            {snapRows.slice(2).map(([k, v, tone]) => (
              <div className="snapRow" key={k}>
                <span>{k}</span>
                {String(tone).startsWith("badge")
                  ? <b className={`snapBadge ${tone === "badge" ? "pos" : tone === "badgeNeg" ? "neg" : "neutral"}`}>{v}</b>
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
                  {/* 类型列只显示真实类型；缺失显示 —，不再拿订单状态冒充类型 */}
                  <span className="ordType">{humanize(o.type || o.kind, "—")}</span>
                  {/* 市价单价格为 0（OKX px 为空）时显示"市价"，不再显示 0.00 */}
                  <span className="ordPx">{(() => { const px = o.price ?? o.avgPrice ?? o.entry; return Number(px) > 0 ? displayMoney(px, 2) : (/market/i.test(String(o.type || "")) || Number(px) === 0 ? "市价" : "—"); })()}</span>
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
          {/* 真实口径：OKX 持仓的预估强平价 liqPx 与现价的最小距离；无持仓时如实显示无风险敞口。 */}
          <div className="liqTop"><span>距强平</span><b className="mono">{minLiqDistancePct != null ? `${formatMoney(minLiqDistancePct, 1)}%` : (data.positions || []).length ? "未同步" : "无持仓"}</b></div>
          {minLiqDistancePct != null && <div className="liqBar2"><span className="liqMark2" style={{ left: `${Math.min(100, Math.max(0, 100 - minLiqDistancePct))}%` }} /></div>}
          {minLiqDistancePct != null && <div className="liqLegend2 mono"><span>SAFE</span><span>WARN</span><span>LIQ</span></div>}
        </div>
        <div className="termCard">
          <div className="balLabel">交易所同步</div>
          <div className="exSyncList">
            {/* 状态取真实同步结果（readSyncStatus），不再"本地填了 key 就亮绿灯 synced"。 */}
            {(data.exchangeAccounts || []).map((a) => {
              const st = String(a.readSyncStatus || "");
              const ok = st === "ok";
              const label = ok ? "synced" : st ? humanize(st) : (a.readEnabled ? "未同步" : "未配置");
              return (
                <div className="exSyncRow2" key={a.id}>
                  <span>{a.exchange}</span>
                  <span className={`exSyncState ${ok ? "on" : "off"} mono`}><i />{label}</span>
                </div>
              );
            })}
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
                  {/* 着色与全端 smartMoneyBias 同阈值（1.05/0.95），不再用 >=1 二分与快照卡自相矛盾 */}
                  <div><span>大户持仓多空比</span><strong className={(() => { const t = smartMoneyBias(sm.topTraderLongShortRatio).tone; return t === "pos" ? "positive" : t === "neg" ? "negative" : ""; })()}>{sm.topTraderLongShortRatio ?? "未取"}</strong></div>
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
    { name: "高影响事件前停止开仓", scope: "event", level: "L1", action: "pause_opening", conditionSpec: { field: "event.maxImpact", operator: "gte", value: 80 }, event: "宏观事件（影响 ≥ 80）", condition: "事件前 30 分钟", description: "重大宏观事件公布前 30 分钟暂停新开仓，事件落地后人工确认恢复" }, // 阻断型必须带可编译条件(审计 H2)
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
          {!eventRows.length && <div className="emptyPanel emptyPanelAction"><strong>暂无事件源</strong><span className="muted">默认来源已移除，请自行配置从哪拉取信息</span><button className="secondaryButton" onClick={() => ui.openPanel("eventSources")}><Plus size={14} /> 配置事件源</button></div>}
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
          <div className="focusSub">{!primaryEvent.due ? "待定发布时间" : (dueTs && dueTs > Date.now() ? `预计发布 ${formatDateTime(primaryEvent.due)} · 倒计时` : `发布于 ${formatDateTime(primaryEvent.due)}`)}</div>
          <div className="cd3">
            {cd
              ? <>
                  <div className="cd3b"><b className="mono">{String(cd.d).padStart(2, "0")}</b><span>天</span></div>
                  <div className="cd3b"><b className="mono">{String(cd.h).padStart(2, "0")}</b><span>时</span></div>
                  <div className="cd3b hot"><b className="mono">{String(cd.m).padStart(2, "0")}</b><span>分</span></div>
                </>
              : <div className="cd3b full"><b className="mono">{formatDateTime(primaryEvent.due, "待定")}</b><span>{dueTs && dueTs <= Date.now() ? "已发布" : "待定"}</span></div>}
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

const CONCEPT_COLORS = { 技术: "#2A6FDB", 风控: "#C43F28", 心理: "#7A4FD0", 宏观: "#D06A22", 结构: "#1F7A50", 资金: "#B08900", 其他: "#8a8172" };

// 概念图谱 v2：力导向布局——相关概念自动聚簇、节点按连接数变大、曲线连边、柔光晕。
// 布局确定性：按类别分簇的种子位置 + 固定迭代的力松弛（无随机，避免每次渲染乱跳）。
function conceptLayout(nodes, edges, W, H) {
  const cats = [...new Set(nodes.map((c) => c.category || "其他"))];
  const P = nodes.map((c, i) => {
    const g = cats.indexOf(c.category || "其他");
    const ga = (g / Math.max(1, cats.length)) * 2 * Math.PI;
    const cx = W / 2 + 120 * Math.cos(ga), cy = H / 2 + 80 * Math.sin(ga);
    const a = i * 2.399; // 黄金角散布，避免同簇初始重叠
    return { x: cx + 34 * Math.cos(a), y: cy + 34 * Math.sin(a) };
  });
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  for (let it = 0; it < 240; it += 1) {
    const F = P.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < P.length; i += 1) {
      for (let j = i + 1; j < P.length; j += 1) {
        const dx = P[i].x - P[j].x, dy = P[i].y - P[j].y; const d = Math.hypot(dx, dy) || 0.01;
        const f = 1700 / (d * d); F[i].x += dx / d * f; F[i].y += dy / d * f; F[j].x -= dx / d * f; F[j].y -= dy / d * f;
      }
    }
    edges.forEach(([a, b]) => {
      const dx = P[b].x - P[a].x, dy = P[b].y - P[a].y; const d = Math.hypot(dx, dy) || 0.01;
      const f = (d - 66) * 0.02; F[a].x += dx / d * f; F[a].y += dy / d * f; F[b].x -= dx / d * f; F[b].y -= dy / d * f;
    });
    P.forEach((p, i) => {
      F[i].x += (W / 2 - p.x) * 0.008; F[i].y += (H / 2 - p.y) * 0.008;
      p.x = clamp(p.x + clamp(F[i].x, -6, 6), 34, W - 34);
      p.y = clamp(p.y + clamp(F[i].y, -6, 6), 28, H - 28);
    });
  }
  return P;
}

export function ConceptGraph({ concepts = [] }) {
  const [sel, setSel] = useState(null);
  const [hover, setHover] = useState(null);
  const W = 520, H = 360;
  const { nodes, pos, edges, deg } = useMemo(() => {
    // 去重：同名概念（被不同书重复蒸馏）合并为一个节点、关系取并集——否则重名节点各自孤立，
    // 连线只会连到 nameIdx 里最后覆盖的那一个，其余同名节点变成"没有连线的孤点"。
    const byName = new Map();
    (concepts || []).forEach((c) => {
      const key = String(c.name || "").trim();
      if (!key) return;
      const rel = (c.relatedTo || []).map((r) => String(r).trim()).filter(Boolean);
      const ex = byName.get(key);
      if (ex) {
        ex.relatedTo = [...new Set([...ex.relatedTo, ...rel])];
        if (!ex.tradingMeaning) ex.tradingMeaning = c.tradingMeaning || c.meaning || ex.tradingMeaning;
      } else {
        byName.set(key, { ...c, name: key, relatedTo: [...new Set(rel)] });
      }
    });
    const nodes = [...byName.values()].slice(0, 20);
    const nameIdx = {};
    nodes.forEach((c, i) => { nameIdx[c.name] = i; });
    const edges = [];
    nodes.forEach((c, i) => (c.relatedTo || []).forEach((rn) => { const j = nameIdx[String(rn).trim()]; if (j != null && j > i) edges.push([i, j]); }));
    const deg = nodes.map(() => 0);
    edges.forEach(([a, b]) => { deg[a] += 1; deg[b] += 1; });
    const pos = nodes.length ? conceptLayout(nodes, edges, W, H) : [];
    return { nodes, pos, edges, deg };
  }, [concepts]);
  if (!nodes.length) return <div className="emptyPanel" style={{ minHeight: 180 }}>导入资料后自动抽取概念与关系图谱</div>;

  const focus = sel != null ? sel : hover;
  const radius = (i) => 5 + Math.min(7, deg[i] * 1.4);
  const connected = (i) => focus == null || i === focus || edges.some(([a, b]) => (a === focus && b === i) || (b === focus && a === i));
  const cats = [...new Set(nodes.map((c) => c.category || "其他"))];
  const shown = focus != null ? nodes[focus] : null;
  return (
    <div className="conceptGraph">
      <div className="cgWrap">
        <svg viewBox={`0 0 ${W} ${H}`} className="cgSvg" preserveAspectRatio="xMidYMid meet">
          {edges.map(([a, b], k) => {
            const hot = focus != null && (a === focus || b === focus);
            const cold = focus != null && !hot;
            const mx = (pos[a].x + pos[b].x) / 2;
            const my = (pos[a].y + pos[b].y) / 2 - Math.hypot(pos[a].x - pos[b].x, pos[a].y - pos[b].y) * 0.12;
            return <path key={k} className={`cgEdge ${hot ? "hot" : cold ? "cold" : ""}`} d={`M${pos[a].x} ${pos[a].y} Q${mx} ${my} ${pos[b].x} ${pos[b].y}`} />;
          })}
          {nodes.map((c, i) => {
            const col = CONCEPT_COLORS[c.category] || CONCEPT_COLORS.其他;
            const rr = radius(i);
            const foc = i === focus;
            const w = (c.name || "").length * 11 + 8;
            return (
              <g key={c.id || i} className={`cgNode ${focus != null && !connected(i) ? "dim" : ""}`}
                onClick={() => setSel(sel === i ? null : i)}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <circle className="cgHalo" cx={pos[i].x} cy={pos[i].y} r={rr + 7} fill={col} opacity={foc ? 0.24 : 0.12} />
                <circle className="cgDot" cx={pos[i].x} cy={pos[i].y} r={foc ? rr + 1.5 : rr} fill={col} />
                <rect className="cgLabelBg" x={pos[i].x - w / 2} y={pos[i].y - rr - 16} width={w} height="14" rx="4" />
                <text className="cgLabel" x={pos[i].x} y={pos[i].y - rr - 9} textAnchor="middle" fill={col}>{c.name}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="cgLegend">{cats.map((cat) => <span key={cat}><i style={{ background: CONCEPT_COLORS[cat] || CONCEPT_COLORS.其他 }} />{cat}</span>)}</div>
      {shown
        ? <div className="cgDetail"><b style={{ color: CONCEPT_COLORS[shown.category] || CONCEPT_COLORS.其他 }}>{shown.name}</b><span className="cgCat">{shown.category || "其他"}</span><p>{shown.tradingMeaning || shown.meaning || "—"}</p></div>
        : <div className="cgHint">点击概念看含义与关联 · 节点越大关联越多 · {nodes.length} 概念 / {edges.length} 关系</div>}
    </div>
  );
}

// SKILL_STATE / SKILL_STATE_HELP 已收敛到 lib.jsx（桌面/移动共用单一来源）。
// 经典生命周期(历史验证→前向→人工批准)
const FUNNEL_CLASSIC = [
  { key: "draft", label: "方法草案", tab: "methods" },
  { key: "compiled", label: "已编译", tab: "skills" },
  { key: "validated", label: "已验证", tab: "skills" },
  { key: "papering", label: "模拟中", tab: "skills" },
  { key: "active", label: "已上岗", tab: "skills" }
];
// 小额实盘验证模式:编译即上岗试用,真实成绩转正
const FUNNEL_LIVE = [
  { key: "draft", label: "方法草案", tab: "methods" },
  { key: "compiled", label: "已编译", tab: "skills" },
  { key: "probation", label: "小额试用", tab: "skills" },
  { key: "active", label: "已转正", tab: "skills" }
];

function SkillStateLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="kLegend">
      <button className="kLegendHead" onClick={() => setOpen((v) => !v)}>
        <HelpBadge /> 这些状态是什么意思？
        <ChevronDown size={13} className={open ? "flip" : ""} />
      </button>
      {open && (
        <div className="kLegendBody">
          {SKILL_STATE_HELP.map(([label, tone, desc]) => (
            <div className="kLegendRow" key={label}>
              <span className={`evBadge ${EV_TONE[tone] || ""}`}>{label}</span>
              <span className="kLegendDesc">{desc}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function HelpBadge() { return <span className="kHelpDot">?</span>; }

function KnowledgeOnboarding({ funnelCounts, sourceCount, liveMode, ui, action, goMethods, goSkills }) {
  const KEY = "knowGuideCollapsed";
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } });
  const toggle = () => setCollapsed((c) => { const n = !c; try { localStorage.setItem(KEY, n ? "1" : "0"); } catch {} return n; });

  // 小额验证模式:草案→编译上岗试用→真实成绩转正;经典模式:草案→编译验证→人工批准。
  const inPipeline = liveMode
    ? funnelCounts.compiled + funnelCounts.probation
    : funnelCounts.compiled + funnelCounts.validated + funnelCounts.papering;
  const graduated = funnelCounts.active;
  // 当前该做的一步：没知识源→喂料；没技能进流水线→编译；试用中还没转正→等真实成绩；已有转正→完成。
  const step = sourceCount === 0 ? 1 : (inPipeline === 0 && graduated === 0) ? 2 : graduated === 0 ? 3 : 4;

  const steps = liveMode ? [
    { n: 1, icon: BookOpen, title: "喂知识", desc: "导入交易书籍、文章或网页。系统自动蒸馏出「交易方法草案」和「风控纪律」。", cta: "导入知识源", onClick: () => ui.openPanel("knowledgeImport") },
    { n: 2, icon: Rocket, title: "编译上岗试用", desc: "方法草案编译成技能后直接上岗「小额试用」——用真实小额成交检验，无需历史回测/人工批准。", cta: "去技能流水线", onClick: goSkills },
    { n: 3, icon: ShieldCheck, title: "真实成绩转正", desc: "试用期用真实成交复盘：达标（足够笔数且盈亏比过关）自动转正为「已验证」，不达标自动退役。", cta: "去技能流水线", onClick: goSkills }
  ] : [
    { n: 1, icon: BookOpen, title: "喂知识", desc: "导入交易书籍、文章或网页。系统自动蒸馏出「交易方法草案」和「风控纪律」。", cta: "导入知识源", onClick: () => ui.openPanel("knowledgeImport") },
    { n: 2, icon: Rocket, title: "编译 + 验证", desc: "把方法草案编译成技能，自动跑历史三窗回测 + 纯前向模拟盘。跑不过的不能上岗。", cta: "去方法草案", onClick: goMethods },
    { n: 3, icon: ShieldCheck, title: "人工批准上岗", desc: "只有你亲自批准的技能才会进入实盘决策。低信任（按书名综述）门槛更严。", cta: "去技能流水线", onClick: goSkills }
  ];

  if (step === 4 && collapsed) {
    return (
      <button className="kGuideDone" onClick={toggle}>
        <CheckCircle2 size={14} /> 已有 {funnelCounts.active} 个技能上岗 · 点开查看上手引导
      </button>
    );
  }

  return (
    <div className="kGuide">
      <div className="kGuideHead">
        <span className="kGuideTitle"><Sparkles size={14} /> 知识库怎么用？三步让 AI 交易员变强</span>
        <button className="kGuideToggle" onClick={toggle}>{collapsed ? "展开" : "收起"}</button>
      </div>
      {!collapsed && (
        <div className="kGuideSteps">
          {steps.map((s) => {
            const state = s.n < step ? "done" : s.n === step ? "active" : "todo";
            const Icon = state === "done" ? CheckCircle2 : s.icon;
            return (
              <div className={`kGuideStep ${state}`} key={s.n}>
                <div className="kGuideStepTop"><span className="kGuideNum"><Icon size={15} /></span><b>{s.title}</b>{state === "active" && <span className="kGuideNow">现在做这步</span>}{state === "done" && <span className="kGuideOk">已完成</span>}</div>
                <p>{s.desc}</p>
                <button className={state === "active" ? "primaryButton sm" : "secondaryButton sm"} onClick={s.onClick}>{s.cta} →</button>
              </div>
            );
          })}
        </div>
      )}
      {!collapsed && step === 4 && <div className="kGuideAllDone"><CheckCircle2 size={13} /> 全部打通：已有 {funnelCounts.active} 个技能上岗。继续喂新书或退役失效技能来持续进化。</div>}
    </div>
  );
}

export function KnowledgeSkillsPage({ data, action, ui, embedded = false }) {
  // 两大平级板块:知识(让 AI 更懂) / 能力与工具(AI 的手脚)。外部能力从末尾附属 Tab 提升为半壁江山。
  const [domain, setDomain] = useState("knowledge");
  const [tab, setTab] = useState("methods");
  const KNOWLEDGE_TABS = ["methods", "skills", "rules", "graph"];
  function goKnowledge(next) { setDomain("knowledge"); if (next) setTab(next); else if (!KNOWLEDGE_TABS.includes(tab)) setTab("methods"); }
  const [rag, setRag] = useState("");
  const [expanded, setExpanded] = useState(null);      // 展开的行 id
  const [srcFilter, setSrcFilter] = useState("");       // 按来源书筛选
  const [showArchived, setShowArchived] = useState(false); // 是否展开"已归档"（编译失败/已被替代/已退役）
  const knowledge = data.knowledge || {};
  const sourceCount = knowledge.sources?.length || 0;
  const conceptCount = knowledge.conceptCards?.length || 0;
  const ruleCount = knowledge.ruleProposals?.length || 0;
  const approvedRuleCount = (knowledge.ruleProposals || []).filter((r) => r.status === "已批准").length;
  const chunkCount = knowledge.chunks?.length || 0;
  const methods = knowledge.tradingMethods || [];
  const tradingSkills = knowledge.tradingSkills || [];
  const skills = data.skills || [];
  const mcp = data.mcpServers || [];
  const mcpConnected = mcp.filter((item) => item.status === "connected").length;
  const cites = latestAnalysisRows(data) || [];

  // 漏斗计数：草案 = 尚未编译成活跃技能的方法；其余按技能 stage 聚合。
  const compiledMethodIds = new Set(tradingSkills.filter((s) => !["retired", "superseded"].includes(s.status)).map((s) => s.sourceMethodId));
  const liveMode = data.system?.skillLiveValidationMode !== false;
  const funnelCounts = {
    draft: methods.filter((m) => !compiledMethodIds.has(m.id)).length,
    compiled: tradingSkills.filter((s) => SKILL_STATE[s.status]?.stage === "compiled").length,
    validated: tradingSkills.filter((s) => SKILL_STATE[s.status]?.stage === "validated").length,
    papering: tradingSkills.filter((s) => SKILL_STATE[s.status]?.stage === "papering").length,
    probation: tradingSkills.filter((s) => s.status === "live_probation").length,
    active: tradingSkills.filter((s) => s.status === "active").length
  };
  const FUNNEL = liveMode ? FUNNEL_LIVE : FUNNEL_CLASSIC;
  // 来源书籍列表（方法/技能共用的筛选维度）
  const sourceTitles = [...new Set([...methods.map((m) => m.source?.title), ...tradingSkills.map((s) => s.sourceTitle)].filter(Boolean))];
  const matchSrc = (title) => !srcFilter || title === srcFilter;

  return (
    <div className="pageStack termPage knowPage">
      {!embedded && <TermHead title="知识与技能" code="KNOWLEDGE · SKILLS" sub="喂知识、装技能、接工具，让 AI 交易员持续变强" />}

      {/* 两大平级板块:知识(让 AI 更懂) · 能力与工具(AI 的手脚)——两者都喂给行情分析,平起平坐 */}
      <div className="kDomains">
        <button className={`kDomain ${domain === "knowledge" ? "on" : ""}`} onClick={() => goKnowledge()}>
          <span className="kDomainT">知识</span>
          <span className="kDomainS">让 AI 更懂 · 方法/纪律/概念/RAG</span>
          <span className="kDomainN mono">{methods.length + tradingSkills.filter((s) => !["compile_failed", "superseded", "retired"].includes(s.status)).length + ruleCount + conceptCount}</span>
        </button>
        <button className={`kDomain ${domain === "capabilities" ? "on" : ""}`} onClick={() => setDomain("capabilities")}>
          <span className="kDomainT">能力与工具</span>
          <span className="kDomainS">AI 的手脚 · Skill/插件/MCP/ClawHub</span>
          <span className="kDomainN mono">{skills.length + mcp.length}</span>
        </button>
      </div>

      {domain === "knowledge" && <KnowledgeOnboarding
        funnelCounts={funnelCounts}
        sourceCount={sourceCount}
        liveMode={liveMode}
        ui={ui}
        action={action}
        goMethods={() => goKnowledge("methods")}
        goSkills={() => goKnowledge("skills")}
      />}

      {/* 漏斗状态栏：一眼看清整条流水线卡在哪 */}
      {domain === "knowledge" && <div className="kFunnel">
        {FUNNEL.map((f, i) => (
          <React.Fragment key={f.key}>
            {i > 0 && <span className="kFunnelArrow">›</span>}
            <button className={`kFunnelStage ${tab === f.tab && (f.key === "draft" || tab === "skills") ? "on" : ""}`} onClick={() => setTab(f.tab)}>
              <b className="mono">{funnelCounts[f.key]}</b>
              <span>{f.label}</span>
            </button>
          </React.Fragment>
        ))}
        <div className="kFunnelSide">
          <span className="kFunnelKv"><b className="mono">{sourceCount}</b> 知识源</span>
          <span className="kFunnelKv"><b className="mono">{approvedRuleCount}/{ruleCount}</b> 已批准纪律</span>
        </div>
      </div>}

      {/* 知识板块的子 Tab（外部能力已提升为平级大区，不再挤在这排） */}
      {domain === "knowledge" && <div className="kTabs">
        {[["methods", "方法草案", methods.length], ["skills", "技能流水线", tradingSkills.filter((s) => !["compile_failed", "superseded", "retired"].includes(s.status)).length], ["rules", "风控纪律", ruleCount], ["graph", "概念图谱", conceptCount]].map(([k, label, n]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label} <span className="kTabN mono">{n}</span></button>
        ))}
        {sourceTitles.length > 0 && (tab === "methods" || tab === "skills") && (
          <select className="kSrcFilter" value={srcFilter} onChange={(e) => setSrcFilter(e.target.value)}>
            <option value="">全部来源书</option>
            {sourceTitles.map((t) => <option key={t} value={t}>《{t}》</option>)}
          </select>
        )}
      </div>}

      {/* —— 方法草案 Tab —— */}
      {domain === "knowledge" && tab === "methods" && (
        <div className="termCard">
          <div className="kHead"><span className="secLabel">交易方法草案 · 仅供研究，需走验证才上岗</span><span className="hypoLegend mono">{methods.filter((m) => matchSrc(m.source?.title)).length} 条</span></div>
          {!methods.length && <div className="emptyPanel">导入书籍后自动蒸馏交易方法草案</div>}
          <div className="kRowList">
            {methods.filter((m) => matchSrc(m.source?.title)).map((m) => {
              const compiled = compiledMethodIds.has(m.id);
              const open = expanded === m.id;
              return (
                <div className={`kRow ${open ? "open" : ""}`} key={m.id}>
                  <button className="kRowHead" onClick={() => setExpanded(open ? null : m.id)}>
                    <span className={`mDir ${m.direction}`}>{m.direction === "short" ? "空" : m.direction === "long" ? "多" : "多空"}</span>
                    <b className="kRowName">{m.name}</b>
                    <span className="kRowMeta mono">{m.marketRegime} · {m.timeframe}</span>
                    {m.source?.title && <span className="hypoSrc">《{m.source.title}》</span>}
                    <span className={`evBadge ${compiled ? "ok" : ""}`}>{compiled ? "已编译" : "草案"}</span>
                    <ChevronDown size={14} className="kRowChevron" />
                  </button>
                  {open && (
                    <div className="kRowBody">
                      <div className="methodCond">
                        <span><i>进场</i>{m.entry || "-"}{m.confirmation ? `（确认：${m.confirmation}）` : ""}</span>
                        <span><i>止损</i>{m.stop || "-"}</span>
                        <span><i>止盈</i>{m.takeProfit || "-"}</span>
                        {m.invalidation && <span className="mInval"><i>不做</i>{m.invalidation}</span>}
                      </div>
                      {m.rationale && <div className="hypoWhy">依据：{m.rationale}</div>}
                      {!compiled && <button className="primaryButton sm" onClick={() => action(`/api/knowledge/methods/${m.id}/compile`, {})}>编译为技能草案 →</button>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* —— 技能流水线 Tab —— */}
      {domain === "knowledge" && tab === "skills" && (
        <div className="termCard">
          <div className="kHead"><span className="secLabel">知识交易技能 · 编译→历史验证→模拟盘→批准→上岗</span><div style={{ display: "flex", gap: 6 }}>{(() => { const n = tradingSkills.filter((k) => ["compiled", "historical_rejected"].includes(k.status)).length; return n > 0 && <button className="primaryButton sm" onClick={() => { if (window.confirm(`批量历史验证 ${n} 个技能?后台执行需数分钟,通过的自动进入「待模拟」。`)) action("/api/knowledge/skills/validate-all", {}); }}>一键历史验证({n})</button>; })()}<button className="secondaryButton sm" onClick={() => action("/api/knowledge/skills/sync", {})}>同步状态</button></div></div>
          <SkillStateLegend />
          {!tradingSkills.length && <div className="emptyPanel">还没有技能。到「方法草案」把方法编译成技能草案后在此推进验证</div>}
          {(() => {
            const ARCHIVED = new Set(["compile_failed", "superseded", "retired"]);
            const filtered = tradingSkills.filter((s) => matchSrc(s.sourceTitle));
            // 可操作优先排序:待批准/待模拟/模拟中浮到最顶,历史未通过沉底——
            // 用户实锤:唯一一条"待模拟"埋在 48 条"历史未通过"里找不到。
            const STATUS_RANK = { paper_validated: 0, historical_validated: 1, paper_validating: 2, compiled: 3, degraded: 4, historical_rejected: 5, paper_rejected: 6 };
            const live = filtered.filter((s) => !ARCHIVED.has(s.status))
              .sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9));
            const archived = filtered.filter((s) => ARCHIVED.has(s.status));
            const renderRow = (skill) => {
              const st = SKILL_STATE[skill.status] || { label: skill.status, tone: "" };
              const open = expanded === skill.id;
              return (
                <div className={`kRow ${open ? "open" : ""}`} key={skill.id}>
                  <button className="kRowHead" onClick={() => setExpanded(open ? null : skill.id)}>
                    {skill.spec?.direction && <span className={`mDir ${skill.spec.direction}`}>{skill.spec.direction === "short" ? "空" : "多"}</span>}
                    <b className="kRowName">{skill.name} <span className="mono kRowVer">v{skill.version}</span></b>
                    <span className="kRowMeta mono">{skill.spec?.templateLabel || "未编译"} · {skill.spec?.timeframe || "-"}</span>
                    {skill.sourceTitle && <span className="hypoSrc">《{skill.sourceTitle}》</span>}
                    {skill.spec?.lowTrust && <span className="evBadge warn" title="按书名生成的模型综述：历史验证/模拟盘门槛更严，必须人工批准才实盘">低信任</span>}
                    <span className={`evBadge ${EV_TONE[st.tone] || ""}`}>{st.label}</span>
                    {st.next && <span className="kRowAction" onClick={(e) => { e.stopPropagation(); action(`/api/knowledge/skills/${skill.id}/${st.next.action}`, {}); }}>{st.next.label} →</span>}
                    {skill.status === "compile_failed" && skill.sourceMethodId && <span className="kRowAction" onClick={(e) => { e.stopPropagation(); action(`/api/knowledge/methods/${skill.sourceMethodId}/compile`, {}); }}>重新编译 →</span>}
                    <ChevronDown size={14} className="kRowChevron" />
                  </button>
                  {open && (
                    <div className="kRowBody">
                      {skill.compileErrors?.length > 0 && <div className="hypoWhy neg">不能执行：{skill.compileErrors.join("；")}</div>}
                      {skill.status === "superseded" && <div className="hypoWhy">已被同源方法的更新版本替代，仅作血缘追溯，不参与决策。</div>}
                      {skill.validation && <div className="hypoWhy">历史三窗：训练 {skill.validation.train?.trades || 0} · 验证 {skill.validation.validation?.trades || 0} · 测试 {skill.validation.test?.trades || 0} 笔</div>}
                      {skill.liveMetrics && <div className="hypoWhy">实盘归因：{skill.liveMetrics.trades} 笔 · 胜率 {skill.liveMetrics.winRatePct}% · PF {skill.liveMetrics.profitFactor ?? "-"}</div>}
                      {!["retired", "superseded"].includes(skill.status) && <button className="dangerTextButton sm" onClick={() => { if (window.confirm(`退役「${skill.name}」v${skill.version}？`)) action(`/api/knowledge/skills/${skill.id}/retire`, { reason: "用户手动退役" }); }}><Trash2 size={13} /> 退役</button>}
                    </div>
                  )}
                </div>
              );
            };
            return (
              <>
                <div className="kRowList">
                  {live.map(renderRow)}
                  {!live.length && filtered.length > 0 && <div className="emptyPanel">当前没有在流水线中的活技能，只有归档技能（见下方）。</div>}
                </div>
                {archived.length > 0 && (
                  <div className="kArchive">
                    <div className="kArchiveHead">
                      <button className="kArchiveToggle" onClick={() => setShowArchived((v) => !v)}>
                        <ChevronDown size={13} className={showArchived ? "flip" : ""} /> 已归档 {archived.length}（编译失败 / 已被替代 / 已退役）
                      </button>
                      <button className="dangerTextButton sm" title="删除全部编译失败与已被替代的技能（已退役保留）" onClick={() => { if (window.confirm(`清理归档：删除编译失败与已被替代的技能？（已退役保留，审计日志不受影响）`)) action("/api/knowledge/skills/purge-archived", {}); }}><Trash2 size={13} /> 清理</button>
                    </div>
                    {showArchived && <div className="kRowList">{archived.map(renderRow)}</div>}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* —— 风控纪律 Tab —— */}
      {domain === "knowledge" && tab === "rules" && (
        <div className="termCard">
          <div className="kHead"><span className="secLabel">风控纪律 · 批准后进 AI 提示词 + 风控引擎</span><button className="agLink" onClick={() => ui.openPanel("ruleLibrary")}>全部规则 · 批准/去重 ›</button></div>
          {!ruleCount && <div className="emptyPanel">导入资料后自动抽取风控纪律</div>}
          <div className="kRuleCards">
            {(knowledge.ruleProposals || []).slice(0, 12).map((r) => (
              <button className="kRuleCard" key={r.id} onClick={() => ui.openPanel("ruleLibrary")}>
                <div className="kRuleTop"><b>{r.name}</b>{r.category && <span className="kRuleCat">{r.category}</span>}<span className={`evBadge ${r.status === "已批准" ? "ok" : ""}`}>{humanize(r.status, "待审批")}</span></div>
                <div>{r.description || "基于专家知识库生成"}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* —— 概念图谱 Tab —— */}
      {domain === "knowledge" && tab === "graph" && (
        <div className="termCard"><div className="kHead"><span className="secLabel">概念图谱</span></div><ConceptGraph concepts={knowledge.conceptCards || []} /></div>
      )}

      {/* —— 能力与工具板块（Skills 全量可滚动 + 逐项操作 + MCP）—— */}
      {domain === "capabilities" && (() => {
        const enabledCount = skills.filter((s) => s.status === "已启用" || s.native).length;
        const disabledCount = skills.filter((s) => s.status === "已禁用" || s.status === "已回滚").length;
        return (
          <>
            <div className="kCapHealth">
              <div className="kCapStat ok"><b className="mono">{enabledCount}</b><span>可用 · Agent 现在就能调用</span></div>
              <div className="kCapStat warn"><b className="mono">{skills.filter((s) => !s.native && s.status !== "已启用" && s.status !== "已禁用" && s.status !== "已回滚").length}</b><span>待审核 · 确认安全后启用</span></div>
              <div className="kCapStat"><b className="mono">{disabledCount}</b><span>已停用 · 当前不被调用</span></div>
            </div>
            <div className="kGrid2">
              <div className="termCard">
                <div className="kHead"><span className="secLabel">Skills 中心（{skills.length}）</span><button className="agLink" onClick={() => ui.openPanel("skillImport")}>导入 / 详情 ›</button></div>
                <div className="kSkillListScroll">
                  {skills.map((sk) => {
                    const on = sk.status === "已启用" || sk.native;
                    const scanned = ["通过", "需复核"].includes(sk.scan);
                    return (
                      <div className="kSkillRow2" key={sk.id}>
                        <span className="kSkillIcon"><Sparkles size={14} /></span>
                        <div className="kSkillInfo"><b>{sk.name}</b> <span className="mono">{sk.native ? "内置" : `v${sk.version || 1}`}</span></div>
                        <span className={`evBadge ${on ? "ok" : ""}`}>{sk.status || (sk.native ? "内置" : "待扫描")}</span>
                        <span className="kSkillActs">
                          <button title="详情" onClick={() => ui.openPanel("skillImport")}>详情</button>
                          {!sk.native && <button title="沙箱运行" onClick={() => action(`/api/skills/${sk.id}/run-sandbox`, {})}>运行</button>}
                          {!sk.native && (on
                            ? <button title="停用" onClick={() => action(`/api/skills/${sk.id}/disable`, {})}>停用</button>
                            : <button title={scanned ? "启用" : "先扫描"} onClick={() => action(`/api/skills/${sk.id}/${scanned ? "install" : "scan"}`, {})}>{scanned ? "启用" : "扫描"}</button>)}
                          {!sk.native && <button className="dangerText" title="删除" onClick={() => { if (window.confirm(`删除 Skill「${sk.name}」？`)) action(`/api/skills/${sk.id}`, {}, "DELETE"); }}>删除</button>}
                        </span>
                      </div>
                    );
                  })}
                  {!skills.length && <div className="emptyPanel">暂无 Skill——点右上「导入」从 GitHub 或粘贴 Skill.md 添加分析工具</div>}
                </div>
                <div className="kImportBtns"><button onClick={() => ui.openPanel("skillImport")}><GitBranch size={13} /> GitHub 导入</button><button onClick={() => ui.openPanel("skillImport")}>粘贴 Skill.md</button></div>
              </div>
              <div className="termCard">
                <div className="kHead"><span className="secLabel">MCP 工具</span><span className="mono">{mcpConnected}/{mcp.length} 已连接</span></div>
                <div className="kMcpChips">{mcp.map((m) => <span className={`kMcpChip ${m.status === "connected" ? "on" : ""}`} key={m.id}>{m.name}</span>)}{!mcp.length && <span className="kMcpChip more">未接入</span>}</div>
                <p className="kCapHint">已启用的 Skill 与 MCP 工具会自动进入 AI 的工具表，由它按当前分析需要自动挑选调用——你不必手动指派。</p>
              </div>
            </div>
          </>
        );
      })()}

      {/* 知识源常驻精简条：导入入口 + 最近几本，点开看全部（仅知识板块） */}
      {domain === "knowledge" && <div className="termCard kSourceBar">
        <div className="kHead"><span className="secLabel">知识源（{sourceCount}）</span><button className="agLink" onClick={() => ui.openPanel("knowledgeList")}>全部 ›</button></div>
        <div className="kSourceChips">
          {(knowledge.sources || []).slice(0, 8).map((s) => <button className="kSourceChip" key={s.id} onClick={() => ui.openPanel("knowledgeList")} title={s.title}>{(s.title || "").slice(0, 14)}<i className={`kSrcDot ${s.status === "parsed" ? "ok" : ""}`} /></button>)}
          <button className="kSourceChip add" onClick={() => ui.openPanel("knowledgeImport")}><Plus size={13} /> 导入</button>
        </div>
      </div>}

      {domain === "knowledge" && <div className="termCard">
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
      </div>}
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
  // 密钥权限读真实账户字段，不再写死"允许/禁止"（无账户时如实显示"未配置"）。
  const anyRead = exAccounts.some((a) => a.readEnabled);
  const anyTrade = exAccounts.some((a) => a.tradeEnabled);
  const anyWithdraw = exAccounts.some((a) => a.withdrawEnabled);
  const keyPerms = exAccounts.length ? [
    ["读取账户/行情", anyRead ? "已开启" : "未配置", anyRead ? "pos" : ""],
    ["交易下单", anyTrade ? "已开启" : "未开启", anyTrade ? "pos" : ""],
    // 提现权限：检测到开着=高危(应去交易所关闭);未检测到=安全
    ["提现权限", anyWithdraw ? "检测到开启·高危" : "未开启", anyWithdraw ? "neg" : "pos"]
  ] : [
    ["读取账户/行情", "未配置", ""], ["交易下单", "未配置", ""], ["提现权限", "未配置", ""]
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
              {/* 只有真有启用规则时才亮绿点；空分组不再写死"正常" */}
              {g.rules.length > 0 && <div className="rrOk"><span className="rrDot" />已启用 {g.rules.filter((r) => r.enabled !== false).length} 条</div>}
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

      {/* 实盘写入与灰度发布:从系统设置整体迁入(灰度额度/人工确认/安全闸都是风控边界) */}
      <div className="termCard liveGrayCard">
        <div className="kHead"><span className="secLabel">实盘写入与灰度发布 · LIVE / GRAY RELEASE</span><span className={`evBadge ${data.config?.liveTrading?.effective ? "neg" : ""}`}>{data.config?.liveTrading?.effective ? "实盘已开启" : "实盘关闭"}</span></div>
        <LiveGrayPanel data={data} action={action} ui={ui} />
      </div>

      <div className="termGrid riskBot">
        <div className="termCard">
          <div className="balLabel">API 与账户安全</div>
          {exAccounts.map((a) => <div className="secRow" key={a.id}><span>{a.exchange}</span><span className="secRowR"><b className={`evBadge ${a.readEnabled ? "ok" : "warn"}`}>{a.readEnabled ? "已连接" : "未配置"}</b></span></div>)}
          <div className="secRow"><span>Lark 通知</span><b className={`evBadge ${data.larkConfigured ? "ok" : "warn"}`}>{data.larkConfigured ? "已启用" : "未配置"}</b></div>
        </div>
        <div className="termCard">
          <div className="secLabelSpread"><span className="balLabel" style={{ marginBottom: 0 }}>IP 白名单</span><button className="agLink" onClick={() => ui.openPanel("ip")}>管理</button></div>
          {(() => { const ips = exAccounts.map((a) => a.ipWhitelist).filter(Boolean); return ips.length
            ? <div className="secRow"><span className="mono">{ips.join("、").slice(0, 32)}</span><b className="evBadge ok">已绑定</b></div>
            : <div className="secRow"><span className="mono">建议在交易所侧绑定 IP</span><b className="evBadge warn">未设置</b></div>; })()}
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

export function AuditSystemPage({ data, action, ui, embedded = false }) {
  const traces = data.traces || [];
  const jobRuns = data.jobRuns || [];
  const [traceTypeFilter, setTraceTypeFilter] = useState("全部");
  const [traceWindow, setTraceWindow] = useState("24h");
  const latestPlan = data.tradePlans?.[0] || {};
  const latestRisk = data.riskChecks?.[0] || latestPlan.lastRiskCheck || {};
  const latestOrder = data.orders?.[0] || data.executionOrders?.[0] || {};
  const auditOk = data.readiness?.checks?.find((item) => item.key === "audit_chain")?.configured ?? false /* 缺数据当未通过,与实盘就绪清单口径一致(审计 L4) */;
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
        {/* 副标改用"配置就绪度"（由 env/密钥/开关的真实状态算出）——旧"实现 100%"是 26 条检查全部硬编码 implemented:true 的假指标 */}
        <MetricCard icon={Gauge} label="API 健康" value={data.system.apiHealth || "未知"} sub={`配置就绪 ${data.readiness?.configurationCompletionPct ?? 0}%`} />
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
        {/* 旧"整体耗时"取任意最新一条 trace 的延迟（且多为随机数），语义错误——改为最近记录时间；状态无数据时显示 —，不再默认"运行中" */}
        <div className="acFoot"><span>最近记录 <b className="mono">{traces[0] ? formatTime(traces[0].createdAt) : "—"}</b></span><span>状态 <b className={latestRisk.passed == null ? "" : latestRisk.passed ? "pos" : "warn"}>{humanize(latestRisk.decision || latestPlan.status, "—")}</b></span></div>
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
                {/* 按真实 trace.status 渲染成败，不再无脑绿勾 */}
                <span className={`r ${["ok", "success", "info"].includes(String(trace.status || "ok")) ? "pos" : ["blocked", "error", "failed", "warning"].includes(String(trace.status)) ? "neg" : ""}`}>{["blocked", "error", "failed"].includes(String(trace.status)) ? "✕" : trace.status === "warning" ? "!" : "✓"}</span>
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
            {incidents.map((item) => <div key={item.id}><StatusBadge tone={statusTone(item.severity || item.status)}>{humanize(item.status || item.severity, "记录")}</StatusBadge><span>{(() => {
              const title = `${item.title || item.message || item.action || item.id}${item.count > 1 ? ` ×${item.count}` : ""}`;
              const sev = String(item.severity || item.status || "").toLowerCase();
              const isProblem = item.status === "open" || ["critical", "high", "warning", "error", "blocked"].some((k) => sev.includes(k));
              if (!isProblem) return title;
              const reason = `${humanize(item.severity || item.status, "告警")}${item.source ? ` · 来源 ${item.source}` : ""}${item.count > 1 ? ` · 累计 ${item.count} 次` : ""}`;
              return <FlagTip reason={reason} tone={/(critical|high|error)/.test(sev) ? "neg" : "warn"}>{title}</FlagTip>;
            })()}</span><small>{formatTime(item.lastSeenAt || item.createdAt)}</small>{item.status === "open" && String(item.id).startsWith("incident") && <button className="linkCell" title="标记为已处理" onClick={() => action(`/api/risk/incidents/${item.id}/close`, {})}>标记已处理</button>}</div>)}
            {!incidents.length && <div className="emptyPanel">暂无真实告警。</div>}
          </div>
        </div>
      </Card>
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
