import { useEffect, useState } from "react";
import { ConfirmHost } from "./confirm.jsx";
import { t } from "./i18n.js";
import { isNativeApp } from "./lib.jsx";
import { hasNewWebRelease, normalizeRelease } from "./releaseUpdate.js";

const CLIENT_RELEASE = normalizeRelease(import.meta.env?.VITE_APP_RELEASE);

export function ReleaseUpdateNoticeContent({ onRefresh = () => window.location.reload() }) {
  return (
    <aside className="releaseUpdateNotice" role="status" aria-live="polite">
      <div>
        <strong>{t("发现新版本", "Update available")}</strong>
        <span>{t("刷新后使用最新功能，不会退出登录。", "Refresh to use the latest version. You will stay signed in.")}</span>
      </div>
      <button type="button" onClick={onRefresh}>{t("立即刷新", "Refresh")}</button>
    </aside>
  );
}

export function ReleaseUpdateNotice() {
  const [serverRelease, setServerRelease] = useState(null);
  useEffect(() => {
    if (isNativeApp() || !CLIENT_RELEASE) return undefined;
    let disposed = false;
    const check = async () => {
      try {
        const response = await fetch(`/api/health?release_check=${Date.now()}`, {
          cache: "no-store",
          credentials: "same-origin"
        });
        if (!response.ok) return;
        const health = await response.json();
        if (!disposed && hasNewWebRelease(CLIENT_RELEASE, health.release)) setServerRelease(health.release);
      } catch { /* A weak or unavailable connection must not interrupt normal recovery. */ }
    };
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    const interval = window.setInterval(check, 60_000);
    const initial = window.setTimeout(check, 15_000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.clearTimeout(initial);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, []);
  return serverRelease ? <ReleaseUpdateNoticeContent /> : null;
}

export function AppFrame({ authenticated = false, children }) {
  return (
    <div className={authenticated ? "authenticatedAppFrame kordynSystem" : "publicAppFrame"}>
      {children}
      <ReleaseUpdateNotice />
      <ConfirmHost />
    </div>
  );
}
