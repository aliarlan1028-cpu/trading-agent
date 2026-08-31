import { Bot, CheckCircle2, FileCheck2, Gauge, ReceiptText, ShieldCheck, Sparkles } from "lucide-react";

const list = (value) => Array.isArray(value) ? value : [];
const value = (input, fallback = "Unavailable") => input === null || input === undefined || input === "" ? fallback : String(input);

export function ReviewInspector({ review = null, onSelectEvidence = () => {} }) {
  if (!review) return <section className="kordynV2ReviewInspector is-empty"><strong>选择一笔已平仓交易</strong><p>复盘只使用已对账成交、费用和权威 Trace。</p></section>;
  const evidence = list(review.evidence);
  const rootCauses = list(review.rootCauses);
  return (
    <section className="kordynV2ReviewInspector" data-kordyn-v2-review-inspector={review.id}>
      <header><span><strong>{value(review.symbol)}</strong><small>{value(review.strategyName || review.strategyVersionId)}</small></span><em>{value(review.status || review.lifecycle?.label)}</em></header>
      <section className="kordynV2ReviewMetrics"><span><small>净收益</small><strong>{value(review.netRealizedPnl ?? review.realizedPnl)}</strong></span><span><small>持仓</small><strong>{review.holdingMinutes != null ? `${review.holdingMinutes}m` : "Unavailable"}</strong></span><span><small>滑点</small><strong>{review.avgSlippagePct != null ? `${review.avgSlippagePct}%` : "Unavailable"}</strong></span><span><small>方向</small><strong>{value(review.direction)}</strong></span></section>
      <article className="kordynV2ReviewSummary"><Bot size={17} aria-hidden="true" /><span><small>AI 复盘结论</small><p>{value(review.summary || review.note, "当前复盘没有权威摘要。")}</p></span></article>
      <section className="kordynV2ReviewEvidence" data-kordyn-v2-review-evidence>
        <header><span><FileCheck2 size={14} aria-hidden="true" /><strong>权威证据</strong></span><small>{evidence.length} 条</small></header>
        <div>{evidence.map((item) => <button type="button" key={item.id} data-kordyn-v2-review-evidence-id={item.id} onClick={() => onSelectEvidence(item)}><ReceiptText size={14} aria-hidden="true" /><span><strong>{value(item.label || item.type)}</strong><small>{value(item.id)}</small></span><CheckCircle2 size={14} aria-label={value(item.status)} /></button>)}{!evidence.length && <p>缺少权威证据，不能进入 Owner 发布。</p>}</div>
      </section>
      <section className="kordynV2ReviewCauses"><header><Gauge size={14} aria-hidden="true" /><strong>根因与置信度</strong></header>{rootCauses.map((cause) => <div key={cause.code || cause.label}><Sparkles size={13} aria-hidden="true" /><span><strong>{value(cause.label || cause.code)}</strong><small>{value(cause.code)}</small></span><em>{cause.confidence != null ? `${Math.round(Number(cause.confidence) * 100)}%` : "Unavailable"}</em></div>)}{!rootCauses.length && <p>没有可验证根因，不生成改进结论。</p>}</section>
      <p className="kordynV2ReviewBoundary"><ShieldCheck size={13} aria-hidden="true" />复盘结论只进入候选队列，不会自动修改策略、能力或风控配置。</p>
    </section>
  );
}
