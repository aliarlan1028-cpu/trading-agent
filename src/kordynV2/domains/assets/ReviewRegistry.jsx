import { ArrowDown, CheckCircle2, ChevronRight, Clock3 } from "lucide-react";

const value = (input, fallback = "Unavailable") => input === null || input === undefined || input === "" ? fallback : String(input);
const pnl = (row) => Number(row.netRealizedPnl ?? row.realizedPnl);

export function ReviewRegistry({ reviews = [], selectedId = "", onSelect = () => {} }) {
  const completed = reviews.filter((row) => String(row.status || row.lifecycle?.stage).toLowerCase() === "completed");
  const wins = completed.filter((row) => pnl(row) > 0).length;
  const net = completed.reduce((sum, row) => sum + (Number.isFinite(pnl(row)) ? pnl(row) : 0), 0);
  return (
    <section className="kordynV2ReviewRegistry">
      <header><span><b>1</b><strong>交易复盘</strong></span><small><ArrowDown size={12} aria-hidden="true" />按平仓时间</small></header>
      <dl><div><dt>已完成</dt><dd>{completed.length}</dd></div><div><dt>胜率</dt><dd>{completed.length ? `${((wins / completed.length) * 100).toFixed(1)}%` : "Unavailable"}</dd></div><div><dt>净收益</dt><dd data-tone={net >= 0 ? "positive" : "negative"}>{net >= 0 ? "+" : ""}{net.toFixed(2)}</dd></div><div><dt>平均滑点</dt><dd>{value(completed[0]?.avgSlippagePct, "Unavailable")}{completed[0]?.avgSlippagePct != null ? "%" : ""}</dd></div></dl>
      <div>{reviews.map((review) => <button type="button" key={review.id} data-kordyn-v2-review-id={review.id} data-kordyn-v2-object-id={review.id} data-kordyn-v2-object-type="Review" data-selected={review.id === selectedId} onClick={() => onSelect(review)}><span className="kordynV2ReviewAssetMark">{String(review.symbol || "?").slice(0, 1)}</span><span><strong>{value(review.symbol)}</strong><small>{value(review.strategyName || review.strategyVersionId || review.strategyId)}</small></span><em data-tone={pnl(review) >= 0 ? "positive" : "negative"}>{Number.isFinite(pnl(review)) ? `${pnl(review) >= 0 ? "+" : ""}${pnl(review).toFixed(2)}` : "Unavailable"}</em><time><Clock3 size={11} aria-hidden="true" />{value(review.completedAt || review.createdAt)}</time>{String(review.status).toLowerCase() === "completed" ? <CheckCircle2 size={14} aria-label="已完成" /> : <ChevronRight size={14} aria-hidden="true" />}</button>)}{!reviews.length && <p>暂无已完成交易复盘 · No completed reviews</p>}</div>
    </section>
  );
}
