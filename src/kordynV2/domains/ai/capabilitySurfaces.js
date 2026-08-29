import { AiDialogWorkspace } from "./AiDialogWorkspace.jsx";
import { AiEventsWorkspace } from "./AiEventsWorkspace.jsx";
import { AiMissionWorkspace } from "./AiMissionWorkspace.jsx";
import { AiOutputSheet } from "./AiOutputSheet.jsx";
import { AiSignalsWorkspace } from "./AiSignalsWorkspace.jsx";
import { AiWatchWorkspace } from "./AiWatchWorkspace.jsx";
import { MobileAiDialogScreen } from "./MobileAiDialogScreen.jsx";
import { MobileAiEventsScreen } from "./MobileAiEventsScreen.jsx";
import { MobileAiMissionScreen } from "./MobileAiMissionScreen.jsx";
import { MobileAiSignalsScreen } from "./MobileAiSignalsScreen.jsx";
import { MobileAiWatchScreen } from "./MobileAiWatchScreen.jsx";

const surface = ({
  id,
  workspaceId,
  route,
  actionBoundary,
  resourceStateBoundary,
  desktopComponent,
  desktopEntry,
  mobileComponent,
  mobileEntry
}) => Object.freeze({
  id,
  domainId: "ai",
  workspaceId,
  route,
  actionBoundary,
  permissionBoundary: "authenticated identity + existing server-authoritative RBAC",
  resourceStateBoundary,
  desktop: Object.freeze({ component: desktopComponent, entry: desktopEntry }),
  mobile: Object.freeze({ component: mobileComponent, entry: mobileEntry })
});

export const AI_CAPABILITY_SURFACES = Object.freeze({
  "ai.dialog": surface({
    id: "ai.dialog",
    workspaceId: "dialog",
    route: "chat",
    actionBoundary: "readDialog / sendDialog via /api/agent/chat",
    resourceStateBoundary: "chat; mutations disabled unless resource state is ready",
    desktopComponent: AiDialogWorkspace,
    desktopEntry: "AI local navigation → 对话 → bounded dialog workspace",
    mobileComponent: MobileAiDialogScreen,
    mobileEntry: "AI local navigation → 对话 → full-screen conversation"
  }),
  "ai.autonomous-patrol": surface({
    id: "ai.autonomous-patrol",
    workspaceId: "missions",
    route: "chat",
    actionBoundary: "read-only mission projection; approval remains a separate protected action",
    resourceStateBoundary: "chat; last-valid facts retained only for stale/degraded",
    desktopComponent: AiMissionWorkspace,
    desktopEntry: "AI local navigation → 任务 → Mission registry/inspector",
    mobileComponent: MobileAiMissionScreen,
    mobileEntry: "AI local navigation → 任务 → task-led Mission flow"
  }),
  "ai.intelligence": surface({
    id: "ai.intelligence",
    workspaceId: "intelligence",
    route: "intelligence",
    actionBoundary: "rememberIntelligence via /api/agent/memory",
    resourceStateBoundary: "operationsCenter; selected Context must permit mutation",
    desktopComponent: AiSignalsWorkspace,
    desktopEntry: "AI local navigation → 情报 → Signal registry/inspector",
    mobileComponent: MobileAiSignalsScreen,
    mobileEntry: "AI local navigation → 情报 → list/detail flow"
  }),
  "ai.watch": surface({
    id: "ai.watch",
    workspaceId: "watch",
    route: "watch",
    actionBoundary: "cancelWatch via /api/watch-triggers/:id/cancel; a hit only re-analyzes",
    resourceStateBoundary: "chat; active/current Watch and selected Context must permit mutation",
    desktopComponent: AiWatchWorkspace,
    desktopEntry: "AI local navigation → 观察哨 → Watch registry/inspector",
    mobileComponent: MobileAiWatchScreen,
    mobileEntry: "AI local navigation → 观察哨 → list/detail flow"
  }),
  "ai.events": surface({
    id: "ai.events",
    workspaceId: "events",
    route: "eventsTasks:events",
    actionBoundary: "refreshEvents via /api/event-sources/refresh",
    resourceStateBoundary: "operationsCenter; selected Context must permit refresh",
    desktopComponent: AiEventsWorkspace,
    desktopEntry: "AI local navigation → 事件日历 → Event registry/inspector",
    mobileComponent: MobileAiEventsScreen,
    mobileEntry: "AI local navigation → 事件日历 → list/detail flow"
  }),
  "ai.poster-current": surface({
    id: "ai.poster-current",
    workspaceId: "missions",
    route: "chat",
    actionBoundary: "open current supported poster draft from a real Mission/message",
    resourceStateBoundary: "chat; output opens only while authoritative facts are ready",
    desktopComponent: AiOutputSheet,
    desktopEntry: "Mission inspector → 生成海报 → bounded output sheet",
    mobileComponent: AiOutputSheet,
    mobileEntry: "Mission task → 生成海报 → touch output sheet"
  }),
  "ai.poster-translate": surface({
    id: "ai.poster-translate",
    workspaceId: "missions",
    route: "chat",
    actionBoundary: "translatePoster via /api/posters/translate; Chinese/English only",
    resourceStateBoundary: "chat; translation disabled unless authoritative facts are ready",
    desktopComponent: AiOutputSheet,
    desktopEntry: "Output sheet → English",
    mobileComponent: AiOutputSheet,
    mobileEntry: "Output sheet → English"
  }),
  "ai.poster-png": surface({
    id: "ai.poster-png",
    workspaceId: "missions",
    route: "chat",
    actionBoundary: "renderPosterPng then injected download after validated PNG generation",
    resourceStateBoundary: "chat; export disabled unless authoritative facts are ready",
    desktopComponent: AiOutputSheet,
    desktopEntry: "Output sheet → PNG",
    mobileComponent: AiOutputSheet,
    mobileEntry: "Output sheet → PNG"
  })
});
