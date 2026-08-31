import { EditorFrame, SelectField, TextField, submitFields } from "./editorShared.jsx";

export function EnvironmentEditor({ model = {}, actions, actionsDisabled = false }) {
  const loaded = Boolean(model.okxMarketType || model.skillSandboxImage || model.port);
  const market = model.okxMarketType || "";
  return <EditorFrame id="environment" title="环境" description="只编辑服务端已部署的运行参数；进程环境名称不属于可写配置。" target={market} current={market} actionsDisabled={actionsDisabled} submitDisabled={!loaded} onSubmit={(event) => submitFields(event, (fields) => actions?.saveConfig?.(fields))}>
    <div className="kordynV2ConfigurationFields">
      <SelectField label="OKX 市场类型" name="OKX_MARKET_TYPE" defaultValue={market} disabled={actionsDisabled || !loaded}><option value="" disabled>请选择权威市场类型</option><option value="perpetual_swap">USDT 永续</option></SelectField>
      <TextField label="服务端端口" name="PORT" type="number" defaultValue={model.port} disabled={actionsDisabled || !loaded} />
      <TextField label="Skill 沙箱镜像" name="SKILL_SANDBOX_IMAGE" defaultValue={model.skillSandboxImage} disabled={actionsDisabled || !loaded} />
    </div>
  </EditorFrame>;
}
