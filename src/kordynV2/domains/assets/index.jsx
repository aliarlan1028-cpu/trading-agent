import { useEffect, useMemo, useState } from "react";
import { buildAssetsDomainModel } from "./assetsModel.js";
import { MobileRelationshipScreen } from "./MobileRelationshipScreen.jsx";
import { RelationshipWorkspace } from "./RelationshipWorkspace.jsx";
import { MobileStrategyScreen } from "./MobileStrategyScreen.jsx";
import { StrategyWorkspace } from "./StrategyWorkspace.jsx";
import { strategySelectionCandidate } from "./StrategyRegistry.jsx";
import "./assets.css";

function shellSelectedNode(nodes, selection) {
  const id = selection?.object?.id;
  const type = selection?.object?.type;
  return nodes.find((node) => node.selectionId === id && node.selectionType === type) || null;
}

export default function AssetsDomain({ device, workspaceId, data, actions, actionsDisabled = false, truth, state, selection, onSelect, onNavigate }) {
  const model = useMemo(() => buildAssetsDomainModel(data), [data]);
  const nodes = model.relationships.nodes;
  const globalNode = shellSelectedNode(nodes, selection);
  const [selectedNodeId, setSelectedNodeId] = useState(globalNode?.id || "");

  useEffect(() => {
    if (globalNode?.id) setSelectedNodeId(globalNode.id);
  }, [globalNode?.id]);

  const selectNode = (node) => {
    const accepted = onSelect?.({
      id: node.selectionId,
      type: node.selectionType,
      workspaceId: "assets"
    });
    if (accepted) setSelectedNodeId(node.id);
    return accepted;
  };

  const selectStrategy = (strategy) => {
    const candidate = strategySelectionCandidate(strategy);
    const accepted = onSelect?.(candidate);
    if (accepted) setSelectedNodeId(`strategy-row:${strategy.id}`);
    return accepted;
  };

  const selectedStrategy = model.strategies.find((row) => {
    const candidate = strategySelectionCandidate(row);
    return candidate.id === selection?.object?.id && candidate.type === selection?.object?.type;
  });

  const shared = { model, actions, actionsDisabled, truth, state, selectedNodeId: globalNode?.id || selectedNodeId, onSelect: selectNode, onNavigate };
  if (workspaceId === "relationships") return device === "mobile"
    ? <MobileRelationshipScreen {...shared} />
    : <RelationshipWorkspace {...shared} />;
  if (workspaceId === "strategies") {
    const strategyProps = { ...shared, selectedStrategyId: selectedStrategy?.id || "", onSelect: selectStrategy };
    return device === "mobile" ? <MobileStrategyScreen {...strategyProps} /> : <StrategyWorkspace {...strategyProps} />;
  }
  return null;
}

export { RelationshipGraph } from "./RelationshipGraph.jsx";
export { RelationshipInspector } from "./RelationshipInspector.jsx";
export { RelationshipWorkspace } from "./RelationshipWorkspace.jsx";
export { MobileRelationshipScreen } from "./MobileRelationshipScreen.jsx";
export { StrategyWorkspace } from "./StrategyWorkspace.jsx";
export { StrategyRegistry } from "./StrategyRegistry.jsx";
export { StrategyInspector } from "./StrategyInspector.jsx";
export { StrategyStudio } from "./StrategyStudio.jsx";
export { MobileStrategyScreen } from "./MobileStrategyScreen.jsx";
