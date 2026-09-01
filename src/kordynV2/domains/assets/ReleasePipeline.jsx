import { Check, Circle, FlaskConical, Rocket, ShieldCheck } from "lucide-react";

const list = (value) => Array.isArray(value) ? value : [];
const stagePassed = (stage) => /passed|completed|verified/i.test(String(stage?.status));

export function ReleasePipeline({ candidate = null, actions, actionsDisabled = false, validationRuns = [], onSelectValidation = () => {} }) {
  if (!candidate) return <section className="kordynV2ReleasePipeline is-empty" data-kordyn-v2-release-pipeline><strong>4 · 版本晋级与发布</strong><p>选择 Owner 候选查看验证证据。</p></section>;
  const stages = list(candidate.validation?.stages);
  const evidence = list(candidate.validationEvidence);
  const ready = candidate.state === "validating"
    && (candidate.validation?.ready === true || candidate.validation?.readyForOwnerVerification === true)
    && stages.length > 0
    && stages.every(stagePassed)
    && (candidate.destination === "strategy" || evidence.length > 0);
  const release = () => actions?.decideImprovement?.(candidate.id, "verify", {
    destination: candidate.destination,
    ownerAttested: true,
    validationEvidence: evidence,
    version: candidate.version
  });
  const relatedRuns = validationRuns.filter((row) => !row.improvementId || row.improvementId === candidate.id || row.sourceImprovementId === candidate.id);
  return (
    <section className="kordynV2ReleasePipeline" data-kordyn-v2-release-pipeline data-release-ready={ready}>
      <header><span><b>4</b><strong>版本晋级与发布</strong></span><small>{candidate.title}</small></header>
      <div className="kordynV2ReleaseSteps"><span data-complete="true"><Check size={13} aria-hidden="true" /><small>Owner 接受</small></span>{stages.map((stage, index) => <span key={stage.name || index} data-complete={stagePassed(stage)}>{stagePassed(stage) ? <Check size={13} aria-hidden="true" /> : <Circle size={13} aria-hidden="true" />}<small>{stage.label || stage.name}</small></span>)}<span data-complete={ready}><Rocket size={13} aria-hidden="true" /><small>显式发布</small></span></div>
      <article><span><FlaskConical size={16} aria-hidden="true" /><strong>{candidate.version || "current candidate"}</strong><small>{candidate.destination} · {stages.filter(stagePassed).length}/{stages.length} stages passed</small></span><div className="kordynV2ValidationRuns">{relatedRuns.map((run) => <button type="button" key={run.id} data-kordyn-v2-validation-run={run.id} data-kordyn-v2-object-id={run.id} data-kordyn-v2-object-type={run.selectionType || "Validation run"} onClick={() => onSelectValidation(run)}><small>{run.selectionType || "Validation run"}</small><strong>{run.label || run.name || run.id}</strong><em>{run.status || "Unavailable"}</em></button>)}{!relatedRuns.length && <p><ShieldCheck size={14} aria-hidden="true" />Owner 明确确认只发布当前已验证版本；现有授权和风险边界保持权威。</p>}</div><button type="button" data-kordyn-v2-action="release" disabled={actionsDisabled || !ready} onClick={release}>{ready ? "确认有效并发布新版本" : "不可发布 · 验证证据未完成"}</button></article>
    </section>
  );
}
