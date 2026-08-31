import { ArrowUpRight, Download, Edit3, FileText, Share2 } from "lucide-react";
import { useMemo, useState } from "react";

const MODES = Object.freeze([
  ["professional", "专业摘要", FileText],
  ["data", "数据简报", Download],
  ["social", "社区分享", Share2]
]);

function draftFor(review) {
  const pnl = review?.netRealizedPnl ?? review?.realizedPnl;
  return `${review?.symbol || "交易复盘"} · ${review?.strategyName || review?.strategyVersionId || "策略版本未载入"}\n${review?.summary || "当前没有权威复盘摘要。"}\n净收益 ${pnl ?? "Unavailable"} · 仅供复盘，不构成投资建议`;
}

export function ReviewOutputSheet({ review = null, onNavigate = () => {} }) {
  const initial = useMemo(() => draftFor(review), [review]);
  const [mode, setMode] = useState("professional");
  const [copy, setCopy] = useState(initial);
  if (!review) return null;
  return (
    <aside className="kordynV2ReviewOutput" data-kordyn-v2-output-draft>
      <header><span><strong>海报草稿</strong><small>{review.symbol || "Review"}</small></span><Edit3 size={15} aria-hidden="true" /></header>
      <section><small>KORDYN · REVIEW DRAFT</small><strong>{review.symbol} 交易复盘</strong><dl><div><dt>净收益</dt><dd>{review.netRealizedPnl ?? review.realizedPnl ?? "Unavailable"}</dd></div><div><dt>滑点</dt><dd>{review.avgSlippagePct != null ? `${review.avgSlippagePct}%` : "Unavailable"}</dd></div></dl><p>{review.summary || "当前没有权威复盘摘要。"}</p></section>
      <nav aria-label="海报文案风格">{MODES.map(([id, label, Icon]) => <button type="button" key={id} data-selected={mode === id} onClick={() => setMode(id)}><Icon size={12} aria-hidden="true" />{label}</button>)}</nav>
      <label>可编辑文案<textarea value={copy} onChange={(event) => setCopy(event.target.value)} /></label>
      <p>输出状态：草稿 · 人工审阅后导出，不会自动发布</p>
      <button type="button" onClick={() => onNavigate("command", "dialog")}><ArrowUpRight size={13} aria-hidden="true" />进入 AI 交易员生成</button>
    </aside>
  );
}
