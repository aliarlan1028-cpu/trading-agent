import { ArrowRight, BookOpen, Box, Check, Eye, FlaskConical, SlidersHorizontal, X } from "lucide-react";

const iconFor = (destination) => destination === "strategy" ? Box : destination === "capability" ? SlidersHorizontal : BookOpen;
const toneFor = (state) => state === "pending_owner" ? "pending" : state === "validating" ? "validating" : state === "verified" ? "verified" : "neutral";

export function OwnerDecisionQueue({ improvements = [], actions, actionsDisabled = false, selectedId = "", onSelect = () => {} }) {
  return (
    <section className="kordynV2OwnerQueue" data-action-source="review/improvements">
      <header><span><b>3</b><strong>Owner 队列</strong><small>{improvements.length} 个待处理</small></span><p>优化不会自行生效</p></header>
      <div>{improvements.map((item) => {
        const Icon = iconFor(item.destination);
        const pending = item.state === "pending_owner";
        const accepted = item.state === "accepted";
        return <article key={item.id} data-kordyn-v2-owner-candidate={item.id} data-owner-state={item.state} data-selected={item.id === selectedId}>
          <button type="button" className="kordynV2OwnerSelect" data-kordyn-v2-object-id={item.id} data-kordyn-v2-object-type="Owner candidate" onClick={() => onSelect(item)}><Icon size={20} aria-hidden="true" /><span><em>{item.destination || "candidate"}</em><strong>{item.title || item.id}</strong><small>{item.evidenceCount ?? 0} evidence linked · {item.version || "current"}</small></span><i data-tone={toneFor(item.state)}>{item.state}</i><ArrowRight size={15} aria-hidden="true" /></button>
          <footer>{pending ? <><button type="button" disabled={actionsDisabled} onClick={() => actions?.decideImprovement?.(item.id, "more_evidence", { version: item.version })}><Eye size={12} aria-hidden="true" />继续证据</button><button type="button" disabled={actionsDisabled} onClick={() => actions?.decideImprovement?.(item.id, "accept", { version: item.version })}><Check size={12} aria-hidden="true" />接受进入验证</button><button type="button" disabled={actionsDisabled} onClick={() => actions?.decideImprovement?.(item.id, "reject", { version: item.version })}><X size={12} aria-hidden="true" />驳回</button></> : accepted ? <button type="button" disabled={actionsDisabled} onClick={() => actions?.decideImprovement?.(item.id, "start_validation", { version: item.version })}><FlaskConical size={12} aria-hidden="true" />开始分阶段验证</button> : <button type="button" onClick={() => onSelect(item)}><Eye size={12} aria-hidden="true" />查看验证与发布</button>}</footer>
        </article>;
      })}{!improvements.length && <p>暂无 Owner 候选 · No Owner candidates</p>}</div>
    </section>
  );
}
