import { ChevronRight, CircleGauge } from "lucide-react";
import { StrategyInspector } from "./StrategyInspector.jsx";
import { StrategyStudio } from "./StrategyStudio.jsx";
import { strategySelectionCandidate } from "./StrategyRegistry.jsx";

export function MobileStrategyScreen({ model, actions, actionsDisabled = false, selectedStrategyId = "", onSelect = () => {} }) {
  const rows = model?.strategies || [];
  const selected = rows.find((row) => row.id === selectedStrategyId) || rows[0] || null;
  return (
    <section className="kordynV2AssetsMobile kordynV2MobileStrategies" data-kordyn-v2-assets-mobile="strategies">
      <header><h2>策略库</h2><p>正式版本、验证证据和 AI 可用状态</p></header>
      <section className="kordynV2MobileStrategyRegistry">
        <header><strong>正式 Registry</strong><small>{rows.length} 条</small></header>
        {rows.map((row) => { const candidate = strategySelectionCandidate(row); return <button type="button" key={row.id} data-kordyn-v2-object-id={candidate.id} data-kordyn-v2-object-type={candidate.type} data-selected={row.id === selected?.id} data-provenance={row.provenance?.kind} onClick={() => onSelect(row)}><CircleGauge size={20} aria-hidden="true" /><span><em>{row.provenance?.label || "Unavailable"}</em><strong>{row.name}</strong><small>{row.versionId || row.version || "Unavailable"} · {row.lifecycle?.stage}</small></span><ChevronRight size={19} aria-hidden="true" /></button>; })}
      </section>
      <section className="kordynV2MobileStrategyDetail" data-kordyn-v2-mobile-strategy-detail={selected?.id || "none"}>
        <i aria-hidden="true" />
        <StrategyInspector strategy={selected} actions={actions} actionsDisabled={actionsDisabled} compact />
      </section>
      <section data-kordyn-v2-mobile-strategy-validation>
        <StrategyStudio drafts={model?.studio?.drafts || []} actions={actions} actionsDisabled={actionsDisabled} />
      </section>
    </section>
  );
}
