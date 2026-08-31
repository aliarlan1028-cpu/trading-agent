import { AlertTriangle, ArrowRight, CheckCircle2, RefreshCw, RotateCcw, Siren } from "lucide-react";
import { TaskRunWorkspace } from "./TaskRunWorkspace.jsx";

const toneLabel = (tone) => ({ healthy: "健康", warning: "降级", critical: "失败", neutral: "不可用" }[tone] || tone || "不可用");

export function OperationsWorkspace({ model = {}, actions, actionsDisabled = false, onSelect = () => {}, onNavigate = () => {} }) {
  const operations = model.operations || {};
  const services = operations.services || [];
  const attention = operations.attention || [];
  return (
    <section className="kordynV2GovernanceWorkspace kordynV2OperationsWorkspace" data-kordyn-v2-governance-workspace="operations">
      <header className="kordynV2GovernanceTitle"><span><h1>Operations · 运行总览</h1><p>权威运行拓扑、异常因果与恢复入口。</p></span><button type="button" disabled={actionsDisabled} onClick={() => actions?.refreshEventSources?.()}><RefreshCw size={14} />立即巡检</button></header>
      <section className="kordynV2OperationsTopology" aria-label="运行拓扑">
        {services.map((service) => <div key={service.id} data-kordyn-v2-operation-service={service.id} data-service-tone={service.tone || "neutral"}>
          <i>{service.tone === "healthy" ? <CheckCircle2 size={17} /> : service.tone === "critical" ? <Siren size={17} /> : <AlertTriangle size={17} />}</i>
          <span><strong>{service.labelZh || service.labelEn || service.id}</strong><small>{toneLabel(service.tone)} · {service.value || "Unavailable"}</small></span>
        </div>)}
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
        <header><span><strong>审计证据流</strong><small>最近运行、对账、通知与审计事件</small></span><button type="button" onClick={() => onNavigate("governance", "audit")}>查看全部 <ArrowRight size={14} /></button></header>
        <div>{(operations.activity || []).slice(0, 6).map((row) => <span key={`${row.type}-${row.id}`}><small>{row.createdAt || "Unavailable"}</small><strong>{row.title}</strong><em data-tone={row.tone}>{row.status || row.type}</em></span>)}</div>
      </section>
    </section>
  );
}
