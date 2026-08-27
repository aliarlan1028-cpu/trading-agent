import { AccountTruth } from "./AccountTruth.jsx";
import { ContextProof } from "./ContextProof.jsx";
import { PrimaryNavigation } from "./PrimaryNavigation.jsx";
import { StateBoundary } from "./StateBoundary.jsx";
import { WorkspaceNavigation } from "./WorkspaceNavigation.jsx";

export function DesktopShell({
  location,
  truth,
  state,
  selection,
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
      <PrimaryNavigation domainId={location.domainId} onNavigate={onNavigate} />
      <header className="kordynV2DesktopHeader">
        <WorkspaceNavigation
          domainId={location.domainId}
          workspaceId={location.workspaceId}
          onNavigate={onNavigate}
        />
        <AccountTruth truth={truth} />
      </header>
      <StateBoundary state={state} onRetry={onRetry}>
        <main className="kordynV2WorkspaceCanvas" data-kordyn-v2-work-canvas>
          {children}
        </main>
      </StateBoundary>
      <ContextProof selection={selection} onSelect={onSelect} />
    </div>
  );
}
