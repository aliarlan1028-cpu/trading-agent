import { Braces, FileCheck2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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

export function ContextProof({ selection, request }) {
  const [panel, setPanel] = useState(null);
  const [requestedSelection, setRequestedSelection] = useState(undefined);
  const dialogRef = useRef(null);
  const contextTriggerRef = useRef(null);
  const proofTriggerRef = useRef(null);
  const returnFocusRef = useRef(null);

  useEffect(() => {
    if (!request?.token || !["context", "proof"].includes(request.panel)) return;
    returnFocusRef.current = request.trigger;
    setRequestedSelection(request.selection);
    setPanel(request.panel);
  }, [request?.panel, request?.selection, request?.token, request?.trigger]);

  useEffect(() => {
    if (!panel) return undefined;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector("[data-kordyn-v2-overlay-close]")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [panel]);

  const open = (nextPanel, trigger) => {
    returnFocusRef.current = trigger;
    setRequestedSelection(undefined);
    setPanel(nextPanel);
  };

  const openFromKeyboard = (event, nextPanel, trigger) => {
    if (!["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    open(nextPanel, trigger);
  };

  const close = () => {
    const returnTarget = returnFocusRef.current;
    setPanel(null);
    const focus = () => returnTarget?.focus();
    if (typeof queueMicrotask === "function") queueMicrotask(focus);
    else window.setTimeout(focus, 0);
  };

  const onDialogKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
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

  const activeSelection = requestedSelection === undefined ? selection : requestedSelection;
  const context = activeSelection?.context || {};
  const stages = Array.isArray(activeSelection?.trace?.stages) ? activeSelection.trace.stages : [];
  const selectedId = safeText(activeSelection?.object?.id);

  return (
    <>
      <div className="kordynV2EvidenceDock" aria-label="对象证据工具">
        <button
          ref={contextTriggerRef}
          type="button"
          data-kordyn-v2-context-trigger
          aria-haspopup="dialog"
          aria-expanded={panel === "context"}
          onClick={() => open("context", contextTriggerRef.current)}
          onKeyDown={(event) => openFromKeyboard(event, "context", contextTriggerRef.current)}
        >
          <Braces size={16} aria-hidden="true" />
          Context
        </button>
        <button
          ref={proofTriggerRef}
          type="button"
          data-kordyn-v2-proof-trigger
          aria-haspopup="dialog"
          aria-expanded={panel === "proof"}
          onClick={() => open("proof", proofTriggerRef.current)}
          onKeyDown={(event) => openFromKeyboard(event, "proof", proofTriggerRef.current)}
        >
          <FileCheck2 size={16} aria-hidden="true" />
          Proof
        </button>
      </div>
      {panel && (
        <div className="kordynV2OverlayScrim" data-kordyn-v2-overlay-scrim onMouseDown={(event) => {
          if (event.target === event.currentTarget) close();
        }}>
          <section
            ref={dialogRef}
            className="kordynV2EvidenceOverlay"
            data-kordyn-v2-overlay={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`kordyn-v2-${panel}-title`}
            onKeyDown={onDialogKeyDown}
          >
            <header>
              <span>
                <small>{panel === "context" ? "CANONICAL CONTEXT" : "DECISION PROOF"}</small>
                <strong id={`kordyn-v2-${panel}-title`}>
                  {panel === "context" ? "关联上下文" : "决策证据链"}
                </strong>
              </span>
              <button type="button" data-kordyn-v2-overlay-close aria-label="关闭" onClick={close}>
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <p className="kordynV2OverlayIdentity">{safeText(activeSelection?.object?.type)} / {selectedId}</p>
            {panel === "context" ? (
              <dl className="kordynV2ContextFacts">
                {CONTEXT_FIELDS.map(([label, key]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>{safeText(context[key])}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <ol className="kordynV2ProofStages">
                {stages.length ? stages.map((stage, index) => (
                  <li key={safeText(stage?.id) === unavailable ? index : safeText(stage.id)} data-stage-state={safeText(stage?.status).toLowerCase()}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div><strong>{safeText(stage?.label)}</strong><small>{safeText(stage?.detail)}</small></div>
                    <em>{safeText(stage?.status)}</em>
                  </li>
                )) : <li className="is-empty">当前对象没有可用的阶段证据。</li>}
              </ol>
            )}
          </section>
        </div>
      )}
    </>
  );
}
