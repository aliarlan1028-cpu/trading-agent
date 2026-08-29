import { AlertTriangle, LoaderCircle, RefreshCw, ShieldX } from "lucide-react";

const RETAINED_KINDS = new Set(["stale", "degraded"]);
const CONTENT_KINDS = new Set(["ready", "processing", "partial", "long-content", "large-list"]);

const TITLES = Object.freeze({
  not_loaded: "事实尚未载入",
  loading: "正在读取权威事实",
  empty: "当前范围没有事实",
  failed: "事实读取失败",
  forbidden: "当前身份无权访问",
  disabled: "当前状态已禁用",
  approval: "正在等待审批",
  "no-result": "尚无服务器结果"
});

export function StateBoundary({ state = { kind: "not_loaded" }, children, onRetry }) {
  const kind = typeof state.kind === "string" ? state.kind : "not_loaded";
  if (CONTENT_KINDS.has(kind)) {
    return <div className="kordynV2StateBoundary" data-kordyn-v2-state={kind}>{children}</div>;
  }
  if (RETAINED_KINDS.has(kind) && state.retainsLastValid) {
    return (
      <div className="kordynV2StateBoundary" data-kordyn-v2-state={kind}>
        <div className="kordynV2RetainedNotice" role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{state.message}</span>
          <small>{state.source} · {state.lastValidAt}</small>
        </div>
        {children}
      </div>
    );
  }

  const LoadingIcon = ["loading", "not_loaded"].includes(kind) ? LoaderCircle : kind === "forbidden" ? ShieldX : AlertTriangle;
  return (
    <div className="kordynV2StateBoundary" data-kordyn-v2-state={kind}>
      <section className="kordynV2StatePanel" role={kind === "failed" ? "alert" : "status"}>
        <LoadingIcon className={kind === "loading" ? "is-spinning" : undefined} size={25} aria-hidden="true" />
        <div>
          <h2 data-kordyn-v2-state-heading>{TITLES[kind] || "当前事实不可用"}</h2>
          <p>{state.message || "Authoritative facts are unavailable."}</p>
        </div>
        {state.retryable && onRetry && (
          <button type="button" onClick={onRetry}>
            <RefreshCw size={15} aria-hidden="true" />
            重试
          </button>
        )}
      </section>
    </div>
  );
}
