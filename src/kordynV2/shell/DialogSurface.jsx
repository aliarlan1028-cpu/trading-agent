import { MessageSquareText, Send, X } from "lucide-react";
import { useEffect, useRef } from "react";

const unavailable = "Unavailable";
const safeText = (value) => (
  ["string", "number", "boolean"].includes(typeof value) && value !== "" ? String(value) : unavailable
);

function loadedMessages(data) {
  if (Array.isArray(data?.chatMessages)) return data.chatMessages;
  if (Array.isArray(data?.messages)) return data.messages;
  if (Array.isArray(data?.chat?.messages)) return data.chat.messages;
  return null;
}

export function DialogSurface({ data, onClose }) {
  const closeRef = useRef(null);
  const messages = loadedMessages(data);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <section
      className="kordynV2DialogSurface"
      data-kordyn-v2-destination="ai/dialog"
      data-kordyn-v2-dialog-surface
      role="dialog"
      aria-labelledby="kordyn-v2-dialog-title"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <span>
          <MessageSquareText size={24} strokeWidth={1.7} aria-hidden="true" />
          <h1 id="kordyn-v2-dialog-title" data-kordyn-v2-destination-title>对话</h1>
        </span>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="关闭对话并返回任务">
          <X size={19} aria-hidden="true" />
        </button>
      </header>
      <div className="kordynV2DialogTranscript" aria-label="已加载对话事实">
        {messages === null ? (
          <p role="status"><strong>{unavailable}</strong><span>当前来源没有发布对话记录。</span></p>
        ) : messages.length ? messages.map((message, index) => (
          <article key={safeText(message?.id) === unavailable ? index : safeText(message.id)}>
            <small>{safeText(message?.role)}</small>
            <p>{safeText(message?.content ?? message?.text)}</p>
          </article>
        )) : (
          <p role="status"><strong>当前会话为空</strong><span>权威来源已加载，但没有消息事实。</span></p>
        )}
      </div>
      <footer>
        <label htmlFor="kordyn-v2-dialog-input">消息输入</label>
        <span>
          <textarea
            id="kordyn-v2-dialog-input"
            rows={2}
            disabled
            placeholder="Unavailable — 当前 V2 计划未开放发送动作"
          />
          <button type="button" disabled aria-label="发送不可用"><Send size={18} aria-hidden="true" /></button>
        </span>
        <small>只读边界 · 不会调用交易或消息写入动作</small>
      </footer>
    </section>
  );
}
