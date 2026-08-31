import { EditorFrame } from "./editorShared.jsx";

export function RiskRuleEditor({ model = {}, actions, actionsDisabled = false }) {
  const rules = model.rules || [];
  return <EditorFrame id="risk" title="风险规则" description="确定性规则的启停与动作修改只在这里完成。" target={`${rules.filter((row) => row.enabled !== false).length} enabled`} current={`${rules.length} registered`} actionsDisabled={actionsDisabled} onSubmit={(event) => event.preventDefault()}><div className="kordynV2ConfigRuleRows">{rules.map((rule) => <article key={rule.id}><span><strong>{rule.name || rule.id}</strong><small>{rule.systemManaged ? "系统内置 · 不可改写" : rule.action || "action unavailable"}</small></span><button type="button" disabled={actionsDisabled || rule.systemManaged} onClick={() => actions?.updateRiskRule?.(rule.id, { enabled: rule.enabled === false })}>{rule.enabled === false ? "启用" : "停用"}</button></article>)}{!rules.length && <p>当前没有已加载风险规则。</p>}</div></EditorFrame>;
}

