import { ArrowDown, Bot, BookOpen, ChevronRight, CircleGauge, Puzzle, RefreshCw, Sparkles } from "lucide-react";
import { RelationshipInspector } from "./RelationshipInspector.jsx";

const TYPE_ORDER = Object.freeze(["Mission", "Strategy", "Capability", "Knowledge source", "Review", "Candidate", "Lesson", "Owner candidate"]);
const META = Object.freeze({
  Mission: [Bot, "AI Mission", "mission"],
  Strategy: [CircleGauge, "Strategy", "strategy"],
  Capability: [Puzzle, "Capability", "capability"],
  "Knowledge source": [BookOpen, "Knowledge", "knowledge"],
  Review: [RefreshCw, "Review", "review"],
  Candidate: [Sparkles, "Candidate", "knowledge"],
  Lesson: [BookOpen, "Lesson", "review"],
  "Owner candidate": [Sparkles, "Owner", "review"]
});

function orderedNodes(nodes) {
  return nodes.slice().sort((left, right) => TYPE_ORDER.indexOf(left.type) - TYPE_ORDER.indexOf(right.type));
}

function relationFor(node, edges) {
  const edge = edges.find((row) => row.from === node.id) || edges.find((row) => row.to === node.id);
  return edge?.relation || "related object";
}

export function MobileRelationshipScreen({ model, selectedNodeId = "", onSelect = () => {}, onNavigate = () => {} }) {
  const nodes = orderedNodes(model?.relationships?.nodes || []);
  const edges = model?.relationships?.edges || [];
  const selected = nodes.find((node) => node.id === selectedNodeId) || nodes[0] || null;
  const queue = model?.researchMap?.actionQueue || [];

  return (
    <section className="kordynV2AssetsMobile" data-kordyn-v2-assets-mobile="relationships">
      <header><h2>智能资产</h2><p>AI 交易员正在使用什么，以及为什么</p></header>
      {!nodes.length ? <section className="kordynV2AssetsEmpty" role="status"><strong>暂无已加载关系 · No loaded relationships</strong><p>当前来源没有可验证的对象关系。</p></section> : <>
        <div className="kordynV2MobileRelationshipThread" data-kordyn-v2-relationship-thread>
          {nodes.map((node) => {
            const [Icon, label, tone] = META[node.type] || [Sparkles, node.type, "neutral"];
            return <div key={node.id} className="kordynV2MobileRelationshipStep" data-kordyn-v2-mobile-relation={node.id} data-asset-tone={tone}>
              <i><Icon size={23} aria-hidden="true" /></i>
              <small><ArrowDown size={12} aria-hidden="true" />{relationFor(node, edges)}</small>
              <button type="button" data-kordyn-v2-object-type={node.type} data-kordyn-v2-object-id={node.objectId} data-selected={node.id === selected?.id} onClick={() => onSelect(node)}>
                <span><em>{label}</em><strong>{node.label}</strong></span>
                <b>{node.status}</b>
                <ChevronRight size={19} aria-hidden="true" />
              </button>
            </div>;
          })}
        </div>
        {queue.length > 0 && <section className="kordynV2MobileAssetQueue">
          <header><strong>需要处理 {queue.reduce((sum, row) => sum + Number(row.count || 0), 0)}</strong><small>按优先级</small></header>
          {queue.slice(0, 3).map((row) => <button type="button" key={row.id} onClick={() => onNavigate("assets", row.destination === "ownerReviewWorkspace" ? "reviews" : "knowledge")}>
            <span><strong>{row.label}</strong><small>{row.detail}</small></span><em>{row.count}</em><ChevronRight size={18} aria-hidden="true" />
          </button>)}
        </section>}
        <section className="kordynV2MobileAssetDetail" data-kordyn-v2-mobile-object-detail={selected?.id || "none"}>
          <i aria-hidden="true" />
          <RelationshipInspector node={selected} onNavigate={onNavigate} compact />
        </section>
      </>}
    </section>
  );
}
