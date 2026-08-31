import { Bot, BookOpen, CircleGauge, FileSearch, FlaskConical, Puzzle, RefreshCw, Sparkles } from "lucide-react";

const TYPE_ORDER = Object.freeze([
  "Knowledge source", "Candidate", "Strategy", "Capability", "Mission", "Review", "Lesson", "Owner candidate"
]);
const TYPE_META = Object.freeze({
  "Knowledge source": { label: "知识证据", icon: BookOpen, tone: "knowledge" },
  Candidate: { label: "孵化候选", icon: FlaskConical, tone: "knowledge" },
  Strategy: { label: "策略", icon: CircleGauge, tone: "strategy" },
  Capability: { label: "能力", icon: Puzzle, tone: "capability" },
  Mission: { label: "AI Mission", icon: Bot, tone: "mission" },
  Review: { label: "交易复盘", icon: RefreshCw, tone: "review" },
  Lesson: { label: "候选教训", icon: FileSearch, tone: "review" },
  "Owner candidate": { label: "Owner 优化", icon: Sparkles, tone: "review" }
});

const TYPE_POINTS = Object.freeze({
  "Knowledge source": [9, 36],
  Candidate: [30, 64],
  Strategy: [43, 23],
  Capability: [43, 72],
  Mission: [70, 47],
  Review: [90, 28],
  Lesson: [90, 57],
  "Owner candidate": [90, 82]
});

function groupedNodes(nodes) {
  return TYPE_ORDER.map((type) => ({ type, rows: nodes.filter((node) => node.type === type) }))
    .filter((group) => group.rows.length);
}

function coordinates(nodes) {
  const result = new Map();
  for (const group of groupedNodes(nodes)) {
    const [x, center] = TYPE_POINTS[group.type] || [50, 50];
    const spacing = Math.min(16, 44 / Math.max(group.rows.length, 1));
    group.rows.forEach((node, index) => {
      const y = center + (index - (group.rows.length - 1) / 2) * spacing;
      result.set(node.id, [x, y]);
    });
  }
  return result;
}

export function RelationshipGraph({ nodes = [], edges = [], selectedNodeId = "", onSelect = () => {} }) {
  const groups = groupedNodes(nodes);
  const points = coordinates(nodes);
  return (
    <section className="kordynV2RelationshipGraph" aria-label="智能资产关系拓扑">
      <header>
        <span><strong>真实关系路径</strong><small>只显示当前已加载对象之间的显式连接</small></span>
        <em>{nodes.length} 对象 · {edges.length} 关系</em>
      </header>
      <div className="kordynV2RelationshipMap" data-kordyn-v2-relationship-graph>
        <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
          {edges.map((edge) => {
            const from = points.get(edge.from);
            const to = points.get(edge.to);
            if (!from || !to) return null;
            const bend = (from[0] + to[0]) / 2;
            return <path
              key={edge.id}
              d={`M ${from[0]} ${from[1]} C ${bend} ${from[1]}, ${bend} ${to[1]}, ${to[0]} ${to[1]}`}
              data-kordyn-v2-relation={edge.id}
              data-relation-kind={edge.relation}
            />;
          })}
        </svg>
        <div className="kordynV2RelationshipGroups">
          {groups.map((group) => <section key={group.type} data-asset-column={TYPE_META[group.type]?.tone || "neutral"}>
            <small>{TYPE_META[group.type]?.label || group.type}</small>
            <div>{group.rows.map((node) => {
              const Icon = TYPE_META[node.type]?.icon || Sparkles;
              return <button
                type="button"
                key={node.id}
                data-kordyn-v2-object-type={node.type}
                data-kordyn-v2-object-id={node.objectId}
                data-selected={node.id === selectedNodeId}
                onClick={() => onSelect(node)}
              >
                <Icon size={16} aria-hidden="true" />
                <span><strong>{node.label}</strong><small>{node.provenance?.label || "Unavailable"} · {node.status}</small></span>
              </button>;
            })}</div>
          </section>)}
        </div>
      </div>
      <footer aria-label="关系图例">
        <span data-legend="direct"><i />直接使用</span>
        <span data-legend="knowledge"><i />知识与证据</span>
        <span data-legend="review"><i />交易学习路径</span>
      </footer>
    </section>
  );
}
