export const DEFAULT_KORDYN_UI_VERSION = "legacy";

export function resolveKordynUiVersion(env = {}, storage = globalThis.sessionStorage) {
  const raw = env.VITE_KORDYN_UI_VERSION;
  const configured = raw === "v2" || raw === "legacy" ? raw : raw ? "legacy" : DEFAULT_KORDYN_UI_VERSION;
  const previewAllowed = env.DEV === true || env.VITE_ALLOW_KORDYN_V2_PREVIEW === "true";
  if (!previewAllowed) return configured;
  const preview = storage?.getItem?.("kordyn_ui_version");
  return preview === "v2" || preview === "legacy" ? preview : configured;
}
