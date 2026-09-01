import {
  Activity,
  Bot,
  ChevronRight,
  CircleHelp,
  Database,
  LockKeyhole,
  MapPin,
  ShieldCheck,
  X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  buildAiSupportSuggestions,
  resolveAiSupportDestination,
  safeAiSupportContext
} from "../viewModels/aiSupport.js";

const unavailable = "Unavailable";
const safeText = (value) => (
  ["string", "number", "boolean"].includes(typeof value) && String(value).trim()
    ? String(value)
    : unavailable
);

const STATE_EXPLANATIONS = Object.freeze({
  ready: "当前页面的权威事实已经加载，我可以解释它们并带你前往相关页面。",
  stale: "当前页面保留的是最后有效事实。使用前请核对来源、时间与刷新状态。",
  degraded: "部分权威来源正在降级，页面只保留有来源与时间证明的最后有效事实。",
  failed: "当前权威来源加载失败。我只能说明失败边界，并带你前往运行或恢复页面。",
  forbidden: "当前身份无权读取这个范围。我不会展示受限对象或推断隐藏事实。",
  disabled: "当前状态禁用了页面能力。我可以解释限制，但不会绕过它。",
  loading: "权威事实仍在加载。我不会把空白解释为零或正常。",
  not_loaded: "权威事实尚未加载。我不会根据缺失内容生成结论。",
  empty: "当前范围没有可解释的权威事实。我不会把空结果解释为零或正常。",
  processing: "系统正在处理当前请求。我会保留当前状态，但不会把处理中说成已完成。",
  approval: "当前事项需要授权确认。在你确认前我只解释原因和边界，不会代你批准。",
  partial: "当前请求只返回了部分权威结果。我会明确已完成与缺失部分，不把部分成功说成完整成功。",
  "no-result": "当前请求尚无可验证结果。我不会根据缺失结果生成结论。",
  "long-content": "完整权威内容已经加载。内容较长，我会保留来源与上下文，分段解释。",
  "large-list": "完整权威列表已经加载。列表较长，我会保留范围与来源，分段解释。"
});

function SupportContent({ context, onNavigate }) {
  const safeContext = safeAiSupportContext(context);
  const facts = safeContext.facts;
  const location = safeContext.location;
  const selection = safeContext.selection;
  const state = safeContext.state;
  const suggestions = buildAiSupportSuggestions(safeContext);
  const selectedId = safeText(selection.id);
  const stateKind = safeText(state.kind).toLowerCase();
  const explanation = STATE_EXPLANATIONS[stateKind]
    || "当前状态没有可验证的解释。我不会猜测未加载的事实。";

  const navigate = (target) => {
    const resolved = resolveAiSupportDestination(target);
    if (!resolved || typeof onNavigate !== "function") return;
    onNavigate(resolved.domainId, resolved.workspaceId);
  };

  return (
    <div className="kordynV2AiSupportContent" data-kordyn-v2-ai-support-content>
      <div className="kordynV2AiSupportIdentity">
        <span><Bot size={22} strokeWidth={1.7} aria-hidden="true" /></span>
        <div>
          <strong>AI 客服</strong>
          <em><i aria-hidden="true" />只读助理</em>
        </div>
      </div>

      <p className="kordynV2AiSupportBoundary">
        <LockKeyhole size={16} strokeWidth={1.7} aria-hidden="true" />
        <span>我只解释已授权且当前可见的事实，不能下单、授权或修改配置。</span>
      </p>

      <section className="kordynV2AiSupportScope" aria-label="当前支持范围">
        <div>
          <MapPin size={15} aria-hidden="true" />
          <span>当前范围</span>
          <strong>{safeText(location.domainLabel)} · {safeText(location.workspaceLabel)}</strong>
        </div>
        <div>
          <CircleHelp size={15} aria-hidden="true" />
          <span>当前对象</span>
          <strong>{selectedId === unavailable ? "未选择对象" : `${safeText(selection.type)} · ${selectedId}`}</strong>
        </div>
      </section>

      <section
        className="kordynV2AiSupportState"
        data-kordyn-v2-ai-support-state={stateKind}
        aria-label="当前状态解释"
      >
        <header><Activity size={16} aria-hidden="true" /><strong>{stateKind}</strong></header>
        <p>{explanation}</p>
        <small>{safeText(state.message)}</small>
      </section>

      <dl className="kordynV2AiSupportFacts" aria-label="当前可解释事实">
        <div><dt><Database size={14} aria-hidden="true" /> 来源</dt><dd>{safeText(facts.source)}</dd></div>
        <div><dt>时间</dt><dd>{safeText(facts.asOf)}</dd></div>
        <div><dt>账户</dt><dd>{safeText(facts.account)}</dd></div>
        <div><dt>运行</dt><dd>{safeText(facts.runtime)}</dd></div>
        <div><dt><ShieldCheck size={14} aria-hidden="true" /> 风险</dt><dd>{safeText(facts.risk)}</dd></div>
      </dl>

      <section className="kordynV2AiSupportQuestions" aria-label="可以解释的问题">
        <strong>你可以问</strong>
        <p>为什么显示当前状态？</p>
        <p>当前对象来自哪里？</p>
        <p>缺少哪个来源或权限？</p>
      </section>

      <nav className="kordynV2AiSupportSuggestions" aria-label="只读导航建议">
        {suggestions.length ? suggestions.map((target) => (
          <button
            key={`${target.domainId}/${target.workspaceId}`}
            type="button"
            data-kordyn-v2-ai-support-target={`${target.domainId}/${target.workspaceId}`}
            onClick={() => navigate(target)}
          >
            <span><strong>{target.label}</strong><small>已注册生产页面 · 只读导航</small></span>
            <ChevronRight size={17} aria-hidden="true" />
          </button>
        )) : <p>没有可验证的相关页面。</p>}
      </nav>
    </div>
  );
}

export function AiSupport({ context, onNavigate, presentation = "desktop" }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (presentation !== "desktop" || !open) return undefined;
    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector("[data-kordyn-v2-ai-support-close]")?.focus();
    });
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      queueMicrotask(() => triggerRef.current?.focus());
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, presentation]);

  if (presentation === "content") {
    return <SupportContent context={context} onNavigate={onNavigate} />;
  }

  const close = () => {
    setOpen(false);
    queueMicrotask(() => triggerRef.current?.focus());
  };

  const onDialogKeyDown = (event) => {
    if (event.key !== "Tab") return;
    const focusable = [...panelRef.current.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter((node) => node.getAttribute("aria-hidden") !== "true");
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !panelRef.current.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !panelRef.current.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="kordynV2AiSupport" data-kordyn-v2-ai-support>
      {open && (
        <section
          ref={panelRef}
          className="kordynV2AiSupportPanel"
          data-kordyn-v2-ai-support-panel
          role="dialog"
          aria-labelledby="kordyn-v2-ai-support-title"
          onKeyDown={onDialogKeyDown}
        >
          <header>
            <span><Bot size={18} aria-hidden="true" /><strong id="kordyn-v2-ai-support-title">AI 客服 · 只读助理</strong></span>
            <button type="button" data-kordyn-v2-ai-support-close aria-label="关闭 AI 客服" onClick={close}>
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          <div className="kordynV2AiSupportScroll" data-kordyn-v2-ai-support-scroll>
            <SupportContent context={context} onNavigate={onNavigate} />
          </div>
        </section>
      )}
      <button
        ref={triggerRef}
        className="kordynV2AiSupportTrigger"
        data-kordyn-v2-ai-support-trigger
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="AI 客服，只读助理"
        onClick={() => setOpen((current) => !current)}
      >
        <Bot size={21} strokeWidth={1.7} aria-hidden="true" />
        <span><strong>AI 客服</strong><small>只读助理 · 解释与导航</small></span>
      </button>
    </div>
  );
}
