import { useEffect, useMemo, useState } from "react";

const CONCEPT_COLORS = { 技术: "#2A6FDB", 风控: "#C43F28", 心理: "#7A4FD0", 宏观: "#D06A22", 结构: "#1F7A50", 资金: "#B08900", 其他: "#8a8172" };

// Deterministic force layout: category seeds plus fixed relaxation, with no
// randomness between renders. The node cap keeps large libraries responsive;
// callers expose source/category filters so every concept remains reachable.
function conceptLayout(nodes, edges, width, height) {
  const categories = [...new Set(nodes.map((concept) => concept.category || "其他"))];
  const positions = nodes.map((concept, index) => {
    const group = categories.indexOf(concept.category || "其他");
    const groupAngle = (group / Math.max(1, categories.length)) * 2 * Math.PI;
    const centerX = width / 2 + 120 * Math.cos(groupAngle);
    const centerY = height / 2 + 80 * Math.sin(groupAngle);
    const angle = index * 2.399;
    return { x: centerX + 34 * Math.cos(angle), y: centerY + 34 * Math.sin(angle) };
  });
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  for (let iteration = 0; iteration < 240; iteration += 1) {
    const forces = positions.map(() => ({ x: 0, y: 0 }));
    for (let left = 0; left < positions.length; left += 1) {
      for (let right = left + 1; right < positions.length; right += 1) {
        const dx = positions[left].x - positions[right].x;
        const dy = positions[left].y - positions[right].y;
        const distance = Math.hypot(dx, dy) || 0.01;
        const force = 1700 / (distance * distance);
        forces[left].x += dx / distance * force;
        forces[left].y += dy / distance * force;
        forces[right].x -= dx / distance * force;
        forces[right].y -= dy / distance * force;
      }
    }
    edges.forEach(([left, right]) => {
      const dx = positions[right].x - positions[left].x;
      const dy = positions[right].y - positions[left].y;
      const distance = Math.hypot(dx, dy) || 0.01;
      const force = (distance - 66) * 0.02;
      forces[left].x += dx / distance * force;
      forces[left].y += dy / distance * force;
      forces[right].x -= dx / distance * force;
      forces[right].y -= dy / distance * force;
    });
    positions.forEach((position, index) => {
      forces[index].x += (width / 2 - position.x) * 0.008;
      forces[index].y += (height / 2 - position.y) * 0.008;
      position.x = clamp(position.x + clamp(forces[index].x, -6, 6), 34, width - 34);
      position.y = clamp(position.y + clamp(forces[index].y, -6, 6), 28, height - 28);
    });
  }
  return positions;
}

export function ConceptGraph({ concepts = [], maxNodes = 20 }) {
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const width = 520;
  const height = 360;
  const { nodes, positions, edges, degrees, totalUnique } = useMemo(() => {
    const byName = new Map();
    (concepts || []).forEach((concept) => {
      const key = String(concept.name || "").trim();
      if (!key) return;
      const relatedTo = (concept.relatedTo || []).map((item) => String(item).trim()).filter(Boolean);
      const existing = byName.get(key);
      if (existing) {
        existing.relatedTo = [...new Set([...existing.relatedTo, ...relatedTo])];
        if (!existing.tradingMeaning) existing.tradingMeaning = concept.tradingMeaning || concept.meaning || existing.tradingMeaning;
      } else {
        byName.set(key, { ...concept, name: key, relatedTo: [...new Set(relatedTo)] });
      }
    });
    const totalUnique = byName.size;
    const nodes = [...byName.values()].slice(0, Math.max(1, Number(maxNodes) || 20));
    const nameIndex = {};
    nodes.forEach((concept, index) => { nameIndex[concept.name] = index; });
    const edges = [];
    const edgeKeys = new Set();
    nodes.forEach((concept, index) => (concept.relatedTo || []).forEach((relatedName) => {
      const relatedIndex = nameIndex[String(relatedName).trim()];
      if (relatedIndex == null || relatedIndex === index) return;
      const pair = index < relatedIndex ? [index, relatedIndex] : [relatedIndex, index];
      const key = pair.join(":");
      if (!edgeKeys.has(key)) { edgeKeys.add(key); edges.push(pair); }
    }));
    const degrees = nodes.map(() => 0);
    edges.forEach(([left, right]) => { degrees[left] += 1; degrees[right] += 1; });
    const positions = nodes.length ? conceptLayout(nodes, edges, width, height) : [];
    return { nodes, positions, edges, degrees, totalUnique };
  }, [concepts, maxNodes]);
  useEffect(() => { setSelectedIndex(null); setHoveredIndex(null); }, [concepts, maxNodes]);
  if (!nodes.length) return <div className="emptyPanel" style={{ minHeight: 180 }}>导入资料后自动抽取概念与关系图谱</div>;

  const focusedIndex = selectedIndex != null ? selectedIndex : hoveredIndex;
  const radius = (index) => 5 + Math.min(7, degrees[index] * 1.4);
  const connected = (index) => focusedIndex == null || index === focusedIndex || edges.some(([left, right]) => (left === focusedIndex && right === index) || (right === focusedIndex && left === index));
  const categories = [...new Set(nodes.map((concept) => concept.category || "其他"))];
  const selected = focusedIndex != null ? nodes[focusedIndex] : null;
  return (
    <div className="conceptGraph">
      <div className="cgWrap">
        <svg viewBox={`0 0 ${width} ${height}`} className="cgSvg" preserveAspectRatio="xMidYMid meet">
          {edges.map(([left, right], index) => {
            const highlighted = focusedIndex != null && (left === focusedIndex || right === focusedIndex);
            const dimmed = focusedIndex != null && !highlighted;
            const middleX = (positions[left].x + positions[right].x) / 2;
            const middleY = (positions[left].y + positions[right].y) / 2 - Math.hypot(positions[left].x - positions[right].x, positions[left].y - positions[right].y) * 0.12;
            return <path key={index} className={`cgEdge ${highlighted ? "hot" : dimmed ? "cold" : ""}`} d={`M${positions[left].x} ${positions[left].y} Q${middleX} ${middleY} ${positions[right].x} ${positions[right].y}`} />;
          })}
          {nodes.map((concept, index) => {
            const color = CONCEPT_COLORS[concept.category] || CONCEPT_COLORS.其他;
            const nodeRadius = radius(index);
            const focused = index === focusedIndex;
            const labelWidth = (concept.name || "").length * 11 + 8;
            return (
              <g key={concept.id || index} className={`cgNode ${focusedIndex != null && !connected(index) ? "dim" : ""}`}
                onClick={() => setSelectedIndex(selectedIndex === index ? null : index)}
                onMouseEnter={() => setHoveredIndex(index)} onMouseLeave={() => setHoveredIndex(null)}>
                <circle className="cgHalo" cx={positions[index].x} cy={positions[index].y} r={nodeRadius + 7} fill={color} opacity={focused ? 0.24 : 0.12} />
                <circle className="cgDot" cx={positions[index].x} cy={positions[index].y} r={focused ? nodeRadius + 1.5 : nodeRadius} fill={color} />
                <rect className="cgLabelBg" x={positions[index].x - labelWidth / 2} y={positions[index].y - nodeRadius - 16} width={labelWidth} height="14" rx="4" />
                <text className="cgLabel" x={positions[index].x} y={positions[index].y - nodeRadius - 9} textAnchor="middle" fill={color}>{concept.name}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="cgLegend">{categories.map((category) => <span key={category}><i style={{ background: CONCEPT_COLORS[category] || CONCEPT_COLORS.其他 }} />{category}</span>)}</div>
      {selected
        ? <div className="cgDetail"><b style={{ color: CONCEPT_COLORS[selected.category] || CONCEPT_COLORS.其他 }}>{selected.name}</b><span className="cgCat">{selected.category || "其他"}</span><p>{selected.tradingMeaning || selected.meaning || "—"}</p></div>
        : <div className="cgHint">点击概念看含义与关联 · 节点越大关联越多 · {nodes.length}{totalUnique > nodes.length ? `/${totalUnique}` : ""} 概念 / {edges.length} 关系</div>}
    </div>
  );
}
