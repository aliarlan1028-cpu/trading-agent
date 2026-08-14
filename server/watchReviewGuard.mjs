import { createHash } from "node:crypto";
import { normalizeEvidenceSymbol } from "./evidenceBundle.mjs";

export const WATCH_REVIEW_MAX_REARMS = 2;
export const WATCH_LINEAGE_VERSION = 2;
export const WATCH_REARM_WINDOWS_HOURS = Object.freeze({
  day_trader: 12,
  swing_trader: 48
});

export const WATCH_SETUP_TYPES = Object.freeze([
  "trend_continuation",
  "trend_pullback",
  "breakout_retest",
  "breakdown_retest",
  "reversal_reclaim",
  "fake_breakout",
  "range_rejection"
]);

export const WATCH_REVIEW_REASON_CODES = Object.freeze([
  "structure_conflict",
  "reward_risk_below_min",
  "liquidity_unacceptable",
  "evidence_missing",
  "invalidation_hit",
  "no_valid_stop"
]);

const REASON_CODES = new Set(WATCH_REVIEW_REASON_CODES);
const OUTCOMES = new Set(["rejected", "invalidated"]);
const NEXT_ACTIONS = new Set(["stop_monitoring", "fresh_thesis", "manual_review"]);
const SETUP_TYPES = new Set(WATCH_SETUP_TYPES);
const TRADER_ROLES = new Set(["day_trader", "swing_trader"]);
const ROLE_DEFAULT_TTL_HOURS = Object.freeze({ day_trader: 4, swing_trader: 12 });

function finite(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function safeDirection(value) {
  const direction = String(value || "").toLowerCase();
  return ["long", "short", "neutral"].includes(direction) ? direction : "neutral";
}

function safeSetupType(value) {
  const setupType = String(value || "").trim().toLowerCase();
  return SETUP_TYPES.has(setupType) ? setupType : null;
}

function safeTraderRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return TRADER_ROLES.has(role) ? role : null;
}

function isoTime(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) && parsed > 0 ? new Date(parsed).toISOString() : null;
}

function hashIdentity(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

function compactStructureFrame(frame = {}) {
  if (!frame?.available) return { available: false };
  return {
    available: true,
    trend: frame.trend ? { direction: frame.trend.direction || null, sequence: frame.trend.sequence || null } : null,
    phase: frame.phase || null,
    regime: frame.regime ? {
      label: frame.regime.label || null,
      previousLabel: frame.regime.previousLabel || null,
      transition: frame.regime.transition ? {
        detected: frame.regime.transition.detected === true,
        type: frame.regime.transition.type || null
      } : null
    } : null,
    latestEvent: frame.latestEvent ? {
      kind: frame.latestEvent.kind || null,
      direction: frame.latestEvent.direction || null,
      level: finite(frame.latestEvent.level) ? Number(frame.latestEvent.level) : null,
      breakTime: isoTime(frame.latestEvent.breakTime)
    } : null
  };
}

export function deterministicWatchStructureFingerprint(fact = null, traderRole = null) {
  const role = safeTraderRole(traderRole) || safeTraderRole(fact?.selectedRole);
  if (!fact?.evidenceRef || !role) return null;
  const mapping = role === "day_trader"
    ? { context: "1h", structure: "15m", confirmation: "5m" }
    : { context: "1d", structure: "4h", confirmation: "1h" };
  return hashIdentity({
    version: 1,
    role,
    bias: fact.bias || null,
    alignment: fact.alignment || null,
    phase: fact.phase || null,
    context: compactStructureFrame(fact.frames?.[mapping.context]),
    structure: compactStructureFrame(fact.frames?.[mapping.structure]),
    confirmation: compactStructureFrame(fact.frames?.[mapping.confirmation])
  });
}

export function watchThesisFingerprint({ symbol, direction, setupType, traderRole, structureFingerprint } = {}) {
  const normalizedSymbol = normalizeEvidenceSymbol(symbol);
  const normalizedSetup = safeSetupType(setupType);
  const normalizedRole = safeTraderRole(traderRole);
  if (!normalizedSymbol || !normalizedSetup || !normalizedRole) return null;
  return `watch-thesis-v${WATCH_LINEAGE_VERSION}:${hashIdentity({
    symbol: normalizedSymbol,
    direction: safeDirection(direction),
    setupType: normalizedSetup,
    traderRole: normalizedRole,
    structureFingerprint: structureFingerprint || "unavailable"
  })}`;
}

function watchWindowHours(role) {
  return WATCH_REARM_WINDOWS_HOURS[safeTraderRole(role)] || WATCH_REARM_WINDOWS_HOURS.day_trader;
}

function watchRoleTtl(args = {}, role) {
  const maxHours = watchWindowHours(role);
  const requested = Number(args.ttlHours);
  if (Number.isFinite(requested) && requested > maxHours) {
    return { ok: false, error: `${role === "swing_trader" ? "波段" : "日内"}观察哨最长 ${maxHours} 小时，不能用更长 TTL 绕过判断链窗口。` };
  }
  return {
    ok: true,
    ttlHours: Number.isFinite(requested) && requested > 0 ? requested : ROLE_DEFAULT_TTL_HOURS[role]
  };
}

function symbolEvidence(run, symbol) {
  const bundle = run.proposalEvidenceBundle || run.evidenceBundle || null;
  return (bundle?.symbols || []).find((row) => normalizeEvidenceSymbol(row.symbol) === symbol) || null;
}

function proposalReceiptText(run) {
  return (run.toolReceipts || []).filter((receipt) => receipt.name === "propose_trade_plan")
    .map((receipt) => JSON.stringify(receipt.result || {})).join(" ");
}

function verifyHardReason(run, related, symbol, reasonCode) {
  const structure = run.structureFacts?.[symbol];
  const triggeredDirections = new Set(related.map((watch) => watch.direction).filter((direction) => direction !== "neutral"));
  const structureDirection = structure?.bias === "LONG" ? "long" : structure?.bias === "SHORT" ? "short" : "neutral";
  if (reasonCode === "structure_conflict") {
    if (!structure?.evidenceRef) return { ok: false, error: "缺少成功的确定性结构回执，不能声称结构冲突。" };
    if (structureDirection !== "neutral" && triggeredDirections.has(structureDirection)) {
      return { ok: false, error: `确定性结构为 ${structure.bias}，与触发方向一致，不能编造“结构冲突”作为拒绝理由；应创建 armed/immediate 计划，或引用其他真实硬阻断。` };
    }
    if (structureDirection === "neutral" && structure.alignment !== "conflict") {
      return { ok: false, error: `确定性结构只是 ${structure.alignment || "无法确认"} / NEUTRAL，并未形成可验证的反向冲突；不能把“没有同向确认”编造成 structure_conflict。` };
    }
    return { ok: true };
  }
  if (reasonCode === "evidence_missing") {
    const readiness = (run.proposalEvidenceBundle || run.evidenceBundle)?.readiness?.[symbol];
    const blockers = readiness?.blockers || (run.proposalEvidenceBundle || run.evidenceBundle)?.blockers || [];
    return blockers.length
      ? { ok: true }
      : { ok: false, error: "本轮关键证据状态为齐全，不能编造 evidence_missing；请引用真实硬阻断。" };
  }
  if (reasonCode === "invalidation_hit") {
    return related.some((watch) => watch.purpose === "invalidation")
      ? { ok: true }
      : { ok: false, error: "本轮没有真实命中的 invalidation 观察哨，不能声明原判断失效。" };
  }
  if (reasonCode === "liquidity_unacceptable") {
    const micro = symbolEvidence(run, symbol)?.microstructure;
    const spreadBps = Number(micro?.data?.spreadBps);
    return micro?.status === "fresh" && micro?.quality === "passed" && Number.isFinite(spreadBps) && spreadBps >= 5
      ? { ok: true }
      : { ok: false, error: `流动性硬拒绝未通过确定性校验：需要新鲜微观证据且点差至少 5bps，当前为 ${Number.isFinite(spreadBps) ? `${spreadBps}bps` : "无法确认"}。` };
  }
  const proposalText = proposalReceiptText(run);
  if (reasonCode === "reward_risk_below_min") {
    return /(盈亏比|reward.?risk|\bRR\b|2R)/i.test(proposalText) && /(拒绝|blocked|failed|error|不通过|低于)/i.test(proposalText)
      ? { ok: true }
      : { ok: false, error: "没有交易计划工具返回的盈亏比硬拒绝回执，不能声称 reward_risk_below_min。" };
  }
  if (reasonCode === "no_valid_stop") {
    return /(止损|stop.?loss)/i.test(proposalText) && /(拒绝|blocked|failed|error|非法|不通过)/i.test(proposalText)
      ? { ok: true }
      : { ok: false, error: "没有交易计划工具返回的止损硬拒绝回执，不能声称 no_valid_stop。" };
  }
  return { ok: false, error: "无法确定性验证该拒绝原因。" };
}

export function compactTriggeredWatch(watch = {}) {
  return {
    id: String(watch.id || ""),
    symbol: normalizeEvidenceSymbol(watch.symbol),
    direction: safeDirection(watch.direction),
    purpose: String(watch.purpose || "decision"),
    kind: String(watch.kind || ""),
    level: finite(watch.level) ? Number(watch.level) : null,
    levelLow: finite(watch.levelLow) ? Number(watch.levelLow) : null,
    levelHigh: finite(watch.levelHigh) ? Number(watch.levelHigh) : null,
    triggerPrice: finite(watch.triggerPrice) ? Number(watch.triggerPrice) : null,
    thesis: String(watch.thesis || "").slice(0, 220),
    triggerMeaning: String(watch.triggerMeaning || "").slice(0, 220),
    rootWatchId: String(watch.rootWatchId || watch.id || ""),
    reviewDepth: Math.max(0, Number(watch.reviewDepth || 0)),
    lineageVersion: Math.max(1, Number(watch.lineageVersion || 1)),
    lineageStartedAt: isoTime(watch.lineageStartedAt || watch.createdAt || watch.analysisAt),
    setupType: safeSetupType(watch.setupType),
    traderRole: safeTraderRole(watch.traderRole),
    thesisFingerprint: String(watch.thesisFingerprint || "") || null,
    structureFingerprint: String(watch.structureFingerprint || "") || null,
    structureEvidenceRef: String(watch.structureEvidenceRef || "") || null,
    rearmWindowHours: Number(watch.rearmWindowHours || 0) || null,
    createdAt: isoTime(watch.createdAt),
    previousRootWatchId: String(watch.previousRootWatchId || "") || null,
    lineageResetReason: String(watch.lineageResetReason || "") || null
  };
}

function collectEvidenceIds(value, target = new Set()) {
  if (!value || typeof value !== "object") return target;
  if (typeof value.evidenceId === "string" && value.evidenceId) target.add(value.evidenceId);
  if (Array.isArray(value)) {
    for (const item of value) collectEvidenceIds(item, target);
    return target;
  }
  for (const item of Object.values(value)) collectEvidenceIds(item, target);
  return target;
}

export function availableWatchReviewEvidenceRefs(run = {}) {
  const refs = collectEvidenceIds(run.evidenceBundle || null);
  collectEvidenceIds(run.proposalEvidenceBundle || null, refs);
  if (run.evidenceBundleId) refs.add(run.evidenceBundleId);
  if (run.proposalEvidenceBundleId) refs.add(run.proposalEvidenceBundleId);
  for (const fact of Object.values(run.structureFacts || {})) {
    if (fact?.evidenceRef) refs.add(fact.evidenceRef);
  }
  return refs;
}

export function validateWatchReviewRecord(run = {}, args = {}) {
  const triggered = (run.triggeredWatches || []).map(compactTriggeredWatch).filter((watch) => watch.id && watch.symbol);
  if (run.decisionContext?.trigger !== "watch_trigger" || !triggered.length) {
    return { ok: false, error: "record_watch_review 只用于真实观察哨触发后的复核闭环。" };
  }
  const symbol = normalizeEvidenceSymbol(args.symbol);
  const related = triggered.filter((watch) => watch.symbol === symbol);
  if (!related.length) return { ok: false, error: `${symbol || "该交易对"} 不在本轮真实触发的观察哨中。` };
  const outcome = String(args.outcome || "");
  const reasonCode = String(args.reasonCode || "");
  const nextAction = String(args.nextAction || "");
  if (!OUTCOMES.has(outcome)) return { ok: false, error: "无计划时 outcome 只能是 rejected 或 invalidated。" };
  if (!REASON_CODES.has(reasonCode)) {
    return { ok: false, error: "拒绝交易必须选择系统可验证的硬原因；‘继续观察/确认不足’不能作为无限换哨的理由。" };
  }
  if (!NEXT_ACTIONS.has(nextAction)) return { ok: false, error: "nextAction 必须是 stop_monitoring / fresh_thesis / manual_review。" };
  const reason = String(args.reason || "").replace(/\s+/g, " ").trim();
  if (reason.length < 12) return { ok: false, error: "必须具体说明哪项真实证据导致拒绝，不能只写‘继续观察’。" };

  const availableRefs = availableWatchReviewEvidenceRefs(run);
  const evidenceRefs = [...new Set((args.evidenceRefs || []).map(String).filter(Boolean))];
  if (!evidenceRefs.length) return { ok: false, error: "拒绝结论必须引用本轮真实证据 ID 或确定性结构证据。" };
  const invalidRefs = evidenceRefs.filter((ref) => !availableRefs.has(ref));
  if (invalidRefs.length) return { ok: false, error: `包含无法核验的证据引用：${invalidRefs.join("、")}` };

  const hardReason = verifyHardReason(run, related, symbol, reasonCode);
  if (!hardReason.ok) return hardReason;
  if (outcome === "invalidated" && reasonCode !== "invalidation_hit") {
    return { ok: false, error: "判断失效必须由 invalidation_hit 的真实证据支持。" };
  }

  return {
    ok: true,
    review: {
      version: 1,
      symbol,
      watchIds: related.map((watch) => watch.id),
      outcome,
      reasonCode,
      reason: reason.slice(0, 500),
      evidenceRefs: evidenceRefs.slice(0, 8),
      nextAction,
      recordedAt: new Date().toISOString(),
      verified: true
    }
  };
}

function successfulProposal(run = {}, toolTrace = [], symbol = null) {
  const wanted = normalizeEvidenceSymbol(symbol);
  return (toolTrace || []).some((trace) => trace.name === "propose_trade_plan"
    && (!wanted || normalizeEvidenceSymbol(trace.args?.symbol) === wanted)
    && !/^(?:失败|阻断|拒绝)[:：]|blocked|failed/i.test(String(trace.summary || "")))
    || (Boolean(run.tradePlanId) && (!wanted || normalizeEvidenceSymbol(run.tradePlanSymbol) === wanted));
}

export function evaluateWatchReviewClosure(run = {}, toolTrace = []) {
  if (run.decisionContext?.trigger !== "watch_trigger" || !(run.triggeredWatches || []).length) {
    return { applicable: false, ok: true, outcome: "not_applicable" };
  }
  const symbols = [...new Set((run.triggeredWatches || []).map((watch) => normalizeEvidenceSymbol(watch.symbol)).filter(Boolean))];
  const unresolved = symbols.filter((symbol) => {
    const review = run.watchReviews?.[symbol] || (run.watchReview?.symbol === symbol ? run.watchReview : null);
    return !successfulProposal(run, toolTrace, symbol) && review?.verified !== true;
  });
  if (!unresolved.length) {
    const hasPlan = symbols.some((symbol) => successfulProposal(run, toolTrace, symbol));
    return { applicable: true, ok: true, outcome: hasPlan ? "plan_or_verified_review" : "verified_review", symbols };
  }
  return {
    applicable: true,
    ok: false,
    outcome: "unclosed",
    unresolvedSymbols: unresolved,
    reason: `${unresolved.join("、")} 的观察哨复核既没有真实交易计划，也没有经证据验证的拒绝/失效结论`
  };
}

export function watchReviewCorrectionInstruction(run = {}, toolTrace = []) {
  const closure = evaluateWatchReviewClosure(run, toolTrace);
  if (!closure.applicable || closure.ok) return null;
  return [
    "【系统闭环校验未通过】你正在处理真实观察哨触发，但尚未完成可审计决策。不要直接结束回答，也不要再用普通 register_watch 等待同一入场确认。",
    "必须二选一：",
    "1. 结构与方向成立、只是等待回踩/吞没/影线/放量/收盘确认：调用 propose_trade_plan，executionMode=armed，并把确认写入 triggerConfirmations/scenarioStages。",
    "2. 确实不能交易：调用 record_watch_review，选择可验证的硬原因并引用本轮真实 evidence ID；‘还需确认/继续观察’不是硬原因。",
    "完成工具调用后再给最终结论。"
  ].join("\n");
}

function watchLineageDraftKey(args = {}) {
  return [
    normalizeEvidenceSymbol(args.symbol),
    safeDirection(args.direction),
    safeSetupType(args.setupType) || "missing",
    safeTraderRole(args.traderRole) || "missing"
  ].join("|");
}

function watchIdentityContext(run = {}, args = {}) {
  const symbol = normalizeEvidenceSymbol(args.symbol);
  const setupType = safeSetupType(args.setupType);
  const traderRole = safeTraderRole(args.traderRole);
  if (!setupType) return { ok: false, error: "观察哨必须声明受支持的 setupType，不能靠改写文案冒充全新判断。" };
  if (!traderRole) return { ok: false, error: "观察哨必须声明 traderRole（day_trader / swing_trader），用于确定判断链时间窗口。" };
  const ttl = watchRoleTtl(args, traderRole);
  if (!ttl.ok) return ttl;
  const structure = run.structureFacts?.[symbol] || null;
  if (structure?.selectedRole && structure.selectedRole !== traderRole) {
    return {
      ok: false,
      error: `本轮确定性结构证据属于 ${structure.selectedRole}，不能据此登记 ${traderRole} 观察哨；请用 analyze_market_structure(traderRole=${traderRole}) 重新计算对应周期。`
    };
  }
  const structureFingerprint = deterministicWatchStructureFingerprint(structure, traderRole);
  return {
    ok: true,
    symbol,
    setupType,
    traderRole,
    ttlHours: ttl.ttlHours,
    structure,
    structureFingerprint,
    structureEvidenceRef: structure?.evidenceRef || null,
    thesisFingerprint: watchThesisFingerprint({
      symbol,
      direction: args.direction,
      setupType,
      traderRole,
      structureFingerprint
    })
  };
}

function newRootLineage(run, identity, details = {}) {
  const startedAt = isoTime(run.createdAt) || new Date().toISOString();
  return {
    lineageVersion: WATCH_LINEAGE_VERSION,
    reviewOfWatchIds: details.reviewOfWatchIds || [],
    parentWatchId: details.parentWatchId || null,
    rootWatchId: null,
    previousRootWatchId: details.previousRootWatchId || null,
    reviewDepth: 0,
    reviewReasonCode: details.reviewReasonCode || null,
    setupType: identity.setupType,
    traderRole: identity.traderRole,
    thesisFingerprint: identity.thesisFingerprint,
    structureFingerprint: identity.structureFingerprint,
    structureEvidenceRef: identity.structureEvidenceRef,
    lineageStartedAt: startedAt,
    lineageResetReason: details.lineageResetReason || null,
    lineageResetEvidenceRef: details.lineageResetEvidenceRef || null,
    rearmWindowHours: watchWindowHours(identity.traderRole),
    ttlHours: identity.ttlHours
  };
}

export function nextWatchLineage(run = {}, args = {}) {
  const identity = watchIdentityContext(run, args);
  if (!identity.ok) return identity;
  const draft = run.watchLineageDrafts?.[watchLineageDraftKey(args)];
  if (draft) return { ok: true, lineage: { ...draft, ttlHours: identity.ttlHours }, reset: Boolean(draft.lineageResetReason) };

  const related = (run.triggeredWatches || []).map(compactTriggeredWatch)
    .filter((watch) => watch.symbol === identity.symbol);
  if (!related.length) return { ok: true, lineage: newRootLineage(run, identity), reset: true };
  const sameDirection = related.filter((watch) => watch.direction === safeDirection(args.direction));
  const candidates = sameDirection.length ? sameDirection : related;
  const parent = [...candidates].sort((left, right) => Number(right.reviewDepth || 0) - Number(left.reviewDepth || 0))[0];
  const review = run.watchReviews?.[identity.symbol] || run.watchReview || null;
  const windowHours = watchWindowHours(parent.traderRole || identity.traderRole);
  const startedAt = isoTime(parent.lineageStartedAt || parent.createdAt);
  const nowMs = new Date(run.createdAt || Date.now()).getTime();
  const windowExpired = Boolean(startedAt) && Number.isFinite(nowMs)
    && nowMs - new Date(startedAt).getTime() >= windowHours * 3_600_000;
  const structureChanged = Boolean(parent.structureFingerprint && identity.structureFingerprint
    && parent.structureFingerprint !== identity.structureFingerprint
    && parent.structureEvidenceRef !== identity.structureEvidenceRef);
  const resetReason = !sameDirection.length ? "direction_changed"
    : windowExpired ? "rearm_window_elapsed"
    : structureChanged ? "deterministic_structure_changed"
    : null;

  if (resetReason) {
    return {
      ok: true,
      reset: true,
      lineage: newRootLineage(run, identity, {
        reviewOfWatchIds: related.map((watch) => watch.id),
        parentWatchId: parent.id,
        previousRootWatchId: parent.rootWatchId || parent.id,
        reviewReasonCode: review?.reasonCode || null,
        lineageResetReason: resetReason,
        lineageResetEvidenceRef: resetReason === "deterministic_structure_changed" ? identity.structureEvidenceRef : null
      })
    };
  }

  const depth = Math.max(...sameDirection.map((watch) => Number(watch.reviewDepth || 0))) + 1;
  return {
    ok: true,
    reset: false,
    lineage: {
      lineageVersion: WATCH_LINEAGE_VERSION,
      reviewOfWatchIds: related.map((watch) => watch.id),
      parentWatchId: parent.id,
      rootWatchId: parent.rootWatchId || parent.id,
      previousRootWatchId: null,
      reviewDepth: depth,
      reviewReasonCode: review?.reasonCode || null,
      setupType: identity.setupType,
      traderRole: identity.traderRole,
      // setupType 或措辞变化本身不能重置判断链；没有确定性结构变化时沿用旧指纹。
      thesisFingerprint: parent.thesisFingerprint || identity.thesisFingerprint,
      structureFingerprint: identity.structureFingerprint || parent.structureFingerprint || null,
      structureEvidenceRef: identity.structureEvidenceRef || parent.structureEvidenceRef || null,
      lineageStartedAt: startedAt || isoTime(run.createdAt) || new Date().toISOString(),
      lineageResetReason: null,
      lineageResetEvidenceRef: null,
      rearmWindowHours: windowHours,
      ttlHours: identity.ttlHours
    }
  };
}

export function rememberRegisteredWatchLineage(run = {}, watch = {}) {
  if (!run || !watch?.symbol) return;
  run.watchLineageDrafts ||= {};
  run.watchLineageDrafts[watchLineageDraftKey(watch)] = {
    lineageVersion: Number(watch.lineageVersion || WATCH_LINEAGE_VERSION),
    reviewOfWatchIds: [...(watch.reviewOfWatchIds || [])],
    parentWatchId: watch.parentWatchId || null,
    rootWatchId: watch.rootWatchId || watch.id,
    previousRootWatchId: watch.previousRootWatchId || null,
    reviewDepth: Number(watch.reviewDepth || 0),
    reviewReasonCode: watch.reviewReasonCode || null,
    setupType: watch.setupType || null,
    traderRole: watch.traderRole || null,
    thesisFingerprint: watch.thesisFingerprint || null,
    structureFingerprint: watch.structureFingerprint || null,
    structureEvidenceRef: watch.structureEvidenceRef || null,
    lineageStartedAt: watch.lineageStartedAt || watch.createdAt || null,
    lineageResetReason: watch.lineageResetReason || null,
    lineageResetEvidenceRef: watch.lineageResetEvidenceRef || null,
    rearmWindowHours: Number(watch.rearmWindowHours || 0) || null
  };
}

export function canRegisterWatchAfterTrigger(run = {}, args = {}) {
  const lineageCheck = nextWatchLineage(run, args);
  if (!lineageCheck.ok) return lineageCheck;
  if (run.decisionContext?.trigger !== "watch_trigger" || !(run.triggeredWatches || []).length) {
    return { ok: true, lineage: lineageCheck.lineage };
  }
  const symbol = normalizeEvidenceSymbol(args.symbol);
  const related = (run.triggeredWatches || []).filter((watch) => normalizeEvidenceSymbol(watch.symbol) === symbol);
  if (!related.length) return { ok: true, lineage: lineageCheck.lineage };
  const review = run.watchReviews?.[symbol] || (run.watchReview?.symbol === symbol ? run.watchReview : null);
  if (!review?.verified) {
    return { ok: false, error: "观察哨触发后的复核必须先创建交易计划，或先调用 record_watch_review 记录经证据验证的拒绝/失效原因；不能直接换一个观察哨。" };
  }
  if (review.nextAction !== "fresh_thesis") {
    return { ok: false, error: `本轮复核动作是 ${review.nextAction}，不能同时再登记新观察哨。` };
  }
  const lineage = lineageCheck.lineage;
  // purpose 只是观察哨在本轮分析中的职责，不是新的交易假设。把哨改标成
  // alternative / invalidation 也必须受同一条判断链上限约束，否则模型可换标签绕过。
  if (lineage?.reviewDepth > WATCH_REVIEW_MAX_REARMS) {
    return { ok: false, error: `同一判断链已连续改写 ${lineage.reviewDepth - 1} 次，达到防循环上限；必须创建 armed 计划、停止监控或转人工复核。单纯改价格、改文案、改 purpose 或改 setupType 不能重置；只有判断窗口届满、方向改变，或带新证据 ID 的确定性结构实质变化才会开启新链。` };
  }
  return { ok: true, lineage, reset: lineageCheck.reset };
}
