import { ArrowLeft, CheckCircle2, CircleAlert, FileCheck2, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { projectApprovalTruth } from "./aiModel.js";
import { MissionProgress } from "./MissionProgress.jsx";

const unavailable = "Unavailable";
const safeValue = (value) => value === null || value === undefined || value === "" ? unavailable : String(value);
const approvalStatusLabel = (status) => status === "awaiting_approval" ? "需要你确认" : safeValue(status);

export function canApprovePlan(plan) {
  const truth = plan?.planId ? plan : projectApprovalTruth(plan, {});
  return truth?.valid === true;
}

export function classifyApprovalOutcome(kind, result, planId) {
  if (!result || typeof result !== "object") return "failed";
  if (kind === "reject") {
    return result.ok !== false && !result.error && result.id === planId && result.status === "cancelled" ? "succeeded" : "failed";
  }
  if (result.plan?.id !== planId || result.approvalGranted !== true || result.plan?.status !== "approved") return "failed";
  if (result.executionSubmitted === false) return "partial";
  return result.ok !== false && !result.error && result.executionSubmitted === true ? "succeeded" : "failed";
}

export async function runAuthoritativePlanAction({ kind, planId, action, actionsDisabled = false, onState = () => {}, isCurrent = () => true }) {
  if (actionsDisabled) return { ok: false, error: "actions_disabled" };
  onState(Object.freeze({ kind: "processing", action: kind }));
  try {
    const result = await action();
    if (!isCurrent()) return result;
    onState(Object.freeze({ kind: classifyApprovalOutcome(kind, result, planId), action: kind, result }));
    return result;
  } catch (error) {
    if (isCurrent()) onState(Object.freeze({ kind: "failed", action: kind, error }));
    return null;
  }
}

function boundedOutcomeCode(state) {
  const value = state?.result?.error || state?.result?.execution?.reason || state?.result?.execution?.status;
  return typeof value === "string" && /^[a-z0-9][a-z0-9_.-]{0,79}$/iu.test(value) ? value : "";
}

function outcomeText(state) {
  const result = state?.result;
  if (state?.kind === "partial") return "授权已消费，但订单未提交。请修复执行前安全阻断后重新生成计划。";
  if (state?.kind === "failed" && result?.error === "risk_blocked") return "风控复核未通过，未提交订单。请检查风险边界后重新生成计划。";
  if (state?.kind === "failed") return "服务器未完成本次操作，未提交订单。请刷新权威事实后重试。";
  if (state?.error) return "服务器未完成本次操作，未提交订单。请刷新权威事实后重试。";
  if (!result || typeof result !== "object") return unavailable;
  return safeValue(result.message || result.plan?.status || result.status);
}

function ApprovalFacts({ plan }) {
  const facts = [
    ["方向", plan.direction === "long" ? "做多" : plan.direction === "short" ? "做空" : unavailable],
    ["入场区间", plan.entry],
    ["止损价", plan.stopLoss],
    ["止盈目标", plan.takeProfit?.join(" / ")],
    ["单笔风险", plan.riskPercent == null ? unavailable : `${plan.riskPercent}%`],
    ["杠杆倍数", plan.leverage == null ? unavailable : `${plan.leverage}x`]
  ];
  return <dl className="kordynV2AiApprovalPlanFacts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={safeValue(value)}>{safeValue(value)}</dd></div>)}</dl>;
}

function ApprovalUsage({ plan }) {
  const knowledge = Array.isArray(plan?.knowledgeSkillIds) && plan.knowledgeSkillIds.length
    ? plan.knowledgeSkillIds.join(" · ")
    : unavailable;
  const rows = [
    ["策略", plan?.strategy],
    ["知识", knowledge],
    ["复盘", unavailable],
    ["能力", unavailable]
  ];
  return (
    <section className="kordynV2AiApprovalUsage" data-kordyn-v2-approval-usage>
      <h2>AI 这次使用了什么</h2>
      <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{safeValue(value)}</dd></div>)}</dl>
      <p>仅展示本计划携带的真实引用；未随计划返回的关系保持 Unavailable。</p>
    </section>
  );
}

export function AiApprovalSheet({ mission = null, plan: sourcePlan, outcome = null, actions = {}, actionsDisabled = false, onTerminal = () => {}, onClose = () => {}, returnFocus = null }) {
  const plan = useMemo(() => sourcePlan?.planId ? sourcePlan : projectApprovalTruth(sourcePlan, {}), [sourcePlan]);
  const [actionState, setActionState] = useState(outcome);
  const dialogRef = useRef(null);
  const activeRef = useRef(true);
  const processing = actionState?.kind === "processing";
  const terminal = actionState?.kind === "succeeded" || actionState?.kind === "partial";
  const approvable = canApprovePlan(plan) && typeof actions.approvePlan === "function" && !actionsDisabled && !processing && !terminal;
  const rejectable = Boolean(plan?.planId && plan?.status === "awaiting_approval" && typeof actions.rejectPlan === "function" && !actionsDisabled && !processing && !terminal);

  useEffect(() => {
    activeRef.current = true;
    const frame = window.requestAnimationFrame(() => dialogRef.current?.querySelector("[data-kordyn-v2-approval-close]")?.focus());
    return () => { activeRef.current = false; window.cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => {
    if (!actionState || actionState.kind === "processing") return undefined;
    const frame = window.requestAnimationFrame(() => {
      if (!document.querySelector(".cfmCard") && !dialogRef.current?.contains(document.activeElement)) {
        dialogRef.current?.querySelector("[data-kordyn-v2-approval-close]")?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [actionState]);

  const close = () => {
    onClose();
    const focus = () => returnFocus?.focus?.();
    if (typeof queueMicrotask === "function") queueMicrotask(focus);
    else window.setTimeout(focus, 0);
  };

  const submit = (kind) => {
    if (actionsDisabled || processing || terminal || (kind === "approve" ? !approvable : !rejectable)) return Promise.resolve({ ok: false, error: "actions_disabled" });
    return runAuthoritativePlanAction({
      kind,
      planId: plan?.planId,
      action: () => kind === "approve" ? actions.approvePlan(plan.planId) : actions.rejectPlan(plan.planId),
      actionsDisabled,
      onState: (next) => {
        setActionState(next);
        if (next.kind === "succeeded" || next.kind === "partial") onTerminal(next);
      },
      isCurrent: () => activeRef.current
    });
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...dialogRef.current.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return (
    <div className="kordynV2AiSheetScrim" data-kordyn-v2-ai-approval-scrim onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section ref={dialogRef} className="kordynV2AiApprovalSheet" data-kordyn-v2-ai-approval-sheet role="dialog" aria-modal="true" aria-labelledby="kordyn-v2-approval-title" onKeyDown={onKeyDown}>
        <header className="kordynV2AiApprovalHeader">
          <button type="button" data-kordyn-v2-approval-close aria-label="返回 Mission" onClick={close}><ArrowLeft size={20} aria-hidden="true" /></button>
          <span><ShieldCheck size={22} aria-hidden="true" /><strong id="kordyn-v2-approval-title">{safeValue(plan?.symbol)} · 任务确认</strong></span>
          <em data-kordyn-v2-approval-status={safeValue(plan?.status)}>{approvalStatusLabel(plan?.status)}</em>
        </header>

        <div className="kordynV2AiApprovalScroll">
          <section className="kordynV2AiApprovalSummary" data-kordyn-v2-approval-lifecycle>
            <span><CircleAlert size={19} aria-hidden="true" /><strong>{safeValue(mission?.title)}</strong><em>需要你确认</em></span>
            <p>{safeValue(mission?.summary)} · 当前尚未下单；本次只能一次性人工授权。</p>
            <div data-kordyn-v2-approval-mission-progress={safeValue(mission?.id)}>
              <MissionProgress mission={mission} compact />
            </div>
            <small>Plan <b>{safeValue(plan?.planId)}</b> · {safeValue(plan?.status)}</small>
          </section>

          <section className="kordynV2AiApprovalSection" data-kordyn-v2-approval-plan aria-labelledby="kordyn-v2-plan-facts-title">
            <h2 id="kordyn-v2-plan-facts-title">交易计划（仅本笔一次性授权）</h2>
            {plan ? <ApprovalFacts plan={plan} /> : <p className="kordynV2AiApprovalUnavailable">{unavailable}</p>}
          </section>

          <section className="kordynV2AiApprovalImpact" data-kordyn-v2-approval-account-impact>
            <h2>账户影响（估计）</h2>
            <dl>
              <div><dt>账户权益</dt><dd title={`${safeValue(plan?.accountImpact?.equityUsdt)} USDT`}>{safeValue(plan?.accountImpact?.equityUsdt)} USDT</dd></div>
              <div><dt>可用保证金</dt><dd title={`${safeValue(plan?.accountImpact?.availableMarginUsdt)} USDT`}>{safeValue(plan?.accountImpact?.availableMarginUsdt)} USDT</dd></div>
              <div><dt>持仓数量</dt><dd title={`${safeValue(plan?.accountImpact?.openPositionCount)} → ${safeValue(plan?.accountImpact?.projectedOpenPositionCount)}`}>{safeValue(plan?.accountImpact?.openPositionCount)} → {safeValue(plan?.accountImpact?.projectedOpenPositionCount)}</dd></div>
              <div><dt>最大预计亏损</dt><dd title={`${safeValue(plan?.accountImpact?.estimatedMaxLossUsdt)} USDT`}>{safeValue(plan?.accountImpact?.estimatedMaxLossUsdt)} USDT</dd></div>
            </dl>
          </section>

          <section className="kordynV2AiApprovalRisk" data-kordyn-v2-approval-risk-checklist data-risk-passed={plan?.risk?.passed === true}>
            <header><span><FileCheck2 size={19} aria-hidden="true" /><h2>风险核验结果</h2></span><strong>{safeValue(plan?.risk?.summary)}</strong></header>
            <p>Evidence {safeValue(plan?.evidence?.count)} · {plan?.evidence?.ids?.join(" · ") || unavailable}</p>
            {(plan?.risk?.warnings?.length || plan?.risk?.blockers?.length) ? <ul>
              {plan.risk.warnings.map((item) => <li key={`warning-${item}`}>提醒 · {safeValue(item)}</li>)}
              {plan.risk.blockers.map((item) => <li key={`blocker-${item}`}>阻断 · {safeValue(item)}</li>)}
            </ul> : null}
            <div className="kordynV2AiApprovalRiskBoundary">
              <strong>一次性授权边界</strong>
              <span>只针对 Plan {safeValue(plan?.planId)}；不会加入永久白名单，也不会跳过服务器复核。</span>
              {!plan?.valid && <span role="alert"><CircleAlert size={14} aria-hidden="true" />事实缺失或状态无效：{plan?.missingFacts?.join(" · ") || unavailable}</span>}
            </div>
          </section>

          <ApprovalUsage plan={plan} />

          <section className="kordynV2AiApprovalAcknowledgement" data-kordyn-v2-approval-acknowledgement>
            <span aria-hidden="true" />
            <p>确认后仍会再次刷新行情、账户和风控，再提交真实订单；此处不会乐观显示成功。</p>
          </section>

        </div>

        <footer className="kordynV2AiApprovalActions" data-kordyn-v2-approval-actions>
          {actionState && (
            <section className="kordynV2AiApprovalOutcome" data-kordyn-v2-approval-outcome={actionState.kind} role="status">
              {actionState.kind === "succeeded" ? <CheckCircle2 aria-hidden="true" /> : actionState.kind === "processing" ? <CircleAlert aria-hidden="true" /> : <XCircle aria-hidden="true" />}
              <span><strong>{actionState.kind === "processing" ? "服务器处理中" : "服务器返回"}</strong><small>{actionState.kind === "processing" ? "尚未收到权威结果" : outcomeText(actionState)}{boundedOutcomeCode(actionState) && <code data-kordyn-v2-approval-code>{boundedOutcomeCode(actionState)}</code>}</small></span>
            </section>
          )}
          <button type="button" disabled={!rejectable} onClick={() => submit("reject")}>拒绝</button>
          <button type="button" data-kordyn-v2-approval-primary disabled={!approvable} onClick={() => submit("approve")}>{processing ? "等待服务器…" : "仅授权本笔"}</button>
        </footer>
      </section>
    </div>
  );
}
