import { ArrowRight, Bell, CheckCheck } from "lucide-react";

export function NotificationWorkspace({ model = {}, actions, actionsDisabled = false, onSelect = () => {} }) {
  const notifications = model.operations?.notifications || model.notifications || {};
  const rows = notifications.items || [];
  return (
    <section className="kordynV2GovernanceWorkspace kordynV2SingleRegistryWorkspace" data-kordyn-v2-governance-workspace="notifications">
      <header className="kordynV2GovernanceTitle"><span><h1>通知</h1><p>投递结果、失败原因与已读状态；不会把发送意图当成送达。</p></span><button type="button" disabled={actionsDisabled || !notifications.unread} onClick={() => actions?.markNotificationsRead?.()}><CheckCheck size={14} />全部标为已读</button></header>
      <section className="kordynV2OperationalRegistry"><header><span><strong>通知证据</strong><small>{notifications.unread || 0} 未读 · {notifications.critical || 0} 失败</small></span><Bell size={18} /></header><div>{rows.map((row) => <button type="button" key={row.id} data-kordyn-v2-object-type="Notification" data-kordyn-v2-object-id={row.id} data-tone={row.tone || "neutral"} onClick={() => onSelect({ id: row.id, type: "Notification", workspaceId: "governance" })}><i /><span><strong>{row.title || row.message || "Notification"}</strong><small>{row.createdAt || "时间不可用"} · {row.source || row.category || "system"}</small></span><em>{row.status || row.severity || (row.read ? "已读" : "未读")}</em><ArrowRight size={16} /></button>)}{!rows.length && <p>当前没有通知记录。</p>}</div></section>
    </section>
  );
}

