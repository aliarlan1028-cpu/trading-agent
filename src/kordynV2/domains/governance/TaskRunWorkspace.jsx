import { ArrowRight, CirclePause, CirclePlay, RotateCcw } from "lucide-react";

const statusLabel = (row) => {
  const code = row.runtime?.code || row.status || "unknown";
  return ({ last_run_failed: "失败 · Failed", paused: "暂停", running: "处理中", healthy: "正常", attention: "需关注", awaiting_first_run: "等待首次运行" }[code] || code);
};

export function TaskRunWorkspace({ model = {}, actions, actionsDisabled = false, onSelect = () => {}, embedded = false }) {
  const operations = model.operations || {};
  const actionBlocked = actionsDisabled || model.permissions?.writeTask !== true;
  const tasks = operations.tasks?.items || [];
  const runs = operations.tasks?.recentRuns || [];
  const content = <>
    <section className="kordynV2TaskRegistry">
      <header><span><strong>运行任务与自主巡检</strong><small>系统托管说明所有权；运行状态来自真实 Run</small></span><em>{tasks.length}</em></header>
      <div>{tasks.map((task) => <article key={task.id} data-task-runtime={task.runtime?.code || "unknown"}>
        <button type="button" data-kordyn-v2-object-type="Task" data-kordyn-v2-object-id={task.id} onClick={() => onSelect({ id: task.id, type: "Task", workspaceId: "governance" })}>
          <span><strong>{task.name || task.title || task.handler || "Task"}</strong><small>{task.systemManaged ? "系统托管 · System-managed" : "用户任务"} · {task.handler || task.type || "handler unavailable"}</small></span><em>{statusLabel(task)}</em><ArrowRight size={14} />
        </button>
        <div><button type="button" disabled={actionBlocked || task.enabled === false} onClick={() => actions?.runTask?.(task.id)}><CirclePlay size={14} />运行</button><button type="button" disabled={actionBlocked} onClick={() => task.enabled === false ? actions?.resumeTask?.(task.id) : actions?.pauseTask?.(task.id)}>{task.enabled === false ? <RotateCcw size={14} /> : <CirclePause size={14} />}{task.enabled === false ? "恢复" : "暂停"}</button></div>
      </article>)}{!tasks.length && <p>当前没有已加载任务。</p>}</div>
    </section>
    <section className="kordynV2RunLedger">
      <header><span><strong>Agent / System Run</strong><small>阶段、结果与证据</small></span><em>{runs.length}</em></header>
      <div>{runs.slice(0, 12).map((run) => <button type="button" key={run.id} data-kordyn-v2-object-type="Agent run" data-kordyn-v2-object-id={run.id} onClick={() => onSelect({ id: run.id, type: "Agent run", workspaceId: "governance" })}><i data-tone={/fail|error|timeout/i.test(String(run.status)) ? "critical" : /partial|pending|retry/i.test(String(run.status)) ? "warning" : "healthy"} /><span><strong>{run.taskName || run.name || run.handler || run.id}</strong><small>{run.createdAt || run.finishedAt || "时间不可用"}</small></span><em>{run.status || "unknown"}</em><ArrowRight size={14} /></button>)}{!runs.length && <p>当前没有运行记录。</p>}</div>
    </section>
  </>;
  if (embedded) return <div className="kordynV2TaskRunEmbedded">{content}</div>;
  return <section className="kordynV2GovernanceWorkspace kordynV2TaskRunWorkspace" data-kordyn-v2-governance-workspace="runs"><header className="kordynV2GovernanceTitle"><span><h1>任务与运行</h1><p>任务定义、运行结果与 Agent Trace 保持分离。</p></span></header><div className="kordynV2TaskRunGrid">{content}</div></section>;
}
