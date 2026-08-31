import { EditorFrame, SelectField, TextField, submitFields } from "./editorShared.jsx";

export function SecurityEditor({ model = {}, actions, actionsDisabled = false }) {
  const loaded = typeof model.authRequired === "boolean";
  const auth = loaded ? (model.authRequired ? "Required" : "Disabled") : "Unavailable";
  return <EditorFrame id="security" title="安全" description="登录鉴权与凭据生命周期；密钥原文不会进入 DOM。" target={auth} current={auth} actionsDisabled={actionsDisabled} submitDisabled={!loaded} onSubmit={(event) => submitFields(event, (fields) => actions?.saveConfig?.(fields))}>
    <div className="kordynV2ConfigurationFields">
      <SelectField label="登录鉴权" name="AUTH_REQUIRED" defaultValue={loaded ? String(model.authRequired) : "Unavailable"} disabled={actionsDisabled || !loaded}>{!loaded && <option value="Unavailable">Unavailable</option>}<option value="true">必须登录</option><option value="false">关闭鉴权</option></SelectField>
      <TextField label="Owner 密码替换值" name="ADMIN_PASSWORD" type="password" defaultValue="" disabled={actionsDisabled || !loaded} hint={model.adminPasswordSet ? "已配置；留空保持原值" : "Unavailable；输入后配置"} />
    </div>
    <label className="kordynV2MaskedField"><span>凭据状态</span><output>{model.masterKeyConfigured ? "主密钥已配置 · hidden" : "Unavailable"}</output><small>只能替换或清除，不能读取原文</small></label>
    <div className="kordynV2ConfigRuleRows">{(model.secrets || []).map((secret) => <article key={secret.key}><span><strong>{secret.label}</strong><small>{secret.configured ? "已配置 · hidden" : "未配置"}</small></span><button type="button" data-kordyn-v2-config-action="clear-secret" disabled={actionsDisabled || !secret.configured} onClick={() => actions?.clearSecret?.(secret.key)}>清除</button></article>)}</div>
  </EditorFrame>;
}
