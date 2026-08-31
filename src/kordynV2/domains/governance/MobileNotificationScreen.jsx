import { ArrowRight, CheckCheck } from "lucide-react";

export function MobileNotificationScreen({ model = {}, actions, actionsDisabled = false, onSelect = () => {} }) {
  const notifications = model.operations?.notifications || {};
  return <section className="kordynV2GovernanceMobile" data-kordyn-v2-governance-mobile="notifications"><header><h2>通知</h2><p>送达事实与失败恢复</p></header><button className="kordynV2MobilePrimary" type="button" disabled={actionsDisabled || !notifications.unread} onClick={() => actions?.markNotificationsRead?.()}><CheckCheck size={18} />全部标为已读</button><section className="kordynV2MobileGovernanceList">{(notifications.items || []).map((row) => <button type="button" key={row.id} data-kordyn-v2-object-type="Notification" data-kordyn-v2-object-id={row.id} onClick={() => onSelect({ id: row.id, type: "Notification", workspaceId: "governance" })}><i data-tone={row.tone} /><span><strong>{row.title || row.message}</strong><small>{row.createdAt || "时间不可用"}</small></span><em>{row.severity || (row.read ? "已读" : "未读")}</em><ArrowRight size={16} /></button>)}</section></section>;
}

