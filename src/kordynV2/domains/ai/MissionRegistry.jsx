import { CircleAlert, CircleCheck, ListFilter, Radio } from "lucide-react";

const unavailable = "Unavailable";

const GROUPS = Object.freeze([
  { id: "working", label: "正在处理", stages: ["intent", "sense", "recall", "plan", "guard", "execute"] },
  { id: "approval", label: "需要确认", stages: ["approval"] },
  { id: "monitoring", label: "正在监控", stages: ["monitor"] },
  { id: "reviewing", label: "复盘与完成", stages: ["review"] },
  { id: "unavailable", label: "事实待定", stages: [null] }
]);

function missionGroup(mission) {
  return GROUPS.find((group) => group.stages.includes(mission?.stage?.id)) || GROUPS.at(-1);
}

function canonicalMissionSelection(mission) {
  return {
    id: mission.id,
    type: "Agent run",
    workspaceId: "ai",
    route: "chat",
    evidence: mission.evidenceCount
  };
}

function MissionRow({ mission, selectedId, onSelect }) {
  const selected = mission.id === selectedId;
  const approval = mission.stage?.id === "approval";
  const reviewing = mission.stage?.id === "review";
  return (
    <button
      type="button"
      className="kordynV2AiMissionRow"
      data-kordyn-v2-object-id={mission.id}
      data-kordyn-v2-object-type="Agent run"
      data-kordyn-v2-stage-tone={mission.stage?.tone || "unavailable"}
      aria-pressed={selected}
      onClick={() => onSelect(canonicalMissionSelection(mission))}
    >
      <span className="kordynV2AiMissionRowIcon" aria-hidden="true">
        {approval ? <CircleAlert size={17} /> : reviewing ? <CircleCheck size={17} /> : <Radio size={17} />}
      </span>
      <span className="kordynV2AiMissionRowCopy">
        <strong>{mission.title || unavailable}</strong>
        <small>{mission.stage?.label || unavailable}</small>
      </span>
      <span className="kordynV2AiMissionRowEvidence">
        <small>证据</small>
        <strong>{mission.evidenceCount ?? unavailable}</strong>
      </span>
    </button>
  );
}

export function MissionRegistry({ missions = [], selectedId, onSelect = () => {} }) {
  const rows = Array.isArray(missions) ? missions : [];
  return (
    <section className="kordynV2AiMissionRegistry" data-kordyn-v2-mission-registry aria-labelledby="kordyn-v2-ai-mission-registry-title">
      <header>
        <h2 id="kordyn-v2-ai-mission-registry-title">任务队列</h2>
        <ListFilter size={17} aria-label="按任务状态分组" />
      </header>
      <div className="kordynV2AiMissionRegistryScroll">
        {GROUPS.map((group) => {
          const groupRows = rows.filter((mission) => missionGroup(mission).id === group.id);
          if (!groupRows.length) return null;
          return (
            <section className="kordynV2AiMissionGroup" data-mission-group={group.id} key={group.id}>
              <h3><span aria-hidden="true" />{group.label}<small>{groupRows.length}</small></h3>
              {groupRows.map((mission) => (
                <MissionRow mission={mission} selectedId={selectedId} onSelect={onSelect} key={mission.id} />
              ))}
            </section>
          );
        })}
        {!rows.length && (
          <div className="kordynV2AiMissionEmpty" role="status">
            <Radio size={20} aria-hidden="true" />
            <strong>当前没有可用任务</strong>
            <span>Mission facts · {unavailable}</span>
          </div>
        )}
      </div>
    </section>
  );
}
