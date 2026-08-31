import { AlertTriangle, ArrowRight, CheckCircle2, CirclePause, CirclePlay, RefreshCw, RotateCcw, Siren } from "lucide-react";

const toneLabel = (tone) => ({ healthy: "健康", warning: "降级", critical: "失败", neutral: "不可用" }[tone] || tone || "不可用");
const runTone = (status) => /fail|error|timeout/i.test(String(status)) ? "critical" : /partial|pending|retry|processing/i.test(String(status)) ? "warning" : "healthy";

export function OperationsWorkspace({ model = {}, actions, actionsDisabled = false, onSelect = () => {}, onNavigate = () => {} }) {
  const operations = model.operations || {};
  const services = operations.services || [];
  const tasks = operations.tasks?.items || [];
  const runs = operations.tasks?.recentRuns || [];
  const attention = operations.attention || [];
  const selectedRun = runs[0];
  const recovery = operations.recovery || {};
  const report = recovery.latestReconciliation;
  const lastValidReport = (recovery.reports || []).find((row) => row !== report && /healthy|success|complete|resolved/i.test(String(row?.status || ""))) || null;
  const primaryServices = services.filter((service) => service.id !== "inputs");
  const inputService = services.find((service) => service.id === "inputs");
  const traceStages = selectedRun?.stages || selectedRun?.trace?.stages || [];
  const taskActionsDisabled = actionsDisabled || model.permissions?.writeTask !== true;
  const stopDisabled = actionsDisabled || model.permissions?.stopTrading !== true;
  const serviceNode = (service) => <button type="button" key={service.id} data-kordyn-v2-operation-service={service.id} data-service-tone={service.tone || "neutral"} onClick={() => service.id === "inputs" && onNavigate("governance", "event-inputs")}>
    <i>{service.tone === "healthy" ? <CheckCircle2 size={17} /> : service.tone === "critical" ? <Siren size={17} /> : <AlertTriangle size={17} />}</i>
    <span><strong>{service.labelZh || service.labelEn || service.id}</strong><small>{toneLabel(service.tone)} · {service.value || "Unavailable"}</small></span>
  </button>;
  return (
    <section className="kordynV2GovernanceWorkspace kordynV2OperationsWorkspace" data-kordyn-v2-governance-workspace="operations">
      <header className="kordynV2GovernanceTitle"><span><h1>Operations · 运行总览</h1><p>权威运行拓扑、任务阶段、异常因果与恢复入口。</p></span><span className="kordynV2OperationsPatrol"><small>最近巡检 {operations.overall?.checkedAt || "Unavailable"}</small><button type="button" disabled={actionsDisabled || model.permissions?.writeEvent !== true} onClick={() => actions?.refreshEventSources?.()}><RefreshCw size={14} />立即巡检</button></span></header>
      <section className="kordynV2OperationsTopology" aria-label="运行拓扑">
        <div className="kordynV2TopologyChain">{primaryServices.map(serviceNode)}</div>
        {inputService && <div className="kordynV2TopologyBranch" data-branch-tone={inputService.tone || "neutral"}><span>辅助输入</span>{serviceNode(inputService)}<small>异常时使用最后有效数据并保持 fail-closed</small></div>}
        <footer><span data-tone="healthy">● 权威实时</span><span data-tone="warning">● 降级 / 最后有效</span><span data-tone="critical">● 失败</span></footer>
      </section>
      <div className="kordynV2OperationsBoard">
        <section className="kordynV2OperationsTaskColumn">
          <header><span><strong>运行任务与自主巡检</strong><small>当前运行 · 最近完成 · 失败与重试</small></span><em>{tasks.length} tasks</em></header>
          <div className="kordynV2OperationsTaskTable">
            {tasks.slice(0, 5).map((task) => <article key={task.id} data-task-runtime={task.runtime?.code || "unknown"}><button type="button" data-kordyn-v2-object-type="Task" data-kordyn-v2-object-id={task.id} onClick={() => onSelect({ id: task.id, type: "Task", workspaceId: "governance" })}><span><strong>{task.name || task.title || task.handler || "Task"}</strong><small>{task.handler || task.type || "handler unavailable"}</small></span><em>{task.runtime?.code || task.status || "unknown"}</em><ArrowRight size={14} /></button><div><button type="button" disabled={taskActionsDisabled || task.enabled === false} onClick={() => actions?.runTask?.(task.id)}><CirclePlay size={13} />运行</button><button type="button" disabled={taskActionsDisabled} onClick={() => task.enabled === false ? actions?.resumeTask?.(task.id) : actions?.pauseTask?.(task.id)}><CirclePause size={13} />{task.enabled === false ? "恢复" : "暂停"}</button></div></article>)}
            {runs.slice(0, Math.max(0, 5 - tasks.length)).map((run) => <button type="button" key={run.id} data-kordyn-v2-object-type="Agent run" data-kordyn-v2-object-id={run.id} onClick={() => onSelect({ id: run.id, type: "Agent run", workspaceId: "governance" })}><i data-tone={runTone(run.status)} /><span><strong>{run.taskName || run.name || run.id}</strong><small>{run.createdAt || run.finishedAt || "time unavailable"}</small></span><em>{run.status || "unknown"}</em><ArrowRight size={14} /></button>)}
          </div>
          <section className="kordynV2OperationsCurrentTrace" data-kordyn-v2-current-run-trace={selectedRun?.id || "Unavailable"}><header><strong>{selectedRun?.taskName || selectedRun?.name || "当前没有运行"} · 实时执行轨迹</strong><small>{selectedRun?.id || "Unavailable"}</small></header><div className="kordynV2RunStageTrace" data-kordyn-v2-trace-stages={traceStages.length}>{traceStages.length ? traceStages.slice(0, 6).map((stage, index) => <span key={stage.id || stage.key || index} data-tone={stage.tone || (stage.status === "failed" ? "critical" : "healthy")}><i />{stage.label || stage.name || stage.key || stage.id}</span>) : <em>Trace stages unavailable</em>}</div></section>
          <section className="kordynV2OperationsAuditStream"><header><strong>审计证据流</strong><button type="button" onClick={() => onNavigate("governance", "audit")}>打开完整审计 <ArrowRight size={14} /></button></header>{(operations.activity || []).slice(0, 4).map((row) => <button type="button" key={`${row.type}-${row.id}`} data-kordyn-v2-object-type="Audit log" data-kordyn-v2-object-id={row.id} onClick={() => onSelect({ id: row.id, type: "Audit log", workspaceId: "governance" })}><small>{row.createdAt || "Unavailable"}</small><strong>{row.title}</strong><em data-tone={row.tone}>{row.status || row.type}</em></button>)}</section>
        </section>
        <aside className="kordynV2OperationsRecoveryColumn">
          <header><span><strong>异常与恢复</strong><small>待处理 {attention.length} · 已恢复 {recovery.resolvedCount ?? "Unavailable"}</small></span></header>
          <div className="kordynV2OperationsIncidentStack">{attention.slice(0, 3).map((row) => {
            const type = row.kind === "incident" ? "Risk incident" : row.kind === "run" ? "Agent run" : row.kind === "source" ? "Event source" : "Recovery";
            const id = row.source?.id || row.id;
            return <button type="button" key={`${row.kind}-${id}`} data-kordyn-v2-object-type={type} data-kordyn-v2-object-id={id} data-tone={row.tone || "warning"} onClick={() => onSelect({ id, type, workspaceId: "governance" })}><AlertTriangle size={17} /><span><strong>{row.titleZh || row.titleEn || "Operational attention"}</strong><small>{row.detail || row.createdAt || "Evidence unavailable"}</small></span><em>{toneLabel(row.tone)}</em></button>;
          })}</div>
          <button className="kordynV2OperationsRecoveryCompare" type="button" data-kordyn-v2-recovery-comparison data-kordyn-v2-recovery-inspector={report?.id || "recovery-current"} onClick={() => onSelect({ id: report?.id || "recovery-current", type: "Recovery", workspaceId: "governance" })}><header><strong>事件输入部分降级</strong><em>{report?.status || "待权威结果"}</em></header><div><span><small>权威状态（当前）</small><strong>{report?.createdAt || "Unavailable"}</strong></span><i>⇄</i><span><small>最后有效（使用中）</small><strong>{lastValidReport?.createdAt || "Unavailable"}</strong></span></div><p>新风险保持 fail-closed；恢复必须由权威结果确认。</p><footer><RotateCcw size={14} />打开恢复工作台 <ArrowRight size={14} /></footer></button>
          <div className="kordynV2OperationsFailClosed"><AlertTriangle size={14} />空白不等于零：失去权威数据时自动交易保持关闭或 fail-closed。</div>
          <button className="kordynV2OperationsDanger" type="button" disabled={stopDisabled} onClick={() => actions?.setKillSwitch?.(true, "system_governance_operations")}><Siren size={20} /><span><strong>停止自动交易</strong><small>将停止所有自动交易与条件执行</small></span><ArrowRight size={16} /></button>
        </aside>
      </div>
    </section>
  );
}
