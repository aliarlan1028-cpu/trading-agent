import { useEffect, useMemo, useState } from "react";
import { buildAssetsDomainModel } from "./assetsModel.js";
import { MobileRelationshipScreen } from "./MobileRelationshipScreen.jsx";
import { RelationshipWorkspace } from "./RelationshipWorkspace.jsx";
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

  const shared = { model, actions, actionsDisabled, truth, state, selectedNodeId: globalNode?.id || selectedNodeId, onSelect: selectNode, onNavigate };
  if (workspaceId !== "relationships") return null;
  return device === "mobile"
    ? <MobileRelationshipScreen {...shared} />
    : <RelationshipWorkspace {...shared} />;
}

export { RelationshipGraph } from "./RelationshipGraph.jsx";
export { RelationshipInspector } from "./RelationshipInspector.jsx";
export { RelationshipWorkspace } from "./RelationshipWorkspace.jsx";
export { MobileRelationshipScreen } from "./MobileRelationshipScreen.jsx";
