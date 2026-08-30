import { Bot, Check, CircleAlert, FileCheck2, GitBranch, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { runAuthoritativePlanAction } from "../ai/AiApprovalSheet.jsx";
import { resourceTone, validatedTruthMode } from "./AccountWorkspace.jsx";

const unavailable = "Unavailable";
const validIdentity = (value) => typeof value === "string"
  && value.length > 0 && value.length <= 240 && value === value.trim()
  && !/[\p{White_Space}\p{Cc}]/u.test(value)
  && !["unavailable", "unknown", "n/a", "—"].includes(value.toLowerCase());
const text = (value) => typeof value === "string" && value ? value : unavailable;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const number = (value, suffix = "") => finite(value)
  ? `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(value)}${suffix}`
  : unavailable;

export function planSelectionCandidate(plan) {
  return validIdentity(plan?.id)
    ? { id: plan.id, type: "Trade plan", workspaceId: "account", route: "signalHub", sourceSection: "cockpit" }
    : null;
}

export async function runPlanDecision({ kind, plan, actions = {}, actionsDisabled = false, onState = () => {}, isCurrent = () => true } = {}) {
  const planId = validIdentity(plan?.id) ? plan.id : null;
  const eligible = planId && plan?.status === "awaiting_approval" && (kind === "reject" || plan?.approval?.valid === true);
  const action = kind === "approve" ? actions?.approvePlan : kind === "reject" ? actions?.rejectPlan : null;
  if (!eligible || actionsDisabled || typeof action !== "function") return { ok: false, error: "actions_disabled" };
  return runAuthoritativePlanAction({
    kind,
    planId,
    action: () => action(planId),
    actionsDisabled,
    onState,
    isCurrent
  });
}

function selectedPlanFor(model, selection) {
  if (selection?.object?.type !== "Trade plan" || !validIdentity(selection.object.id)) return null;
  const matches = (Array.isArray(model?.plans) ? model.plans : []).filter((row) => row.id === selection.object.id);
  return matches.length === 1 ? matches[0] : null;
}

function statusLabel(value) {
  if (value === "awaiting_approval") return "需要你确认";
  if (value === "approved") return "已授权";
  if (value === "cancelled") return "已拒绝";
  return text(value);
}

function PlanRegistry({ model, selection, onSelect }) {
  const rows = Array.isArray(model?.plans) ? model.plans : [];
  const state = model?.availability?.plans?.state || "absent";
  return (
    <section className="kordynV2ExecutionRegistry" aria-label="交易计划列表">
      <header><h2>交易计划</h2><span>{state === "loaded" ? rows.length : unavailable}</span></header>
      <div>
        {rows.map((plan) => {
          const candidate = planSelectionCandidate(plan);
          if (!candidate) return null;
          const selected = selection?.object?.type === candidate.type && selection.object.id === candidate.id;
          return (
            <button key={candidate.id} type="button" data-kordyn-v2-object-id={candidate.id} data-kordyn-v2-object-type={candidate.type} data-selected={selected} aria-pressed={selected} onClick={(event) => onSelect(candidate, event)}>
              <span><strong>{text(plan.symbol)}</strong><em>{/short|sell/iu.test(plan.direction || "") ? "空" : /long|buy/iu.test(plan.direction || "") ? "多" : unavailable}</em></span>
              <b>{statusLabel(plan.status)}</b>
              <small>{text(plan.strategy)} · {text(plan.createdAt)}</small>
              <small>Mission {text(plan.missionId)} · 到期 {text(plan.expiresAt)}</small>
            </button>
          );
        })}
        {!rows.length && <p role="status">{state === "loaded" ? "当前没有交易计划。" : "交易计划明确未加载。"}</p>}
      </div>
    </section>
  );
}

function PlanTruth({ plan, headingRef = null, mobile = false }) {
  if (!plan) return <section className="kordynV2ExecutionTruth is-empty"><CircleAlert aria-hidden="true" /><span><h2 ref={headingRef} tabIndex={mobile ? -1 : undefined}>选择交易计划</h2><p>选择一个可验证的 Trade plan 对象。</p></span></section>;
  return (
    <section className={`kordynV2ExecutionTruth${mobile ? " is-mobile" : ""}`} data-kordyn-v2-object-id={plan.id} data-kordyn-v2-object-type="Trade plan">
      <header><span><Bot aria-hidden="true" /><h2 ref={headingRef} tabIndex={mobile ? -1 : undefined}>{text(plan.symbol)} 交易意图</h2></span><em>{statusLabel(plan.status)}</em></header>
      <p className="kordynV2ExecutionLead">这是 AI 形成的交易意图；授权之前不是订单，授权之后也仍需服务器风控与交易所确认。</p>
      <dl className="kordynV2ExecutionFacts">
        <div><dt>方向</dt><dd>{text(plan.direction)}</dd></div>
        <div><dt>入场</dt><dd>{text(plan.entry)}</dd></div>
        <div><dt>止损</dt><dd>{number(plan.stopLoss)}</dd></div>
        <div><dt>止盈</dt><dd>{plan.takeProfits?.length ? plan.takeProfits.map((value) => number(value)).join(" · ") : unavailable}</dd></div>
        <div><dt>数量</dt><dd>{number(plan.quantity)}</dd></div>
        <div><dt>杠杆</dt><dd>{number(plan.leverage, "x")}</dd></div>
        <div><dt>风险预算</dt><dd>{number(plan.riskPercent, "%")}</dd></div>
        <div><dt>策略</dt><dd>{text(plan.strategy)}</dd></div>
      </dl>
      <section className="kordynV2ExecutionBoundary"><FileCheck2 aria-hidden="true" /><span><strong>风险核验</strong><p>{text(plan.risk?.summary)}</p></span><em data-tone={plan.risk?.passed ? "healthy" : "critical"}>{plan.risk?.passed ? "通过" : "未通过"}</em></section>
    </section>
  );
}

function PlanEvidence({ plan, actions, actionsDisabled, actionState, onDecision, onSelect }) {
  if (!plan) return <aside className="kordynV2ExecutionInspector is-empty"><p>选择计划后查看风险与授权证据。</p></aside>;
  const processing = actionState?.kind === "processing";
  const approvable = plan.status === "awaiting_approval" && plan.approval?.valid === true && !actionsDisabled && !processing && typeof actions?.approvePlan === "function";
  const rejectable = plan.status === "awaiting_approval" && !actionsDisabled && !processing && typeof actions?.rejectPlan === "function";
  return (
    <aside className="kordynV2ExecutionInspector" aria-label="风险与授权证据">
      <header><span><ShieldCheck aria-hidden="true" /><h2>风险与授权证据</h2></span><em>{plan.evidenceIds?.length || 0}</em></header>
      <dl>
        <div><dt>Mission</dt><dd>{text(plan.missionId)}</dd></div>
        <div><dt>Strategy</dt><dd>{text(plan.strategy)}</dd></div>
        <div><dt>Risk check</dt><dd>{text(plan.risk?.id)}</dd></div>
        <div><dt>Evidence</dt><dd>{plan.evidenceIds?.join(" · ") || unavailable}</dd></div>
        <div><dt>预计最大亏损</dt><dd>{number(plan.accountImpact?.estimatedMaxLossUsdt)}</dd></div>
        <div><dt>关联 Execution</dt><dd>{text(plan.executionOrderId)}</dd></div>
      </dl>
      {validIdentity(plan.executionOrderId) && <button type="button" className="kordynV2ExecutionRelatedLink" data-kordyn-v2-object-id={plan.executionOrderId} data-kordyn-v2-object-type="Execution" onClick={() => onSelect({ id: plan.executionOrderId, type: "Execution", workspaceId: "account", route: "executionReview", sourceSection: "cockpit" })}><GitBranch aria-hidden="true" />查看关联 Execution</button>}
      {actionState && <p className="kordynV2ExecutionOutcome" role="status" data-action-state={actionState.kind}>{actionState.kind === "processing" ? "正在等待服务端结果…" : actionState.kind === "partial" ? "授权已消费，但订单未提交。" : actionState.kind === "succeeded" ? "服务端返回终态；请刷新执行事实。" : "操作未完成，未提交订单。"}</p>}
      <footer>
        <button type="button" disabled={!rejectable} onClick={() => onDecision("reject")}><X aria-hidden="true" />拒绝</button>
        <button type="button" disabled={!approvable} onClick={() => onDecision("approve")}><Check aria-hidden="true" />{processing ? "等待服务器…" : "仅授权本笔"}</button>
      </footer>
    </aside>
  );
}

export function PlanWorkspace({ model, truth, state, selection, actions = {}, actionsDisabled = false, onSelect = () => {} }) {
  const selected = selectedPlanFor(model, selection);
  const [actionState, setActionState] = useState(null);
  const decide = (kind) => runPlanDecision({ kind, plan: selected, actions, actionsDisabled, onState: setActionState });
  return (
    <div className="kordynV2ExecutionWorkspace" data-kordyn-v2-execution-workspace="plans" data-kordyn-v2-truth-mode={validatedTruthMode(truth?.mode)}>
      <header className="kordynV2AccountWorkspaceTitle"><span><h1>计划</h1><small>意图、风险、授权与服务器最终性</small></span><em role="status" data-resource-tone={resourceTone(state?.kind)}>{text(state?.kind)}</em></header>
      <div className="kordynV2ExecutionWorkbench"><PlanRegistry model={model} selection={selection} onSelect={onSelect} /><PlanTruth plan={selected} /><PlanEvidence plan={selected} actions={actions} actionsDisabled={actionsDisabled} actionState={actionState} onDecision={decide} onSelect={onSelect} /></div>
    </div>
  );
}

export { PlanEvidence, PlanRegistry, PlanTruth, selectedPlanFor };
