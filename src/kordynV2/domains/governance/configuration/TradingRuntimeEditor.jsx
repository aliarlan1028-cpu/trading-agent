import { EditorFrame, SelectField, TextField, submitFields } from "./editorShared.jsx";

const numberWhenPresent = (value) => value === "" || value === null || value === undefined ? undefined : Number(value);

export function TradingRuntimeEditor({ model = {}, actions, actionsDisabled = false, onDirtyChange }) {
  const mode = model.mode || {};
  const limit = model.maxNotionalUsdt || {};
  const mandate = model.mandate || {};
  const mandatePayload = (event) => {
    const fields = Object.fromEntries(new FormData(event.currentTarget.form).entries());
    return {
      id: mandate.id,
      allowedSymbols: String(fields.allowedSymbols || "").split(",").map((value) => value.trim()).filter(Boolean),
      maxLeverage: numberWhenPresent(fields.maxLeverage),
      maxOrderNotionalUsdt: numberWhenPresent(fields.maxOrderNotionalUsdt)
    };
  };
  const selectedMode = ["observe", "semi_auto", "full_auto"].includes(mode.selected) ? mode.selected : "Unavailable";
  return <EditorFrame
    id="trading"
    title="交易授权"
    description="定义交易执行的授权边界，市场面与自动化约束。"
    target={mode.selected || "Unavailable"}
    current={mode.effective || "Unavailable"}
    actionsDisabled={actionsDisabled}
    submitDisabled={selectedMode === "Unavailable"}
    actionId="save-live-trading"
    onDirtyChange={onDirtyChange}
    onSubmit={(event) => submitFields(event, (fields) => actions?.saveLiveTrading?.({
      requestedMode: fields.mode,
      acknowledged: fields.acknowledged === "true",
      maxNotionalUsdt: numberWhenPresent(fields.maxNotionalUsdt)
    }), { includeAll: true })}
  >
    <div className="kordynV2ConfigurationFields kordynV2ConfigurationSettingsMatrix">
      <SelectField label="1　运行方式" name="mode" defaultValue={selectedMode} disabled={actionsDisabled || selectedMode === "Unavailable"}>
        {selectedMode === "Unavailable" && <option value="" disabled>等待权威运行模式</option>}
        <option value="observe">观察 / 暂停新开仓</option>
        <option value="semi_auto">半自动</option>
        <option value="full_auto">自动交易</option>
      </SelectField>
      <label className="kordynV2EffectiveField"><span>当前生效 · Effective now</span><output data-kordyn-v2-effective-value={mode.effective || "Unavailable"}>{mode.effective || "Unavailable"}</output><small>只读；由服务端运行事实决定</small></label>
      <TextField label="2　实盘验证单笔上限 (USDT)" name="maxNotionalUsdt" type="number" defaultValue={limit.selected} disabled={actionsDisabled} hint={`当前生效 ${limit.effective ?? "Unavailable"} USDT`} />
      <label className="kordynV2ConfigAcknowledgement"><input type="checkbox" name="acknowledged" value="true" data-initial-value="" disabled={actionsDisabled} /><span>我确认该目标可能允许真实订单；服务端仍会执行全部硬风控。</span></label>
    </div>
    <section className="kordynV2MandateEditor">
      <header><span><strong>Mandate · 交易授权</strong><small>{mandate.id || "尚无已加载授权"}</small></span><em>{mandate.status || "Unavailable"}</em></header>
      <div className="kordynV2ConfigurationFields">
        <TextField label="3　允许市场（逗号分隔）" name="allowedSymbols" defaultValue={(mandate.allowedSymbols || []).join(", ")} disabled={actionsDisabled} />
        <TextField label="4　最大杠杆" name="maxLeverage" type="number" defaultValue={mandate.maxLeverage} disabled={actionsDisabled} />
        <TextField label="5　单笔授权上限 (USDT)" name="maxOrderNotionalUsdt" type="number" defaultValue={mandate.maxOrderNotionalUsdt} disabled={actionsDisabled} />
      </div>
      <div className="kordynV2ConfigInlineActions"><button type="button" data-kordyn-v2-config-action="save-mandate" disabled={actionsDisabled || !mandate.id} onClick={(event) => actions?.saveMandate?.(mandatePayload(event))}>保存 Mandate</button><button type="button" data-kordyn-v2-config-action="activate-mandate" disabled={actionsDisabled || !mandate.id} onClick={() => actions?.activateMandate?.(mandate.id)}>验证并激活</button></div>
    </section>
  </EditorFrame>;
}
