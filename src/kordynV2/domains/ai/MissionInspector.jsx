import { ArrowRight, Bot, FileCheck2, FileImage, Link2, MessagesSquare, ShieldAlert } from "lucide-react";
import { MissionProgress } from "./MissionProgress.jsx";

const unavailable = "Unavailable";
const safeValue = (value) => value === null || value === undefined || value === "" ? unavailable : String(value);
const proofRequest = (mission) => ({
  panel: "proof",
  candidate: {
    id: mission.id,
    type: "Agent run",
    workspaceId: "ai",
    route: "chat",
    evidence: mission.evidenceCount
  }
});

function MissionFact({ label, value, icon: Icon }) {
  return (
    <div className="kordynV2AiMissionFact">
      <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
      <dt>{label}</dt>
      <dd>{safeValue(value)}</dd>
    </div>
  );
}
export function MissionInspector({ mission, selection, actionsDisabled = false, onOpenProof = () => {}, onOpenApproval = () => {}, onOpenOutput = () => {} }) {
  if (!mission) {
    return (
      <article className="kordynV2AiMissionInspector is-empty" data-kordyn-v2-mission-inspector data-kordyn-v2-selected-mission="Unavailable">
        <Bot size={30} aria-hidden="true" />
        <h2>选择一个 Mission</h2>
        <p>Agent run · {unavailable}</p>
      </article>
    );
  }

  const approvalRequired = mission.stage?.id === "approval";
  return (
    <article
      className="kordynV2AiMissionInspector"
      data-kordyn-v2-mission-inspector
      data-kordyn-v2-selected-mission={mission.id}
      data-kordyn-v2-object-id={mission.id}
      data-kordyn-v2-object-type="Agent run"
    >
      <header className="kordynV2AiMissionInspectorHeader">
        <span className="kordynV2AiMissionGlyph" aria-hidden="true"><Bot size={21} /></span>
        <span>
          <h2>{safeValue(mission.title)}</h2>
          <p>{safeValue(mission.summary)}</p>
        </span>
        <em data-stage-tone={mission.stage?.tone || "unavailable"}>{safeValue(mission.stage?.label)}</em>
      </header>

      <MissionProgress mission={mission} />

      <p className="kordynV2AiMissionNow" role="status">
        <span aria-hidden="true" />
        {safeValue(mission.stage?.label)}
      </p>

      <section className="kordynV2AiMissionDecision" aria-labelledby="kordyn-v2-ai-mission-decision-title">
        <h3 id="kordyn-v2-ai-mission-decision-title">任务事实</h3>
        <dl>
          <MissionFact icon={MessagesSquare} label="当前摘要" value={mission.summary} />
          <MissionFact icon={FileCheck2} label="证据数量" value={mission.evidenceCount} />
          <MissionFact icon={ArrowRight} label="下一步" value={mission.nextAction} />
          <MissionFact icon={ShieldAlert} label="授权状态" value={mission.approval?.status} />
          <MissionFact icon={Link2} label="Plan ID" value={mission.approval?.planId} />
        </dl>
      </section>

      {approvalRequired && (
        <aside className="kordynV2AiMissionApproval" role="status">
          <ShieldAlert size={18} aria-hidden="true" />
          <span><strong>需要你确认</strong><small>Plan {safeValue(mission.approval?.planId)} · 打开后仍需受保护确认，服务器会重新校验。</small></span>
        </aside>
      )}

      <footer className="kordynV2AiMissionInspectorFooter">
        {approvalRequired && <button type="button" data-kordyn-v2-open-approval={mission.id} aria-haspopup="dialog" disabled={actionsDisabled} onClick={(event) => { if (!actionsDisabled) onOpenApproval(mission, event.currentTarget); }}><ShieldAlert size={16} aria-hidden="true" />打开任务确认</button>}
        {mission.output && <button type="button" data-kordyn-v2-open-output={mission.id} aria-haspopup="dialog" disabled={actionsDisabled} onClick={(event) => { if (!actionsDisabled) onOpenOutput(mission.output, event.currentTarget); }}><FileImage size={16} aria-hidden="true" />生成 PNG 输出</button>}
        <button
          type="button"
          aria-haspopup="dialog"
          data-kordyn-v2-mission-proof={mission.id}
          onClick={(event) => onOpenProof(event.currentTarget, proofRequest(mission))}
        >
          <Link2 size={16} aria-hidden="true" />查看 Context / Proof
        </button>
        <span title={`对象 ${safeValue(selection?.object?.id)}`}>{mission.id}</span>
      </footer>
    </article>
  );
}
