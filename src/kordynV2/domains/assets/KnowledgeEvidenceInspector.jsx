import { BookOpen, Link2, Quote } from "lucide-react";

const text = (value, fallback = "Unavailable") => value === null || value === undefined || value === "" ? fallback : String(value);

export function KnowledgeEvidenceInspector({ evidence = [], selectedId = "", sources = [], onSelect = () => {} }) {
  const selected = evidence.find((row) => row.id === selectedId) || evidence[0] || null;
  const source = sources.find((row) => row.id === selected?.sourceId);
  return (
    <section className="kordynV2KnowledgeEvidence">
      <header><span><strong>原文证据</strong><small>引用保持来源与页码</small></span><em>{evidence.length}</em></header>
      <div className="kordynV2KnowledgeEvidenceBody">
        <nav aria-label="证据列表">{evidence.map((row) => <button type="button" key={row.id} data-kordyn-v2-evidence-id={row.id} data-selected={row.id === selected?.id} onClick={() => onSelect(row)}><BookOpen size={13} aria-hidden="true" /><span><strong>{text(row.text).slice(0, 64)}</strong><small>{text(row.page ? `p.${row.page}` : row.location)}</small></span></button>)}</nav>
        <article>{selected ? <>
          <dl><div><dt>来源</dt><dd>{text(source?.title || selected.sourceId)}</dd></div><div><dt>页码</dt><dd>{text(selected.page)}</dd></div><div><dt>证据类型</dt><dd>{text(selected.type || "source_excerpt")}</dd></div></dl>
          <blockquote><Quote size={16} aria-hidden="true" />{text(selected.text || selected.content)}</blockquote>
          <p><Link2 size={13} aria-hidden="true" />原文证据只作为研究依据，不等于可执行规则。</p>
        </> : <p>选择证据查看来源内容。</p>}</article>
      </div>
    </section>
  );
}
