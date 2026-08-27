import { MessageCircleMore } from "lucide-react";
import { AccountTruth } from "./AccountTruth.jsx";
import { ContextProof } from "./ContextProof.jsx";
import { OperatorIdentity } from "./OperatorIdentity.jsx";
import { PrimaryNavigation } from "./PrimaryNavigation.jsx";
import { StateBoundary } from "./StateBoundary.jsx";
import { WorkspaceNavigation } from "./WorkspaceNavigation.jsx";

export function DesktopShell({
  location,
  truth,
  state,
  selection,
  identity,
  evidenceRequest,
  onNavigate,
  onSelect,
  onRetry,
  children
}) {
  const selectedId = selection?.object?.id || "none";
  return (
    <div
      className="kordynV2DesktopShell"
      data-kordyn-v2-shell="desktop"
      data-kordyn-v2-domain={location.domainId}
      data-kordyn-v2-workspace={location.workspaceId}
      data-kordyn-v2-selected-id={selectedId}
    >
      <PrimaryNavigation domainId={location.domainId} state={state} onNavigate={onNavigate} />
      <header className="kordynV2DesktopHeader">
        <WorkspaceNavigation
          domainId={location.domainId}
          workspaceId={location.workspaceId}
          onNavigate={onNavigate}
        />
        <AccountTruth truth={truth} state={state} />
        <OperatorIdentity identity={identity} />
      </header>
      <StateBoundary state={state} onRetry={onRetry}>
        <main className="kordynV2WorkspaceCanvas" data-kordyn-v2-work-canvas>
          {children}
        </main>
      </StateBoundary>
      <ContextProof selection={selection} onSelect={onSelect} request={evidenceRequest} />
      <button
        className="kordynV2AssistantReserve"
        data-kordyn-v2-assistant-reserve
        type="button"
        disabled
        aria-label="AI 客服：只读支持待开放，Unavailable"
      >
        <MessageCircleMore size={21} strokeWidth={1.7} aria-hidden="true" />
        <span><strong>AI 客服</strong><small>只读支持 · 待开放</small></span>
      </button>
    </div>
  );
}
