import { BookOpen, Circle, GitFork, Sparkles } from "lucide-react";

export function KnowledgeGraph({ source = null, evidence = [], candidates = [] }) {
  const relatedEvidence = source ? evidence.filter((row) => row.sourceId === source.id) : [];
  const relatedCandidates = source ? candidates.filter((row) => row.provenance?.sourceId === source.id || row.sourceId === source.id) : [];
  return (
    <section className="kordynV2KnowledgeGraph" data-kordyn-v2-knowledge-graph>
      <header><GitFork size={14} aria-hidden="true" /><strong>关系图</strong><small>来源 / 证据 / 候选</small></header>
      {source ? <div>
        <span data-kind="source"><BookOpen size={15} aria-hidden="true" />{source.title || source.name || source.id}</span>
        <i aria-hidden="true" />
        <section>{relatedEvidence.slice(0, 4).map((row) => <span key={row.id} data-kind="evidence"><Circle size={10} aria-hidden="true" />{row.page ? `p.${row.page}` : row.id}</span>)}</section>
        <i aria-hidden="true" />
        <section>{relatedCandidates.slice(0, 4).map((row) => <span key={row.id} data-kind="candidate"><Sparkles size={11} aria-hidden="true" />{row.title || row.name || row.id}</span>)}</section>
      </div> : <p>选择来源查看显式关系。</p>}
    </section>
  );
}
