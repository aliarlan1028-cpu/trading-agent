import { AlertTriangle, Bot, CircleAlert, Database, GitBranch, Info, Shield, ShieldAlert, ShieldCheck, Waypoints } from "lucide-react";

const unavailable = "Unavailable";
const validIdentity = (value) => typeof value === "string"
  && value.length > 0
  && value.length <= 240
  && value === value.trim()
  && !/[\p{White_Space}\p{Cc}]/u.test(value)
  && !["unavailable", "unknown", "n/a", "—"].includes(value.toLowerCase());
const text = (value) => typeof value === "string" && value ? value : unavailable;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const number = (value) => finite(value)
  ? new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 }).format(value)
  : unavailable;

export function executionSelectionCandidate(order) {
  return validIdentity(order?.id)
    ? { id: order.id, type: "Execution", workspaceId: "account", route: "executionReview", sourceSection: "cockpit" }
    : null;
}

const protectionPresentations = Object.freeze({
  verified: Object.freeze({ state: "verified", label: "已核验", tone: "healthy", icon: ShieldCheck }),
  failed: Object.freeze({ state: "failed", label: "保护异常", tone: "critical", icon: ShieldAlert }),
  degraded: Object.freeze({ state: "degraded", label: "证据降级", tone: "warning", icon: AlertTriangle }),
  unavailable: Object.freeze({ state: "unavailable", label: "证据不可用", tone: "unavailable", icon: Shield })
});

export function protectionPresentation(protection) {
  return protectionPresentations[protection?.state] || protectionPresentations.unavailable;
}

function incidentPresentation(incident) {
  const status = text(incident?.status).toLowerCase();
  const severity = text(incident?.severity).toLowerCase();
  const resolved = ["resolved", "closed"].includes(status);
  const active = ["open", "active", "investigating", "pending", "triggered"].includes(status);
  if (resolved) return { tone: "resolved", icon: ShieldCheck };
  if (active && ["critical", "high"].includes(severity)) return { tone: "critical", icon: AlertTriangle };
  if (active && ["medium", "warning"].includes(severity)) return { tone: "warning", icon: CircleAlert };
  return { tone: "neutral", icon: Info };
}

function EvidenceFact({ label, value }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

export function PositionInspector({ position, reconciliation, actionsDisabled = false, actionOutcome = null, onSelect = () => {}, onExit = () => {}, mobile = false }) {
  if (!position) return (
    <aside className={`kordynV2PositionInspector is-empty${mobile ? " is-mobile" : ""}`} aria-label="持仓证据">
      <ShieldAlert size={23} aria-hidden="true" /><p>选择持仓后查看保护证据与可用安全操作。</p>
    </aside>
  );
  const order = position.relatedExecution;
  const executionCandidate = executionSelectionCandidate(order);
  const protection = protectionPresentation(position.protection);
  const ProtectionIcon = protection.icon;
  const action = order?.exitAction;
  const canExit = Boolean(executionCandidate && action?.intent && !actionsDisabled);
  const incidents = Array.isArray(position.riskIncidents) ? position.riskIncidents : [];
  const latestReconciliation = reconciliation?.latest;
  return (
    <aside className={`kordynV2PositionInspector${mobile ? " is-mobile" : ""}`} aria-label="持仓证据与安全操作">
      <section className="kordynV2PositionEvidence">
        <header><span><GitBranch size={17} aria-hidden="true" /><h2>来源与执行链</h2></span><em data-protection-surface="inspector" data-protection-state={protection.state} data-protection-tone={protection.tone}><ProtectionIcon size={14} aria-hidden="true" />{protection.label}</em></header>
        <dl>
          <EvidenceFact label="来源" value={text(position.source)} />
          <EvidenceFact label="管理归属" value={position.ownership === "ai_managed" ? "AI 托管" : position.ownership === "manual_external" ? "手动 / 外部" : unavailable} />
          <EvidenceFact label="Agent run" value={text(position.agentRunId || order?.agentRunId)} />
          <EvidenceFact label="交易计划" value={text(position.planId || order?.planId)} />
          <EvidenceFact label="策略" value={text(position.strategy)} />
          <EvidenceFact label="保护快照" value={text(position.protection?.snapshotId)} />
          <EvidenceFact label="证据时间" value={text(position.protection?.asOf)} />
          <EvidenceFact label="对账报告" value={text(latestReconciliation?.id)} />
        </dl>
        {executionCandidate ? (
          <button
            type="button"
            className="kordynV2PositionExecutionLink"
            data-kordyn-v2-object-id={executionCandidate.id}
            data-kordyn-v2-object-type="Execution"
            onClick={() => onSelect(executionCandidate)}
          >
            <Waypoints size={16} aria-hidden="true" />
            <span><strong>{executionCandidate.id}</strong><small>{text(order.status)} · {text(order.exchange)}</small></span>
          </button>
        ) : <p className="kordynV2PositionEvidenceUnavailable"><Database size={15} aria-hidden="true" />关联执行对象不可用，不能启用保护动作。</p>}
      </section>
      <section className="kordynV2PositionProtectionEvidence">
        <header><h2>保护证据</h2><span data-protection-tone={protection.tone}>{text(position.protection?.reason || protection.label)}</span></header>
        <dl>
          <EvidenceFact label="本地止损" value={number(position.stopLoss)} />
          <EvidenceFact label="交易所核验价" value={number(position.protection?.stopPrice)} />
          <EvidenceFact label="止盈目标" value={position.takeProfits?.length ? position.takeProfits.map((value) => number(value)).join(" · ") : unavailable} />
        </dl>
        {incidents.length > 0 && <div className="kordynV2PositionIncidents" aria-label="关联风险事件">{incidents.slice(0, 4).map((incident) => {
          const presentation = incidentPresentation(incident);
          const IncidentIcon = presentation.icon;
          return <article key={incident.id} data-risk-incident-id={incident.id} data-incident-tone={presentation.tone}><IncidentIcon size={14} aria-hidden="true" /><span><strong>{text(incident.title)}</strong><small>{text(incident.status)} · {text(incident.severity)} · {text(incident.createdAt)}</small></span></article>;
        })}</div>}
      </section>
      <section className="kordynV2PositionSafeAction" aria-label="安全操作">
        <header><Bot size={16} aria-hidden="true" /><span><h2>安全操作</h2><small>以交易所事实为准，不乐观更新</small></span></header>
        {action ? (
          <button
            type="button"
            data-kordyn-v2-position-exit={action.intent}
            disabled={!canExit}
            onClick={() => canExit && onExit(order, mobile ? "mobile" : "desktop")}
          >
            <ShieldAlert size={16} aria-hidden="true" />{text(action.label)}
          </button>
        ) : <p>当前没有可执行的退出动作。</p>}
        <p>请求被接受不等于仓位已经关闭；账户快照、真实成交与财务对账完成后才形成最终事实。</p>
        {actionOutcome?.action === "exitExecutionOrder" && <span role="status" aria-live="polite" data-action-tone={actionOutcome.presentation?.tone || "unavailable"}>{text(actionOutcome.presentation?.message)}</span>}
      </section>
    </aside>
  );
}
