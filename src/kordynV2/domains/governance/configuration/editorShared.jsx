import { useState } from "react";
import { CheckCircle2, Save, ShieldAlert } from "lucide-react";

const normalizedFieldValue = (value) => value === null || value === undefined ? "" : String(value);

export function buildChangedConfigurationPayload(controls) {
  const payload = {};
  for (const control of Array.from(controls || [])) {
    if (!control?.name || control.disabled) continue;
    const checkedField = control.type === "checkbox" || control.type === "radio";
    const current = checkedField ? (control.checked ? normalizedFieldValue(control.value || "true") : "") : normalizedFieldValue(control.value);
    const initial = control.initialValue !== undefined
      ? normalizedFieldValue(control.initialValue)
      : control.dataset?.initialValue !== undefined
        ? normalizedFieldValue(control.dataset.initialValue)
        : checkedField
          ? (control.defaultChecked ? normalizedFieldValue(control.value || "true") : "")
          : normalizedFieldValue(control.defaultValue);
    if (current === initial || current === "Unavailable") continue;
    payload[control.name] = current;
  }
  return Object.keys(payload).length ? payload : null;
}

function allConfigurationFields(controls) {
  const fields = {};
  for (const control of Array.from(controls || [])) {
    if (!control?.name || control.disabled) continue;
    if (control.type === "checkbox" || control.type === "radio") {
      if (control.checked) fields[control.name] = normalizedFieldValue(control.value || "true");
      continue;
    }
    if (normalizedFieldValue(control.value) !== "Unavailable") fields[control.name] = normalizedFieldValue(control.value);
  }
  return fields;
}

export function EditorFrame({ id, title, description, current = "Unavailable", target = "Unavailable", actionsDisabled = false, submitDisabled = false, actionId = "save-config", onSubmit, onDirtyChange, children }) {
  const [dirty, setDirty] = useState(false);
  const disabled = actionsDisabled || submitDisabled || !dirty;
  const updateDirty = (event) => {
    const next = buildChangedConfigurationPayload(event.currentTarget.elements) !== null;
    setDirty(next);
    onDirtyChange?.(next);
  };
  const submit = (event) => {
    event.preventDefault();
    if (disabled) return false;
    return onSubmit?.(event);
  };
  return <section className="kordynV2ConfigurationEditor" data-kordyn-v2-config-editor={id} data-kordyn-v2-config-dirty={dirty ? "true" : "false"}><header><span><h2>{title}</h2><p>{description}</p></span><em>{actionsDisabled ? "只读" : dirty ? "有未保存变更" : "已同步"}</em></header><div className="kordynV2ConfigLifecycle" aria-label="配置生效生命周期"><span data-current="true">编辑所选值</span><i /><span>本地校验</span><i /><span>权限检查</span><i /><span>风险预检</span><i /><span>二次确认</span><i /><span>生效</span><i /><span>审计</span></div><div className="kordynV2ConfigMatrixMeta"><span><small>配置对象</small><strong>{title}</strong></span><span><small>Owner / Permission</small><strong>{actionsDisabled ? "Read only" : "Server RBAC"}</strong></span><span><small>Validation</small><strong>{submitDisabled ? "Waiting for input" : dirty ? "1 change pending" : "No pending change"}</strong></span></div><div className="kordynV2ConfigComparison"><span><small>保存目标 · Selected target</small><strong>{String(target)}</strong></span><span><small>当前生效 · Effective now</small><strong>{String(current)}</strong></span></div><form id={`kordyn-v2-config-form-${id}`} onChange={updateDirty} onInput={updateDirty} onSubmit={submit}><div className="kordynV2ConfigurationEditorBody">{children}</div><footer><span>{actionsDisabled ? <ShieldAlert size={14} /> : <CheckCircle2 size={14} />}{actionsDisabled ? "当前权限只允许查看" : submitDisabled ? "等待可编辑的权威事实" : dirty ? "提交前将执行权限与风险预检" : "修改一个值后才能提交"}</span><button type="submit" data-kordyn-v2-config-action={actionId} {...(!disabled ? { "data-kordyn-v2-action": "apply" } : {})} disabled={disabled}><Save size={14} />审查并应用</button></footer></form></section>;
}

export function TextField({ label, name, defaultValue = "", type = "text", disabled = false, hint }) {
  const initial = defaultValue === "Unavailable" ? "" : normalizedFieldValue(defaultValue);
  return <label><span>{label}</span><input type={type} name={name} defaultValue={initial} data-initial-value={initial} disabled={disabled} />{hint && <small>{hint}</small>}</label>;
}

export function SelectField({ label, name, defaultValue, disabled = false, children, hint }) {
  const initial = defaultValue === "Unavailable" ? "" : normalizedFieldValue(defaultValue);
  return <label><span>{label}</span><select name={name} defaultValue={initial} data-initial-value={initial} disabled={disabled}>{children}</select>{hint && <small>{hint}</small>}</label>;
}

export function submitFields(event, submit, { includeAll = false } = {}) {
  event.preventDefault();
  const changed = buildChangedConfigurationPayload(event.currentTarget.elements);
  if (!changed) return false;
  const fields = includeAll ? allConfigurationFields(event.currentTarget.elements) : changed;
  return submit?.(fields);
}
