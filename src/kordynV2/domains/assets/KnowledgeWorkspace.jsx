import { Upload, Workflow } from "lucide-react";
import { IncubationQueue } from "./IncubationQueue.jsx";
import { KnowledgeEvidenceInspector } from "./KnowledgeEvidenceInspector.jsx";
import { KnowledgeGraph } from "./KnowledgeGraph.jsx";
import { KnowledgeSourceRegistry } from "./KnowledgeSourceRegistry.jsx";

export function KnowledgeWorkspace({ model, actions, actionsDisabled = false, selectedSourceId = "", selectedEvidenceId = "", onSelectSource = () => {}, onSelectEvidence = () => {}, onSelectCandidate = () => {}, onNavigate = () => {} }) {
  const sources = model?.incubation?.sources || [];
  const evidence = model?.incubation?.evidence || [];
  const candidates = model?.incubation?.candidates || [];
  const selectedSource = sources.find((row) => row.id === selectedSourceId) || sources[0] || null;
  return (
    <section className="kordynV2KnowledgeWorkspace" data-kordyn-v2-assets-workspace="knowledge">
      <header className="kordynV2AssetsTitle kordynV2KnowledgeTitle"><span><h1>知识库与孵化器</h1><p>从来源证据到受控策略与能力候选。</p></span><div><button type="button" onClick={() => onNavigate("governance", "configuration")}><Upload size={14} aria-hidden="true" />导入资料</button><button type="button" onClick={() => onNavigate("assets", "knowledge")}><Workflow size={14} aria-hidden="true" />查看处理队列</button></div></header>
      <div className="kordynV2KnowledgeWorkbench">
        <KnowledgeSourceRegistry sources={sources} selectedId={selectedSource?.id || ""} actions={actions} actionsDisabled={actionsDisabled} onSelect={onSelectSource} />
        <div className="kordynV2KnowledgeEvidenceColumn"><KnowledgeEvidenceInspector evidence={evidence.filter((row) => !selectedSource || row.sourceId === selectedSource.id)} selectedId={selectedEvidenceId} sources={sources} onSelect={onSelectEvidence} /><KnowledgeGraph source={selectedSource} evidence={evidence} candidates={candidates} /></div>
        <IncubationQueue candidates={candidates} actions={actions} actionsDisabled={actionsDisabled} onSelect={onSelectCandidate} />
        <section className="kordynV2KnowledgeLifecycle" aria-label="知识资产受控生命周期"><strong>知识到正式资产的受控生命周期</strong><div>{["资料导入", "解析与索引", "证据确认", "候选去重", "Owner 审批", "自动测试", "历史验证", "纯前向", "Registry"].map((stage, index) => <span key={stage} data-complete={index < 4}><b>{index + 1}</b><small>{stage}</small></span>)}</div><p>只有服务端验证通过并完成审批的对象，才会进入策略库或能力库。</p></section>
      </div>
    </section>
  );
}
