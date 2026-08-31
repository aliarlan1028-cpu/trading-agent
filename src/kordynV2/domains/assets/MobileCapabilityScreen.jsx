import { ChevronRight, Puzzle, ShieldCheck } from "lucide-react";
import { CapabilityInspector } from "./CapabilityInspector.jsx";

export function MobileCapabilityScreen({ model, actions, actionsDisabled = false, selectedCapabilityId = "", onSelect = () => {}, onNavigate = () => {} }) {
  const rows = model?.capabilities || [];
  const selected = rows.find((row) => row.id === selectedCapabilityId) || rows[0] || null;
  return (
    <section className="kordynV2AssetsMobile kordynV2MobileCapabilities" data-kordyn-v2-assets-mobile="capabilities">
      <header><h2>能力库</h2><p>能力身份、权限、健康与调用证据</p></header>
      <section className="kordynV2MobileCapabilityBoundary"><ShieldCheck size={17} aria-hidden="true" />未知工具默认拒绝 · 已声明授权才可调用</section>
      <section className="kordynV2MobileCapabilityRows" data-kordyn-v2-mobile-capability-flow>{rows.map((row) => <button type="button" key={row.id} data-selected={row.id === selected?.id} onClick={() => onSelect(row)}><Puzzle size={20} aria-hidden="true" /><span><em>{row.provenance?.label || "Unavailable"}</em><strong>{row.name}</strong><small>{row.health} · {row.calls ?? "Unavailable"} calls</small></span><ChevronRight size={18} aria-hidden="true" /></button>)}</section>
      <section className="kordynV2MobileCapabilityDetail" data-kordyn-v2-mobile-grant-flow><i aria-hidden="true" /><CapabilityInspector capability={selected} actions={actions} actionsDisabled={actionsDisabled} onNavigate={onNavigate} compact /></section>
    </section>
  );
}
