import { EditorFrame, SelectField, TextField, submitFields } from "./editorShared.jsx";

export function TradingRuntimeEditor({ model = {}, actions, actionsDisabled = false }) {
  const mode = model.mode || {};
  const limit = model.maxNotionalUsdt || {};
  return <EditorFrame id="trading" title="交易授权" description="运行模式与交易授权边界；保存目标不会冒充当前生效。" target={mode.selected} current={mode.effective} actionsDisabled={actionsDisabled} onSubmit={(event) => submitFields(event, (fields) => actions?.saveConfig?.({ requestedMode: fields.mode, maxNotionalUsdt: Number(fields.maxNotionalUsdt) }))}><div className="kordynV2ConfigurationFields"><SelectField label="保存目标 · Selected target" name="mode" defaultValue={mode.selected} disabled={actionsDisabled}><option value="observe">观察 / 暂停新开仓</option><option value="semi_auto">半自动</option><option value="full_auto">自动交易</option></SelectField><label className="kordynV2EffectiveField"><span>当前生效 · Effective now</span><output data-kordyn-v2-effective-value={mode.effective}>{mode.effective || "Unavailable"}</output><small>只读；由服务端运行事实决定</small></label><TextField label="单笔目标上限 (USDT)" name="maxNotionalUsdt" type="number" defaultValue={limit.selected} disabled={actionsDisabled} hint={`当前生效 ${limit.effective ?? "Unavailable"} USDT`} /></div></EditorFrame>;
}

