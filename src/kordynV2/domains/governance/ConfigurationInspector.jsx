import { CheckCircle2, FileClock, ShieldAlert } from "lucide-react";

export function ConfigurationInspector({ model = {}, target = "trading", actionsDisabled = false }) {
  const trading = model.trading || {};
  return <aside className="kordynV2ConfigurationInspector" aria-label="变更检查器"><header><span><strong>变更检查器</strong><small>{target} · 选择与生效分离</small></span><FileClock size={16} /></header><section><strong>影响评估</strong><dl><div><dt>当前授权</dt><dd>{model.permission?.owner ? "Owner" : model.permission?.role || "Unavailable"}</dd></div><div><dt>当前模式</dt><dd>{trading.mode?.effective ?? "Unavailable"}</dd></div><div><dt>保存目标</dt><dd>{trading.mode?.selected ?? "Unavailable"}</dd></div><div><dt>审计记录</dt><dd>{model.audit?.total ?? "Unavailable"}</dd></div></dl></section><section><strong>风险检查</strong><p><CheckCircle2 size={14} />服务端校验后才生效</p><p><CheckCircle2 size={14} />失败不会覆盖当前有效值</p><p data-tone={actionsDisabled ? "warning" : "healthy"}>{actionsDisabled ? <ShieldAlert size={14} /> : <CheckCircle2 size={14} />}{actionsDisabled ? "当前权限不可编辑" : "需要明确确认"}</p></section><footer><small>最终结果以服务端返回和下一次事实刷新为准。</small></footer></aside>;
}

