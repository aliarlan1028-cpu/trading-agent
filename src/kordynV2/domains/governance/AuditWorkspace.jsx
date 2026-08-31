import { ArrowRight, FileLock2 } from "lucide-react";

export function AuditWorkspace({ model = {}, onSelect = () => {} }) {
  const audit = model.operations?.audit || model.audit || {};
  const rows = audit.records || [];
  return (
    <section className="kordynV2GovernanceWorkspace kordynV2SingleRegistryWorkspace" data-kordyn-v2-governance-workspace="audit">
      <header className="kordynV2GovernanceTitle"><span><h1>审计</h1><p>不可变 · Immutable：只读取 actor、对象、动作、结果与 Trace。</p></span><div className="kordynV2AuditIntegrity"><FileLock2 size={16} /><span><strong>{audit.chain || "unknown"}</strong><small>WORM {audit.worm || "unknown"}</small></span></div></header>
      <section className="kordynV2OperationalRegistry kordynV2AuditLedger"><header><span><strong>审计账本</strong><small>最新记录优先</small></span><em>{rows.length}</em></header><div>{rows.map((row) => <button type="button" key={row.id} data-kordyn-v2-object-type="Audit log" data-kordyn-v2-object-id={row.id} onClick={() => onSelect({ id: row.id, type: "Audit log", workspaceId: "governance" })}><small>{row.createdAt || "Unavailable"}</small><span><strong>{row.action || "Audit event"}</strong><small>{row.actor || row.userName || "actor unavailable"} · {row.resource || row.target || "object unavailable"}</small></span><em>{row.status || row.result || "recorded"}</em><code>{row.traceId || row.hash || row.id}</code><ArrowRight size={15} /></button>)}{!rows.length && <p>当前没有已加载审计记录。</p>}</div></section>
    </section>
  );
}

