import { ArrowUpRight, CircleGauge, GitBranch, ShieldCheck } from "lucide-react";

const text = (value, fallback = "Unavailable") => value === null || value === undefined || value === "" ? fallback : String(value);
const list = (value) => Array.isArray(value) ? value : [];

export function StrategyInspector({ strategy = null, actions, actionsDisabled = false, compact = false, onOpenStudio = () => {} }) {
  if (!strategy) return <aside className="kordynV2StrategyInspector is-empty"><CircleGauge aria-hidden="true" /><strong>选择一条正式策略</strong><p>查看当前版本、溯源和验证证据。</p></aside>;
  const native = strategy.provenance?.kind === "system-native";
  const canToggle = !native && Boolean(strategy.versionId || strategy.id);
  const enabled = ["active", "published", "live_probation"].includes(strategy.lifecycle?.stage) || strategy.enabled === true;
  const toggle = () => {
    const id = strategy.versionId || strategy.id;
    return enabled ? actions?.disableStrategy?.(id) : actions?.enableStrategy?.(id);
  };
  return (
    <aside className={`kordynV2StrategyInspector${compact ? " is-compact" : ""}`} data-kordyn-v2-strategy-inspector={strategy.id}>
      <header>
        <span><small>{strategy.provenance?.label || "Unavailable"}</small><strong>{text(strategy.name)}</strong><code>{text(strategy.versionId || strategy.version)}</code></span>
        <em data-stage={strategy.lifecycle?.stage}>{text(strategy.status || strategy.lifecycle?.stage)}</em>
      </header>
      <div className="kordynV2StrategyContract">
        <section><small>产品合同</small><dl><div><dt>方向</dt><dd>{text(strategy.direction)}</dd></div><div><dt>周期</dt><dd>{text(strategy.timeframe)}</dd></div><div><dt>模板</dt><dd>{text(strategy.template)}</dd></div></dl></section>
        <section><small>关键能力</small><ul>{list(strategy.roles).slice(0, 3).map((role) => <li key={String(role)}><ShieldCheck size={13} aria-hidden="true" />{text(role)}</li>)}{!list(strategy.roles).length && <li>Unavailable</li>}</ul></section>
      </div>
      <section className="kordynV2StrategyLineage"><header><GitBranch size={14} aria-hidden="true" /><strong>谱系与版本</strong></header><div><span>{strategy.provenance?.label || "Unavailable"}</span><i aria-hidden="true" /> <span>{text(strategy.provenance?.sourceTitle || strategy.provenance?.sourceId || strategy.origin)}</span><i aria-hidden="true" /> <b>{text(strategy.versionId || strategy.version)}</b></div></section>
      <section className="kordynV2StrategyEvidence"><small>验证证据</small><div><span>自动测试<strong>{text(strategy.evidence?.tests?.passed ?? strategy.generatedTests?.passed)}</strong></span><span>实盘平仓<strong>{text(strategy.metrics?.closedTrades ?? strategy.liveTrades)}</strong></span><span>胜率<strong>{strategy.winRatePct === undefined ? "Unavailable" : `${strategy.winRatePct}%`}</strong></span><span>PF<strong>{text(strategy.profitFactor)}</strong></span></div></section>
      <footer>
        <button type="button" onClick={onOpenStudio}>进入工作室 <ArrowUpRight size={14} aria-hidden="true" /></button>
        <button type="button" data-kordyn-v2-strategy-toggle={native ? "system-managed" : enabled ? "disable" : "enable"} disabled={actionsDisabled || !canToggle} onClick={toggle}>{native ? "系统管理 · System managed" : enabled ? "从 AI 可选集移除" : "加入 AI 可选集"}</button>
      </footer>
    </aside>
  );
}
