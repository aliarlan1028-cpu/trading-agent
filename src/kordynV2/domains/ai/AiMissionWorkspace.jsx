import { ArrowRight, Bot, CircleAlert, FileSearch } from "lucide-react";
import { AiDialogPrompt } from "./AiDialogPrompt.jsx";
import { MissionInspector } from "./MissionInspector.jsx";
import { MissionRegistry } from "./MissionRegistry.jsx";

const unavailable = "Unavailable";

function selectedMissionFor(model, selection) {
  const missions = Array.isArray(model?.missions) ? model.missions : [];
  const selectedId = selection?.object?.type === "Agent run" ? selection.object.id : null;
  const selected = missions.find((mission) => mission.id === selectedId);
  if (selected) return selected;
  const priority = { monitor: 0, execute: 1, intent: 2, sense: 2, recall: 2, plan: 2, guard: 2, approval: 3, review: 4 };
  return missions
    .map((mission, index) => ({ mission, index, rank: priority[mission?.stage?.id] ?? 5 }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)[0]?.mission || null;
}
function firstListValue(values) {
  return Array.isArray(values) && values.length ? values.join(" · ") : unavailable;
}
function missionProofRequest(mission) {
  return { panel: "proof", candidate: { id: mission.id, type: "Agent run", workspaceId: "ai", route: "chat", evidence: mission.evidenceCount } };
}
function AttentionRail({ missions, selectedMission, selection, onSelect, onOpenProof }) {
  const approvalMissions = missions.filter((mission) => mission.stage?.id === "approval");
  return (
    <aside className="kordynV2AiAttentionRail" aria-label="Mission attention and context">
      <section className="kordynV2AiAttentionPanel is-urgent">
        <header><h2>需要你</h2><span>{approvalMissions.length}</span></header>
        {approvalMissions.map((mission) => (
          <button
            type="button"
            data-kordyn-v2-object-id={mission.id}
            data-kordyn-v2-object-type="Agent run"
            key={mission.id}
            onClick={() => onSelect({ id: mission.id, type: "Agent run", workspaceId: "ai", route: "chat", evidence: mission.evidenceCount })}
          >
            <CircleAlert size={18} aria-hidden="true" />
            <span><strong>{mission.title}</strong><small>{mission.stage.label} · {mission.approval?.planId || unavailable}</small></span>
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        ))}
        {!approvalMissions.length && <p>当前没有等待确认的 Mission。</p>}
      </section>

      <section className="kordynV2AiAttentionPanel is-context" data-kordyn-v2-mission-related-context={selectedMission?.id || unavailable}>
        <header><h2>关联上下文</h2><FileSearch size={17} aria-hidden="true" /></header>
        <dl>
          <div><dt>Strategy</dt><dd>{selectedMission?.decisionContext?.strategy || unavailable}</dd></div>
          <div><dt>Knowledge</dt><dd>{firstListValue(selectedMission?.decisionContext?.knowledge)}</dd></div>
          <div><dt>Capability</dt><dd>{firstListValue(selectedMission?.decisionContext?.capabilities)}</dd></div>
          <div><dt>Event</dt><dd>{firstListValue(selectedMission?.decisionContext?.events)}</dd></div>
          <div><dt>Position</dt><dd>{firstListValue(selectedMission?.decisionContext?.positions)}</dd></div>
          <div><dt>Evidence</dt><dd>{selectedMission?.evidenceCount ?? unavailable}</dd></div>
        </dl>
        {selectedMission && <button type="button" className="kordynV2AiAttentionProof" data-kordyn-v2-attention-proof={selectedMission.id} onClick={(event) => onOpenProof(event.currentTarget, missionProofRequest(selectedMission))}><FileSearch size={15} aria-hidden="true" /><span><strong>打开 Context / Proof</strong><small>{selection?.context?.title || selectedMission.id}</small></span><ArrowRight size={15} aria-hidden="true" /></button>}
      </section>

      <section className="kordynV2AiAttentionPanel is-trace" data-kordyn-v2-mission-receipt={selectedMission?.id || unavailable}>
        <header><h2>运行回执</h2></header>
        <dl>
          <div><dt>创建</dt><dd>{selectedMission?.receipt?.createdAt || unavailable}</dd></div>
          <div><dt>更新</dt><dd>{selectedMission?.receipt?.updatedAt || unavailable}</dd></div>
          <div><dt>完成</dt><dd>{selectedMission?.receipt?.completedAt || unavailable}</dd></div>
          <div><dt>状态</dt><dd>{selectedMission?.receipt?.status || unavailable}</dd></div>
          <div><dt>Proof</dt><dd>{selection?.trace?.stages?.length ? `${selection.trace.stages.length} 阶段` : unavailable}</dd></div>
        </dl>
      </section>
    </aside>
  );
}

export function AiMissionWorkspace({
  model,
  actionsDisabled = false,
  selection,
  onSelect = () => {},
  onOpenDialog = () => {},
  onOpenProof = () => {},
  onOpenApproval = () => {},
  onOpenOutput = () => {}
}) {
  const missions = Array.isArray(model?.missions) ? model.missions : [];
  const selectedMission = selectedMissionFor(model, selection);

  return (
    <div className="kordynV2AiMissionWorkspace" data-kordyn-v2-layout="mission-registry-inspector" data-kordyn-v2-destination="ai/missions">
      <header className="kordynV2AiWorkspaceTitle">
        <span><Bot size={20} aria-hidden="true" /><h1 data-kordyn-v2-destination-title>AI 交易员</h1></span>
        <em role="status"><i aria-hidden="true" />{selectedMission?.stage?.label || unavailable}</em>
      </header>
      <div className="kordynV2AiMissionWorkbench">
        <MissionRegistry missions={missions} selectedId={selectedMission?.id} onSelect={onSelect} />
        <MissionInspector
          mission={selectedMission}
          actionsDisabled={actionsDisabled}
          selection={selection}
          onOpenProof={onOpenProof}
          onOpenApproval={onOpenApproval}
          onOpenOutput={onOpenOutput}
        />
        <AttentionRail missions={missions} selectedMission={selectedMission} selection={selection} onSelect={onSelect} onOpenProof={onOpenProof} />
      </div>
      <AiDialogPrompt commandBar onOpen={onOpenDialog} />
    </div>
  );
}
