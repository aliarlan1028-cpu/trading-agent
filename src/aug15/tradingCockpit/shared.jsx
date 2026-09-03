import React, { useId } from "react";
import { Bell, Layers3, Settings } from "lucide-react";
import { localizeText } from "../lib.jsx";
import { t } from "../i18n.js";

const DEFAULT_TABS = [
  ["overview", "总览", "Overview"],
  ["market", "行情", "Market"],
  ["positions", "持仓", "Positions"],
  ["execution", "执行与复盘", "Execution & Review"],
  ["ledger", "委托与成交", "Orders & Fills"]
];

const list = (value) => Array.isArray(value) ? value : [];

export function Tone({ children, tone = "neutral", className = "" }) {
  return <span className={`cockpitTone ${tone} ${className}`.trim()}>{children}</span>;
}

export function CockpitMetric({ label, value, detail, tone = "", strong = false }) {
  return <div className={`cockpitMetric ${tone} ${strong ? "strong" : ""}`.trim()} aria-label={`${label}: ${value}`}>
    <small>{label}</small>
    <b>{value}</b>
    {detail && <span>{detail}</span>}
  </div>;
}

export function CockpitPanel({ title, meta, action, className = "", children, region, ariaLabel }) {
  const headingId = useId();
  return <section
    className={`cockpitPanel ${className}`.trim()}
    data-cockpit-region={region}
    aria-labelledby={title ? headingId : undefined}
    aria-label={!title ? ariaLabel : undefined}
  >
    {(title || action) && <header className="cockpitPanelHead">
      <div>{title && <h2 id={headingId}>{title}</h2>}{meta && <span>{meta}</span>}</div>
      {action}
    </header>}
    {children}
  </section>;
}

export function CockpitEmpty({ icon: Icon = Layers3, title, detail }) {
  return <div className="cockpitEmpty" role="status">
    <Icon aria-hidden="true"/>
    <b>{title}</b>
    {detail && <p>{detail}</p>}
  </div>;
}

export function CockpitTable({ columns, rows = [], selectedId, onSelect, emptyTitle, emptyDetail, compact = false, region, label }) {
  if (!rows.length) {
    return <CockpitEmpty
      title={emptyTitle || t("暂无数据", "No data")}
      detail={emptyDetail || t("真实数据产生后会自动显示。", "Real data appears automatically when available.")}
    />;
  }

  return <div className="cockpitTableWrap" data-cockpit-region={region}>
    <table className={`cockpitTable ${compact ? "compact" : ""}`} aria-label={label || t("交易数据", "Trading data")}>
      <thead><tr>{columns.map((column) => <th scope="col" key={column.key}>{column.label}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => {
        const id = row.id || row.orderId || `${row.symbol || "row"}-${index}`;
        const active = selectedId != null && String(id) === String(selectedId);
        const selectableProps = onSelect ? {
          tabIndex: 0,
          "aria-selected": active,
          onClick: () => onSelect(row),
          onKeyDown: (event) => {
            if (["Enter", " "].includes(event.key)) {
              event.preventDefault();
              onSelect(row);
            }
          }
        } : {};
        return <tr key={id} className={active ? "selected" : ""} {...selectableProps}>
          {columns.map((column) => <td key={column.key}>{column.render ? column.render(row) : (row[column.key] ?? "—")}</td>)}
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

export function CockpitHeader({ data, active, onChange, ui, tabs = DEFAULT_TABS, healthLabel, healthTone = "neutral" }) {
  const accounts = list(data.exchangeAccounts);
  const okx = accounts.find((item) => String(item.exchange).toUpperCase() === "OKX") || {};
  const connected = Boolean(okx.connected || okx.tradingAvailable);
  const unread = list(data.notifications).filter((item) => !item.read).length;
  const user = localizeText(data.user?.name || t("账户", "Account"));

  return <header className="cockpitHeader">
    <button type="button" className="cockpitBrand" onClick={() => ui.setActive("chat")} aria-label={t("返回 AI 交易员", "Back to AI Trader")}>
      <img src="/kordyn-logo.svg" alt=""/>
      <span><b>{t("交易驾驶舱", "Trading Cockpit")}</b><small>KORDYN</small></span>
    </button>
    <nav className="cockpitTabs" aria-label={t("交易驾驶舱页面", "Trading cockpit pages")}>
      {tabs.map(([id, zh, en]) => <button
        type="button"
        key={id}
        className={active === id ? "active" : ""}
        aria-current={active === id ? "page" : undefined}
        onClick={() => onChange(id)}
      >{t(zh, en)}</button>)}
    </nav>
    <div className="cockpitHeaderActions">
      <button type="button" className="cockpitSystemStatus" onClick={() => ui.setActive("riskOverview")}>
        <span className={healthTone}/><b>{healthLabel}</b>
      </button>
      <button type="button" className="cockpitExchange" onClick={() => ui.setActive("systemSettings:exchange")}>
        <i className={connected ? "online" : ""}/>
        <span><b>OKX</b><small>{connected ? t("已连接", "Connected") : t("待连接", "Pending")}</small></span>
      </button>
      <button type="button" className="cockpitIconButton" aria-label={t("通知", "Notifications")} onClick={() => ui.setActive("operationsCenter:notifications")}>
        <Bell/>{unread > 0 && <em>{unread > 99 ? "99+" : unread}</em>}
      </button>
      <button type="button" className="cockpitIconButton" aria-label={t("系统设置", "Settings")} onClick={() => ui.setActive("systemSettings")}><Settings/></button>
      <button type="button" className="cockpitAvatar" onClick={() => ui.setActive("systemSettings")} aria-label={t("账户设置", "Account settings")}>
        {data.user?.avatar ? <img src={data.user.avatar} alt=""/> : user.slice(0, 1).toUpperCase()}
      </button>
    </div>
  </header>;
}
