import { Bot, Braces, FileCheck2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AiSupport } from "./AiSupport.jsx";

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

export function MobileSheet({ panel, selection, supportContext, initialEvidenceTab = "context", onSupportNavigate, onClose }) {
  const dialogRef = useRef(null);
  const [evidenceTab, setEvidenceTab] = useState(initialEvidenceTab === "proof" ? "proof" : "context");
  const supportedPanel = panel === "evidence" || panel === "support";

  useEffect(() => {
    if (panel !== "evidence") return;
    setEvidenceTab(initialEvidenceTab === "proof" ? "proof" : "context");
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

  const context = selection?.context || {};
  const stages = Array.isArray(selection?.trace?.stages) ? selection.trace.stages : [];
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
            <button
              type="button"
              role="tab"
              aria-selected={evidenceTab === "context"}
              data-kordyn-v2-evidence-tab="context"
              onClick={() => setEvidenceTab("context")}
            >
              <Braces size={17} aria-hidden="true" />
              Context
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={evidenceTab === "proof"}
              data-kordyn-v2-evidence-tab="proof"
              onClick={() => setEvidenceTab("proof")}
            >
              <FileCheck2 size={17} aria-hidden="true" />
              Proof
            </button>
          </div>
        )}
        <div className="kordynV2MobileSheetScroll">
          {panel === "support" ? (
            <AiSupport context={supportContext} onNavigate={onSupportNavigate} presentation="content" />
          ) : <>
            <p className="kordynV2MobileSheetIdentity">{safeText(selection?.object?.type)} / {selectedId}</p>
            {evidenceTab === "context" ? (
            <dl className="kordynV2MobileContextFacts">
              {CONTEXT_FIELDS.map(([label, key]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{safeText(context[key])}</dd>
                </div>
              ))}
            </dl>
            ) : (
            <ol className="kordynV2MobileProofStages">
              {stages.length ? stages.map((stage, index) => (
                <li key={safeText(stage?.id) === unavailable ? index : safeText(stage.id)} data-stage-state={safeText(stage?.status).toLowerCase()}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div><strong>{safeText(stage?.label)}</strong><small>{safeText(stage?.detail)}</small></div>
                  <em>{safeText(stage?.status)}</em>
                </li>
              )) : <li className="is-empty">当前对象没有可用的阶段证据。</li>}
            </ol>
            )}
          </>}
        </div>
      </section>
    </div>
  );
}
