import { Braces, FileCheck2, X } from "lucide-react";
import { useEffect, useRef } from "react";

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

export function MobileSheet({ panel, selection, onClose }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!panel) return undefined;
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
  }, [onClose, panel]);

  if (!panel) return null;

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
  const title = panel === "context" ? "关联上下文" : "决策证据链";
  const PanelIcon = panel === "context" ? Braces : FileCheck2;

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
        <div className="kordynV2MobileSheetScroll">
          <p className="kordynV2MobileSheetIdentity">{safeText(selection?.object?.type)} / {selectedId}</p>
          {panel === "context" ? (
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
        </div>
      </section>
    </div>
  );
}
