import { BookOpen, ChevronRight, Sparkles } from "lucide-react";
import { IncubationQueue } from "./IncubationQueue.jsx";
import { KnowledgeEvidenceInspector } from "./KnowledgeEvidenceInspector.jsx";

export function MobileKnowledgeScreen({ model, actions, actionsDisabled = false, selectedSourceId = "", selectedEvidenceId = "", onSelectSource = () => {}, onSelectEvidence = () => {}, onSelectCandidate = () => {} }) {
  const sources = model?.incubation?.sources || [];
  const evidence = model?.incubation?.evidence || [];
  const candidates = model?.incubation?.candidates || [];
  const selected = sources.find((row) => row.id === selectedSourceId) || sources[0] || null;
  return (
    <section className="kordynV2AssetsMobile kordynV2MobileKnowledge" data-kordyn-v2-assets-mobile="knowledge">
      <header><h2>知识库</h2><p>来源、原文证据与受控孵化</p></header>
      <section className="kordynV2MobileKnowledgeSources" data-kordyn-v2-mobile-source-flow><header><strong>来源</strong><small>{sources.length}</small></header>{sources.map((source) => <button type="button" key={source.id} data-selected={source.id === selected?.id} onClick={() => onSelectSource(source)}><BookOpen size={20} aria-hidden="true" /><span><strong>{source.title || source.name}</strong><small>{source.type || "Unavailable"} · {source.lifecycle?.label}</small></span><ChevronRight size={18} aria-hidden="true" /></button>)}</section>
      <KnowledgeEvidenceInspector evidence={evidence.filter((row) => !selected || row.sourceId === selected.id)} selectedId={selectedEvidenceId} sources={sources} onSelect={onSelectEvidence} />
      <section data-kordyn-v2-mobile-candidate-flow><header className="kordynV2MobileFlowTitle"><Sparkles size={16} aria-hidden="true" /><strong>候选孵化</strong></header><IncubationQueue candidates={candidates} actions={actions} actionsDisabled={actionsDisabled} onSelect={onSelectCandidate} /></section>
    </section>
  );
}
