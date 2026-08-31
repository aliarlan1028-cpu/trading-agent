import { AlertTriangle, ArrowRight, Ban, CheckCircle2, CircleGauge, KeyRound, ShieldCheck } from "lucide-react";
import { ReadinessChain } from "./ReadinessChain.jsx";
import { RuleMonitor } from "./RuleMonitor.jsx";

const displayMode = (value) => ({ full_auto: "自动交易", full_auto_small: "自动交易", auto: "自动交易", semi_auto: "半自动", observe: "暂停新开仓", halted: "紧急停止" }[value] || value || "Unavailable");
const list = (value) => Array.isArray(value) ? value : [];

export function BoundaryWorkspace({ model = {}, actions, actionsDisabled = false, onNavigate = () => {}, onSelect = () => {} }) {
  const boundary = model.boundary || {};
  const blocker = list(boundary.blockers)[0] || null;
  const mandate = boundary.mandate || {};
  const incidents = list(boundary.incidents?.items);
  const operations = model.operations || {};
  const auditRows = list(operations.audit?.records);
  const permissions = model.permissions || {};
  return (
    <section className="kordynV2GovernanceWorkspace kordynV2BoundaryWorkspace" data-kordyn-v2-governance-workspace="overview">
      <header className="kordynV2GovernanceTitle"><span><h1>当前边界</h1><p>目标、阻断与当前生效事实始终分开。</p></span><button type="button" data-kordyn-v2-navigate="governance:configuration" onClick={() => onNavigate("governance", "configuration")}><KeyRound size={14} />打开权威配置</button></header>
      <div className="kordynV2BoundaryLead">
        <section className="kordynV2BoundaryDelta" data-boundary-diverged={boundary.targetIsEffective ? "false" : "true"}>
          <div><small>保存目标 · Selected target</small><strong>{displayMode(boundary.selectedMode)}</strong><span>用户与 Owner 选择的目标状态</span></div>
          <ArrowRight size={22} aria-hidden="true" />
          <div><small>当前生效 · Effective now</small><strong>{displayMode(boundary.effectiveMode)}</strong><span>{boundary.runtimeStatus || "运行状态不可用"}</span></div>
          <aside><small>原因</small><strong>{blocker?.label || (boundary.targetIsEffective ? "目标已经生效" : "服务端仍在验证")}</strong><span>{blocker?.recovery || "以服务端最新事实为准"}</span></aside>
        </section>
        <section className="kordynV2PermissionBoundary">
          <header><ShieldCheck size={18} /><strong>当前动作边界</strong></header>
          <p data-tone="healthy"><CheckCircle2 size={14} />允许：取消 / 平仓 / 保护 / 对账</p>
          <p data-tone="warning"><CircleGauge size={14} />条件允许：按当前有效授权继续监控</p>
          <p data-tone="critical"><Ban size={14} />禁止：新增风险 / 加仓 / 提升杠杆</p>
          <div className="kordynV2BoundaryDangerActions" aria-label="危险操作区">
            <button type="button" data-kordyn-v2-danger-action="kill-switch" disabled={actionsDisabled || (boundary.killSwitch ? permissions.clearKillSwitch !== true : permissions.stopTrading !== true)} onClick={() => actions?.setKillSwitch?.(!boundary.killSwitch, "system_governance_boundary")}><Ban size={13} />{boundary.killSwitch ? "申请解除停止" : "紧急停止"}</button>
            <button type="button" data-kordyn-v2-danger-action="flatten-all" disabled={actionsDisabled || permissions.flattenAll !== true} onClick={() => actions?.flattenAll?.()}><AlertTriangle size={13} />一键平仓</button>
          </div>
        </section>
      </div>
      <div className="kordynV2BoundaryGrid">
        <ReadinessChain rows={boundary.readiness} blockers={boundary.blockers} onNavigate={onNavigate} />
        <section className="kordynV2BoundaryFacts">
          <header><strong>风险事实</strong><small>当前有效</small></header>
          <dl>
            <div><dt>单笔订单上限</dt><dd>{mandate.effectiveOrderLimitUsdt ?? "Unavailable"} USDT</dd></div>
            <div><dt>最大杠杆</dt><dd>{mandate.maxLeverage ?? "Unavailable"}x</dd></div>
            <div><dt>允许市场</dt><dd>{list(mandate.allowedSymbols).join(", ") || "Unavailable"}</dd></div>
            <div><dt>有效授权</dt><dd>{mandate.id || "Unavailable"}</dd></div>
            <div><dt>事件阻断</dt><dd>{boundary.events?.blocking ?? "Unavailable"}</dd></div>
          </dl>
          {mandate.id && <button type="button" data-kordyn-v2-object-type="Mandate" data-kordyn-v2-object-id={mandate.id} onClick={() => onSelect({ id: mandate.id, type: "Mandate", workspaceId: "governance" })}>查看授权证据 <ArrowRight size={14} /></button>}
        </section>
      </div>
      <div className="kordynV2BoundaryLower">
        <RuleMonitor rules={boundary.rules} onSelect={onSelect} />
        <section className="kordynV2BoundaryOperationsMatrix">
          <header><span><strong>运营健康矩阵</strong><small>服务状态与最新证据</small></span><em>{operations.services?.length || 0}</em></header>
          <div>{(operations.services || []).map((service) => <span key={service.id} data-tone={service.tone}><i /><strong>{service.labelZh || service.id}</strong><small>{service.value || "Unavailable"}</small></span>)}</div>
          <footer>{(operations.activity || []).slice(0, 2).map((row) => <small key={`${row.type}-${row.id}`}>{row.createdAt || "Unavailable"} · {row.title}</small>)}</footer>
        </section>
        <section className="kordynV2IncidentQueue">
          <header><span><strong>开放风险事件</strong><small>只读事实与恢复入口</small></span><em>{boundary.incidents?.open ?? incidents.length}</em></header>
          {incidents.slice(0, 5).map((row) => <button type="button" key={row.id} data-kordyn-v2-object-type="Risk incident" data-kordyn-v2-object-id={row.id} onClick={() => onSelect({ id: row.id, type: "Risk incident", workspaceId: "governance" })}><AlertTriangle size={16} /><span><strong>{row.title || row.source || "Risk incident"}</strong><small>{row.status || "open"}</small></span><ArrowRight size={14} /></button>)}
          {!incidents.length && <p>当前没有开放风险事件。</p>}
          <footer><button type="button" onClick={() => onNavigate("governance", "recovery")}>打开恢复工作台</button><button type="button" onClick={() => onNavigate("governance", "configuration")}>配置索引</button></footer>
        </section>
      </div>
      <section className="kordynV2BoundaryAuditLedger" aria-label="最新审计证据">
        <header><span><strong>审计日志</strong><small>Actor、对象、动作、结果与 Trace 保持可核验</small></span><button type="button" onClick={() => onNavigate("governance", "audit")}>查看全部 <ArrowRight size={14} /></button></header>
        <div>{auditRows.slice(0, 5).map((row) => <button type="button" key={row.id} data-kordyn-v2-object-type="Audit log" data-kordyn-v2-object-id={row.id} onClick={() => onSelect({ id: row.id, type: "Audit log", workspaceId: "governance" })}><small>{row.createdAt || "Unavailable"}</small><strong>{row.actor || "actor unavailable"}</strong><span>{row.action || "Audit event"}</span><em>{row.status || row.result || "recorded"}</em><code>{row.traceId || row.hash || row.id}</code></button>)}{!auditRows.length && <p>当前没有已加载审计证据。</p>}</div>
      </section>
    </section>
  );
}
