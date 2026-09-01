import { ChevronRight, Star } from "lucide-react";

const text = (value, fallback = "Unavailable") => value === null || value === undefined || value === "" ? fallback : String(value);

export function strategySelectionCandidate(row) {
  if (row?.recordType === "product") return { id: row.versionId, type: "Strategy product", workspaceId: "assets" };
  if (row?.recordType === "research") return { id: String(row.id || "").replace(/^native_/u, ""), type: "Strategy", workspaceId: "assets" };
  return { id: row?.id, type: "Strategy", workspaceId: "assets" };
}

export function StrategyRegistry({ rows = [], selectedId = "", onSelect = () => {} }) {
  return (
    <section className="kordynV2StrategyRegistry" data-kordyn-v2-strategy-registry>
      <header className="kordynV2StrategyRegistryHeader" role="row">
        <span>策略产品</span><span>来源</span><span>当前版本</span><span>适用范围</span><span>验证阶段</span><span>运行状态</span>
      </header>
      <div role="rowgroup">
        {rows.map((row, index) => {
          const candidate = strategySelectionCandidate(row);
          return <button
          type="button"
          role="row"
          key={row.id}
          data-kordyn-v2-strategy-id={row.id}
          data-kordyn-v2-object-id={candidate.id}
          data-kordyn-v2-object-type={candidate.type}
          data-provenance={row.provenance?.kind || "unknown"}
          data-selected={row.id === selectedId}
          onClick={() => onSelect(row)}
        >
          <span role="cell"><Star size={14} fill={index === 0 ? "currentColor" : "none"} aria-hidden="true" /><strong>{text(row.name)}</strong></span>
          <em role="cell">{text(row.provenance?.label)}</em>
          <code role="cell">{text(row.versionId || row.version)}</code>
          <span role="cell">{text(row.timeframe || row.direction)}</span>
          <b role="cell" data-stage={row.lifecycle?.stage}>{text(row.evidenceStatus || row.lifecycle?.stage)}</b>
          <span role="cell" data-status={row.lifecycle?.stage}>{text(row.status)}</span>
          <ChevronRight size={15} aria-hidden="true" />
        </button>;
        })}
        {!rows.length && <p role="status">暂无正式策略 · No registered strategies</p>}
      </div>
      <footer><span>共 {rows.length} 条策略</span><small>正式 Registry 不包含尚未毕业的知识候选</small></footer>
    </section>
  );
}
