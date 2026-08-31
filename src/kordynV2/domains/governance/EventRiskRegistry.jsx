import { CalendarClock, ChevronRight, Globe2 } from "lucide-react";

const list = (value) => Array.isArray(value) ? value : [];
const scope = (row) => row.marketWide ? "全市场" : list(row.relatedSymbols).join(" · ") || "影响范围不可用";

export function EventRiskRegistry({ rows = [], selectedId = "", onSelect = () => {} }) {
  return (
    <section className="kordynV2EventRiskRegistry" aria-labelledby="kordyn-v2-event-window-title">
      <header><span><strong id="kordyn-v2-event-window-title">事件窗口</strong><small>事件事实、影响资产与确定性阻断</small></span><em>{rows.length}</em></header>
      <div>
        {rows.map((row, index) => {
          const id = row.id || row.eventId || `event-${index}`;
          return <button type="button" key={id} data-kordyn-v2-object-type="Event" data-kordyn-v2-object-id={id} data-selected={id === selectedId} onClick={() => onSelect({ id, type: "Event", workspaceId: "governance" })}>
            <i>{row.marketWide ? <Globe2 size={18} /> : <CalendarClock size={18} />}</i>
            <span><strong>{row.title || row.name || "Event"}</strong><small>{row.dueAt || row.startsAt || "时间不可用"} · {scope(row)}</small></span>
            <em data-tone={row.blocking ? "critical" : "warning"}>{row.blocking ? "阻断新风险" : "监控"}</em>
            <ChevronRight size={16} aria-hidden="true" />
          </button>;
        })}
        {!rows.length && <p>当前没有已加载事件窗口。</p>}
      </div>
    </section>
  );
}

