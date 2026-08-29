import { useMemo, useState } from "react";
import { AiApprovalSheet } from "./AiApprovalSheet.jsx";
import { AiOutputSheet } from "./AiOutputSheet.jsx";
import { buildAiDomainModel } from "./aiModel.js";
import { aiPresenterForWorkspace } from "./presenters.js";
import "./ai.css";

export default function AiDomain({ device, workspaceId, data, actions, actionsDisabled, selection, truth, onSelect, onOpenDialog, onCloseDialog, onOpenProof }) {
  const model = useMemo(() => buildAiDomainModel(data), [data]);
  const [approval, setApproval] = useState(null);
  const [output, setOutput] = useState(null);
  const Presenter = aiPresenterForWorkspace(workspaceId, device);
  if (!Presenter) return null;
  return (
    <>
      <Presenter
        model={model}
        actions={actions}
        actionsDisabled={actionsDisabled}
        selection={selection}
        truth={truth}
        onSelect={onSelect}
        onOpenDialog={onOpenDialog}
        onClose={onCloseDialog}
        onOpenProof={onOpenProof}
        onOpenApproval={(mission, trigger) => setApproval({ plan: mission.approval, trigger })}
        onOpenOutput={(message, trigger) => setOutput({ message, trigger })}
      />
      {approval && <AiApprovalSheet plan={approval.plan} actions={actions} returnFocus={approval.trigger} onClose={() => setApproval(null)} />}
      {output && <AiOutputSheet message={output.message} actions={actions} returnFocus={output.trigger} onClose={() => setOutput(null)} />}
    </>
  );
}

export { AiMissionWorkspace } from "./AiMissionWorkspace.jsx";
export { AiDialogWorkspace } from "./AiDialogWorkspace.jsx";
export { AiApprovalSheet } from "./AiApprovalSheet.jsx";
export { AiOutputSheet } from "./AiOutputSheet.jsx";
export { MissionInspector } from "./MissionInspector.jsx";
export { MissionProgress } from "./MissionProgress.jsx";
export { MissionRegistry } from "./MissionRegistry.jsx";
export { MobileAiMissionScreen } from "./MobileAiMissionScreen.jsx";
export { MobileAiDialogScreen } from "./MobileAiDialogScreen.jsx";
export { PosterCanvas } from "./PosterCanvas.jsx";
export { aiPresenterForWorkspace } from "./presenters.js";
