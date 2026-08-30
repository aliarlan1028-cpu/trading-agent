import { ArrowLeft, ShieldCheck } from "lucide-react";
import { PositionInspector } from "./PositionInspector.jsx";
import { PositionRegistry, selectedPositionFor } from "./PositionRegistry.jsx";
import { PositionTruthField } from "./PositionWorkspace.jsx";

const unavailable = "Unavailable";
const text = (value) => typeof value === "string" && value ? value : unavailable;

export function MobilePositionScreen({ model, state, selection, actionsDisabled = false, actionOutcome = null, view = "list", onSelect = () => {}, onExit = () => {}, onOpenList = () => {}, detailHeadingRef = null, returnFocusRef = null }) {
  const selected = selectedPositionFor(model, selection);
  if (view === "detail") {
    return (
      <div className="kordynV2PositionMobile" data-kordyn-v2-position-mobile-view="detail">
        <header className="kordynV2PositionMobileNav">
          <button type="button" data-kordyn-v2-position-back="true" onClick={(event) => onOpenList(event)}><ArrowLeft size={18} aria-hidden="true" />持仓列表</button>
          <span><ShieldCheck size={15} aria-hidden="true" />{text(selected?.protection?.state)}</span>
        </header>
        <div className="kordynV2PositionMobileDetail">
          <PositionTruthField position={selected} state={state} headingRef={detailHeadingRef} mobile canonical={selection?.object?.type === "Position" && selection.object.id === selected?.id} />
          <PositionInspector position={selected} reconciliation={model?.reconciliation} actionsDisabled={actionsDisabled} actionOutcome={actionOutcome} onSelect={onSelect} onExit={onExit} mobile />
        </div>
      </div>
    );
  }
  return (
    <div className="kordynV2PositionMobile" data-kordyn-v2-position-mobile-view="list">
      <header className="kordynV2PositionMobileHeading"><h2>持仓</h2><p>选择持仓后查看权威价格、保护证据与可用退出动作。</p></header>
      <PositionRegistry model={model} selection={selection} returnFocusRef={returnFocusRef} mobile onSelect={onSelect} />
    </div>
  );
}
