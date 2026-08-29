import { Check, Circle, ShieldCheck } from "lucide-react";
import { missionStagePresentation } from "./aiModel.js";

const FLOW = Object.freeze(["intent", "sense", "recall", "plan", "guard", "approval", "execute", "monitor", "review"]);
const WINDOW_SIZE = 5;

function visibleStages(currentId) {
  const currentIndex = FLOW.indexOf(currentId);
  const start = currentIndex < 0
    ? 0
    : Math.max(0, Math.min(currentIndex - Math.floor(WINDOW_SIZE / 2), FLOW.length - WINDOW_SIZE));
  return FLOW.slice(start, start + WINDOW_SIZE);
}

export function MissionProgress({ mission, compact = false }) {
  const currentId = mission?.stage?.id ?? null;
  const recognizedCurrent = FLOW.includes(currentId) ? currentId : null;
  return (
    <ol className={`kordynV2AiMissionProgress${compact ? " is-compact" : ""}`} aria-label="Mission 进度">
      {visibleStages(recognizedCurrent).map((stageId) => {
        const stage = missionStagePresentation(stageId);
        const current = stageId === recognizedCurrent;
        return (
          <li
            key={stageId}
            data-stage-id={stageId}
            data-stage-state={current ? mission?.stage?.tone || "unavailable" : "unavailable"}
            aria-current={current ? "step" : undefined}
          >
            <span aria-hidden="true">
              {current && stageId === "guard" ? <ShieldCheck size={compact ? 16 : 19} /> : current ? <Check size={compact ? 16 : 19} /> : <Circle size={compact ? 15 : 18} />}
            </span>
            <strong>{stage.label}</strong>
            <small>{current ? mission?.stage?.label : "Unavailable"}</small>
          </li>
        );
      })}
    </ol>
  );
}
