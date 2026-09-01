export const DEFAULT_KORDYN_UI_VERSION = "legacy";

// The presentation switch is deliberately not an API-version switch. These
// templates are the deployed mutation/download boundaries shared by the legacy
// and V2 presenters. Keep methods explicit so rollback review can detect a
// semantic change such as POST becoming PATCH even when the path stays the same.
const SHARED_ACTION_ENDPOINTS = Object.freeze([
  "DELETE /api/config/secret/:key",
  "DELETE /api/event-sources/:id",
  "DELETE /api/watchlist/:symbol",
  "GET /api/agent/chat",
  "GET /api/posters/trades/:id",
  "PATCH /api/account/profile",
  "PATCH /api/admin/users/:id",
  "PATCH /api/agent/profiles/:id",
  "PATCH /api/event-sources/:id",
  "PATCH /api/exchange/accounts/:id",
  "PATCH /api/mandates/:id",
  "PATCH /api/risk/rules/:id",
  "POST /api/admin/users",
  "POST /api/admin/users/:id/grant-free",
  "POST /api/agent/chat",
  "POST /api/agent/memory",
  "POST /api/config",
  "POST /api/config/live-trading",
  "POST /api/event-sources",
  "POST /api/event-sources/:id/test",
  "POST /api/event-sources/refresh",
  "POST /api/exchange/api-key-metadata/:id/confirm-no-withdraw",
  "POST /api/execution-orders/:id/close",
  "POST /api/execution-orders/poll",
  "POST /api/knowledge/candidates/:id/adopt",
  "POST /api/knowledge/candidates/:id/approve-prompt",
  "POST /api/knowledge/candidates/:id/ignore",
  "POST /api/knowledge/convert",
  "POST /api/knowledge/methods/:id/compile",
  "POST /api/knowledge/skills/:id/approve",
  "POST /api/knowledge/skills/:id/paper",
  "POST /api/knowledge/skills/:id/validate",
  "POST /api/knowledge/skills/sync",
  "POST /api/knowledge/sources/:id/parse-real",
  "POST /api/mandates",
  "POST /api/mandates/:id/activate",
  "POST /api/notifications/:channel-test",
  "POST /api/notifications/read",
  "POST /api/posters/translate",
  "POST /api/reconciler/run",
  "POST /api/review/improvements/:id/action",
  "POST /api/review/improvements/:id/paper/start",
  "POST /api/review/lessons/:id/action",
  "POST /api/risk/emergency-flatten",
  "POST /api/risk/incidents/:id/close",
  "POST /api/risk/kill-switch",
  "POST /api/risk/rules",
  "POST /api/scheduler/recover",
  "POST /api/skills/:id/disable",
  "POST /api/skills/:id/enable",
  "POST /api/strategy/market/:id/disable",
  "POST /api/strategy/market/:id/enable",
  "POST /api/strategy/research",
  "POST /api/strategy/studio/drafts",
  "POST /api/strategy/studio/drafts/:id/backtest",
  "POST /api/strategy/studio/drafts/:id/publish",
  "POST /api/strategy/studio/drafts/:id/tests",
  "POST /api/system/backup",
  "POST /api/system/operating-mode",
  "POST /api/tasks/:id/pause",
  "POST /api/tasks/:id/resume",
  "POST /api/tasks/:id/run",
  "POST /api/trade-plans/:id/approve",
  "POST /api/trade-plans/:id/cancel",
  "POST /api/watch-triggers/:id/cancel",
  "POST /api/watchlist"
]);

export const LEGACY_ACTION_ENDPOINTS = Object.freeze([...SHARED_ACTION_ENDPOINTS]);
export const V2_ACTION_ENDPOINTS = Object.freeze([...SHARED_ACTION_ENDPOINTS]);

export function resolveKordynUiVersion(env = {}, storage) {
  const raw = env.VITE_KORDYN_UI_VERSION;
  const configured = raw === "v2" || raw === "legacy" ? raw : raw ? "legacy" : DEFAULT_KORDYN_UI_VERSION;
  const previewAllowed = env.DEV === true || env.VITE_ALLOW_KORDYN_V2_PREVIEW === "true";
  if (!previewAllowed) return configured;
  let previewStorage = storage;
  try {
    if (previewStorage === undefined) previewStorage = globalThis.sessionStorage;
    const preview = previewStorage?.getItem?.("kordyn_ui_version");
    return preview === "v2" || preview === "legacy" ? preview : configured;
  } catch {
    return configured;
  }
}
