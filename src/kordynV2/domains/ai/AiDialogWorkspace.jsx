import { Bot, FileImage, MessageSquareText, Send, UserRound, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AiOutputSheet } from "./AiOutputSheet.jsx";

const unavailable = "Unavailable";
const safeText = (value, fallback = unavailable) => ["string", "number", "boolean"].includes(typeof value) && value !== "" ? String(value) : fallback;

function normalizeMessages(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-100).map((message, index) => ({
    id: safeText(message?.id, `message-${index}`),
    role: safeText(message?.role),
    content: safeText(message?.content ?? message?.text),
    sessionId: safeText(message?.sessionId, ""),
    createdAt: safeText(message?.createdAt),
    model: safeText(message?.model, ""),
    planId: safeText(message?.planId, "")
  }));
}

export function normalizeDialogPayload(value, fallback = {}) {
  if (!value || typeof value !== "object" || value.ok === false || value.error) return null;
  const sessions = Array.isArray(value.sessions) ? value.sessions.slice(0, 40).filter((session) => safeText(session?.id, "")).map((session) => ({
    id: safeText(session.id), title: safeText(session.title), status: safeText(session.status), updatedAt: safeText(session.updatedAt ?? session.createdAt)
  })) : Array.isArray(fallback.sessions) ? fallback.sessions : [];
  return {
    sessions,
    activeSessionId: safeText(value.activeSessionId, "") || safeText(fallback.activeSessionId, "") || sessions[0]?.id || "",
    messages: Array.isArray(value.messages) ? normalizeMessages(value.messages) : normalizeMessages(fallback.messages),
    provider: value.provider && typeof value.provider === "object" ? { name: safeText(value.provider.name), model: safeText(value.provider.model) } : fallback.provider || null,
    messageScope: safeText(value.messageScope, safeText(fallback.messageScope))
  };
}

export async function runDialogSend({ actions, actionsDisabled = false, message, sessionId = "" }) {
  if (actionsDisabled) throw new Error("actions_disabled");
  const text = typeof message === "string" ? message.trim() : "";
  if (!text || typeof actions?.sendChatMessage !== "function" || typeof actions?.readChatSession !== "function") throw new Error("dialog_send_unavailable");
  const sent = await actions.sendChatMessage(text, sessionId);
  if (!sent || typeof sent !== "object" || sent.ok === false || sent.error) throw new Error(sent?.error || "dialog_send_failed");
  const authoritativeSession = safeText(sent.agentMessage?.sessionId, "") || safeText(sent.userMessage?.sessionId, "") || sessionId;
  const payload = await actions.readChatSession(authoritativeSession);
  if (!normalizeDialogPayload(payload)) throw new Error(payload?.error || "dialog_read_failed");
  return payload;
}

export function useAiDialogController({ model, actions, actionsDisabled = false }) {
  const [payload, setPayload] = useState(() => normalizeDialogPayload(model?.dialog || {}) || normalizeDialogPayload({}) || {});
  const [input, setInput] = useState("");
  const [state, setState] = useState({ kind: "ready", detail: "" });
  const requestVersion = useRef(0);

  const read = useCallback(async (sessionId = "") => {
    if (typeof actions?.readChatSession !== "function") return;
    const version = ++requestVersion.current;
    setState({ kind: "processing", detail: "正在读取权威会话…" });
    try {
      const raw = await actions.readChatSession(sessionId);
      if (version !== requestVersion.current) return;
      const next = normalizeDialogPayload(raw, payload);
      if (!next) throw new Error(raw?.error || "dialog_read_failed");
      setPayload(next);
      setState({ kind: "ready", detail: "" });
    } catch (error) {
      if (version === requestVersion.current) setState({ kind: "failed", detail: error.message || String(error) });
    }
  }, [actions, payload]);

  useEffect(() => {
    read("");
    return () => { requestVersion.current += 1; };
  }, []);

  const send = async () => {
    if (actionsDisabled) return;
    const text = input.trim();
    if (!text || state.kind === "processing") return;
    const version = ++requestVersion.current;
    setState({ kind: "processing", detail: "消息已提交，等待服务器权威回复…" });
    try {
      const raw = await runDialogSend({ actions, actionsDisabled, message: text, sessionId: payload.activeSessionId });
      if (version !== requestVersion.current) return;
      const next = normalizeDialogPayload(raw, payload);
      if (!next) throw new Error("dialog_read_failed");
      setPayload(next);
      setInput("");
      setState({ kind: "ready", detail: "" });
    } catch (error) {
      if (version === requestVersion.current) setState({ kind: "failed", detail: error.message || String(error) });
    }
  };

  return { payload, input, setInput, state, read, send };
}

export function DialogMessages({ messages, onOutput, actionsDisabled = false }) {
  return (
    <div className="kordynV2AiDialogMessages" aria-live="polite" aria-label="权威对话消息">
      {messages.length ? messages.map((message) => {
        const agent = String(message.role).toLowerCase() !== "user";
        const Icon = agent ? Bot : UserRound;
        return (
          <article key={message.id} data-message-role={agent ? "agent" : "user"} data-kordyn-v2-message-id={message.id}>
            <span><Icon size={17} aria-hidden="true" /></span>
            <div><header><strong>{agent ? "AI 交易员" : "你"}</strong><small>{message.createdAt}</small></header><p>{message.content}</p>{agent && <button type="button" data-kordyn-v2-message-output={message.id} disabled={actionsDisabled} onClick={(event) => { if (!actionsDisabled) onOutput(message, event.currentTarget); }}><FileImage size={14} aria-hidden="true" />生成 PNG 输出</button>}</div>
          </article>
        );
      }) : <p className="kordynV2AiDialogEmpty" role="status"><strong>当前会话为空</strong><span>发送后仅显示服务器返回并重新读取的权威消息。</span></p>}
    </div>
  );
}

export function DialogComposer({ input, setInput, state, send, actionsDisabled = false }) {
  const processing = state.kind === "processing";
  return (
    <form className="kordynV2AiDialogComposer" onSubmit={(event) => { event.preventDefault(); if (!actionsDisabled) send(); }}>
      <label htmlFor="kordyn-v2-ai-dialog-input">消息输入</label>
      <textarea id="kordyn-v2-ai-dialog-input" rows={2} value={input} disabled={processing || actionsDisabled} placeholder="输入指令，与 AI 交易员对话…" onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (!actionsDisabled) send(); } }} />
      <button type="submit" disabled={actionsDisabled || processing || !input.trim()} aria-label="发送消息"><Send size={18} aria-hidden="true" /></button>
      <small data-dialog-state={state.kind}>{state.kind === "ready" ? "真实发送 · 服务器权威回复" : state.detail}</small>
    </form>
  );
}

export function AiDialogWorkspace({ model, actions = {}, actionsDisabled = false, onClose = () => {} }) {
  const controller = useAiDialogController({ model, actions, actionsDisabled });
  const closeRef = useRef(null);
  const dialogRef = useRef(null);
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
    <section ref={dialogRef} className="kordynV2AiDialogWorkspace" data-kordyn-v2-destination="ai/dialog" data-kordyn-v2-dialog-surface data-kordyn-v2-layout="dialog-workspace" role="dialog" aria-modal="true" aria-labelledby="kordyn-v2-ai-dialog-title" onKeyDown={onKeyDown}>
      <header><span><MessageSquareText size={23} aria-hidden="true" /><span><h1 id="kordyn-v2-ai-dialog-title" data-kordyn-v2-destination-title>对话</h1><small>{controller.payload.provider ? `${controller.payload.provider.name} / ${controller.payload.provider.model}` : unavailable}</small></span></span><button ref={closeRef} type="button" aria-label="关闭对话并返回任务" onClick={onClose}><X size={20} aria-hidden="true" /></button></header>
      <div className="kordynV2AiDialogWorkbench">
        <aside aria-label="对话会话"><strong>会话</strong>{controller.payload.sessions.map((session) => <button type="button" key={session.id} aria-pressed={session.id === controller.payload.activeSessionId} onClick={() => controller.read(session.id)}><span>{session.title}</span><small>{session.updatedAt}</small></button>)}{!controller.payload.sessions.length && <p>{unavailable}</p>}</aside>
        <main><DialogMessages messages={controller.payload.messages} actionsDisabled={actionsDisabled} onOutput={(message, trigger) => { if (!actionsDisabled) setOutput({ message, trigger }); }} /><DialogComposer {...controller} actionsDisabled={actionsDisabled} /></main>
      </div>
      {output && <AiOutputSheet message={output.message} actions={actions} actionsDisabled={actionsDisabled} returnFocus={output.trigger} onClose={() => setOutput(null)} />}
    </section>
  );
}
