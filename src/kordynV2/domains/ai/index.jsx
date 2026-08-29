import { useMemo } from "react";
import { AiMissionWorkspace } from "./AiMissionWorkspace.jsx";
import { buildAiDomainModel } from "./aiModel.js";
import { MobileAiMissionScreen } from "./MobileAiMissionScreen.jsx";
import "./ai.css";

export default function AiDomain({ device, data, actions, selection, truth, onSelect, onOpenDialog, onOpenProof }) {
  const model = useMemo(() => buildAiDomainModel(data), [data]);
  const Presenter = device === "mobile" ? MobileAiMissionScreen : AiMissionWorkspace;
  return (
    <Presenter
      model={model}
      actions={actions}
      selection={selection}
      truth={truth}
      onSelect={onSelect}
      onOpenDialog={onOpenDialog}
      onOpenProof={onOpenProof}
    />
  );
}

export { AiMissionWorkspace } from "./AiMissionWorkspace.jsx";
export { MissionInspector } from "./MissionInspector.jsx";
export { MissionProgress } from "./MissionProgress.jsx";
export { MissionRegistry } from "./MissionRegistry.jsx";
export { MobileAiMissionScreen } from "./MobileAiMissionScreen.jsx";
