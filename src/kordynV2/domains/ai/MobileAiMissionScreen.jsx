import { ArrowRight, Bot, CircleAlert, FileCheck2, FileImage, ShieldCheck } from "lucide-react";
import { AiDialogPrompt } from "./AiDialogPrompt.jsx";
import { MissionProgress } from "./MissionProgress.jsx";

const unavailable = "Unavailable";
const safeValue = (value) => value === null || value === undefined || value === "" ? unavailable : String(value);
const selectPayload = (mission) => ({
  id: mission.id,
  type: "Agent run",
  workspaceId: "ai",
  route: "chat",
  evidence: mission.evidenceCount
});

function selectedMissionFor(model, selection) {
  const missions = Array.isArray(model?.missions) ? model.missions : [];
  const selectedId = selection?.object?.type === "Agent run" ? selection.object.id : null;
  return missions.find((mission) => mission.id === selectedId) || missions[0] || null;
}
function MobileActiveMission({ mission, selection, onSelect, onOpenProof, onOpenApproval, onOpenOutput }) {
  if (!mission) {
    return (
      <section className="kordynV2AiMobileActive is-empty" data-kordyn-v2-selected-mission="Unavailable" role="status">
        <Bot size={26} aria-hidden="true" />
        <strong>当前没有可用任务</strong>
        <span>Agent run · {unavailable}</span>
      </section>
    );
  }

  return (
    <section
      className="kordynV2AiMobileActive"
      data-kordyn-v2-selected-mission={mission.id}
      data-kordyn-v2-object-id={mission.id}
      data-kordyn-v2-object-type="Agent run"
    >
      <header>
        <span className="kordynV2AiMobileMissionGlyph" aria-hidden="true"><Bot size={21} /></span>
        <span><strong>{safeValue(mission.title)}</strong><small>{safeValue(mission.summary)}</small></span>
        <em data-stage-tone={mission.stage?.tone || "unavailable"}>{safeValue(mission.stage?.label)}</em>
      </header>
      <MissionProgress mission={mission} compact />
      <dl className="kordynV2AiMobileFacts">
        <div><dt><ShieldCheck size={15} aria-hidden="true" />状态</dt><dd>{safeValue(mission.stage?.label)}</dd></div>
        <div><dt><FileCheck2 size={15} aria-hidden="true" />证据</dt><dd>{safeValue(mission.evidenceCount)}</dd></div>
        <div><dt>下一步</dt><dd>{safeValue(mission.nextAction)}</dd></div>
      </dl>
      <footer>
        <button className="kordynV2AiMobileAction" type="button" onClick={() => onSelect(selectPayload(mission))}>查看任务<ArrowRight size={16} aria-hidden="true" /></button>
        {mission.stage?.id === "approval" && <button className="kordynV2AiMobileAction" type="button" data-kordyn-v2-open-approval={mission.id} aria-haspopup="dialog" onClick={(event) => onOpenApproval(mission, event.currentTarget)}><ShieldCheck size={16} aria-hidden="true" />打开确认</button>}
        {mission.output && <button className="kordynV2AiMobileAction" type="button" data-kordyn-v2-open-output={mission.id} aria-haspopup="dialog" onClick={(event) => onOpenOutput(mission.output, event.currentTarget)}><FileImage size={16} aria-hidden="true" />PNG 输出</button>}
        <button
          className="kordynV2AiMobileAction"
          type="button"
          aria-haspopup="dialog"
          data-kordyn-v2-mission-proof={mission.id}
          onClick={(event) => onOpenProof(event.currentTarget, { panel: "proof", candidate: selectPayload(mission) })}
        >查看证据<ArrowRight size={16} aria-hidden="true" /></button>
        <span>{selection?.object?.id === mission.id ? "当前对象" : unavailable}</span>
      </footer>
    </section>
  );
}

function MobileApproval({ missions, onSelect, onOpenApproval }) {
  const waiting = missions.filter((mission) => mission.stage?.id === "approval");
  return (
    <section className="kordynV2AiMobileAttention" aria-labelledby="kordyn-v2-ai-mobile-attention-title">
      <header><h2 id="kordyn-v2-ai-mobile-attention-title">需要你</h2><span>{waiting.length ? "高优先级" : "0"}</span></header>
      {waiting.map((mission) => <article key={mission.id}><button className="kordynV2AiMobileAction" type="button" data-kordyn-v2-object-id={mission.id} data-kordyn-v2-object-type="Agent run" onClick={() => onSelect(selectPayload(mission))}><CircleAlert size={19} aria-hidden="true" /><span><strong>{mission.title}</strong><small>{mission.stage.label} · {mission.approval?.planId || unavailable}</small></span><ArrowRight size={18} aria-hidden="true" /></button><button type="button" data-kordyn-v2-open-approval={mission.id} aria-haspopup="dialog" onClick={(event) => onOpenApproval(mission, event.currentTarget)}>打开确认</button></article>)}
      {!waiting.length && <p>当前没有等待确认的 Mission。</p>}
    </section>
  );
}

function MobileContext({ mission, selection, truth }) {
  return (
    <section className="kordynV2AiMobileContext" aria-labelledby="kordyn-v2-ai-mobile-context-title">
      <header><h2 id="kordyn-v2-ai-mobile-context-title">账户影响与上下文</h2><span>只读事实</span></header>
      <dl>
        <div><dt>风险</dt><dd>{safeValue(truth?.risk)}</dd></div>
        <div><dt>敞口</dt><dd>{safeValue(truth?.exposure)}</dd></div>
        <div><dt>Context</dt><dd>{safeValue(selection?.context?.title)}</dd></div>
      </dl>
      <p>{mission ? `${mission.id} · Agent run` : `Agent run · ${unavailable}`}</p>
    </section>
  );
}

function MobileRecent({ missions, selectedId, onSelect }) {
  const recent = missions.filter((mission) => mission.id !== selectedId);
  return (
    <section className="kordynV2AiMobileRecent" aria-labelledby="kordyn-v2-ai-mobile-recent-title">
      <h2 id="kordyn-v2-ai-mobile-recent-title">其他任务</h2>
      {recent.map((mission) => (
        <button
          className="kordynV2AiMobileAction"
          type="button"
          data-kordyn-v2-object-id={mission.id}
          data-kordyn-v2-object-type="Agent run"
          key={mission.id}
          onClick={() => onSelect(selectPayload(mission))}
        >
          <span><strong>{mission.title}</strong><small>{mission.stage.label}</small></span>
          <em>{safeValue(mission.evidenceCount)} 证据</em>
          <ArrowRight size={17} aria-hidden="true" />
        </button>
      ))}
      {!recent.length && <p>{missions.length ? "没有其他已加载 Mission。" : unavailable}</p>}
    </section>
  );
}

export function MobileAiMissionScreen({
  model,
  selection,
  truth,
  onSelect = () => {},
  onOpenDialog = () => {},
  onOpenProof = () => {},
  onOpenApproval = () => {},
  onOpenOutput = () => {}
}) {
  const missions = Array.isArray(model?.missions) ? model.missions : [];
  const selectedMission = selectedMissionFor(model, selection);
  return (
    <div className="kordynV2AiMobile" data-kordyn-v2-layout="mission-task-flow" data-kordyn-v2-destination="ai/missions">
      <MobileActiveMission mission={selectedMission} selection={selection} onSelect={onSelect} onOpenProof={onOpenProof} onOpenApproval={onOpenApproval} onOpenOutput={onOpenOutput} />
      <MobileApproval missions={missions} onSelect={onSelect} onOpenApproval={onOpenApproval} />
      <MobileContext mission={selectedMission} selection={selection} truth={truth} />
      <MobileRecent missions={missions} selectedId={selectedMission?.id} onSelect={onSelect} />
      <AiDialogPrompt mobile onOpen={onOpenDialog} />
    </div>
  );
}
