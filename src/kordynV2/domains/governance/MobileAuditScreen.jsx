import { ArrowRight, FileLock2 } from "lucide-react";

export function MobileAuditScreen({ model = {}, onSelect = () => {} }) {
  const audit = model.operations?.audit || {};
  return <section className="kordynV2GovernanceMobile" data-kordyn-v2-governance-mobile="audit"><header><h2>审计</h2><p>不可变证据账本</p></header><section className="kordynV2MobileAuditIntegrity"><FileLock2 size={21} /><span><strong>{audit.chain || "unknown"}</strong><small>WORM {audit.worm || "unknown"}</small></span></section><section className="kordynV2MobileGovernanceList">{(audit.records || []).map((row) => <button type="button" key={row.id} data-kordyn-v2-object-type="Audit log" data-kordyn-v2-object-id={row.id} onClick={() => onSelect({ id: row.id, type: "Audit log", workspaceId: "governance" })}><i data-tone="healthy" /><span><strong>{row.action || "Audit event"}</strong><small>{row.actor || "actor unavailable"} · {row.createdAt || "time unavailable"}</small></span><em>{row.status || "recorded"}</em><ArrowRight size={16} /></button>)}</section></section>;
}

