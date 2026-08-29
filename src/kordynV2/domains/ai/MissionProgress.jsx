import { Check, Circle, ShieldCheck } from "lucide-react";
import { missionStagePresentation } from "./aiModel.js";

const FLOW = Object.freeze(["sense", "recall", "plan", "guard", "monitor"]);

export function MissionProgress({ mission, compact = false }) {
  const currentId = mission?.stage?.id ?? null;
  return (
    <ol className={`kordynV2AiMissionProgress${compact ? " is-compact" : ""}`} aria-label="Mission 进度">
      {FLOW.map((stageId) => {
        const stage = missionStagePresentation(stageId);
        const current = stageId === currentId;
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
