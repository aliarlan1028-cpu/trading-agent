import { ArrowLeft, ChevronRight, Clock3, ShieldCheck, WalletCards } from "lucide-react";
import { AccountRegistry, ReconciliationInspector, resourceTone } from "./AccountWorkspace.jsx";

const unavailable = "Unavailable";
const safe = (value) => typeof value === "string" && value ? value : unavailable;
const money = (value) => typeof value === "number" && Number.isFinite(value)
  ? new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
  : unavailable;

export function MobileAccountScreen({ model, truth, state, selection, actionsDisabled = false, actionOutcome = null, view = "list", onSelect = () => {}, onReconcile = () => {}, onOpenList = () => {}, onOpenDetail = () => {}, detailHeadingRef = null, returnFocusRef = null }) {
  const reconciliation = model?.reconciliation || { state: "absent", loaded: false, latest: null };
  const tone = resourceTone(state?.kind);
  if (view === "detail") {
    return (
      <div className="kordynV2AccountMobile kordynV2MobileAccount" data-kordyn-v2-mobile-account-view="detail">
        <header className="kordynV2AccountMobileNav"><button type="button" onClick={(event) => onOpenList(event)}><ArrowLeft size={18} aria-hidden="true" />账户健康</button><span><Clock3 size={15} aria-hidden="true" />{safe(state?.lastValidAt)}</span></header>
        <ReconciliationInspector reconciliation={reconciliation} state={state} actionsDisabled={actionsDisabled} actionOutcome={actionOutcome} onReconcile={onReconcile} mobile headingRef={detailHeadingRef} />
      </div>
    );
  }
  return (
    <div className="kordynV2AccountMobile kordynV2MobileAccount" data-kordyn-v2-mobile-account-view="list">
      <header className="kordynV2AccountMobileHeading"><h2>账户健康</h2><p>资金、同步与对账保持分层展示。</p></header>
      <AccountRegistry model={model} selection={selection} onSelect={onSelect} />
      <section className="kordynV2MobileAccountTruth" aria-label="账户事实">
        <header><span><WalletCards size={19} aria-hidden="true" /><strong>账户聚合事实</strong></span></header>
        <dl>
          <div><dt>总权益</dt><dd>{money(truth?.equity)}</dd></div>
          <div><dt>可用</dt><dd>{money(truth?.available)}</dd></div>
          <div><dt>敞口</dt><dd>{money(truth?.exposure)}</dd></div>
          <div><dt>风险</dt><dd>{safe(truth?.risk)}</dd></div>
        </dl>
        <footer><span data-resource-tone={tone}><ShieldCheck size={15} aria-hidden="true" />{safe(state?.kind)}</span><time dateTime={state?.lastValidAt === unavailable ? undefined : state?.lastValidAt}>{safe(state?.lastValidAt)}</time></footer>
      </section>
      <button ref={returnFocusRef} className="kordynV2MobileReconciliationLink" type="button" onClick={(event) => onOpenDetail(event)}>
        <span><strong>对账详情</strong><small>{reconciliation.latest ? `${safe(reconciliation.latest.status)} · ${safe(reconciliation.latest.createdAt)}` : reconciliation.loaded ? "尚无报告" : "明确未加载"}</small></span>
        <ChevronRight size={19} aria-hidden="true" />
      </button>
    </div>
  );
}
