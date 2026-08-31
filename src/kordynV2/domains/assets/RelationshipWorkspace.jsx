import { AlertTriangle, BookOpen, CircleGauge, Puzzle, RefreshCw } from "lucide-react";
import { RelationshipGraph } from "./RelationshipGraph.jsx";
import { RelationshipInspector } from "./RelationshipInspector.jsx";

const ORIGINS = Object.freeze([
  ["system-native", "系统原生", CircleGauge],
  ["knowledge-derived", "知识派生", BookOpen],
  ["imported", "外部导入", Puzzle],
  ["review", "交易学习", RefreshCw]
]);

export function RelationshipWorkspace({ model, selectedNodeId = "", onSelect = () => {}, onNavigate = () => {} }) {
  const nodes = model?.relationships?.nodes || [];
  const edges = model?.relationships?.edges || [];
  const selected = nodes.find((node) => node.id === selectedNodeId) || nodes.find((node) => node.type === "Strategy") || nodes[0] || null;
  const queue = model?.researchMap?.actionQueue || [];
  const originCount = (kind) => nodes.filter((node) => node.provenance?.kind === kind || (kind === "review" && ["Review", "Lesson", "Owner candidate"].includes(node.type))).length;

  return (
    <section className="kordynV2RelationshipWorkspace" data-kordyn-v2-assets-workspace="relationships">
      <header className="kordynV2AssetsTitle">
        <span><h1>智能资产</h1><p>看清 AI 交易员正在使用什么、为什么使用，以及资产如何经过验证与发布。</p></span>
        <em>Compact account truth · 真实关系</em>
      </header>
      {!nodes.length ? <section className="kordynV2AssetsEmpty" role="status"><strong>暂无已加载关系 · No loaded relationships</strong><p>知识、策略、能力、Mission 或复盘对象加载后才会建立关系；这里不会伪造连接。</p></section> : <div className="kordynV2RelationshipWorkbench">
        <aside className="kordynV2AssetOrigins">
          <header><strong>资产来源</strong><small>{nodes.length} 个真实对象</small></header>
          {ORIGINS.map(([kind, label, Icon]) => <div key={kind} data-origin={kind}>
            <Icon size={17} aria-hidden="true" />
            <span><strong>{label}</strong><small>{originCount(kind)} 项</small></span>
          </div>)}
        </aside>
        <RelationshipGraph nodes={nodes} edges={edges} selectedNodeId={selected?.id || ""} onSelect={onSelect} />
        <aside className="kordynV2RelationshipSide">
          <section className="kordynV2AssetQueue">
            <header><strong>需要推进</strong><small>{queue.reduce((sum, row) => sum + Number(row.count || 0), 0)}</small></header>
            {queue.length ? queue.slice(0, 6).map((row) => <button type="button" key={row.id} onClick={() => {
              const workspaceId = row.destination === "ownerReviewWorkspace" ? "reviews" : "knowledge";
              onNavigate("assets", workspaceId);
            }}>
              <AlertTriangle size={14} aria-hidden="true" />
              <span><strong>{row.label}</strong><small>{row.detail}</small></span>
              <em>{row.count}</em>
            </button>) : <p>当前没有待处理资产动作。</p>}
          </section>
          <RelationshipInspector node={selected} onNavigate={onNavigate} />
        </aside>
      </div>}
    </section>
  );
}
