import { BookOpen, ChevronRight, FileText, Globe2, RefreshCw } from "lucide-react";

const iconFor = (type) => /web|url/i.test(String(type)) ? Globe2 : /book|pdf|doc/i.test(String(type)) ? BookOpen : FileText;
const text = (value, fallback = "Unavailable") => value === null || value === undefined || value === "" ? fallback : String(value);

export function KnowledgeSourceRegistry({ sources = [], selectedId = "", actions, actionsDisabled = false, onSelect = () => {} }) {
  return (
    <section className="kordynV2KnowledgeSources">
      <header><strong>来源登记簿</strong><small>{sources.length} 来源</small></header>
      <div>
        {sources.map((source) => {
          const Icon = iconFor(source.type);
          const failed = source.lifecycle?.stage === "failed";
          return <article key={source.id} data-kordyn-v2-knowledge-source={source.id} data-source-stage={source.lifecycle?.stage} data-selected={source.id === selectedId}>
            <button type="button" className="kordynV2KnowledgeSourceSelect" data-kordyn-v2-object-id={source.id} data-kordyn-v2-object-type="Knowledge" onClick={() => onSelect(source)}>
              <Icon size={20} aria-hidden="true" /><span><strong>{text(source.title || source.name)}</strong><small>{text(source.type)} · {text(source.lifecycle?.label)}</small></span><ChevronRight size={16} aria-hidden="true" />
            </button>
            <dl><div><dt>更新时间</dt><dd>{text(source.updatedAt || source.createdAt)}</dd></div><div><dt>解析版本</dt><dd>{text(source.parserVersion)}</dd></div></dl>
            <footer>
              <button type="button" disabled={actionsDisabled} onClick={() => actions?.parseSource?.(source.id)}><RefreshCw size={13} aria-hidden="true" />{failed ? "重试解析" : "重新解析"}</button>
              <button type="button" disabled={actionsDisabled || failed} onClick={() => actions?.convertSource?.(source.id, source.title || source.name)}>生成候选</button>
            </footer>
          </article>;
        })}
        {!sources.length && <p>暂无知识来源 · No knowledge sources</p>}
      </div>
    </section>
  );
}
