import { ImageDown, ListChecks } from "lucide-react";
import { OwnerDecisionQueue } from "./OwnerDecisionQueue.jsx";
import { ReleasePipeline } from "./ReleasePipeline.jsx";
import { ReviewInspector } from "./ReviewInspector.jsx";
import { ReviewOutputSheet } from "./ReviewOutputSheet.jsx";
import { ReviewRegistry } from "./ReviewRegistry.jsx";

export function ReviewReleaseWorkspace({ model, actions, actionsDisabled = false, selectedReviewId = "", selectedOwnerId = "", onSelectReview = () => {}, onSelectOwner = () => {}, onSelectEvidence = () => {}, onSelectValidation = () => {}, onNavigate = () => {} }) {
  const reviews = model?.reviews || [];
  const improvements = model?.owner?.improvements || [];
  const selectedReview = reviews.find((row) => row.id === selectedReviewId) || reviews[0] || null;
  const selectedOwner = improvements.find((row) => row.id === selectedOwnerId) || improvements[0] || null;
  const validationRuns = [...(model?.validationRuns?.backtests || []).map((row) => ({ ...row, selectionType: "Validation run" })), ...(model?.validationRuns?.paper || []).map((row) => ({ ...row, selectionType: "Paper run" }))];
  return (
    <section className="kordynV2ReviewReleaseWorkspace" data-kordyn-v2-assets-workspace="reviews">
      <header className="kordynV2AssetsTitle kordynV2ReviewReleaseTitle"><span><h1>复盘与 Owner 发布</h1><p>把真实交易结果转化为可验证改进，而不是直接改写实盘。</p></span><div><button type="button" onClick={() => onNavigate("command", "reviews")}><ImageDown size={14} aria-hidden="true" />生成复盘</button><button type="button" onClick={() => onNavigate("assets", "reviews")}><ListChecks size={14} aria-hidden="true" />Owner 队列 {improvements.length}</button></div></header>
      <div className="kordynV2ReviewReleaseWorkbench">
        <div className="kordynV2ReviewColumn"><ReviewRegistry reviews={reviews} selectedId={selectedReview?.id || ""} onSelect={onSelectReview} /><ReviewInspector review={selectedReview} onSelectEvidence={onSelectEvidence} /></div>
        <div className="kordynV2OwnerColumn"><OwnerDecisionQueue improvements={improvements} actions={actions} actionsDisabled={actionsDisabled} selectedId={selectedOwner?.id || ""} onSelect={onSelectOwner} /></div>
        <ReleasePipeline candidate={selectedOwner} actions={actions} actionsDisabled={actionsDisabled} validationRuns={validationRuns} onSelectValidation={onSelectValidation} />
      </div>
      <ReviewOutputSheet review={selectedReview} onNavigate={onNavigate} />
    </section>
  );
}
