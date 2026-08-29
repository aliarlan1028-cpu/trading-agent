import { MessageSquareText, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AiOutputSheet } from "./AiOutputSheet.jsx";
import { DialogComposer, DialogMessages, useAiDialogController } from "./AiDialogWorkspace.jsx";

export function MobileAiDialogScreen({ model, actions = {}, actionsDisabled = false, onClose = () => {} }) {
  const controller = useAiDialogController({ model, actions, actionsDisabled });
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const [output, setOutput] = useState(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (controller.state.kind === "processing") return undefined;
    const frame = window.requestAnimationFrame(() => {
      if (!output && !dialogRef.current?.contains(document.activeElement)) closeRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [controller.state.kind, output]);

  const onKeyDown = (event) => {
    if (output) return;
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...dialogRef.current.querySelectorAll('button:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return (
    <section ref={dialogRef} className="kordynV2AiMobileDialog" data-kordyn-v2-destination="ai/dialog" data-kordyn-v2-dialog-surface data-kordyn-v2-layout="dialog-full-screen" role="dialog" aria-modal="true" aria-labelledby="kordyn-v2-ai-mobile-dialog-title" onKeyDown={onKeyDown}>
      <header><button ref={closeRef} type="button" aria-label="关闭对话并返回任务" onClick={onClose}><X size={21} aria-hidden="true" /></button><span><MessageSquareText size={20} aria-hidden="true" /><strong id="kordyn-v2-ai-mobile-dialog-title" data-kordyn-v2-destination-title>AI 交易员 · 对话</strong></span><i aria-hidden="true" /></header>
      {controller.payload.sessions.length > 1 && <nav aria-label="对话会话">{controller.payload.sessions.map((session) => <button type="button" key={session.id} aria-current={session.id === controller.payload.activeSessionId ? "page" : undefined} onClick={() => controller.read(session.id)}>{session.title}</button>)}</nav>}
      <DialogMessages messages={controller.payload.messages} actionsDisabled={actionsDisabled} onOutput={(message, trigger) => { if (!actionsDisabled) setOutput({ message, trigger }); }} />
      <DialogComposer {...controller} actionsDisabled={actionsDisabled} />
      {output && <AiOutputSheet message={output.message} actions={actions} actionsDisabled={actionsDisabled} returnFocus={output.trigger} onClose={() => setOutput(null)} />}
    </section>
  );
}
