import { Bot, Braces, FileCheck2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { KORDYN_V2_DOMAINS } from "../architecture/domains.js";
import { AccountTruth } from "./AccountTruth.jsx";
import { MobileBottomNavigation } from "./MobileBottomNavigation.jsx";
import { MobileSheet } from "./MobileSheet.jsx";
import { StateBoundary } from "./StateBoundary.jsx";
import { WorkspaceNavigation } from "./WorkspaceNavigation.jsx";

export function MobileShell({
  location,
  truth,
  state,
  selection,
  supportContext,
  evidenceRequest,
  onNavigate,
  onRetry,
  children
}) {
  const [panel, setPanel] = useState(null);
  const returnFocusRef = useRef(null);
  const contextTriggerRef = useRef(null);
  const proofTriggerRef = useRef(null);
  const supportTriggerRef = useRef(null);
  const selectedId = selection?.object?.id || "none";
  const domain = KORDYN_V2_DOMAINS.find((item) => item.id === location.domainId) || KORDYN_V2_DOMAINS[0];
  const mobileTruth = useMemo(() => ({
    ...truth,
    mode: truth?.mode === "critical" ? "critical" : "compact"
  }), [truth]);

  useEffect(() => {
    if (!evidenceRequest?.token || !["context", "proof"].includes(evidenceRequest.panel)) return;
    returnFocusRef.current = evidenceRequest.trigger;
    setPanel(evidenceRequest.panel);
  }, [evidenceRequest?.panel, evidenceRequest?.token, evidenceRequest?.trigger]);

  const openSheet = (nextPanel, trigger) => {
    returnFocusRef.current = trigger;
    setPanel(nextPanel);
  };

  const closeSheet = () => {
    const returnTarget = returnFocusRef.current;
    setPanel(null);
    const focus = () => returnTarget?.focus();
    if (typeof queueMicrotask === "function") queueMicrotask(focus);
    else window.setTimeout(focus, 0);
  };

  const navigateFromSupport = (domainId, workspaceId) => {
    closeSheet();
    onNavigate(domainId, workspaceId);
  };

  return (
    <div
      className="kordynV2MobileShell"
      data-kordyn-v2-shell="mobile"
      data-kordyn-v2-domain={location.domainId}
      data-kordyn-v2-workspace={location.workspaceId}
      data-kordyn-v2-selected-id={selectedId}
    >
      <div
        className="kordynV2MobileBackground"
        data-kordyn-v2-mobile-background
        inert={panel ? "" : undefined}
        aria-hidden={panel ? "true" : undefined}
      >
        <header className="kordynV2MobileHeader">
          <div className="kordynV2MobileBrandRow">
            <span className="kordynV2MobileBrand" aria-label="KORDYN">
              <span aria-hidden="true"><img src="/kordyn-logo-white.svg" alt="" /></span>
              <strong>KORDYN</strong>
            </span>
            <strong className="kordynV2MobileDomainTitle">{domain.label}</strong>
          </div>
          <AccountTruth truth={mobileTruth} state={state} />
          <WorkspaceNavigation
            domainId={location.domainId}
            workspaceId={location.workspaceId}
            onNavigate={onNavigate}
          />
          <div className="kordynV2MobileEvidenceDock" aria-label="对象证据工具">
            <button
              ref={contextTriggerRef}
              type="button"
              data-kordyn-v2-context-trigger
              aria-haspopup="dialog"
              aria-expanded={panel === "context"}
              onClick={() => openSheet("context", contextTriggerRef.current)}
            >
              <Braces size={18} aria-hidden="true" />
              Context
            </button>
            <button
              ref={proofTriggerRef}
              type="button"
              data-kordyn-v2-proof-trigger
              aria-haspopup="dialog"
              aria-expanded={panel === "proof"}
              onClick={() => openSheet("proof", proofTriggerRef.current)}
            >
              <FileCheck2 size={18} aria-hidden="true" />
              Proof
            </button>
          </div>
        </header>
        <StateBoundary state={state} onRetry={onRetry}>
          <main className="kordynV2MobileCanvas" data-kordyn-v2-work-canvas>
            {children}
          </main>
        </StateBoundary>
        <button
          ref={supportTriggerRef}
          className="kordynV2MobileSupportTrigger"
          data-kordyn-v2-ai-support-trigger
          type="button"
          aria-haspopup="dialog"
          aria-expanded={panel === "support"}
          aria-label="AI 客服，只读助理"
          onClick={() => openSheet("support", supportTriggerRef.current)}
        >
          <Bot size={22} strokeWidth={1.7} aria-hidden="true" />
          <span><strong>AI 客服</strong><small>只读助理</small></span>
        </button>
        <MobileBottomNavigation domainId={location.domainId} onNavigate={onNavigate} />
      </div>
      <MobileSheet
        panel={panel}
        selection={selection}
        supportContext={supportContext}
        onSupportNavigate={navigateFromSupport}
        onClose={closeSheet}
      />
    </div>
  );
}
