import { AlertTriangle, ArrowRight, CheckCircle2, OctagonX } from "lucide-react";

export function MobileOperationsScreen({ model = {}, onSelect = () => {}, onNavigate = () => {} }) {
  const operations = model.operations || {};
  return (
    <section className="kordynV2GovernanceMobile" data-kordyn-v2-governance-mobile="runs">
      <header><h2>系统治理</h2><p>运行事实、任务与恢复</p></header>
      <section className="kordynV2MobileOperationsStatus"><header><span><strong>系统状态</strong><small>{operations.overall?.label || "Unavailable"}</small></span><em data-tone={operations.overall?.tone}>{operations.overall?.tone === "healthy" ? "正常" : "部分降级"}</em></header><div>{(operations.services || []).slice(0, 5).map((service) => <button type="button" key={service.id} data-kordyn-v2-operation-service={service.id} onClick={() => service.id === "inputs" ? onNavigate("governance", "event-inputs") : onNavigate("governance", "runs")}><i>{service.tone === "healthy" ? <CheckCircle2 size={18} /> : service.tone === "critical" ? <OctagonX size={18} /> : <AlertTriangle size={18} />}</i><span><strong>{service.labelZh || service.labelEn}</strong><small>{service.value || "Unavailable"}</small></span><em data-tone={service.tone}>{service.tone === "healthy" ? "可用" : "需处理"}</em><ArrowRight size={16} /></button>)}</div></section>
      <section className="kordynV2MobileAttention"><header><span><strong>异常与恢复</strong><small>{operations.attention?.length || 0} 项待处理</small></span></header>{(operations.attention || []).slice(0, 4).map((row) => {
        const type = row.kind === "incident" ? "Risk incident" : row.kind === "run" ? "Agent run" : row.kind === "source" ? "Event source" : "Recovery";
        const id = row.source?.id || row.id;
        return <button type="button" key={`${row.kind}-${id}`} data-kordyn-v2-object-type={type} data-kordyn-v2-object-id={id} onClick={() => onSelect({ id, type, workspaceId: "governance" })}><AlertTriangle size={19} /><span><strong>{row.titleZh || row.titleEn}</strong><small>{row.detail || "Evidence unavailable"}</small></span><ArrowRight size={17} /></button>;
      })}</section>
      <button className="kordynV2MobilePrimary" type="button" onClick={() => onNavigate("governance", "recovery")}>打开恢复工作台 <ArrowRight size={18} /></button>
    </section>
  );
}

