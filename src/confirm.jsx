import { useEffect, useRef, useState } from "react";

// 全站统一的应用内确认弹窗,替代原生 window.confirm/prompt(浏览器灰框很丑)。
// 用法:uiConfirm("要删除吗?").then(ok => { if (ok) ... })  或  if (await uiConfirm("...")) ...
// 未挂载 ConfirmHost 时兜底回退到 window.confirm,保证永不静默失败。
let _push = null;
let _seq = 0;

export function uiConfirm(message, opts = {}) {
  const text = typeof message === "string" ? message : String(message ?? "");
  if (!_push) return Promise.resolve(window.confirm(text));
  return new Promise((resolve) => {
    _push({ id: ++_seq, message: text, resolve, title: opts.title, confirmLabel: opts.confirmLabel, cancelLabel: opts.cancelLabel, danger: opts.danger });
  });
}

// 也提供一个输入版(替代 window.prompt),返回字符串或 null。
export function uiPrompt(message, opts = {}) {
  const text = typeof message === "string" ? message : String(message ?? "");
  if (!_push) { const v = window.prompt(text, opts.defaultValue || ""); return Promise.resolve(v); }
  return new Promise((resolve) => {
    _push({ id: ++_seq, message: text, resolve, title: opts.title, confirmLabel: opts.confirmLabel, cancelLabel: opts.cancelLabel, input: true, defaultValue: opts.defaultValue || "", placeholder: opts.placeholder });
  });
}

export function ConfirmHost() {
  const [item, setItem] = useState(null);
  const [value, setValue] = useState("");
  const returnFocusRef = useRef(null);
  const inputRef = useRef(null);
  const cancelRef = useRef(null);
  useEffect(() => {
    _push = (it) => {
      returnFocusRef.current = document.activeElement instanceof globalThis.HTMLElement ? document.activeElement : null;
      setValue(it.defaultValue || "");
      setItem(it);
    };
    return () => { _push = null; };
  }, []);
  useEffect(() => {
    if (!item) return;
    (item.input ? inputRef.current : cancelRef.current)?.focus();
  }, [item]);
  if (!item) return null;
  const done = (result) => {
    const it = item;
    setItem(null);
    it.resolve(result);
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  };
  return (
    <div className="cfmOverlay" onMouseDown={() => done(item.input ? null : false)}>
      <div className={`cfmCard ${item.danger ? "cfmCard--danger" : "cfmCard--ordinary"}`} role="dialog" aria-modal="true" aria-label={item.title || (item.input ? "请输入" : "确认操作")} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); done(item.input ? null : false); } }}>
        <div className="cfmHead">{item.title || (item.input ? "请输入" : "确认操作")}</div>
        <p className="cfmMsg">{item.message}</p>
        {item.input && (
          <input ref={inputRef} className="cfmInput" autoFocus value={value} placeholder={item.placeholder || ""}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.stopPropagation(); done(value); }
              if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(null); }
            }} />
        )}
        <div className="cfmFoot">
          <button ref={cancelRef} className="cfmBtn cfmCancel" onClick={() => done(item.input ? null : false)}>{item.cancelLabel || "取消"}</button>
          <button className={`cfmBtn ${item.danger ? "cfmDanger" : "cfmOk"}`} onClick={() => done(item.input ? value : true)}>{item.confirmLabel || "确定"}</button>
        </div>
      </div>
    </div>
  );
}
