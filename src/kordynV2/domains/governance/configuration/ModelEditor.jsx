import { EditorFrame, TextField, submitFields } from "./editorShared.jsx";

export function ModelEditor({ model = {}, actions, actionsDisabled = false }) {
  const providers = model.status?.providers || model.selected?.providers || {};
  const gemini = providers.gemini || {};
  const classifier = providers.classifier || {};
  const deepseek = providers.deepseek || {};
  const loaded = Boolean(gemini.model || classifier.model || deepseek.model);
  const current = gemini.model || "Unavailable";
  return <EditorFrame id="models" title="模型与密钥" description="模型标识使用服务端真实配置键；Provider 凭据只显示是否存在。" target={current} current={current} actionsDisabled={actionsDisabled} submitDisabled={!loaded} onSubmit={(event) => submitFields(event, (fields) => actions?.saveConfig?.(fields))}>
    <div className="kordynV2ConfigurationFields">
      <TextField label="Gemini 主分析模型" name="GEMINI_MODEL" defaultValue={gemini.model} disabled={actionsDisabled || !loaded} />
      <TextField label="Gemini 分类模型" name="GEMINI_CLASSIFIER_MODEL" defaultValue={classifier.model} disabled={actionsDisabled || !loaded} />
      <TextField label="DeepSeek 审查模型" name="DEEPSEEK_MODEL" defaultValue={deepseek.model} disabled={actionsDisabled || !loaded} />
    </div>
    <div className="kordynV2ConfigRuleRows" aria-label="Provider credential status">
      <article><span><strong>OpenRouter API Key</strong><small>{gemini.hasKey ? "已配置 · hidden" : "Unavailable"}</small></span></article>
      <article><span><strong>DeepSeek API Key</strong><small>{deepseek.hasKey ? "已配置 · hidden" : "Unavailable"}</small></span></article>
    </div>
  </EditorFrame>;
}
