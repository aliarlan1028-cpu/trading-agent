import { ArrowRight, BookOpen, CircleGauge, Puzzle, Sparkles, X } from "lucide-react";

const ARTIFACTS = Object.freeze([
  ["strategy_draft", "策略草稿", CircleGauge],
  ["knowledge_lens", "知识 Lens", BookOpen],
  ["knowledge_workflow", "知识 Workflow", Puzzle],
  ["imported_skill_record", "导入 Skill 记录", Sparkles]
]);

export function IncubationQueue({ candidates = [], actions, actionsDisabled = false, onSelect = () => {} }) {
  return (
    <section className="kordynV2IncubationQueue">
      <header><span><strong>孵化候选</strong><small>只进入现有受控资产类型</small></span><em>{candidates.length}</em></header>
      <nav aria-label="支持的候选产物">{ARTIFACTS.map(([kind, label, Icon]) => <span key={kind} data-artifact-type={kind}><Icon size={13} aria-hidden="true" />{label}</span>)}</nav>
      <div>{candidates.map((candidate) => <article key={candidate.id} data-kordyn-v2-candidate-id={candidate.id} data-artifact-type={candidate.artifactType || "unsupported"}>
        <button type="button" onClick={() => onSelect(candidate)}><span><strong>{candidate.title || candidate.name || candidate.id}</strong><small>{candidate.artifactType || "Unsupported artifact"} · {candidate.lifecycle?.stage}</small></span><ArrowRight size={15} aria-hidden="true" /></button>
        <footer>
          <button type="button" disabled={actionsDisabled} onClick={() => actions?.ignoreCandidate?.(candidate.id)}><X size={12} aria-hidden="true" />驳回</button>
          {candidate.lifecycle?.stage === "candidate" ? <button type="button" disabled={actionsDisabled || !candidate.artifactType} onClick={() => actions?.adoptCandidate?.(candidate.id)}>纳入孵化</button> : <button type="button" disabled={actionsDisabled || !candidate.artifactType} onClick={() => actions?.approveCandidate?.(candidate.id, candidate.version || candidate.updatedAt)}>审批当前版本</button>}
        </footer>
      </article>)}</div>
    </section>
  );
}
