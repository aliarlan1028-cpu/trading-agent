import { useEffect, useMemo, useState } from "react";
import { buildAssetsDomainModel } from "./assetsModel.js";
import { MobileRelationshipScreen } from "./MobileRelationshipScreen.jsx";
import { RelationshipWorkspace } from "./RelationshipWorkspace.jsx";
import { MobileStrategyScreen } from "./MobileStrategyScreen.jsx";
import { StrategyWorkspace } from "./StrategyWorkspace.jsx";
import { strategySelectionCandidate } from "./StrategyRegistry.jsx";
import { KnowledgeWorkspace } from "./KnowledgeWorkspace.jsx";
import { CapabilityWorkspace } from "./CapabilityWorkspace.jsx";
import { MobileKnowledgeScreen } from "./MobileKnowledgeScreen.jsx";
import { MobileCapabilityScreen } from "./MobileCapabilityScreen.jsx";
import { ReviewReleaseWorkspace } from "./ReviewReleaseWorkspace.jsx";
import { MobileReviewReleaseScreen } from "./MobileReviewReleaseScreen.jsx";
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
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [selectedEvidenceId, setSelectedEvidenceId] = useState("");
  const [selectedCapabilityId, setSelectedCapabilityId] = useState("");
  const [selectedReviewId, setSelectedReviewId] = useState("");
  const [selectedOwnerId, setSelectedOwnerId] = useState("");

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

  const selectKnowledgeObject = (row, type, setLocal) => {
    const accepted = onSelect?.({ id: row.id, type, workspaceId: "assets" });
    if (accepted) setLocal(row.id);
    return accepted;
  };
  const selectCapability = (row) => selectKnowledgeObject(row, "Capability", setSelectedCapabilityId);
  const globallySelectedSource = selection?.object?.type === "Knowledge" ? selection.object.id : "";
  const globallySelectedEvidence = selection?.object?.type === "Evidence" ? selection.object.id : "";
  const globallySelectedCapability = selection?.object?.type === "Capability" ? selection.object.id : "";
  const globallySelectedReview = selection?.object?.type === "Review" ? selection.object.id : "";
  const globallySelectedOwner = selection?.object?.type === "Owner candidate" ? selection.object.id : "";

  const shared = { model, actions, actionsDisabled, truth, state, selectedNodeId: globalNode?.id || selectedNodeId, onSelect: selectNode, onNavigate };
  if (workspaceId === "relationships") return device === "mobile"
    ? <MobileRelationshipScreen {...shared} />
    : <RelationshipWorkspace {...shared} />;
  if (workspaceId === "strategies") {
    const strategyProps = { ...shared, selectedStrategyId: selectedStrategy?.id || "", onSelect: selectStrategy };
    return device === "mobile" ? <MobileStrategyScreen {...strategyProps} /> : <StrategyWorkspace {...strategyProps} />;
  }
  if (workspaceId === "knowledge") {
    const knowledgeProps = {
      ...shared,
      selectedSourceId: globallySelectedSource || selectedSourceId,
      selectedEvidenceId: globallySelectedEvidence || selectedEvidenceId,
      onSelectSource: (row) => selectKnowledgeObject(row, "Knowledge", setSelectedSourceId),
      onSelectEvidence: (row) => selectKnowledgeObject(row, "Evidence", setSelectedEvidenceId),
      onSelectCandidate: (row) => selectKnowledgeObject(row, "Knowledge candidate", () => {})
    };
    return device === "mobile" ? <MobileKnowledgeScreen {...knowledgeProps} /> : <KnowledgeWorkspace {...knowledgeProps} />;
  }
  if (workspaceId === "capabilities") {
    const capabilityProps = { ...shared, selectedCapabilityId: globallySelectedCapability || selectedCapabilityId, onSelect: selectCapability };
    return device === "mobile" ? <MobileCapabilityScreen {...capabilityProps} /> : <CapabilityWorkspace {...capabilityProps} />;
  }
  if (workspaceId === "reviews") {
    const reviewProps = {
      ...shared,
      selectedReviewId: globallySelectedReview || selectedReviewId,
      selectedOwnerId: globallySelectedOwner || selectedOwnerId,
      onSelectReview: (row) => selectKnowledgeObject(row, "Review", setSelectedReviewId),
      onSelectOwner: (row) => selectKnowledgeObject(row, "Owner candidate", setSelectedOwnerId),
      onSelectEvidence: (row) => selectKnowledgeObject(row, row.type === "fill" ? "Fill" : row.type === "order" ? "Order" : "Audit log", () => {}),
      onSelectValidation: (row) => selectKnowledgeObject(row, row.selectionType || "Validation run", () => {})
    };
    return device === "mobile" ? <MobileReviewReleaseScreen {...reviewProps} /> : <ReviewReleaseWorkspace {...reviewProps} />;
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
export { KnowledgeWorkspace } from "./KnowledgeWorkspace.jsx";
export { CapabilityWorkspace } from "./CapabilityWorkspace.jsx";
export { MobileKnowledgeScreen } from "./MobileKnowledgeScreen.jsx";
export { MobileCapabilityScreen } from "./MobileCapabilityScreen.jsx";
export { ReviewReleaseWorkspace } from "./ReviewReleaseWorkspace.jsx";
export { MobileReviewReleaseScreen } from "./MobileReviewReleaseScreen.jsx";
