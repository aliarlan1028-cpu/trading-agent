import { Bell, Bot } from "lucide-react";
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
  identity,
  supportContext,
  evidenceRequest,
  onNavigate,
  onRetry,
  children
}) {
  const [panel, setPanel] = useState(null);
  const [evidenceTab, setEvidenceTab] = useState("context");
  const returnFocusRef = useRef(null);
  const supportTriggerRef = useRef(null);
  const selectedId = selection?.object?.id || "none";
  const domain = KORDYN_V2_DOMAINS.find((item) => item.id === location.domainId) || KORDYN_V2_DOMAINS[0];
  const mobileTruth = useMemo(() => ({
    ...truth,
    mode: location.domainId === "ai" && location.workspaceId === "missions" ? "full" : truth?.mode
  }), [location.domainId, location.workspaceId, truth]);
  const equity = typeof truth?.equity === "number" && Number.isFinite(truth.equity)
    ? new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(truth.equity)
    : "Unavailable";
  const risk = typeof truth?.risk === "string" && truth.risk
    ? ["normal", "ok", "healthy"].includes(truth.risk.toLowerCase()) ? "风险正常" : truth.risk
    : "Unavailable";
  const riskTone = risk === "风险正常"
    ? "mint"
    : risk === "Unavailable" ? "unavailable" : "danger";
  const notificationCount = Number.isInteger(identity?.notificationCount) && identity.notificationCount >= 0
    ? identity.notificationCount
    : null;

  useEffect(() => {
    if (!evidenceRequest?.token || !["details", "context", "proof"].includes(evidenceRequest.panel)) return;
    returnFocusRef.current = evidenceRequest.trigger;
    setEvidenceTab(evidenceRequest.panel);
    setPanel("evidence");
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
          <div className="kordynV2MobileBrandRow" data-kordyn-v2-mobile-identity>
            <span className="kordynV2MobileBrand" aria-label="KORDYN">
              <span aria-hidden="true"><img src="/kordyn-logo-white.svg" alt="" /></span>
              <strong>KORDYN</strong>
            </span>
            <span className="kordynV2MobileHealthSummary">
              <span>权益 <strong>{equity}</strong></span>
              <em data-health-tone={riskTone}><i aria-hidden="true" />{risk}</em>
            </span>
            <button
              className="kordynV2MobileNotification"
              type="button"
              data-kordyn-v2-notification-target="governance/notifications"
              aria-label={notificationCount === null ? "通知，Unavailable" : `通知，${notificationCount} 条`}
              onClick={() => onNavigate("governance", "notifications")}
            >
              <Bell size={21} strokeWidth={1.8} aria-hidden="true" />
              {notificationCount > 0 && <span>{notificationCount}</span>}
            </button>
          </div>
          <div className="kordynV2MobileTitleRow">
            <h1 className="kordynV2MobileDomainTitle" data-kordyn-v2-mobile-title data-kordyn-v2-destination-title>{domain.label}</h1>
          </div>
          <WorkspaceNavigation
            domainId={location.domainId}
            workspaceId={location.workspaceId}
            onNavigate={onNavigate}
          />
          <AccountTruth truth={mobileTruth} state={state} />
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
        initialEvidenceTab={evidenceTab}
        evidenceDetails={evidenceRequest?.details}
        onSupportNavigate={navigateFromSupport}
        onClose={closeSheet}
      />
    </div>
  );
}
