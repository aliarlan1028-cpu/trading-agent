import { EditorFrame, SelectField, TextField, submitFields } from "./editorShared.jsx";

export function NotificationEditor({ model = {}, actions, actionsDisabled = false }) {
  const telegram = model.telegram;
  const lark = model.lark || {};
  const loaded = Boolean(telegram && typeof telegram === "object");
  const channel = telegram?.configured ? "telegram" : lark.hasWebhook ? "lark" : "Unavailable";
  return <EditorFrame id="notifications" title="通知" description="Telegram 推送参数与真实投递测试；Bot Token 不回显。" target={channel} current={channel} actionsDisabled={actionsDisabled} submitDisabled={!loaded} onSubmit={(event) => submitFields(event, (fields) => actions?.saveConfig?.(fields))}>
    <div className="kordynV2ConfigurationFields">
      <TextField label="Telegram Chat ID" name="TELEGRAM_CHAT_ID" defaultValue={telegram?.chatId} disabled={actionsDisabled || !loaded} />
      <SelectField label="自动海报推送" name="TELEGRAM_PROFIT_POSTER_ENABLED" defaultValue={telegram?.profitPosterEnabled ? "true" : "false"} disabled={actionsDisabled || !loaded}><option value="true">开启</option><option value="false">关闭</option></SelectField>
      <SelectField label="盯盘推送语言" name="TELEGRAM_WATCH_LANGUAGE" defaultValue={telegram?.watchLanguage || "en"} disabled={actionsDisabled || !loaded}><option value="zh">中文</option><option value="en">English</option></SelectField>
      <TextField label="Telegram Bot Token 替换值" name="TELEGRAM_BOT_TOKEN" type="password" defaultValue="" disabled={actionsDisabled || !loaded} hint={telegram?.hasBotToken ? "已配置；留空保持原值" : "Unavailable；输入后配置"} />
    </div>
    <button className="kordynV2InlineTest" type="button" data-kordyn-v2-config-action="test-notification" disabled={actionsDisabled || channel === "Unavailable"} onClick={() => actions?.testNotification?.(channel)}>发送测试通知</button>
  </EditorFrame>;
}
