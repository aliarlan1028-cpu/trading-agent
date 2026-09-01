import { Bot, Braces, FileCheck2, ListChecks, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AiSupport } from "./AiSupport.jsx";
import { normalizeEvidenceDetails } from "./evidenceDetails.js";

const unavailable = "Unavailable";
const safeText = (value) => (
  typeof value === "string" || typeof value === "number" ? String(value) : unavailable
);

const CONTEXT_FIELDS = Object.freeze([
  ["对象", "object"],
  ["状态", "status"],
  ["证据", "evidence"],
  ["风险", "risk"],
  ["授权", "mandate"],
  ["权限", "permissions"],
  ["版本", "version"]
]);

const EVIDENCE_TABS = Object.freeze([
  Object.freeze({ id: "details", label: "详情", icon: ListChecks }),
  Object.freeze({ id: "context", label: "Context", icon: Braces }),
  Object.freeze({ id: "proof", label: "Proof", icon: FileCheck2 })
]);
const evidenceTabId = (value) => EVIDENCE_TABS.some((tab) => tab.id === value) ? value : "context";

export function MobileSheet({ panel, selection, supportContext, initialEvidenceTab = "context", evidenceDetails, onSupportNavigate, onClose }) {
  const dialogRef = useRef(null);
  const [evidenceTab, setEvidenceTab] = useState(evidenceTabId(initialEvidenceTab));
  const supportedPanel = panel === "evidence" || panel === "support";

  useEffect(() => {
    if (panel !== "evidence") return;
    setEvidenceTab(evidenceTabId(initialEvidenceTab));
  }, [initialEvidenceTab, panel]);

  useEffect(() => {
    if (!supportedPanel) return undefined;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector("[data-kordyn-v2-mobile-sheet-close]")?.focus();
    });
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    const retainDialogFocus = (event) => {
      if (dialogRef.current?.contains(event.target)) return;
      event.preventDefault();
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", retainDialogFocus, true);
    document.addEventListener("mousedown", retainDialogFocus, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", retainDialogFocus, true);
      document.removeEventListener("mousedown", retainDialogFocus, true);
    };
  }, [onClose, supportedPanel]);

  if (!supportedPanel) return null;

  const onDialogKeyDown = (event) => {
    if (event.key !== "Tab") return;
    const focusable = [...dialogRef.current.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const onEvidenceTabKeyDown = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const currentIndex = EVIDENCE_TABS.findIndex((tab) => tab.id === evidenceTab);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? EVIDENCE_TABS.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + EVIDENCE_TABS.length) % EVIDENCE_TABS.length;
    const nextTab = EVIDENCE_TABS[nextIndex].id;
    event.preventDefault();
    setEvidenceTab(nextTab);
    dialogRef.current?.querySelector(`[data-kordyn-v2-evidence-tab="${nextTab}"]`)?.focus();
  };

  const context = selection?.context || {};
  const stages = Array.isArray(selection?.trace?.stages) ? selection.trace.stages : [];
  const details = normalizeEvidenceDetails(evidenceDetails);
  const selectedId = safeText(selection?.object?.id);
  const title = panel === "evidence" ? "对象证据" : "AI 客服 · 只读助理";
  const PanelIcon = panel === "evidence" ? FileCheck2 : Bot;

  return (
    <div
      className="kordynV2MobileSheetScrim"
      data-kordyn-v2-mobile-sheet-scrim
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="kordynV2MobileSheet"
        data-kordyn-v2-mobile-sheet={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`kordyn-v2-mobile-${panel}-title`}
        onKeyDown={onDialogKeyDown}
      >
        <div className="kordynV2MobileSheetHandle" aria-hidden="true" />
        <header>
          <span>
            <PanelIcon size={19} strokeWidth={1.7} aria-hidden="true" />
            <strong id={`kordyn-v2-mobile-${panel}-title`}>{title}</strong>
          </span>
          <button type="button" data-kordyn-v2-mobile-sheet-close aria-label="关闭" onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        {panel === "evidence" && (
          <div className="kordynV2MobileEvidenceTabs" role="tablist" aria-label="对象证据视图">
            {EVIDENCE_TABS.map(({ id, label, icon: TabIcon }) => (
              <button
                key={id}
                id={`kordyn-v2-evidence-tab-${id}`}
                type="button"
                role="tab"
                aria-controls="kordyn-v2-evidence-panel"
                aria-selected={evidenceTab === id}
                tabIndex={evidenceTab === id ? 0 : -1}
                data-kordyn-v2-evidence-tab={id}
                onClick={() => setEvidenceTab(id)}
                onKeyDown={onEvidenceTabKeyDown}
              >
                <TabIcon size={17} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        )}
        <div
          className="kordynV2MobileSheetScroll"
          id={panel === "evidence" ? "kordyn-v2-evidence-panel" : undefined}
          role={panel === "evidence" ? "tabpanel" : undefined}
          aria-labelledby={panel === "evidence" ? `kordyn-v2-evidence-tab-${evidenceTab}` : undefined}
        >
          {panel === "support" ? (
            <AiSupport context={supportContext} onNavigate={onSupportNavigate} presentation="content" />
          ) : <>
            <p className="kordynV2MobileSheetIdentity">{safeText(selection?.object?.type)} / {selectedId}</p>
            {evidenceTab === "details" ? (
            details.length ? (
              <dl className="kordynV2MobileDecisionFacts">
                {details.map(([label, value], index) => (
                  <div key={`${label}-${index}`}><dt>{label}</dt><dd>{value}</dd></div>
                ))}
              </dl>
            ) : <p className="kordynV2MobileEvidenceUnavailable">{unavailable}</p>
            ) : evidenceTab === "context" ? (
            <dl className="kordynV2MobileContextFacts" data-kordyn-v2-context-id={selectedId} data-kordyn-v2-context-type={safeText(selection?.object?.type)}>
              {CONTEXT_FIELDS.map(([label, key]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{safeText(context[key])}</dd>
                </div>
              ))}
            </dl>
            ) : (
            <div className="kordynV2MobileProofContent" data-kordyn-v2-proof-id={selectedId} data-kordyn-v2-proof-type={safeText(selection?.object?.type)}>
              {details.length > 0 && <dl className="kordynV2MobileDecisionFacts" data-kordyn-v2-proof-details>
                {details.map(([label, value], index) => <div key={`${label}-${index}`}><dt>{label}</dt><dd>{value}</dd></div>)}
              </dl>}
              <ol className="kordynV2MobileProofStages">
                {stages.length ? stages.map((stage, index) => (
                  <li key={safeText(stage?.id) === unavailable ? index : safeText(stage.id)} data-stage-state={safeText(stage?.status).toLowerCase()}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div><strong>{safeText(stage?.label)}</strong><small>{safeText(stage?.detail)}</small></div>
                    <em>{safeText(stage?.status)}</em>
                  </li>
                )) : <li className="is-empty">当前对象没有可用的阶段证据。</li>}
              </ol>
            </div>
            )}
          </>}
        </div>
      </section>
    </div>
  );
}
