import { CircleAlert, Download, FileImage, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const unavailable = "Unavailable";
const validIdentity = (value) => typeof value === "string"
  && value.length > 0 && value.length <= 240 && value === value.trim()
  && !/[\p{White_Space}\p{Cc}]/u.test(value)
  && !["unavailable", "unknown", "n/a", "—"].includes(value.toLowerCase());
const text = (value) => typeof value === "string" && value ? value : unavailable;

export function closedTradePosterEligibility(closedTrade) {
  if (closedTrade?.poster?.state === "eligible" && validIdentity(closedTrade.poster.executionId)) {
    return { state: "eligible", executionId: closedTrade.poster.executionId };
  }
  if (!closedTrade) return { state: "no_lifecycle", executionId: null };
  if (!closedTrade.financialBasisComplete || typeof closedTrade.netRealizedPnl !== "number" || !Number.isFinite(closedTrade.netRealizedPnl)) {
    return { state: "finance_unreconciled", executionId: null };
  }
  if (!validIdentity(closedTrade.executionOrderId)) return { state: "execution_unavailable", executionId: null };
  return { state: closedTrade.poster?.state || "execution_unavailable", executionId: closedTrade.poster?.executionId || null };
}

export async function runClosedTradePosterDownload({ closedTrade, actions = {}, actionsDisabled = false, onState = () => {}, isCurrent = () => true } = {}) {
  const eligibility = closedTradePosterEligibility(closedTrade);
  if (actionsDisabled) return { ok: false, error: "action_disabled" };
  if (eligibility.state !== "eligible" || typeof actions?.downloadClosedTradePoster !== "function") return { ok: false, error: eligibility.state };
  onState({ kind: "processing" });
  try {
    const result = await actions.downloadClosedTradePoster(eligibility.executionId);
    if (!isCurrent()) return result;
    if (result?.ok === false || result?.error) onState({ kind: "failed" });
    else onState({ kind: "returned" });
    return result;
  } catch {
    if (isCurrent()) onState({ kind: "failed" });
    return { ok: false, error: "poster_download_failed" };
  }
}

function stateCopy(state, eligibility) {
  if (state?.kind === "processing") return "正在等待服务端 PNG 下载响应…";
  if (state?.kind === "returned") return "下载请求已返回；请以浏览器实际下载结果为准。";
  if (state?.kind === "failed") return "服务端 PNG 下载未完成，请刷新权威事实后重试。";
  const copy = {
    no_lifecycle: "完整平仓生命周期尚未加载。",
    finance_unreconciled: "财务生命周期尚未完整对账，不能下载。",
    execution_unavailable: "缺少唯一关联 Execution，不能下载。",
    execution_not_closed: "关联 Execution 尚未处于 closed 状态。",
    eligible: "可调用现有服务端 PNG 下载边界。"
  };
  return copy[eligibility.state] || "下载当前不可用。";
}

export function ClosedTradeOutputSheet({ closedTrade = null, actions = {}, actionsDisabled = false, onClose = () => {}, returnFocus = null }) {
  const dialogRef = useRef(null);
  const activeRef = useRef(true);
  const [state, setState] = useState(null);
  const eligibility = closedTradePosterEligibility(closedTrade);
  const processing = state?.kind === "processing";
  const enabled = eligibility.state === "eligible" && !actionsDisabled && !processing && typeof actions?.downloadClosedTradePoster === "function";

  useEffect(() => {
    activeRef.current = true;
    const frame = window.requestAnimationFrame(() => dialogRef.current?.querySelector("[data-kordyn-v2-closed-output-close]")?.focus());
    return () => { activeRef.current = false; window.cancelAnimationFrame(frame); };
  }, []);

  const close = () => {
    onClose();
    const restore = () => returnFocus?.focus?.();
    if (typeof queueMicrotask === "function") queueMicrotask(restore);
    else window.setTimeout(restore, 0);
  };
  const download = () => runClosedTradePosterDownload({ closedTrade, actions, actionsDisabled, onState: setState, isCurrent: () => activeRef.current });
  const onKeyDown = (event) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...dialogRef.current.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return (
    <div className="kordynV2ClosedTradeScrim" data-kordyn-v2-closed-trade-output-scrim onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section ref={dialogRef} className="kordynV2ClosedTradeOutputSheet" role="dialog" aria-modal="true" aria-labelledby="kordyn-v2-closed-output-title" onKeyDown={onKeyDown}>
        <header><span><FileImage aria-hidden="true" /><strong id="kordyn-v2-closed-output-title">已平仓交易输出</strong><small>现有服务端 PNG 下载</small></span><button type="button" data-kordyn-v2-closed-output-close aria-label="关闭输出" onClick={close}><X aria-hidden="true" /></button></header>
        <div className="kordynV2ClosedTradeOutputBody">
          <section><strong>{text(closedTrade?.symbol)}</strong><small>Closed trade {text(closedTrade?.id)}</small></section>
          <dl><div><dt>Execution</dt><dd>{text(eligibility.executionId || closedTrade?.executionOrderId)}</dd></div><div><dt>财务基础</dt><dd>{text(closedTrade?.financialBasis)}</dd></div><div><dt>输出边界</dt><dd>服务端 PNG · 浏览器下载</dd></div></dl>
          <p role="status" data-output-state={state?.kind || eligibility.state}><CircleAlert aria-hidden="true" />{stateCopy(state, eligibility)}</p>
          <p>本动作只调用已部署的只读下载接口；请求返回不等于图片已保存，也不代表任何消息渠道已投递。</p>
        </div>
        <footer><button type="button" disabled={!enabled} onClick={download}><Download aria-hidden="true" />{processing ? "等待服务端…" : "下载服务端 PNG"}</button></footer>
      </section>
    </div>
  );
}
