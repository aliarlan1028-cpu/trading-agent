import { useMemo } from "react";
import { buildAiDomainModel } from "./aiModel.js";
import { aiPresenterForWorkspace } from "./presenters.js";
import "./ai.css";

export default function AiDomain({ device, workspaceId, data, actions, actionsDisabled, selection, truth, onSelect, onOpenDialog, onOpenProof }) {
  const model = useMemo(() => buildAiDomainModel(data), [data]);
  const Presenter = aiPresenterForWorkspace(workspaceId, device);
  if (!Presenter) return null;
  return (
    <Presenter
      model={model}
      actions={actions}
      actionsDisabled={actionsDisabled}
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
export { aiPresenterForWorkspace } from "./presenters.js";
