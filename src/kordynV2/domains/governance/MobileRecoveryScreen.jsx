import { AlertOctagon, ArrowRight, RefreshCw, RotateCcw } from "lucide-react";

export function MobileRecoveryScreen({ model = {}, actions, actionsDisabled = false, onSelect = () => {} }) {
  const recovery = model.operations?.recovery || {};
  return <section className="kordynV2GovernanceMobile" data-kordyn-v2-governance-mobile="recovery"><header><h2>恢复</h2><p>对账、调度与风险事件</p></header><button className="kordynV2MobilePrimary" type="button" disabled={actionsDisabled} onClick={() => actions?.reconcile?.()}><RefreshCw size={18} />运行权威对账</button><button className="kordynV2MobileObjectAction" type="button" disabled={actionsDisabled || !recovery.needsSchedulerRecovery} onClick={() => actions?.recoverScheduler?.()}><RotateCcw size={18} />恢复任务调度</button><section className="kordynV2MobileAttention"><header><span><strong>开放风险事件</strong><small>{recovery.openIncidents?.length || 0} 项</small></span></header>{(recovery.openIncidents || []).map((row) => <button type="button" key={row.id} data-kordyn-v2-object-type="Risk incident" data-kordyn-v2-object-id={row.id} onClick={() => onSelect({ id: row.id, type: "Risk incident", workspaceId: "governance" })}><AlertOctagon size={19} /><span><strong>{row.title || row.source || row.id}</strong><small>{row.status || "open"}</small></span><ArrowRight size={17} /></button>)}</section></section>;
}

