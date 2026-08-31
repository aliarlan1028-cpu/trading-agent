import { AlertTriangle, Check, FlaskConical, Play, Plus, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";

const list = (value) => Array.isArray(value) ? value : [];
const text = (value, fallback = "Unavailable") => value === null || value === undefined || value === "" ? fallback : String(value);

export function StrategyStudio({ drafts = [], actions, actionsDisabled = false }) {
  const [selectedId, setSelectedId] = useState(drafts[0]?.id || "");
  const [prompt, setPrompt] = useState("");
  const [outcome, setOutcome] = useState(null);
  const selected = drafts.find((draft) => draft.id === selectedId) || drafts[0] || null;
  const run = async (operation) => {
    setOutcome({ kind: "processing", message: "等待服务端结果…" });
    try {
      const result = await operation();
      setOutcome(result?.ok === false
        ? { kind: "failed", message: result.error || "操作未完成" }
        : { kind: "complete", message: "服务端已返回，请以刷新后的事实为准。" });
      return result;
    } catch {
      setOutcome({ kind: "failed", message: "操作未完成，请检查连接后重试。" });
      return null;
    }
  };
  const generate = () => run(() => actions?.createStrategyDraft?.(prompt));
  const runOos = () => run(async () => {
    let result = null;
    for (const symbol of list(selected?.blueprint?.symbols)) result = await actions?.backtestStrategyDraft?.(selected.id, symbol);
    return result;
  });
  const busy = actionsDisabled || outcome?.kind === "processing";

  return (
    <section className="kordynV2StrategyStudio" data-kordyn-v2-strategy-studio>
      <header><span><FlaskConical size={16} aria-hidden="true" /><strong>策略工作室</strong><small>自然语言表达意图；确定性编译器定义执行。草稿不会直接启动实盘。</small></span><em>{drafts.length} 草稿</em></header>
      <div className="kordynV2StrategyStudioGrid">
        <section className="kordynV2StrategyDraftComposer">
          <label htmlFor="kordyn-v2-strategy-prompt">新建白名单模板草稿</label>
          <textarea id="kordyn-v2-strategy-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="交易对、周期、方向、入场、止损和止盈" />
          <button type="button" disabled={busy || prompt.trim().length < 12} onClick={generate}><Sparkles size={14} aria-hidden="true" />生成确定性草稿</button>
        </section>
        <section className="kordynV2StrategyDraftList">
          <header><strong>草稿队列</strong><small>未验证版本不会进入 Registry</small></header>
          {drafts.map((draft) => <button type="button" key={draft.id} data-selected={draft.id === selected?.id} onClick={() => setSelectedId(draft.id)}><span><strong>{text(draft.blueprint?.name || draft.id)}</strong><small>{list(draft.blueprint?.symbols).join(" / ") || "Unavailable"} · {text(draft.blueprint?.timeframe)}</small></span><em data-stage={draft.lifecycle?.stage}>{text(draft.status || draft.lifecycle?.stage)}</em></button>)}
          {!drafts.length && <p>还没有策略草稿。</p>}
        </section>
        <section className="kordynV2StrategyValidation" data-kordyn-v2-strategy-validation>
          {selected ? <>
            <header><span><strong>{text(selected.blueprint?.name || selected.id)}</strong><small>{text(selected.contentHash)}</small></span><em data-release={selected.release?.state}>{text(selected.release?.state)}</em></header>
            <div className="kordynV2StrategyValidationFlow">
              <article data-pass={selected.validation?.testsPassed}><Check size={14} aria-hidden="true" /><span><small>自动测试</small><strong>{selected.generatedTests?.passed ?? 0}/{selected.generatedTests?.total ?? 0}</strong></span></article>
              {selected.validation?.oos?.rows?.map((row) => <article key={row.symbol} data-pass={row.passed}><span>{row.passed ? <Check size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}</span><span><small>{row.symbol}</small><strong>{row.status}</strong></span></article>)}
              <article data-pass={selected.release?.ready}><Plus size={14} aria-hidden="true" /><span><small>Owner 发布</small><strong>{selected.release?.state}</strong></span></article>
            </div>
            <footer>
              <button type="button" disabled={busy} onClick={() => run(() => actions?.testStrategyDraft?.(selected.id))}><RefreshCw size={14} aria-hidden="true" />重新测试</button>
              <button type="button" disabled={busy || !selected.validation?.testsPassed} onClick={runOos}><Play size={14} aria-hidden="true" />逐交易对运行 OOS</button>
              <button type="button" data-kordyn-v2-action="publish" disabled={busy || !selected.release?.ready} onClick={() => run(() => actions?.publishStrategyDraft?.(selected.id, selected.contentHash))}><Plus size={14} aria-hidden="true" />发布到内部 Registry</button>
            </footer>
          </> : <p>选择或创建草稿以查看验证链。</p>}
        </section>
      </div>
      {outcome && <p className="kordynV2StrategyOutcome" data-outcome={outcome.kind}>{outcome.message}</p>}
    </section>
  );
}
