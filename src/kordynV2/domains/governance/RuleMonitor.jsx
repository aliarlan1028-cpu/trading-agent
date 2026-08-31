import { Braces, CheckCircle2, ShieldAlert } from "lucide-react";

export function RuleMonitor({ rules = {}, onSelect = () => {} }) {
  const hits = Array.isArray(rules.recentHits) ? rules.recentHits : [];
  return (
    <section className="kordynV2RuleMonitor" aria-labelledby="kordyn-v2-rule-title">
      <header><span><strong id="kordyn-v2-rule-title">确定性规则监控</strong><small>这里显示当前评估；编辑只在配置中完成</small></span><em>{rules.enabled ?? "Unavailable"}/{rules.total ?? "Unavailable"}</em></header>
      <div className="kordynV2RuleStats"><span><Braces size={16} /><b>{rules.total ?? "—"}</b><small>规则总数</small></span><span><CheckCircle2 size={16} /><b>{rules.enabled ?? "—"}</b><small>当前生效</small></span><span><ShieldAlert size={16} /><b>{hits.length}</b><small>近期评估</small></span></div>
      <div className="kordynV2RuleLedger">
        {hits.slice(0, 4).map((row, index) => <button type="button" key={row.id || index} data-kordyn-v2-object-type="Risk check" data-kordyn-v2-object-id={row.id || row.ruleId} onClick={() => onSelect({ id: row.id || row.ruleId, type: "Risk check", workspaceId: "governance" })}>
          <span><strong>{row.ruleName || row.ruleId || "Risk rule"}</strong><small>{row.reason || row.status || "Evaluated"}</small></span><em data-tone={/fail|block|reject/i.test(String(row.status)) ? "critical" : "healthy"}>{row.status || "recorded"}</em>
        </button>)}
        {!hits.length && <p>尚无近期规则评估记录。</p>}
      </div>
    </section>
  );
}

