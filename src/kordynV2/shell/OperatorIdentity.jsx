import { Bell, UserRound } from "lucide-react";

const unavailable = "Unavailable";
const primitiveText = (value) => (
  (typeof value === "string" || typeof value === "number") && value !== ""
    ? String(value)
    : unavailable
);

export function OperatorIdentity({ identity = {} }) {
  const name = primitiveText(identity.name);
  const notificationCount = Number.isInteger(identity.notificationCount) && identity.notificationCount >= 0
    ? String(identity.notificationCount)
    : unavailable;
  const initials = name === unavailable ? "—" : name.trim().slice(0, 2).toUpperCase();

  return (
    <section className="kordynV2OperatorCluster" aria-label="操作员身份与通知">
      <button
        className="kordynV2Notification"
        data-kordyn-v2-notification
        type="button"
        disabled
        aria-label={`通知数量：${notificationCount}；通知中心：${unavailable}`}
      >
        <Bell size={19} strokeWidth={1.7} aria-hidden="true" />
        <span>{notificationCount}</span>
      </button>
      <div
        className="kordynV2OperatorIdentity"
        data-kordyn-v2-identity
        role="group"
        aria-label={`当前操作员：${name}；身份菜单：${unavailable}`}
      >
        <span className="kordynV2OperatorAvatar" aria-hidden="true">
          {initials === "—" ? <UserRound size={17} /> : initials}
        </span>
      </div>
    </section>
  );
}
