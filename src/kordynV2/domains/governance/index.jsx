import { useMemo } from "react";
import { BoundaryWorkspace } from "./BoundaryWorkspace.jsx";
import { EventInputWorkspace } from "./EventInputWorkspace.jsx";
import { MobileBoundaryScreen } from "./MobileBoundaryScreen.jsx";
import { MobileEventInputScreen } from "./MobileEventInputScreen.jsx";
import { buildGovernanceDomainModel } from "./governanceModel.js";
import "./governance.css";

export default function GovernanceDomain({ device, workspaceId, data, actions, actionsDisabled = false, selection, onSelect, onNavigate }) {
  const model = useMemo(() => buildGovernanceDomainModel(data), [data]);
  const shared = { model, actions, actionsDisabled, selection, onSelect, onNavigate };
  if (workspaceId === "overview") return device === "mobile" ? <MobileBoundaryScreen {...shared} /> : <BoundaryWorkspace {...shared} />;
  if (workspaceId === "event-inputs") return device === "mobile" ? <MobileEventInputScreen {...shared} /> : <EventInputWorkspace {...shared} />;
  return null;
}

export { BoundaryWorkspace } from "./BoundaryWorkspace.jsx";
export { EventInputWorkspace } from "./EventInputWorkspace.jsx";
export { MobileBoundaryScreen } from "./MobileBoundaryScreen.jsx";
export { MobileEventInputScreen } from "./MobileEventInputScreen.jsx";

