import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  RefreshCw,
  ShieldAlert
} from "lucide-react";
import { displayMoney, formatDateTime, humanize, localizeText } from "../lib.jsx";
import { t } from "../i18n.js";
import { executionExitAction, requestExecutionExit } from "../executionExit.js";
import { buildLedgerPresentation, buildSelectedExecutionStages } from "./model.js";
import { CockpitEmpty, CockpitMetric, CockpitPanel, Tone } from "./shared.jsx";

const RESOURCE_STATES = new Set(["not_loaded", "loading", "loaded", "stale", "degraded", "error", "failed", "forbidden", "disabled"]);
const PAGE_SIZE = 8;

const list = (value) => Array.isArray(value) ? value : [];
const objects = (value) => list(value).filter((row) => row && typeof row === "object" && !Array.isArray(row));
const hasArray = (value, key) => Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key) && Array.isArray(value[key]));
const identity = (value) => typeof value === "string" && value.trim() ? value.trim() : Number.isFinite(value) ? String(value) : null;
const orderIdentity = (row) => identity(row?.id) ?? identity(row?.executionOrderId) ?? identity(row?.orderId);
const fillIdentity = (row) => identity(row?.id) ?? identity(row?.fillId);
const planIdentity = (row) => identity(row?.tradePlanId) ?? identity(row?.planId);
const finite = (value) => value !== null && value !== undefined && (typeof value !== "string" || value.trim() !== "") && Number.isFinite(Number(value));
const unavailable = () => t("不可用", "Unavailable");
const money = (value, digits = 2) => finite(value) ? displayMoney(Number(value), digits) : unavailable();
const quantity = (value) => finite(value) ? Number(value).toLocaleString("en-US", { maximumFractionDigits: 8 }) : unavailable();
const sideTone = (value) => /short|sell|空|卖/i.test(String(value || "")) ? "negative" : /long|buy|多|买/i.test(String(value || "")) ? "positive" : "neutral";
const statusTone = (value) => /fail|error|reject|cancel|blocked|risk|异常|失败|拒绝|取消|阻断/i.test(String(value || "")) ? "negative" : /pending|open|working|partial|wait|待|进行/i.test(String(value || "")) ? "warning" : /fill|complete|active|success|approved|protect|已|运行/i.test(String(value || "")) ? "positive" : "neutral";
const normalizedStatus = (value) => String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
const WORKING_ORDER_STATUSES = new Set(["open", "pending", "working", "partial", "partially_filled", "entry_pending", "entry_submitted", "protecting", "protecting_degraded"]);
const FILLED_ORDER_STATUSES = new Set(["filled", "complete", "completed", "entry_filled"]);
const CANCELED_ORDER_STATUSES = new Set(["canceled", "cancelled"]);
const BLOCKED_ORDER_STATUSES = new Set(["rejected", "blocked", "risk_blocked", "risk_rejected", "rejected_by_risk"]);
const orderStatusFamily = (value) => {
  const status = normalizedStatus(value);
  if (WORKING_ORDER_STATUSES.has(status)) return "working";
  if (FILLED_ORDER_STATUSES.has(status)) return "filled";
  if (CANCELED_ORDER_STATUSES.has(status)) return "canceled";
  if (BLOCKED_ORDER_STATUSES.has(status)) return "blocked";
  return "other";
};
const fillIntent = (row) => row?.reduceOnly === true || /close|reduce|exit/i.test(String(row?.kind ?? row?.intent ?? row?.purpose ?? "")) ? "reduce" : row?.reduceOnly === false || /entry|open/i.test(String(row?.kind ?? row?.intent ?? row?.purpose ?? "")) ? "open" : "unknown";
const fillLiquidity = (row) => /taker/i.test(String(row?.liquidity ?? row?.execType ?? "")) ? "taker" : /maker/i.test(String(row?.liquidity ?? row?.execType ?? "")) ? "maker" : "unknown";

function uniqueIdentityRows(value, resolveIdentity) {
  const rows = objects(value).map((row) => ({ row, id: resolveIdentity(row) })).filter(({ id }) => id);
  const counts = new Map();
  rows.forEach(({ id }) => counts.set(id, (counts.get(id) || 0) + 1));
  return rows.filter(({ id }) => counts.get(id) === 1).map(({ row }) => row);
}

function resourceStateOf(data) {
  const state = String(data?.resourceState?.cockpit || "").trim().toLowerCase();
  if (state === "ready") return "loaded";
  return RESOURCE_STATES.has(state) ? state : "not_loaded";
}

function LedgerResourceState({ state, retainsFacts, onRetry }) {
  const content = {
    not_loaded: [t("执行账本尚未加载", "Execution ledger not loaded"), t("打开页面后会读取真实委托与交易所成交回报。", "Orders and exchange-confirmed fills load when this page opens.")],
    loading: [t("执行账本正在加载", "Loading execution ledger"), retainsFacts ? t("下方保留最后有效事实；当前不开放执行动作。", "Last-valid facts remain below; execution actions are unavailable.") : t("正在读取委托与成交；空白不代表数量为零。", "Reading orders and fills; blank values do not mean zero.")],
    stale: [t("执行账本已陈旧", "Execution ledger is stale"), t("下方为最后有效事实，请刷新后再执行操作。", "Last-valid facts remain below; refresh before acting.")],
    degraded: [t("执行账本服务降级", "Execution ledger service degraded"), t("仅展示仍可验证的最后有效事实。", "Only verifiable last-valid facts remain visible.")],
    error: [t("执行账本加载失败", "Execution ledger failed to load"), t("当前委托与成交事实不可用，请重新加载。", "Current order and fill facts are unavailable. Reload to retry.")],
    failed: [t("执行账本加载失败", "Execution ledger failed to load"), t("当前委托与成交事实不可用，请重新加载。", "Current order and fill facts are unavailable. Reload to retry.")],
    forbidden: [t("执行账本需要权限", "Execution ledger permission required"), t("当前身份无权读取这组委托与成交。", "The current identity cannot read these orders and fills.")],
    disabled: [t("执行账本数据源已停用", "Execution ledger source disabled"), t("当前环境未启用委托与成交数据源。", "The order and fill source is disabled in this environment.")]
  }[state] || [t("执行账本状态不可用", "Execution ledger state unavailable"), t("当前资源状态无法确认。", "The current resource state cannot be confirmed.")];
  return <section className={`ledgerResourceState ${state}`} data-ledger-resource-state={state} role={["error", "failed"].includes(state) ? "alert" : "status"}>
    <AlertTriangle aria-hidden="true"/>
    <div><b>{content[0]}</b><span>{content[1]}</span></div>
    {["error", "failed", "stale", "degraded"].includes(state) && <button type="button" onClick={onRetry}><RefreshCw aria-hidden="true"/>{t("重新加载", "Reload")}</button>}
  </section>;
}

function Pagination({ page, pages, prefix, onPage }) {
  const previousData = prefix === "order" ? { "data-order-page-prev": "" } : { "data-fill-page-prev": "" };
  const pageData = prefix === "order" ? { "data-order-page": page } : { "data-fill-page": page };
  const nextData = prefix === "order" ? { "data-order-page-next": "" } : { "data-fill-page-next": "" };
  return <footer className="ledgerPagination">
    <span>{t(`第 ${page} / ${pages} 页`, `Page ${page} / ${pages}`)}</span>
    <div>
      <button type="button" {...previousData} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t("上一页", "Previous page")}><ChevronLeft aria-hidden="true"/></button>
      <b {...pageData}>{page}</b>
      <button type="button" {...nextData} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={t("下一页", "Next page")}><ChevronRight aria-hidden="true"/></button>
    </div>
  </footer>;
}

function Notices({ data }) {
  const notification = objects(data.notifications).find((row) => [row.message, row.title, row.summary].some((value) => typeof value === "string" && value.trim()));
  const risk = objects(data.riskChecks).find((row) => [row.summary, row.reason].some((value) => typeof value === "string" && value.trim()));
  const event = objects(data.events).find((row) => [row.title, row.summary, row.message].some((value) => typeof value === "string" && value.trim()));
  return <section className="ledgerNotices" data-cockpit-region="execution-notices" aria-label={t("执行通知", "Execution notices")}>
    <article><Bot aria-hidden="true"/><span><small>{t("执行通道", "Execution channel")}</small><b>{localizeText(notification?.message ?? notification?.title ?? notification?.summary, unavailable())}</b></span></article>
    <article><ShieldAlert aria-hidden="true"/><span><small>{t("风险与事件通道", "Risk and event channel")}</small><b>{localizeText(risk?.summary ?? risk?.reason ?? event?.title ?? event?.summary ?? event?.message, unavailable())}</b></span></article>
  </section>;
}

function OrderFilters({ filters, symbols, total, onChange }) {
  return <div className="ledgerFilters order" data-cockpit-region="order-filters">
    <span><CircleDot aria-hidden="true"/><b>{t("委托列表", "Order list")}</b><small>{total === null ? unavailable() : t(`${total} 条匹配`, `${total} matches`)}</small></span>
    <label>{t("状态", "Status")}<select data-order-filter="status" value={filters.status} onChange={(event) => onChange("status", event.target.value)}><option value="all">{t("全部状态", "All statuses")}</option><option value="working">{t("进行中", "Working")}</option><option value="filled">{t("已成交", "Filled")}</option><option value="canceled">{t("已取消", "Canceled")}</option><option value="blocked">{t("拒绝 / 阻断", "Rejected / blocked")}</option><option value="other">{t("其他", "Other")}</option></select></label>
    <label>{t("交易对", "Pair")}<select data-order-filter="symbol" value={filters.symbol} onChange={(event) => onChange("symbol", event.target.value)}><option value="all">{t("全部交易对", "All pairs")}</option>{symbols.map((symbol) => <option value={symbol} key={symbol}>{symbol}</option>)}</select></label>
  </div>;
}

function OrderList({ rows, selectedId, page, pages, available, onPage, onSelect }) {
  const [focusedId, setFocusedId] = useState("");
  return <CockpitPanel className="ledgerOrderList" region="order-list" ariaLabel={t("委托列表", "Order list")}>
    {rows.length ? <div className="ledgerTableScroll" data-order-page={page}><table className="ledgerOrderTable" aria-label={t("委托列表", "Order list")}><thead><tr><th>{t("时间 / 委托", "Time / order")}</th><th>{t("交易对", "Pair")}</th><th>{t("方向", "Side")}</th><th>{t("数量", "Quantity")}</th><th>{t("价格", "Price")}</th><th>{t("状态", "Status")}</th></tr></thead><tbody>{rows.map((row) => {
      const id = orderIdentity(row);
      const selected = id === selectedId;
      const family = orderStatusFamily(row.status);
      return <tr key={id} className={selected ? "selected" : ""} data-order-id={id} data-order-status-family={family}>
        <td><button type="button" className={`ledgerOrderSelect ${focusedId === id ? "focusVisible" : ""}`.trim()} data-order-select={id} aria-pressed={selected} onFocus={() => setFocusedId(id)} onBlur={() => setFocusedId("")} onClick={() => onSelect(row)} onKeyDown={(event) => { setFocusedId(id); if (["Enter", " "].includes(event.key)) { event.preventDefault(); onSelect(row); } }}><time>{formatDateTime(row.createdAt ?? row.updatedAt)}</time><small>{id}</small></button></td>
        <td><b>{identity(row.symbol) ?? unavailable()}</b></td>
        <td><Tone tone={sideTone(row.side ?? row.direction)}>{humanize(row.side ?? row.direction, unavailable())}</Tone></td>
        <td>{quantity(row.quantity ?? row.size)}</td>
        <td>{money(row.price ?? row.orderPrice)}</td>
        <td><Tone tone={statusTone(row.status)}>{humanize(row.status, unavailable())}</Tone></td>
      </tr>;
    })}</tbody></table></div> : <CockpitEmpty title={available ? t("暂无委托", "No orders") : t("委托数据不可用", "Order data unavailable")} detail={available ? t("当前筛选没有可验证的委托事实。", "No verifiable orders match the current filters.") : t("当前来源没有返回可验证的委托集合。", "The source did not return a verifiable order collection.")}/>}
    <Pagination page={page} pages={pages} prefix="order" onPage={onPage}/>
  </CockpitPanel>;
}

function OrderDetail({ data, selected, actionsAllowed, action, ui }) {
  const selectedId = orderIdentity(selected);
  const canonicalOrderId = identity(selected?.id);
  const hasCanonicalSelection = Boolean(selectedId && canonicalOrderId && selectedId === canonicalOrderId);
  const stages = buildSelectedExecutionStages(data, selected ?? {});
  const labels = { signal: t("信号", "Signal"), risk: t("风控", "Risk"), routing: t("路由", "Routing"), order: t("委托", "Order"), fill: t("成交", "Fill"), protection: t("保护", "Protection") };
  const timeline = <CockpitPanel className="ledgerTimelinePanel" region="execution-timeline" title={t("执行时间线", "Execution timeline")} meta={t("严格绑定当前委托", "Selected order only")}>
    <ol className="ledgerTimeline">{stages.map((stage, index) => { const stageState = stage.state ?? (stage.done ? "complete" : "incomplete"); return <li key={stage.id} data-execution-stage={stage.id} data-stage-state={stageState} className={stageState}><i>{stage.done ? <Check aria-hidden="true"/> : index + 1}</i><span><b>{labels[stage.id]}</b><small>{localizeText(stage.detail, stage.done ? t("已验证", "Verified") : t("未取得证据", "No evidence"))}</small></span></li>; })}</ol>
  </CockpitPanel>;
  if (!hasCanonicalSelection) return <div className="ledgerDetailStack">
    <CockpitPanel className="ledgerOrderDetail empty" region="order-detail" title={t("订单详情", "Order detail")}><CockpitEmpty title={t("未选择有效委托", "No valid order selected")} detail={t("筛选或身份冲突不会回退到另一笔委托。", "Filters or identity conflicts never fall back to another order.")}/></CockpitPanel>
    {timeline}
  </div>;
  const exactFills = canonicalOrderId ? objects(data.fills).filter((row) => (identity(row.executionOrderId) ?? identity(row.orderId)) === canonicalOrderId && fillIdentity(row)) : [];
  const planId = planIdentity(selected);
  const plans = planId ? objects(data.tradePlans).filter((row) => identity(row.id) === planId) : [];
  const plan = plans.length === 1 ? plans[0] : null;
  const exit = actionsAllowed && canonicalOrderId && canonicalOrderId === selectedId ? executionExitAction(selected) : null;
  const facts = [
    [t("委托编号", "Order ID"), selectedId],
    [t("交易对", "Pair"), identity(selected.symbol) ?? unavailable()],
    [t("方向", "Side"), humanize(selected.side ?? selected.direction, unavailable())],
    [t("类型", "Type"), humanize(selected.type ?? selected.orderType, unavailable())],
    [t("委托数量", "Order quantity"), quantity(selected.quantity ?? selected.size)],
    [t("成交数量", "Filled quantity"), quantity(selected.filledQuantity ?? selected.accFillSz)],
    [t("委托价格", "Order price"), money(selected.price ?? selected.orderPrice)],
    [t("交易场所", "Venue"), localizeText(selected.exchange ?? selected.venue, unavailable())],
    [t("创建时间", "Created"), selected.createdAt || selected.updatedAt ? formatDateTime(selected.createdAt ?? selected.updatedAt) : unavailable()],
    [t("策略", "Strategy"), localizeText(plan?.strategy ?? selected.strategy ?? selected.strategyName, unavailable())],
    [t("信号", "Signal"), localizeText(plan?.signal ?? selected.signal, unavailable())],
    [t("关联成交", "Related fills"), String(exactFills.length)]
  ];
  return <div className="ledgerDetailStack">
    <CockpitPanel className="ledgerOrderDetail" region="order-detail" title={t("订单详情", "Order detail")} meta={selectedId} action={<Tone tone={statusTone(selected.status)}>{humanize(selected.status, unavailable())}</Tone>}>
      <article className="ledgerSelectedIdentity" data-order-detail-id={selectedId} data-order-detail-symbol={identity(selected.symbol) ?? ""}><span><small>{t("当前委托", "Selected order")}</small><b>{selectedId}</b></span><b>{identity(selected.symbol) ?? unavailable()}</b></article>
      <dl className="ledgerOrderFacts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <footer className="ledgerOrderActions"><button type="button" className="cockpitSecondaryButton" onClick={() => ui.setActive("chat")}><Bot aria-hidden="true"/>{t("交给 AI 处理", "Ask AI")}</button>{exit && <button type="button" className="cockpitDangerButton" data-order-exit={exit.intent} onClick={() => requestExecutionExit(action, selected, "manual_ui")}>{exit.label}</button>}</footer>
    </CockpitPanel>
    {timeline}
  </div>;
}

function FillFilters({ filters, symbols, total, onChange }) {
  return <div className="ledgerFilters fills" data-cockpit-region="fill-filters">
    <span><Check aria-hidden="true"/><b>{t("交易所成交账本", "Exchange fill ledger")}</b><small>{total === null ? unavailable() : t(`${total} 条匹配`, `${total} matches`)}</small></span>
    <label>{t("交易对", "Pair")}<select data-fill-filter="symbol" value={filters.symbol} onChange={(event) => onChange("symbol", event.target.value)}><option value="all">{t("全部交易对", "All pairs")}</option>{symbols.map((symbol) => <option value={symbol} key={symbol}>{symbol}</option>)}</select></label>
    <label>{t("方向", "Side")}<select data-fill-filter="side" value={filters.side} onChange={(event) => onChange("side", event.target.value)}><option value="all">{t("全部方向", "All sides")}</option><option value="buy">{t("买入", "Buy")}</option><option value="sell">{t("卖出", "Sell")}</option></select></label>
    <label>{t("流动性", "Liquidity")}<select data-fill-filter="liquidity" value={filters.liquidity} onChange={(event) => onChange("liquidity", event.target.value)}><option value="all">{t("全部", "All")}</option><option value="maker">Maker</option><option value="taker">Taker</option><option value="unknown">{t("不可用", "Unavailable")}</option></select></label>
    <label>{t("开 / 减仓", "Open / reduce")}<select data-fill-filter="intent" value={filters.intent} onChange={(event) => onChange("intent", event.target.value)}><option value="all">{t("全部", "All")}</option><option value="open">{t("开仓", "Open")}</option><option value="reduce">{t("减仓", "Reduce")}</option><option value="unknown">{t("不可用", "Unavailable")}</option></select></label>
  </div>;
}

function FillLedger({ rows, page, pages, available, onPage }) {
  return <CockpitPanel className="ledgerFillPanel" region="fill-ledger" ariaLabel={t("交易所成交账本", "Exchange fill ledger")}>
    {rows.length ? <div className="ledgerTableScroll" data-fill-page={page}><table className="ledgerFillTable" aria-label={t("交易所确认成交", "Exchange-confirmed fills")}><thead><tr><th>{t("成交时间", "Fill time")}</th><th>{t("成交编号", "Fill ID")}</th><th>{t("委托编号", "Order ID")}</th><th>{t("交易对", "Pair")}</th><th>{t("方向", "Side")}</th><th>{t("成交数量", "Quantity")}</th><th>{t("成交价格", "Price")}</th><th>{t("手续费", "Fee")}</th><th>{t("流动性", "Liquidity")}</th><th>{t("开 / 减仓", "Open / reduce")}</th></tr></thead><tbody>{rows.map((row) => {
      const id = fillIdentity(row);
      const liquidity = fillLiquidity(row);
      const intent = fillIntent(row);
      return <tr key={id} data-fill-id={id} data-fill-liquidity={liquidity} data-fill-intent={intent}><td>{row.createdAt || row.updatedAt || row.ts ? formatDateTime(row.createdAt ?? row.updatedAt ?? row.ts) : unavailable()}</td><td><b>{id}</b></td><td>{identity(row.executionOrderId) ?? identity(row.orderId) ?? unavailable()}</td><td><b>{identity(row.symbol) ?? unavailable()}</b></td><td><Tone tone={sideTone(row.side ?? row.direction)}>{humanize(row.side ?? row.direction, unavailable())}</Tone></td><td>{quantity(row.quantity ?? row.size ?? row.fillSz)}</td><td>{money(row.price ?? row.fillPx)}</td><td>{finite(row.feeUsdt ?? row.fee) ? `${money(row.feeUsdt ?? row.fee)} U` : unavailable()}</td><td>{liquidity === "unknown" ? unavailable() : humanize(liquidity)}</td><td>{intent === "unknown" ? unavailable() : intent === "reduce" ? t("减仓", "Reduce") : t("开仓", "Open")}</td></tr>;
    })}</tbody></table></div> : <CockpitEmpty title={available ? t("暂无成交", "No fills") : t("成交数据不可用", "Fill data unavailable")} detail={available ? t("交易所确认成交后，成交与费用事实会显示在这里。", "Fill and fee facts appear after exchange confirmation.") : t("当前来源没有返回可验证的成交集合。", "The source did not return a verifiable fill collection.")}/>}
    <Pagination page={page} pages={pages} prefix="fill" onPage={onPage}/>
  </CockpitPanel>;
}

export function LedgerPage({ data = {}, action, ui = {} }) {
  const state = resourceStateOf(data);
  const ordersAvailable = hasArray(data, "executionOrders");
  const fillsAvailable = hasArray(data, "fills");
  const orders = useMemo(() => uniqueIdentityRows(data.executionOrders, orderIdentity), [data.executionOrders]);
  const fills = useMemo(() => uniqueIdentityRows(data.fills, fillIdentity), [data.fills]);
  const sanitizedData = useMemo(() => ({
    ...data,
    ...(ordersAvailable ? { executionOrders: orders } : {}),
    ...(fillsAvailable ? { fills } : {})
  }), [data, fills, fillsAvailable, orders, ordersAvailable]);
  const presentation = useMemo(() => buildLedgerPresentation(sanitizedData), [sanitizedData]);
  const hasFacts = orders.length > 0 || fills.length > 0;
  const retainsFacts = ["loading", "stale", "degraded"].includes(state) && hasFacts;
  const bodyVisible = state === "loaded" || retainsFacts;
  const actionsAllowed = state === "loaded";
  const [orderFilters, setOrderFilters] = useState({ status: "all", symbol: "all" });
  const [fillFilters, setFillFilters] = useState({ symbol: "all", side: "all", liquidity: "all", intent: "all" });
  const [orderPage, setOrderPage] = useState(1);
  const [fillPage, setFillPage] = useState(1);
  const [selectedId, setSelectedId] = useState(orders[0] ? orderIdentity(orders[0]) : "");
  const orderSymbols = useMemo(() => [...new Set(orders.map((row) => identity(row.symbol)).filter(Boolean))].sort(), [orders]);
  const fillSymbols = useMemo(() => [...new Set(fills.map((row) => identity(row.symbol)).filter(Boolean))].sort(), [fills]);
  const filteredOrders = useMemo(() => orders.filter((row) => (orderFilters.status === "all" || orderStatusFamily(row.status) === orderFilters.status) && (orderFilters.symbol === "all" || identity(row.symbol) === orderFilters.symbol)), [orders, orderFilters]);
  const filteredFills = useMemo(() => fills.filter((row) => {
    const side = /sell|short|空|卖/i.test(String(row.side ?? row.direction ?? "")) ? "sell" : /buy|long|多|买/i.test(String(row.side ?? row.direction ?? "")) ? "buy" : "unknown";
    return (fillFilters.symbol === "all" || identity(row.symbol) === fillFilters.symbol)
      && (fillFilters.side === "all" || side === fillFilters.side)
      && (fillFilters.liquidity === "all" || fillLiquidity(row) === fillFilters.liquidity)
      && (fillFilters.intent === "all" || fillIntent(row) === fillFilters.intent);
  }), [fills, fillFilters]);
  const orderPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const fillPages = Math.max(1, Math.ceil(filteredFills.length / PAGE_SIZE));
  const safeOrderPage = Math.min(orderPage, orderPages);
  const safeFillPage = Math.min(fillPage, fillPages);
  const orderRows = filteredOrders.slice((safeOrderPage - 1) * PAGE_SIZE, safeOrderPage * PAGE_SIZE);
  const fillRows = filteredFills.slice((safeFillPage - 1) * PAGE_SIZE, safeFillPage * PAGE_SIZE);
  const selected = filteredOrders.find((row) => orderIdentity(row) === selectedId) ?? null;
  const metrics = presentation.metrics;
  const latestTimestamp = [...orders, ...fills].map((row) => row.updatedAt ?? row.createdAt ?? row.ts).filter(Boolean).sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

  useEffect(() => {
    if (selectedId && !filteredOrders.some((row) => orderIdentity(row) === selectedId)) setSelectedId("");
  }, [filteredOrders, selectedId]);
  useEffect(() => {
    if (!selectedId && orders.length && orderFilters.status === "all" && orderFilters.symbol === "all") setSelectedId(orderIdentity(orders[0]) ?? "");
  }, [orders, orderFilters.status, orderFilters.symbol, selectedId]);
  useEffect(() => { if (orderPage > orderPages) setOrderPage(orderPages); }, [orderPage, orderPages]);
  useEffect(() => { if (fillPage > fillPages) setFillPage(fillPages); }, [fillPage, fillPages]);

  const reload = () => typeof ui.refresh === "function" ? ui.refresh() : ui.ensureSection?.("cockpit");
  const updateOrderFilter = (key, value) => { setOrderFilters((current) => ({ ...current, [key]: value })); setOrderPage(1); };
  const updateFillFilter = (key, value) => { setFillFilters((current) => ({ ...current, [key]: value })); setFillPage(1); };
  const selectOrder = (row) => {
    const id = orderIdentity(row);
    if (!id || !filteredOrders.some((candidate) => orderIdentity(candidate) === id)) return;
    setSelectedId(id);
  };

  const selectedCanonicalId = identity(selected?.id);
  const selectedIdentityProps = bodyVisible && selectedCanonicalId && selectedCanonicalId === orderIdentity(selected) ? { "data-selected-order-id": selectedCanonicalId } : {};
  const metricValue = (value) => value === null ? unavailable() : String(value);

  return <div className="cockpitPage cockpitLedgerV2" data-cockpit-page="ledger" data-resource-state={state} {...selectedIdentityProps}>
    {state !== "loaded" && <LedgerResourceState state={state} retainsFacts={retainsFacts} onRetry={reload}/>}
    {bodyVisible && <>
      <header className="ledgerTitleV2"><div><h1>{t("委托与成交", "Orders & Fills")}</h1><p>{t("订单状态、执行证据与交易所成交回报分层核对。", "Reconcile order state, execution evidence, and exchange-confirmed fills separately.")}</p></div><span>{latestTimestamp ? formatDateTime(latestTimestamp) : unavailable()}</span></header>
      <section className="ledgerHeroV2" data-cockpit-region="execution-hero">
        <CockpitMetric strong label={t("全部委托", "Total orders")} value={metricValue(metrics.total)}/>
        <CockpitMetric label={t("进行中", "Working")} value={metricValue(metrics.working)} tone={metrics.working ? "warning" : ""}/>
        <CockpitMetric label={t("已成交", "Filled")} value={metricValue(metrics.filled)} tone={metrics.filled ? "positive" : ""}/>
        <CockpitMetric label={t("拒绝 / 风控阻断", "Rejected / risk blocked")} value={metricValue(metrics.blocked)} tone={metrics.blocked ? "negative" : ""}/>
        <CockpitMetric label={t("成交成功率", "Fill rate")} value={metrics.fillRatePct === null ? unavailable() : `${metrics.fillRatePct.toFixed(1)}%`}/>
        <CockpitMetric label={t("手续费", "Fees")} value={metrics.feesUsdt === null ? unavailable() : `${money(metrics.feesUsdt)} U`}/>
      </section>
      <Notices data={sanitizedData}/>
      <OrderFilters filters={orderFilters} symbols={orderSymbols} total={ordersAvailable ? filteredOrders.length : null} onChange={updateOrderFilter}/>
      <div className={`ledgerWorkbenchV2 ${orders.length ? "" : "empty"}`.trim()}>
        <OrderList rows={orderRows} selectedId={selected ? orderIdentity(selected) : ""} page={safeOrderPage} pages={orderPages} available={ordersAvailable} onPage={setOrderPage} onSelect={selectOrder}/>
        <OrderDetail data={sanitizedData} selected={selected} actionsAllowed={actionsAllowed} action={action} ui={ui}/>
      </div>
      <FillFilters filters={fillFilters} symbols={fillSymbols} total={fillsAvailable ? filteredFills.length : null} onChange={updateFillFilter}/>
      <FillLedger rows={fillRows} page={safeFillPage} pages={fillPages} available={fillsAvailable} onPage={setFillPage}/>
    </>}
  </div>;
}
