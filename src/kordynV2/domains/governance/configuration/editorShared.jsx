import { CheckCircle2, Save, ShieldAlert } from "lucide-react";

export function EditorFrame({ id, title, description, current = "Unavailable", target = "Unavailable", actionsDisabled = false, submitDisabled = false, actionId = "save-config", onSubmit, children }) {
  const disabled = actionsDisabled || submitDisabled;
  return <section className="kordynV2ConfigurationEditor" data-kordyn-v2-config-editor={id}><header><span><h2>{title}</h2><p>{description}</p></span><em>{actionsDisabled ? "只读" : "可编辑"}</em></header><div className="kordynV2ConfigLifecycle" aria-label="配置生效生命周期"><span data-current="true">编辑所选值</span><i /><span>本地校验</span><i /><span>权限检查</span><i /><span>风险预检</span><i /><span>确认</span><i /><span>生效</span><i /><span>审计</span></div><div className="kordynV2ConfigMatrixMeta"><span><small>配置对象</small><strong>{title}</strong></span><span><small>Owner / Permission</small><strong>{actionsDisabled ? "Read only" : "Server RBAC"}</strong></span><span><small>Validation</small><strong>{submitDisabled ? "Waiting for input" : "Schema + risk preflight"}</strong></span></div><div className="kordynV2ConfigComparison"><span><small>保存目标 · Selected target</small><strong>{String(target)}</strong></span><span><small>当前生效 · Effective now</small><strong>{String(current)}</strong></span></div><form onSubmit={onSubmit}><div className="kordynV2ConfigurationEditorBody">{children}</div><footer><span>{actionsDisabled ? <ShieldAlert size={14} /> : <CheckCircle2 size={14} />}{actionsDisabled ? "当前权限只允许查看" : submitDisabled ? "修改一个值后才能提交" : "保存前将执行权限与风险预检"}</span><button type="submit" data-kordyn-v2-config-action={actionId} {...(!disabled ? { "data-kordyn-v2-action": "apply" } : {})} disabled={disabled}><Save size={14} />审查并应用</button></footer></form></section>;
}

export function TextField({ label, name, defaultValue = "", type = "text", disabled = false, hint }) {
  return <label><span>{label}</span><input type={type} name={name} defaultValue={defaultValue === "Unavailable" ? "" : defaultValue} disabled={disabled} />{hint && <small>{hint}</small>}</label>;
}

export function SelectField({ label, name, defaultValue, disabled = false, children, hint }) {
  return <label><span>{label}</span><select name={name} defaultValue={defaultValue} disabled={disabled}>{children}</select>{hint && <small>{hint}</small>}</label>;
}

export function submitFields(event, submit) {
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(event.currentTarget).entries());
  return submit?.(fields);
}
