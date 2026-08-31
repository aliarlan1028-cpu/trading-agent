import { Play, Plus } from "lucide-react";
import { StrategyInspector } from "./StrategyInspector.jsx";
import { StrategyRegistry } from "./StrategyRegistry.jsx";
import { StrategyStudio } from "./StrategyStudio.jsx";

export function StrategyWorkspace({ model, actions, actionsDisabled = false, selectedStrategyId = "", onSelect = () => {} }) {
  const strategies = model?.strategies || [];
  const selected = strategies.find((row) => row.id === selectedStrategyId) || strategies[0] || null;
  return (
    <section className="kordynV2StrategyWorkspace" data-kordyn-v2-assets-workspace="strategies">
      <header className="kordynV2AssetsTitle kordynV2StrategyTitle">
        <span><h1>策略库</h1><p>系统原生、知识提炼与导入策略的统一版本 Registry。</p></span>
        <div><button type="button" disabled={actionsDisabled} onClick={() => actions?.runStrategyResearch?.()}><Play size={14} aria-hidden="true" />运行自动研究</button><button type="button" onClick={() => document.getElementById("kordyn-v2-strategy-prompt")?.focus()}><Plus size={14} aria-hidden="true" />新建草稿</button></div>
      </header>
      <div className="kordynV2StrategyWorkbench">
        <StrategyRegistry rows={strategies} selectedId={selected?.id || ""} onSelect={onSelect} />
        <StrategyInspector strategy={selected} actions={actions} actionsDisabled={actionsDisabled} onOpenStudio={() => document.getElementById("kordyn-v2-strategy-prompt")?.focus()} />
        <StrategyStudio drafts={model?.studio?.drafts || []} actions={actions} actionsDisabled={actionsDisabled} />
      </div>
    </section>
  );
}
