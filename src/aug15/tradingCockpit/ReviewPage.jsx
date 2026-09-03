import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Lightbulb, RefreshCw, Sparkles, Target } from "lucide-react";
import { displayMoney, formatDateTime, humanize, localizeText } from "../lib.jsx";
import { t } from "../i18n.js";
import { buildReviewPresentation } from "./model.js";
import { CockpitEmpty, CockpitMetric, CockpitPanel, Tone } from "./shared.jsx";

const RESOURCE_STATES = new Set(["not_loaded", "loading", "loaded", "stale", "degraded", "error", "failed", "forbidden", "disabled"]);
const PAGE_SIZE = 8;

const list = (value) => Array.isArray(value) ? value : [];
const objects = (value) => list(value).filter((row) => row && typeof row === "object" && !Array.isArray(row));
const finite = (value) => value !== null && value !== undefined && (typeof value !== "string" || value.trim() !== "") && Number.isFinite(Number(value));
const numeric = (value) => finite(value) ? Number(value) : null;
const identity = (value) => typeof value === "string" && value.trim() ? value.trim() : Number.isFinite(value) ? String(value) : null;
const unavailable = () => t("不可用", "Unavailable");
const money = (value) => finite(value) ? displayMoney(Number(value), 2) : unavailable();
const signedMoney = (value) => finite(value) ? `${Number(value) >= 0 ? "+" : ""}${displayMoney(Number(value), 2)}` : unavailable();
const percent = (value, digits = 1) => finite(value) ? `${Number(value).toFixed(digits)}%` : unavailable();
const sideTone = (value) => /short|sell|空|卖/i.test(String(value || "")) ? "negative" : /long|buy|多|买/i.test(String(value || "")) ? "positive" : "neutral";
const statusTone = (value) => /fail|error|reject|cancel|异常|失败|拒绝|取消/i.test(String(value || "")) ? "negative" : /pending|process|wait|review|待|处理中/i.test(String(value || "")) ? "warning" : /complete|reflected|closed|done|完成|已复盘/i.test(String(value || "")) ? "positive" : "neutral";

function resourceStateOf(data) {
  const state = String(data?.resourceState?.cockpit || "").trim().toLowerCase();
  if (state === "ready") return "loaded";
  return RESOURCE_STATES.has(state) ? state : "not_loaded";
}

function validReviews(rows) {
  return objects(rows).filter((row) => identity(row.id));
}

function metricValue(data, presentation, behavior, key) {
  const performance = data?.performance && typeof data.performance === "object" ? data.performance : {};
  const closed = objects(data?.closedTradeLifecycles);
  if (key === "trades") return finite(performance.trades) ? Number(performance.trades) : Array.isArray(data?.closedTradeLifecycles) ? closed.length : null;
  if (key === "totalPnlUsdt") {
    if (finite(performance.totalPnlUsdt)) return Number(performance.totalPnlUsdt);
    const values = closed.map((row) => numeric(row.netRealizedPnl));
    return Array.isArray(data?.closedTradeLifecycles) && values.every((value) => value !== null) ? values.reduce((sum, value) => sum + value, 0) : null;
  }
  if (key === "winRatePct") {
    if (finite(performance.winRatePct)) return Number(performance.winRatePct);
    const values = closed.map((row) => numeric(row.netRealizedPnl));
    return values.length && values.every((value) => value !== null) ? values.filter((value) => value > 0).length / values.length * 100 : null;
  }
  if (key === "expectancyUsdt") return numeric(performance.expectancyUsdt ?? behavior?.overall?.expectancyUsdt);
  if (key === "maxDrawdownPct") return numeric(presentation.metrics.maxDrawdownPct);
  if (key === "profitFactor") return numeric(presentation.metrics.profitFactor ?? behavior?.overall?.profitFactor);
  return null;
}

function completed(review) {
  return /complete|reflected|closed|done/i.test(String(review?.status || ""));
}

function directionOf(review) {
  const value = String(review?.direction ?? review?.side ?? review?.trade?.direction ?? review?.trade?.side ?? "").toLowerCase();
  if (/short|sell|空|卖/.test(value)) return "short";
  if (/long|buy|多|买/.test(value)) return "long";
  return "unknown";
}

function resultOf(review) {
  const value = numeric(review?.netPnlUsdt);
  return value === null ? "unavailable" : value > 0 ? "win" : value < 0 ? "loss" : "flat";
}

function holdMinutesOf(review) {
  return numeric(review?.holdMinutes ?? review?.holdingMinutes ?? review?.trade?.holdMinutes ?? review?.trade?.holdingMinutes);
}

function recordedPathOf(review) {
  const trade = review?.trade && typeof review.trade === "object" ? review.trade : {};
  const candidates = [
    review?.pathSamples, review?.pricePath, review?.equityPath, review?.pnlPath,
    review?.trajectory?.samples, review?.trajectory?.points,
    trade.pathSamples, trade.pricePath, trade.equityPath, trade.pnlPath,
    trade.trajectory?.samples, trade.trajectory?.points
  ];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const points = candidate.map((point, index) => {
      const value = numeric(typeof point === "object" && point !== null
        ? point.pnlUsdt ?? point.pnl ?? point.equity ?? point.price ?? point.value ?? point.close
        : point);
      if (value === null) return null;
      const label = typeof point === "object" && point !== null ? point.at ?? point.time ?? point.timestamp ?? point.label : null;
      return { value, label: label ? String(label) : String(index + 1) };
    }).filter(Boolean);
    if (points.length >= 2) return points;
  }
  return [];
}

function ReviewResourceState({ state, retainsFacts, onRetry }) {
  const content = {
    not_loaded: [t("复盘尚未加载", "Reviews not loaded"), t("打开页面后会读取真实平仓生命周期与复盘记录。", "Closed lifecycles and reviews load when this page opens.")],
    loading: [t("复盘正在加载", "Loading reviews"), retainsFacts ? t("下方保留上一份有效事实，筛选与选择仍为本地只读操作。", "Last-valid facts remain below; filtering and selection stay local and read-only.") : t("正在读取复盘事实；空白不代表绩效为零。", "Reading review facts; blank values do not mean zero performance.")],
    stale: [t("复盘数据已陈旧", "Review data is stale"), t("下方保留最后有效事实，请刷新后再作判断。", "Last-valid facts remain below; refresh before acting on them.")],
    degraded: [t("复盘服务降级", "Review service degraded"), t("仅展示仍可验证的最后有效事实。", "Only verifiable last-valid facts remain visible.")],
    error: [t("复盘加载失败", "Reviews failed to load"), t("当前复盘事实不可用，请重新加载。", "Current review facts are unavailable. Reload to retry.")],
    failed: [t("复盘加载失败", "Reviews failed to load"), t("当前复盘事实不可用，请重新加载。", "Current review facts are unavailable. Reload to retry.")],
    forbidden: [t("复盘需要权限", "Review permission required"), t("当前身份无权读取这组交易复盘。", "The current identity cannot read these trade reviews.")],
    disabled: [t("复盘数据源已停用", "Review source disabled"), t("当前环境未启用交易复盘数据源。", "The review data source is disabled in this environment.")]
  }[state] || [t("复盘状态不可用", "Review state unavailable"), t("当前资源状态无法确认。", "The current resource state cannot be confirmed.")];
  return <section className={`reviewResourceState ${state}`} data-review-resource-state={state} role={["error", "failed"].includes(state) ? "alert" : "status"}>
    <AlertTriangle aria-hidden="true"/>
    <div><b>{content[0]}</b><span>{content[1]}</span></div>
    {["error", "failed", "stale", "degraded"].includes(state) && <button type="button" onClick={onRetry}><RefreshCw/>{t("重新加载", "Reload")}</button>}
  </section>;
}

function reviewSystemHealth(data) {
  const system = data?.system && typeof data.system === "object" ? data.system : {};
  const raw = [system.apiHealth, system.health, system.status]
    .find((value) => typeof value === "string" && value.trim());
  if (!raw) return { label: unavailable(), tone: "" };
  const value = raw.trim();
  const tone = /healthy|normal|ready|running|ok|正常|运行/i.test(value)
    ? "positive"
    : /degraded|stale|pending|warning|降级|陈旧|待/i.test(value)
      ? "warning"
      : /failed|error|down|blocked|异常|失败|阻断/i.test(value) ? "negative" : "";
  return { label: humanize(value, unavailable()), tone };
}

function ReviewHero({ data, presentation, behavior }) {
  const total = metricValue(data, presentation, behavior, "totalPnlUsdt");
  const trades = metricValue(data, presentation, behavior, "trades");
  const winRate = metricValue(data, presentation, behavior, "winRatePct");
  const expectancy = metricValue(data, presentation, behavior, "expectancyUsdt");
  const drawdown = metricValue(data, presentation, behavior, "maxDrawdownPct");
  const profitFactor = metricValue(data, presentation, behavior, "profitFactor");
  const health = reviewSystemHealth(data);
  return <section className="reviewHeroV2" data-cockpit-region="review-hero">
    <CockpitMetric strong label={t("净已实现盈亏", "Net realized PnL")} value={total === null ? unavailable() : `${signedMoney(total)} USDT`} tone={total === null ? "" : total >= 0 ? "positive" : "negative"}/>
    <CockpitMetric label={t("成交笔数", "Closed trades")} value={trades === null ? unavailable() : String(trades)}/>
    <CockpitMetric label={t("胜率", "Win rate")} value={percent(winRate)}/>
    <CockpitMetric label={t("单笔期望", "Expectancy")} value={expectancy === null ? unavailable() : `${signedMoney(expectancy)} U`}/>
    <CockpitMetric label={t("最大回撤", "Max drawdown")} value={percent(drawdown, 2)}/>
    <CockpitMetric label="Profit Factor" value={profitFactor === null ? unavailable() : profitFactor.toFixed(2)}/>
    <CockpitMetric label={t("系统状态", "System health")} value={health.label} tone={health.tone}/>
  </section>;
}

function AiConclusion({ behavior, selected, sampleCount }) {
  const strengths = list(behavior?.strengths).filter((value) => typeof value === "string" && value.trim());
  const flags = objects(behavior?.flags).filter((row) => [row.title, row.detail].some((value) => typeof value === "string" && value.trim()));
  const columns = [
    { icon: CheckCircle2, tone: "positive", title: t("已记录优势", "Recorded strength"), text: strengths[0] ?? list(selected?.strengths).find(Boolean) ?? selected?.whatWorked },
    { icon: AlertTriangle, tone: "warning", title: t("已记录问题", "Recorded issue"), text: flags[0]?.detail ?? flags[0]?.title ?? selected?.rootCause },
    { icon: Lightbulb, tone: "brand", title: t("已记录改进", "Recorded improvement"), text: selected?.improvement ?? selected?.nextAction ?? selected?.lesson }
  ];
  return <CockpitPanel className="reviewConclusionV2" region="ai-review-conclusion" title={t("AI 复盘结论", "AI review conclusion")} meta={t(`当前筛选 ${sampleCount} 笔 · 仅展示已记录内容`, `${sampleCount} filtered · recorded content only`)}>
    <div className="reviewConclusionColumns">{columns.map(({ icon: Icon, tone, title, text }) => <article className={tone} key={title}><Icon aria-hidden="true"/><span><b>{title}</b>{text ? <p>{localizeText(text)}</p> : <p className="reviewUnavailable">{t("暂无已记录结论", "No recorded conclusion")}</p>}</span></article>)}</div>
  </CockpitPanel>;
}

function ReviewFilters({ filters, setFilters, symbols, total }) {
  const update = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  return <div className="reviewFilters" data-cockpit-region="review-filters">
    <span><Target aria-hidden="true"/><b>{t("交易列表", "Trade list")}</b><small>{t(`${total} 笔匹配`, `${total} matches`)}</small></span>
    <label>{t("状态", "Status")}<select data-review-filter="status" value={filters.status} onChange={(event) => update("status", event.target.value)}><option value="all">{t("全部状态", "All statuses")}</option><option value="completed">{t("已完成", "Completed")}</option><option value="pending">{t("待完成", "Pending")}</option></select></label>
    <label>{t("方向", "Side")}<select data-review-filter="direction" value={filters.direction} onChange={(event) => update("direction", event.target.value)}><option value="all">{t("全部方向", "All sides")}</option><option value="long">{t("做多", "Long")}</option><option value="short">{t("做空", "Short")}</option></select></label>
    <label>{t("结果", "Result")}<select data-review-filter="result" value={filters.result} onChange={(event) => update("result", event.target.value)}><option value="all">{t("全部结果", "All results")}</option><option value="win">{t("盈利", "Win")}</option><option value="loss">{t("亏损", "Loss")}</option><option value="flat">{t("持平", "Flat")}</option><option value="unavailable">{t("不可用", "Unavailable")}</option></select></label>
    <label>{t("交易对", "Pair")}<select data-review-filter="symbol" value={filters.symbol} onChange={(event) => update("symbol", event.target.value)}><option value="all">{t("全部交易对", "All pairs")}</option>{symbols.map((symbol) => <option value={symbol} key={symbol}>{symbol}</option>)}</select></label>
  </div>;
}

function TradeList({ rows, selectedId, page, pages, onPage, onSelect }) {
  return <CockpitPanel className="reviewTradeList" region="trade-list" title={t("交易记录", "Trade records")} meta={t(`第 ${page} / ${pages} 页`, `Page ${page} / ${pages}`)}>
    {rows.length ? <div className="reviewTableScroll" data-review-page={page}><table className="reviewTradeTable" aria-label={t("复盘交易列表", "Review trade list")}><thead><tr><th>{t("时间", "Time")}</th><th>{t("品种", "Pair")}</th><th>{t("方向", "Side")}</th><th>{t("净盈亏", "Net PnL")}</th><th>{t("状态", "Status")}</th></tr></thead><tbody>{rows.map((row) => {
      const id = identity(row.id);
      const pnl = numeric(row.netPnlUsdt);
      const selected = selectedId === id;
      return <tr key={id} className={selected ? "selected" : ""} onClick={() => onSelect(row)}>
        <td><button type="button" className="reviewRowSelect" data-review-id={id} aria-pressed={selected} onClick={(event) => { event.stopPropagation(); onSelect(row); }} onKeyDown={(event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onSelect(row); } }}><time>{formatDateTime(row.completedAt ?? row.updatedAt ?? row.createdAt)}</time></button></td>
        <td><b>{identity(row.symbol ?? row.trade?.symbol) ?? unavailable()}</b></td>
        <td><Tone tone={sideTone(row.direction ?? row.side ?? row.trade?.direction)}>{humanize(row.direction ?? row.side ?? row.trade?.direction, unavailable())}</Tone></td>
        <td><strong className={pnl === null ? "" : pnl >= 0 ? "positiveText" : "negativeText"}>{pnl === null ? unavailable() : `${signedMoney(pnl)} U`}</strong></td>
        <td><Tone tone={statusTone(row.status)}>{humanize(row.status, unavailable())}</Tone></td>
      </tr>;
    })}</tbody></table></div>
      : <CockpitEmpty icon={Clock3} title={t("当前筛选没有复盘", "No reviews match")} detail={t("调整本地筛选，或等待真实平仓进入复盘队列。", "Adjust local filters or wait for a real close to enter review.")}/>
    }
    <footer className="reviewPagination"><span>{t(`${rows.length} 笔显示`, `${rows.length} shown`)}</span><div><button type="button" data-review-page-prev disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t("上一页", "Previous page")}>←</button><b>{page}</b><button type="button" data-review-page-next disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={t("下一页", "Next page")}>→</button></div></footer>
  </CockpitPanel>;
}

function PathChart({ review }) {
  const points = recordedPathOf(review);
  if (points.length < 2) return <CockpitEmpty icon={Clock3} title={t("未记录逐时路径", "No intratrade path recorded")} detail={t("汇总轨迹不等于逐时样本；只有真实价格、权益或盈亏序列才会绘图。", "Aggregate trajectory metadata is not a sampled path; only recorded price, equity, or PnL samples are charted.")}/>;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const coordinates = points.map((point, index) => ({ ...point, x: 3 + index / (points.length - 1) * 94, y: 34 - (point.value - min) / range * 28 }));
  const path = `M ${coordinates.map((point) => `${point.x} ${point.y}`).join(" L ")}`;
  const zeroY = min <= 0 && max >= 0 ? 34 - (0 - min) / range * 28 : null;
  return <div className="reviewPathChart" data-review-path-samples={points.length}>
    <svg role="img" aria-label={t("本笔交易已记录路径", "Recorded intratrade path")} viewBox="0 0 100 38" preserveAspectRatio="none">
      {zeroY !== null && <line className="zero" x1="2" x2="98" y1={zeroY} y2={zeroY}/>}<path d={path}/>
      {coordinates.map((point, index) => <circle key={`${point.label}-${index}`} cx={point.x} cy={point.y} r="1.15"><title>{`${point.label}: ${point.value}`}</title></circle>)}
    </svg>
    <div><span><small>{t("区间最低", "Range low")}</small><b>{min}</b></span><span><small>{t("区间最高", "Range high")}</small><b>{max}</b></span><span><small>{t("样本", "Samples")}</small><b>{points.length}</b></span></div>
  </div>;
}

function TradeDetail({ selected }) {
  if (!selected) return <CockpitPanel className="reviewTradeDetail empty" region="trade-detail" title={t("交易详情", "Trade detail")}><CockpitEmpty icon={Target} title={t("未选择有效复盘", "No valid review selected")} detail={t("深链身份未匹配时不会回退到另一笔交易。", "An unmatched deep-link identity never falls back to another trade.")}/></CockpitPanel>;
  const trade = selected.trade && typeof selected.trade === "object" ? selected.trade : {};
  const pnl = numeric(selected.netPnlUsdt);
  const returnPct = numeric(selected.returnPct ?? selected.roiPct ?? selected.netRoiPct ?? trade.returnPct ?? trade.roiPct ?? trade.netRoiPct);
  const hold = holdMinutesOf(selected);
  const fee = numeric(selected.totalFeeUsdt ?? trade.totalFeeUsdt ?? selected.feeUsdt ?? trade.feeUsdt);
  const confidence = numeric(selected.confidence);
  const aiScore = numeric(selected.aiScore ?? selected.reviewScore ?? selected.structuredAssessment?.processScore);
  const strategy = selected.strategy ?? selected.strategyName ?? selected.strategyVersionId ?? trade.strategy ?? trade.strategyName ?? trade.strategyVersionId;
  const signal = selected.signal ?? selected.entrySignal ?? trade.signal ?? trade.entrySignal;
  const facts = [
    [t("净盈亏", "Net PnL"), pnl === null ? unavailable() : `${signedMoney(pnl)} USDT`, pnl],
    [t("收益率", "Return"), percent(returnPct, 2)],
    [t("持仓时长", "Holding time"), hold === null ? unavailable() : hold < 60 ? `${Math.round(hold)}m` : `${Math.floor(hold / 60)}h ${Math.round(hold % 60)}m`],
    [t("入场价", "Entry"), money(selected.entryPrice ?? trade.entryPrice)],
    [t("出场价", "Exit"), money(selected.exitPrice ?? trade.exitPrice)],
    [t("费用", "Fees"), fee === null ? unavailable() : `${money(fee)} U`]
  ];
  return <CockpitPanel className="reviewTradeDetail" region="trade-detail" title={`${identity(selected.symbol ?? trade.symbol) ?? t("交易", "Trade")} · ${t("交易详情", "Trade detail")}`} meta={formatDateTime(selected.completedAt ?? selected.updatedAt ?? selected.createdAt)}>
    <article className="reviewSelectedIdentity" data-review-detail-id={identity(selected.id)}><span><small>{t("复盘对象", "Review object")}</small><b>{identity(selected.id)}</b></span><div><Tone tone={sideTone(selected.direction ?? selected.side ?? trade.direction)}>{humanize(selected.direction ?? selected.side ?? trade.direction, unavailable())}</Tone><Tone tone={statusTone(selected.status)}>{humanize(selected.status, unavailable())}</Tone></div></article>
    <div className="reviewDetailFacts">{facts.map(([label, value, tone]) => <span key={label}><small>{label}</small><b className={tone === undefined || tone === null ? "" : tone >= 0 ? "positiveText" : "negativeText"}>{value}</b></span>)}</div>
    <div className="reviewDetailBody">
      <section className="reviewOverview"><h3>{t("交易概览", "Trade overview")}</h3><dl><div><dt>{t("策略", "Strategy")}</dt><dd>{localizeText(strategy, unavailable())}</dd></div><div><dt>{t("信号", "Signal")}</dt><dd>{localizeText(signal, unavailable())}</dd></div><div><dt>{t("置信度", "Confidence")}</dt><dd>{percent(confidence)}</dd></div><div><dt>{t("AI 评分", "AI score")}</dt><dd>{aiScore === null ? unavailable() : `${aiScore.toFixed(0)} / 100`}</dd></div></dl></section>
      <section className="reviewTradePath" data-cockpit-region="trade-path"><h3>{t("本笔路径", "Intratrade path")}</h3><PathChart review={selected}/></section>
    </div>
    <section className="reviewRecordedNarrative"><span><Sparkles aria-hidden="true"/><b>{t("已记录复盘", "Recorded review")}</b></span><p>{localizeText(selected.summary, t("暂无结果概述。", "No outcome summary recorded."))}</p>{(selected.deepReflection || selected.rootCause || selected.lesson) && <details><summary>{t("分析与教训", "Analysis and lesson")}</summary><p>{localizeText(selected.deepReflection ?? selected.rootCause ?? selected.lesson)}</p></details>}</section>
  </CockpitPanel>;
}

function HoldPnlDistribution({ reviews }) {
  const points = reviews.map((review) => ({ id: identity(review.id), symbol: identity(review.symbol ?? review.trade?.symbol), hold: holdMinutesOf(review), pnl: numeric(review.netPnlUsdt) })).filter((point) => point.id && point.hold !== null && point.pnl !== null);
  if (!points.length) return <CockpitEmpty icon={Clock3} title={t("持仓与盈亏分布不可用", "Hold/PnL distribution unavailable")} detail={t("需要同一笔复盘同时记录持仓分钟与净盈亏。", "Each point requires recorded holding minutes and net PnL on the same review/trade.")}/>;
  const maxHold = Math.max(...points.map((point) => point.hold), 1);
  const minPnl = Math.min(...points.map((point) => point.pnl), 0);
  const maxPnl = Math.max(...points.map((point) => point.pnl), 0);
  const pnlRange = maxPnl - minPnl || 1;
  const zeroY = 34 - (0 - minPnl) / pnlRange * 27;
  return <div className="reviewScatter"><svg viewBox="0 0 100 39" role="img" aria-label={t("真实持仓分钟与净盈亏散点", "Recorded holding-minutes and net-PnL scatter")} preserveAspectRatio="none"><line x1="3" x2="98" y1={zeroY} y2={zeroY}/>{points.map((point) => <circle className={point.pnl >= 0 ? "positive" : "negative"} key={point.id} cx={4 + point.hold / maxHold * 92} cy={34 - (point.pnl - minPnl) / pnlRange * 27} r="1.5"><title>{`${point.symbol || point.id}: ${point.hold}m · ${signedMoney(point.pnl)} U`}</title></circle>)}</svg><div><span>0m</span><span>{Math.round(maxHold / 2)}m</span><span>{Math.round(maxHold)}m</span></div></div>;
}

function BottomInsights({ reviews, behavior, selected }) {
  const flags = objects(behavior?.flags).filter((row) => [row.title, row.detail].some((value) => typeof value === "string" && value.trim()));
  const recordedActions = [
    ...list(behavior?.disciplines), selected?.improvement, selected?.nextAction, selected?.lesson
  ].filter((value) => typeof value === "string" && value.trim()).filter((value, index, values) => values.indexOf(value) === index).slice(0, 4);
  return <div className="reviewBottomV2">
    <CockpitPanel className="reviewDistribution" region="hold-pnl-distribution" title={t("持仓时长与盈亏分布", "Holding time × PnL")} meta={t("真实复盘点", "Recorded review points")}><HoldPnlDistribution reviews={reviews}/></CockpitPanel>
    <CockpitPanel className="reviewBehavior" region="behavior-insights" title={t("行为洞察", "Behavior insights")} meta={t("画像记录", "Profile evidence")}><div>{flags.length ? flags.slice(0, 4).map((flag, index) => <article key={identity(flag.key) ?? index}><AlertTriangle aria-hidden="true"/><span><b>{localizeText(flag.title ?? flag.detail)}</b>{flag.detail && flag.title && <p>{localizeText(flag.detail)}</p>}</span></article>) : <CockpitEmpty icon={Lightbulb} title={t("暂无已记录行为洞察", "No recorded behavior insights")}/>}</div></CockpitPanel>
    <CockpitPanel className="reviewNextActions" region="next-actions" title={t("下一步行动", "Next actions")} meta={t("仅已记录建议", "Recorded guidance only")}><div>{recordedActions.length ? recordedActions.map((action, index) => <article key={`${action}-${index}`}><CheckCircle2 aria-hidden="true"/><p>{localizeText(action)}</p></article>) : <CockpitEmpty icon={Target} title={t("暂无已记录行动", "No recorded next actions")} detail={t("系统不会根据空白字段生成建议。", "The system does not generate guidance from missing fields.")}/>}</div></CockpitPanel>
  </div>;
}

export function ReviewPage({ data = {}, initialReviewId, onReviewSelect, ui = {} }) {
  const sanitized = useMemo(() => ({
    ...data,
    reviews: objects(data.reviews),
    closedTradeLifecycles: Array.isArray(data.closedTradeLifecycles) ? objects(data.closedTradeLifecycles) : data.closedTradeLifecycles,
    executionOrders: objects(data.executionOrders),
    fills: objects(data.fills)
  }), [data]);
  const presentation = useMemo(() => buildReviewPresentation(sanitized), [sanitized]);
  const reviews = validReviews(presentation.reviews);
  const behavior = data.behaviorProfile && typeof data.behaviorProfile === "object" ? data.behaviorProfile : {};
  const state = resourceStateOf(data);
  const hasFacts = reviews.length > 0 || objects(data.closedTradeLifecycles).length > 0 || (data.performance && typeof data.performance === "object" && Object.values(data.performance).some(finite));
  const retainsFacts = ["loading", "stale", "degraded"].includes(state) && hasFacts;
  const bodyVisible = state === "loaded" || retainsFacts;
  const explicitInitial = initialReviewId !== undefined && initialReviewId !== null && initialReviewId !== "";
  const normalizedInitial = identity(initialReviewId);
  const initialIndex = normalizedInitial ? reviews.findIndex((row) => identity(row.id) === normalizedInitial) : -1;
  const [selectedId, setSelectedId] = useState(() => explicitInitial ? (normalizedInitial && reviews.some((row) => identity(row.id) === normalizedInitial) ? normalizedInitial : "") : identity(reviews[0]?.id) ?? "");
  const [filters, setFilters] = useState({ status: "all", direction: "all", result: "all", symbol: "all" });
  const [page, setPage] = useState(() => initialIndex >= 0 ? Math.floor(initialIndex / PAGE_SIZE) + 1 : 1);

  useEffect(() => {
    if (explicitInitial) {
      setSelectedId(normalizedInitial && reviews.some((row) => identity(row.id) === normalizedInitial) ? normalizedInitial : "");
      const index = normalizedInitial ? reviews.findIndex((row) => identity(row.id) === normalizedInitial) : -1;
      setPage(index >= 0 ? Math.floor(index / PAGE_SIZE) + 1 : 1);
      return;
    }
    if (!reviews.some((row) => identity(row.id) === selectedId)) setSelectedId(identity(reviews[0]?.id) ?? "");
  }, [explicitInitial, normalizedInitial, reviews, selectedId]);

  const symbols = useMemo(() => [...new Set(reviews.map((row) => identity(row.symbol ?? row.trade?.symbol)).filter(Boolean))].sort(), [reviews]);
  const filtered = useMemo(() => reviews.filter((row) => {
    if (filters.status === "completed" && !completed(row)) return false;
    if (filters.status === "pending" && completed(row)) return false;
    if (filters.direction !== "all" && directionOf(row) !== filters.direction) return false;
    if (filters.result !== "all" && resultOf(row) !== filters.result) return false;
    if (filters.symbol !== "all" && identity(row.symbol ?? row.trade?.symbol) !== filters.symbol) return false;
    return true;
  }), [filters, reviews]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const selected = filtered.find((row) => identity(row.id) === selectedId) ?? null;
  useEffect(() => {
    if (selectedId && !filtered.some((row) => identity(row.id) === selectedId)) setSelectedId("");
  }, [filtered, selectedId]);
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  const select = (row) => {
    const id = identity(row?.id);
    if (!id || !filtered.some((candidate) => identity(candidate.id) === id)) return;
    setSelectedId(id);
    onReviewSelect?.(id);
  };
  const retry = () => {
    if (typeof ui.refresh === "function") ui.refresh();
    else ui.ensureSection?.("cockpit");
  };
  const changeFilters = (updater) => {
    setFilters(updater);
    setPage(1);
  };

  return <div className="cockpitPage cockpitReviewV2" data-cockpit-page="execution" data-resource-state={state} data-selected-review-id={identity(selected?.id) ?? ""}>
    {state !== "loaded" && (
      <ReviewResourceState state={state} retainsFacts={retainsFacts} onRetry={retry}/>
    )}
    {bodyVisible && <>
      <header className="reviewTitleV2"><div><h1>{t("执行与复盘", "Execution & Review")}</h1><p>{t("从真实平仓生命周期追溯结果、过程、行为与已记录改进。", "Trace real closed lifecycles through outcomes, process, behavior, and recorded improvements.")}</p></div><Tone tone={reviews.some((row) => !completed(row)) ? "warning" : reviews.length ? "positive" : "neutral"}>{t(`${reviews.length} 笔复盘`, `${reviews.length} reviews`)}</Tone></header>
      <ReviewHero data={data} presentation={presentation} behavior={behavior}/>
      <AiConclusion behavior={behavior} selected={selected} sampleCount={filtered.length}/>
      <ReviewFilters filters={filters} setFilters={changeFilters} symbols={symbols} total={filtered.length}/>
      <div className={`reviewWorkbench ${reviews.length ? "" : "empty"}`.trim()} data-cockpit-region="review-workbench">
        <TradeList rows={pageRows} selectedId={identity(selected?.id)} page={safePage} pages={pages} onPage={setPage} onSelect={select}/>
        <TradeDetail selected={selected}/>
      </div>
      <BottomInsights reviews={reviews} behavior={behavior} selected={selected}/>
    </>}
  </div>;
}
