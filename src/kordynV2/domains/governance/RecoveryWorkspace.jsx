import { AlertOctagon, ArrowRight, RefreshCw, RotateCcw } from "lucide-react";

export function RecoveryWorkspace({ model = {}, actions, actionsDisabled = false, onSelect = () => {} }) {
  const recovery = model.operations?.recovery || model.recovery || {};
  const permissions = model.permissions || {};
  const report = recovery.latestReconciliation;
  const recoveryId = report?.id || "recovery-current";
  return (
    <section className="kordynV2GovernanceWorkspace kordynV2RecoveryWorkspace" data-kordyn-v2-governance-workspace="recovery">
      <header className="kordynV2GovernanceTitle"><span><h1>恢复</h1><p>对账、调度恢复与风险事件处理均等待权威结果。</p></span></header>
      <div className="kordynV2RecoveryGrid">
        <section className="kordynV2RecoveryTruth" data-kordyn-v2-object-type="Recovery" data-kordyn-v2-object-id={recoveryId}>
          <header><span><strong>最新对账</strong><small>{report?.createdAt || "尚未运行"}</small></span><em>{report?.status || "unavailable"}</em></header>
          <dl><div><dt>差异</dt><dd>{recovery.differences?.length || 0}</dd></div><div><dt>未知执行</dt><dd>{recovery.unknownOrders?.length || 0}</dd></div><div><dt>开放事件</dt><dd>{recovery.openIncidents?.length || 0}</dd></div></dl>
          <button type="button" onClick={() => onSelect({ id: recoveryId, type: "Recovery", workspaceId: "governance" })}>查看恢复证据 <ArrowRight size={15} /></button>
        </section>
        <section className="kordynV2RecoveryActions"><header><strong>可执行恢复</strong><small>每个结果由服务端确认</small></header><button type="button" disabled={actionsDisabled || permissions.reconcile !== true} onClick={() => actions?.reconcile?.()}><RefreshCw size={18} /><span><strong>运行对账</strong><small>拉取最新快照并核对持仓、订单与成交</small></span><ArrowRight size={16} /></button><button type="button" disabled={actionsDisabled || permissions.writeTask !== true || !recovery.needsSchedulerRecovery} onClick={() => actions?.recoverScheduler?.()}><RotateCcw size={18} /><span><strong>恢复任务调度</strong><small>重建调度状态并验证租约</small></span><ArrowRight size={16} /></button></section>
      </div>
      <section className="kordynV2RecoveryQueue"><header><span><strong>风险事件队列</strong><small>处理动作不删除历史证据</small></span><em>{recovery.openIncidents?.length || 0}</em></header><div>{(recovery.openIncidents || []).map((row) => <article key={row.id}><button type="button" data-kordyn-v2-object-type="Risk incident" data-kordyn-v2-object-id={row.id} onClick={() => onSelect({ id: row.id, type: "Risk incident", workspaceId: "governance" })}><AlertOctagon size={17} /><span><strong>{row.title || row.source || row.id}</strong><small>{row.createdAt || row.status || "open"}</small></span><ArrowRight size={15} /></button><button type="button" disabled={actionsDisabled || permissions.writeRisk !== true} onClick={() => actions?.resolveRiskIncident?.(row.id)}>标记已处理</button></article>)}{!recovery.openIncidents?.length && <p>当前没有开放风险事件。</p>}</div></section>
    </section>
  );
}
