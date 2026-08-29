import { ArrowRight, Bot, CircleAlert, FileSearch } from "lucide-react";
import { AiDialogPrompt } from "./AiDialogPrompt.jsx";
import { MissionInspector } from "./MissionInspector.jsx";
import { MissionRegistry } from "./MissionRegistry.jsx";

const unavailable = "Unavailable";

function selectedMissionFor(model, selection) {
  const missions = Array.isArray(model?.missions) ? model.missions : [];
  const selectedId = selection?.object?.type === "Agent run" ? selection.object.id : null;
  return missions.find((mission) => mission.id === selectedId) || missions[0] || null;
}
function AttentionRail({ missions, selectedMission, selection, onSelect }) {
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

      <section className="kordynV2AiAttentionPanel is-context">
        <header><h2>当前上下文</h2><FileSearch size={17} aria-hidden="true" /></header>
        <dl>
          <div><dt>对象</dt><dd>{selectedMission?.id || unavailable}</dd></div>
          <div><dt>类型</dt><dd>{selectedMission ? "Agent run" : unavailable}</dd></div>
          <div><dt>Context</dt><dd>{selection?.context?.title || unavailable}</dd></div>
          <div><dt>Evidence</dt><dd>{selectedMission?.evidenceCount ?? unavailable}</dd></div>
        </dl>
      </section>

      <section className="kordynV2AiAttentionPanel is-trace">
        <header><h2>Proof 状态</h2></header>
        <p>{selection?.trace?.stages?.length ? `${selection.trace.stages.length} 个权威阶段` : unavailable}</p>
      </section>
    </aside>
  );
}

export function AiMissionWorkspace({
  model,
  actions,
  selection,
  onSelect = () => {},
  onOpenDialog = () => {},
  onOpenProof = () => {}
}) {
  void actions;
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
        <MissionInspector mission={selectedMission} selection={selection} onOpenProof={onOpenProof} />
        <AttentionRail missions={missions} selectedMission={selectedMission} selection={selection} onSelect={onSelect} />
      </div>
      <AiDialogPrompt onOpen={onOpenDialog} />
    </div>
  );
}
