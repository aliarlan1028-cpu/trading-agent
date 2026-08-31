import { AlertTriangle, CheckCircle2, RefreshCw, RadioTower } from "lucide-react";
import { EventRiskRegistry } from "./EventRiskRegistry.jsx";

export function EventInputWorkspace({ model = {}, actions, actionsDisabled = false, selection, onSelect = () => {}, onNavigate = () => {} }) {
  const eventInputs = model.eventInputs || {};
  const sources = eventInputs.sources || [];
  const windows = eventInputs.windows || [];
  return (
    <section className="kordynV2GovernanceWorkspace kordynV2EventInputWorkspace" data-kordyn-v2-governance-workspace="event-inputs">
      <header className="kordynV2GovernanceTitle"><span><h1>事件输入</h1><p>来源健康与事件窗口是两类事实；输入失败不会伪装成没有事件。</p></span><button type="button" disabled={actionsDisabled || model.permissions?.writeEvent !== true} onClick={() => actions?.refreshEventSources?.()}><RefreshCw size={14} />刷新来源</button></header>
      <div className="kordynV2EventInputSummary">
        <span data-tone={Number(eventInputs.unhealthy) > 0 ? "warning" : "healthy"}><RadioTower size={18} /><small>来源健康</small><strong>{sources.length - Number(eventInputs.unhealthy || 0)}/{sources.length}</strong></span>
        <span data-tone={Number(eventInputs.blocking) > 0 ? "critical" : "healthy"}><AlertTriangle size={18} /><small>阻断窗口</small><strong>{eventInputs.blocking ?? "—"}</strong></span>
        <span data-tone="healthy"><CheckCircle2 size={18} /><small>事实边界</small><strong>Fail-closed</strong></span>
      </div>
      <div className="kordynV2EventInputGrid">
        <section className="kordynV2SourceHealth" aria-labelledby="kordyn-v2-source-health-title">
          <header><span><strong id="kordyn-v2-source-health-title">来源健康</strong><small>连接、解析、最后成功与恢复动作</small></span><em>{sources.length}</em></header>
          <div>{sources.map((source, index) => {
            const id = source.id || source.sourceId || `source-${index}`;
            return <article key={id} data-source-tone={source.tone || "neutral"}>
              <button type="button" data-kordyn-v2-object-type="Event source" data-kordyn-v2-object-id={id} onClick={() => onSelect({ id, type: "Event source", workspaceId: "governance" })}>
                <i /><span><strong>{source.name || source.label || id}</strong><small>最后成功 {source.lastSuccessAt || "Unavailable"}</small></span><em>{source.status || "unknown"}</em>
              </button>
              <button type="button" disabled={actionsDisabled || model.permissions?.writeEvent !== true} onClick={() => actions?.testEventSource?.(id)}>测试连接</button>
            </article>;
          })}{!sources.length && <p>当前没有加载事件来源。</p>}</div>
          <footer><button type="button" data-kordyn-v2-navigate="governance:configuration" onClick={() => onNavigate("governance", "configuration")}>管理事件源配置</button></footer>
        </section>
        <EventRiskRegistry rows={windows} selectedId={selection?.object?.type === "Event" ? selection.object.id : ""} onSelect={onSelect} />
      </div>
    </section>
  );
}
