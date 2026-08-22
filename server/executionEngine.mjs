import { executeTradeAction, mandateNotionalCapacity } from "./tradeActions.mjs";
import { currentOkxCredentialFingerprint, enabledOkxAccounts, fetchOkxPendingPages, okxContractSpec, okxSignedRequest, toOkxSymbol, validateOkxCredentialBinding } from "./exchangeConnector.mjs";
import { portfolioCapNotional } from "./portfolioRisk.mjs";
import { evaluateTradePlan } from "./riskEngine.mjs";
import { applyOperationalDegradation, professionalNotionalCap } from "./professionalRiskGate.mjs";
import { ensureTradeReviewQueued, groupClosedTradeLifecycles, sameTradeLifecycle, syncTradeReviewQueue } from "./tradeReviewQueue.mjs";
import { estimateExecutionCost, estimateNetRewardRisk, netRewardRiskGate } from "./executionCostModel.mjs";
import { activeMandate, acquireExecutionLease, appendAudit, appendTrace, id, latestSuccessfulAccountSnapshot, nowIso, releaseExecutionLease, renewExecutionLease, saveDb, transitionOmsOrder } from "./store.mjs";
import { evaluatePortfolioIntentConflict, evaluateSameSymbolEntryConflict } from "./tradingRoles.mjs";
import { accountMarginCapacity, projectedMarginUsage } from "./tradingCapacity.mjs";
import { ensurePlanStrategyBinding, reconcileStrategyProductHealth, strategyProductExecutionGate } from "./strategyProducts.mjs";
import { validatePlanBlueprintGate } from "./strategyStudio.mjs";
import { recordPostTradeCapabilities } from "./postTradeCapabilities.mjs";
import { canonicalPositionDirection, canonicalSymbol } from "./positionIdentity.mjs";
import { OPEN_EXECUTION_STATES } from "./executionStates.mjs";
import { clearReduceOnlyReason, syncReduceOnlyState } from "./reduceOnlyState.mjs";
import { finiteFinancialNumber, okxFeeCost } from "./financialValues.mjs";
import { currentEquityUsdt } from "./financialFacts.mjs";
import { currentEvidenceReadiness, marketFactFreshness } from "./marketFreshness.mjs";
import { assertActiveLease, isLeaseLostError } from "./leaseSafety.mjs";
import { currentRiskThresholds } from "./riskThresholds.mjs";
import { isAllowedGeminiProvider } from "./llmGateway.mjs";
import { liveConfirmationStatus } from "./liveModeService.mjs";
import { normalizedPlanForDecisionAudit, verifyDecisionAuditExecutionAttribution, verifyDecisionAuditRecord } from "./decisionAudit.mjs";
import { ensureDecisionFactSnapshot, refreshOwnerImprovementRegistry } from "./ownerReviewLoop.mjs";
import { buildAttributedManualExitClosure, buildAttributedSystemExitClosure, buildExecutionFillAttribution, classifyTradeFill, reconcilePendingTradeAttributions } from "./systemTradeProjection.mjs";

export { currentEquityUsdt } from "./financialFacts.mjs";

// ---------------------------------------------------------------------------
// ExecutionEngine：把"已批准的交易计划"翻译成真实订单并全程跟踪。
// 唯一合法执行入口；直接调用 tradeActions 的路径仍受其七层安全闸约束。
// ---------------------------------------------------------------------------

const DEFAULT_TAKER_FEE_RATE = 0.0004;
// OKX clOrdId 只接受字母+数字(≤32)——带下划线会被 51000「Parameter clOrdId error」整单拒绝
// (曾导致所有 OKX 自动单静默失败)。统一清洗成字母数字;币安也接受字母数字,故两所通用。
const cleanClOrdId = (seed) => String(seed).replace(/[^a-zA-Z0-9]/g, "").slice(0, 32);
function surfaceOwnerExecutionSafetyIssue(db, executionOrder) {
  const tenantId = executionOrder?.tenantId || db.user?.tenantId || "tenant_owner";
  const ownerUserId = executionOrder?.ownerUserId || db.user?.id || null;
  for (const incident of db.riskIncidents || []) {
    if (incident.source !== executionOrder?.id || !["critical", "high"].includes(String(incident.severity || "").toLowerCase())) continue;
    incident.tenantId ||= tenantId;
    incident.ownerUserId ||= ownerUserId;
  }
  refreshOwnerImprovementRegistry(db);
}
export function okxFillIdentity(row = {}) {
  const tradeId = String(row.tradeId || "").trim();
  if (tradeId) return `trade:${tradeId}`;
  // Historical WS and REST payloads do not always expose tradeId. Keep the
  // fallback deterministic and transport-stable. Optional WS/REST-only fields
  // are merged afterwards and therefore do not split one economic fill.
  return [
    "fill", row.instId, row.ordId || row.clOrdId, row.side, row.posSide,
    row.ts ?? row.fillTime ?? row.cTime, row.fillPx ?? row.avgPx, row.fillSz ?? row.sz
  ].map((value) => String(value ?? "")).join(":");
}

export function dedupeOkxFills(rows = []) {
  const merged = new Map();
  for (const row of rows || []) {
    const key = okxFillIdentity(row);
    const present = Object.fromEntries(Object.entries(row || {}).filter(([, value]) => value !== undefined && value !== null && value !== ""));
    merged.set(key, { ...(merged.get(key) || {}), ...present });
  }
  return [...merged.values()];
}

const protectionClientIds = (executionOrder = {}) => {
  const ids = new Set((executionOrder.tpClientOrderIds || []).map(cleanClOrdId).filter(Boolean));
  if (executionOrder.stopClientOrderId) ids.add(cleanClOrdId(executionOrder.stopClientOrderId));
  const tpCount = (executionOrder.takeProfits || executionOrder.takeProfit || []).length;
  for (let index = 0; index < tpCount; index += 1) {
    ids.add(cleanClOrdId(`tp${index + 1}${String(executionOrder.id || "").slice(-10)}`));
  }
  return ids;
};

function asNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function inferMarketRegime(db, symbol) {
  const market = (db.markets || []).find((item) => item.symbol === symbol) || {};
  const change = asNumber(market.changePct, 0);
  const funding = asNumber(market.fundingRate, 0);
  if (Math.abs(change) >= 4) return "高波动趋势";
  if (Math.abs(change) <= 0.8) return "震荡低波动";
  if (Math.abs(funding) >= 0.03) return "资金费率拥挤";
  return change >= 0 ? "上行趋势" : "下行趋势";
}

function feeEstimate(notional) {
  return Number((Math.abs(Number(notional || 0)) * DEFAULT_TAKER_FEE_RATE).toFixed(6));
}

export function validateLiveDecisionProvenance(provenance, options = {}) {
  const criticRequired = true;
  const primaryValid = provenance?.primary?.gateway === "openrouter"
    && String(provenance?.primary?.requestedModel || "").startsWith("google/gemini-")
    && String(provenance?.primary?.actualModel || "").startsWith("google/gemini-")
    && isAllowedGeminiProvider(provenance?.primary?.actualProvider)
    && provenance?.primary?.providerAttributionVerified === true
    && provenance?.primary?.reasoningEffort === "high"
    && provenance?.routingPolicy?.crossModelFallback === false
    && Boolean(provenance?.prompt?.version && provenance?.prompt?.hash)
    && Boolean(provenance?.toolSchema?.version && provenance?.toolSchema?.hash)
    && Boolean(provenance?.evidence?.bundleId && provenance?.evidence?.hash)
    && Boolean(provenance?.cohort?.id);
  const criticValid = !criticRequired || (
    provenance?.critic?.approved === true
    && provenance?.critic?.schemaValid === true
    && Boolean(provenance?.critic?.reviewId)
    && provenance?.critic?.gateway === "direct"
    && provenance?.critic?.actualProvider === "deepseek_direct"
    && String(provenance?.critic?.requestedModel || "").startsWith("deepseek")
    && String(provenance?.critic?.actualModel || "").startsWith("deepseek")
    && provenance?.critic?.thinking === "enabled"
    && provenance?.critic?.reasoningEffort === "max"
    && Number(provenance?.critic?.confidence) >= Number(process.env.LLM_CRITIC_MIN_CONFIDENCE || 0.75)
    && !["high", "critical"].includes(String(provenance?.critic?.severity || ""))
    && Array.isArray(provenance?.critic?.objections) && provenance.critic.objections.length === 0
    && Array.isArray(provenance?.critic?.requiredChecks) && provenance.critic.requiredChecks.length === 0
  );
  const auditRecord = options.auditRecord || null;
  let auditVerification;
  let attributionVerification;
  try {
    auditVerification = verifyDecisionAuditRecord(
      auditRecord,
      provenance?.auditChain?.rootHash,
      options.plan ? normalizedPlanForDecisionAudit(options.plan) : null
    );
    attributionVerification = auditVerification.ok
      ? verifyDecisionAuditExecutionAttribution(auditRecord, provenance)
      : { ok: false, reason: auditVerification.reason };
  } catch {
    auditVerification = { ok: false, reason: "decision_audit_validation_error" };
    attributionVerification = auditVerification;
  }
  const auditValid = Boolean(provenance?.auditChain?.recordId
    && provenance.auditChain.recordId === auditRecord?.id
    && auditVerification.ok
    && attributionVerification.ok);
  return {
    ok: primaryValid && criticValid && auditValid,
    primaryValid,
    criticValid,
    auditValid,
    auditReason: attributionVerification.reason || auditVerification.reason || null,
    criticRequired
  };
}

function slippageBps(actual, expected, direction = "long") {
  const actualPrice = Number(actual);
  const expectedPrice = Number(expected);
  if (!Number.isFinite(actualPrice) || !Number.isFinite(expectedPrice) || expectedPrice <= 0) return null;
  const raw = ((actualPrice - expectedPrice) / expectedPrice) * 10000;
  return Number((direction === "short" ? -raw : raw).toFixed(2));
}

// 提取入场理由:plan 把 LLM 推理存在 reasoningSummary(见 agentChat propose_trade_plan),
// 【修复】此前只找 rationale/analysis/... 漏了 reasoningSummary → 每笔都落"未记录",复盘拿空输入还反过来
// 把有完整结构分析的单子误判成"无纪律追单"。reasoningSummary 必须在候选里。
export function entryRationale(plan = {}) {
  return plan.rationale || plan.reasoningSummary || plan.analysis || plan.reason || plan.summary || plan.entry?.rationale || "未记录入场理由";
}

export function computePositionSize(db, plan) {
  const entryLow = Number(plan.entry_range?.[0]);
  const entryHigh = Number(plan.entry_range?.[1] ?? entryLow);
  const stop = Number(plan.stopLoss ?? plan.stop_loss);
  const entryMid = (entryLow + entryHigh) / 2;
  if (!Number.isFinite(entryMid) || !Number.isFinite(stop) || entryMid <= 0) {
    return { error: "invalid_entry_or_stop" };
  }
  const stopDistance = Math.abs(entryMid - stop);
  if (stopDistance <= 0) return { error: "zero_stop_distance" };

  const riskPct = Number(plan.entry?.riskPercent ?? plan.max_loss_pct ?? 0.3);
  const equity = currentEquityUsdt(db);
  const policy = (db.grayReleasePolicies || []).find((item) => item.enabled);
  const mandate = db.mandates.find((m) => m.id === plan.mandateId) || activeMandate(db);
  const grayMaxNotional = Number(policy?.maxNotionalUsdt || process.env.MAX_LIVE_NOTIONAL_USDT || 50);
  const mandateCapacity = mandateNotionalCapacity(db, mandate, plan.symbol);
  if (mandateCapacity.unknownPositions.length) {
    return { error: "position_notional_unknown", positions: mandateCapacity.unknownPositions };
  }
  const mandateRemaining = Number(mandateCapacity.remainingNotional);
  const marginCapacity = accountMarginCapacity(db, {
    mandate,
    leverage: plan.leverage,
    excludePlanId: plan.id,
    live: db.system?.liveTradingEnabled === true
  });
  if (!marginCapacity.ok && db.system?.liveTradingEnabled === true) return { error: marginCapacity.error, marginCapacity };
  const marginRemaining = marginCapacity.ok ? Number(marginCapacity.maxNotional) : Infinity;
  const maxNotional = Math.min(
    Number.isFinite(grayMaxNotional) ? grayMaxNotional : Infinity,
    Number.isFinite(mandateRemaining) ? mandateRemaining : Infinity,
    Number.isFinite(marginRemaining) ? marginRemaining : Infinity
  );
  if (!Number.isFinite(maxNotional) || maxNotional <= 0) {
    const error = Number.isFinite(marginRemaining) && marginRemaining <= 0
      ? "projected_margin_capacity_exhausted"
      : Number.isFinite(mandateRemaining) && mandateRemaining <= 0
        ? "mandate_notional_capacity_exhausted"
        : "opening_notional_capacity_exhausted";
    return { error, maxNotional, mandateCapacity, marginCapacity };
  }
  // 仓位模式(决定"下多大"):按余额%做保证金——每单保证金 = 权益 × positionPct%，名义 = 保证金 × 杠杆。
  // 未配置 positionPct 时退回按风险预算(不为0)。单笔风险%不是仓位模式,是下方独立的风控上限闸。
  const positionPct = Number(mandate?.positionPct ?? mandate?.equityPct ?? mandate?.equity_pct ?? 0);
  let quantity;
  let sizedBy;
  if (positionPct > 0 && equity > 0) {
    const lev = Math.max(1, Number(plan.leverage) || 1);
    quantity = (equity * (positionPct / 100) * lev) / entryMid;
    sizedBy = `balance_pct(${positionPct}%余额×${lev}x)`;
  } else if (equity) {
    quantity = (equity * (riskPct / 100)) / stopDistance;
    sizedBy = "risk_budget";
  } else {
    quantity = maxNotional / entryMid;
    sizedBy = "gray_notional_fallback";
  }
  let notional = quantity * entryMid;
  if (notional > maxNotional) {
    quantity = maxNotional / entryMid;
    notional = maxNotional;
    const capSources = [];
    const isLimit = (value) => Number.isFinite(value) && Math.abs(value - maxNotional) <= Math.max(1e-9, Math.abs(maxNotional) * 1e-9);
    if (isLimit(grayMaxNotional)) capSources.push("gray");
    if (isLimit(mandateRemaining)) capSources.push("mandate");
    if (isLimit(marginRemaining)) capSources.push("available_margin");
    sizedBy = `${sizedBy}+${capSources.join("_") || "notional"}_capped`;
  }
  const professionalCap = professionalNotionalCap(db, plan, notional);
  if (professionalCap.cap < notional) {
    quantity = professionalCap.cap / entryMid;
    notional = professionalCap.cap;
    sizedBy = `${sizedBy}+${professionalCap.reasons.join("+")}`;
  }
  // 组合级波动率目标：相关性感知地压低会突破组合波动预算的名义额度。
  const volCap = portfolioCapNotional(db, plan, equity, mandate);
  if (volCap !== null && volCap < notional) {
    quantity = volCap / entryMid;
    notional = volCap;
    sizedBy = `${sizedBy}+portfolio_vol_capped`;
  }
  // 单笔风险上限(风控闸,与仓位模式正交):无论仓位怎么定,亏到止损这单最多亏账户 maxSingleTradeRiskPct%。
  // 超了就把仓位缩到刚好达标——让"单笔风险%"是真正的上限闸,而不是一种仓位模式。
  const riskCapPct = Number(mandate?.maxSingleTradeRiskPct ?? mandate?.max_single_trade_risk_pct ?? 0);
  if (riskCapPct > 0 && equity > 0 && stopDistance > 0) {
    const maxQtyByRisk = (equity * (riskCapPct / 100)) / stopDistance;
    if (quantity > maxQtyByRisk) {
      quantity = maxQtyByRisk;
      notional = quantity * entryMid;
      sizedBy = `${sizedBy}+risk_capped(≤${riskCapPct}%)`;
    }
  }
  // Kelly 上限:对有真实成绩(≥10 笔)的策略,按半 Kelly 分数封顶名义——低边际策略自动缩仓,
  // 高边际才敢放大。用盈亏因子近似赔率 R,Kelly f* = W − (1−W)/R,取一半保守。
  {
    const lm = (plan.knowledgeSkillIds || [])
      .map((sid) => (db.knowledge?.tradingSkills || []).find((s) => s.id === sid)?.liveMetrics)
      .filter((x) => x && x.trades >= 10 && x.winRatePct != null && Number(x.profitFactor) > 0)[0];
    if (lm && equity > 0) {
      const W = Number(lm.winRatePct) / 100;
      const R = Number(lm.profitFactor);
      const kelly = Math.max(0, W - (1 - W) / R);
      const kellyCapNotional = equity * Math.min(kelly * 0.5, 0.5) * Math.max(1, Number(plan.leverage) || 1);
      if (kellyCapNotional > 0 && kellyCapNotional < notional) {
        quantity = kellyCapNotional / entryMid;
        notional = kellyCapNotional;
        sizedBy = `${sizedBy}+kelly_capped(f*${kelly.toFixed(2)})`;
      }
    }
  }
  const MIN_NOTIONAL = 5;
  quantity = roundQuantity(quantity, entryMid);
  if (quantity <= 0 && equity > 0) quantity = 0; // 先按四舍五入后的量,下方小账户放大再兜
  // 小账户自动放大:AI 选的风险%算出的仓位低于交易所最小额时,自动上调到最小额(取整后仍≥5U),
  // 但风险严格封顶在授权单笔风险上限内(用户要"按更接近上限定仓")。上限也不够才如实拒。
  const capped = `${sizedBy}`.includes("_capped");
  if (quantity * entryMid < MIN_NOTIONAL && !capped && MIN_NOTIONAL <= maxNotional) {
    const decimals = entryMid > 10000 ? 4 : entryMid > 100 ? 3 : entryMid > 1 ? 2 : 0;
    const factor = 10 ** decimals;
    const minQty = Math.ceil((MIN_NOTIONAL / entryMid) * factor - 1e-9) / factor; // 向上取整确保取整后仍≥最小额
    const ceilingPct = Number(mandate?.maxSingleTradeRiskPct ?? mandate?.max_single_trade_risk_pct ?? riskPct);
    const minRiskPct = equity > 0 ? (minQty * stopDistance / equity) * 100 : Infinity;
    if (minRiskPct <= ceilingPct + 1e-9) {
      quantity = minQty;
      notional = quantity * entryMid;
      sizedBy = `${sizedBy}+min_notional_scaled(风险升至${minRiskPct.toFixed(2)}%≤上限${ceilingPct}%)`;
    }
  }
  if (quantity <= 0) return { error: "quantity_rounds_to_zero", notional, maxNotional, sizedBy };
  if (quantity * entryMid < MIN_NOTIONAL) return { error: "below_min_notional", notional: quantity * entryMid, minNotional: MIN_NOTIONAL, sizedBy, ceilingPct: Number(mandate?.maxSingleTradeRiskPct ?? "-") };
  notional = quantity * entryMid;
  const projectedMargin = marginCapacity.ok
    ? projectedMarginUsage(marginCapacity, notional, plan.leverage)
    : { ok: true, unavailable: true, reason: marginCapacity.error, incrementalMargin: null, projectedUtilizationPct: null };
  if (!projectedMargin.ok) {
    return { error: "projected_margin_limit_exceeded", notional, maxNotional, marginCapacity, projectedMargin, sizedBy };
  }
  const initialRiskUsdt = Number((quantity * stopDistance).toFixed(6));
  return { quantity, entryMid, stopDistance, notional, initialRiskUsdt, riskPct, equity, maxNotional, grayMaxNotional, mandateCapacity, marginCapacity, projectedMargin, volCap, sizedBy };
}

function roundQuantity(quantity, price) {
  const decimals = price > 10000 ? 4 : price > 100 ? 3 : price > 1 ? 2 : 0;
  const factor = 10 ** decimals;
  return Math.floor(quantity * factor + 1e-9) / factor; // 向下取整:toFixed 四舍五入曾把实际风险放大近一倍
}

export function allocateProtectionQuantities(totalQuantity, targetCount, price) {
  const total = Number(totalQuantity);
  const count = Math.max(0, Number(targetCount) || 0);
  if (!Number.isFinite(total) || total <= 0 || count <= 0) return [];
  const decimals = price > 10000 ? 4 : price > 100 ? 3 : price > 1 ? 2 : 0;
  const factor = 10 ** decimals;
  const totalUnits = Math.floor(total * factor + 1e-9);
  if (totalUnits < count) return [];
  const baseUnits = Math.floor(totalUnits / count);
  let remaining = totalUnits;
  return Array.from({ length: count }, (_, index) => {
    const units = index === count - 1 ? remaining : baseUnits;
    remaining -= units;
    return units / factor;
  });
}

// 保护失败统一收口：尽力撤入场单（撤单本身也可能抛异常，必须捕获——否则会跳过熔断），
// 并把计划置为终态 protection_failed（executeApprovedPlan 只执行 approved 计划，
// 防止同一计划被自动路径反复执行产生多个裸仓；人工重新批准可显式解锁）。
async function failProtectionAndCancelEntry(db, plan, executionOrder, entry, causeDetail, options = {}) {
  executionOrder.cancelAttemptedAt ||= nowIso();
  executionOrder.cancelSubmittedAt ||= executionOrder.cancelAttemptedAt;
  executionOrder.cancelDisposition = "emergency_close_if_filled";
  executionOrder.cancelReason = causeDetail;
  executionOrder.cancelClientActionId ||= cleanClOrdId(`cancel${String(executionOrder.id || "").slice(-20)}`);
  executionOrder.status = "protection_failure_cancel_pending";
  const cancelRequestToken = executionOrder.cancelRequestToken = id("cancel_request");
  saveDb(db);
  let cancelResult;
  try {
    assertActiveLease(options);
    cancelResult = await (options.executeTradeAction || executeTradeAction)(db, "cancel_order", {
      exchange: plan.exchange,
      marketType: plan.marketType || "perpetual_usdt",
      symbol: plan.symbol,
      orderId: entry.exchangeOrderId,
      clientOrderId: entry.clientOrderId,
      agentRunId: plan.agentRunId,
      analysisBundleId: plan.analysisBundleId,
      evidenceBundleId: plan.evidenceBundleId,
      tradePlanId: plan.id,
      riskCheckId: plan.riskCheckId,
      mandateId: plan.mandateId,
      manualApproval: true
    });
  } catch (error) {
    if (isLeaseLostError(error)) throw error;
    cancelResult = { status: "error", error: String(error.message || error).slice(0, 200) };
  }
  if (executionOrder.cancelRequestToken !== cancelRequestToken || executionOrder.status !== "protection_failure_cancel_pending") {
    executionOrder.events ||= [];
    executionOrder.events.push({ at: nowIso(), event: "stale_cancel_response_ignored", detail: String(cancelResult.status || "unknown") });
    return { status: executionOrder.status, idempotent: true, staleResponseIgnored: true, cancelResult, executionOrder };
  }
  const acknowledged = ["ok", "submitted", "idempotent_replay"].includes(cancelResult.status);
  executionOrder.status = "protection_failure_cancel_pending";
  executionOrder.events.push({ at: nowIso(), event: "protection_failed", detail: `${causeDetail}；撤单仅收到 ${cancelResult.status}，等待交易所订单终态` });
  plan.status = "recovery_pending_reconciliation";
  plan.executionOrderId = executionOrder.id;
  db.system.reduceOnlyMode = true;
  db.system.reduceOnlyBy = "protection_failure_reconciliation";
  db.system.riskStatus = "暂停新开仓";
  if (!acknowledged) {
    db.system.killSwitch = true;
    db.riskIncidents.unshift({
      id: id("incident"),
      severity: "critical",
      status: "open",
      title: "入场保护单失败且撤单未确认",
      source: executionOrder.id,
      createdAt: nowIso()
    });
  }
  surfaceOwnerExecutionSafetyIssue(db, executionOrder);
  appendAudit(db, `${causeDetail}，已阻断入场并尝试撤单`, executionOrder.id, "ExecutionEngine", "critical");
  return { status: acknowledged ? executionOrder.status : "cancel_unconfirmed", cancelResult, executionOrder };
}

export async function executeApprovedPlan(db, planId, options = {}) {
  const instanceId = `${process.env.INSTANCE_ID || `pid-${process.pid}`}:${id("entryowner")}`;
  const leaseResource = `trade-plan:${planId}`;
  const leaseTtlMs = Number(options.leaseTtlMs || 60_000);
  const lease = acquireExecutionLease(leaseResource, instanceId, leaseTtlMs);
  if (!lease.acquired) return settlePlanExecutionOutcome(db, planId, { status: "execution_lease_held", lease });
  let localLeaseLost = false;
  const assertPlanLease = () => {
    assertActiveLease(options);
    if (localLeaseLost) throw new Error("scheduler_lease_lost");
    const renewed = renewExecutionLease(leaseResource, instanceId, lease.fencingToken, leaseTtlMs);
    if (!renewed?.renewed) {
      localLeaseLost = true;
      throw new Error("scheduler_lease_lost");
    }
    return true;
  };
  const heartbeat = setInterval(() => {
    try {
      const renewed = renewExecutionLease(leaseResource, instanceId, lease.fencingToken, leaseTtlMs);
      if (!renewed?.renewed) localLeaseLost = true;
    } catch { localLeaseLost = true; }
  }, Math.max(1_000, Math.floor(leaseTtlMs / 3)));
  heartbeat.unref?.();
  try {
    const result = await executeApprovedPlanLeased(db, planId, { ...options, assertLease: assertPlanLease });
    assertPlanLease();
    return settlePlanExecutionOutcome(db, planId, result);
  } catch (error) {
    if (isLeaseLostError(error)) throw error;
    const plan = (db.tradePlans || []).find((item) => item.id === planId);
    const executionOrder = (db.executionOrders || []).find((item) => item.planId === planId
      && (item.status === "created" || OPEN_EXECUTION_STATES.has(item.status)));
    const remoteIntentPersisted = Boolean(executionOrder && (
      executionOrder.entryAttemptedAt || executionOrder.closeAttemptedAt || executionOrder.cancelAttemptedAt
      || executionOrder.exchangeOrderId || executionOrder.omsOrderId
    ));
    const result = settlePlanExecutionOutcome(db, planId, {
      status: remoteIntentPersisted ? "execution_effect_unknown" : "execution_preflight_exception",
      reason: String(error?.message || error).slice(0, 200),
      executionOrder
    });
    appendAudit(db, remoteIntentPersisted
      ? "执行异常且远端效果未知，已进入权威对账"
      : "执行前异常，未产生交易所副作用，批准已失效",
    executionOrder?.id || plan?.id || planId, "ExecutionEngine", remoteIntentPersisted ? "critical" : "warning");
    return result;
  } finally {
    clearInterval(heartbeat);
    // 任何路径（含异常/early return）都归还租约；释放失败由 60s TTL 兜底。
    try { releaseExecutionLease(leaseResource, instanceId, lease.fencingToken); } catch { /* TTL 兜底 */ }
  }
}

const SUBMITTED_EXECUTION_RESULTS = new Set([
  "submitted", "entry_pending", "entry_partial", "entry_filled", "protecting", "protecting_degraded"
]);
const REMOTE_EFFECT_PENDING_RESULTS = new Set([
  "entry_unknown_pending", "execution_effect_unknown", "cancel_pending", "cancel_unknown_pending",
  "protection_failure_cancel_pending", "close_pending", "close_unknown_pending",
  "close_reconciliation_pending", "group_close_pending", "recovery_pending_reconciliation"
]);
const LOCAL_REAPPROVAL_RESULTS = new Set([
  "execution_lease_held", "execution_preflight_exception", "strategy_version_drift", "strategy_product_required",
  "strategy_product_blocked", "strategy_blueprint_blocked", "operational_degraded_reduce_only",
  "risk_recheck_failed", "mandate_not_active", "mandate_version_stale", "portfolio_intent_conflict",
  "same_symbol_entry_conflict", "account_configuration_conflict", "sizing_failed", "market_facts_rejected",
  "slippage_rejected", "instrument_spec_unavailable", "submitted_size_below_exchange_minimum", "blocked"
]);

// 批准是一项授权事实，不等于交易所已收到订单。所有调用方都从这里取得唯一的
// “执行结果 -> 计划状态”口径，避免 approved 在任何 early-return/异常后成为僵尸状态。
export function settlePlanExecutionOutcome(db, planId, result = {}) {
  const plan = (db.tradePlans || []).find((item) => item.id === planId);
  if (!plan) return { ...result, planDisposition: "missing_plan", executionSubmitted: false };
  const status = String(result.status || "unknown");
  const executionOrder = result.executionOrder
    || (result.executionOrderId ? (db.executionOrders || []).find((item) => item.id === result.executionOrderId) : null);
  const at = nowIso();
  if (SUBMITTED_EXECUTION_RESULTS.has(status)) {
    if (!["executing", "completed"].includes(plan.status)) plan.status = "executing";
    plan.executionOrderId = executionOrder?.id || result.executionOrderId || plan.executionOrderId;
    plan.updatedAt = at;
    return { ...result, planDisposition: "remote_submitted", approvalGranted: true, executionSubmitted: true };
  }
  if (REMOTE_EFFECT_PENDING_RESULTS.has(status) || (executionOrder && OPEN_EXECUTION_STATES.has(executionOrder.status))) {
    if (!["executing", "recovery_pending_reconciliation"].includes(plan.status)) plan.status = "recovery_pending_reconciliation";
    plan.executionOrderId = executionOrder?.id || result.executionOrderId || plan.executionOrderId;
    plan.executionBlock = { reason: status, detail: result.reason || "交易所效果尚未完成权威对账", at };
    plan.updatedAt = at;
    return { ...result, planDisposition: "remote_effect_unresolved", approvalGranted: true, executionSubmitted: null };
  }
  if (status === "already_executing") {
    plan.status = "executing";
    plan.executionOrderId = result.executionOrderId || plan.executionOrderId;
    plan.updatedAt = at;
    return { ...result, planDisposition: "existing_remote_execution", approvalGranted: true, executionSubmitted: true };
  }
  if (status === "dry_run") {
    plan.status = "dry_run";
    plan.executionOrderId = executionOrder?.id || plan.executionOrderId;
    plan.updatedAt = at;
    return { ...result, planDisposition: "dry_run", approvalGranted: true, executionSubmitted: false };
  }
  if (LOCAL_REAPPROVAL_RESULTS.has(status) || !["failed", "rejected", "cancelled"].includes(status)) {
    plan.status = "execution_blocked";
    plan.executionBlock = { reason: status, detail: result.reason || result.detail || null, at };
    plan.approvalConsumedAt = at;
    plan.updatedAt = at;
    return { ...result, planDisposition: "no_remote_effect", approvalGranted: true, executionSubmitted: false };
  }
  plan.status = "failed";
  plan.failedReason ||= result.reason || status;
  plan.updatedAt = at;
  return { ...result, planDisposition: "terminal_rejection", approvalGranted: true, executionSubmitted: false };
}

async function executeApprovedPlanLeased(db, planId, options = {}) {
  const plan = db.tradePlans.find((item) => item.id === planId);
  if (!plan) return { status: "missing_plan", planId };
  if (plan.status !== "approved") return { status: "plan_not_approved", planStatus: plan.status };
  const decisionFacts = ensureDecisionFactSnapshot(db, plan, {
    captureMode: "execution_preflight_legacy",
    capturedBeforeExecution: true
  });
  if (!decisionFacts.ok) {
    appendAudit(db, `交易前决策事实包校验失败：${decisionFacts.reason}`, plan.id, "ExecutionEngine", "critical");
    return { status: "decision_fact_snapshot_invalid", reason: decisionFacts.reason };
  }
  const strategyBinding = ensurePlanStrategyBinding(db, plan, { source: "execution_preflight" });
  if (!strategyBinding.ok && plan.strategyRef?.classification === "version_drift") {
    appendAudit(db, "策略版本内容与已钉住哈希不一致，已拒绝执行", plan.id, "ExecutionEngine", "critical");
    return { status: "strategy_version_drift", strategyRef: plan.strategyRef };
  }
  if (!strategyBinding.ok && strategyBinding.legacyCompatible) {
    plan.strategyValidationLabel = "legacy_unversioned_excluded_from_product_evidence";
    appendAudit(db, "升级前计划按兼容通道执行，不计入版本化策略证据", plan.id, "ExecutionEngine", "warning");
  } else if (!strategyBinding.ok && plan.source === "agent_chat") {
    appendAudit(db, `AI 计划未归属于策略产品：${strategyBinding.error}`, plan.id, "ExecutionEngine", "warning");
    return { status: "strategy_product_required", reason: strategyBinding.error, strategyRef: plan.strategyRef };
  }
  if (strategyBinding.ok) {
    const strategyGate = strategyProductExecutionGate(db, plan);
    if (!strategyGate.allowed) {
      appendAudit(db, `策略产品当前不允许执行：${strategyGate.reason}`, plan.id, "ExecutionEngine", "warning");
      return { status: "strategy_product_blocked", reason: strategyGate.reason, strategyRef: plan.strategyRef };
    }
    plan.strategyValidationLabel = strategyGate.validationLabel;
  }
  const blueprintGate = validatePlanBlueprintGate(db, plan);
  if (!blueprintGate.allowed) {
    appendAudit(db, `工作室策略版本当前不允许执行：${blueprintGate.reason}`, plan.id, "ExecutionEngine", "warning");
    return { status: "strategy_blueprint_blocked", reason: blueprintGate.reason, strategyBlueprintRef: plan.strategyBlueprintRef };
  }
  // 更新运行降级评估(含自愈);实际拦截只认 reduceOnlyMode——它只在 professionalRiskMode 开启+
  // 降级时才被自动置位(或用户手动只减仓)。flag 关时降级仅记录不拦,不再默认焊死交易。
  const degradation = applyOperationalDegradation(db, "ExecutionEngine");
  if (db.system.reduceOnlyMode) return { status: "operational_degraded_reduce_only", degradation };
  // (P2-1)不再看陈旧 lastRiskCheck:上次复查失败会永久卡死计划,即便阻断条件已恢复;
  // 下面的 fresh 复查才是唯一裁判。
  const freshRisk = evaluateTradePlan(db, plan);
  freshRisk.tradePlanId = plan.id;
  freshRisk.tenantId = plan.tenantId || plan.ownerTenantId || db.user?.tenantId || "tenant_owner";
  freshRisk.ownerUserId = plan.ownerUserId || plan.createdByUserId || plan.userId || db.user?.id || null;
  freshRisk.createdAt = nowIso();
  db.riskChecks.unshift(freshRisk);
  plan.lastRiskCheck = freshRisk;
  plan.riskCheckId = freshRisk.id;
  if (!freshRisk.passed) {
    appendAudit(db, `执行前风控复查失败：${freshRisk.summary}`, plan.id, "ExecutionEngine", "warning");
    appendTrace(db, "risk_check", `${plan.symbol} 执行前复查失败`, "blocked");
    return { status: "risk_recheck_failed", riskCheck: freshRisk };
  }
  const mandate = db.mandates.find((item) => item.id === plan.mandateId);
  if (!mandate || !["active", "running"].includes(mandate.status)) return { status: "mandate_not_active" };
  if (Number(plan.mandateVersion || 1) !== Number(mandate.version || 1)) {
    return { status: "mandate_version_stale", planVersion: plan.mandateVersion || 1, mandateVersion: mandate.version || 1 };
  }
  const portfolioIntent = evaluatePortfolioIntentConflict(db, plan, { positionsOnly: true });
  if (!portfolioIntent.ok) {
    plan.executionBlock = { reason: portfolioIntent.reason, detail: portfolioIntent.detail, at: nowIso() };
    appendAudit(db, `组合裁决拒绝新增相反敞口：${portfolioIntent.detail}`, plan.id, "PortfolioArbiter", "warning");
    return { status: "portfolio_intent_conflict", ...portfolioIntent };
  }
  const existing = (db.executionOrders || []).find((item) => item.planId === plan.id
    && (item.status === "created" || OPEN_EXECUTION_STATES.has(item.status)));
  if (existing) return { status: "already_executing", executionOrderId: existing.id };
  const sameSymbolEntry = evaluateSameSymbolEntryConflict(db, plan, mandate);
  if (!sameSymbolEntry.ok) {
    plan.executionBlock = { reason: sameSymbolEntry.reason, detail: sameSymbolEntry.detail, at: nowIso() };
    appendAudit(db, `重复敞口保护拒绝执行：${sameSymbolEntry.detail}`, plan.id, "ExecutionEngine", "warning");
    return { status: "same_symbol_entry_conflict", ...sameSymbolEntry };
  }

  if (db.system.liveTradingEnabled) {
    const liveConfirmation = liveConfirmationStatus(db);
    if (!liveConfirmation.ok) {
      plan.executionBlock = { reason: liveConfirmation.reason, detail: "实盘模型、审查、数据或 Provider 策略已在确认后发生变化", at: nowIso() };
      appendAudit(db, `执行拒绝：${liveConfirmation.reason}`, plan.id, "ExecutionEngine", "critical");
      return { status: "live_policy_confirmation_invalid", ...liveConfirmation };
    }
    if (plan.source === "agent_chat") {
      const auditRecord = (db.decisionAuditRecords || []).find((record) => record.id === plan.decisionProvenance?.auditChain?.recordId) || null;
      const provenanceCheck = validateLiveDecisionProvenance(plan.decisionProvenance, { auditRecord, plan });
      if (!provenanceCheck.ok) {
        plan.executionBlock = { reason: "decision_provenance_incomplete", detail: "Gemini 主提案/DeepSeek 审查/提示词与证据哈希未形成完整不可变归因", at: nowIso() };
        appendAudit(db, "执行拒绝：Agent 计划缺少完整双模型决策归因", plan.id, "ExecutionEngine", "warning");
        return { status: "decision_provenance_incomplete", ...provenanceCheck };
      }
    }
    const preflightSnapshot = latestSuccessfulAccountSnapshot(db, { exchange: "OKX", accountId: plan.accountId || plan.exchangeAccountId || undefined });
    const preflightBinding = validateOkxCredentialBinding(db, {
      accountId: plan.accountId || plan.exchangeAccountId || preflightSnapshot?.accountId,
      snapshot: preflightSnapshot
    });
    if (!preflightBinding.ok) {
      plan.executionBlock = { reason: preflightBinding.reason, detail: "OKX 账户、Key 指纹与快照未形成同一权威绑定", at: nowIso() };
      return { status: "account_configuration_conflict", reason: preflightBinding.reason };
    }
    plan.accountId = preflightBinding.account.id;
    plan.apiKeyFingerprint = preflightBinding.currentFingerprint;
  }

  const sizing = computePositionSize(db, plan);
  if (sizing.error) {
    // 把"批准了却没下单"的真实原因写到计划上,前端好显示(用户实锤:approved 但无订单、界面不说为什么)。
    const human = sizing.error === "below_min_notional"
      ? `仓位约 ${Number(sizing.notional || 0).toFixed(2)} USDT，低于交易所最小名义额 ${sizing.minNotional || 5} USDT——账户太小或单笔风险%太低，无法下出有效订单`
      : sizing.error === "quantity_rounds_to_zero" ? "计算仓位四舍五入为 0，账户过小"
      : sizing.error === "invalid_entry_or_stop" ? "入场/止损数值非法"
      : sizing.error === "zero_stop_distance" ? "入场与止损相等，止损距离为 0"
      : sizing.error === "account_snapshot_required" ? "缺少最新 OKX 账户快照，无法按真实资金定仓"
      : sizing.error === "account_snapshot_stale" ? "OKX 账户快照已过期，必须同步后重新计算仓位"
      : sizing.error === "account_snapshot_time_invalid" ? "OKX 账户快照时间异常，必须校准系统时间并重新同步"
      : sizing.error === "available_margin_unavailable" ? "OKX 可用保证金不可用，已禁止猜测下单金额"
      : sizing.error === "account_equity_unavailable" ? "OKX 账户权益不可用，已禁止猜测下单金额"
      : sizing.error === "projected_margin_limit_exceeded" ? "下单后的预计保证金使用率会超过授权上限"
      : sizing.error === "projected_margin_capacity_exhausted" ? "当前保证金使用率已达到授权上限，没有新增仓位空间"
      : sizing.error;
    plan.executionBlock = { reason: sizing.error, detail: human, at: nowIso() };
    appendAudit(db, `执行引擎未下单（${sizing.error}）：${human}`, plan.id, "ExecutionEngine", "warning");
    return { status: "sizing_failed", ...sizing, detail: human };
  }
  plan.executionBlock = null;
  // R 期望必须以实际定仓后的初始止损风险为分母。缺该值时策略证据层会保持 null，
  // 绝不从计划风险百分比或名义额猜测；写在 plan/order/fill 链上供永久归因。
  plan.initialRiskUsdt = sizing.initialRiskUsdt;
  plan.accountEquityAtEntryUsdt = sizing.equity;

  const marketForCost = (db.markets || []).find((item) => item.symbol === plan.symbol) || {};
  const executionCostEstimate = estimateExecutionCost(db, {
    symbol: plan.symbol,
    spreadBps: marketForCost.spreadBps,
    depthUsdt: marketForCost.depthUsdt || marketForCost.orderBookDepthUsdt || marketForCost.depth5Usdt,
    notionalUsdt: sizing.notional
  });
  if (db.system.liveTradingEnabled && !executionCostEstimate.ok) {
    plan.executionBlock = { reason: "execution_cost_evidence_missing", detail: "缺少有效盘口深度/点差，无法计算净成本盈亏比", at: nowIso() };
    appendAudit(db, "执行前净成本 RR 无法计算：盘口成本证据缺失", plan.id, "ExecutionEngine", "warning");
    return { status: "execution_cost_evidence_missing", reason: executionCostEstimate.reason };
  }
  const firstTarget = (plan.takeProfit || plan.take_profit || [])[0];
  const fundingPeriods = plan.traderRole === "swing_trader"
    ? Math.max(1, Number(process.env.NET_RR_SWING_FUNDING_PERIODS || 3))
    : Math.max(1, Number(process.env.NET_RR_DAY_FUNDING_PERIODS || 1));
  const netRewardRisk = estimateNetRewardRisk({
    direction: plan.direction,
    entryPrice: sizing.entryMid,
    stopPrice: plan.stopLoss ?? plan.stop_loss,
    targetPrice: firstTarget,
    quantity: sizing.quantity,
    expectedImpactBps: executionCostEstimate.expectedImpactBps,
    maxEntrySlippageBps: Number(plan.max_slippage_pct ?? 0.08) * 100,
    stopSlippageBps: Number(process.env.NET_RR_STOP_SLIPPAGE_BPS || 12),
    targetSlippageBps: Number(process.env.NET_RR_TARGET_SLIPPAGE_BPS || executionCostEstimate.expectedImpactBps || 0),
    takerFeeRate: Number(process.env.OKX_TAKER_FEE_RATE || 0.0005),
    fundingRatePct: marketForCost.fundingRate,
    fundingPeriods
  });
  const minimumNetRewardRisk = currentRiskThresholds().minRewardRisk;
  plan.netRewardRisk = netRewardRisk.ok ? structuredClone(netRewardRisk) : null;
  plan.minimumNetRewardRisk = minimumNetRewardRisk;
  const netRewardRiskDecision = netRewardRiskGate(netRewardRisk, minimumNetRewardRisk, { live: db.system.liveTradingEnabled });
  if (!netRewardRiskDecision.allowed) {
    const detail = !netRewardRisk.ok
      ? `净成本 RR 无法验证（${netRewardRisk.reason}）`
      : `净成本后仅 ${netRewardRisk.netRewardRisk.toFixed(2)}R，低于硬门槛 ${minimumNetRewardRisk}R`;
    plan.executionBlock = { reason: "net_reward_risk_rejected", detail, at: nowIso() };
    appendAudit(db, `执行前净成本 RR 拒绝：${detail}`, plan.id, "ExecutionEngine", "warning");
    return { status: "net_reward_risk_rejected", detail, netRewardRisk, minimumNetRewardRisk, decision: netRewardRiskDecision };
  }

  const executionOrder = {
    id: id("exec"),
    planId: plan.id,
    tenantId: plan.tenantId || plan.ownerTenantId || db.user?.tenantId || "tenant_owner",
    ownerUserId: plan.ownerUserId || plan.createdByUserId || plan.userId || db.user?.id || null,
    agentRunId: plan.agentRunId,
    mandateId: plan.mandateId,
    riskCheckId: plan.riskCheckId,
    analysisBundleId: plan.analysisBundleId,
    evidenceBundleId: plan.evidenceBundleId,
    decisionProvenance: plan.decisionProvenance ? structuredClone(plan.decisionProvenance) : null,
    criticReviewId: plan.criticReviewId || plan.decisionProvenance?.critic?.reviewId || null,
    exchange: plan.exchange,
    accountId: plan.accountId || plan.exchangeAccountId || latestSuccessfulAccountSnapshot(db, { exchange: String(plan.exchange || "OKX").toUpperCase() })?.accountId || null,
    apiKeyFingerprint: currentOkxCredentialFingerprint(),
    symbol: plan.symbol,
    direction: plan.direction,
    leverage: Number(plan.leverage || 1),
    strategy: plan.strategy || plan.strategy_type || "manual_review",
    strategyRef: plan.strategyRef ? { ...plan.strategyRef } : null,
    strategyBlueprintRef: plan.strategyBlueprintRef ? { ...plan.strategyBlueprintRef } : null,
    strategyProductId: plan.strategyProductId || null,
    strategyVersion: plan.strategyVersion || null,
    strategyVersionId: plan.strategyVersionId || null,
    strategyInstance: plan.strategyInstance ? structuredClone(plan.strategyInstance) : null,
    knowledgeSkills: plan.knowledgeSkills || [],
    reviewLearning: plan.reviewLearning ? structuredClone(plan.reviewLearning) : null,
    entryRationale: entryRationale(plan),
    confidenceBefore: asNumber(plan.confidenceBefore ?? plan.confidence),
    confidenceAfter: asNumber(plan.confidenceAfter ?? plan.lastRiskCheck?.confidence),
    regime: inferMarketRegime(db, plan.symbol),
    quantity: sizing.quantity,
    entryPrice: sizing.entryMid,
    stopLoss: Number(plan.stopLoss ?? plan.stop_loss),
    takeProfits: (plan.takeProfit || plan.take_profit || []).map(Number).filter(Number.isFinite),
    notionalUsdt: sizing.notional,
    initialRiskUsdt: sizing.initialRiskUsdt,
    accountEquityAtEntryUsdt: sizing.equity,
    sizedBy: sizing.sizedBy,
    accountCapacity: sizing.marginCapacity,
    projectedMargin: sizing.projectedMargin,
    executionCostEstimate: executionCostEstimate.ok ? executionCostEstimate : null,
    netRewardRisk: netRewardRisk.ok ? structuredClone(netRewardRisk) : null,
    minimumNetRewardRisk,
    status: "created",
    events: [{ at: nowIso(), event: "created", detail: sizing.projectedMargin.unavailable
      ? `数量 ${sizing.quantity}，名义 ${sizing.notional.toFixed(2)} USDT（非实盘，账户保证金数据不可用；${sizing.sizedBy}）`
      : `数量 ${sizing.quantity}，名义 ${sizing.notional.toFixed(2)} USDT，预计占用保证金 ${sizing.projectedMargin.incrementalMargin.toFixed(2)} USDT、成交后使用率 ${sizing.projectedMargin.projectedUtilizationPct.toFixed(1)}%（${sizing.sizedBy}）` }],
    createdAt: nowIso()
  };
  db.executionOrders.unshift(executionOrder);

  // 结构方法学仍由分析层产生事实；执行层不主观判断 SMC。但净成本 RR 是确定性财务硬闸，
  // 已在上方按最差可接受成交、双边费用、退出滑点与预计资金费完成校验。

  if (!db.system.liveTradingEnabled) {
    executionOrder.status = "dry_run";
    executionOrder.events.push({ at: nowIso(), event: "dry_run", detail: "实盘写入关闭：已完成数量与价格计算，未向交易所提交。" });
    appendAudit(db, "执行引擎干跑：实盘写入关闭", executionOrder.id, "ExecutionEngine");
    appendTrace(db, "execution", `${plan.symbol} 干跑（实盘关闭）`, "guarded");
    plan.executionOrderId = executionOrder.id;
    // 干跑是终态:计划必须落到 dry_run,不能停在 approved——否则永不过期、还能被再批准而下重复单(审计 state-F4)。
    plan.status = "dry_run";
    return { status: "dry_run", executionOrder };
  }

  const enabledAccounts = enabledOkxAccounts(db);
  const credentialBinding = validateOkxCredentialBinding(db, { accountId: executionOrder.accountId || enabledAccounts[0]?.id });
  if (!credentialBinding.ok) {
    executionOrder.status = "account_configuration_conflict";
    plan.status = "failed";
    plan.executionOrderId = executionOrder.id;
    plan.failedReason = "当前单凭证架构要求唯一启用且与执行绑定一致的 OKX 账户";
    saveDb(db);
    return { status: "account_configuration_conflict", reason: credentialBinding.reason, enabledAccountIds: enabledAccounts.map((row) => row.id), executionOrder };
  }
  executionOrder.accountId = credentialBinding.account.id;
  executionOrder.apiKeyFingerprint = credentialBinding.currentFingerprint;

  // 执行时滑点保护:下单前用最新真实价核对,现价偏离入场中值超阈值即拒——防在急动/闪崩里以坏价成交
  // (plan 时的"入场贴近现价 ≤8%"是提计划口径,这里是执行口径,阈值更紧,默认 1%)。
  {
    const market = (db.markets || []).find((mk) => mk.symbol === plan.symbol) || {};
    const freshness = marketFactFreshness(market);
    const bundle = (db.evidenceBundles || []).find((row) => row.id === plan.evidenceBundleId);
    const evidence = currentEvidenceReadiness(bundle, plan.symbol);
    if (!freshness.ticker.ok || !freshness.micro.ok || !evidence.ok) {
      const reason = !freshness.ticker.ok
        ? (freshness.ticker.reason === "future_timestamp" ? "ticker_time_invalid" : "ticker_stale")
        : !freshness.micro.ok
          ? (freshness.micro.reason === "future_timestamp" ? "micro_time_invalid" : "micro_stale")
          : "evidence_readiness_expired";
      executionOrder.status = "market_facts_rejected";
      executionOrder.events.push({ at: nowIso(), event: "market_facts_rejected", detail: reason });
      plan.status = "failed";
      plan.executionOrderId = executionOrder.id;
      plan.failedReason = `执行前市场事实校验失败：${reason}`;
      appendAudit(db, `执行前市场事实校验失败：${reason}`, executionOrder.id, "ExecutionEngine", "warning");
      return { status: "market_facts_rejected", reason, freshness, evidence, executionOrder };
    }
    const maxSlipPct = Number(process.env.MAX_ENTRY_SLIPPAGE_PCT || 1.0);
    const livePx = freshness.price;
    if (Number.isFinite(livePx) && livePx > 0 && Number.isFinite(sizing.entryMid) && sizing.entryMid > 0) {
      const devPct = Math.abs(livePx - sizing.entryMid) / sizing.entryMid * 100;
      if (devPct > maxSlipPct) {
        executionOrder.status = "slippage_rejected";
        executionOrder.events.push({ at: nowIso(), event: "slippage_rejected", detail: `现价 ${livePx} 偏离入场 ${sizing.entryMid} ${devPct.toFixed(2)}% > ${maxSlipPct}%，拒绝以坏价成交` });
        appendAudit(db, `滑点保护拒单：偏离 ${devPct.toFixed(2)}%（>${maxSlipPct}%）`, executionOrder.id, "ExecutionEngine", "warning");
        appendTrace(db, "execution", `${plan.symbol} 滑点保护拒单 ${devPct.toFixed(2)}%`, "warning");
        plan.status = "failed";
        plan.executionOrderId = executionOrder.id;
        plan.failedReason = `滑点保护：现价偏离入场 ${devPct.toFixed(2)}%（>${maxSlipPct}%）`;
        return { status: "slippage_rejected", devPct, executionOrder };
      }
    }
  }

  const side = plan.direction === "short" ? "SELL" : "BUY";
  const entryClientOrderId = cleanClOrdId(`exec${executionOrder.id.slice(-12)}`);
  const stopClientOrderId = cleanClOrdId(`stop${executionOrder.id.slice(-12)}`);
  // 先保存请求身份；即使 HTTP 结果 UNKNOWN 或原生止损缺失，恢复轮询也必须能用
  // 同一个 clOrdId 查询真实订单，不能进入永远无法核验的 pending。
  executionOrder.clientOrderId = entryClientOrderId;
  executionOrder.stopClientOrderId = stopClientOrderId;
  executionOrder.requestedQuantity = sizing.quantity;
  if (String(plan.exchange || "OKX").toUpperCase() === "OKX" && String(plan.marketType || "perpetual_usdt").includes("perpetual")) {
    const instId = toOkxSymbol(plan.symbol, "perpetual");
    const spec = await (options.okxContractSpec || okxContractSpec)(instId);
    if (!spec?.ctVal || !spec?.lotSz || !spec?.minSz) {
      executionOrder.status = "instrument_spec_unavailable";
      plan.status = "failed";
      plan.executionOrderId = executionOrder.id;
      plan.failedReason = "OKX 合约规格不可用，未向交易所提交入场单";
      saveDb(db);
      return { status: "instrument_spec_unavailable", executionOrder };
    }
    const contracts = Math.floor((Number(sizing.quantity) / Number(spec.ctVal)) / Number(spec.lotSz) + 1e-9) * Number(spec.lotSz);
    if (!Number.isFinite(contracts) || contracts < Number(spec.minSz)) {
      executionOrder.status = "submitted_size_below_exchange_minimum";
      plan.status = "failed";
      plan.executionOrderId = executionOrder.id;
      plan.failedReason = "风险定仓向下对齐后低于 OKX 最小张数，未提交";
      saveDb(db);
      return { status: "submitted_size_below_exchange_minimum", executionOrder };
    }
    executionOrder.okxCtVal = Number(spec.ctVal);
    executionOrder.okxLotSz = Number(spec.lotSz);
    executionOrder.okxMinSz = Number(spec.minSz);
    executionOrder.okxTickSz = Number(spec.tickSz);
    executionOrder.submittedContracts = contracts;
    executionOrder.submittedCoinQuantity = Number((contracts * Number(spec.ctVal)).toFixed(12));
    executionOrder.quantity = executionOrder.submittedCoinQuantity;
    executionOrder.notionalUsdt = Number(executionOrder.quantity) * Number(executionOrder.entryPrice);
  } else {
    executionOrder.submittedCoinQuantity = sizing.quantity;
  }
  executionOrder.status = "entry_unknown_pending";
  executionOrder.entryAttemptedAt ||= nowIso();
  executionOrder.protection = "requested_unconfirmed";
  saveDb(db);
  let result;
  try {
    assertActiveLease(options);
    result = await (options.executeTradeAction || executeTradeAction)(db, "place_order", {
      exchange: plan.exchange,
      marketType: plan.marketType || "perpetual_usdt",
      symbol: plan.symbol,
      side,
      posSide: plan.direction === "short" ? "short" : "long",
      positionSide: plan.direction === "short" ? "SHORT" : "LONG", // 币安对冲模式必需(OKX 用上面的 posSide),缺则 -4061 拒(审计 exch-F3)

      type: "LIMIT",
      price: sizing.entryMid,
      quantity: executionOrder.submittedCoinQuantity,
      stopLoss: executionOrder.stopLoss,
      stopClientOrderId,
      leverage: plan.leverage,
      strategyId: executionOrder.strategy,
      strategyProductId: executionOrder.strategyProductId,
      strategyVersion: executionOrder.strategyVersion,
      strategyVersionId: executionOrder.strategyVersionId,
      timeframe: plan.timeframe || plan.candlesTimeframe || null,
      knowledgeSkills: executionOrder.knowledgeSkills,
      clientOrderId: entryClientOrderId,
      agentRunId: plan.agentRunId,
      analysisBundleId: plan.analysisBundleId,
      evidenceBundleId: plan.evidenceBundleId,
      tradePlanId: plan.id,
      riskCheckId: plan.riskCheckId,
      mandateId: plan.mandateId,
      oneShotAuth: plan.oneShotAuth === true, // 白名单外一次性授权计划:放行交易对正向白名单闸(仅本笔)
      manualApproval: options.manualApproval === true
    });
  } catch (error) {
    if (isLeaseLostError(error)) throw error;
    // 入场调用抛异常（如止损附单被交易所拒绝后 HTTP 非 2xx 直接 throw）：
    // 入场是否已在交易所存活【未知】（OMS 已置 UNKNOWN，恢复任务会对账）。
    // 绝不允许可能存在的裸仓静默存活：按保护失败流程尽力撤单，撤不掉即熔断。
    executionOrder.events.push({ at: nowIso(), event: "entry_exception", detail: String(error.message || error).slice(0, 200) });
    return await failProtectionAndCancelEntry(db, plan, executionOrder, {
      exchangeOrderId: null,
      clientOrderId: entryClientOrderId
    }, `入场调用异常：${String(error.message || error).slice(0, 120)}`, options);
  }

  if (result.status === "blocked") {
    executionOrder.status = "blocked";
    executionOrder.events.push({ at: nowIso(), event: "blocked", detail: result.reason });
    appendAudit(db, `执行被安全闸拦截：${result.reason}`, executionOrder.id, "ExecutionEngine", "warning");
    return { status: "blocked", reason: result.reason, executionOrder };
  }
  if (result.status === "unknown_pending") {
    executionOrder.status = "entry_unknown_pending";
    executionOrder.omsOrderId = result.omsOrderId || result.actionId || executionOrder.omsOrderId || null;
    executionOrder.events.push({ at: nowIso(), event: "entry_response_unknown", detail: "OMS 请求状态未知，持续按 clOrdId 查询交易所终态" });
    db.system ||= {};
    db.system.reduceOnlyMode = true;
    db.system.reduceOnlyBy ||= "entry_reconciliation_pending";
    saveDb(db);
    return { status: "entry_unknown_pending", result, executionOrder };
  }
  if (!["ok", "submitted", "idempotent_replay"].includes(result.status)) {
    executionOrder.status = "failed";
    executionOrder.events.push({ at: nowIso(), event: "failed", detail: JSON.stringify(result).slice(0, 300) });
    // 入场提交失败 → 计划立即置终态。否则计划仍停在 approved/awaiting_approval,
    // 会被巡检的 awaitingPlan 闸当成"待处理计划"而冻结整条自主决策(实锤:08:29 失败单
    // 让计划僵在 awaiting_approval,后续每轮巡检都 patrol_only 空转 3h+,再无一单)。
    plan.status = "failed";
    plan.executionOrderId = executionOrder.id;
    plan.failedReason = `入场提交失败:${result.status}${result.reason ? `(${result.reason})` : ""}`.slice(0, 160);
    appendAudit(db, "执行提交失败", executionOrder.id, "ExecutionEngine", "warning");
    return { status: "failed", result, executionOrder };
  }
  executionOrder.exchangeOrderId = result.exchangeOrderId || executionOrder.exchangeOrderId || null;
  executionOrder.omsOrderId = result.omsOrderId || executionOrder.omsOrderId || null;
  executionOrder.clientOrderId = result.clientOrderId || executionOrder.clientOrderId;
  executionOrder.okxCtVal = result.okxCtVal || executionOrder.okxCtVal || null;
  executionOrder.submittedContracts = asNumber(result.okxContracts) ?? executionOrder.submittedContracts;
  executionOrder.submittedCoinQuantity = Number.isFinite(Number(result.okxContracts)) && Number(result.okxCtVal) > 0
    ? Number(result.okxContracts) * Number(result.okxCtVal)
    : executionOrder.submittedCoinQuantity;
  executionOrder.quantity = executionOrder.submittedCoinQuantity;
  executionOrder.notionalUsdt = Number(executionOrder.quantity) * Number(executionOrder.entryPrice);
  // result.protection 只证明入场请求携带了 attachAlgoOrds，不证明止损已在交易所
  // 成为可执行算法单。真实成交前保持 unconfirmed，成交时再按精确 stop ID 核验。
  if (!result.protection) {
    return await failProtectionAndCancelEntry(db, plan, executionOrder, result, "原生止损未确认", options);
  }

  executionOrder.status = "entry_pending";
  executionOrder.entryPendingAt = nowIso(); // 挂单起始时刻:给"久未成交超时撤单"用
  executionOrder.protection = "requested_unconfirmed";
  executionOrder.events.push({ at: nowIso(), event: "entry_submitted", detail: `交易所订单 ${result.exchangeOrderId || "?"}` });
  plan.status = "executing";
  plan.executionOrderId = executionOrder.id;
  appendAudit(db, "执行引擎已提交入场单", executionOrder.id, "ExecutionEngine");
  appendTrace(db, "execution", `${plan.symbol} 入场单已提交`, "ok");
  return { status: "submitted", executionOrder };
}

// ---------------------------------------------------------------------------
// 订单状态轮询：入场成交 → 布置止盈；终态 → 记录成交与盈亏。
// ---------------------------------------------------------------------------
// 久未成交/已失效的入场挂单是否该撤——纯决策函数(可单测,不碰交易所/时间外部依赖除 now)。
// 返回 { reason, followUp }：followUp=true 表示"想抓的这波已自己走完、挂单错过了进场",
// 撤单后应立刻重新评估以【追踪趋势】(而不仅仅撤了拉倒)。撤单优先级由高到低:
//  ①行情已自行走到止盈方向、入场仍未成交 = 错过进场(followUp,追趋势);
//  ②现价越过止损 = 成交即止损,失效;
//  ③超时(默认90分钟);
//  ④大幅偏离入场(默认>8%,机会已走/结构变)。
export function staleEntryDecision(eo, price, cfg = {}) {
  const ttlMin = Number(cfg.ttlMin ?? 90);
  const devPct = Number(cfg.devPct ?? 8);
  const isShort = String(eo.direction).toLowerCase() === "short";
  const px = Number(price);
  const hasPx = Number.isFinite(px) && px > 0;
  // ① 行情已走到止盈方向、入场未成交:取最靠近入场的那个止盈(短=最高TP、多=最低TP)。
  const tps = (eo.takeProfits || eo.takeProfit || []).map(Number).filter(Number.isFinite);
  const firstTp = tps.length ? (isShort ? Math.max(...tps) : Math.min(...tps)) : null;
  if (hasPx && Number.isFinite(firstTp) && (isShort ? px <= firstTp : px >= firstTp)) {
    return { reason: `现价 ${px} 已走到止盈 ${firstTp} 方向、入场单仍未成交——这波行情已自行走完、挂单错过进场，撤单并重新评估以追踪趋势`, followUp: true };
  }
  // ② 现价越过止损
  const stop = Number(eo.stopLoss);
  if (hasPx && Number.isFinite(stop) && (isShort ? px >= stop : px <= stop)) {
    return { reason: `现价 ${px} 已越过止损 ${stop}（成交即触发止损），撤未成交入场单`, followUp: false };
  }
  // ③ 超时
  const startedAt = new Date(eo.entryPendingAt || eo.createdAt || 0).getTime();
  const ageMin = Number.isFinite(startedAt) && startedAt > 0 ? (Date.now() - startedAt) / 60000 : 0;
  if (ttlMin > 0 && ageMin >= ttlMin) return { reason: `挂单 ${Math.round(ageMin)} 分钟未成交（超过 ${ttlMin} 分钟保质期），撤单`, followUp: false };
  // ④ 大幅偏离入场
  const entry = Number(eo.entryPrice ?? eo.filledPrice);
  if (hasPx && Number.isFinite(entry) && entry > 0 && Math.abs(px - entry) / entry * 100 >= devPct) {
    return { reason: `现价 ${px} 已偏离入场 ${entry} 逾 ${devPct}%（机会已走/结构改变），撤未成交入场单`, followUp: false };
  }
  return { reason: null, followUp: false };
}

// 久未成交/已失效的入场挂单:主动撤单(真向交易所撤),置计划终态 + 落审计 + 通知。
// followUp 的(错过进场):把该 symbol 推进快速异动队列,下一轮巡检立刻优先重评估→可追这波趋势(#2)。
async function manageStalePendingEntries(db, options = {}) {
  const ttlMin = Number(process.env.ENTRY_ORDER_TTL_MINUTES || db.runtimeConfig?.ENTRY_ORDER_TTL_MINUTES || 90);
  const devPct = Number(process.env.ENTRY_STALE_DEVIATION_PCT || db.runtimeConfig?.ENTRY_STALE_DEVIATION_PCT || 8);
  const pendings = (db.executionOrders || []).filter((o) => ["entry_pending", "entry_partial"].includes(o.status));
  const cancelled = [];
  for (const eo of pendings) {
    if (new Date(eo.staleCancelRetryAfter || 0).getTime() > Date.now()) continue;
    const market = (db.markets || []).find((m) => m.symbol === eo.symbol);
    const { reason, followUp } = staleEntryDecision(eo, market?.price, { ttlMin, devPct });
    if (!reason) continue;
    const isShort = String(eo.direction).toLowerCase() === "short";
    try {
      assertActiveLease(options);
      eo.staleCancelReason = reason;
      eo.staleFollowUp = followUp;
      const intent = "emergency_close_if_filled";
      const result = await closeExecution(db, eo.id, reason, {
        intent, expectedStatus: eo.status, internal: true,
        executeTradeAction: options.executeTradeAction,
        assertLease: options.assertLease,
        signal: options.signal
      });
      if (result.status === "cancel_pending") {
        appendAudit(db, `挂单撤单请求已提交，等待交易所终态：${eo.symbol} — ${reason}`, eo.id, "EntryTTL", "warning");
        appendTrace(db, "execution", `${eo.symbol} 撤单确认中（${reason.slice(0, 20)}）`, "pending");
        try {
          assertActiveLease(options);
          const { notifyLark } = await import("./larkNotifier.mjs");
          assertActiveLease(options);
          await notifyLark(db, { severity: "warning", title: "⏳ 挂单撤销请求已提交", body: `**${eo.symbol}** ${isShort ? "做空" : "做多"} 正等待交易所确认撤单：${reason}` });
        } catch (error) { if (isLeaseLostError(error)) throw error; /* 通知失败不阻断 */ }
        cancelled.push({ id: eo.id, symbol: eo.symbol, reason, followUp });
      } else if (result.status === "cancel_unconfirmed") {
        eo.staleCancelRetryAfter = new Date(Date.now() + 60_000).toISOString();
        eo.events.push({ at: nowIso(), event: "stale_cancel_rejected", detail: result.result?.reason || result.result?.status || "unknown" });
      }
    } catch (error) {
      if (isLeaseLostError(error)) throw error;
      eo.events.push({ at: nowIso(), event: "stale_cancel_error", detail: String(error.message || error).slice(0, 160) });
    }
  }
  return cancelled;
}

export async function pollExecutionOrders(db, options = {}) {
  options.assertLease?.();
  // 先处理久挂/失效的入场单(超时撤/反转撤),再正常轮询成交状态。
  const staleCancelled = await manageStalePendingEntries(db, options);
  const open = (db.executionOrders || []).filter((item) => OPEN_EXECUTION_STATES.has(item.status));
  const results = [];
  for (const executionOrder of open) {
    try {
      options.assertLease?.();
      results.push(await pollOne(db, executionOrder, options));
    } catch (error) {
      if (isLeaseLostError(error)) throw error;
      executionOrder.events.push({ at: nowIso(), event: "poll_error", detail: error.message });
      results.push({ id: executionOrder.id, status: "poll_error", error: error.message });
    }
  }
  options.assertLease?.();
  const financialReconciliation = await reconcilePendingTradeFinancials(db, options);
  options.assertLease?.();
  syncReduceOnlyState(db);
  return { checked: open.length, staleCancelled: staleCancelled.length, results, financialReconciliation };
}

function pendingAgeMs(value, nowMs) {
  const at = new Date(value || 0).getTime();
  return Number.isFinite(at) && at > 0 ? Math.max(0, nowMs - at) : Infinity;
}

function raisePendingProgressIncident(db, executionOrder, kind, title, detail) {
  db.riskIncidents ||= [];
  let incident = db.riskIncidents.find((row) => row.status === "open" && row.kind === kind && row.source === executionOrder.id);
  if (!incident) {
    incident = {
      id: id("incident"), kind, severity: "critical", status: "open", title, source: executionOrder.id,
      tenantId: executionOrder.tenantId || db.user?.tenantId || "tenant_owner",
      ownerUserId: executionOrder.ownerUserId || db.user?.id || null,
      createdAt: nowIso()
    };
    db.riskIncidents.unshift(incident);
  }
  incident.updatedAt = nowIso();
  incident.detail = detail;
  db.system ||= {};
  db.system.killSwitch = true;
  db.system.reduceOnlyMode = true;
  db.system.riskStatus = "暂停新开仓";
  refreshOwnerImprovementRegistry(db);
  return incident;
}

async function handleCancelPendingWatchdog(db, executionOrder, options = {}, reason = "order_still_open") {
  const nowMs = Number(options.nowMs ?? Date.now());
  const slaMs = Number(options.cancelProgressSlaMs ?? process.env.CANCEL_PROGRESS_SLA_MS ?? 30_000);
  if (pendingAgeMs(executionOrder.cancelAttemptedAt || executionOrder.cancelSubmittedAt, nowMs) < slaMs) return { status: "within_sla" };
  const retryCount = Number(executionOrder.cancelRetryCount || 0);
  const maxRetries = Number(options.maxCancelRetries ?? process.env.MAX_CANCEL_RETRIES ?? 3);
  const nextAt = new Date(executionOrder.cancelNextAttemptAt || 0).getTime();
  raisePendingProgressIncident(db, executionOrder, "cancel_progress_timeout", `${executionOrder.symbol} 撤单长时间未取得终态`, `${reason}；重试 ${retryCount}/${maxRetries}`);
  if (retryCount >= maxRetries || (Number.isFinite(nextAt) && nextAt > nowMs)) return { status: "manual_attention_required", retryCount };
  const attempt = retryCount + 1;
  executionOrder.cancelRetryCount = attempt;
  executionOrder.cancelLastAttemptAt = new Date(nowMs).toISOString();
  executionOrder.cancelNextAttemptAt = new Date(nowMs + Math.min(300_000, slaMs * (2 ** attempt))).toISOString();
  saveDb(db);
  assertActiveLease(options);
  const result = await (options.executeTradeAction || executeTradeAction)(db, "cancel_order", {
    exchange: executionOrder.exchange || "OKX",
    marketType: "perpetual_usdt",
    symbol: executionOrder.symbol,
    orderId: executionOrder.exchangeOrderId,
    clientOrderId: executionOrder.clientOrderId,
    actionAttemptId: `cancelretry${String(executionOrder.id).replace(/[^a-zA-Z0-9]/g, "").slice(-16)}${attempt}`,
    emergencyActionId: `emergency_cancel_watchdog_${String(executionOrder.id).replace(/[^a-zA-Z0-9_-]/g, "").slice(-20)}`,
    executionOrderId: executionOrder.id,
    tradePlanId: executionOrder.planId,
    accountId: executionOrder.accountId,
    apiKeyFingerprint: executionOrder.apiKeyFingerprint,
    exitIntent: executionOrder.cancelDisposition,
    manualApproval: true,
  });
  executionOrder.events ||= [];
  executionOrder.events.push({ at: nowIso(), event: "cancel_watchdog_retry", detail: `${attempt}:${result.status}` });
  return { status: result.status, retryCount: attempt };
}

async function handleClosePendingWatchdog(db, executionOrder, options = {}) {
  const nowMs = Number(options.nowMs ?? Date.now());
  const slaMs = Number(options.closeProgressSlaMs ?? process.env.CLOSE_PROGRESS_SLA_MS ?? 45_000);
  if (pendingAgeMs(executionOrder.closeAttemptedAt || executionOrder.closeSubmittedAt, nowMs) < slaMs) return { status: "within_sla" };
  const retryCount = Number(executionOrder.closeRetryCount || 0);
  const maxRetries = Number(options.maxCloseRetries ?? process.env.MAX_CLOSE_RETRIES ?? 3);
  const nextAt = new Date(executionOrder.closeNextAttemptAt || 0).getTime();
  raisePendingProgressIncident(db, executionOrder, "close_progress_timeout", `${executionOrder.symbol} 平仓长时间未消除敞口`, `position_still_open；重试 ${retryCount}/${maxRetries}`);
  if (retryCount >= maxRetries || (Number.isFinite(nextAt) && nextAt > nowMs)) return { status: "manual_attention_required", retryCount };
  const attempt = retryCount + 1;
  executionOrder.closeRetryCount = attempt;
  executionOrder.closeLastAttemptAt = new Date(nowMs).toISOString();
  executionOrder.closeNextAttemptAt = new Date(nowMs + Math.min(300_000, slaMs * (2 ** attempt))).toISOString();
  saveDb(db);
  assertActiveLease(options);
  const result = await (options.executeTradeAction || executeTradeAction)(db, "close_position", {
    exchange: executionOrder.exchange || "OKX",
    marketType: "perpetual_usdt",
    symbol: executionOrder.symbol,
    closePosition: true,
    positionSide: canonicalPositionDirection(executionOrder),
    clientOrderId: executionOrder.closeClientOrderId,
    actionAttemptId: `closeretry${String(executionOrder.id).replace(/[^a-zA-Z0-9]/g, "").slice(-16)}${attempt}`,
    emergencyActionId: `emergency_close_watchdog_${String(executionOrder.id).replace(/[^a-zA-Z0-9_-]/g, "").slice(-20)}`,
    executionOrderId: executionOrder.id,
    tradePlanId: executionOrder.planId,
    accountId: executionOrder.accountId,
    apiKeyFingerprint: executionOrder.apiKeyFingerprint,
    exitIntent: "close_position",
    manualApproval: true,
  });
  executionOrder.events ||= [];
  executionOrder.events.push({ at: nowIso(), event: "close_watchdog_retry", detail: `${attempt}:${result.status}` });
  return { status: result.status, retryCount: attempt };
}

async function pollOne(db, executionOrder, options = {}) {
  if (executionOrder.status === "group_close_pending") {
    const owner = (db.executionOrders || []).find((row) => row.id === executionOrder.groupCloseExecutionId);
    const prior = owner?.groupCloseIntent?.priorStatuses?.[executionOrder.id] || "entry_filled";
    if (!owner || owner.groupCloseIntent?.status === "retryable_failure") {
      executionOrder.status = prior;
      delete executionOrder.groupCloseExecutionId;
      return { id: executionOrder.id, status: executionOrder.status, groupOwnerStatus: owner?.status || "missing" };
    }
    if (["closed", "group_closed"].includes(owner.status)) {
      executionOrder.status = "group_closed";
      executionOrder.closedAt ||= owner.closedAt || nowIso();
      return { id: executionOrder.id, status: executionOrder.status, groupOwnerStatus: owner.status };
    }
    return { id: executionOrder.id, status: executionOrder.status, groupCloseExecutionId: executionOrder.groupCloseExecutionId, groupOwnerStatus: owner.status };
  }
  if (["close_pending", "close_unknown_pending", "close_reconciliation_pending"].includes(executionOrder.status)) {
    const closeBinding = validateOkxCredentialBinding(db, {
      accountId: executionOrder.accountId,
      executionFingerprint: executionOrder.apiKeyFingerprint
    });
    if (!closeBinding.ok) return { id: executionOrder.id, status: executionOrder.status, settlement: closeBinding.reason };
    const snapshot = options.snapshot || (executionOrder.accountId
      ? latestSuccessfulAccountSnapshot(db, { exchange: "OKX", accountId: executionOrder.accountId })
      : null);
    const attributedManualClosure = buildAttributedManualExitClosure(db, executionOrder);
    const attributedSystemClosure = buildAttributedSystemExitClosure(db, executionOrder);
    if (!attributedManualClosure.fills.length && !attributedSystemClosure.fills.length
      && snapshotPositionOpen(snapshot, executionOrder)) {
      await handleClosePendingWatchdog(db, executionOrder, options);
    }
    const closureResolver = executionOrder.closeReconciliationSource === "protection_orders"
      ? (options.fetchProtectionClosure || fetchOkxProtectionClosure)
      : (options.fetchManualClosure || fetchOkxManualClosure);
    return reconcilePendingClose(db, executionOrder, {
      snapshot,
      closure: options.closure === undefined
        ? (attributedManualClosure.complete ? attributedManualClosure : await closureResolver(executionOrder))
        : options.closure
    });
  }
  const orderBinding = validateOkxCredentialBinding(db, {
    accountId: executionOrder.accountId,
    executionFingerprint: executionOrder.apiKeyFingerprint
  });
  if (String(executionOrder.exchange || "OKX").toUpperCase() === "OKX" && !orderBinding.ok) {
    return { id: executionOrder.id, status: executionOrder.status, note: orderBinding.reason };
  }
  const orderState = await (options.fetchOrderState || fetchOrderState)(executionOrder);
  if (!orderState) {
    if (["cancel_pending", "cancel_unknown_pending", "protection_failure_cancel_pending"].includes(executionOrder.status)) {
      await handleCancelPendingWatchdog(db, executionOrder, options, "order_state_unavailable");
    }
    return { id: executionOrder.id, status: executionOrder.status, note: "no_state" };
  }
  // OKX 返回的 accFillSz 是张数,统一换算回币数量(引擎全程币本位)。
  const okxOrderStateHasContracts = orderState.filledContracts !== null && orderState.filledContracts !== undefined;
  if (String(executionOrder.exchange || "OKX").toUpperCase() === "OKX" && okxOrderStateHasContracts && !(Number(executionOrder.okxCtVal) > 0)) {
    const spec = await (options.okxContractSpec || okxContractSpec)(toOkxSymbol(executionOrder.symbol, "perpetual"));
    if (spec?.ctVal > 0) {
      executionOrder.okxCtVal = Number(spec.ctVal);
      executionOrder.okxLotSz = Number(spec.lotSz) || executionOrder.okxLotSz || null;
    } else {
      executionOrder.events ||= [];
      executionOrder.events.push({ at: nowIso(), event: "entry_quantity_conversion_pending", detail: "OKX ctVal 不可用，未把张数冒充币数量" });
      db.system ||= {};
      db.system.reduceOnlyMode = true;
      db.system.reduceOnlyBy ||= "entry_reconciliation_pending";
      return { id: executionOrder.id, status: executionOrder.status, note: "contract_spec_required" };
    }
  }
  if (okxOrderStateHasContracts) {
    orderState.filledQuantity = Number(orderState.filledContracts) * Number(executionOrder.okxCtVal);
    orderState.filledCoinQuantity = orderState.filledQuantity;
  }

  if (["cancel_pending", "cancel_unknown_pending", "protection_failure_cancel_pending"].includes(executionOrder.status)
    && orderState.state === "open") {
    await handleCancelPendingWatchdog(db, executionOrder, options, "order_still_open");
  }

  if (executionOrder.protection === "requested_unconfirmed" && ["partial", "filled"].includes(orderState.state)) {
    const protection = await (options.verifyEntryProtection || fetchOkxEntryProtection)(executionOrder);
    if (!protection?.confirmed) {
      const final = orderState.state === "filled";
      applyCumulativeEntryOrderState(db, executionOrder, orderState, { final });
      executionOrder.status = final ? "entry_filled" : "entry_partial";
      executionOrder.entryFilledAt ||= nowIso();
      executionOrder.protection = "reconciliation_failed";
      executionOrder.events ||= [];
      executionOrder.events.push({ at: nowIso(), event: "entry_stop_unconfirmed", detail: protection?.reason || "attached_stop_not_found" });
      db.system ||= {};
      db.system.reduceOnlyMode = true;
      db.system.reduceOnlyBy ||= "protection_failure_reconciliation";
      db.riskIncidents ||= [];
      if (!db.riskIncidents.some((row) => row.status === "open" && row.source === executionOrder.id && row.kind === "entry_stop_unconfirmed")) {
        db.riskIncidents.unshift({ id: id("incident"), kind: "entry_stop_unconfirmed", severity: "critical", status: "open", title: `${executionOrder.symbol} 入场已成交但原生止损未获权威确认`, source: executionOrder.id, createdAt: nowIso() });
      }
      surfaceOwnerExecutionSafetyIssue(db, executionOrder);
      const intent = final ? "close_position" : "emergency_close_if_filled";
      assertActiveLease(options);
      return closeExecution(db, executionOrder.id, "entry_stop_unconfirmed", {
        intent, expectedStatus: executionOrder.status, internal: true,
        executeTradeAction: options.executeTradeAction,
        assertLease: options.assertLease,
        signal: options.signal
      });
    }
    executionOrder.protection = "attached";
    executionOrder.protectionVerifiedAt = nowIso();
    executionOrder.stopAlgoId ||= protection.algoId || null;
  }

  if (["entry_unknown_pending", "entry_pending", "entry_partial", "cancel_pending", "cancel_unknown_pending", "protection_failure_cancel_pending"].includes(executionOrder.status) && orderState.state === "partial") {
    applyCumulativeEntryOrderState(db, executionOrder, orderState, { final: false });
    const cancellationPending = ["cancel_pending", "cancel_unknown_pending", "protection_failure_cancel_pending"].includes(executionOrder.status);
    executionOrder.status = cancellationPending ? executionOrder.status : "entry_partial";
    executionOrder.events.push({ at: nowIso(), event: "entry_partial", detail: `累计成交 ${executionOrder.filledQuantity}/${executionOrder.quantity}${cancellationPending ? "（撤单确认中）" : ""}` });
    if (executionOrder.omsOrderId) {
      transitionOmsOrder(executionOrder.omsOrderId, "PARTIAL", {
        eventType: "entry_partial",
        exchangeOrderId: executionOrder.exchangeOrderId,
        response: { avgPrice: executionOrder.filledPrice, filledQuantity: executionOrder.filledQuantity }
      });
    }
  } else if (["entry_unknown_pending", "entry_pending", "entry_partial", "cancel_pending", "cancel_unknown_pending", "protection_failure_cancel_pending"].includes(executionOrder.status) && orderState.state === "filled") {
    const wasCancelPending = ["cancel_pending", "cancel_unknown_pending", "protection_failure_cancel_pending"].includes(executionOrder.status);
    const wasProtectionFailure = executionOrder.status === "protection_failure_cancel_pending";
    applyCumulativeEntryOrderState(db, executionOrder, orderState, { final: true });
    executionOrder.status = "entry_filled";
    if (executionOrder.omsOrderId) {
      transitionOmsOrder(executionOrder.omsOrderId, "FILLED", {
        eventType: "entry_filled",
        exchangeOrderId: executionOrder.exchangeOrderId,
        response: { avgPrice: orderState.avgPrice || executionOrder.entryPrice }
      });
    }
    executionOrder.entryFilledAt = nowIso();
    executionOrder.entrySlippageBps = slippageBps(executionOrder.filledPrice, executionOrder.entryPrice, executionOrder.direction);
    executionOrder.maeUsdt = 0;
    executionOrder.mfeUsdt = 0;
    executionOrder.events.push({ at: nowIso(), event: "entry_filled", detail: `均价 ${executionOrder.filledPrice}` });
    if (wasCancelPending) {
      executionOrder.events.push({ at: nowIso(), event: "cancel_fill_race", detail: "撤单请求后订单已全部成交，保留真实仓位并要求按当前状态重新确认退出。" });
    }
    if (wasProtectionFailure || ["cancel_remainder_and_close_filled", "emergency_close_if_filled"].includes(executionOrder.cancelDisposition)) {
      executionOrder.events.push({ at: nowIso(), event: "cancel_fill_requires_close", detail: "撤单竞态中订单已成交，按已持久化退出意图提交平仓并等待交易所对账。" });
      assertActiveLease(options);
      return submitClosePosition(db, executionOrder, executionOrder.cancelReason || "protection_failure_fill_race", {
        executeTradeAction: options.executeTradeAction,
        assertLease: options.assertLease,
        signal: options.signal
      });
    }
    assertActiveLease(options);
    await (options.placeTakeProfits || placeTakeProfits)(db, executionOrder, options);
    appendAudit(db, `入场成交：${executionOrder.symbol} @ ${executionOrder.filledPrice}`, executionOrder.id, "ExecutionEngine");
    appendTrace(db, "execution", `${executionOrder.symbol} 入场成交`, "ok");
  } else if (["entry_filled", "protecting", "protecting_degraded"].includes(executionOrder.status)) {
    // (P0-3)入场已终态后,交易所侧 SL/TP 成交不会反映在入场单状态上——此前系统对
    // 止损打掉完全失明:持仓残留、计划卡 executing、日亏预算不扣减。
    // 以最近的交易所持仓快照为准:快照新鲜且该 symbol 仓位已消失 → 再从 OKX
    // 历史订单读取真实 TP/SL 成交。不能拿轮询时现价把整仓推断为一次止损，否则
    // “先部分止盈、余仓止损”的盈利生命周期会被错记为整笔亏损。
    const latestSnap = executionOrder.accountId
      ? latestSuccessfulAccountSnapshot(db, { exchange: "OKX", accountId: executionOrder.accountId })
      : null;
    const snapFresh = latestSnap && (Date.now() - new Date(latestSnap.createdAt).getTime()) < Number(process.env.MAX_ACCOUNT_SNAPSHOT_AGE_MS || 600000);
    const stillOnExchange = latestSnap ? snapshotPositionOpen(latestSnap, executionOrder) : null;
    if (snapFresh && !stillOnExchange && Number(executionOrder.filledQuantity || 0) > 0) {
      const attributedManualClosure = buildAttributedManualExitClosure(db, executionOrder);
      if (attributedManualClosure.complete) {
        return reconcilePendingClose(db, executionOrder, { snapshot: latestSnap, closure: attributedManualClosure });
      }
      const attributedSystemClosure = buildAttributedSystemExitClosure(db, executionOrder);
      const protection = await (options.fetchProtectionClosure || fetchOkxProtectionClosure)(executionOrder);
      if (attributedSystemClosure.fills.length) {
        executionOrder.closeReconciliationSource = "protection_orders";
        const reconciled = reconcilePendingClose(db, executionOrder, { snapshot: latestSnap, closure: protection });
        return {
          ...reconciled,
          exchangeState: orderState.state,
          protectionSettlement: reconciled.status === "closed" ? "confirmed" : reconciled.settlement
        };
      }
      if (protection?.complete) {
        if (Number.isFinite(protection.entryFeeUsdt)) {
          const entryFills = (db.fills || []).filter((fill) => fill.executionOrderId === executionOrder.id && fill.kind === "entry");
          const totalEntryNotional = entryFills.reduce((sum, fill) => sum + Math.abs(Number(fill.notionalUsdt || Number(fill.price) * Number(fill.quantity) || 0)), 0);
          for (const fill of entryFills) {
            const fillNotional = Math.abs(Number(fill.notionalUsdt || Number(fill.price) * Number(fill.quantity) || 0));
            fill.feeUsdt = totalEntryNotional > 0 ? protection.entryFeeUsdt * fillNotional / totalEntryNotional : protection.entryFeeUsdt / Math.max(1, entryFills.length);
            fill.feeCostUsdt = fill.feeUsdt;
            fill.feeSchemaVersion = 2;
            fill.feeSource = "okx_raw_order_history";
            fill.estimatedFee = false;
          }
          executionOrder.entryFeeUsdt = protection.entryFeeUsdt;
        }
        const openedAt = new Date(executionOrder.entryFilledAt || executionOrder.createdAt).getTime();
        const closedAtMs = new Date(protection.closedAt).getTime();
        const holdingMinutes = Number.isFinite(openedAt) && Number.isFinite(closedAtMs)
          ? Math.max(0, Math.round((closedAtMs - openedAt) / 60000)) : null;
        recordFill(db, executionOrder, "close", protection.weightedPrice, protection.quantity, protection.realizedPnl, {
          feeUsdt: protection.feeUsdt,
          feeCostUsdt: protection.feeUsdt,
          feeSchemaVersion: 2,
          feeSource: "okx_raw_order_history",
          holdingMinutes,
          maeUsdt: executionOrder.maeUsdt ?? 0,
          mfeUsdt: executionOrder.mfeUsdt ?? 0,
          exitReason: "exchange_protection_filled",
          createdAt: protection.closedAt,
          exchangeOrderIds: protection.exchangeOrderIds,
          exitBreakdown: protection.breakdown,
          inferred: false,
          estimated: false,
          fundingFeeUsdt: null,
          fundingReconciled: false,
          financialBasis: "exchange_protection_fills_confirmed_funding_unreconciled"
        });
        executionOrder.status = "closed";
        executionOrder.closedAt = protection.closedAt;
        executionOrder.realizedPnl = protection.realizedPnl;
        executionOrder.closeFeeUsdt = protection.feeUsdt;
        executionOrder.exitReason = "exchange_protection_filled";
        executionOrder.events.push({ at: nowIso(), event: "exchange_protection_filled", detail: `OKX 真实保护成交 ${protection.breakdown.length} 笔，已实现 ${protection.realizedPnl.toFixed(4)} USDT，手续费 ${protection.feeUsdt.toFixed(4)} USDT` });
        db.positions = (db.positions || []).filter((p) => !(p.source === "execution_engine" && p.symbol === executionOrder.symbol));
        const plan = db.tradePlans.find((item) => item.id === executionOrder.planId);
        if (plan) plan.status = "completed";
        appendAudit(db, `保护单真实成交收口:${executionOrder.symbol} 已实现 ${protection.realizedPnl.toFixed(4)} USDT`, executionOrder.id, "ExecutionEngine");
        appendTrace(db, "execution", `${executionOrder.symbol} 保护单真实成交`, "ok");
        delete executionOrder.exchangePositionMissingAt;
      } else {
        executionOrder.exchangePositionMissingAt ||= nowIso();
      }
      if (executionOrder.status === "closed") {
        executionOrder.lastPolledAt = nowIso();
        executionOrder.updatedAt = executionOrder.lastPolledAt;
        return { id: executionOrder.id, status: executionOrder.status, exchangeState: orderState.state, protectionSettlement: "confirmed" };
      }
      executionOrder.status = "close_reconciliation_pending";
      executionOrder.closeReconciliationSource = "protection_orders";
      executionOrder.closeReconciliationReason = "exchange_position_absent_fill_evidence_incomplete";
      executionOrder.events.push({ at: nowIso(), event: "close_evidence_incomplete", detail: "交易所仓位已消失，但真实成交数量、均价或手续费尚未完整取得；未生成估算成交。" });
      db.system ||= {};
      db.system.reduceOnlyMode = true;
      db.system.reduceOnlyBy ||= "close_reconciliation_pending";
      if (!(db.riskIncidents || []).some((row) => row.status === "open" && row.source === executionOrder.id && row.kind === "close_reconciliation")) {
        db.riskIncidents ||= [];
        db.riskIncidents.unshift({ id: id("incident"), kind: "close_reconciliation", severity: "critical", status: "open", title: `${executionOrder.symbol} 平仓结果待交易所核算`, source: executionOrder.id, createdAt: nowIso() });
      }
      surfaceOwnerExecutionSafetyIssue(db, executionOrder);
      return { id: executionOrder.id, status: executionOrder.status, protectionSettlement: "evidence_incomplete" };
    }
  } else if (["entry_unknown_pending", "entry_pending", "entry_partial", "cancel_pending", "cancel_unknown_pending", "protection_failure_cancel_pending"].includes(executionOrder.status) && orderState.state === "canceled") {
    // 部分成交后剩余被撤:已有真实仓位,绝不能标"已取消"把它变成无人管的孤儿仓(审计 state-F5)。
    // 有成交量 → 当作 entry_filled 收口(按已成交量挂止盈、纳入管理);零成交才是真取消。
    applyCumulativeEntryOrderState(db, executionOrder, orderState, { final: false });
    const protectionFailure = executionOrder.status === "protection_failure_cancel_pending";
    const filled = Number(executionOrder.filledQuantity || 0);
    if (filled > 0) {
      executionOrder.quantity = filled;
      executionOrder.status = "entry_filled";
      executionOrder.events.push({ at: nowIso(), event: "entry_partial_cancel_settled", detail: `剩余被交易所取消,已成交 ${filled}，按持久化退出意图与止损证据分流` });
      const plan = db.tradePlans.find((item) => item.id === executionOrder.planId);
      if (plan) plan.status = "executing";
      if (["cancel_remainder_and_close_filled", "emergency_close_if_filled"].includes(executionOrder.cancelDisposition)) {
        assertActiveLease(options);
        return submitClosePosition(db, executionOrder, executionOrder.cancelReason || "cancelled_remainder_close_filled", {
          executeTradeAction: options.executeTradeAction,
          assertLease: options.assertLease,
          signal: options.signal
        });
      }
      // 部分成交后余量 canceled 时，原 attachAlgo 止损通常不会生成。没有权威确认的
      // 独立止损就不允许保留仓位，更不能先挂 TP；直接走稳定的真实平仓对账。
      const protection = await (options.verifyEntryProtection || fetchOkxEntryProtection)(executionOrder);
      if (!protection?.confirmed) {
        executionOrder.protection = "reconciliation_failed";
        executionOrder.events.push({ at: nowIso(), event: "partial_entry_stop_unconfirmed", detail: protection?.reason || "attached_stop_not_found" });
        assertActiveLease(options);
        return submitClosePosition(db, executionOrder, "partial_entry_without_confirmed_stop", {
          executeTradeAction: options.executeTradeAction,
          assertLease: options.assertLease,
          signal: options.signal
        });
      }
      executionOrder.protection = "attached";
      executionOrder.protectionVerifiedAt = nowIso();
      executionOrder.stopAlgoId ||= protection.algoId || null;
      try {
        assertActiveLease(options);
        await (options.placeTakeProfits || placeTakeProfits)(db, executionOrder, options);
      } catch (error) {
        if (isLeaseLostError(error)) throw error;
        executionOrder.events.push({ at: nowIso(), event: "tp_error", detail: String(error.message || error).slice(0, 150) });
      }
    } else {
      executionOrder.status = protectionFailure ? "protection_failed" : "cancelled";
      if (executionOrder.omsOrderId) {
        transitionOmsOrder(executionOrder.omsOrderId, "CANCELLED", { eventType: "entry_cancelled" });
      }
      executionOrder.events.push({ at: nowIso(), event: "entry_cancelled", detail: "交易所侧订单已取消(零成交)" });
      const plan = db.tradePlans.find((item) => item.id === executionOrder.planId);
      if (plan) plan.status = protectionFailure ? "protection_failed" : "cancelled";
      if (executionOrder.staleCancelReason) {
        appendAudit(db, `挂单已由交易所确认撤销：${executionOrder.symbol} — ${executionOrder.staleCancelReason}`, executionOrder.id, "EntryTTL", "warning");
        if (executionOrder.staleFollowUp) {
          db.system ||= {};
          db.system.pendingFastMoves ||= [];
          if (!db.system.pendingFastMoves.some((row) => row.symbol === executionOrder.symbol && row.source === "missed_entry_reeval")) {
            db.system.pendingFastMoves.push({ symbol: executionOrder.symbol, windowMin: 0, direction: executionOrder.direction === "short" ? "down" : "up", movePct: 0, source: "missed_entry_reeval", note: "挂单已确认撤销，重新评估是否追踪趋势" });
          }
        }
        try {
          assertActiveLease(options);
          const { notifyLark } = await import("./larkNotifier.mjs");
          assertActiveLease(options);
          await notifyLark(db, { severity: "warning", title: "🗑 挂单已确认撤销", body: `**${executionOrder.symbol}** 已由交易所确认 canceled：${executionOrder.staleCancelReason}` });
        } catch (error) { if (isLeaseLostError(error)) throw error; /* 通知失败不阻断 */ }
      }
    }
  }
  executionOrder.lastPolledAt = nowIso();
  executionOrder.updatedAt = executionOrder.lastPolledAt;
  return { id: executionOrder.id, status: executionOrder.status, exchangeState: orderState.state };
}

// OMS 崩溃恢复只负责把权威订单状态重新送回同一执行状态机；禁止在恢复模块里另写一套
// 撤单/平仓逻辑。测试也可用它注入交易所终态而不触网。
export async function reconcileExecutionOrderState(db, executionOrderId, orderState, options = {}) {
  const executionOrder = (db.executionOrders || []).find((row) => row.id === executionOrderId);
  if (!executionOrder) return { id: executionOrderId, status: "missing_execution_order" };
  return pollOne(db, executionOrder, {
    ...options,
    fetchOrderState: async () => ({ ...orderState })
  });
}

export function applyCumulativeEntryOrderState(db, executionOrder, orderState = {}, options = {}) {
  const filledQuantity = Math.max(0, Number(orderState.filledQuantity || 0));
  const avgPrice = Number(orderState.avgPrice || executionOrder.filledPrice || executionOrder.entryPrice);
  const previousFilled = Math.max(0, Number(executionOrder.filledQuantity || 0));
  const previousNotional = Math.max(0, Number(executionOrder.entryCumulativeNotionalUsdt || 0));
  const cumulativeNotional = Number.isFinite(avgPrice) ? filledQuantity * avgPrice : previousNotional;
  const delta = Math.max(0, filledQuantity - previousFilled);
  const deltaNotional = Math.max(0, cumulativeNotional - previousNotional);
  const deltaPrice = delta > 0 && deltaNotional > 0 ? deltaNotional / delta : avgPrice;
  if (delta > 0 && Number.isFinite(deltaPrice) && deltaPrice > 0) {
    recordFill(db, executionOrder, "entry", deltaPrice, delta, null, {
      partial: options.final !== true,
      feeUsdt: feeEstimate(deltaNotional),
      estimatedFee: true,
      feeBasis: "estimated_from_cumulative_notional_delta"
    });
  }
  executionOrder.filledQuantity = filledQuantity;
  executionOrder.filledPrice = filledQuantity > 0 && Number.isFinite(avgPrice) ? avgPrice : executionOrder.filledPrice;
  executionOrder.entryCumulativeNotionalUsdt = cumulativeNotional;
  executionOrder.entryFeeUsdt = (db.fills || []).filter((fill) => fill.executionOrderId === executionOrder.id && fill.kind === "entry")
    .reduce((sum, fill) => sum + Number(fill.feeCostUsdt ?? fill.feeUsdt ?? 0), 0);
  if (filledQuantity > 0) upsertPosition(db, executionOrder, filledQuantity);
  return { filledQuantity, avgPrice, delta, deltaPrice, deltaNotional, cumulativeNotional };
}

async function fetchOrderState(executionOrder) {
  const exchange = String(executionOrder.exchange || "OKX").toUpperCase();
  if (exchange !== "OKX" || !process.env.OKX_API_KEY) return null;
  const instId = toOkxSymbol(executionOrder.symbol, "perpetual");
  const raw = await okxSignedRequest(`/api/v5/trade/order?instId=${instId}&clOrdId=${executionOrder.clientOrderId}`, "GET");
  const order = raw.data?.[0];
  if (!order) return null;
  const stateMap = { live: "open", partially_filled: "partial", filled: "filled", canceled: "canceled", mmp_canceled: "canceled" };
  return {
    state: stateMap[order.state] || order.state,
    rawExchangeState: order.state || null,
    cancelSource: order.state === "mmp_canceled" ? "market_maker_protection" : null,
    avgPrice: Number(order.avgPx) || null,
    filledContracts: Number(order.accFillSz || 0)
  };
}

async function fetchOkxEntryProtection(executionOrder) {
  if (!executionOrder.stopClientOrderId || !process.env.OKX_API_KEY) return { confirmed: false, reason: "stop_identity_or_credentials_unavailable" };
  try {
    const instId = toOkxSymbol(executionOrder.symbol, "perpetual");
    const page = await fetchOkxPendingPages("/api/v5/trade/orders-algo-pending", { idField: "algoId", query: { ordType: "conditional", instId } });
    if (!page.complete) return { confirmed: false, reason: "algo_query_incomplete" };
    const expected = cleanClOrdId(executionOrder.stopClientOrderId);
    const match = (page.rows || []).find((row) => cleanClOrdId(row.algoClOrdId || row.attachAlgoClOrdId || "") === expected
      && Number(row.slTriggerPx || row.triggerPx || 0) > 0);
    return match ? { confirmed: true, algoId: match.algoId || null, stopClientOrderId: expected }
      : { confirmed: false, reason: "attached_stop_not_found" };
  } catch (error) {
    return { confirmed: false, reason: "algo_query_failed", error: String(error.message || error).slice(0, 160) };
  }
}

export function summarizeOkxProtectionClosure(executionOrder, orders = []) {
  const expectedIds = protectionClientIds(executionOrder);
  if (!expectedIds.size) return null;
  const instId = toOkxSymbol(executionOrder.symbol, "perpetual");
  const ctVal = Number(executionOrder.okxCtVal);
  if (!(ctVal > 0)) return null;
  const entryAt = new Date(executionOrder.entryFilledAt || executionOrder.createdAt || 0).getTime();
  const entryClientOrderId = cleanClOrdId(executionOrder.clientOrderId || "");
  const entryOrder = entryClientOrderId ? (orders || []).find((order) => String(order.instId || "") === instId
    && ["filled", "canceled"].includes(String(order.state || ""))
    && cleanClOrdId(order.clOrdId || "") === entryClientOrderId) : null;
  const seen = new Set();
  const matched = [];
  for (const order of orders || []) {
    const algoId = cleanClOrdId(order.algoClOrdId || "");
    const orderAt = Number(order.uTime || order.fillTime || order.cTime || 0);
    if (String(order.instId || "") !== instId || String(order.state || "") !== "filled" || !expectedIds.has(algoId)) continue;
    if (Number.isFinite(entryAt) && entryAt > 0 && orderAt > 0 && orderAt + 60_000 < entryAt) continue;
    const uniqueId = String(order.ordId || `${algoId}:${orderAt}`);
    if (seen.has(uniqueId)) continue;
    seen.add(uniqueId);
    const contracts = Number(order.accFillSz || order.fillSz || 0);
    const price = Number(order.avgPx || order.fillPx || 0);
    const realizedPnl = finiteFinancialNumber(order.pnl) ? Number(order.pnl) : null;
    const feeCostUsdt = okxFeeCost(order.fee);
    const closedAt = orderAt > 0 && Number.isFinite(new Date(orderAt).getTime()) ? new Date(orderAt).toISOString() : null;
    if (!(contracts > 0) || !(price > 0) || realizedPnl === null || feeCostUsdt === null || !closedAt) {
      return { complete: false, reason: "protection_fill_financial_evidence_incomplete", expectedQuantity: Number(executionOrder.filledQuantity || executionOrder.quantity || 0) };
    }
    matched.push({
      exchangeOrderId: order.ordId || null,
      clientOrderId: algoId,
      quantity: contracts * ctVal,
      price,
      realizedPnl,
      feeUsdt: feeCostUsdt,
      feeCostUsdt,
      rawFee: Number(order.fee),
      rawFeeCcy: order.feeCcy || null,
      feeSource: "okx_raw_order_history",
      feeSchemaVersion: 2,
      closedAt,
    });
  }
  if (!matched.length) return null;
  const quantity = matched.reduce((sum, item) => sum + item.quantity, 0);
  const recordedExpectedQuantity = Number(executionOrder.filledQuantity || executionOrder.quantity || 0);
  const entryContracts = Number(entryOrder?.accFillSz || entryOrder?.fillSz || 0);
  const entryQuantity = entryContracts > 0 ? entryContracts * ctVal : null;
  const expectedQuantity = entryQuantity || recordedExpectedQuantity;
  const tolerance = Math.max(1e-10, expectedQuantity * 0.005, ctVal * 0.0001);
  const entryFeeUsdt = entryOrder ? okxFeeCost(entryOrder.fee) : null;
  const complete = expectedQuantity > 0 && quantity + tolerance >= expectedQuantity && quantity <= expectedQuantity + tolerance
    && entryFeeUsdt !== null;
  const notional = matched.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return {
    complete,
    quantity,
    expectedQuantity,
    recordedExpectedQuantity,
    entryQuantity,
    weightedPrice: quantity > 0 ? notional / quantity : null,
    realizedPnl: matched.reduce((sum, item) => sum + item.realizedPnl, 0),
    feeUsdt: matched.reduce((sum, item) => sum + item.feeUsdt, 0),
    entryFeeUsdt,
    closedAt: matched.slice().sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt))[0].closedAt,
    exchangeOrderIds: matched.map((item) => item.exchangeOrderId).filter(Boolean),
    breakdown: matched
  };
}

export function summarizeOkxProtectionClosureFromAlgoFills(executionOrder, algoRows = [], fills = []) {
  const uniqueFills = dedupeOkxFills(fills);
  const expectedClientIds = protectionClientIds(executionOrder);
  const expectedAlgoIds = new Set([
    executionOrder.stopAlgoId,
    ...(executionOrder.tpAlgoIds || [])
  ].map(String).filter(Boolean));
  if (!expectedClientIds.size && !expectedAlgoIds.size) return null;
  const instId = toOkxSymbol(executionOrder.symbol, "perpetual");
  const ctVal = Number(executionOrder.okxCtVal);
  if (!(ctVal > 0)) return null;
  const entryAt = new Date(executionOrder.entryFilledAt || executionOrder.createdAt || 0).getTime();
  const triggered = (algoRows || []).filter((row) => {
    if (String(row.instId || "") !== instId) return false;
    const clientId = cleanClOrdId(row.algoClOrdId || row.attachAlgoClOrdId || "");
    return expectedClientIds.has(clientId) || expectedAlgoIds.has(String(row.algoId || ""));
  });
  const triggeredOrderIds = new Set(triggered.flatMap(extractOkxAlgoChildOrderIds));
  if (!triggeredOrderIds.size) return null;

  const closingSide = executionOrder.direction === "short" ? "buy" : "sell";
  const seenTrades = new Set();
  const matched = [];
  for (const row of uniqueFills) {
    const at = Number(row.ts || row.fillTime || row.cTime || 0);
    if (!triggeredOrderIds.has(String(row.ordId || "")) || String(row.instId || "") !== instId || String(row.side || "").toLowerCase() !== closingSide) continue;
    if (Number.isFinite(entryAt) && entryAt > 0 && at > 0 && at + 60_000 < entryAt) continue;
    const tradeId = String(row.tradeId || `${row.ordId || ""}:${at}:${row.fillPx}:${row.fillSz}`);
    if (seenTrades.has(tradeId)) continue;
    seenTrades.add(tradeId);
    const contracts = Number(row.fillSz || row.sz || 0);
    const price = Number(row.fillPx || row.avgPx || 0);
    const realizedPnl = finiteFinancialNumber(row.fillPnl ?? row.pnl) ? Number(row.fillPnl ?? row.pnl) : null;
    const feeUsdt = okxFeeCost(row.fee);
    const closedAt = at > 0 && Number.isFinite(new Date(at).getTime()) ? new Date(at).toISOString() : null;
    if (!(contracts > 0) || !(price > 0) || realizedPnl === null || feeUsdt === null || !closedAt) {
      return { complete: false, reason: "protection_fill_financial_evidence_incomplete", expectedQuantity: Number(executionOrder.filledQuantity || executionOrder.quantity || 0) };
    }
    const algo = triggered.find((candidate) => extractOkxAlgoChildOrderIds(candidate).includes(String(row.ordId || "")));
    matched.push({
      algoId: algo?.algoId || null,
      algoClientOrderId: cleanClOrdId(algo?.algoClOrdId || algo?.attachAlgoClOrdId || "") || null,
      tradeId,
      exchangeOrderId: row.ordId || null,
      quantity: contracts * ctVal,
      price,
      realizedPnl,
      feeUsdt,
      feeCostUsdt: feeUsdt,
      rawFee: Number(row.fee),
      rawFeeCcy: row.feeCcy || null,
      feeSource: "okx_algo_history_to_raw_fill_history",
      feeSchemaVersion: 2,
      closedAt
    });
  }
  if (!matched.length) {
    return { complete: false, reason: "protection_child_fills_missing", expectedChildOrderIds: [...triggeredOrderIds], matchedChildOrderIds: [] };
  }
  const entryClientOrderId = cleanClOrdId(executionOrder.clientOrderId || "");
  const entryRows = uniqueFills.filter((row) => String(row.instId || "") === instId
    && ((entryClientOrderId && cleanClOrdId(row.clOrdId || "") === entryClientOrderId)
      || (executionOrder.exchangeOrderId && String(row.ordId || "") === String(executionOrder.exchangeOrderId))));
  const entryFees = entryRows.map((row) => okxFeeCost(row.fee));
  const entryFeeUsdt = entryRows.length && entryFees.every((value) => value !== null)
    ? entryFees.reduce((sum, value) => sum + value, 0) : null;
  const entryContracts = entryRows.reduce((sum, row) => sum + Number(row.fillSz || row.sz || 0), 0);
  const entryQuantity = entryRows.length && entryContracts > 0 ? entryContracts * ctVal : null;
  const quantity = matched.reduce((sum, row) => sum + row.quantity, 0);
  const matchedChildOrderIds = new Set(matched.map((row) => String(row.exchangeOrderId || "")).filter(Boolean));
  const unmatchedChildOrderIds = [...triggeredOrderIds].filter((orderId) => !matchedChildOrderIds.has(orderId));
  const recordedExpectedQuantity = Number(executionOrder.filledQuantity || executionOrder.quantity || 0);
  const expectedQuantity = entryQuantity || recordedExpectedQuantity;
  const tolerance = Math.max(1e-10, expectedQuantity * 0.005, ctVal * 0.0001);
  const complete = unmatchedChildOrderIds.length === 0
    && expectedQuantity > 0 && quantity + tolerance >= expectedQuantity && quantity <= expectedQuantity + tolerance && entryFeeUsdt !== null;
  const notional = matched.reduce((sum, row) => sum + row.price * row.quantity, 0);
  return {
    complete,
    evidencePath: "orders-algo-history->ordId->fills-history:tradeId",
    quantity,
    expectedQuantity,
    recordedExpectedQuantity,
    entryQuantity,
    weightedPrice: quantity > 0 ? notional / quantity : null,
    realizedPnl: matched.reduce((sum, row) => sum + row.realizedPnl, 0),
    feeUsdt: matched.reduce((sum, row) => sum + row.feeUsdt, 0),
    entryFeeUsdt,
    closedAt: matched.slice().sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt))[0].closedAt,
    algoIds: [...new Set(matched.map((row) => row.algoId).filter(Boolean))],
    exchangeOrderIds: [...new Set(matched.map((row) => row.exchangeOrderId).filter(Boolean))],
    tradeIds: [...new Set(matched.map((row) => row.tradeId).filter(Boolean))],
    expectedChildOrderIds: [...triggeredOrderIds],
    unmatchedChildOrderIds,
    breakdown: matched
  };
}

export function extractOkxAlgoChildOrderIds(row = {}) {
  const ids = new Set();
  const add = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) add(item);
      return;
    }
    if (value && typeof value === "object") {
      add(value.ordId ?? value.orderId ?? value.id);
      return;
    }
    const raw = String(value || "").trim();
    if (raw.startsWith("[") && raw.endsWith("]")) {
      try { add(JSON.parse(raw)); return; } catch { /* fall through to CSV compatibility */ }
    }
    for (const item of raw.split(",")) {
      const normalized = item.trim();
      if (normalized) ids.add(normalized);
    }
  };
  add(row.ordId);
  add(row.orderId);
  add(row.ordIdList);
  add(row.ordIds);
  return [...ids];
}

export async function fetchOkxProtectionClosure(executionOrder, options = {}) {
  if (String(executionOrder.exchange || "OKX").toUpperCase() !== "OKX" || !process.env.OKX_API_KEY) return null;
  try {
    const signedRequest = options.signedRequest || okxSignedRequest;
    const instId = toOkxSymbol(executionOrder.symbol, "perpetual");
    const begin = new Date(executionOrder.entryAttemptedAt || executionOrder.createdAt || 0).getTime();
    const algoRows = [];
    const seenAlgoRows = new Set();
    for (const state of ["effective", "canceled", "order_failed"]) {
      let after = null;
      let exhausted = false;
      const seenCursors = new Set();
      for (let page = 0; page < 20; page += 1) {
        const query = new URLSearchParams({ ordType: "conditional", state, instId, limit: "100" });
        if (after) query.set("after", after);
        const raw = await signedRequest(`/api/v5/trade/orders-algo-history?${query.toString()}`, "GET");
        if (String(raw?.code ?? "") !== "0") return null;
        const pageRows = Array.isArray(raw.data) ? raw.data : [];
        for (const row of pageRows) {
          const rowKey = `${row.algoId || ""}:${row.state || state}:${extractOkxAlgoChildOrderIds(row).join(",")}:${row.cTime || ""}`;
          if (seenAlgoRows.has(rowKey)) continue;
          seenAlgoRows.add(rowKey);
          const createdAt = Number(row.cTime || 0);
          if (!Number.isFinite(begin) || begin <= 0 || (Number.isFinite(createdAt) && createdAt >= begin)) algoRows.push(row);
        }
        if (pageRows.length < 100) { exhausted = true; break; }
        const lastId = pageRows.at(-1)?.algoId;
        if (!lastId || seenCursors.has(String(lastId))) return null;
        seenCursors.add(String(lastId));
        after = lastId;
        const pageTimes = pageRows.map((row) => Number(row.cTime || 0)).filter((value) => Number.isFinite(value) && value > 0);
        if (Number.isFinite(begin) && begin > 0 && pageTimes.length && Math.max(...pageTimes) < begin) { exhausted = true; break; }
      }
      if (!exhausted) return null;
    }
    const fills = [];
    let after = null;
    let exhausted = false;
    for (let page = 0; page < 20; page += 1) {
      const query = new URLSearchParams({ instType: "SWAP", instId, limit: "100" });
      if (Number.isFinite(begin) && begin > 0) query.set("begin", String(begin));
      if (after) query.set("after", after);
      const raw = await signedRequest(`/api/v5/trade/fills-history?${query.toString()}`, "GET");
      if (String(raw?.code ?? "") !== "0") return null;
      const pageRows = Array.isArray(raw.data) ? raw.data : [];
      fills.push(...pageRows);
      if (pageRows.length < 100) { exhausted = true; break; }
      const lastId = pageRows.at(-1)?.tradeId;
      if (!lastId || lastId === after) return null;
      after = lastId;
    }
    if (!exhausted) return null;
    return summarizeOkxProtectionClosureFromAlgoFills(executionOrder, algoRows, fills);
  } catch {
    return null;
  }
}

export function summarizeOkxManualClosure(executionOrder, fills = []) {
  const uniqueFills = dedupeOkxFills(fills);
  const instId = toOkxSymbol(executionOrder.symbol, "perpetual");
  const closeClientOrderId = cleanClOrdId(executionOrder.closeClientOrderId || "");
  if (!closeClientOrderId) return null;
  const submittedAt = new Date(executionOrder.closeSubmittedAt || 0).getTime();
  const ctVal = Number(executionOrder.okxCtVal);
  if (!(ctVal > 0)) return null;
  const expectedQuantity = Number(executionOrder.filledQuantity || executionOrder.quantity || 0);
  const closingSide = executionOrder.direction === "short" ? "buy" : "sell";
  const seen = new Set();
  const matched = [];
  const entryClientOrderId = cleanClOrdId(executionOrder.clientOrderId || "");
  const entryRows = uniqueFills.filter((row) => String(row.instId || "") === instId
    && ((entryClientOrderId && cleanClOrdId(row.clOrdId || "") === entryClientOrderId)
      || (executionOrder.exchangeOrderId && String(row.ordId || "") === String(executionOrder.exchangeOrderId))));
  for (const row of uniqueFills) {
    const at = Number(row.ts || row.fillTime || row.cTime || 0);
    const identityMatches = cleanClOrdId(row.clOrdId || "") === closeClientOrderId
      || (executionOrder.closeExchangeOrderId && String(row.ordId || "") === String(executionOrder.closeExchangeOrderId));
    if (!identityMatches || String(row.instId || "") !== instId || String(row.side || "").toLowerCase() !== closingSide) continue;
    if (Number.isFinite(submittedAt) && submittedAt > 0 && at > 0 && at + 1_000 < submittedAt) continue;
    const unique = String(row.tradeId || `${row.ordId || ""}:${at}:${row.fillPx}:${row.fillSz}`);
    if (seen.has(unique)) continue;
    seen.add(unique);
    const contracts = Number(row.fillSz || row.sz || 0);
    const price = Number(row.fillPx || row.avgPx || 0);
    if (!(contracts > 0) || !(price > 0) || !(ctVal > 0)) continue;
    const realizedRaw = row.fillPnl ?? row.pnl;
    const feeRaw = row.fee;
    const realizedPnl = realizedRaw === null || realizedRaw === undefined || realizedRaw === "" ? null : Number(realizedRaw);
    const feeUsdt = okxFeeCost(feeRaw);
    matched.push({
      tradeId: row.tradeId || null,
      exchangeOrderId: row.ordId || null,
      quantity: contracts * ctVal,
      price,
      realizedPnl: Number.isFinite(realizedPnl) ? realizedPnl : null,
      feeUsdt: Number.isFinite(feeUsdt) ? feeUsdt : null,
      feeCostUsdt: Number.isFinite(feeUsdt) ? feeUsdt : null,
      rawFee: finiteFinancialNumber(feeRaw) ? Number(feeRaw) : null,
      rawFeeCcy: row.feeCcy || null,
      feeSource: "okx_raw_fill_history",
      feeSchemaVersion: 2,
      closedAt: at > 0 ? new Date(at).toISOString() : null
    });
  }
  if (!matched.length || matched.some((row) => !Number.isFinite(row.realizedPnl) || !Number.isFinite(row.feeUsdt) || !row.closedAt)) return null;
  const quantity = matched.reduce((sum, row) => sum + row.quantity, 0);
  const entryContracts = entryRows.reduce((sum, row) => sum + Number(row.fillSz || row.sz || 0), 0);
  const entryQuantity = entryRows.length && entryContracts > 0 ? entryContracts * ctVal : null;
  const recordedExpectedQuantity = expectedQuantity;
  const authoritativeExpectedQuantity = entryQuantity || recordedExpectedQuantity;
  const tolerance = Math.max(1e-10, authoritativeExpectedQuantity * 0.005, ctVal * 0.0001);
  const complete = authoritativeExpectedQuantity > 0 && quantity + tolerance >= authoritativeExpectedQuantity && quantity <= authoritativeExpectedQuantity + tolerance;
  const notional = matched.reduce((sum, row) => sum + row.price * row.quantity, 0);
  const entryFeeValues = entryRows.map((row) => okxFeeCost(row.fee));
  const entryFeeUsdt = entryRows.length && entryFeeValues.every((value) => value !== null)
    ? entryFeeValues.reduce((sum, value) => sum + value, 0) : null;
  return {
    complete,
    quantity,
    expectedQuantity: authoritativeExpectedQuantity,
    recordedExpectedQuantity,
    entryQuantity,
    weightedPrice: quantity > 0 ? notional / quantity : null,
    realizedPnl: matched.reduce((sum, row) => sum + row.realizedPnl, 0),
    feeUsdt: matched.reduce((sum, row) => sum + row.feeUsdt, 0),
    entryFeeUsdt,
    closedAt: matched.slice().sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt))[0].closedAt,
    exchangeOrderIds: [...new Set(matched.map((row) => row.exchangeOrderId).filter(Boolean))],
    breakdown: matched
  };
}

async function fetchOkxManualClosure(executionOrder) {
  if (String(executionOrder.exchange || "OKX").toUpperCase() !== "OKX" || !process.env.OKX_API_KEY) return null;
  try {
    const instId = toOkxSymbol(executionOrder.symbol, "perpetual");
    const begin = new Date(executionOrder.entryAttemptedAt || executionOrder.createdAt || 0).getTime();
    const rows = [];
    let after = null;
    let exhausted = false;
    for (let page = 0; page < 20; page += 1) {
      const query = new URLSearchParams({ instType: "SWAP", instId, limit: "100" });
      if (Number.isFinite(begin) && begin > 0) query.set("begin", String(begin));
      if (after) query.set("after", after);
      const raw = await okxSignedRequest(`/api/v5/trade/fills-history?${query.toString()}`, "GET");
      if (String(raw?.code ?? "") !== "0") return null;
      const pageRows = Array.isArray(raw.data) ? raw.data : [];
      rows.push(...pageRows);
      if (pageRows.length < 100) { exhausted = true; break; }
      const lastId = pageRows.at(-1)?.tradeId;
      if (!lastId || lastId === after) return null;
      after = lastId;
    }
    if (!exhausted) return null;
    return summarizeOkxManualClosure(executionOrder, rows);
  } catch {
    return null;
  }
}

function finiteFinancialValue(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

export function summarizeOkxFundingBills(executionOrder, rows = [], window = {}) {
  const startAt = Number(window.startAt);
  const endAt = Number(window.endAt);
  const instId = toOkxSymbol(executionOrder.symbol, "perpetual").toUpperCase();
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt < startAt) return { complete: false, reason: "invalid_holding_window" };
  const seen = new Set();
  const matched = [];
  for (const row of rows || []) {
    const rowInstId = String(row.instId || "").toUpperCase();
    const at = Number(row.ts || row.createdAt || 0);
    const isFunding = String(row.type || "") === "8" || ["173", "174"].includes(String(row.subType || ""));
    if (!isFunding || rowInstId !== instId || !Number.isFinite(at) || at < startAt || at > endAt) continue;
    const billId = String(row.billId || `${rowInstId}:${at}:${row.subType || row.type || "funding"}`);
    if (seen.has(billId)) continue;
    seen.add(billId);
    if (!finiteFinancialValue(row.pnl)) return { complete: false, reason: "funding_bill_amount_unavailable", billId };
    matched.push({ billId, at, pnl: Number(row.pnl), subType: row.subType || null });
  }
  return {
    complete: true,
    fundingFeeUsdt: Number(matched.reduce((sum, row) => sum + row.pnl, 0).toFixed(8)),
    billIds: matched.map((row) => row.billId),
    rows: matched
  };
}

function incompleteLocalClosureMatchesRemote(local, remote, executionOrder) {
  if (!local?.fills?.length || !remote?.complete || !closureBindingMatches(remote, executionOrder)) return false;
  const localTradeIds = [...new Set(local.fills.map((fill) => String(fill.exchangeTradeId || fill.tradeId || "").trim()).filter(Boolean))].sort();
  const remoteTradeIds = closureIdentityValues(remote, "tradeIds", "tradeId");
  if (!localTradeIds.length || localTradeIds.length !== local.fills.length
    || localTradeIds.length !== remoteTradeIds.length
    || localTradeIds.some((value, index) => value !== remoteTradeIds[index])) return false;
  const localOrderIds = [...new Set(local.fills.map((fill) => String(fill.exchangeOrderId || "").trim()).filter(Boolean))].sort();
  const remoteOrderIds = closureIdentityValues(remote, "exchangeOrderIds", "exchangeOrderId");
  if (localOrderIds.length && (localOrderIds.length !== remoteOrderIds.length
    || localOrderIds.some((value, index) => value !== remoteOrderIds[index]))) return false;

  const remoteByTradeId = new Map((remote.breakdown || [])
    .map((row) => [String(row?.tradeId || "").trim(), row]).filter(([tradeId]) => tradeId));
  for (const fill of local.fills) {
    const remoteRow = remoteByTradeId.get(String(fill.exchangeTradeId || fill.tradeId || "").trim());
    if (!remoteRow) return false;
    for (const [localField, remoteField] of [
      [fill.quantity ?? fill.size, remoteRow.quantity],
      [fill.price, remoteRow.price],
      [fill.realizedPnl, remoteRow.realizedPnl],
      [fill.feeCostUsdt ?? fill.feeUsdt, remoteRow.feeUsdt]
    ]) {
      if (finiteFinancialValue(localField) && !sameClosureNumber(localField, remoteField)) return false;
    }
    if (finiteFinancialValue(fill.rawFee) && finiteFinancialValue(remoteRow.rawFee)
      && !sameClosureNumber(fill.rawFee, remoteRow.rawFee)) return false;
    const localFeeCurrency = String(fill.feeCurrency || fill.rawFeeCcy || "").toUpperCase();
    const remoteFeeCurrency = String(remoteRow.feeCurrency || remoteRow.rawFeeCcy || "").toUpperCase();
    if (localFeeCurrency && remoteFeeCurrency && localFeeCurrency !== remoteFeeCurrency) return false;
    if (fill.exchangeOrderId && remoteRow.exchangeOrderId
      && String(fill.exchangeOrderId) !== String(remoteRow.exchangeOrderId)) return false;
    const localClosedAt = fill.exchangeFilledAt || fill.createdAt;
    if (localClosedAt && !sameClosureTime(localClosedAt, remoteRow.closedAt)) return false;
  }
  return true;
}

function isAuthoritativeRawFinancialFill(fill) {
  return fill?.estimatedFee !== true && fill?.estimated !== true && fill?.inferred !== true;
}

function prepareEntryFeeBackfill(entryFills, totalFee) {
  if (!finiteFinancialValue(totalFee)) return { ok: true, available: false };
  const authoritativeFills = entryFills.filter((fill) => finiteFinancialValue(fill.feeCostUsdt ?? fill.feeUsdt)
    && isAuthoritativeRawFinancialFill(fill));
  const mutableFills = entryFills.filter((fill) => !authoritativeFills.includes(fill));
  const authoritativeFee = authoritativeFills
    .reduce((sum, fill) => sum + Number(fill.feeCostUsdt ?? fill.feeUsdt), 0);
  const mutableFee = Number(totalFee) - authoritativeFee;
  const tolerance = Math.max(1, Math.abs(Number(totalFee)), Math.abs(authoritativeFee)) * 1e-10;
  if (mutableFee < -tolerance || (!mutableFills.length && Math.abs(mutableFee) > tolerance)) {
    return { ok: false, available: true, authoritativeFills, mutableFills, authoritativeFee, mutableFee };
  }
  return { ok: true, available: true, authoritativeFills, mutableFills, authoritativeFee, mutableFee };
}

async function fetchOkxFundingBills(executionOrder, window = {}) {
  if (String(executionOrder.exchange || "OKX").toUpperCase() !== "OKX" || !process.env.OKX_API_KEY) {
    return { complete: false, reason: "okx_read_credentials_unavailable" };
  }
  try {
    const instId = toOkxSymbol(executionOrder.symbol, "perpetual");
    const collected = [];
    let after = null;
    let exhausted = false;
    for (let page = 0; page < 20; page += 1) {
      const query = new URLSearchParams({ instType: "SWAP", instId, type: "8", begin: String(window.startAt), end: String(window.endAt), limit: "100" });
      if (after) query.set("after", after);
      const raw = await okxSignedRequest(`/api/v5/account/bills-archive?${query.toString()}`, "GET");
      if (String(raw?.code ?? "") !== "0") return { complete: false, reason: "okx_bills_rejected", code: raw?.code || null };
      const pageRows = Array.isArray(raw.data) ? raw.data : [];
      collected.push(...pageRows);
      if (pageRows.length < 100) {
        exhausted = true;
        break;
      }
      const lastId = pageRows.at(-1)?.billId;
      if (!lastId || lastId === after) return { complete: false, reason: "okx_bills_pagination_unstable" };
      after = lastId;
    }
    if (!exhausted) return { complete: false, reason: "okx_bills_pagination_incomplete" };
    return summarizeOkxFundingBills(executionOrder, collected, window);
  } catch (error) {
    return { complete: false, reason: "okx_bills_query_failed", error: String(error.message || error).slice(0, 180) };
  }
}

export function applyOkxLifecycleFinancialEvidence(db, executionOrder, closure = {}) {
  if (!executionOrder || closure.complete !== true || !finiteFinancialValue(closure.entryFeeUsdt)
    || !finiteFinancialValue(closure.feeUsdt) || !finiteFinancialValue(closure.realizedPnl)) {
    return { applied: false, reason: "authoritative_fee_evidence_incomplete" };
  }
  const entryFills = (db.fills || []).filter((fill) => fill.kind === "entry" && fill.executionOrderId === executionOrder.id);
  const closeFills = (db.fills || []).filter((fill) => fill.kind === "close" && fill.executionOrderId === executionOrder.id);
  if (!entryFills.length || !closeFills.length) return { applied: false, reason: "lifecycle_fill_rows_missing" };
  if (!closureBindingMatches(closure, executionOrder)) return { applied: false, reason: "fill_evidence_conflict" };
  for (const fill of closeFills.filter(isAuthoritativeRawFinancialFill)) {
    const attribution = classifyTradeFill(db, fill);
    if (attribution.scope !== "system" || String(attribution.executionOrderId || "") !== String(executionOrder.id || "")) {
      return { applied: false, reason: "fill_evidence_conflict" };
    }
  }
  const attributedManualClosure = buildAttributedManualExitClosure(db, executionOrder);
  const attributedSystemClosure = buildAttributedSystemExitClosure(db, executionOrder);
  const attributedClosures = [attributedManualClosure, attributedSystemClosure];
  const authoritativeLocalClosure = attributedClosures.find((candidate) => candidate.complete
    && candidate.fills?.length && candidate.fills.every(isAuthoritativeRawFinancialFill)) || null;
  const attributedLocalClosure = attributedClosures
    .map((candidate) => ({
      ...candidate,
      fills: (candidate.fills || []).filter(isAuthoritativeRawFinancialFill)
    }))
    .find((candidate) => candidate.fills.length) || null;
  if (authoritativeLocalClosure && !closureEvidenceMatches(authoritativeLocalClosure, closure, executionOrder)) {
    return { applied: false, reason: "fill_evidence_conflict" };
  }
  if (attributedLocalClosure && !authoritativeLocalClosure
    && !incompleteLocalClosureMatchesRemote(attributedLocalClosure, closure, executionOrder)) {
    return { applied: false, reason: "fill_evidence_conflict" };
  }
  const recordedExpectedQuantity = Number(executionOrder.filledQuantity || executionOrder.quantity || 0);
  const expectedQuantity = Number(closure.entryQuantity || closure.expectedQuantity || recordedExpectedQuantity);
  const authorityQuantity = Number(closure.quantity || 0);
  const tolerance = Math.max(1e-10, expectedQuantity * 0.005, Number(executionOrder.okxCtVal || 0) * 0.0001);
  if (!(expectedQuantity > 0) || Math.abs(authorityQuantity - expectedQuantity) > tolerance) {
    return { applied: false, reason: "authoritative_close_quantity_mismatch", expectedQuantity, authorityQuantity, recordedExpectedQuantity };
  }
  const entryFeeBackfill = prepareEntryFeeBackfill(entryFills, closure.entryFeeUsdt);
  if (!entryFeeBackfill.ok) return { applied: false, reason: "fill_evidence_conflict" };
  if (attributedLocalClosure && !authoritativeLocalClosure) {
    return { applied: false, reason: "authoritative_close_evidence_incomplete" };
  }

  const entryNotional = entryFills.reduce((sum, fill) => sum + Math.abs(Number(fill.notionalUsdt || Number(fill.price) * Number(fill.quantity) || 0)), 0);
  const entryQuantityBefore = entryFills.reduce((sum, fill) => sum + Math.abs(Number(fill.quantity || 0)), 0);
  const mutableEntryFills = entryFeeBackfill.mutableFills;
  const mutableEntryNotional = mutableEntryFills
    .reduce((sum, fill) => sum + Math.abs(Number(fill.notionalUsdt || Number(fill.price) * Number(fill.quantity) || 0)), 0);
  const mutableEntryFee = entryFeeBackfill.mutableFee;
  for (const fill of entryFills) {
    const notional = Math.abs(Number(fill.notionalUsdt || Number(fill.price) * Number(fill.quantity) || 0));
    const weight = entryNotional > 0 ? notional / entryNotional : 1 / entryFills.length;
    if (!mutableEntryFills.includes(fill)) continue;
    if (!authoritativeLocalClosure) {
      fill.quantity = expectedQuantity * weight;
      fill.notionalUsdt = Math.abs(Number(fill.price || 0) * fill.quantity);
    }
    const feeWeight = mutableEntryNotional > 0 ? notional / mutableEntryNotional : 1 / mutableEntryFills.length;
    fill.feeUsdt = mutableEntryFee * feeWeight;
    fill.feeCostUsdt = fill.feeUsdt;
    fill.feeSchemaVersion = 2;
    fill.feeSource = "okx_raw_fill_history_backfill";
    fill.feeBasis = "okx_entry_order_identity";
    fill.estimatedFee = false;
  }

  const closeQuantity = closeFills.reduce((sum, fill) => sum + Math.abs(Number(fill.quantity || 0)), 0);
  const finalFill = closeFills.find((fill) => fill.partial !== true) || closeFills.at(-1);
  for (const fill of closeFills) {
    if (authoritativeLocalClosure?.fills.includes(fill)) continue;
    const weight = closeQuantity > 0 ? Math.abs(Number(fill.quantity || 0)) / closeQuantity : 1 / closeFills.length;
    fill.quantity = authorityQuantity * weight;
    fill.notionalUsdt = Math.abs(Number(fill.price || 0) * fill.quantity);
    fill.feeUsdt = Number(closure.feeUsdt) * weight;
    fill.feeCostUsdt = fill.feeUsdt;
    fill.realizedPnl = Number(closure.realizedPnl) * weight;
    fill.feeSchemaVersion = 2;
    fill.feeSource = "okx_raw_fill_history_backfill";
    fill.estimatedFee = false;
    fill.estimated = false;
    fill.inferred = false;
    fill.financialBasis = "exchange_fills_confirmed_funding_unreconciled";
    if (fill === finalFill) {
      fill.price = Number(closure.weightedPrice || fill.price);
      fill.notionalUsdt = Math.abs(Number(fill.price || 0) * Number(fill.quantity || 0));
      fill.createdAt = closure.closedAt || fill.createdAt;
      fill.exchangeOrderIds = closure.exchangeOrderIds || [];
      fill.exchangeTradeIds = closure.tradeIds || [];
      fill.exchangeAlgoIds = closure.algoIds || [];
      fill.closureEvidencePath = closure.evidencePath || "fills-history";
      fill.exitBreakdown = closure.breakdown || [];
    }
  }
  executionOrder.entryFeeUsdt = Number(closure.entryFeeUsdt);
  executionOrder.filledQuantity = expectedQuantity;
  executionOrder.closeFeeUsdt = Number(closure.feeUsdt);
  executionOrder.realizedPnl = Number(closure.realizedPnl);
  executionOrder.closedAt = closure.closedAt || executionOrder.closedAt;
  executionOrder.closeEvidencePath = closure.evidencePath || "fills-history";
  executionOrder.closeTradeIds = closure.tradeIds || [];
  executionOrder.closeAlgoIds = closure.algoIds || [];
  executionOrder.events ||= [];
  if (!executionOrder.events.some((event) => event.event === "financial_fills_backfilled")) {
    executionOrder.events.push({ at: nowIso(), event: "financial_fills_backfilled", detail: "历史估算费用已由 OKX 原始成交证据替换。" });
  }
  return {
    applied: true,
    entryFillCount: entryFills.length,
    closeFillCount: closeFills.length,
    quantityCorrected: Math.abs(entryQuantityBefore - expectedQuantity) > tolerance,
    recordedExpectedQuantity,
    authoritativeQuantity: expectedQuantity
  };
}

function markExecutionFinancialEvidencePending(db, executionOrder, reason = "fill_evidence_conflict") {
  executionOrder.status = "close_reconciliation_pending";
  executionOrder.closeReconciliationReason = reason;
  executionOrder.financialEvidenceConflict = true;
  executionOrder.financialEvidenceConflictAt = nowIso();
  const plan = (db.tradePlans || []).find((row) => row.id === executionOrder.planId);
  if (plan?.status === "completed") plan.status = "executing";
}

// 平仓成交确认与资金费到账是两个独立事实。这里持续收敛后者；只有费用字段齐全、
// 账户绑定正确、持仓窗口可证且 OKX bills 查询完整成功时，生命周期才进入净绩效链。
export async function reconcilePendingTradeFinancials(db, options = {}) {
  const nowMs = Number(options.nowMs ?? Date.now());
  const graceMs = Number(options.fundingReconciliationGraceMs ?? process.env.FUNDING_RECONCILIATION_GRACE_MS ?? 300_000);
  const fetchBills = options.fetchFundingBills || fetchOkxFundingBills;
  const fetchLifecycleClosure = options.fetchLifecycleClosure || fetchOkxProtectionClosure;
  const retryMs = Number(options.feeEvidenceRetryMs ?? process.env.FEE_EVIDENCE_RETRY_MS ?? 15 * 60_000);
  // Intentional raw-evidence path: funding reconciliation must examine every exchange fill,
  // then requires persisted execution-order evidence before it can influence a system lifecycle.
  const lifecycles = groupClosedTradeLifecycles(db.fills || []);
  const results = [];
  let reconciled = 0;
  for (const lifecycle of lifecycles) {
    if (!lifecycle.financialBasisIssues?.includes("funding_unreconciled")) continue;
    const entryFills = (db.fills || []).filter((fill) => fill.kind === "entry" && sameTradeLifecycle(fill, lifecycle.representative));
    const closeFills = lifecycle.fills || [];
    const executionOrder = (db.executionOrders || []).find((row) => row.id === lifecycle.representative.executionOrderId)
      || (db.executionOrders || []).find((row) => row.planId && row.planId === (lifecycle.representative.tradePlanId || lifecycle.representative.planId));
    if (!executionOrder) {
      results.push({ key: lifecycle.key, status: "execution_order_evidence_missing" });
      continue;
    }
    if (!entryFills.length || entryFills.some((fill) => !finiteFinancialValue(fill.feeUsdt) || fill.estimatedFee === true)
      || closeFills.some((fill) => !finiteFinancialValue(fill.feeUsdt) || fill.estimatedFee === true)) {
      const lastAttemptMs = new Date(executionOrder.financialEvidenceLastAttemptAt || 0).getTime();
      if (!options.fetchLifecycleClosure && Number.isFinite(lastAttemptMs) && lastAttemptMs > 0 && nowMs - lastAttemptMs < retryMs) {
        results.push({ key: lifecycle.key, status: "fee_evidence_retry_wait" });
        continue;
      }
      const accountId = executionOrder.accountId || enabledOkxAccounts(db)[0]?.id;
      const bindingSnapshot = accountId ? latestSuccessfulAccountSnapshot(db, { exchange: "OKX", accountId }) : null;
      const credentialBinding = validateOkxCredentialBinding(db, {
        accountId,
        snapshot: bindingSnapshot,
        executionFingerprint: executionOrder.apiKeyFingerprint || undefined
      });
      if (!credentialBinding.ok) {
        results.push({ key: lifecycle.key, status: credentialBinding.reason || "fee_evidence_credential_binding_invalid" });
        continue;
      }
      const executionEnvironment = executionOrder.environment || null;
      const snapshotEnvironment = bindingSnapshot?.environment || null;
      if (executionEnvironment && snapshotEnvironment && executionEnvironment !== snapshotEnvironment) {
        results.push({ key: lifecycle.key, status: "execution_environment_mismatch" });
        continue;
      }
      // 只对真正发往 OKX 的历史查询做退避。账户、Key 或环境绑定错误修正后，
      // 下一轮应立即重试，不能被一次未出网的校验失败额外卡住 15 分钟。
      executionOrder.financialEvidenceLastAttemptAt = nowIso();
      const closure = await fetchLifecycleClosure(executionOrder);
      if (!closure?.complete) {
        results.push({ key: lifecycle.key, status: closure?.reason || "fee_evidence_incomplete" });
        continue;
      }
      const applied = applyOkxLifecycleFinancialEvidence(db, executionOrder, closure);
      if (!applied.applied) {
        if (["fill_evidence_conflict", "authoritative_close_evidence_incomplete"].includes(applied.reason)) {
          markExecutionFinancialEvidencePending(db, executionOrder, applied.reason);
        }
        results.push({ key: lifecycle.key, status: applied.reason });
        continue;
      }
      executionOrder.accountId = credentialBinding.account.id;
      executionOrder.apiKeyFingerprint = credentialBinding.currentFingerprint;
      if (snapshotEnvironment) executionOrder.environment = snapshotEnvironment;
      executionOrder.financialEvidenceBackfilledAt = nowIso();
    }
    if (!executionOrder?.accountId) {
      results.push({ key: lifecycle.key, status: "bound_account_required" });
      continue;
    }
    const startAt = Math.min(...entryFills.map((fill) => new Date(fill.createdAt || 0).getTime()).filter(Number.isFinite));
    const endAt = Math.max(...closeFills.map((fill) => new Date(fill.createdAt || fill.closedAt || 0).getTime()).filter(Number.isFinite));
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt < startAt) {
      results.push({ key: lifecycle.key, status: "holding_window_unavailable" });
      continue;
    }
    if (!Number.isFinite(nowMs) || nowMs < endAt + Math.max(0, graceMs)) {
      results.push({ key: lifecycle.key, status: "funding_bills_settlement_wait" });
      continue;
    }
    const exactSnapshot = latestSuccessfulAccountSnapshot(db, { exchange: "OKX", accountId: executionOrder.accountId });
    if (!exactSnapshot || new Date(exactSnapshot.createdAt || 0).getTime() < endAt) {
      results.push({ key: lifecycle.key, status: "authoritative_account_snapshot_pending" });
      continue;
    }
    const credentialBinding = validateOkxCredentialBinding(db, {
      accountId: executionOrder.accountId,
      snapshot: exactSnapshot,
      executionFingerprint: executionOrder.apiKeyFingerprint
    });
    if (!credentialBinding.ok) {
      results.push({ key: lifecycle.key, status: credentialBinding.reason });
      continue;
    }
    const overlapping = lifecycles.some((other) => {
      if (other.key === lifecycle.key || canonicalSymbol(other.representative.symbol) !== canonicalSymbol(lifecycle.representative.symbol)) return false;
      const otherEntries = (db.fills || []).filter((fill) => fill.kind === "entry" && sameTradeLifecycle(fill, other.representative));
      const otherStart = Math.min(...otherEntries.map((fill) => new Date(fill.createdAt || 0).getTime()).filter(Number.isFinite));
      const otherEnd = new Date(other.lastClosedAt || 0).getTime();
      return Number.isFinite(otherStart) && Number.isFinite(otherEnd) && otherStart <= endAt && otherEnd >= startAt;
    });
    if (overlapping) {
      results.push({ key: lifecycle.key, status: "funding_attribution_overlap" });
      continue;
    }
    const funding = await fetchBills(executionOrder, { startAt, endAt, accountId: executionOrder.accountId });
    if (!funding?.complete || !finiteFinancialValue(funding.fundingFeeUsdt)) {
      results.push({ key: lifecycle.key, status: funding?.reason || "funding_bills_incomplete" });
      continue;
    }
    const finalFill = closeFills.find((fill) => fill.partial !== true) || closeFills.at(-1);
    for (const fill of closeFills) {
      fill.fundingFeeUsdt = fill === finalFill ? Number(funding.fundingFeeUsdt) : 0;
      fill.fundingReconciled = true;
      fill.fundingReconciledAt = nowIso();
      fill.fundingBillIds = funding.billIds || [];
      fill.financialBasis = "exchange_fills_and_okx_funding_bills_reconciled";
    }
    executionOrder.fundingFeeUsdt = Number(funding.fundingFeeUsdt);
    executionOrder.fundingReconciledAt = nowIso();
    reconciled += 1;
    results.push({ key: lifecycle.key, status: "reconciled", fundingFeeUsdt: Number(funding.fundingFeeUsdt), billCount: (funding.billIds || []).length });
  }
  if (reconciled) {
    for (const review of db.reviews || []) {
      if (review.status === "pending_financial_reconciliation") review.status = "pending";
    }
    syncTradeReviewQueue(db);
  }
  return { checked: results.length, reconciled, results };
}

function snapshotPositionOpen(snapshot, executionOrder) {
  if (!snapshot || snapshot.status !== "ok") return null;
  const direction = canonicalPositionDirection(executionOrder);
  return (snapshot.positions || []).some((row) => canonicalSymbol(row.instId || row.symbol) === canonicalSymbol(executionOrder.symbol)
    && canonicalPositionDirection(row) === direction
    && Math.abs(Number(row.pos ?? row.positionAmt ?? row.size ?? 0)) > 0);
}

function closureIdentityValues(closure = {}, field, breakdownField) {
  return [...new Set([
    ...(Array.isArray(closure[field]) ? closure[field] : []),
    ...(Array.isArray(closure.breakdown) ? closure.breakdown.map((row) => row?.[breakdownField]) : [])
  ].map((value) => String(value || "").trim()).filter(Boolean))].sort();
}

function sameClosureNumber(left, right) {
  if (!finiteFinancialValue(left) || !finiteFinancialValue(right)) return false;
  const a = Number(left);
  const b = Number(right);
  return Math.abs(a - b) <= Math.max(1, Math.abs(a), Math.abs(b)) * 1e-10;
}

function sameClosureTime(left, right) {
  const a = new Date(left || 0).getTime();
  const b = new Date(right || 0).getTime();
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

function closureBindingMatches(closure, executionOrder) {
  const checks = [
    ["accountId", executionOrder.accountId, (value) => String(value)],
    ["environment", executionOrder.environment, (value) => String(value).toLowerCase()],
    ["exchange", executionOrder.exchange || "OKX", (value) => String(value).toUpperCase()],
    ["symbol", executionOrder.symbol, canonicalSymbol]
  ];
  for (const [field, expected, normalize] of checks) {
    const observed = [closure?.[field], ...(closure?.breakdown || []).map((row) => row?.[field])]
      .filter((value) => value !== null && value !== undefined && String(value).trim() !== "");
    if (observed.some((value) => normalize(value) !== normalize(expected))) return false;
  }
  return true;
}

function closureEvidenceMatches(local, remote, executionOrder) {
  if (!local?.complete || !remote?.complete) return false;
  if (!closureBindingMatches(remote, executionOrder)) return false;
  const localTradeIds = closureIdentityValues(local, "tradeIds", "tradeId");
  const remoteTradeIds = closureIdentityValues(remote, "tradeIds", "tradeId");
  if (!localTradeIds.length || localTradeIds.length !== remoteTradeIds.length
    || localTradeIds.some((value, index) => value !== remoteTradeIds[index])) return false;
  const localOrderIds = closureIdentityValues(local, "exchangeOrderIds", "exchangeOrderId");
  const remoteOrderIds = closureIdentityValues(remote, "exchangeOrderIds", "exchangeOrderId");
  if (localOrderIds.length && remoteOrderIds.length && (localOrderIds.length !== remoteOrderIds.length
    || localOrderIds.some((value, index) => value !== remoteOrderIds[index]))) return false;
  if (!["quantity", "weightedPrice", "realizedPnl", "feeUsdt"].every((field) => sameClosureNumber(local[field], remote[field]))) {
    return false;
  }
  if (!sameClosureTime(local.closedAt, remote.closedAt)) return false;

  const localByTradeId = new Map((local.breakdown || []).map((row) => [String(row.tradeId || ""), row]).filter(([tradeId]) => tradeId));
  for (const remoteRow of remote.breakdown || []) {
    const localRow = localByTradeId.get(String(remoteRow.tradeId || ""));
    if (!localRow) return false;
    if (!["quantity", "price", "realizedPnl", "feeUsdt"].every((field) => sameClosureNumber(localRow[field], remoteRow[field]))) {
      return false;
    }
    if (finiteFinancialValue(localRow.rawFee) && finiteFinancialValue(remoteRow.rawFee)
      && !sameClosureNumber(localRow.rawFee, remoteRow.rawFee)) return false;
    const localFeeCurrency = String(localRow.feeCurrency || localRow.rawFeeCcy || "").toUpperCase();
    const remoteFeeCurrency = String(remoteRow.feeCurrency || remoteRow.rawFeeCcy || "").toUpperCase();
    if (localFeeCurrency && remoteFeeCurrency && localFeeCurrency !== remoteFeeCurrency) return false;
    if (!sameClosureTime(localRow.closedAt, remoteRow.closedAt)) return false;
    if (localRow.exchangeOrderId && remoteRow.exchangeOrderId
      && String(localRow.exchangeOrderId) !== String(remoteRow.exchangeOrderId)) return false;
  }
  return true;
}

export function reconcilePendingClose(db, executionOrder, { snapshot = null, closure = null } = {}) {
  let attributedManualClosure = buildAttributedManualExitClosure(db, executionOrder);
  let attributedSystemClosure = buildAttributedSystemExitClosure(db, executionOrder);
  let useAttributedManualExit = attributedManualClosure.complete === true;
  const credentialBinding = validateOkxCredentialBinding(db, {
    accountId: executionOrder.accountId,
    snapshot,
    executionFingerprint: executionOrder.apiKeyFingerprint
  });
  if (!credentialBinding.ok) return { id: executionOrder.id, status: executionOrder.status, settlement: credentialBinding.reason };
  if (!executionOrder.accountId || snapshot?.accountId !== executionOrder.accountId) {
    return { id: executionOrder.id, status: executionOrder.status, settlement: "bound_account_snapshot_pending" };
  }
  if (!snapshot?.environment || String(snapshot.environment).toLowerCase() !== String(executionOrder.environment || "").toLowerCase()) {
    return { id: executionOrder.id, status: executionOrder.status, settlement: "bound_environment_snapshot_pending" };
  }
  if (!snapshot?.exchange || String(snapshot.exchange).toUpperCase() !== String(executionOrder.exchange || "OKX").toUpperCase()) {
    return { id: executionOrder.id, status: executionOrder.status, settlement: "bound_exchange_snapshot_pending" };
  }
  const submittedAt = new Date(executionOrder.closeSubmittedAt || 0).getTime();
  const snapshotAt = new Date(snapshot?.createdAt || 0).getTime();
  const manualClosedAt = useAttributedManualExit ? new Date(attributedManualClosure.closedAt || 0).getTime() : 0;
  const systemClosedAt = attributedSystemClosure.fills.length
    ? new Date(attributedSystemClosure.closedAt || 0).getTime() : 0;
  const authoritativeAfter = Math.max(
    Number.isFinite(submittedAt) ? submittedAt : 0,
    Number.isFinite(manualClosedAt) ? manualClosedAt : 0,
    Number.isFinite(systemClosedAt) ? systemClosedAt : 0
  );
  if (!snapshot || snapshot.status !== "ok" || !Number.isFinite(snapshotAt) || snapshotAt < authoritativeAfter) {
    return { id: executionOrder.id, status: executionOrder.status, settlement: "authoritative_snapshot_pending" };
  }
  if (snapshotPositionOpen(snapshot, executionOrder)) {
    return { id: executionOrder.id, status: executionOrder.status, settlement: "position_still_open" };
  }
  const entryFills = (db.fills || []).filter((fill) => fill.kind === "entry" && fill.executionOrderId === executionOrder.id);
  const remoteEntryFeeBackfill = prepareEntryFeeBackfill(entryFills, closure?.entryFeeUsdt);
  if (!remoteEntryFeeBackfill.ok) {
    markExecutionFinancialEvidencePending(db, executionOrder);
    return { id: executionOrder.id, status: executionOrder.status, settlement: "fill_evidence_conflict" };
  }
  if (!useAttributedManualExit && closure?.complete) {
    for (const candidate of [
      [attributedManualClosure, buildAttributedManualExitClosure],
      [attributedSystemClosure, buildAttributedSystemExitClosure]
    ]) {
      const [attributedClosure, buildClosure] = candidate;
      if (!String(attributedClosure.reason || "").endsWith("_financial_evidence_conflict")) continue;
      const conflictedLocalClosure = buildClosure(db, executionOrder, { includeConflictedEvidence: true });
      if (!closureEvidenceMatches(conflictedLocalClosure, closure, executionOrder)) continue;
      for (const fill of conflictedLocalClosure.fills || []) {
        delete fill.financialEvidenceConflict;
        delete fill.financialEvidenceConflictReason;
      }
      delete executionOrder.financialEvidenceConflict;
      delete executionOrder.financialEvidenceConflictAt;
      if (buildClosure === buildAttributedManualExitClosure) attributedManualClosure = conflictedLocalClosure;
      else attributedSystemClosure = conflictedLocalClosure;
      useAttributedManualExit = attributedManualClosure.complete === true;
      break;
    }
  }
  const useAttributedSystemExit = !useAttributedManualExit && attributedSystemClosure.complete === true;
  if (!useAttributedManualExit && attributedManualClosure.reason === "manual_exit_financial_evidence_conflict" && closure?.complete) {
    executionOrder.status = "close_reconciliation_pending";
    executionOrder.closeReconciliationReason = "fill_evidence_conflict";
    return { id: executionOrder.id, status: executionOrder.status, settlement: "fill_evidence_conflict" };
  }
  if (!useAttributedManualExit && attributedSystemClosure.fills.length && closure?.complete
    && (!useAttributedSystemExit || !closureEvidenceMatches(attributedSystemClosure, closure, executionOrder))) {
    executionOrder.status = "close_reconciliation_pending";
    executionOrder.closeReconciliationReason = "fill_evidence_conflict";
    return { id: executionOrder.id, status: executionOrder.status, settlement: "fill_evidence_conflict" };
  }
  const settledClosure = useAttributedManualExit
    ? attributedManualClosure
    : (useAttributedSystemExit ? attributedSystemClosure : closure);
  if (!settledClosure?.complete) {
    executionOrder.status = "close_reconciliation_pending";
    executionOrder.closeReconciliationReason = "position_absent_fill_evidence_incomplete";
    return { id: executionOrder.id, status: executionOrder.status, settlement: "fill_evidence_incomplete" };
  }
  if (finiteFinancialValue(settledClosure.entryFeeUsdt)) {
    const entryFeeBackfill = prepareEntryFeeBackfill(entryFills, settledClosure.entryFeeUsdt);
    if (!entryFeeBackfill.ok) {
      markExecutionFinancialEvidencePending(db, executionOrder);
      return { id: executionOrder.id, status: executionOrder.status, settlement: "fill_evidence_conflict" };
    }
    const mutableNotional = entryFeeBackfill.mutableFills
      .reduce((sum, fill) => sum + Math.abs(Number(fill.notionalUsdt || Number(fill.price) * Number(fill.quantity) || 0)), 0);
    for (const fill of entryFeeBackfill.mutableFills) {
      const notional = Math.abs(Number(fill.notionalUsdt || Number(fill.price) * Number(fill.quantity) || 0));
      fill.feeUsdt = mutableNotional > 0
        ? entryFeeBackfill.mutableFee * notional / mutableNotional
        : entryFeeBackfill.mutableFee / Math.max(1, entryFeeBackfill.mutableFills.length);
      fill.feeCostUsdt = fill.feeUsdt;
      fill.feeSchemaVersion = 2;
      fill.feeSource = "okx_raw_fill_history";
      fill.estimatedFee = false;
      fill.feeBasis = "okx_entry_fills";
    }
    executionOrder.entryFeeUsdt = Number(settledClosure.entryFeeUsdt);
  }
  const exitReason = useAttributedManualExit
    ? "manual_exit"
    : (executionOrder.closeReason || (executionOrder.closeReconciliationSource === "protection_orders"
      ? "exchange_protection_filled" : "manual_close"));
  const existingCloseFills = useAttributedManualExit
    ? attributedManualClosure.fills
    : (useAttributedSystemExit ? attributedSystemClosure.fills : []);
  return finalizeReconciledExecutionClose(db, executionOrder, {
    exitReason,
    closure: settledClosure,
    existingCloseFills
  });
}

function finalizeReconciledExecutionClose(db, executionOrder, { exitReason, closure, existingCloseFills = [] }) {
  const openedAt = new Date(executionOrder.entryFilledAt || executionOrder.createdAt).getTime();
  const closedAt = new Date(closure.closedAt).getTime();
  const holdingMinutes = Number.isFinite(openedAt) && Number.isFinite(closedAt)
    ? Math.max(0, Math.round((closedAt - openedAt) / 60000)) : null;
  if (existingCloseFills.length) {
    const finalExistingFill = existingCloseFills.slice().sort((a, b) => new Date(b.exchangeFilledAt || b.createdAt || 0)
      - new Date(a.exchangeFilledAt || a.createdAt || 0))[0];
    for (const fill of existingCloseFills) {
      const existingExitMode = fill.tradeAttribution?.exitMode;
      fill.executionOrderId ||= executionOrder.id;
      fill.planId ||= executionOrder.planId;
      fill.tradePlanId ||= executionOrder.planId;
      fill.direction ||= executionOrder.direction;
      fill.holdingMinutes ??= holdingMinutes;
      fill.maeUsdt ??= executionOrder.maeUsdt ?? null;
      fill.mfeUsdt ??= executionOrder.mfeUsdt ?? null;
      fill.closureEvidencePath ||= closure.evidencePath || "attributed_external_exchange_fills";
      fill.financialBasis = "exchange_fills_confirmed_funding_unreconciled";
      fill.financialBasisComplete = false;
      fill.fundingReconciled ??= false;
      if (fill === finalExistingFill) {
        fill.partial = false;
        if (fill.tradeAttribution) fill.tradeAttribution.partial = false;
      }
      if (existingExitMode === "manual_exit") {
        fill.exitReason ||= exitReason;
        fill.tradeAttribution = buildExecutionFillAttribution(db, executionOrder, {
          ...fill,
          tradeAttribution: {
            ...fill.tradeAttribution,
            origin: "external_exchange",
            exitMode: "manual_exit",
            method: "deterministic_manual_exit"
          }
        });
        fill.tradeAttribution.origin = "external_exchange";
        fill.tradeAttribution.exitMode = "manual_exit";
        fill.tradeAttribution.method = "deterministic_manual_exit";
      }
    }
  } else {
    recordFill(db, executionOrder, "close", closure.weightedPrice, closure.quantity, closure.realizedPnl, {
      feeUsdt: closure.feeUsdt,
      feeCostUsdt: closure.feeUsdt,
      feeSchemaVersion: 2,
      feeSource: "okx_raw_fill_history",
      holdingMinutes,
      maeUsdt: executionOrder.maeUsdt ?? null,
      mfeUsdt: executionOrder.mfeUsdt ?? null,
      exitReason,
      createdAt: closure.closedAt,
      exchangeOrderIds: closure.exchangeOrderIds,
      exchangeTradeIds: closure.tradeIds || [],
      exchangeAlgoIds: closure.algoIds || [],
      closureEvidencePath: closure.evidencePath || "fills-history",
      exitBreakdown: closure.breakdown,
      inferred: false,
      estimated: false,
      fundingFeeUsdt: null,
      fundingReconciled: false,
      financialBasis: "exchange_fills_confirmed_funding_unreconciled"
    });
  }
  executionOrder.status = "closed";
  executionOrder.closedAt = closure.closedAt;
  executionOrder.updatedAt = closure.closedAt;
  executionOrder.realizedPnl = closure.realizedPnl;
  executionOrder.closeFeeUsdt = closure.feeUsdt;
  executionOrder.closeEvidencePath = closure.evidencePath || "fills-history";
  executionOrder.closeTradeIds = closure.tradeIds || [];
  executionOrder.closeAlgoIds = closure.algoIds || [];
  executionOrder.exitReason = exitReason;
  executionOrder.events ||= [];
  executionOrder.events.push({ at: nowIso(), event: "close_reconciled", detail: `交易所真实成交 ${closure.quantity} @ ${closure.weightedPrice}` });
  db.positions = (db.positions || []).filter((row) => !(row.source === "execution_engine" && row.executionOrderId === executionOrder.id));
  const plan = (db.tradePlans || []).find((row) => row.id === executionOrder.planId);
  if (plan) plan.status = "completed";
  if (exitReason !== "manual_exit" && executionOrder.affectedExecutionOrderIds?.length) {
    const affected = new Set(executionOrder.affectedExecutionOrderIds);
    for (const row of db.executionOrders || []) {
      if (!affected.has(row.id)) continue;
      row.status = "group_closed";
      row.groupCloseExecutionId = executionOrder.id;
      row.groupCloseLifecycleKey = executionOrder.id;
      row.closedAt = closure.closedAt;
      row.realizedPnl = null;
      row.financialBasis = "physical_group_close_unallocated";
      row.events ||= [];
      row.events.push({ at: nowIso(), event: "group_close_reconciled", detail: executionOrder.id });
      const affectedPlan = (db.tradePlans || []).find((candidate) => candidate.id === row.planId);
      if (affectedPlan) {
        affectedPlan.status = "completed";
        affectedPlan.financialBasis = "physical_group_close_unallocated";
      }
    }
    db.positions = (db.positions || []).filter((row) => !(row.source === "execution_engine" && affected.has(row.executionOrderId)));
  }
  db.riskIncidents = (db.riskIncidents || []).map((row) => row.source === executionOrder.id && row.kind === "close_reconciliation" && row.status === "open"
    ? { ...row, status: "resolved", resolvedAt: nowIso(), resolution: "exchange_fill_reconciled" }
    : row);
  clearReduceOnlyReason(db, "protection_emergency", { sourceId: executionOrder.id, resolvedBy: "ExecutionEngine", resolution: "authoritative_close_reconciled" });
  clearReduceOnlyReason(db, "liquidation_emergency", { sourceId: executionOrder.id, resolvedBy: "ExecutionEngine", resolution: "authoritative_close_reconciled" });
  syncReduceOnlyState(db);
  return { id: executionOrder.id, status: "closed", settlement: "confirmed", closure };
}

async function placeTakeProfits(db, executionOrder, options = {}) {
  if (!executionOrder.takeProfits?.length) {
    executionOrder.status = "protecting";
    return;
  }
  const closeSide = executionOrder.direction === "short" ? "BUY" : "SELL";
  let tpTargets = executionOrder.takeProfits;
  let quantities = allocateProtectionQuantities(executionOrder.quantity, tpTargets.length, executionOrder.entryPrice);
  // (P1-4)数量太小分不出多档 → 降级为单档全仓止盈;彻底分不出也不熔断——
  // 原生止损在入场时已确认存在(这是不变量),缺止盈是"离场质量降级"不是"裸仓"。
  if (quantities.length !== tpTargets.length && tpTargets.length > 1) {
    tpTargets = [executionOrder.takeProfits[0]];
    quantities = allocateProtectionQuantities(executionOrder.quantity, 1, executionOrder.entryPrice);
  }
  if (quantities.length !== tpTargets.length) {
    executionOrder.status = "protecting";
    executionOrder.protection = "stop_only";
    executionOrder.events.push({ at: nowIso(), event: "take_profit_allocation_failed", detail: "数量过小无法布置止盈,仅保留原生止损(降级)" });
    db.riskIncidents.unshift({ id: id("incident"), severity: "medium", status: "open", title: `止盈未布置(数量过小):${executionOrder.symbol} 仅止损保护`, source: executionOrder.id, createdAt: nowIso() });
    appendAudit(db, "止盈分配失败,降级为仅止损保护", executionOrder.id, "ExecutionEngine", "warning");
    return;
  }
  const targets = tpTargets.map((price, index) => ({
    price,
    stopPrice: price,
    quantity: quantities[index],
    clientOrderId: cleanClOrdId(`tp${index + 1}${executionOrder.id.slice(-10)}`)
  }));
  executionOrder.tpClientOrderIds = targets.map((target) => target.clientOrderId);
  executionOrder.tpPlacementIntent = {
    status: "submitting",
    clientOrderIds: executionOrder.tpClientOrderIds.slice(),
    targets: targets.map((target) => ({ ...target })),
    attemptedAt: executionOrder.tpPlacementIntent?.attemptedAt || nowIso()
  };
  saveDb(db);
  let result;
  try {
    assertActiveLease(options);
    result = await (options.executeTradeAction || executeTradeAction)(db, "take_profit", {
      exchange: executionOrder.exchange,
      marketType: "perpetual_usdt",
      symbol: executionOrder.symbol,
      side: closeSide,
      quantity: Math.max(...quantities),
      targets,
      agentRunId: executionOrder.agentRunId,
      analysisBundleId: executionOrder.analysisBundleId,
      evidenceBundleId: executionOrder.evidenceBundleId,
      tradePlanId: executionOrder.planId,
      riskCheckId: executionOrder.riskCheckId,
      mandateId: executionOrder.mandateId,
      manualApproval: true
    });
  } catch (error) {
    if (isLeaseLostError(error)) throw error;
    // 止盈下单异常：仓位已成交在场、原生止损仍在（入场时已确认），但止盈缺失。
    // 标记保护降级 + 熔断新开仓 + 事故，交由人工处置；不静默吞掉。
    executionOrder.status = "protecting_degraded";
    executionOrder.protection = "stop_only_tp_unconfirmed";
    executionOrder.tpPlacementIntent.status = "unknown";
    executionOrder.tpPlacementIntent.error = String(error.message || error).slice(0, 200);
    executionOrder.events.push({ at: nowIso(), event: "take_profit_exception", detail: String(error.message || error).slice(0, 200) });
    const tpPlan = db.tradePlans?.find((item) => item.id === executionOrder.planId);
    if (tpPlan) tpPlan.status = "executing";
    db.system.killSwitch = true;
    db.riskIncidents.unshift({
      id: id("incident"),
      severity: "critical",
      status: "open",
      title: "止盈单布置失败（止损仍在），需人工确认离场计划",
      source: executionOrder.id,
      createdAt: nowIso()
    });
    surfaceOwnerExecutionSafetyIssue(db, executionOrder);
    appendAudit(db, "止盈单布置异常，已熔断并转人工", executionOrder.id, "ExecutionEngine", "critical");
    return;
  }
  // (P1-1)检查真实结果:批量路径此前恒 ok,交易所逐单拒绝会被静默吞掉。
  executionOrder.tpPlacementIntent.results = Array.isArray(result.orders) ? result.orders.map((row) => ({
    clientOrderId: row.clientOrderId || null,
    algoId: row.algoId || null,
    status: row.status || "unknown"
  })) : [];
  if (!["ok", "submitted", "idempotent_replay"].includes(result.status)) {
    executionOrder.status = "protecting";
    executionOrder.protection = "stop_only";
    executionOrder.tpPlacementIntent.status = result.status === "partial_failure" ? "partial_failure_tracked" : "rejected";
    executionOrder.events.push({ at: nowIso(), event: "take_profit_rejected", detail: `止盈单未全部落地(${result.status},失败 ${result.failedCount ?? "?"}),保留原生止损` });
    db.riskIncidents.unshift({ id: id("incident"), severity: "medium", status: "open", title: `止盈单被拒(${result.status}):${executionOrder.symbol} 仅止损保护`, source: executionOrder.id, createdAt: nowIso() });
    appendAudit(db, `止盈单未全部落地(${result.status}),降级为仅止损保护`, executionOrder.id, "ExecutionEngine", "warning");
    return;
  }
  executionOrder.tpPlacementIntent.status = "acknowledged";
  executionOrder.tpAlgoIds = executionOrder.tpPlacementIntent.results.map((row) => row.algoId).filter(Boolean);
  executionOrder.status = "protecting";
  executionOrder.events.push({ at: nowIso(), event: "take_profits_placed", detail: `状态 ${result.status}` });
}

function recordFill(db, executionOrder, kind, price, quantity, realizedPnl = null, extra = {}) {
  db.fills ||= [];
  const notional = Number(price) * Number(quantity);
  const plan = (db.tradePlans || []).find((item) => item.id === executionOrder.planId) || {};
  const feeUsdt = extra.feeCostUsdt ?? extra.feeUsdt ?? (kind === "entry" ? executionOrder.entryFeeUsdt : feeEstimate(notional));
  const fill = {
    id: id("fill"),
    executionOrderId: executionOrder.id,
    tenantId: executionOrder.tenantId || plan.tenantId || plan.ownerTenantId || db.user?.tenantId || "tenant_owner",
    ownerUserId: executionOrder.ownerUserId || plan.ownerUserId || plan.createdByUserId || plan.userId || db.user?.id || null,
    planId: executionOrder.planId,
    tradePlanId: executionOrder.planId,
    agentRunId: executionOrder.agentRunId,
    analysisBundleId: executionOrder.analysisBundleId,
    evidenceBundleId: executionOrder.evidenceBundleId,
    decisionProvenance: executionOrder.decisionProvenance ? structuredClone(executionOrder.decisionProvenance) : (plan.decisionProvenance ? structuredClone(plan.decisionProvenance) : null),
    criticReviewId: executionOrder.criticReviewId || plan.criticReviewId || null,
    riskCheckId: executionOrder.riskCheckId,
    mandateId: executionOrder.mandateId,
    symbol: executionOrder.symbol,
    exchange: executionOrder.exchange || plan.exchange || null,
    accountId: executionOrder.accountId || plan.accountId || null,
    environment: executionOrder.environment || plan.environment || null,
    direction: executionOrder.direction,
    // 成交买卖方向:开仓=持仓方向对应的买卖(多→买/空→卖),平仓=反向(平空=买/平多=卖)。
    side: (() => {
      const isLong = executionOrder.direction === "long" || executionOrder.direction === "多";
      return (kind === "close" || kind === "exit") ? (isLong ? "sell" : "buy") : (isLong ? "buy" : "sell");
    })(),
    strategy: executionOrder.strategy || plan.strategy || plan.strategy_type || "manual_review",
    strategyRef: executionOrder.strategyRef ? { ...executionOrder.strategyRef } : (plan.strategyRef ? { ...plan.strategyRef } : null),
    strategyBlueprintRef: executionOrder.strategyBlueprintRef ? { ...executionOrder.strategyBlueprintRef } : (plan.strategyBlueprintRef ? { ...plan.strategyBlueprintRef } : null),
    strategyProductId: executionOrder.strategyProductId || plan.strategyProductId || null,
    strategyVersion: executionOrder.strategyVersion || plan.strategyVersion || null,
    strategyVersionId: executionOrder.strategyVersionId || plan.strategyVersionId || null,
    strategyInstance: executionOrder.strategyInstance ? structuredClone(executionOrder.strategyInstance) : (plan.strategyInstance ? structuredClone(plan.strategyInstance) : null),
    reviewLearning: executionOrder.reviewLearning ? structuredClone(executionOrder.reviewLearning) : (plan.reviewLearning ? structuredClone(plan.reviewLearning) : null),
    timeframe: plan.timeframe || plan.strategyInstance?.timeframe || null,
    regime: executionOrder.regime || inferMarketRegime(db, executionOrder.symbol),
    kind,
    partial: Boolean(extra.partial),
    price: Number(price),
    quantity: Number(quantity),
    notionalUsdt: notional,
    expectedPrice: kind === "entry" ? executionOrder.entryPrice : extra.expectedPrice,
    slippageBps: extra.slippageBps ?? (kind === "entry" ? executionOrder.entrySlippageBps : null),
    predictedImpactBps: kind === "entry" ? executionOrder.executionCostEstimate?.expectedImpactBps ?? null : null,
    impactPredictionErrorBps: kind === "entry" && Number.isFinite(Number(executionOrder.entrySlippageBps)) && Number.isFinite(Number(executionOrder.executionCostEstimate?.expectedImpactBps))
      ? Number((Number(executionOrder.entrySlippageBps) - Number(executionOrder.executionCostEstimate.expectedImpactBps)).toFixed(3))
      : null,
    feeUsdt,
    feeCostUsdt: feeUsdt,
    feeSchemaVersion: extra.feeSchemaVersion ?? 2,
    feeSource: extra.feeSource || (extra.feeUsdt === undefined && extra.feeCostUsdt === undefined ? "estimated" : "recorded"),
    rawFee: extra.rawFee ?? null,
    rawFeeCcy: extra.rawFeeCcy ?? null,
    estimatedFee: extra.estimatedFee ?? (extra.feeUsdt === undefined),
    feeBasis: extra.feeBasis || (extra.feeUsdt === undefined ? "estimated_from_notional" : "recorded"),
    fundingRate: extra.fundingRate,
    fundingFeeUsdt: extra.fundingFeeUsdt,
    fundingReconciled: extra.fundingReconciled,
    financialBasis: extra.financialBasis,
    holdingMinutes: extra.holdingMinutes,
    maeUsdt: extra.maeUsdt,
    mfeUsdt: extra.mfeUsdt,
    entryRationale: executionOrder.entryRationale || entryRationale(plan),
    exitReason: extra.exitReason,
    inferred: Boolean(extra.inferred),
    estimated: Boolean(extra.estimated),
    exchangeOrderIds: extra.exchangeOrderIds,
    exchangeTradeIds: extra.exchangeTradeIds,
    exchangeAlgoIds: extra.exchangeAlgoIds,
    exchangeOrderId: Array.isArray(extra.exchangeOrderIds) && extra.exchangeOrderIds.length === 1 ? extra.exchangeOrderIds[0] : undefined,
    exchangeTradeId: Array.isArray(extra.exchangeTradeIds) && extra.exchangeTradeIds.length === 1 ? extra.exchangeTradeIds[0] : undefined,
    exchangeAlgoId: Array.isArray(extra.exchangeAlgoIds) && extra.exchangeAlgoIds.length === 1 ? extra.exchangeAlgoIds[0] : undefined,
    exchangeFilledAt: extra.exchangeFilledAt || (kind === "close" ? extra.createdAt : undefined),
    closureEvidencePath: extra.closureEvidencePath,
    exitBreakdown: extra.exitBreakdown,
    realizedPnl,
    initialRiskUsdt: executionOrder.initialRiskUsdt || plan.initialRiskUsdt || null,
    accountEquityAtEntryUsdt: executionOrder.accountEquityAtEntryUsdt || plan.accountEquityAtEntryUsdt || null,
    createdAt: extra.createdAt || nowIso()
  };
  fill.tradeAttribution = buildExecutionFillAttribution(db, executionOrder, fill);
  db.fills.unshift(fill);
  reconcilePendingTradeAttributions(db);
  if (kind === "close") reconcileStrategyProductHealth(db);
  // 平仓确认即进入真实复盘队列；30 分钟复盘任务只负责深度处理与失败重试。
  ensureTradeReviewQueued(db, fill);
  if (kind === "close") recordPostTradeCapabilities(db, fill);
  return fill;
}

function upsertPosition(db, executionOrder, filledSize = executionOrder.quantity) {
  db.positions ||= [];
  let position = db.positions.find((item) => item.executionOrderId === executionOrder.id && item.source === "execution_engine");
  const conflicting = db.positions.find((item) => item.symbol === executionOrder.symbol
    && item.source === "execution_engine" && item.executionOrderId && item.executionOrderId !== executionOrder.id
    && Math.abs(Number(item.size || 0)) > 0);
  if (!position && conflicting) throw new Error("same_symbol_position_add_unsupported");
  if (!position) position = db.positions.find((item) => item.symbol === executionOrder.symbol && item.source === "execution_engine" && !item.executionOrderId);
  if (!position) {
    position = { id: id("pos"), symbol: executionOrder.symbol, source: "execution_engine" };
    db.positions.unshift(position);
  }
  Object.assign(position, {
    direction: executionOrder.direction === "short" ? "空" : "多",
    size: Number(filledSize),
    entry: executionOrder.filledPrice || executionOrder.entryPrice,
    stopLoss: executionOrder.stopLoss,
    takeProfits: executionOrder.takeProfits,
    executionOrderId: executionOrder.id,
    planId: executionOrder.planId,
    evidenceBundleId: executionOrder.evidenceBundleId,
    openedAt: executionOrder.entryFilledAt || nowIso(),
    maeUsdt: 0,
    mfeUsdt: 0,
    regime: executionOrder.regime,
    entryRationale: executionOrder.entryRationale
  });
}

export function executionExitIntentForStatus(status) {
  if (["entry_unknown_pending", "entry_pending"].includes(status)) return "cancel_entry";
  if (status === "entry_partial") return "cancel_remainder_and_close_filled";
  if (["entry_filled", "protecting", "protecting_degraded"].includes(status)) return "close_position";
  return null;
}

async function submitClosePosition(db, executionOrder, reason, options = {}) {
  if (["close_pending", "close_unknown_pending", "close_reconciliation_pending"].includes(executionOrder.status)) {
    return { status: executionOrder.status, idempotent: true, closeClientOrderId: executionOrder.closeClientOrderId };
  }
  const direction = canonicalPositionDirection(executionOrder);
  const competing = (db.executionOrders || []).filter((row) => row.id !== executionOrder.id
    && canonicalSymbol(row.symbol) === canonicalSymbol(executionOrder.symbol)
    && canonicalPositionDirection(row) === direction
    && ["entry_partial", "entry_filled", "protecting", "close_pending", "close_reconciliation_pending"].includes(row.status));
  if (competing.length) {
    return { status: "shared_position_close_requires_coordination", conflictingExecutionOrderIds: competing.map((row) => row.id) };
  }
  if (!executionOrder.accountId) {
    const now = Date.now();
    const enabled = new Set((db.exchangeAccounts || []).filter((row) => row.exchange === "OKX" && row.readEnabled).map((row) => row.id));
    const candidates = new Map();
    for (const snapshot of db.accountSnapshots || []) {
      const at = new Date(snapshot?.createdAt || 0).getTime();
      if (snapshot?.exchange !== "OKX" || snapshot?.status !== "ok" || !snapshot.accountId || !enabled.has(snapshot.accountId)
        || !Number.isFinite(at) || now - at > Number(process.env.MAX_ACCOUNT_SNAPSHOT_AGE_MS || 600000)) continue;
      if (!candidates.has(snapshot.accountId)) candidates.set(snapshot.accountId, snapshot);
    }
    if (candidates.size !== 1) return { status: "account_binding_required", candidateAccountIds: [...candidates.keys()] };
    executionOrder.accountId = [...candidates.keys()][0];
    executionOrder.events ||= [];
    executionOrder.events.push({ at: nowIso(), event: "legacy_account_bound", detail: executionOrder.accountId });
    appendAudit(db, `旧执行单在唯一新鲜 OKX 账户下完成绑定：${executionOrder.accountId}`, executionOrder.id, "ExecutionEngine", "warning");
  }
  const boundAccount = (db.exchangeAccounts || []).find((row) => row.id === executionOrder.accountId);
  const closeCredentialBinding = validateOkxCredentialBinding(db, {
    accountId: executionOrder.accountId,
    executionFingerprint: executionOrder.apiKeyFingerprint || boundAccount?.apiKeyFingerprint
  });
  if (!closeCredentialBinding.ok) return { status: "account_binding_required", reason: closeCredentialBinding.reason };
  executionOrder.apiKeyFingerprint = closeCredentialBinding.currentFingerprint;
  executionOrder.closeClientOrderId ||= cleanClOrdId(`close${String(executionOrder.id || "").slice(-20)}`);
  const priorStatus = executionOrder.status;
  executionOrder.closeAttemptedAt ||= nowIso();
  executionOrder.closeSubmittedAt ||= executionOrder.closeAttemptedAt;
  executionOrder.closeReconciliationSource = "manual_close";
  executionOrder.status = "close_unknown_pending";
  const closeRequestToken = executionOrder.closeRequestToken = id("close_request");
  saveDb(db);
  const submittedAt = executionOrder.closeAttemptedAt;
  const executeAction = options.executeTradeAction || executeTradeAction;
  let result;
  try {
    // durable close intent 已先落盘；真正外呼必须在最后一刻重新核验 fencing。
    assertActiveLease(options);
    result = await executeAction(db, "close_position", {
    exchange: executionOrder.exchange,
    marketType: "perpetual_usdt",
    symbol: executionOrder.symbol,
    quantity: executionOrder.filledQuantity || executionOrder.quantity,
    positionSide: direction,
    accountId: executionOrder.accountId,
    clientOrderId: executionOrder.closeClientOrderId,
    closePosition: true,
    emergencyActionId: options.emergencyActionId,
    agentRunId: executionOrder.agentRunId,
    analysisBundleId: executionOrder.analysisBundleId,
    evidenceBundleId: executionOrder.evidenceBundleId,
    tradePlanId: executionOrder.planId,
    riskCheckId: executionOrder.riskCheckId,
      mandateId: executionOrder.mandateId,
    executionOrderId: executionOrder.id,
    expectedStatus: priorStatus,
    exitIntent: "close_position",
    manualApproval: true
    });
  } catch (error) {
    if (isLeaseLostError(error)) throw error;
    if (executionOrder.closeRequestToken !== closeRequestToken || executionOrder.status !== "close_unknown_pending") {
      executionOrder.events ||= [];
      executionOrder.events.push({ at: nowIso(), event: "stale_close_response_ignored", detail: String(error.message || error).slice(0, 180) });
      return { status: executionOrder.status, idempotent: true, staleResponseIgnored: true };
    }
    executionOrder.status = "close_unknown_pending";
    executionOrder.closeReconciliationSource = "manual_close";
    executionOrder.closeReason = reason;
    executionOrder.events ||= [];
    executionOrder.events.push({ at: nowIso(), event: "close_response_unknown", detail: String(error.message || error).slice(0, 180) });
    db.system ||= {};
    db.system.reduceOnlyMode = true;
    db.system.reduceOnlyBy = "close_reconciliation_pending";
    saveDb(db);
    return { status: "close_unknown_pending", error: String(error.message || error) };
  }
  // 外呼期间后台轮询可能已推进到更晚状态。旧响应不得覆盖新事实。
  if (executionOrder.closeRequestToken !== closeRequestToken || executionOrder.status !== "close_unknown_pending") {
    return { status: executionOrder.status, idempotent: true, staleResponseIgnored: true, result };
  }
  if (result.status === "unknown_pending") {
    db.system ||= {};
    db.system.reduceOnlyMode = true;
    db.system.reduceOnlyBy = "close_reconciliation_pending";
    saveDb(db);
    return { status: "close_unknown_pending", result };
  }
  if (!["ok", "submitted", "idempotent_replay"].includes(result.status)) {
    executionOrder.status = priorStatus;
    executionOrder.events ||= [];
    executionOrder.events.push({ at: nowIso(), event: "close_unconfirmed", detail: result.reason || result.status || "unknown" });
    saveDb(db);
    return { status: "close_unconfirmed", result };
  }
  executionOrder.status = "close_pending";
  executionOrder.closeReconciliationSource = "manual_close";
  executionOrder.closeSubmittedAt ||= submittedAt;
  executionOrder.closeReason = reason;
  executionOrder.closeActionId = result.actionId || executionOrder.closeActionId || null;
  executionOrder.closeOmsOrderId = result.omsOrderId || executionOrder.closeOmsOrderId || null;
  executionOrder.closeExchangeOrderId = result.exchangeOrderId || executionOrder.closeExchangeOrderId || null;
  executionOrder.events ||= [];
  executionOrder.events.push({ at: submittedAt, event: "close_acknowledged", detail: `${reason}；等待新账户快照与真实成交明细核算` });
  return { status: "close_pending", result, closeClientOrderId: executionOrder.closeClientOrderId };
}

// 手动关闭一个执行中的订单/持仓（用户或风控触发）。用户请求必须带 intent + expectedStatus，
// 防止“点击时想撤单、请求到达时已成交”被静默升级成真实市价平仓。
export async function closeExecution(db, executionOrderId, reason = "manual", options = {}) {
  const executionOrder = (db.executionOrders || []).find((item) => item.id === executionOrderId);
  if (!executionOrder) return { status: "missing_execution_order" };
  const requiredIntent = executionExitIntentForStatus(executionOrder.status);
  if (["cancel_pending", "cancel_unknown_pending", "protection_failure_cancel_pending", "close_pending", "close_unknown_pending", "close_reconciliation_pending"].includes(executionOrder.status)) {
    return { status: executionOrder.status, idempotent: true, currentStatus: executionOrder.status };
  }
  const requestedIntent = options.intent || requiredIntent;
  const internalPartialIntent = options.internal === true && executionOrder.status === "entry_partial"
    && ["cancel_remainder_keep_filled", "emergency_close_if_filled"].includes(options.intent);
  const internalPendingIntent = options.internal === true && ["entry_unknown_pending", "entry_pending"].includes(executionOrder.status)
    && options.intent === "emergency_close_if_filled";
  if ((options.expectedStatus && options.expectedStatus !== executionOrder.status)
    || (options.intent && options.intent !== requiredIntent && !internalPartialIntent && !internalPendingIntent)) {
    return {
      status: "status_conflict",
      expectedStatus: options.expectedStatus || null,
      currentStatus: executionOrder.status,
      requestedIntent: options.intent || null,
      requiredIntent,
      message: "执行状态已变化，请刷新后按当前状态重新确认。"
    };
  }
  if (["entry_unknown_pending", "entry_pending", "entry_partial"].includes(executionOrder.status)) {
    const priorStatus = executionOrder.status;
    const wasPartial = executionOrder.status === "entry_partial";
    const allowedPartialIntents = options.internal
      ? ["cancel_remainder_and_close_filled", "cancel_remainder_keep_filled", "emergency_close_if_filled"]
      : ["cancel_remainder_and_close_filled"];
    if (wasPartial && !allowedPartialIntents.includes(requestedIntent)) {
      return { status: "status_conflict", currentStatus: executionOrder.status, requestedIntent, requiredIntent, message: "部分成交必须明确确认撤销余量并平掉已成交仓位。" };
    }
    executionOrder.cancelAttemptedAt ||= nowIso();
    executionOrder.cancelSubmittedAt ||= executionOrder.cancelAttemptedAt;
    executionOrder.cancelDisposition = wasPartial || internalPendingIntent ? requestedIntent : "cancel_entry";
    executionOrder.cancelReason = reason;
    executionOrder.cancelClientActionId ||= cleanClOrdId(`cancel${String(executionOrder.id || "").slice(-20)}`);
    const pendingBeforeCall = options.protectionFailure ? "protection_failure_cancel_pending" : "cancel_unknown_pending";
    executionOrder.status = pendingBeforeCall;
    const cancelRequestToken = executionOrder.cancelRequestToken = id("cancel_request");
    saveDb(db);
    const executeAction = options.executeTradeAction || executeTradeAction;
    let result;
    try {
      // durable cancel intent 已先落盘；失租时保持 unknown pending，旧 owner 不得发单。
      assertActiveLease(options);
      result = await executeAction(db, "cancel_order", {
      exchange: executionOrder.exchange,
      marketType: "perpetual_usdt",
      symbol: executionOrder.symbol,
      clientOrderId: executionOrder.clientOrderId,
      exitIntent: requestedIntent,
      cancelDisposition: executionOrder.cancelDisposition,
      cancelReason: reason,
      executionOrderId: executionOrder.id,
      expectedStatus: priorStatus,
      accountId: executionOrder.accountId,
      agentRunId: executionOrder.agentRunId,
      analysisBundleId: executionOrder.analysisBundleId,
      evidenceBundleId: executionOrder.evidenceBundleId,
      tradePlanId: executionOrder.planId,
      riskCheckId: executionOrder.riskCheckId,
      mandateId: executionOrder.mandateId,
      manualApproval: true
      });
    } catch (error) {
      if (isLeaseLostError(error)) throw error;
      if (executionOrder.cancelRequestToken !== cancelRequestToken || executionOrder.status !== pendingBeforeCall) {
        executionOrder.events ||= [];
        executionOrder.events.push({ at: nowIso(), event: "stale_cancel_response_ignored", detail: String(error.message || error).slice(0, 180) });
        return { status: executionOrder.status, idempotent: true, staleResponseIgnored: true };
      }
      executionOrder.status = options.protectionFailure ? "protection_failure_cancel_pending" : "cancel_unknown_pending";
      executionOrder.events.push({ at: nowIso(), event: "cancel_response_unknown", detail: String(error.message || error).slice(0, 180) });
      db.system ||= {};
      db.system.reduceOnlyMode = true;
      db.system.reduceOnlyBy ||= "cancel_reconciliation_pending";
      saveDb(db);
      return { status: executionOrder.status, error: String(error.message || error) };
    }
    if (executionOrder.cancelRequestToken !== cancelRequestToken || executionOrder.status !== pendingBeforeCall) {
      return { status: executionOrder.status, idempotent: true, staleResponseIgnored: true, result };
    }
    if (result.status === "unknown_pending") {
      db.system ||= {};
      db.system.reduceOnlyMode = true;
      db.system.reduceOnlyBy ||= "cancel_reconciliation_pending";
      saveDb(db);
      return { status: executionOrder.status, result };
    }
    const acknowledged = ["ok", "submitted", "idempotent_replay"].includes(result.status);
    executionOrder.events.push({ at: nowIso(), event: "cancel_requested", detail: reason });
    if (!acknowledged) {
      executionOrder.status = executionOrder.status === "protection_failure_cancel_pending" ? executionOrder.status : priorStatus;
      executionOrder.events.push({ at: nowIso(), event: "cancel_unconfirmed", detail: result.reason || result.status || "unknown" });
      saveDb(db);
      return { status: "cancel_unconfirmed", result };
    }
    executionOrder.status = options.protectionFailure ? "protection_failure_cancel_pending" : "cancel_pending";
    executionOrder.cancelActionId = result.actionId || executionOrder.cancelActionId || null;
    return { status: executionOrder.status, result };
  }
  if (["entry_filled", "protecting", "protecting_degraded"].includes(executionOrder.status)) {
    return submitClosePosition(db, executionOrder, reason, options);
  }
  return { status: "not_closable", currentStatus: executionOrder.status };
}
