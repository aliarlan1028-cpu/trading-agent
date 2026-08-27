import { Database, Route, ShieldAlert } from "lucide-react";

const unavailable = "Unavailable";
const safeText = (value) => (
  ["string", "number", "boolean"].includes(typeof value) && value !== "" ? String(value) : unavailable
);

const STATE_LABELS = Object.freeze({
  ready: "来源已加载",
  loading: "正在加载",
  failed: "加载失败",
  forbidden: "无权访问",
  stale: "事实已陈旧",
  degraded: "来源已降级"
});

export function DestinationBoundary({ domain, workspace, location, state }) {
  const stateKind = typeof state?.kind === "string" ? state.kind : "not_loaded";
  const stateLabel = STATE_LABELS[stateKind] || unavailable;
  return (
    <section
      className="kordynV2DestinationBoundary"
      data-kordyn-v2-destination={`${domain.id}/${workspace.id}`}
      data-kordyn-v2-destination-boundary
      aria-labelledby="kordyn-v2-destination-title"
    >
      <header>
        <span>
          <h1 id="kordyn-v2-destination-title" data-kordyn-v2-destination-title>{workspace.label}</h1>
          <small>{domain.label}</small>
        </span>
        <em data-state={stateKind}>{stateLabel}</em>
      </header>
      <div className="kordynV2DestinationNotice" role="status">
        <ShieldAlert size={22} strokeWidth={1.7} aria-hidden="true" />
        <span>
          <strong>当前仅提供权威读取边界</strong>
          <p>此目的地的完整 V2 工作界面属于后续计划；这里不推断数据，也不开放动作。</p>
        </span>
      </div>
      <dl aria-label="目的地权威边界">
        <div><dt><Route size={15} aria-hidden="true" /> 注册路由</dt><dd>{safeText(workspace.legacyRoute)}</dd></div>
        <div><dt><Database size={15} aria-hidden="true" /> 加载分区</dt><dd>{safeText(location.resourceSection)}</dd></div>
        <div><dt>加载状态</dt><dd>{stateLabel}</dd></div>
        <div><dt>事实来源</dt><dd>{safeText(state?.source)}</dd></div>
        <div><dt>最后有效时间</dt><dd>{safeText(state?.lastValidAt)}</dd></div>
      </dl>
    </section>
  );
}
