import { Download, FileImage, Languages, X } from "lucide-react";
import { toPng as htmlToPng } from "html-to-image";
import { useEffect, useRef, useState } from "react";
import { PosterCanvas } from "./PosterCanvas.jsx";

export function translationTextFromResult(result) {
  return typeof result?.translated === "string" && result.translated.trim() ? result.translated.trim() : null;
}

export async function exportPosterPng({ node, filename, fonts = document.fonts, toPng = htmlToPng, download }) {
  if (!node || typeof toPng !== "function" || typeof download !== "function") throw new Error("poster_export_unavailable");
  if (fonts?.ready) await fonts.ready;
  const dataUrl = await toPng(node, { pixelRatio: 2, cacheBust: true, backgroundColor: "#07111f" });
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png")) throw new Error("poster_png_invalid");
  await download(dataUrl, filename);
  return dataUrl;
}

const sourceContent = (message) => typeof message?.content === "string" ? message.content.trim() : "";

export function AiOutputSheet({ message, actions = {}, onClose = () => {}, returnFocus = null }) {
  const [language, setLanguage] = useState("zh");
  const [english, setEnglish] = useState("");
  const [state, setState] = useState({ kind: "ready", detail: "" });
  const dialogRef = useRef(null);
  const posterRef = useRef(null);
  const source = sourceContent(message);
  const processing = state.kind === "translating" || state.kind === "exporting";

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => dialogRef.current?.querySelector("[data-kordyn-v2-output-close]")?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (processing) return undefined;
    const frame = window.requestAnimationFrame(() => {
      if (!dialogRef.current?.contains(document.activeElement)) {
        dialogRef.current?.querySelector("[data-kordyn-v2-output-close]")?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [processing, state.kind]);

  const close = () => {
    onClose();
    const focus = () => returnFocus?.focus?.();
    if (typeof queueMicrotask === "function") queueMicrotask(focus);
    else window.setTimeout(focus, 0);
  };

  const chooseEnglish = async () => {
    if (english) { setLanguage("en"); return; }
    if (!source || typeof actions.translatePoster !== "function") { setLanguage("zh"); setState({ kind: "failed", detail: "英文翻译暂时不可用，已保留中文原稿。" }); return; }
    setState({ kind: "translating", detail: "等待服务器翻译" });
    try {
      const result = await actions.translatePoster(source);
      const translated = translationTextFromResult(result);
      if (!translated) throw new Error(result?.error || "翻译未返回 translated 字段");
      setEnglish(translated);
      setLanguage("en");
      setState({ kind: "ready", detail: "" });
    } catch (error) {
      void error;
      setLanguage("zh");
      setState({ kind: "failed", detail: "英文翻译暂时不可用，已保留中文原稿。" });
    }
  };

  const download = async () => {
    setState({ kind: "exporting", detail: "正在生成 PNG" });
    try {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "");
      await exportPosterPng({
        node: posterRef.current,
        filename: `kordyn-ai-${language}-${stamp}.png`,
        download: actions.downloadPoster
      });
      setState({ kind: "succeeded", detail: "PNG 已交给下载适配器" });
    } catch (error) {
      setState({ kind: "failed", detail: error.message || String(error) });
    }
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...dialogRef.current.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return (
    <div className="kordynV2AiSheetScrim" data-kordyn-v2-ai-output-scrim onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section ref={dialogRef} className="kordynV2AiOutputSheet" data-kordyn-v2-ai-output-sheet role="dialog" aria-modal="true" aria-labelledby="kordyn-v2-output-title" onKeyDown={onKeyDown}>
        <header>
          <span><FileImage size={21} aria-hidden="true" /><strong id="kordyn-v2-output-title">当前分析输出</strong><small>唯一当前风格 · PNG</small></span>
          <button type="button" data-kordyn-v2-output-close aria-label="关闭输出" onClick={close}><X size={20} aria-hidden="true" /></button>
        </header>
        <div className="kordynV2AiOutputToolbar">
          <div role="group" aria-label="输出语言">
            <button type="button" aria-pressed={language === "zh"} disabled={processing} onClick={() => setLanguage("zh")}>中文</button>
            <button type="button" aria-pressed={language === "en"} disabled={processing} onClick={chooseEnglish}><Languages size={15} aria-hidden="true" />English</button>
          </div>
          <button type="button" data-kordyn-v2-output-png disabled={processing || !source || (language === "en" && !english) || typeof actions.downloadPoster !== "function"} onClick={download}>
            <Download size={16} aria-hidden="true" />{state.kind === "exporting" ? "生成中…" : "下载 PNG"}
          </button>
        </div>
        {state.kind !== "ready" && <p className="kordynV2AiOutputState" data-output-state={state.kind} role="status">{state.detail}</p>}
        <div className="kordynV2AiOutputPreview">
          <div ref={posterRef}><PosterCanvas message={message} language={language} content={language === "en" ? english : source} /></div>
        </div>
      </section>
    </div>
  );
}
