import { AlertTriangle, Check, ChevronRight, CircleSlash2 } from "lucide-react";

export function ReadinessChain({ rows = [], blockers = [], onNavigate = () => {} }) {
  const items = rows.length ? rows : [{ id: "unavailable", label: "就绪证据不可用", ok: false }];
  return (
    <section className="kordynV2ReadinessChain" aria-labelledby="kordyn-v2-readiness-title">
      <header><span><strong id="kordyn-v2-readiness-title">就绪链路</strong><small>任一未通过将阻止新增风险</small></span><em>{items.filter((row) => row.ok).length}/{items.length}</em></header>
      <div>
        {items.map((row, index) => <button type="button" key={row.id || index} data-readiness-state={row.ok ? "passed" : "blocked"} onClick={() => row.route && onNavigate("governance", row.route === "riskCenter" ? "overview" : "configuration")}>
          <i>{row.ok ? <Check size={14} aria-hidden="true" /> : <CircleSlash2 size={14} aria-hidden="true" />}</i>
          <span><strong>{row.label || row.labelEn || "Unavailable"}</strong><small>{row.ok ? "已验证 · Verified" : "未通过 · Blocking"}</small></span>
          <ChevronRight size={14} aria-hidden="true" />
        </button>)}
      </div>
      {blockers.length > 0 && <footer><AlertTriangle size={14} aria-hidden="true" /><span><strong>链路中断</strong><small>{blockers[0].label || blockers[0].code || "Unavailable"}</small></span></footer>}
    </section>
  );
}

