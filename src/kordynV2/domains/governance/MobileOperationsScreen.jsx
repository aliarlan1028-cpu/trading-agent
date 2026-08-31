import { AlertTriangle, ArrowRight, CheckCircle2, OctagonX, RefreshCw } from "lucide-react";
import { MobileTaskRunScreen } from "./MobileTaskRunScreen.jsx";

const toneIcon = (tone) => tone === "healthy" ? <CheckCircle2 size={18} /> : tone === "critical" ? <OctagonX size={18} /> : <AlertTriangle size={18} />;

export function MobileOperationsScreen({ model = {}, actions, actionsDisabled = false, onSelect = () => {}, onNavigate = () => {} }) {
  const operations = model.operations || {};
  const services = new Map((operations.services || []).map((service) => [service.id, service]));
  const latestRun = operations.tasks?.recentRuns?.[0];
  const input = services.get("inputs") || {};
  const account = services.get("account") || {};
  const boundary = model.boundary || {};
  const permissions = model.permissions || {};
  const statusRows = [
    { id: "system", label: "系统状态", value: operations.overall?.label || "Unavailable", tone: operations.overall?.tone || "neutral", target: ["governance", "overview"] },
    { id: "auto-cycle", label: latestRun?.taskName || "自主巡检周期", value: latestRun?.status || "Unavailable", tone: /fail|error|timeout/i.test(String(latestRun?.status)) ? "critical" : /pending|retry|partial|processing/i.test(String(latestRun?.status)) ? "warning" : latestRun ? "healthy" : "neutral", target: ["governance", "runs"] },
    { id: "inputs", label: "事件输入", value: input.value || `${operations.inputs?.enabled || 0}/${operations.inputs?.total || 0}`, tone: input.tone || "neutral", target: ["governance", "event-inputs"] },
    { id: "account", label: "OKX", value: account.value || "Unavailable", tone: account.tone || "neutral", target: ["account", "account"] },
    { id: "notifications", label: "通知", value: operations.notifications?.critical ? `${operations.notifications.critical} 项失败` : `${operations.notifications?.unread || 0} 未读`, tone: operations.notifications?.critical ? "critical" : operations.notifications?.unread ? "warning" : "healthy", target: ["governance", "notifications"] }
  ];
  return (
    <section className="kordynV2GovernanceMobile" data-kordyn-v2-governance-mobile="runs">
      <header><h2>系统治理</h2><p>运行事实、任务与恢复</p></header>
      <section className="kordynV2MobileOperationsStatus">
        <header className="kordynV2MobileStatusSummary"><span><strong>系统状态</strong><small>{operations.overall?.label || "Unavailable"}</small></span><em data-tone={operations.overall?.tone}>{operations.overall?.tone === "healthy" ? "正常" : "部分降级"}</em></header>
        <div>{statusRows.map((service) => <button type="button" key={service.id} data-kordyn-v2-operation-service={service.id} onClick={() => onNavigate(...service.target)}><i>{toneIcon(service.tone)}</i><span><strong>{service.label}</strong><small>{service.value}</small></span><em data-tone={service.tone}>{service.tone === "healthy" ? "可用" : service.tone === "neutral" ? "未知" : "需处理"}</em><ArrowRight size={16} /></button>)}</div>
        <nav className="kordynV2MobileStatusRail" aria-label="系统状态快捷入口">{statusRows.map((service) => <button type="button" key={service.id} aria-label={service.label} data-tone={service.tone} onClick={() => onNavigate(...service.target)}>{toneIcon(service.tone)}</button>)}</nav>
      </section>
      <section className="kordynV2MobileDegradedDecision" data-tone={input.tone || "neutral"}><header><AlertTriangle size={20} /><span><strong>Event Input 部分降级</strong><small>权威状态　{input.value || "Unavailable"}</small></span></header><dl><div><dt>最后有效</dt><dd>{operations.inputs?.lastValidAt || "Unavailable"}</dd></div><div><dt>影响</dt><dd>事件覆盖下降</dd></div><div><dt>自动交易</dt><dd>fail-closed</dd></div></dl><div><button type="button" onClick={() => onNavigate("governance", "event-inputs")}>查看详情 <ArrowRight size={15} /></button><button type="button" disabled={actionsDisabled || permissions.writeEvent !== true} onClick={() => actions?.refreshEventSources?.()}>重试 <RefreshCw size={15} /></button></div></section>
      <button className="kordynV2MobileDangerDecision" type="button" data-kordyn-v2-danger-action="kill-switch" disabled={actionsDisabled || (boundary.killSwitch ? permissions.clearKillSwitch !== true : permissions.stopTrading !== true)} onClick={() => actions?.setKillSwitch?.(!boundary.killSwitch, "system_governance_mobile_operations")}><OctagonX size={20} /><span><strong>{boundary.killSwitch ? "申请解除停止" : "停止自动交易"}</strong><small>此操作将立即停止所有自动交易。</small></span><em>需要确认</em><ArrowRight size={17} /></button>
      <section className="kordynV2MobileAttention"><header><span><strong>异常与恢复</strong><small>{operations.attention?.length || 0} 项待处理</small></span></header>{(operations.attention || []).slice(0, 4).map((row) => {
        const type = row.kind === "incident" ? "Risk incident" : row.kind === "run" ? "Agent run" : row.kind === "source" ? "Event source" : "Recovery";
        const id = row.source?.id || row.id;
        return <button type="button" key={`${row.kind}-${id}`} data-kordyn-v2-object-type={type} data-kordyn-v2-object-id={id} onClick={() => onSelect({ id, type, workspaceId: "governance" })}><AlertTriangle size={19} /><span><strong>{row.titleZh || row.titleEn}</strong><small>{row.detail || "Evidence unavailable"}</small></span><ArrowRight size={17} /></button>;
      })}</section>
      <MobileTaskRunScreen model={model} actions={actions} actionsDisabled={actionsDisabled} onSelect={onSelect} embedded />
      <button className="kordynV2MobilePrimary" type="button" onClick={() => onNavigate("governance", "recovery")}>打开恢复工作台 <ArrowRight size={18} /></button>
    </section>
  );
}
