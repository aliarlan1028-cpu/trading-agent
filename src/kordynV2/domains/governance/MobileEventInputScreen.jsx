import { ArrowRight, RefreshCw, RadioTower } from "lucide-react";

export function MobileEventInputScreen({ model = {}, actions, actionsDisabled = false, onNavigate = () => {}, onSelect = () => {} }) {
  const eventInputs = model.eventInputs || {};
  const sources = eventInputs.sources || [];
  const windows = eventInputs.windows || [];
  return (
    <section className="kordynV2GovernanceMobile" data-kordyn-v2-governance-mobile="event-inputs">
      <header><h2>事件输入</h2><p>先确认来源，再理解形成后的事件窗口</p></header>
      <button className="kordynV2MobilePrimary" type="button" data-kordyn-v2-mobile-action="refresh-event-sources" disabled={actionsDisabled} onClick={() => actions?.refreshEventSources?.()}><RefreshCw size={18} />刷新全部来源</button>
      <section className="kordynV2MobileGovernanceList"><header><span><strong>来源健康</strong><small>{eventInputs.unhealthy || 0} 项需处理</small></span><RadioTower size={19} /></header>{sources.map((source, index) => {
        const id = source.id || source.sourceId || `source-${index}`;
        return <button type="button" key={id} data-kordyn-v2-object-type="Event source" data-kordyn-v2-object-id={id} onClick={() => onSelect({ id, type: "Event source", workspaceId: "governance" })}><i data-tone={source.tone || "neutral"} /><span><strong>{source.name || id}</strong><small>最后成功 {source.lastSuccessAt || "Unavailable"}</small></span><em>{source.status || "unknown"}</em><ArrowRight size={16} /></button>;
      })}</section>
      <section className="kordynV2MobileGovernanceList"><header><span><strong>事件窗口</strong><small>{eventInputs.blocking || 0} 个阻断新风险</small></span></header>{windows.map((row, index) => {
        const id = row.id || row.eventId || `event-${index}`;
        return <button type="button" key={id} data-kordyn-v2-object-type="Event" data-kordyn-v2-object-id={id} onClick={() => onSelect({ id, type: "Event", workspaceId: "governance" })}><i data-tone={row.blocking ? "critical" : "warning"} /><span><strong>{row.title || "Event"}</strong><small>{row.dueAt || "时间不可用"}</small></span><em>{row.blocking ? "阻断" : "监控"}</em><ArrowRight size={16} /></button>;
      })}</section>
      <button className="kordynV2MobileObjectAction" type="button" data-kordyn-v2-navigate="governance:configuration" onClick={() => onNavigate("governance", "configuration")}>管理事件源配置 <ArrowRight size={18} /></button>
    </section>
  );
}

