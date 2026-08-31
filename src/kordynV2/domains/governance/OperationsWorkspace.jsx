import { AlertTriangle, ArrowRight, CheckCircle2, RefreshCw, RotateCcw, Siren } from "lucide-react";
import { TaskRunWorkspace } from "./TaskRunWorkspace.jsx";

const toneLabel = (tone) => ({ healthy: "健康", warning: "降级", critical: "失败", neutral: "不可用" }[tone] || tone || "不可用");

export function OperationsWorkspace({ model = {}, actions, actionsDisabled = false, onSelect = () => {}, onNavigate = () => {} }) {
  const operations = model.operations || {};
  const services = operations.services || [];
  const attention = operations.attention || [];
  const selectedRun = operations.tasks?.recentRuns?.[0];
  const recovery = operations.recovery || {};
  const report = recovery.latestReconciliation;
  const lastValidReport = (recovery.reports || []).find((row) => row !== report && /healthy|success|complete|resolved/i.test(String(row?.status || ""))) || null;
  const primaryServices = services.filter((service) => service.id !== "inputs");
  const inputService = services.find((service) => service.id === "inputs");
  const traceStages = selectedRun?.stages || selectedRun?.trace?.stages || [];
  const serviceNode = (service) => <div key={service.id} data-kordyn-v2-operation-service={service.id} data-service-tone={service.tone || "neutral"}>
    <i>{service.tone === "healthy" ? <CheckCircle2 size={17} /> : service.tone === "critical" ? <Siren size={17} /> : <AlertTriangle size={17} />}</i>
    <span><strong>{service.labelZh || service.labelEn || service.id}</strong><small>{toneLabel(service.tone)} · {service.value || "Unavailable"}</small></span>
  </div>;
  return (
    <section className="kordynV2GovernanceWorkspace kordynV2OperationsWorkspace" data-kordyn-v2-governance-workspace="operations">
      <header className="kordynV2GovernanceTitle"><span><h1>Operations · 运行总览</h1><p>权威运行拓扑、异常因果与恢复入口。</p></span><button type="button" disabled={actionsDisabled || model.permissions?.writeEvent !== true} onClick={() => actions?.refreshEventSources?.()}><RefreshCw size={14} />立即巡检</button></header>
      <section className="kordynV2OperationsTopology" aria-label="运行拓扑">
        <div className="kordynV2TopologyChain">{primaryServices.map(serviceNode)}</div>
        {inputService && <div className="kordynV2TopologyBranch" data-branch-tone={inputService.tone || "neutral"}><span>辅助输入</span>{serviceNode(inputService)}<small>异常时使用最后有效数据并保持 fail-closed</small></div>}
        <footer><span data-tone="healthy">● 权威实时</span><span data-tone="warning">● 降级 / 最后有效</span><span data-tone="critical">● 失败</span></footer>
      </section>
      <div className="kordynV2OperationsMain">
        <TaskRunWorkspace model={model} actions={actions} actionsDisabled={actionsDisabled} onSelect={onSelect} embedded />
        <section className="kordynV2OperationsAttention">
          <header><span><strong>异常与恢复</strong><small>按影响与因果排序</small></span><em>{attention.length}</em></header>
          <div>{attention.map((row) => {
            const type = row.kind === "incident" ? "Risk incident" : row.kind === "run" ? "Agent run" : row.kind === "source" ? "Event source" : "Recovery";
            const id = row.source?.id || row.id;
            return <button type="button" key={`${row.kind}-${id}`} data-kordyn-v2-object-type={type} data-kordyn-v2-object-id={id} data-tone={row.tone || "warning"} onClick={() => onSelect({ id, type, workspaceId: "governance" })}>
              <AlertTriangle size={16} /><span><strong>{row.titleZh || row.titleEn || "Operational attention"}</strong><small>{row.detail || row.createdAt || "Evidence unavailable"}</small></span><em>{toneLabel(row.tone)}</em><ArrowRight size={15} />
            </button>;
          })}{!attention.length && <p>当前没有待处理运行异常。</p>}</div>
          <footer><button type="button" onClick={() => onNavigate("governance", "recovery")}><RotateCcw size={14} />打开恢复工作台</button></footer>
        </section>
      </div>
      <section className="kordynV2OperationsEvidence">
        <header><span><strong>当前运行 Trace 与恢复证据</strong><small>Run、恢复结果与审计账本保持分离</small></span><button type="button" onClick={() => onNavigate("governance", "audit")}>查看全部 <ArrowRight size={14} /></button></header>
        <div className="kordynV2OperationsEvidenceGrid"><section data-kordyn-v2-current-run-trace={selectedRun?.id || "Unavailable"}><small>当前 Run</small><strong>{selectedRun?.taskName || selectedRun?.name || "Unavailable"}</strong><span>{selectedRun?.id || "Unavailable"} · {selectedRun?.status || "no result"}</span><div className="kordynV2RunStageTrace" data-kordyn-v2-trace-stages={traceStages.length}>{traceStages.length ? traceStages.slice(0, 6).map((stage, index) => <span key={stage.id || stage.key || index} data-tone={stage.tone || (stage.status === "failed" ? "critical" : "healthy")}><i />{stage.label || stage.name || stage.key || stage.id}</span>) : <em>Trace stages unavailable</em>}</div></section><button type="button" data-kordyn-v2-recovery-inspector={report?.id || "recovery-current"} onClick={() => onSelect({ id: report?.id || "recovery-current", type: "Recovery", workspaceId: "governance" })}><small>恢复检查器</small><strong>{report?.status || "尚无对账结果"}</strong><span>当前：{report?.createdAt || "Unavailable"}</span><span>最后有效：{lastValidReport?.createdAt || "Unavailable"}</span><em>{recovery.differences?.length || 0} differences · {recovery.unknownOrders?.length || 0} unknown</em><ArrowRight size={14} /></button><section>{(operations.activity || []).slice(0, 3).map((row) => <span key={`${row.type}-${row.id}`}><small>{row.createdAt || "Unavailable"}</small><strong>{row.title}</strong><em data-tone={row.tone}>{row.status || row.type}</em></span>)}</section></div>
      </section>
    </section>
  );
}
