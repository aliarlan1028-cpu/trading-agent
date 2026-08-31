import { ArrowUpRight, ShieldCheck } from "lucide-react";

const ROUTES = Object.freeze({
  Mission: ["ai", "missions", "AI Mission"],
  Strategy: ["assets", "strategies", "策略库 · Open strategy registry"],
  "Knowledge source": ["assets", "knowledge", "知识库 · Open knowledge incubator"],
  Candidate: ["assets", "knowledge", "知识孵化队列 · Open incubation queue"],
  Capability: ["assets", "capabilities", "能力库 · Open capability registry"],
  Review: ["assets", "reviews", "复盘与发布 · Open review workspace"],
  Lesson: ["assets", "reviews", "复盘与发布 · Open review workspace"],
  "Owner candidate": ["assets", "reviews", "Owner 决策队列 · Open Owner queue"]
});

const value = (input) => input === null || input === undefined || input === "" ? "Unavailable" : String(input);

export function RelationshipInspector({ node = null, onNavigate = () => {}, compact = false }) {
  if (!node) return <aside className="kordynV2RelationshipInspector is-empty"><strong>选择一个对象</strong><p>查看来源、状态、版本和权威工作区。</p></aside>;
  const [domainId, workspaceId, actionLabel] = ROUTES[node.type] || ["assets", "relationships", "查看关系 · Open relationships"];
  const raw = node.raw || {};
  return (
    <aside
      className={`kordynV2RelationshipInspector${compact ? " is-compact" : ""}`}
      data-kordyn-v2-relationship-inspector={node.id}
    >
      <header>
        <span><small>{node.type}</small><strong>{node.label}</strong></span>
        <em data-asset-stage={node.status}>{node.status}</em>
      </header>
      <div className="kordynV2RelationshipProvenance">
        <ShieldCheck size={16} aria-hidden="true" />
        <span><small>来源</small><strong>{node.provenance?.label || "Unavailable"}</strong></span>
      </div>
      <dl>
        <div><dt>对象 ID</dt><dd>{value(node.objectId)}</dd></div>
        <div><dt>版本</dt><dd>{value(raw.version || raw.versionId || raw.revision)}</dd></div>
        <div><dt>来源对象</dt><dd>{value(node.provenance?.sourceTitle || node.provenance?.sourceId)}</dd></div>
        <div><dt>验证 / 状态</dt><dd>{value(raw.evidenceStatus || raw.validation?.status || raw.status || raw.state)}</dd></div>
      </dl>
      <button
        type="button"
        data-kordyn-v2-authoritative-workspace={workspaceId}
        onClick={() => onNavigate(domainId, workspaceId)}
      >{actionLabel}<ArrowUpRight size={15} aria-hidden="true" /></button>
    </aside>
  );
}
