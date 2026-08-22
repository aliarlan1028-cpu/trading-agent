import crypto from "node:crypto";
import { appendAudit, id, nowIso } from "./store.mjs";
import { isFinanciallyReconciledLifecycle, resolveTradeContext } from "./tradeReviewQueue.mjs";
import { groupSystemClosedTradeLifecycles } from "./systemTradeProjection.mjs";
import { validatePublishedStrategyCandidate } from "./strategyStudio.mjs";

const FACT_SCHEMA_VERSION = 1;
const ASSESSMENT_SCHEMA_VERSION = 1;
const ACTIONABLE_ROOTS = new Set([
  "data_quality", "model_reasoning", "strategy_regime", "entry_timing",
  "risk_sizing", "execution_quality", "exit_discipline", "opportunity_detection", "plan_policy_mismatch", "system_control_failure"
]);

const ROOT_META = {
  data_quality: { label: "决策事实或数据质量", category: "data", destination: "system", severity: "high" },
  model_reasoning: { label: "模型推理与证据使用", category: "decision", destination: "agent", severity: "high" },
  strategy_regime: { label: "策略与市场环境不匹配", category: "strategy", destination: "strategy", severity: "medium" },
  entry_timing: { label: "入场时机或确认不足", category: "strategy", destination: "strategy", severity: "medium" },
  risk_sizing: { label: "风险预算或仓位设计", category: "risk", destination: "risk", severity: "high" },
  execution_quality: { label: "成交与执行质量", category: "execution", destination: "system", severity: "high" },
  exit_discipline: { label: "退出纪律与利润保护", category: "strategy", destination: "strategy", severity: "medium" },
  opportunity_detection: { label: "机会扫描与覆盖缺口", category: "detection", destination: "system", severity: "medium" },
  plan_policy_mismatch: { label: "计划生成与授权/硬风控不匹配", category: "decision", destination: "agent", severity: "medium" },
  market_shock: { label: "不可预见的市场冲击", category: "market", destination: "observation", severity: "medium" },
  random_variance: { label: "正常交易方差", category: "variance", destination: "observation", severity: "low" },
  system_control_failure: { label: "系统控制或安全链路异常", category: "system", destination: "system", severity: "critical" },
  unknown: { label: "证据不足，暂不归因", category: "unknown", destination: "observation", severity: "low" }
};

function finite(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function compact(value, max = 320) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function clone(value) {
  if (value === undefined) return null;
  return structuredClone(value);
}

export function isOwnerReviewRow(db, row = {}) {
  const owner = db.user || (db.users || []).find((user) => user.isOwner === true) || {};
  if (!owner.id && !owner.tenantId) {
    return !row.tenantId && !row.ownerTenantId && !row.ownerUserId && !row.createdByUserId && !row.userId;
  }
  const ownerTenantId = owner.tenantId || "tenant_owner";
  const rowTenantId = row.tenantId || row.ownerTenantId || null;
  if (!rowTenantId || rowTenantId !== ownerTenantId) return false;
  const ownerUserId = owner.id || null;
  const rowUserId = row.ownerUserId || row.createdByUserId || row.userId || null;
  if (ownerUserId && (!rowUserId || rowUserId !== ownerUserId)) return false;
  return true;
}

export function migrateLegacyOwnerReviewProvenance(db) {
  const owner = db.user || (db.users || []).find((user) => user.isOwner === true) || null;
  if (!owner) return { updated: 0 };
  db.system ||= {};
  if (Number(db.system.ownerReviewProvenanceMigrationVersion || 0) >= 1) {
    return { updated: 0, alreadyApplied: true, version: 1 };
  }
  const tenantId = owner.tenantId || "tenant_owner";
  const ownerUserId = owner.id || null;
  const collections = [
    "fills", "reviews", "memoryItems", "executionOrders", "riskIncidents",
    "tradePlans", "riskChecks", "missedOpportunities", "ownerImprovementItems", "strategyExperiments",
    "strategyBlueprintVersions", "strategyStudioDrafts", "strategyStudioBacktests", "paperSessions"
  ];
  let updated = 0;
  const migratedAt = nowIso();
  for (const collection of collections) {
    for (const row of db[collection] || []) {
      if (!row || typeof row !== "object") continue;
      const hasTenant = Boolean(row.tenantId || row.ownerTenantId);
      const hasUser = Boolean(row.ownerUserId || row.createdByUserId || row.userId);
      // Any existing identity is authoritative. Never relabel a partially or fully
      // tagged foreign row as Owner merely because another field is absent.
      if (hasTenant || hasUser) continue;
      row.tenantId = tenantId;
      row.ownerUserId = ownerUserId;
      row.ownerScopeMigration = { source: "legacy_single_owner_instance", at: migratedAt };
      updated += 1;
    }
  }
  db.system.ownerReviewProvenanceMigrationVersion = 1;
  db.system.ownerReviewProvenanceMigrationAt = migratedAt;
  return { updated, alreadyApplied: false, version: 1 };
}

function canonicalValue(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonicalValue(value[key])]));
}

export function ownerReviewHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex");
}

function decisionPayload(snapshot = {}) {
  const { payloadHash: _payloadHash, integrity: _integrity, ...payload } = snapshot;
  return payload;
}

function compactProvenance(plan = {}) {
  const provenance = plan.decisionProvenance || {};
  return {
    primary: provenance.primary ? {
      gateway: provenance.primary.gateway || null,
      requestedModel: provenance.primary.requestedModel || null,
      actualModel: provenance.primary.actualModel || null,
      actualProvider: provenance.primary.actualProvider || null,
      providerAttributionVerified: provenance.primary.providerAttributionVerified === true,
      reasoningEffort: provenance.primary.reasoningEffort || null
    } : null,
    critic: provenance.critic ? {
      gateway: provenance.critic.gateway || null,
      actualModel: provenance.critic.actualModel || null,
      actualProvider: provenance.critic.actualProvider || null,
      approved: provenance.critic.approved === true,
      schemaValid: provenance.critic.schemaValid === true,
      confidence: finite(provenance.critic.confidence) ? Number(provenance.critic.confidence) : null,
      severity: provenance.critic.severity || null,
      objections: Array.isArray(provenance.critic.objections) ? provenance.critic.objections.slice(0, 12).map((row) => compact(row, 200)) : []
    } : null,
    prompt: provenance.prompt ? { version: provenance.prompt.version || null, hash: provenance.prompt.hash || null } : null,
    toolSchema: provenance.toolSchema ? { version: provenance.toolSchema.version || null, hash: provenance.toolSchema.hash || null } : null,
    evidence: provenance.evidence ? { bundleId: provenance.evidence.bundleId || null, hash: provenance.evidence.hash || null } : null,
    auditChain: provenance.auditChain ? { recordId: provenance.auditChain.recordId || null, rootHash: provenance.auditChain.rootHash || null } : null,
    cohort: provenance.cohort ? { id: provenance.cohort.id || null } : null
  };
}

function relevantMandate(db, plan = {}) {
  const mandate = (db.mandates || []).find((row) => row.id === plan.mandateId) || null;
  if (!mandate) return null;
  return {
    id: mandate.id,
    version: mandate.version || null,
    allowedSymbols: clone(mandate.allowedSymbols || mandate.symbol_whitelist || []),
    maxSingleTradeRiskPct: mandate.maxSingleTradeRiskPct ?? mandate.max_single_trade_risk_pct ?? null,
    maxDailyLossPct: mandate.maxDailyLossPct ?? mandate.max_daily_loss_pct ?? null,
    maxWeeklyLossPct: mandate.maxWeeklyLossPct ?? mandate.max_weekly_loss_pct ?? null,
    maxNotionalUsdt: mandate.max_notional_usdt ?? null,
    maxLeverageBySymbol: clone(mandate.maxLeverageBySymbol || {})
  };
}

function buildDecisionFactSnapshot(db, plan, options = {}) {
  const capturedAt = options.capturedAt || nowIso();
  const appliedLessons = plan.reviewLearning?.applied || plan.appliedReviewLessons || [];
  const snapshot = {
    id: options.id || id("decision_fact"),
    schemaVersion: FACT_SCHEMA_VERSION,
    planId: plan.id,
    captureMode: options.captureMode || "plan_created_pre_approval",
    capturedAt,
    capturedBeforeExecution: options.capturedBeforeExecution !== false,
    decision: {
      symbol: plan.symbol || null,
      direction: plan.direction || null,
      timeframe: plan.timeframe || plan.strategyInstance?.timeframe || null,
      entry: clone(plan.entry ?? plan.entryPrice ?? null),
      stopLoss: plan.stopLoss ?? plan.stop_loss ?? null,
      takeProfit: clone(plan.takeProfit || plan.take_profit || []),
      leverage: plan.leverage ?? null,
      notionalUsdt: plan.notionalUsdt ?? plan.notional ?? null,
      riskAmountUsdt: plan.riskAmountUsdt ?? plan.maxLossUsdt ?? null,
      rationale: compact(plan.rationale || plan.reasoningSummary || plan.reason || plan.analysis, 1600),
      scenarioType: plan.scenarioType || plan.decisionContext?.setupType || null,
      invalidation: compact(plan.invalidation || plan.invalidationCondition || plan.decisionContext?.invalidation, 800)
    },
    strategy: {
      strategy: plan.strategy || plan.strategy_type || null,
      productId: plan.strategyProductId || plan.strategyRef?.productId || null,
      version: plan.strategyVersion || plan.strategyRef?.version || null,
      versionId: plan.strategyVersionId || plan.strategyRef?.versionId || null,
      definitionHash: plan.strategyRef?.definitionHash || null,
      blueprintRef: clone(plan.strategyBlueprintRef || null)
    },
    evidence: {
      analysisBundleId: plan.analysisBundleId || null,
      evidenceBundleId: plan.evidenceBundleId || plan.decisionProvenance?.evidence?.bundleId || null,
      evidenceHash: plan.decisionProvenance?.evidence?.hash || null,
      decisionContext: clone(plan.decisionContext || null),
      newsEvidence: clone(plan.newsEvidence || []),
      capabilityCoverage: clone(plan.capabilityCoverage || plan.visibleCapabilityCoverage || null)
    },
    reviewLearning: {
      applied: clone(appliedLessons.slice(0, 12)),
      retrievedIds: clone((plan.reviewLearning?.retrieved || []).map((row) => row.id || row.memoryId).filter(Boolean).slice(0, 20))
    },
    risk: {
      mandate: relevantMandate(db, plan),
      riskCheck: plan.lastRiskCheck ? {
        id: plan.lastRiskCheck.id || plan.riskCheckId || null,
        passed: plan.lastRiskCheck.passed === true,
        decision: plan.lastRiskCheck.decision || null,
        summary: compact(plan.lastRiskCheck.summary || plan.lastRiskCheck.reason, 600)
      } : null,
      requestedOperatingMode: db.system?.requestedOperatingMode || null
    },
    model: compactProvenance(plan),
    source: {
      planSource: plan.source || options.source || null,
      agentRunId: plan.agentRunId || options.agentRunId || null,
      release: process.env.RELEASE_ID || process.env.GIT_SHA || null,
      tenantId: plan.tenantId || db.user?.tenantId || "tenant_owner",
      ownerUserId: plan.ownerUserId || plan.createdByUserId || plan.userId || db.user?.id || null
    }
  };
  snapshot.payloadHash = ownerReviewHash(decisionPayload(snapshot));
  return snapshot;
}

export function verifyDecisionFactSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return { ok: false, reason: "decision_fact_snapshot_missing" };
  if (snapshot.schemaVersion !== FACT_SCHEMA_VERSION || !snapshot.id || !snapshot.planId || !snapshot.payloadHash) {
    return { ok: false, reason: "decision_fact_snapshot_incomplete" };
  }
  const calculatedHash = ownerReviewHash(decisionPayload(snapshot));
  if (calculatedHash !== snapshot.payloadHash) return { ok: false, reason: "decision_fact_snapshot_hash_mismatch", calculatedHash };
  return { ok: true, reason: "verified", calculatedHash };
}

function planBindingPayload(snapshot = {}) {
  return {
    decision: snapshot.decision || null,
    strategy: snapshot.strategy || null,
    evidence: snapshot.evidence || null,
    reviewLearning: snapshot.reviewLearning || null,
    model: snapshot.model || null,
    source: snapshot.source ? {
      planSource: snapshot.source.planSource || null,
      agentRunId: snapshot.source.agentRunId || null,
      tenantId: snapshot.source.tenantId || null,
      ownerUserId: snapshot.source.ownerUserId || null
    } : null
  };
}

function verifySnapshotMatchesPlan(db, snapshot, plan) {
  const rebuilt = buildDecisionFactSnapshot(db, plan, {
    id: snapshot.id,
    capturedAt: snapshot.capturedAt,
    captureMode: snapshot.captureMode,
    capturedBeforeExecution: snapshot.capturedBeforeExecution,
    source: snapshot.source?.planSource,
    agentRunId: snapshot.source?.agentRunId
  });
  const frozenHash = ownerReviewHash(planBindingPayload(snapshot));
  const currentHash = ownerReviewHash(planBindingPayload(rebuilt));
  if (frozenHash !== currentHash) {
    return { ok: false, reason: "decision_fact_snapshot_plan_mismatch", frozenHash, currentHash };
  }
  return { ok: true };
}

export function ensureDecisionFactSnapshot(db, plan, options = {}) {
  if (!plan?.id) return { ok: false, created: false, reason: "trade_plan_id_required", snapshot: null };
  db.decisionFactSnapshots ||= [];
  const matches = db.decisionFactSnapshots.filter((row) => row.planId === plan.id);
  if (matches.length > 1) return { ok: false, created: false, reason: "decision_fact_snapshot_ambiguous", snapshot: null };
  const existing = matches[0];
  if (existing) {
    const verification = verifyDecisionFactSnapshot(existing);
    if (!verification.ok) return { ...verification, created: false, snapshot: existing };
    const reference = plan.decisionFactSnapshotRef;
    if (reference && (reference.id !== existing.id || reference.hash !== existing.payloadHash || Number(reference.schemaVersion) !== Number(existing.schemaVersion))) {
      return { ok: false, created: false, reason: "decision_fact_snapshot_reference_mismatch", snapshot: existing };
    }
    const binding = verifySnapshotMatchesPlan(db, existing, plan);
    if (!binding.ok) return { ...binding, created: false, snapshot: existing };
    if (!reference) plan.decisionFactSnapshotRef = { id: existing.id, hash: existing.payloadHash, schemaVersion: existing.schemaVersion };
    return { ...verification, created: false, snapshot: existing };
  }
  // 已经持有引用却找不到事实包，说明持久化记录被删除或损坏。执行入口不得把它
  // 当成“旧计划”重新冻结，否则会用事后状态覆盖原始决策事实并掩盖审计缺口。
  if (plan.decisionFactSnapshotRef) {
    return { ok: false, created: false, reason: "decision_fact_snapshot_missing", snapshot: null };
  }
  const snapshot = buildDecisionFactSnapshot(db, plan, options);
  db.decisionFactSnapshots.unshift(snapshot);
  plan.decisionFactSnapshotRef = { id: snapshot.id, hash: snapshot.payloadHash, schemaVersion: snapshot.schemaVersion };
  return { ok: true, created: true, reason: "captured", snapshot };
}

function axis(key, label, status, score, evidence) {
  return { key, label, status, score: score == null ? null : Number(score), evidence: compact(evidence, 360) };
}

function rootCause(code, confidence, evidence) {
  const meta = ROOT_META[code] || ROOT_META.unknown;
  return { code, ...meta, confidence: Number(confidence.toFixed(2)), evidence: compact(evidence, 480) };
}

function matrixLabel(process, outcome) {
  const table = {
    good_win: "过程正确，结果盈利",
    good_loss: "过程正确，结果亏损（正常方差）",
    good_flat: "过程正确，结果持平",
    mixed_win: "过程有缺口，但结果盈利",
    mixed_loss: "过程有缺口，结果亏损",
    mixed_flat: "过程有缺口，结果持平",
    poor_win: "过程错误但侥幸盈利",
    poor_loss: "过程错误且结果亏损",
    poor_flat: "过程错误，结果持平",
    unknown_win: "证据不足，结果盈利",
    unknown_loss: "证据不足，结果亏损",
    unknown_flat: "证据不足，结果持平"
  };
  return table[`${process}_${outcome}`] || "证据不足，暂不下结论";
}

function isHighImpactRecord(record = {}) {
  const values = record.values || {};
  const materiality = String(record.materiality || values.materiality || record.importance || values.importance || "").toLowerCase();
  const impact = Number(record.impact ?? values.impact);
  return materiality === "high" || materiality === "高" || (Number.isFinite(impact) && impact >= 80);
}

function isShortImpactHorizon(record = {}) {
  const values = record.values || {};
  const horizon = String(record.impactHorizon || values.impactHorizon || record.intel?.impactHorizon || "").toLowerCase();
  return ["immediate", "hours", "即时", "数小时"].includes(horizon);
}

function eventShockForTrade(db, fill = {}, options = {}) {
  const base = String(fill.symbol || "").split(/[/-]/)[0].toUpperCase();
  const closeAt = new Date(fill.createdAt || 0).getTime();
  const context = options.newsContext;
  if (context?.source === "stored_market_intelligence"
    && Array.isArray(context.factIds)
    && context.factIds.length > 0
    && Number.isFinite(closeAt)) {
    const stored = new Map((db.marketIntelligenceFacts || []).map((fact) => [String(fact.id || fact.factId || ""), fact]));
    const authoritativeFacts = context.factIds.map((factId) => stored.get(String(factId)));
    const valid = authoritativeFacts.every((fact) => {
      if (!fact) return false;
      const values = fact.values || {};
      const at = new Date(fact.publishedAt || fact.observedAt || fact.createdAt || 0).getTime();
      const verified = fact.verifiedOrigin === true || values.verifiedOrigin === true;
      const trustTier = String(fact.trustTier || values.trustTier || "");
      const trusted = trustTier === "verified_official" || trustTier === "verified_publisher";
      const affected = fact.affectedSymbols || fact.symbols || [];
      return Number.isFinite(at) && at <= closeAt && closeAt - at <= 12 * 3_600_000
        && verified && trusted && values.aggregator !== true
        && (fact.fakeRisk || values.fakeRisk) !== "high"
        && affected.some((symbol) => String(symbol || "").toUpperCase().replace(/-SWAP$/, "").split(/[\/_-]/)[0] === base);
    });
    if (valid && authoritativeFacts.some((fact) => isHighImpactRecord(fact) && isShortImpactHorizon(fact))) return true;
  }
  return (db.events || []).some((event) => {
    const at = new Date(event.timeline?.[0]?.at || event.due || event.publishedAt || event.createdAt || 0).getTime();
    if (!Number.isFinite(at) || !Number.isFinite(closeAt) || at > closeAt || closeAt - at > 12 * 3_600_000) return false;
    const intel = event.intel || {};
    if (intel.verifiedOrigin !== true || event.provenance?.verifiedOrigin === false) return false;
    if (intel.fakeRisk === "high" || Number(intel.credibility || 0) < 0.7) return false;
    if (!isHighImpactRecord({ ...event, ...intel }) || !isShortImpactHorizon({ ...event, ...intel, intel })) return false;
    return (intel.affectedSymbols || event.affectedSymbols || []).some((symbol) => String(symbol || "").toUpperCase().replace(/-SWAP$/, "").split(/[\/_-]/)[0] === base);
  });
}

export function buildStructuredTradeAssessment(db, lifecycle, options = {}) {
  const fill = lifecycle?.representative || options.fill || {};
  const plan = options.plan || (db.tradePlans || []).find((row) => row.id === (fill.tradePlanId || fill.planId)) || {};
  const snapshot = (db.decisionFactSnapshots || []).find((row) => row.planId === plan.id) || null;
  const snapshotVerification = verifyDecisionFactSnapshot(snapshot);
  const preTradeFactsVerified = snapshotVerification.ok
    && snapshot?.capturedBeforeExecution === true
    && snapshot?.captureMode !== "execution_preflight_legacy";
  const decision = snapshot?.decision || {};
  const pnl = finite(lifecycle?.netRealizedPnl) ? Number(lifecycle.netRealizedPnl) : null;
  const outcome = pnl == null ? "unknown" : pnl > 0 ? "win" : pnl < 0 ? "loss" : "flat";
  const rationale = decision.rationale || plan.rationale || plan.reasoningSummary || fill.entryRationale || "";
  const hasStop = finite(decision.stopLoss ?? plan.stopLoss ?? plan.stop_loss);
  const riskCheckId = fill.riskCheckId || plan.riskCheckId || plan.lastRiskCheck?.id || snapshot?.risk?.riskCheck?.id || null;
  const storedRiskCheck = riskCheckId ? (db.riskChecks || []).find((row) => row.id === riskCheckId) : null;
  const subjectTenantId = plan.tenantId || fill.tenantId || null;
  const subjectUserId = plan.ownerUserId || fill.ownerUserId || fill.userId || null;
  const riskOwnershipMatches = Boolean(storedRiskCheck)
    && Boolean(subjectTenantId && subjectUserId)
    && storedRiskCheck.tenantId === subjectTenantId
    && storedRiskCheck.ownerUserId === subjectUserId
    && String(storedRiskCheck.tradePlanId || storedRiskCheck.planId || "") === String(plan.id || "");
  const riskObserved = Boolean(storedRiskCheck);
  const riskPassed = riskOwnershipMatches && storedRiskCheck.passed === true;
  const riskMismatched = riskObserved && !riskOwnershipMatches;
  const slippage = finite(fill.slippageBps) ? Math.abs(Number(fill.slippageBps)) : null;
  const trajectory = options.trajectory || fill.trajectory || null;
  const axes = [];
  axes.push(preTradeFactsVerified
    ? axis("facts", "决策事实完整性", "good", 100, `决策事实包 ${snapshot.id} 哈希已验证`)
    : axis("facts", "决策事实完整性", "unknown", null, snapshotVerification.ok ? "旧计划只在执行入口冻结，无法证明审批前未被改写" : snapshotVerification.reason));
  axes.push(rationale.length >= 20
    ? axis("thesis", "交易假设与证据", "good", 85, rationale)
    : rationale ? axis("thesis", "交易假设与证据", "problem", 40, "入场理由过短，无法验证假设")
      : axis("thesis", "交易假设与证据", "unknown", null, "没有可还原的入场理由"));
  axes.push(hasStop && riskPassed
    ? axis("risk", "风险与仓位设计", "good", 100, "止损存在且权威风险检查明确通过")
    : !hasStop ? axis("risk", "风险与仓位设计", "problem", 0, "缺少可核验止损")
      : riskMismatched ? axis("risk", "风险与仓位设计", "problem", 0, "风险检查不属于当前交易计划")
        : riskObserved ? axis("risk", "风险与仓位设计", "problem", 0, "权威风险检查存在但未明确通过")
        : axis("risk", "风险与仓位设计", "unknown", null, "存在止损，但缺少风险检查事实"));
  axes.push(slippage == null
    ? axis("execution", "成交执行质量", "unknown", null, "没有可靠滑点数据")
    : slippage >= 15 ? axis("execution", "成交执行质量", "problem", Math.max(0, 100 - slippage * 4), `绝对滑点 ${slippage.toFixed(1)}bps`)
      : axis("execution", "成交执行质量", "good", slippage <= 8 ? 100 : 75, `绝对滑点 ${slippage.toFixed(1)}bps`));
  axes.push(!trajectory
    ? axis("exit", "退出纪律", "unknown", null, "持仓轨迹尚未回补")
    : Number(trajectory.reachedTpPct) >= 70 && Number(trajectory.gaveBackFromPeak) >= 60
      ? axis("exit", "退出纪律", "problem", 35, `曾到达止盈距离 ${trajectory.reachedTpPct}%，随后回吐 ${trajectory.gaveBackFromPeak}%`)
      : axis("exit", "退出纪律", "good", 85, trajectory.note || "退出未出现明显纪律问题"));

  const knownAxes = axes.filter((row) => finite(row.score));
  const requiredProcessFactsMissing = axes.some((row) => ["facts", "thesis", "risk"].includes(row.key) && row.status === "unknown");
  const processScore = !requiredProcessFactsMissing && knownAxes.length
    ? Number((knownAxes.reduce((sum, row) => sum + row.score, 0) / knownAxes.length).toFixed(1))
    : null;
  const process = requiredProcessFactsMissing || processScore == null ? "unknown" : processScore >= 80 ? "good" : processScore < 55 ? "poor" : "mixed";
  const roots = [];
  if (!preTradeFactsVerified) roots.push(rootCause("data_quality", 0.95, `无法验证原始决策事实：${snapshotVerification.ok ? snapshot.captureMode : snapshotVerification.reason}`));
  if (!hasStop) roots.push(rootCause("risk_sizing", 0.98, "交易事实中没有可核验止损"));
  else if (riskMismatched) roots.push(rootCause("risk_sizing", 0.99, "风险检查 ID 指向其他交易计划，不能作为当前计划通过证据"));
  else if (riskObserved && !riskPassed) roots.push(rootCause("risk_sizing", 0.98, "风险检查未通过，不能把检查 ID 当作通过证据"));
  if (slippage != null && slippage >= 15) roots.push(rootCause("execution_quality", Math.min(0.98, 0.72 + slippage / 100), `绝对滑点 ${slippage.toFixed(1)}bps`));
  if (trajectory && Number(trajectory.reachedTpPct) >= 70 && Number(trajectory.gaveBackFromPeak) >= 60) {
    roots.push(rootCause("exit_discipline", 0.88, `较大浮盈回吐：到达 TP 距离 ${trajectory.reachedTpPct}% 后回吐 ${trajectory.gaveBackFromPeak}%`));
  }
  const marketShock = eventShockForTrade(db, fill, options);
  if (outcome === "loss" && marketShock) roots.push(rootCause("market_shock", 0.8, "交易时间窗存在已核验的高影响突发事件"));
  if (outcome === "loss" && trajectory?.firstLegFav === false && !roots.some((row) => ["market_shock", "execution_quality"].includes(row.code))) {
    roots.push(rootCause("entry_timing", 0.78, "开仓后先逆行，入场确认或时机需要复核"));
  }
  if (outcome === "loss" && process === "good" && !roots.length) roots.push(rootCause("random_variance", 0.72, "交易前流程与执行未发现明确违规，单笔亏损不能证明策略错误"));
  if (outcome === "loss" && !roots.length) roots.push(rootCause("strategy_regime", 0.58, "当前证据未发现执行或突发事件问题，需要在同策略同环境样本中继续验证"));
  if (outcome === "win" && process === "poor" && !roots.length) roots.push(rootCause("model_reasoning", 0.72, "结果盈利但过程评分不合格，不能把偶然盈利当作正确方法"));
  if (!roots.length && process === "unknown") roots.push(rootCause("unknown", 0.9, "可核验过程事实不足"));
  roots.sort((a, b) => b.confidence - a.confidence);
  return {
    schemaVersion: ASSESSMENT_SCHEMA_VERSION,
    generatedAt: nowIso(),
    subjectType: "closed_trade",
    tradeLifecycleKey: lifecycle?.key || fill.executionOrderId || fill.tradePlanId || fill.id || null,
    tradePlanId: plan.id || null,
    decisionSnapshotRef: snapshot ? { id: snapshot.id, hash: snapshot.payloadHash, verified: snapshotVerification.ok, captureMode: snapshot.captureMode } : null,
    financial: {
      complete: pnl != null && lifecycle?.financialBasisComplete !== false,
      basis: lifecycle?.financialBasis || fill.financialBasis || null,
      netRealizedPnl: pnl
    },
    outcome,
    processScore,
    process,
    matrix: { key: `${process}_${outcome}`, label: matrixLabel(process, outcome) },
    evidenceQuality: preTradeFactsVerified && knownAxes.length >= 4 ? "strong" : knownAxes.length >= 3 ? "adequate" : "limited",
    axes,
    rootCauses: roots,
    caveat: "单笔结果不等于策略因果证明；改进项必须经过重复样本或关键安全事件门槛，并由 Owner 决定是否进入验证。"
  };
}

export function backfillStructuredTradeReviews(db) {
  migrateLegacyOwnerReviewProvenance(db);
  const lifecycles = new Map(groupSystemClosedTradeLifecycles(db, { fills: (db.fills || []).filter((row) => isOwnerReviewRow(db, row)) }).map((row) => [String(row.key), row]));
  let updated = 0;
  for (const review of db.reviews || []) {
    if (!isOwnerReviewRow(db, review)) continue;
    if (review.type !== "trade" || review.status !== "completed" || review.structuredAssessment) continue;
    const lifecycle = lifecycles.get(String(review.tradeLifecycleKey || review.executionOrderId || review.tradePlanId || ""));
    if (!lifecycle || !isFinanciallyReconciledLifecycle(lifecycle)) continue;
    const plan = resolveTradeContext(db, lifecycle).plan || {};
    review.structuredAssessment = buildStructuredTradeAssessment(db, lifecycle, {
      plan,
      trajectory: lifecycle.representative?.trajectory || null,
      newsContext: lifecycle.representative?.newsContext || null
    });
    review.improvementScope = {
      strategyProductId: lifecycle.representative?.strategyProductId || plan.strategyProductId || plan.strategyRef?.productId || null,
      timeframe: plan.timeframe || lifecycle.representative?.timeframe || null,
      regime: lifecycle.representative?.regime || plan.regime || null
    };
    review.updatedAt = nowIso();
    updated += 1;
  }
  return { updated };
}

export function lessonStatus(memory = {}) {
  if (memory.source !== "auto_reflection") return null;
  return memory.learningStatus || "candidate_legacy";
}

export function isActiveReviewLesson(memory = {}) {
  return memory.source === "auto_reflection" && lessonStatus(memory) === "active";
}

function referenceValues(row = {}, fields = []) {
  return [...new Set(fields.flatMap((field) => {
    const value = row?.[field];
    return Array.isArray(value) ? value : [value];
  }).filter((value) => value !== null && value !== undefined && String(value).trim() !== "").map((value) => String(value)))];
}

function scopeValue(row = {}, fields = []) {
  const values = referenceValues(row, fields);
  return values.length === 1 ? values[0] : null;
}

function matchesOneLifecycleValue(claimed, actual) {
  if (claimed.length > 1 || actual.length > 1) return false;
  return !claimed.length || (actual.length === 1 && claimed[0] === actual[0]);
}

function fillScopeMatches(row = {}, fills = []) {
  const tenants = [...new Set(fills.map((fill) => scopeValue(fill, ["tenantId", "ownerTenantId"])).filter(Boolean))];
  const owners = [...new Set(fills.map((fill) => scopeValue(fill, ["ownerUserId", "createdByUserId", "userId"])).filter(Boolean))];
  const rowTenants = referenceValues(row, ["tenantId", "ownerTenantId"]);
  const rowOwners = referenceValues(row, ["ownerUserId", "createdByUserId", "userId"]);
  return rowTenants.length === 1 && rowOwners.length === 1
    && matchesOneLifecycleValue(rowTenants, tenants)
    && matchesOneLifecycleValue(rowOwners, owners)
    && tenants.length === 1 && owners.length === 1;
}

function fillBindingMatches(row = {}, lifecycle = {}) {
  const fills = lifecycle.fills || [];
  const closeIds = new Set(fills.map((fill) => String(fill?.id || "")).filter(Boolean));
  const fillIds = referenceValues(row, ["fillId", "fillIds"]);
  if (!fillIds.length || !fillIds.every((fillId) => closeIds.has(fillId))) return false;
  const executionIds = [...new Set(fills.map((fill) => String(fill?.executionOrderId || "")).filter(Boolean))];
  const planIds = [...new Set(fills.map((fill) => String(fill?.tradePlanId || fill?.planId || "")).filter(Boolean))];
  const symbols = [...new Set(fills.map((fill) => String(fill?.symbol || "").toUpperCase()).filter(Boolean))];
  const directions = [...new Set(fills.map((fill) => String(fill?.direction || "").toLowerCase()).filter(Boolean))];
  return matchesOneLifecycleValue(referenceValues(row, ["tradeLifecycleKey"]), [String(lifecycle.key || "")].filter(Boolean))
    && matchesOneLifecycleValue(referenceValues(row, ["executionOrderId"]), executionIds)
    && matchesOneLifecycleValue(referenceValues(row, ["tradePlanId", "planId"]), planIds)
    && matchesOneLifecycleValue(referenceValues(row, ["symbol"]).map((value) => value.toUpperCase()), symbols)
    && matchesOneLifecycleValue(referenceValues(row, ["direction"]).map((value) => value.toLowerCase()), directions)
    && fillScopeMatches(row, fills);
}

function reviewMemoryReferencesMatch(review = {}, memory = {}) {
  if (!memory?.id) return true;
  const reviewIds = referenceValues(memory, ["reviewId"]);
  const contextReviewIds = referenceValues(memory.reviewContext, ["reviewId"]);
  const allReviewIds = [...new Set([...reviewIds, ...contextReviewIds])];
  const linkedByReview = String(review.memoryItemId || "") === String(memory.id);
  const linkedByMemory = allReviewIds.length === 1 && allReviewIds[0] === String(review.id || "");
  return Boolean(review.id) && (linkedByReview || linkedByMemory)
    && (allReviewIds.length === 0 || linkedByMemory);
}

export function findSystemReviewLifecycle(db, review = {}, memory = {}) {
  if (!review?.id || !reviewMemoryReferencesMatch(review, memory)) return null;
  const memoryBinding = memory?.id ? {
    ...memory,
    tradeLifecycleKey: memory.tradeLifecycleKey || memory.reviewContext?.tradeLifecycleKey,
    executionOrderId: memory.executionOrderId || memory.reviewContext?.executionOrderId,
    tradePlanId: memory.tradePlanId || memory.reviewContext?.tradePlanId
  } : null;
  const rows = memoryBinding ? [review, memoryBinding] : [review];
  return groupSystemClosedTradeLifecycles(db).find((lifecycle) => (
    isFinanciallyReconciledLifecycle(lifecycle)
    && rows.every((row) => fillBindingMatches(row, lifecycle))
  )) || null;
}

export function transitionReviewLesson(db, memoryId, action, actor = "Owner") {
  migrateLegacyOwnerReviewProvenance(db);
  const memory = (db.memoryItems || []).find((row) => row.id === memoryId && row.source === "auto_reflection" && isOwnerReviewRow(db, row));
  if (!memory) return { ok: false, status: 404, error: "review_lesson_not_found" };
  const current = lessonStatus(memory);
  const transitions = {
    approve: { from: ["candidate", "candidate_legacy", "observing"], to: "active" },
    observe: { from: ["candidate", "candidate_legacy"], to: "observing" },
    reject: { from: ["candidate", "candidate_legacy", "observing"], to: "rejected" },
    retire: { from: ["active"], to: "retired" },
    reactivate: { from: ["retired"], to: "active" }
  };
  const transition = transitions[action];
  if (!transition || !transition.from.includes(current)) return { ok: false, status: 409, error: "invalid_lesson_transition", current, action };
  if (transition.to === "active") {
    const reviewIds = new Set([memory.reviewId, memory.reviewContext?.reviewId].filter(Boolean).map(String));
    const review = (db.reviews || []).find((row) => reviewIds.has(String(row.id)) || row.memoryItemId === memory.id) || {};
    if (!findSystemReviewLifecycle(db, review, memory)) return { ok: false, status: 409, error: "system_trade_evidence_missing" };
  }
  memory.learningStatus = transition.to;
  memory.learningDecision = { action, actor, at: nowIso() };
  memory.updatedAt = memory.learningDecision.at;
  appendAudit(db, `Owner ${action} 复盘教训「${memory.title || memory.id}」`, memory.id, actor, "info");
  return { ok: true, memory };
}

function lessonDisplayModel(db, memory) {
  const reviewId = memory.reviewId || memory.reviewContext?.reviewId || null;
  const review = (db.reviews || []).find((row) => row.id === reviewId || row.memoryItemId === memory.id) || null;
  const assessment = review?.structuredAssessment || null;
  const context = memory.reviewContext || {};
  const content = String(memory.content || "").trim();
  const deepMarker = "【深度复盘】";
  const markerIndex = content.indexOf(deepMarker);
  const embeddedDeepReflection = markerIndex >= 0 ? content.slice(markerIndex + deepMarker.length).trim() : "";
  const extractedLlmAdvice = compact(review?.deepReflection || embeddedDeepReflection, 700) || null;
  const lessonText = compact(markerIndex >= 0 ? content.slice(0, markerIndex) : content, 620) || null;
  const root = assessment?.rootCauses?.[0] || null;
  const legacy = lessonStatus(memory) === "candidate_legacy";
  // Legacy rows may contain prose or even the old marker, but without the new
  // lifecycle state we cannot claim that current LLM/evidence safeguards ran.
  const llmAdvice = legacy ? null : extractedLlmAdvice;
  const origin = legacy
    ? "legacy_unreviewed"
    : llmAdvice ? "llm_deep_review"
      : assessment ? "structured_review" : "deterministic_review";
  const netRealizedPnl = finite(assessment?.financial?.netRealizedPnl)
    ? Number(assessment.financial.netRealizedPnl)
    : finite(context.netRealizedPnl) ? Number(context.netRealizedPnl) : null;
  return {
    reviewId: review?.id || reviewId,
    origin,
    hasLlmAdvice: Boolean(llmAdvice),
    factSummary: compact(review?.summary, 420) || null,
    lessonText,
    llmAdvice,
    systemSuggestion: !legacy && root ? proposalForRoot(root.code) : null,
    diagnosis: root ? {
      code: root.code || null,
      label: root.label || null,
      confidence: finite(root.confidence) ? Number(root.confidence) : null,
      evidence: compact(root.evidence, 420) || null
    } : null,
    assessment: assessment ? {
      matrixLabel: assessment.matrix?.label || null,
      processScore: finite(assessment.processScore) ? Number(assessment.processScore) : null,
      evidenceQuality: assessment.evidenceQuality || null,
      financialComplete: assessment.financial?.complete === true,
      outcome: assessment.outcome || context.outcome || null,
      netRealizedPnl
    } : {
      matrixLabel: null,
      processScore: null,
      evidenceQuality: "legacy_unknown",
      financialComplete: context.financialBasis && context.financialBasis !== "unreconciled",
      outcome: context.outcome || (netRealizedPnl == null ? null : netRealizedPnl > 0 ? "win" : netRealizedPnl < 0 ? "loss" : "flat"),
      netRealizedPnl
    },
    applicability: {
      symbol: memory.symbol || context.symbol || review?.symbol || null,
      direction: context.direction || review?.direction || null,
      timeframe: context.timeframe || null,
      setupType: context.setupType || null,
      strategyProductId: context.strategyProductId || null,
      regime: context.regime || null
    },
    legacyCaveat: legacy
      ? "该记录来自升级前，无法证明当时是否经过当前版本的结构化事实校验与 LLM 深度复盘。"
      : null
  };
}

function proposalForRoot(code) {
  const proposals = {
    data_quality: "补齐交易前事实采集、哈希校验和缺失字段阻断，禁止用事后信息替代当时证据。",
    model_reasoning: "为行情分析增加针对该错误模式的反例评测与证据引用检查，先离线验证 Prompt/工作流变更。",
    strategy_regime: "在同策略、同周期、同市场环境中建立对照实验，验证环境过滤器后再决定是否发布新策略版本。",
    entry_timing: "把入场确认条件写成可测试规则，进行历史样本外验证和前向模拟，不直接修改实盘版本。",
    risk_sizing: "复核止损、单笔风险和杠杆映射；任何修改必须继续受硬风控上限约束。",
    execution_quality: "检查订单类型、盘口深度、拆单和滑点保护，以真实成交反例验证修复。",
    exit_discipline: "把退出与利润保护假设写成独立实验，对比原版本与候选版本的回吐、盈亏因子和回撤。",
    opportunity_detection: "检查 API 扫描范围、白名单覆盖、阈值和观察哨触发链；先用历史异动回放验证召回率，不直接放宽实盘风控。",
    plan_policy_mismatch: "修正计划生成约束，使候选计划在提交前遵守现有授权和硬风控；不得通过降低安全门槛来减少拒绝。",
    system_control_failure: "生成工程修复任务，先补失败反例和回归测试；Owner 审核后由代码流程实施，系统自身不修改代码。"
  };
  return proposals[code] || "继续积累事实，不立即修改生产行为。";
}

function successCriteriaForRoot(code) {
  if (code === "execution_quality") return ["同类成交至少 20 笔", "P95 绝对滑点低于当前基线", "重复成交与费用归集无遗漏", "完整回归测试通过"];
  if (["strategy_regime", "entry_timing", "exit_discipline"].includes(code)) return ["历史样本外验证通过", "前向模拟至少 20 笔", "盈亏因子不低于 1.2", "最大回撤不高于原版本", "Owner 明确批准后才可进入小额实盘"];
  if (code === "risk_sizing") return ["所有入场均有止损与风险检查", "不突破 Owner 设置的单笔和组合风险上限", "风险反例测试全部通过"];
  if (code === "model_reasoning") return ["新增错误模式评测集", "候选 Prompt 在盲测中优于当前版本", "不得降低 provider 归因和 critic 安全门槛"];
  if (code === "opportunity_detection") return ["历史异动回放覆盖率提高", "误报率不高于当前基线", "扫描仍由 API/代码完成，不新增无必要的 LLM 调用"];
  if (code === "plan_policy_mismatch") return ["相同授权下的无效候选计划显著减少", "硬风控规则与上限保持不变", "越权、无止损和超风险反例仍全部被拒绝"];
  return ["可稳定复现问题", "先有失败测试再实施修复", "相关全量测试、lint、build 通过", "生产行为经 Owner 验收"];
}

function improvementKey(review, root) {
  const assessment = review.structuredAssessment || {};
  const scope = review.improvementScope || {};
  return [root.code, scope.strategyProductId || assessment.strategyProductId || "all", scope.timeframe || "all", scope.regime || "all"].join("|");
}

function engineeringTask(item) {
  if (item.destination !== "system") return null;
  return {
    title: `[Owner 复盘] ${item.title}`,
    problem: item.problem,
    evidenceReviewIds: item.evidenceReviewIds.slice(0, 20),
    evidenceRefs: (item.evidenceRefs || []).slice(0, 20),
    expectedBehavior: item.proposal,
    acceptanceCriteria: item.successCriteria,
    guardrails: ["不得修改 API 契约或数据库结构，除非任务明确要求", "不得自动部署", "必须保留交易安全 fail-closed 语义"]
  };
}

export function refreshOwnerImprovementRegistry(db) {
  db.ownerImprovementItems ||= [];
  const groups = new Map();
  migrateLegacyOwnerReviewProvenance(db);
  const appendSignal = (key, root, evidence, outcome = null, matrixKey = null, scope = null) => {
    const bucket = groups.get(key) || { key, root, scope, reviews: [], evidenceRefs: [], losses: 0, luckyWins: 0 };
    bucket.scope ||= scope;
    const type = evidence?.type || "unknown";
    const evidenceId = evidence?.id || null;
    const duplicate = bucket.evidenceRefs.some((row) => row.type === type && row.id === evidenceId);
    if (!duplicate) {
      if (type === "trade_review" && evidence.review) bucket.reviews.push(evidence.review);
      bucket.evidenceRefs.push({ type, id: evidenceId });
      if (outcome === "loss") bucket.losses += 1;
      if (matrixKey === "poor_win") bucket.luckyWins += 1;
    }
    groups.set(key, bucket);
  };
  for (const review of db.reviews || []) {
    if (!isOwnerReviewRow(db, review)) continue;
    const assessment = review.structuredAssessment;
    if (review.type !== "trade" || review.status !== "completed" || !assessment) continue;
    if (!findSystemReviewLifecycle(db, review)) continue;
    for (const root of assessment.rootCauses || []) {
      if (!ACTIONABLE_ROOTS.has(root.code)) continue;
      const key = improvementKey(review, root);
      appendSignal(key, root, { type: "trade_review", id: review.id, review }, assessment.outcome, assessment.matrix?.key, review.improvementScope || null);
    }
  }
  for (const missed of db.missedOpportunities || []) {
    if (!isOwnerReviewRow(db, missed)) continue;
    if (!missed.inWhitelist || missed.qualification?.qualified !== true) continue; // 只有确定存在可交易入场的反事实才是系统遗漏。
    const code = missed.analyzed ? "model_reasoning" : "opportunity_detection";
    const meta = ROOT_META[code];
    const root = { code, ...meta, confidence: missed.analyzed ? 0.72 : 0.82 };
    const key = [code, missed.symbol || "all", "missed_opportunity"].join("|");
    appendSignal(key, root, { type: "missed_opportunity", id: missed.key || missed.id });
  }
  const incidentStatuses = new Set([
    "failed", "protection_failed", "reconciliation_failed", "emergency_close_pending",
    "entry_unknown_pending", "execution_effect_unknown", "cancel_unknown_pending",
    "protection_failure_cancel_pending", "close_unknown_pending", "close_reconciliation_pending",
    "recovery_pending_reconciliation", "protection_failure_reconciliation"
  ]);
  for (const order of db.executionOrders || []) {
    if (!isOwnerReviewRow(db, order)) continue;
    const status = [order.status, order.protection, order.reconciliationStatus]
      .map((value) => String(value || "").toLowerCase())
      .find((value) => incidentStatuses.has(value));
    if (!status) continue;
    const root = { code: "system_control_failure", ...ROOT_META.system_control_failure, confidence: 0.95 };
    const key = ["system_control_failure", status, order.symbol || "all"].join("|");
    appendSignal(key, root, { type: "execution_incident", id: order.id });
  }
  for (const incident of db.riskIncidents || []) {
    if (!isOwnerReviewRow(db, incident) || String(incident.status || "").toLowerCase() !== "open") continue;
    if (!['critical', 'high'].includes(String(incident.severity || "").toLowerCase())) continue;
    const code = compact(incident.kind || incident.source || "critical_risk_incident", 100);
    const root = { code: "system_control_failure", ...ROOT_META.system_control_failure, confidence: 0.98 };
    const key = ["system_control_failure", code, incident.symbol || "all"].join("|");
    appendSignal(key, root, { type: "risk_incident", id: incident.id });
  }
  const rejectedPlanStatuses = new Set(["risk_rejected", "execution_blocked"]);
  for (const plan of db.tradePlans || []) {
    if (!isOwnerReviewRow(db, plan)) continue;
    if (!rejectedPlanStatuses.has(String(plan.status || "").toLowerCase())) continue;
    const root = { code: "plan_policy_mismatch", ...ROOT_META.plan_policy_mismatch, confidence: 0.86 };
    const key = ["plan_policy_mismatch", plan.strategyProductId || plan.strategyRef?.productId || "all", plan.timeframe || "all"].join("|");
    appendSignal(key, root, { type: "rejected_trade_plan", id: plan.id });
  }
  let created = 0;
  let updated = 0;
  for (const group of groups.values()) {
    const existing = db.ownerImprovementItems.find((row) => row.dedupKey === group.key && isOwnerReviewRow(db, row));
    const root = group.root;
    const immediate = root.severity === "critical" || root.code === "data_quality" || root.code === "risk_sizing";
    const proposedState = immediate || group.evidenceRefs.length >= 3 ? "pending_owner" : "evidence_accumulating";
    const item = existing || {
      id: `owner_improvement_${ownerReviewHash([db.user?.tenantId || "tenant_owner", db.user?.id || "owner", group.key]).slice(0, 18)}`,
      schemaVersion: 1,
      dedupKey: group.key,
      createdAt: nowIso(),
      tenantId: db.user?.tenantId || "tenant_owner",
      ownerUserId: db.user?.id || null,
      state: proposedState,
      ownerDecision: null
    };
    const protectedStates = new Set(["accepted", "rejected", "validating", "verified", "ineffective"]);
    const values = {
      rootCauseCode: root.code,
      scope: clone(group.scope || null),
      title: ROOT_META[root.code]?.label || root.label,
      problem: `${group.evidenceRefs.length} 项独立证据出现「${root.label}」${group.losses ? `；其中亏损 ${group.losses} 笔` : ""}${group.luckyWins ? `，过程不合格但盈利 ${group.luckyWins} 笔` : ""}。`,
      destination: root.destination,
      severity: root.severity,
      evidenceCount: group.evidenceRefs.length,
      evidenceReviewIds: group.reviews.map((row) => row.id).filter(Boolean).slice(0, 50),
      evidenceRefs: group.evidenceRefs.filter((row) => row.id).slice(0, 50),
      proposal: proposalForRoot(root.code),
      successCriteria: successCriteriaForRoot(root.code),
      state: existing && protectedStates.has(existing.state)
        ? existing.state
        : existing?.requiredEvidenceCount && group.evidenceRefs.length < Number(existing.requiredEvidenceCount)
          ? "evidence_accumulating"
          : proposedState
    };
    values.engineeringTask = engineeringTask({ ...item, ...values });
    const before = existing ? ownerReviewHash(Object.fromEntries(Object.keys(values).map((key) => [key, existing[key]]))) : null;
    Object.assign(item, values);
    if (!existing) {
      item.updatedAt = nowIso();
      db.ownerImprovementItems.unshift(item);
      created += 1;
    } else {
      const after = ownerReviewHash(values);
      if (before !== after) {
        item.updatedAt = nowIso();
        updated += 1;
      }
    }
  }
  return { created, updated, total: db.ownerImprovementItems.filter((row) => isOwnerReviewRow(db, row)).length };
}

export function transitionOwnerImprovement(db, improvementId, action, actor = "Owner", options = {}, runtime = {}) {
  migrateLegacyOwnerReviewProvenance(db);
  const item = (db.ownerImprovementItems || []).find((row) => row.id === improvementId && isOwnerReviewRow(db, row));
  if (!item) return { ok: false, status: 404, error: "owner_improvement_not_found" };
  const transitions = {
    accept: { from: ["pending_owner", "evidence_accumulating"], to: "accepted" },
    reject: { from: ["pending_owner", "evidence_accumulating", "accepted"], to: "rejected" },
    more_evidence: { from: ["pending_owner"], to: "evidence_accumulating" },
    start_validation: { from: ["accepted"], to: "validating" },
    verify: { from: ["validating"], to: "verified" },
    ineffective: { from: ["validating", "verified"], to: "ineffective" },
    retry_validation: { from: ["ineffective"], to: "accepted" }
  };
  const transition = transitions[action];
  if (!transition || !transition.from.includes(item.state)) return { ok: false, status: 409, error: "invalid_improvement_transition", current: item.state, action };
  if (action === "start_validation" && item.destination === "strategy" && !item.experimentId) {
    return { ok: false, status: 409, error: "strategy_validation_experiment_missing" };
  }
  if (action === "more_evidence") {
    const additional = Math.max(1, Math.min(20, Number(options.additionalEvidence || 1)));
    item.requiredEvidenceCount = Math.max(Number(item.requiredEvidenceCount || 0), Number(item.evidenceCount || 0) + additional);
  }
  if (action === "retry_validation") {
    const previousExperiment = (db.strategyExperiments || []).find((row) => row.id === item.experimentId);
    if (previousExperiment && !["failed", "ineffective", "superseded"].includes(String(previousExperiment.status || "").toLowerCase())) {
      previousExperiment.status = "superseded";
      previousExperiment.supersededAt = nowIso();
      previousExperiment.completedAt ||= previousExperiment.supersededAt;
      previousExperiment.updatedAt = previousExperiment.supersededAt;
    }
    item.previousExperimentIds ||= [];
    if (item.experimentId && !item.previousExperimentIds.includes(item.experimentId)) item.previousExperimentIds.push(item.experimentId);
    item.experimentId = null;
    item.validationEvidence = [];
    item.validationGeneration = Number(item.validationGeneration || 1) + 1;
  }
  if (action === "verify") {
    if (options.ownerAttested !== true) return { ok: false, status: 400, error: "owner_validation_attestation_required" };
    if (item.destination === "strategy") {
      const experiment = (db.strategyExperiments || []).find((row) => row.id === item.experimentId);
      const stages = experiment?.stages || [];
      const verifiedEvidence = verifyRecordedStrategyExperiment(db, experiment);
      if (!verifiedEvidence.ok) return verifiedEvidence;
      item.validationEvidence = [{ type: "strategy_experiment", id: experiment.id, stages: stages.map((stage) => ({ name: stage.name, status: stage.status })) }];
    } else {
      const evidence = Array.isArray(options.validationEvidence) ? options.validationEvidence : [];
      const normalizedEvidence = evidence.map((row) => ({
        type: compact(row?.type || "owner_note", 40),
        value: compact(row?.value || row?.note || row?.id, 600)
      })).filter((row) => row.value).slice(0, 10);
      if (!normalizedEvidence.length) return { ok: false, status: 400, error: "owner_validation_evidence_required" };
      item.validationEvidence = normalizedEvidence;
    }
  }
  item.state = transition.to;
  item.ownerDecision = { action, actor, at: nowIso() };
  if (action === "start_validation" && item.destination === "strategy") {
    const experiment = (db.strategyExperiments || []).find((row) => row.id === item.experimentId);
    experiment.status = "validating";
    experiment.startedAt ||= item.ownerDecision.at;
    experiment.updatedAt = item.ownerDecision.at;
  }
  if (action === "verify" && item.destination === "strategy") {
    const experiment = (db.strategyExperiments || []).find((row) => row.id === item.experimentId);
    experiment.status = "verified";
    experiment.verifiedAt = item.ownerDecision.at;
    experiment.completedAt ||= item.ownerDecision.at;
    experiment.updatedAt = item.ownerDecision.at;
  }
  if (action === "ineffective" && item.destination === "strategy") {
    const experiment = (db.strategyExperiments || []).find((row) => row.id === item.experimentId);
    if (experiment) {
      experiment.status = "ineffective";
      experiment.ineffectiveAt = item.ownerDecision.at;
      experiment.completedAt ||= item.ownerDecision.at;
      experiment.updatedAt = item.ownerDecision.at;
    }
  }
  item.updatedAt = item.ownerDecision.at;
  if (runtime.suppressAudit !== true) appendAudit(db, `Owner ${action} 优化项「${item.title}」`, item.id, actor, item.severity === "critical" ? "critical" : "info");
  return { ok: true, item };
}

function validationError(error, status = 409, extra = {}) {
  return { ok: false, status, error, ...extra };
}

function strategyCandidate(db, experiment, input = {}) {
  const versionId = compact(input.candidateVersionId || experiment.candidateStrategyRef?.versionId, 160);
  if (!versionId) return validationError("candidate_strategy_version_required", 400);
  const version = (db.strategyBlueprintVersions || []).find((row) => row.id === versionId);
  if (!version) return validationError("candidate_strategy_version_not_found", 404);
  if (!isOwnerReviewRow(db, version)) return validationError("candidate_strategy_version_not_owned", 403);
  const eligibility = validatePublishedStrategyCandidate(db, version);
  if (!eligibility.ok) return validationError(eligibility.error, eligibility.status || 409);
  const productId = eligibility.productId;
  if (!productId || productId !== experiment.strategyRef?.productId) {
    return validationError("candidate_strategy_product_mismatch", 409, { expectedProductId: experiment.strategyRef?.productId || null });
  }
  const definitionHash = compact(input.candidateDefinitionHash || experiment.candidateStrategyRef?.definitionHash, 160);
  if (!definitionHash) return validationError("candidate_strategy_definition_hash_required", 400);
  if (definitionHash !== version.contentHash) return validationError("candidate_strategy_definition_hash_mismatch", 409);
  if (version.id === experiment.strategyRef?.versionId || version.contentHash === experiment.strategyRef?.definitionHash) {
    return validationError("candidate_strategy_must_differ_from_baseline", 409);
  }
  const enabledAssignment = (db.strategyAssignments || []).find((row) => row.enabled === true && row.strategyVersionId === version.id);
  // A version that was already live before it was selected cannot masquerade as
  // a fresh candidate. After the backtest binds the immutable candidate, Owner
  // may explicitly enable that exact version in observation mode to accumulate
  // the real small-live cohort; later stages must continue matching the same hash.
  if (enabledAssignment && (experiment.candidateStrategyRef?.versionId !== version.id
    || experiment.candidateStrategyRef?.definitionHash !== version.contentHash)) {
    return validationError("candidate_strategy_already_live", 409);
  }
  return {
    ok: true,
    version,
    ref: {
      type: "strategy_blueprint_version",
      versionId: version.id,
      productId,
      definitionHash: version.contentHash,
      tenantId: version.tenantId,
      ownerUserId: version.ownerUserId
    }
  };
}

function numericMetric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cohortProfitFactor(rows) {
  const pnls = rows.map((row) => numericMetric(row.netRealizedPnl ?? row.structuredAssessment?.financial?.netRealizedPnl)).filter((value) => value !== null);
  const wins = pnls.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(pnls.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  return losses > 0 ? Number((wins / losses).toFixed(3)) : wins > 0 ? null : 0;
}

function authoritativeStageEvidence(db, experiment, stageName, input = {}) {
  const candidate = strategyCandidate(db, experiment, input);
  if (!candidate.ok) return candidate;
  const criteria = experiment.successCriteria || {};
  if (stageName === "backtest") {
    const evidenceId = compact(input.evidenceId || candidate.version.validation?.backtestId, 160);
    const record = (db.strategyStudioBacktests || []).find((row) => row.id === evidenceId);
    if (!record || record.passed !== true || record.id !== candidate.version.validation?.backtestId) return validationError("authoritative_backtest_evidence_missing", 409);
    if (!isOwnerReviewRow(db, record)) return validationError("authoritative_backtest_evidence_not_owned", 403);
    const draft = (db.strategyStudioDrafts || []).find((row) => row.id === record.draftId);
    if (!draft || record.draftHash !== draft.contentHash || candidate.version.definition?.sourceDraftId !== draft.id) {
      return validationError("authoritative_backtest_candidate_mismatch", 409);
    }
    const metrics = {
      trades: numericMetric(record.oos?.trades),
      profitFactor: numericMetric(record.oos?.profitFactor),
      maxDrawdownPct: numericMetric(record.oos?.maxDrawdownPct),
      expectancyR: numericMetric(record.oos?.expectancyR)
    };
    const passed = metrics.trades >= Number(criteria.minTrades || 20)
      && metrics.profitFactor !== null && metrics.profitFactor >= Number(criteria.minProfitFactor || 1.2)
      && metrics.maxDrawdownPct !== null && metrics.maxDrawdownPct <= Number(criteria.maxDrawdownPct || 3)
      && metrics.expectancyR !== null && metrics.expectancyR > 0;
    if (!passed) return validationError("backtest_success_criteria_not_met", 409, { metrics });
    return { ok: true, candidate, evidence: { type: "strategy_backtest", id: record.id, recordHash: ownerReviewHash(record), metrics } };
  }
  if (stageName === "paper") {
    const evidenceId = compact(input.evidenceId, 160);
    const record = (db.paperSessions || []).find((row) => row.id === evidenceId);
    if (!record || record.status !== "passed" || record.seeded !== false) return validationError("authoritative_paper_evidence_missing", 409);
    if (!isOwnerReviewRow(db, record)) return validationError("authoritative_paper_evidence_not_owned", 403);
    if (record.strategyVersionId !== candidate.version.id
      || record.strategyDefinitionHash !== candidate.version.contentHash
      || record.strategyProductId !== candidate.ref.productId
      || record.strategyExperimentId !== experiment.id) return validationError("authoritative_paper_candidate_mismatch", 409);
    const metrics = {
      trades: numericMetric(record.metrics?.trades),
      profitFactor: numericMetric(record.metrics?.profitFactor),
      maxDrawdownPct: numericMetric(record.metrics?.maxDrawdownPct),
      averageSlippageBps: numericMetric(record.metrics?.averageSlippageBps ?? record.metrics?.slippageBps)
    };
    if (metrics.trades < Number(criteria.minTrades || 20)
      || metrics.profitFactor === null || metrics.profitFactor < Number(criteria.minProfitFactor || 1.2)
      || metrics.maxDrawdownPct === null || metrics.maxDrawdownPct > Number(criteria.maxDrawdownPct || 3)) {
      return validationError("paper_success_criteria_not_met", 409, { metrics });
    }
    return { ok: true, candidate, evidence: { type: "paper_session", id: record.id, recordHash: ownerReviewHash(record), metrics } };
  }
  if (stageName === "small_live") {
    const ids = [...new Set((input.evidenceReviewIds || []).map(String).filter(Boolean))];
    const records = ids.map((idValue) => (db.reviews || []).find((row) => row.id === idValue)).filter(Boolean);
    const eligible = records.filter((review) => isOwnerReviewRow(db, review)
      && review.type === "trade" && review.status === "completed"
      && findSystemReviewLifecycle(db, review)
      && review.structuredAssessment?.financial?.complete === true
      && review.strategyBlueprintAttribution?.verified === true
      && review.strategyBlueprintRef?.versionId === candidate.version.id
      && review.strategyBlueprintRef?.contentHash === candidate.version.contentHash
      && review.strategyBlueprintRef?.productId === candidate.ref.productId
      && review.strategyVersionId === candidate.version.id
      && review.improvementScope?.strategyVersionId === candidate.version.id
      && review.improvementScope?.strategyDefinitionHash === candidate.version.contentHash
      && review.improvementScope?.strategyProductId === candidate.ref.productId);
    const minTrades = Number(criteria.minSmallLiveTrades || 3);
    if (eligible.length !== ids.length || eligible.length < minTrades) return validationError("authoritative_small_live_evidence_incomplete", 409, { eligible: eligible.length, required: minTrades });
    const pnl = eligible.reduce((sum, row) => sum + Number(row.netRealizedPnl ?? row.structuredAssessment?.financial?.netRealizedPnl ?? 0), 0);
    const metrics = { trades: eligible.length, netRealizedPnl: Number(pnl.toFixed(4)), profitFactor: cohortProfitFactor(eligible), reconciledTrades: eligible.length };
    if (metrics.profitFactor !== null && metrics.profitFactor < Number(criteria.minProfitFactor || 1.2)) return validationError("small_live_success_criteria_not_met", 409, { metrics });
    return { ok: true, candidate, evidence: { type: "trade_review_cohort", ids, recordHash: ownerReviewHash(eligible), metrics } };
  }
  return validationError("strategy_validation_stage_not_supported", 400);
}

function verifyRecordedStrategyExperiment(db, experiment) {
  if (!experiment?.candidateStrategyRef) return validationError("strategy_validation_evidence_incomplete", 409);
  for (const stage of experiment.stages || []) {
    if (stage.status !== "passed" || !stage.evidence) return validationError("strategy_validation_evidence_incomplete", 409);
    const checked = authoritativeStageEvidence(db, experiment, stage.name, {
      candidateVersionId: experiment.candidateStrategyRef.versionId,
      candidateDefinitionHash: experiment.candidateStrategyRef.definitionHash,
      evidenceId: stage.evidence.id,
      evidenceReviewIds: stage.evidence.ids
    });
    if (!checked.ok) return checked;
    if (checked.evidence.recordHash !== stage.evidence.recordHash) return validationError("strategy_validation_evidence_changed", 409, { stage: stage.name });
  }
  return { ok: true };
}

export function recordStrategyValidationStage(db, improvementId, input = {}, actor = "Owner") {
  migrateLegacyOwnerReviewProvenance(db);
  const item = (db.ownerImprovementItems || []).find((row) => row.id === improvementId && isOwnerReviewRow(db, row));
  if (!item) return { ok: false, status: 404, error: "owner_improvement_not_found" };
  if (item.destination !== "strategy" || item.state !== "validating") {
    return { ok: false, status: 409, error: "strategy_improvement_not_validating", current: item.state };
  }
  const experiment = (db.strategyExperiments || []).find((row) => row.id === item.experimentId);
  if (!experiment) return { ok: false, status: 409, error: "strategy_validation_experiment_missing" };
  const stageName = String(input.stageName || "").trim();
  const outcome = String(input.outcome || "").trim().toLowerCase();
  const note = compact(input.note || input.evidence, 1200);
  if (!stageName || !["passed", "failed"].includes(outcome)) return { ok: false, status: 400, error: "strategy_validation_stage_input_invalid" };
  const stages = experiment.stages || [];
  const index = stages.findIndex((stage) => stage.name === stageName);
  if (index < 0) return { ok: false, status: 404, error: "strategy_validation_stage_not_found" };
  const firstIncomplete = stages.findIndex((stage) => !["passed", "completed", "verified"].includes(String(stage.status || "").toLowerCase()));
  if (firstIncomplete !== index) return { ok: false, status: 409, error: "strategy_validation_stage_out_of_order", expected: stages[firstIncomplete]?.name || null };
  const at = nowIso();
  let authoritative = null;
  if (outcome === "passed") {
    authoritative = authoritativeStageEvidence(db, experiment, stageName, input);
    if (!authoritative.ok) return authoritative;
    if (stageName === "backtest") experiment.candidateStrategyRef = { ...authoritative.candidate.ref, boundBy: actor, boundAt: at };
  } else if (!note) {
    return { ok: false, status: 400, error: "strategy_validation_failure_reason_required" };
  }
  stages[index] = {
    ...stages[index],
    status: outcome,
    evidence: outcome === "passed" ? { ...authoritative.evidence, note, actor, at } : { type: "owner_failure_observation", note, actor, at }
  };
  experiment.updatedAt = at;
  if (outcome === "failed") {
    experiment.status = "failed";
    experiment.completedAt = at;
    item.state = "ineffective";
  } else if (stages.every((stage) => ["passed", "completed", "verified"].includes(String(stage.status || "").toLowerCase()))) {
    experiment.status = "ready_for_owner_verification";
    experiment.completedAt = at;
  } else {
    experiment.status = "validating";
  }
  item.updatedAt = at;
  appendAudit(db, `Owner 记录策略验证阶段「${stages[index].label || stageName}」：${outcome}`, experiment.id, actor, outcome === "failed" ? "warning" : "info");
  return { ok: true, item, experiment, stage: stages[index] };
}

export function buildOwnerReviewLoopSnapshot(db) {
  migrateLegacyOwnerReviewProvenance(db);
  refreshOwnerImprovementRegistry(db);
  const memories = (db.memoryItems || []).filter((row) => row.source === "auto_reflection" && isOwnerReviewRow(db, row));
  const lessons = memories.map((memory) => {
    const display = lessonDisplayModel(db, memory);
    return {
      id: memory.id,
      reviewId: display.reviewId,
      title: memory.title,
      content: compact(memory.content, 520),
      symbol: display.applicability.symbol,
      status: lessonStatus(memory),
      patternKey: memory.patternKey || null,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
      ...display
    };
  }).sort((a, b) => {
    const stateRank = { candidate: 0, candidate_legacy: 1, observing: 2, active: 3, retired: 4, rejected: 5 };
    return (stateRank[a.status] ?? 9) - (stateRank[b.status] ?? 9) || new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
  });
  const improvements = (db.ownerImprovementItems || []).filter((item) => isOwnerReviewRow(db, item)).map((item) => {
    const experiment = item.experimentId ? (db.strategyExperiments || []).find((row) => row.id === item.experimentId) : null;
    const candidateVersions = experiment ? (db.strategyBlueprintVersions || []).filter((version) => {
      const eligibility = validatePublishedStrategyCandidate(db, version);
      const productId = version.definition?.baseProductId || version.productId || null;
      const enabled = (db.strategyAssignments || []).some((assignment) => assignment.enabled === true && assignment.strategyVersionId === version.id);
      return eligibility.ok && isOwnerReviewRow(db, version) && productId === experiment.strategyRef?.productId
        && version.id !== experiment.strategyRef?.versionId
        && version.contentHash !== experiment.strategyRef?.definitionHash
        && !enabled;
    }).map((version) => ({
      id: version.id,
      definitionHash: version.contentHash,
      productId: version.definition?.baseProductId || version.productId || null,
      backtestId: version.validation?.backtestId || null,
      symbols: clone(version.definition?.symbols || []),
      timeframe: version.definition?.timeframe || null,
      label: compact(version.definition?.name || version.id, 120)
    })) : [];
    const selectedCandidateId = experiment?.candidateStrategyRef?.versionId || null;
    const selectedCandidateHash = experiment?.candidateStrategyRef?.definitionHash || null;
    const selectedCandidateProduct = experiment?.candidateStrategyRef?.productId || null;
    const paperSessions = selectedCandidateId ? (db.paperSessions || []).filter((session) => isOwnerReviewRow(db, session)
      && session.strategyVersionId === selectedCandidateId
      && session.strategyDefinitionHash === selectedCandidateHash
      && session.strategyProductId === selectedCandidateProduct
      && session.strategyExperimentId === experiment.id
      && session.seeded === false && ["running", "passed", "failed"].includes(session.status))
      .map((session) => ({ id: session.id, label: compact(session.title || session.id, 120), status: session.status, symbol: session.symbol, metrics: clone(session.metrics || null) })) : [];
    const liveReviews = selectedCandidateId ? (db.reviews || []).filter((review) => isOwnerReviewRow(db, review)
      && review.type === "trade" && review.status === "completed"
      && findSystemReviewLifecycle(db, review)
      && review.strategyBlueprintAttribution?.verified === true
      && review.strategyBlueprintRef?.versionId === selectedCandidateId
      && review.strategyBlueprintRef?.contentHash === selectedCandidateHash
      && review.strategyBlueprintRef?.productId === selectedCandidateProduct
      && review.improvementScope?.strategyVersionId === selectedCandidateId
      && review.improvementScope?.strategyDefinitionHash === selectedCandidateHash
      && review.improvementScope?.strategyProductId === selectedCandidateProduct
      && review.structuredAssessment?.financial?.complete === true)
      .map((review) => ({ id: review.id, symbol: review.symbol || null, completedAt: review.completedAt || null, netRealizedPnl: review.netRealizedPnl ?? null })) : [];
    const stages = (experiment?.stages || []).map((stage) => ({
      name: stage.name,
      label: stage.label,
      status: stage.status,
      evidence: stage.evidence ? {
        type: stage.evidence.type || null,
        id: stage.evidence.id || null,
        ids: clone(stage.evidence.ids || null),
        metrics: clone(stage.evidence.metrics || null),
        note: compact(stage.evidence.note, 420),
        actor: stage.evidence.actor || null,
        at: stage.evidence.at || null
      } : null
    }));
    return {
      ...item,
      validation: experiment ? {
        experimentId: experiment.id,
        status: experiment.status,
        candidateStrategyRef: clone(experiment.candidateStrategyRef || null),
        attemptNumber: experiment.attemptNumber || 1,
        strategyRef: clone(experiment.strategyRef || null),
        availableEvidence: { candidateVersions, paperSessions, liveReviews },
        stages,
        readyForOwnerVerification: stages.length > 0 && stages.every((stage) => ["passed", "completed", "verified"].includes(String(stage.status || "").toLowerCase()))
      } : null
    };
  }).sort((a, b) => {
    const stateRank = { pending_owner: 0, accepted: 1, validating: 2, evidence_accumulating: 3, verified: 4, ineffective: 5, rejected: 6 };
    return (stateRank[a.state] ?? 9) - (stateRank[b.state] ?? 9) || new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });
  const completed = (db.reviews || []).filter((row) => row.type === "trade" && row.status === "completed" && isOwnerReviewRow(db, row));
  return {
    schemaVersion: 1,
    generatedAt: nowIso(),
    scope: "owner_instance_only",
    policy: {
      crossUserAggregation: false,
      autoCodeModification: false,
      autoProductionChange: false,
      activeLessonRequiresOwnerApproval: true,
      strategyChangeRequiresVersionedValidation: true
    },
    summary: {
      completedReviews: completed.length,
      structuredReviews: completed.filter((row) => row.structuredAssessment).length,
      candidateLessons: lessons.filter((row) => ["candidate", "candidate_legacy", "observing"].includes(row.status)).length,
      activeLessons: lessons.filter((row) => row.status === "active").length,
      pendingOwner: improvements.filter((row) => row.state === "pending_owner").length,
      validating: improvements.filter((row) => row.state === "validating").length
    },
    lessons: lessons.slice(0, 30),
    improvements: improvements.slice(0, 30)
  };
}
