import { ChevronRight, FileCheck2, ShieldCheck } from "lucide-react";
import { OwnerDecisionQueue } from "./OwnerDecisionQueue.jsx";
import { ReleasePipeline } from "./ReleasePipeline.jsx";
import { ReviewInspector } from "./ReviewInspector.jsx";
import { ReviewOutputSheet } from "./ReviewOutputSheet.jsx";

export function MobileReviewReleaseScreen({ model, actions, actionsDisabled = false, selectedReviewId = "", selectedOwnerId = "", onSelectReview = () => {}, onSelectOwner = () => {}, onSelectEvidence = () => {}, onSelectValidation = () => {}, onNavigate = () => {} }) {
  const reviews = model?.reviews || [];
  const improvements = model?.owner?.improvements || [];
  const review = reviews.find((row) => row.id === selectedReviewId) || reviews[0] || null;
  const owner = improvements.find((row) => row.id === selectedOwnerId) || improvements[0] || null;
  const validationRuns = [...(model?.validationRuns?.backtests || []).map((row) => ({ ...row, selectionType: "Validation run" })), ...(model?.validationRuns?.paper || []).map((row) => ({ ...row, selectionType: "Paper run" }))];
  return (
    <section className="kordynV2AssetsMobile kordynV2MobileReviews" data-kordyn-v2-assets-mobile="reviews">
      <header><h2>复盘与发布</h2><p>交易结果、证据、Owner 决策与验证发布</p></header>
      <section className="kordynV2MobileReviewList" data-kordyn-v2-mobile-review-flow><header><strong>已完成复盘</strong><small>{reviews.length}</small></header>{reviews.map((row) => <button type="button" key={row.id} data-selected={row.id === review?.id} onClick={() => onSelectReview(row)}><span><em>{row.symbol || "Review"}</em><strong>{row.strategyName || row.strategyVersionId || row.id}</strong><small>{row.netRealizedPnl ?? row.realizedPnl ?? "Unavailable"} · {row.completedAt || row.createdAt || "Unavailable"}</small></span><ChevronRight size={18} aria-hidden="true" /></button>)}</section>
      <section className="kordynV2MobileReviewDetail" data-kordyn-v2-mobile-evidence-flow><i aria-hidden="true" /><ReviewInspector review={review} onSelectEvidence={onSelectEvidence} /></section>
      <section data-kordyn-v2-mobile-owner-flow><header className="kordynV2MobileOwnerTitle"><ShieldCheck size={16} aria-hidden="true" /><strong>Owner 决策</strong></header><OwnerDecisionQueue improvements={improvements} actions={actions} actionsDisabled={actionsDisabled} selectedId={owner?.id || ""} onSelect={onSelectOwner} /></section>
      <section data-kordyn-v2-mobile-release-flow><header className="kordynV2MobileOwnerTitle"><FileCheck2 size={16} aria-hidden="true" /><strong>验证与发布</strong></header><ReleasePipeline candidate={owner} actions={actions} actionsDisabled={actionsDisabled} validationRuns={validationRuns} onSelectValidation={onSelectValidation} /></section>
      <ReviewOutputSheet review={review} onNavigate={onNavigate} />
    </section>
  );
}
