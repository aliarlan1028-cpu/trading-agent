import { useMemo } from "react";
import { BoundaryWorkspace } from "./BoundaryWorkspace.jsx";
import { EventInputWorkspace } from "./EventInputWorkspace.jsx";
import { MobileBoundaryScreen } from "./MobileBoundaryScreen.jsx";
import { MobileEventInputScreen } from "./MobileEventInputScreen.jsx";
import { buildGovernanceDomainModel } from "./governanceModel.js";
import { OperationsWorkspace } from "./OperationsWorkspace.jsx";
import { NotificationWorkspace } from "./NotificationWorkspace.jsx";
import { AuditWorkspace } from "./AuditWorkspace.jsx";
import { RecoveryWorkspace } from "./RecoveryWorkspace.jsx";
import { MobileNotificationScreen } from "./MobileNotificationScreen.jsx";
import { MobileAuditScreen } from "./MobileAuditScreen.jsx";
import { MobileRecoveryScreen } from "./MobileRecoveryScreen.jsx";
import { MobileOperationsScreen } from "./MobileOperationsScreen.jsx";
import "./governance.css";

export default function GovernanceDomain({ device, workspaceId, data, actions, actionsDisabled = false, selection, onSelect, onNavigate }) {
  const model = useMemo(() => buildGovernanceDomainModel(data), [data]);
  const shared = { model, actions, actionsDisabled, selection, onSelect, onNavigate };
  if (workspaceId === "overview") return device === "mobile" ? <MobileBoundaryScreen {...shared} /> : <BoundaryWorkspace {...shared} />;
  if (workspaceId === "event-inputs") return device === "mobile" ? <MobileEventInputScreen {...shared} /> : <EventInputWorkspace {...shared} />;
  if (workspaceId === "runs") return device === "mobile" ? <MobileOperationsScreen {...shared} /> : <OperationsWorkspace {...shared} />;
  if (workspaceId === "notifications") return device === "mobile" ? <MobileNotificationScreen {...shared} /> : <NotificationWorkspace {...shared} />;
  if (workspaceId === "audit") return device === "mobile" ? <MobileAuditScreen {...shared} /> : <AuditWorkspace {...shared} />;
  if (workspaceId === "recovery") return device === "mobile" ? <MobileRecoveryScreen {...shared} /> : <RecoveryWorkspace {...shared} />;
  return null;
}

export { BoundaryWorkspace } from "./BoundaryWorkspace.jsx";
export { EventInputWorkspace } from "./EventInputWorkspace.jsx";
export { MobileBoundaryScreen } from "./MobileBoundaryScreen.jsx";
export { MobileEventInputScreen } from "./MobileEventInputScreen.jsx";
export { OperationsWorkspace } from "./OperationsWorkspace.jsx";
export { TaskRunWorkspace } from "./TaskRunWorkspace.jsx";
export { NotificationWorkspace } from "./NotificationWorkspace.jsx";
export { AuditWorkspace } from "./AuditWorkspace.jsx";
export { RecoveryWorkspace } from "./RecoveryWorkspace.jsx";
export { MobileOperationsScreen } from "./MobileOperationsScreen.jsx";
export { MobileTaskRunScreen } from "./MobileTaskRunScreen.jsx";
export { MobileNotificationScreen } from "./MobileNotificationScreen.jsx";
export { MobileAuditScreen } from "./MobileAuditScreen.jsx";
export { MobileRecoveryScreen } from "./MobileRecoveryScreen.jsx";
