import { Activity, Plus, ShieldCheck } from "lucide-react";
import { CapabilityInspector } from "./CapabilityInspector.jsx";
import { CapabilityRegistry } from "./CapabilityRegistry.jsx";

export function CapabilityWorkspace({ model, actions, actionsDisabled = false, selectedCapabilityId = "", onSelect = () => {}, onNavigate = () => {} }) {
  const capabilities = model?.capabilities || [];
  const selected = capabilities.find((row) => row.id === selectedCapabilityId) || capabilities[0] || null;
  return (
    <section className="kordynV2CapabilityWorkspace" data-kordyn-v2-assets-workspace="capabilities">
      <header className="kordynV2AssetsTitle kordynV2CapabilityTitle"><span><h1>能力库</h1><p>AI 交易员可调用能力的可信 Registry。</p></span><div><button type="button" onClick={() => onNavigate("governance", "runs")}><Activity size={14} aria-hidden="true" />运行健康检查</button><button type="button" onClick={() => onNavigate("governance", "configuration")}><Plus size={14} aria-hidden="true" />申请接入</button></div></header>
      <section className="kordynV2CapabilityBoundary"><ShieldCheck size={15} aria-hidden="true" />未知工具默认拒绝 · 所有调用都经过权限、预检与审计</section>
      <div className="kordynV2CapabilityWorkbench"><CapabilityRegistry rows={capabilities} selectedId={selected?.id || ""} onSelect={onSelect} /><CapabilityInspector capability={selected} actions={actions} actionsDisabled={actionsDisabled} onNavigate={onNavigate} /></div>
    </section>
  );
}
