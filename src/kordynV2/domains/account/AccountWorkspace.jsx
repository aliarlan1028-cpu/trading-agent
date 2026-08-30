import { AlertTriangle, CheckCircle2, Clock3, Database, RefreshCw, ShieldCheck, WalletCards } from "lucide-react";

const unavailable = "Unavailable";
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const safe = (value) => typeof value === "string" && value ? value : unavailable;
const money = (value) => finite(value)
  ? new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
  : unavailable;
const validTruthModes = new Set(["full", "compact", "critical"]);

export const validatedTruthMode = (mode) => validTruthModes.has(mode) ? mode : "unavailable";
export const resourceTone = (kind) => ["ready", "fresh"].includes(kind)
  ? "healthy"
  : ["stale", "degraded", "partial", "approval"].includes(kind)
    ? "warning"
    : ["failed", "forbidden"].includes(kind)
      ? "critical"
      : "unavailable";

export function accountSelectionCandidate(account) {
  return typeof account?.id === "string" && account.id && !["unavailable", "unknown", "n/a", "—"].includes(account.id.toLowerCase())
    ? { id: account.id, type: "Account", workspaceId: "account", route: "marketAccount", sourceSection: "cockpit" }
    : null;
}

function selectedAccountFor(model, selection) {
  if (selection?.object?.type !== "Account" || typeof selection.object.id !== "string") return null;
  const matches = (Array.isArray(model?.accounts) ? model.accounts : []).filter((account) => account.id === selection.object.id);
  return matches.length === 1 ? matches[0] : null;
}

function reconciliationPresentation(reconciliation) {
  if (!reconciliation?.loaded) return { label: "明确未加载", tone: "unavailable", detail: "当前工作区没有收到权威对账事实。" };
  if (!reconciliation.latest) return { label: "尚无报告", tone: "unavailable", detail: "等待首次服务端对账报告。" };
  const status = safe(reconciliation.latest.status);
  if (/^(?:ok|passed|healthy|success)$/iu.test(status)) return { label: "账实一致", tone: "healthy", detail: "最新服务端报告未发现差异。" };
  if (/needs_attention|failed|mismatch|critical|error/iu.test(status)) return { label: "需要处理", tone: "critical", detail: "最新服务端报告存在需要处理的差异。" };
  if (/degraded|partial|pending|stale|warning/iu.test(status)) return { label: "部分差异", tone: "warning", detail: "对账事实尚未完全收口。" };
  return { label: status, tone: "unavailable", detail: "显示服务端原始状态，不推断成功。" };
}

function AccountMetric({ label, value, icon: Icon }) {
  return <div><dt><Icon size={15} aria-hidden="true" />{label}</dt><dd>{money(value)}</dd></div>;
}

export function AccountRegistry({ model, selection, onSelect }) {
  const accounts = Array.isArray(model?.accounts) ? model.accounts : [];
  const state = model?.availability?.accounts?.state || "absent";
  const selected = selectedAccountFor(model, selection);
  const emptyCopy = state === "loaded" ? "当前没有账户" : state === "invalid" ? "账户事实不可用" : "账户事实明确未加载";
  return (
    <section className="kordynV2AccountRegistry" aria-label="账户列表">
      <header><h2>账户对象</h2><span>{state === "loaded" ? accounts.length : unavailable}</span></header>
      <div>
        {accounts.map((account) => {
          const candidate = accountSelectionCandidate(account);
          if (!candidate) return null;
          return <button key={candidate.id} type="button" data-kordyn-v2-object-id={candidate.id} data-kordyn-v2-object-type="Account" aria-pressed={selected?.id === candidate.id} onClick={() => onSelect(candidate)}><WalletCards size={16} aria-hidden="true" /><span><strong>{safe(account.label)}</strong><small>{safe(account.exchange)} · {safe(account.status)}</small></span></button>;
        })}
        {!accounts.length && <p role="status">{emptyCopy}</p>}
      </div>
    </section>
  );
}

function ReconciliationInspector({ reconciliation, state, actionsDisabled, actionOutcome, onReconcile, mobile = false, headingRef = null }) {
  const latest = reconciliation?.latest;
  const presentation = reconciliationPresentation(reconciliation);
  const differences = Array.isArray(latest?.differences) ? latest.differences : [];
  const StatusIcon = presentation.tone === "healthy" ? CheckCircle2 : presentation.tone === "critical" ? AlertTriangle : Clock3;
  return (
    <section
      className={`kordynV2Reconciliation${mobile ? " is-mobile" : ""}`}
      data-kordyn-v2-mobile-reconciliation-detail={mobile ? "true" : undefined}
      aria-labelledby={mobile ? "kordyn-v2-mobile-reconciliation-title" : "kordyn-v2-reconciliation-title"}
    >
      <header>
        <span><StatusIcon size={19} aria-hidden="true" /><span><h2 ref={headingRef} tabIndex={mobile ? -1 : undefined} id={mobile ? "kordyn-v2-mobile-reconciliation-title" : "kordyn-v2-reconciliation-title"}>账户对账</h2><small>{presentation.detail}</small></span></span>
        <em data-reconciliation-tone={presentation.tone}>{presentation.label}</em>
      </header>
      <dl>
        <div><dt>报告 ID</dt><dd>{safe(latest?.id)}</dd></div>
        <div><dt>服务端状态</dt><dd>{safe(latest?.status)}</dd></div>
        <div><dt>严重度</dt><dd>{safe(latest?.severity)}</dd></div>
        <div><dt>差异数</dt><dd>{finite(latest?.differenceCount) ? latest.differenceCount : unavailable}</dd></div>
        <div><dt>报告时间</dt><dd><time dateTime={latest?.createdAt || undefined}>{safe(latest?.createdAt)}</time></dd></div>
        <div><dt>工作区来源</dt><dd>{safe(state?.source)}</dd></div>
      </dl>
      {differences.length > 0 && <div className="kordynV2ReconciliationDifferences" aria-label="已报告差异">{differences.slice(0, 5).map((difference, index) => <article key={`${difference.type || "difference"}-${index}`}><i data-difference-severity={safe(difference.severity)} aria-hidden="true" /><span><strong>{safe(difference.type)}</strong><small>{safe(difference.message)}</small></span></article>)}</div>}
      <footer>
        <button type="button" data-kordyn-v2-reconcile-action disabled={actionsDisabled} onClick={onReconcile}><RefreshCw size={16} aria-hidden="true" />立即对账</button>
        <span role="status" aria-live="polite">
          {actionOutcome?.presentation?.message || (actionOutcome?.kind === "processing" ? "正在等待服务端结果…" : "")}
        </span>
      </footer>
    </section>
  );
}

export function AccountWorkspace({ model, truth, state, selection, actionsDisabled = false, actionOutcome = null, onSelect = () => {}, onReconcile = () => {} }) {
  const selectedAccount = selectedAccountFor(model, selection);
  const reconciliation = model?.reconciliation || { state: "absent", loaded: false, latest: null };
  const tone = resourceTone(state?.kind);
  return (
    <div className="kordynV2AccountWorkspace" data-kordyn-v2-destination="account/account" data-kordyn-v2-truth-mode={validatedTruthMode(truth?.mode)}>
      <header className="kordynV2AccountWorkspaceTitle">
        <span><h1 data-kordyn-v2-destination-title>账户</h1><small>资金事实、同步与对账</small></span>
        <em data-resource-tone={tone} role="status">{selectedAccount ? `Account · ${selectedAccount.id}` : "选择账户"}</em>
      </header>
      <div className="kordynV2AccountWorkbench" data-kordyn-v2-layout="account-truth-reconciliation">
        <section className="kordynV2AccountLedger" aria-labelledby="kordyn-v2-account-ledger-heading">
          <header><span><ShieldCheck size={18} aria-hidden="true" /><h2 id="kordyn-v2-account-ledger-heading">账户健康</h2></span><em data-resource-tone={tone}>{safe(state?.kind)}</em></header>
          <AccountRegistry model={model} selection={selection} onSelect={onSelect} />
          <dl className="kordynV2AccountMetrics">
            <AccountMetric label="总权益" value={truth?.equity} icon={WalletCards} />
            <AccountMetric label="可用" value={truth?.available} icon={Database} />
            <AccountMetric label="敞口" value={truth?.exposure} icon={ShieldCheck} />
            <AccountMetric label="未实现盈亏" value={model?.truth?.unrealizedPnl} icon={WalletCards} />
            <AccountMetric label="占用保证金" value={model?.truth?.margin} icon={Database} />
          </dl>
          <section className="kordynV2AccountSource" aria-label="账户事实来源">
            <span><Database size={15} aria-hidden="true" /><small>来源</small><strong>{safe(state?.source)}</strong></span>
            <span><Clock3 size={15} aria-hidden="true" /><small>数据截至 / As of</small><time dateTime={state?.lastValidAt === unavailable ? undefined : state?.lastValidAt}>{safe(state?.lastValidAt)}</time></span>
          </section>
          <p>此处只展示已加载事实。空值保持 Unavailable，不替代为 0。</p>
        </section>
        <ReconciliationInspector reconciliation={reconciliation} state={state} actionsDisabled={actionsDisabled} actionOutcome={actionOutcome} onReconcile={onReconcile} />
      </div>
    </div>
  );
}

export { ReconciliationInspector };
