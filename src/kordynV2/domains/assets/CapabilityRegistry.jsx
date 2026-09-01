import { ChevronRight, Link2, Puzzle, Server, Workflow } from "lucide-react";

const iconFor = (row) => row.category === "mcp" ? Server : row.category === "workflow" ? Workflow : row.connector ? Link2 : Puzzle;
const text = (value, fallback = "Unavailable") => value === null || value === undefined || value === "" ? fallback : String(value);

export function CapabilityRegistry({ rows = [], selectedId = "", onSelect = () => {} }) {
  return (
    <section className="kordynV2CapabilityRegistry" data-kordyn-v2-capability-registry>
      <header><span>能力</span><span>类型与来源</span><span>权限影响</span><span>当前版本</span><span>健康</span><span>近 24h 调用</span></header>
      <div>{rows.map((row) => {
        const Icon = iconFor(row);
        return <button type="button" key={row.id} data-kordyn-v2-capability-id={row.id} data-kordyn-v2-object-id={row.id} data-kordyn-v2-object-type="Capability" data-provenance={row.provenance?.kind} data-selected={row.id === selectedId} onClick={() => onSelect(row)}><span><Icon size={15} aria-hidden="true" /><strong>{text(row.name)}</strong></span><em>{text(row.category)} · {text(row.provenance?.label)}</em><span>{text(row.permission || row.requiredPermission)}</span><code>{text(row.version)}</code><b data-health={row.health}>{text(row.health)}</b><span>{text(row.calls)}</span><ChevronRight size={14} aria-hidden="true" /></button>;
      })}{!rows.length && <p>暂无已注册能力 · No registered capabilities</p>}</div>
    </section>
  );
}
