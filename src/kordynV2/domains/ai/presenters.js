import { AiEventsWorkspace } from "./AiEventsWorkspace.jsx";
import { AiDialogWorkspace } from "./AiDialogWorkspace.jsx";
import { AiMissionWorkspace } from "./AiMissionWorkspace.jsx";
import { AiSignalsWorkspace } from "./AiSignalsWorkspace.jsx";
import { AiWatchWorkspace } from "./AiWatchWorkspace.jsx";
import { MobileAiEventsScreen } from "./MobileAiEventsScreen.jsx";
import { MobileAiDialogScreen } from "./MobileAiDialogScreen.jsx";
import { MobileAiMissionScreen } from "./MobileAiMissionScreen.jsx";
import { MobileAiSignalsScreen } from "./MobileAiSignalsScreen.jsx";
import { MobileAiWatchScreen } from "./MobileAiWatchScreen.jsx";

const DESKTOP = Object.freeze({
  missions: AiMissionWorkspace,
  intelligence: AiSignalsWorkspace,
  watch: AiWatchWorkspace,
  events: AiEventsWorkspace,
  dialog: AiDialogWorkspace
});

const MOBILE = Object.freeze({
  missions: MobileAiMissionScreen,
  intelligence: MobileAiSignalsScreen,
  watch: MobileAiWatchScreen,
  events: MobileAiEventsScreen,
  dialog: MobileAiDialogScreen
});

export function aiPresenterForWorkspace(workspaceId, device) {
  const presenters = device === "mobile" ? MOBILE : DESKTOP;
  return presenters[workspaceId] || null;
}
