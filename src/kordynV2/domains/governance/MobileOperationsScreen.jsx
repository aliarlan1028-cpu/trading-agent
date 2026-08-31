import { AlertTriangle, ArrowRight, CheckCircle2, OctagonX } from "lucide-react";

export function MobileOperationsScreen({ model = {}, onSelect = () => {}, onNavigate = () => {} }) {
  const operations = model.operations || {};
  const services = new Map((operations.services || []).map((service) => [service.id, service]));
  const latestRun = operations.tasks?.recentRuns?.[0];
  const input = services.get("inputs") || {};
  const account = services.get("account") || {};
  const statusRows = [
    { id: "system", label: "系统状态", value: operations.overall?.label || "Unavailable", tone: operations.overall?.tone || "neutral", target: ["governance", "overview"] },
    { id: "auto-cycle", label: latestRun?.taskName || "自主巡检周期", value: latestRun?.status || "Unavailable", tone: /fail|error|timeout/i.test(String(latestRun?.status)) ? "critical" : /pending|retry|partial/i.test(String(latestRun?.status)) ? "warning" : latestRun ? "healthy" : "neutral", target: ["governance", "runs"] },
    { id: "inputs", label: "事件输入", value: input.value || `${operations.inputs?.enabled || 0}/${operations.inputs?.total || 0}`, tone: input.tone || "neutral", target: ["governance", "event-inputs"] },
    { id: "account", label: "OKX", value: account.value || "Unavailable", tone: account.tone || "neutral", target: ["account", "account"] },
    { id: "notifications", label: "通知", value: operations.notifications?.critical ? `${operations.notifications.critical} 项失败` : `${operations.notifications?.unread || 0} 未读`, tone: operations.notifications?.critical ? "critical" : operations.notifications?.unread ? "warning" : "healthy", target: ["governance", "notifications"] }
  ];
  return (
    <section className="kordynV2GovernanceMobile" data-kordyn-v2-governance-mobile="runs">
      <header><h2>系统治理</h2><p>运行事实、任务与恢复</p></header>
      <section className="kordynV2MobileOperationsStatus"><header><span><strong>系统状态</strong><small>{operations.overall?.label || "Unavailable"}</small></span><em data-tone={operations.overall?.tone}>{operations.overall?.tone === "healthy" ? "正常" : "部分降级"}</em></header><div>{statusRows.map((service) => <button type="button" key={service.id} data-kordyn-v2-operation-service={service.id} onClick={() => onNavigate(...service.target)}><i>{service.tone === "healthy" ? <CheckCircle2 size={18} /> : service.tone === "critical" ? <OctagonX size={18} /> : <AlertTriangle size={18} />}</i><span><strong>{service.label}</strong><small>{service.value}</small></span><em data-tone={service.tone}>{service.tone === "healthy" ? "可用" : service.tone === "neutral" ? "未知" : "需处理"}</em><ArrowRight size={16} /></button>)}</div></section>
      <section className="kordynV2MobileAttention"><header><span><strong>异常与恢复</strong><small>{operations.attention?.length || 0} 项待处理</small></span></header>{(operations.attention || []).slice(0, 4).map((row) => {
        const type = row.kind === "incident" ? "Risk incident" : row.kind === "run" ? "Agent run" : row.kind === "source" ? "Event source" : "Recovery";
        const id = row.source?.id || row.id;
        return <button type="button" key={`${row.kind}-${id}`} data-kordyn-v2-object-type={type} data-kordyn-v2-object-id={id} onClick={() => onSelect({ id, type, workspaceId: "governance" })}><AlertTriangle size={19} /><span><strong>{row.titleZh || row.titleEn}</strong><small>{row.detail || "Evidence unavailable"}</small></span><ArrowRight size={17} /></button>;
      })}</section>
      <button className="kordynV2MobilePrimary" type="button" onClick={() => onNavigate("governance", "recovery")}>打开恢复工作台 <ArrowRight size={18} /></button>
    </section>
  );
}
