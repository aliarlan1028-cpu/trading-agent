import { AiEventsWorkspace } from "./AiEventsWorkspace.jsx";
import { AiMissionWorkspace } from "./AiMissionWorkspace.jsx";
import { AiSignalsWorkspace } from "./AiSignalsWorkspace.jsx";
import { AiWatchWorkspace } from "./AiWatchWorkspace.jsx";
import { MobileAiEventsScreen } from "./MobileAiEventsScreen.jsx";
import { MobileAiMissionScreen } from "./MobileAiMissionScreen.jsx";
import { MobileAiSignalsScreen } from "./MobileAiSignalsScreen.jsx";
import { MobileAiWatchScreen } from "./MobileAiWatchScreen.jsx";

const DESKTOP = Object.freeze({
  missions: AiMissionWorkspace,
  intelligence: AiSignalsWorkspace,
  watch: AiWatchWorkspace,
  events: AiEventsWorkspace
});

const MOBILE = Object.freeze({
  missions: MobileAiMissionScreen,
  intelligence: MobileAiSignalsScreen,
  watch: MobileAiWatchScreen,
  events: MobileAiEventsScreen
});

export function aiPresenterForWorkspace(workspaceId, device) {
  const presenters = device === "mobile" ? MOBILE : DESKTOP;
  return presenters[workspaceId] || null;
}
