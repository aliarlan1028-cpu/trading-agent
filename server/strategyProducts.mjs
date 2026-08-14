import crypto from "node:crypto";
import { groupClosedTradeLifecycles } from "./tradeReviewQueue.mjs";

// AI 交易策略产品与指标回测模型是两种不同对象：
// - 策略产品规定「何时交易、允许 AI 在哪些参数边界内实例化、如何失效和退出」；
// - scenario/armed setup 负责「如何等待和执行」；
// - STRATEGIES 中的指标模型负责研究与回测信号，不自动等同于可实盘策略。

export const STRATEGY_PRODUCT_SCHEMA = "trading.strategy.product";
export const STRATEGY_PRODUCT_SCHEMA_VERSION = 1;

export const STRATEGY_PRODUCT_STATES = Object.freeze([
  "research",
  "historical_validation",
  "owner_live_observation",
  "validated_active",
  "paused",
  "degraded",
  "retired"
]);

const STATE_SET = new Set(STRATEGY_PRODUCT_STATES);
const VALID_DIRECTIONS = new Set(["long", "short", "both"]);
const VALID_SCENARIOS = new Set([
  "trend_pullback", "breakout_retest", "breakdown_retest", "reversal_reclaim",
  "fake_breakout", "range_rejection"
]);

const REQUIRED_DATA = Object.freeze([
  { source: "OKX", dataset: "ticker", maxAgeMs: 10_000, required: true },
  { source: "OKX", dataset: "closed_ohlcv", timeframes: ["15m", "1h", "4h"], required: true },
  { source: "OKX", dataset: "instrument_metadata", required: true },
  { source: "OKX", dataset: "account_positions_margin", maxAgeMs: 30_000, liveOnly: true, required: true }
]);

const COMMON_EXECUTION = Object.freeze({
  exchange: "OKX",
  marketType: "perpetual_usdt",
  requiresEvidenceBundle: true,
  requiresMandate: true,
  requiresHardRiskGate: true,
  requiresFreshAccountSnapshot: true,
  requiresNativeStopProtection: true,
  llmMayInstantiateWithinBounds: true,
  llmMayChangeVersion: false,
  llmMayBypassContract: false
});

const COMMON_VALIDATION = Object.freeze({
  structuralValidationRequired: true,
  outOfSampleRecommended: true,
  paperForwardRequired: false,
  ownerAuthorizedLiveObservationAllowed: true,
  // 用户明确选择以小额实盘验证，故不把模拟环境设为硬前置；但证据不足时绝不标记“已验证”。
  minClosedTradesForValidation: 30,
  minProfitFactor: 1.1,
  minExpectancyR: 0,
  maxConsecutiveLossesForValidation: 4
});

const PRODUCTS = [
  {
    id: "trend_pullback",
    version: "1.0.0",
    name: "趋势回调确认",
    nameEn: "Trend Pullback Confirmation",
    summary: "顺已确认趋势等待回调，不在远离价值区的位置追价；回调结束并重新顺势后入场。",
    summaryEn: "Wait for a pullback within a confirmed trend and enter only after continuation is reconfirmed.",
    family: "trend_continuation",
    scenarioTypes: ["trend_pullback"],
    direction: "both",
    roles: ["day_trader", "swing_trader"],
    regimes: ["上行趋势", "下行趋势", "高波动趋势"],
    timeframes: ["5m", "15m", "1h", "4h", "1d"],
    stages: [
      { id: "trend", label: "趋势成立", evidence: ["高周期结构方向明确", "趋势失效位可量化"] },
      { id: "pullback", label: "价格回到计划区", evidence: ["进入回调/价值区", "未触发结构失效"] },
      { id: "continuation", label: "顺势重新确认", evidence: ["收盘、K线或成交量确认至少一项", "入场时重新计算盈亏比"] },
      { id: "execute", label: "风控复核并执行", evidence: ["账户与行情事实新鲜", "确定性风控全部通过"] }
    ],
    parameterBounds: { stageCount: [2, 4], confirmationCount: [1, 4], maxPlanTtlHours: 48 },
    invalidation: ["高周期趋势结构失效", "价格在确认前越过止损参考位", "事实或授权版本过期"],
    exits: ["结构止损", "至少一个止盈或跟踪止损", "方向被确定性证据否定时重新评估"]
  },
  {
    id: "breakout_retest",
    version: "1.0.0",
    name: "向上突破回踩确认",
    nameEn: "Upside Breakout Retest",
    summary: "价格有效突破阻力后不追涨，等待回踩守住突破位并重新转强。",
    summaryEn: "After a valid upside breakout, wait for the breakout level to hold on a retest before entering long.",
    family: "breakout_continuation",
    scenarioTypes: ["breakout_retest"],
    direction: "long",
    roles: ["day_trader", "swing_trader"],
    regimes: ["波动率扩张", "上行趋势", "区间向上突破"],
    timeframes: ["5m", "15m", "1h", "4h", "1d"],
    stages: [
      { id: "breakout", label: "有效突破", evidence: ["收盘站上关键阻力", "突破不是仅靠瞬时插针"] },
      { id: "retest", label: "回踩突破位", evidence: ["价格回到突破位附近", "未重新跌回失效区"] },
      { id: "resume", label: "重新转强", evidence: ["看涨拒绝/收盘/放量确认", "剩余空间满足最低盈亏比"] },
      { id: "execute", label: "风控复核并执行", evidence: ["账户与行情事实新鲜", "确定性风控全部通过"] }
    ],
    parameterBounds: { stageCount: [3, 4], confirmationCount: [1, 4], maxPlanTtlHours: 48 },
    invalidation: ["回踩后收盘重新落入原区间", "突破结构被反向 CHoCH 否定", "事实或授权版本过期"],
    exits: ["突破失效止损", "分批止盈或跟踪止损", "假突破确认后停止原方向"]
  },
  {
    id: "breakdown_retest",
    version: "1.0.0",
    name: "向下跌破反抽确认",
    nameEn: "Downside Breakdown Retest",
    summary: "价格有效跌破支撑后不追空，等待反抽受阻并重新转弱。",
    summaryEn: "After a valid downside breakdown, wait for a failed retest of support before entering short.",
    family: "breakout_continuation",
    scenarioTypes: ["breakdown_retest"],
    direction: "short",
    roles: ["day_trader", "swing_trader"],
    regimes: ["波动率扩张", "下行趋势", "区间向下跌破"],
    timeframes: ["5m", "15m", "1h", "4h", "1d"],
    stages: [
      { id: "breakdown", label: "有效跌破", evidence: ["收盘跌破关键支撑", "跌破不是仅靠瞬时插针"] },
      { id: "retest", label: "反抽原支撑", evidence: ["价格回到原支撑附近", "未重新站回失效区"] },
      { id: "resume", label: "重新转弱", evidence: ["看跌拒绝/收盘/放量确认", "剩余空间满足最低盈亏比"] },
      { id: "execute", label: "风控复核并执行", evidence: ["账户与行情事实新鲜", "确定性风控全部通过"] }
    ],
    parameterBounds: { stageCount: [3, 4], confirmationCount: [1, 4], maxPlanTtlHours: 48 },
    invalidation: ["反抽后收盘重新站回原区间", "跌破结构被反向 CHoCH 否定", "事实或授权版本过期"],
    exits: ["跌破失效止损", "分批止盈或跟踪止损", "假跌破确认后停止原方向"]
  },
  {
    id: "range_rejection",
    version: "1.0.0",
    name: "区间边缘反转确认",
    nameEn: "Range-edge Rejection",
    summary: "只在已确认区间的边缘寻找反转，不把价格已经上涨或下跌本身当作信号。",
    summaryEn: "Trade only confirmed rejection at the edge of a defined range; price location alone is not a signal.",
    family: "mean_reversion",
    scenarioTypes: ["range_rejection"],
    direction: "both",
    roles: ["day_trader", "swing_trader"],
    regimes: ["震荡", "低波动区间"],
    timeframes: ["5m", "15m", "1h", "4h", "1d"],
    stages: [
      { id: "range", label: "区间有效", evidence: ["上下边界均可量化", "价格尚未有效突破区间"] },
      { id: "edge", label: "到达区间边缘", evidence: ["处于边缘而非区间中部", "目标前有足够空间"] },
      { id: "reject", label: "出现反转确认", evidence: ["拒绝K线、吞没或收盘回收", "确认发生在到达边缘之后"] },
      { id: "execute", label: "风控复核并执行", evidence: ["账户与行情事实新鲜", "确定性风控全部通过"] }
    ],
    parameterBounds: { stageCount: [2, 4], confirmationCount: [1, 4], maxPlanTtlHours: 24 },
    invalidation: ["价格有效突破区间边界", "区间宽度不足以覆盖成本与最低盈亏比", "事实或授权版本过期"],
    exits: ["区间外结构止损", "中轴/对侧边界分批止盈", "区间突破后停止均值回归"]
  },
  {
    id: "false_breakout_reversal",
    version: "1.0.0",
    name: "假突破回归确认",
    nameEn: "False-breakout Reversal",
    summary: "价格越过关键边界后重新收回，只有失败突破得到确认才反向交易。",
    summaryEn: "Trade against a failed breakout only after price reclaims the breached boundary and confirms the reversal.",
    family: "failed_breakout_reversal",
    scenarioTypes: ["fake_breakout", "reversal_reclaim"],
    direction: "both",
    roles: ["day_trader", "swing_trader"],
    regimes: ["震荡", "流动性扫荡", "突破失败"],
    timeframes: ["5m", "15m", "1h", "4h", "1d"],
    stages: [
      { id: "sweep", label: "越过关键边界", evidence: ["边界与越界幅度可量化", "记录越界发生时间"] },
      { id: "reclaim", label: "价格重新收回", evidence: ["收盘回到边界内", "确认K线晚于越界K线"] },
      { id: "reject", label: "反向延续确认", evidence: ["反向结构或成交量确认", "剩余空间满足最低盈亏比"] },
      { id: "execute", label: "风控复核并执行", evidence: ["账户与行情事实新鲜", "确定性风控全部通过"] }
    ],
    parameterBounds: { stageCount: [2, 4], confirmationCount: [1, 4], maxPlanTtlHours: 24 },
    invalidation: ["价格再次沿原突破方向收盘", "反向结构没有在有效期内出现", "事实或授权版本过期"],
    exits: ["失败突破再失效止损", "区间中轴/对侧流动性止盈", "重新突破时停止反向计划"]
  }
].map((product) => Object.freeze({
  ...product,
  schema: STRATEGY_PRODUCT_SCHEMA,
  schemaVersion: STRATEGY_PRODUCT_SCHEMA_VERSION,
  dataRequirements: REQUIRED_DATA,
  executionPolicy: COMMON_EXECUTION,
  validationPolicy: COMMON_VALIDATION
}));

export const STRATEGY_PRODUCTS = Object.freeze(Object.fromEntries(PRODUCTS.map((product) => [product.id, product])));

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

export function strategyVersionHash(product) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(product))).digest("hex");
}

export function validateStrategyProduct(product = {}) {
  const errors = [];
  if (product.schema !== STRATEGY_PRODUCT_SCHEMA) errors.push("schema_invalid");
  if (!/^[a-z0-9_]+$/.test(String(product.id || ""))) errors.push("id_invalid");
  if (!/^\d+\.\d+\.\d+$/.test(String(product.version || ""))) errors.push("version_invalid");
  if (!product.name || !product.nameEn) errors.push("localized_name_required");
  if (!VALID_DIRECTIONS.has(product.direction)) errors.push("direction_invalid");
  if (!Array.isArray(product.scenarioTypes) || !product.scenarioTypes.length || product.scenarioTypes.some((item) => !VALID_SCENARIOS.has(item))) errors.push("scenario_types_invalid");
  if (!Array.isArray(product.stages) || product.stages.length < 2 || product.stages.length > 4) errors.push("stages_invalid");
  if (!Array.isArray(product.timeframes) || !product.timeframes.length) errors.push("timeframes_required");
  if (product.executionPolicy?.exchange !== "OKX" || product.executionPolicy?.llmMayBypassContract !== false) errors.push("execution_policy_invalid");
  if (!product.executionPolicy?.requiresHardRiskGate || !product.executionPolicy?.requiresEvidenceBundle) errors.push("safety_gate_required");
  if (!product.validationPolicy?.ownerAuthorizedLiveObservationAllowed) errors.push("live_observation_policy_missing");
  return { valid: errors.length === 0, errors };
}

function versionId(product) { return `${product.id}@${product.version}`; }
function eventId() { return `strategy_event_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`; }

export function syncNativeStrategyProducts(db, at = new Date().toISOString()) {
  db.strategyVersions ||= [];
  db.strategyDeployments ||= [];
  db.strategyVersionEvents ||= [];
  const firstInstall = db.strategyVersions.length === 0;
  if (firstInstall) {
    // 升级前已存在的计划没有在创建时见过这份合同，不能事后冒充“当时已钉住 v1.0.0”。
    // 保留执行兼容，但明确排除在版本化证据之外；新计划必须从创建时绑定。
    for (const plan of db.tradePlans || []) {
      if (!plan.strategyRef) {
        plan.strategyRef = {
          classification: "legacy_pre_product_layer",
          bindingError: "created_before_strategy_product_versioning",
          boundAt: at,
          bindingSource: "upgrade_migration"
        };
      }
    }
  }
  const drift = [];
  const created = [];
  for (const product of PRODUCTS) {
    const validation = validateStrategyProduct(product);
    if (!validation.valid) throw new Error(`策略产品 ${product.id}@${product.version} 非法：${validation.errors.join(",")}`);
    const id = versionId(product);
    const contentHash = strategyVersionHash(product);
    const existing = db.strategyVersions.find((row) => row.id === id);
    if (existing) {
      if (existing.contentHash !== contentHash) drift.push({ id, storedHash: existing.contentHash, codeHash: contentHash });
    } else {
      db.strategyVersions.unshift({ id, productId: product.id, version: product.version, contentHash, definition: product, immutable: true, createdAt: at });
      created.push(id);
    }
    if (!db.strategyDeployments.some((row) => row.productId === product.id && row.version === product.version)) {
      const deployment = {
        id: `deployment:${id}`,
        productId: product.id,
        version: product.version,
        versionId: id,
        state: "owner_live_observation",
        evidenceStatus: "insufficient",
        reason: "所有者选择使用小额实盘积累证据；当前不是已验证策略",
        updatedAt: at,
        createdAt: at
      };
      db.strategyDeployments.unshift(deployment);
      db.strategyVersionEvents.unshift({ ...deployment, id: eventId(), deploymentId: deployment.id, event: "INITIALIZED", actor: "System", at });
    }
  }
  return { created, drift };
}

export function resolveStrategyProduct(plan = {}) {
  const raw = String(plan.scenario?.type || plan.scenarioType || plan.setupType || "").trim().toLowerCase();
  const scenarioType = raw === "trend_continuation" ? "trend_pullback" : raw;
  const product = PRODUCTS.find((item) => item.scenarioTypes.includes(scenarioType)) || null;
  if (!product) return { product: null, scenarioType: scenarioType || "unclassified", reason: "scenario_not_productized" };
  const direction = String(plan.direction || "").toLowerCase();
  if (product.direction !== "both" && direction && product.direction !== direction) {
    return { product: null, scenarioType, reason: "product_direction_mismatch", expectedDirection: product.direction };
  }
  return { product, scenarioType, reason: null };
}

function buildStrategyInstance(plan, resolved, versionIdValue, instantiatedAt) {
  return {
    schema: "trading.strategy.instance",
    schemaVersion: 1,
    productVersionId: versionIdValue,
    direction: String(plan.direction || "").toLowerCase(),
    timeframe: String(plan.timeframe || "1h").toLowerCase(),
    traderRole: plan.traderRole || null,
    executionMode: plan.executionMode || "immediate",
    scenarioType: resolved.scenarioType,
    scenarioSpecVersion: plan.scenario?.version || null,
    executableStages: (plan.scenario?.stages || []).map((stage) => ({
      id: stage.id,
      label: stage.label,
      trigger: stable(stage.trigger || null)
    })),
    invalidation: stable(plan.scenario?.invalidation || null),
    parameters: {
      entryRange: Array.isArray(plan.entry_range) ? plan.entry_range.map(Number) : null,
      stopLoss: Number.isFinite(Number(plan.stopLoss ?? plan.stop_loss)) ? Number(plan.stopLoss ?? plan.stop_loss) : null,
      takeProfits: (plan.takeProfit || plan.take_profit || []).map(Number).filter(Number.isFinite),
      leverage: Number.isFinite(Number(plan.leverage)) ? Number(plan.leverage) : null,
      riskPercent: Number.isFinite(Number(plan.entry?.riskPercent ?? plan.max_loss_pct)) ? Number(plan.entry?.riskPercent ?? plan.max_loss_pct) : null
    },
    evidenceRefs: (plan.evidenceIds || []).slice(0, 12),
    instantiatedAt
  };
}

function strategyInstanceHash(instance) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(instance))).digest("hex");
}

export function bindPlanToStrategyProduct(db, plan, options = {}) {
  if (!plan || typeof plan !== "object") return { ok: false, error: "plan_required" };
  syncNativeStrategyProducts(db);
  const resolved = resolveStrategyProduct(plan);
  if (!resolved.product) {
    plan.strategyRef = {
      classification: "legacy_unclassified",
      scenarioType: resolved.scenarioType,
      bindingError: resolved.reason,
      boundAt: new Date().toISOString(),
      bindingSource: options.source || "deterministic_inference"
    };
    return { ok: false, error: resolved.reason, strategyRef: plan.strategyRef };
  }
  const product = resolved.product;
  const timeframe = String(plan.timeframe || "1h").toLowerCase();
  if (!product.timeframes.includes(timeframe)) {
    plan.strategyRef = { classification: "contract_mismatch", productId: product.id, version: product.version, bindingError: "product_timeframe_mismatch", boundAt: new Date().toISOString() };
    return { ok: false, error: "product_timeframe_mismatch", strategyRef: plan.strategyRef };
  }
  if (plan.traderRole && !product.roles.includes(plan.traderRole)) {
    plan.strategyRef = { classification: "contract_mismatch", productId: product.id, version: product.version, bindingError: "product_role_mismatch", boundAt: new Date().toISOString() };
    return { ok: false, error: "product_role_mismatch", strategyRef: plan.strategyRef };
  }
  const stored = db.strategyVersions.find((row) => row.id === versionId(product));
  if (!stored || stored.contentHash !== strategyVersionHash(product)) {
    plan.strategyRef = { classification: "version_drift", productId: product.id, version: product.version, bindingError: "strategy_version_hash_mismatch", boundAt: new Date().toISOString() };
    return { ok: false, error: "strategy_version_hash_mismatch", strategyRef: plan.strategyRef };
  }
  const deployment = db.strategyDeployments.find((row) => row.productId === product.id && row.version === product.version);
  const boundAt = new Date().toISOString();
  const strategyInstance = buildStrategyInstance(plan, resolved, stored.id, boundAt);
  plan.strategyRef = {
    classification: "strategy_product",
    productId: product.id,
    version: product.version,
    versionId: stored.id,
    contentHash: stored.contentHash,
    scenarioType: resolved.scenarioType,
    lifecycleStateAtBinding: deployment?.state || "research",
    evidenceStatusAtBinding: deployment?.evidenceStatus || "insufficient",
    boundAt,
    bindingSource: options.source || "deterministic_inference"
  };
  plan.strategyRef.instanceHash = strategyInstanceHash(strategyInstance);
  plan.strategyProductId = product.id;
  plan.strategyVersion = product.version;
  plan.strategyVersionId = stored.id;
  plan.strategyInstance = strategyInstance;
  return { ok: true, product, deployment, strategyRef: plan.strategyRef };
}

export function ensurePlanStrategyBinding(db, plan, options = {}) {
  const current = plan?.strategyRef;
  if (current?.classification === "legacy_pre_product_layer") {
    return { ok: false, error: current.bindingError || "legacy_pre_product_layer", strategyRef: current, legacyCompatible: true };
  }
  if (current?.classification === "strategy_product" && current.versionId && current.contentHash) {
    const stored = (db.strategyVersions || []).find((row) => row.id === current.versionId);
    if (stored?.contentHash === current.contentHash) return { ok: true, product: stored.definition, strategyRef: current, existing: true };
  }
  return bindPlanToStrategyProduct(db, plan, options);
}

export function strategyProductExecutionGate(db, plan) {
  const binding = ensurePlanStrategyBinding(db, plan, { source: "execution_gate" });
  if (!binding.ok) return { allowed: false, reason: binding.error || "strategy_product_required", strategyRef: plan?.strategyRef || null };
  const ref = binding.strategyRef || plan.strategyRef;
  const product = STRATEGY_PRODUCTS[ref.productId];
  const resolved = resolveStrategyProduct(plan);
  if (!product || resolved.product?.id !== product.id || !plan.strategyInstance || !ref.instanceHash) {
    return { allowed: false, reason: "strategy_instance_missing_or_mismatched", strategyRef: ref };
  }
  const currentInstance = buildStrategyInstance(plan, resolved, ref.versionId, plan.strategyInstance.instantiatedAt);
  if (strategyInstanceHash(currentInstance) !== ref.instanceHash) {
    return { allowed: false, reason: "strategy_instance_mutated_after_binding", strategyRef: ref };
  }
  const deployment = (db.strategyDeployments || []).find((row) => row.productId === ref.productId && row.version === ref.version);
  if (!deployment) return { allowed: false, reason: "strategy_deployment_missing", strategyRef: ref };
  if (!new Set(["owner_live_observation", "validated_active"]).has(deployment.state)) {
    return { allowed: false, reason: `strategy_state_${deployment.state}`, strategyRef: ref, deployment };
  }
  return {
    allowed: true,
    strategyRef: ref,
    deployment,
    validationLabel: deployment.state === "validated_active" ? "evidence_validated" : "owner_live_observation_unvalidated"
  };
}

function attributedTradeContext(db, fill) {
  const executionOrder = (db.executionOrders || []).find((row) => row.id === fill?.executionOrderId);
  const plan = (db.tradePlans || []).find((row) => row.id === (fill?.tradePlanId || fill?.planId || executionOrder?.planId));
  const versionId = fill?.strategyRef?.versionId || fill?.strategyVersionId
    || executionOrder?.strategyRef?.versionId || executionOrder?.strategyVersionId
    || plan?.strategyRef?.versionId || plan?.strategyVersionId || null;
  return { executionOrder, plan, versionId };
}

export function strategyProductMetrics(db, versionKey) {
  const plans = (db.tradePlans || []).filter((row) => (row.strategyRef?.versionId || row.strategyVersionId) === versionKey);
  const orders = (db.executionOrders || []).filter((row) => (row.strategyRef?.versionId || row.strategyVersionId) === versionKey);
  const trades = [];
  for (const lifecycle of groupClosedTradeLifecycles(db.fills || [])) {
    const fill = lifecycle.representative;
    const { plan, versionId: attributed } = attributedTradeContext(db, fill);
    if (attributed !== versionKey) continue;
    const riskUsdt = Number(fill.initialRiskUsdt ?? plan?.initialRiskUsdt ?? plan?.sizing?.riskAmountUsdt);
    const accountEquityUsdt = Number(fill.accountEquityAtEntryUsdt ?? plan?.accountEquityAtEntryUsdt);
    trades.push({
      gross: Number(lifecycle.realizedPnl || 0),
      entryFees: Number(lifecycle.entryFeeUsdt || 0),
      closeFees: Number(lifecycle.feeUsdt || 0),
      funding: Number(lifecycle.fundingFeeUsdt || 0),
      net: Number(lifecycle.netRealizedPnl || 0),
      riskUsdt: Number.isFinite(riskUsdt) && riskUsdt > 0 ? riskUsdt : null,
      accountEquityUsdt: Number.isFinite(accountEquityUsdt) && accountEquityUsdt > 0 ? accountEquityUsdt : null,
      at: lifecycle.lastClosedAt || null
    });
  }
  const netRows = trades.sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
  const wins = netRows.filter((row) => row.net > 0);
  const grossWin = wins.reduce((sum, row) => sum + row.net, 0);
  const grossLoss = Math.abs(netRows.filter((row) => row.net < 0).reduce((sum, row) => sum + row.net, 0));
  const rRows = netRows.filter((row) => row.riskUsdt).map((row) => row.net / row.riskUsdt);
  let consecutiveLosses = 0;
  for (let index = netRows.length - 1; index >= 0 && netRows[index].net < 0; index -= 1) consecutiveLosses += 1;
  let peak = 0; let equity = 0; let maxDrawdownUsdt = 0;
  for (const row of netRows) {
    equity += row.net;
    peak = Math.max(peak, equity);
    maxDrawdownUsdt = Math.max(maxDrawdownUsdt, peak - equity);
  }
  const netPnlUsdt = netRows.reduce((sum, row) => sum + row.net, 0);
  const grossPnlUsdt = netRows.reduce((sum, row) => sum + row.gross, 0);
  const recordedEntryFeesUsdt = netRows.reduce((sum, row) => sum + row.entryFees, 0);
  const recordedCloseFeesUsdt = netRows.reduce((sum, row) => sum + row.closeFees, 0);
  const equityBasisUsdt = netRows.find((row) => row.accountEquityUsdt)?.accountEquityUsdt || null;
  return {
    plans: plans.length,
    executionOrders: orders.length,
    closedTrades: netRows.length,
    wins: wins.length,
    winRatePct: netRows.length ? Number((wins.length / netRows.length * 100).toFixed(1)) : null,
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : null,
    profitFactorInfinite: grossLoss === 0 && grossWin > 0,
    grossPnlUsdt: Number(grossPnlUsdt.toFixed(4)),
    recordedEntryFeesUsdt: Number(recordedEntryFeesUsdt.toFixed(4)),
    recordedCloseFeesUsdt: Number(recordedCloseFeesUsdt.toFixed(4)),
    netPnlUsdt: Number(netPnlUsdt.toFixed(4)),
    expectancyR: rRows.length === netRows.length && rRows.length ? Number((rRows.reduce((a, b) => a + b, 0) / rRows.length).toFixed(3)) : null,
    rSampleCount: rRows.length,
    consecutiveLosses,
    maxDrawdownUsdt: Number(maxDrawdownUsdt.toFixed(4)),
    maxDrawdownPct: equityBasisUsdt ? Number((maxDrawdownUsdt / equityBasisUsdt * 100).toFixed(2)) : null,
    equityBasisUsdt,
    lastClosedAt: netRows.at(-1)?.at || null,
    basis: "closed_trade_lifecycle/net_recorded_costs/version_pinned"
  };
}

export function assessStrategyProductEvidence(product, metrics) {
  const policy = product.validationPolicy || COMMON_VALIDATION;
  const checks = [
    { key: "closed_trades", passed: metrics.closedTrades >= policy.minClosedTradesForValidation, actual: metrics.closedTrades, required: policy.minClosedTradesForValidation },
    { key: "profit_factor", passed: metrics.profitFactorInfinite || (metrics.profitFactor !== null && metrics.profitFactor >= policy.minProfitFactor), actual: metrics.profitFactorInfinite ? "∞" : metrics.profitFactor, required: policy.minProfitFactor },
    { key: "expectancy_r", passed: metrics.expectancyR !== null && metrics.expectancyR > policy.minExpectancyR, actual: metrics.expectancyR, required: `>${policy.minExpectancyR}` },
    { key: "consecutive_losses", passed: metrics.consecutiveLosses <= policy.maxConsecutiveLossesForValidation, actual: metrics.consecutiveLosses, required: `<=${policy.maxConsecutiveLossesForValidation}` }
  ];
  return { qualified: checks.every((check) => check.passed), checks, sampleHonest: metrics.rSampleCount === metrics.closedTrades };
}

export function reconcileStrategyProductHealth(db, actor = "StrategyEvidenceMonitor") {
  syncNativeStrategyProducts(db);
  const degraded = [];
  for (const deployment of db.strategyDeployments || []) {
    // “已验证”不是永久勋章。只有已转正版本会自动降级；实盘观察阶段仍由账户级
    // 连亏/回撤保护管理，避免用少量早期样本反复启停观察。
    if (deployment.state !== "validated_active") continue;
    const product = STRATEGY_PRODUCTS[deployment.productId];
    if (!product || product.version !== deployment.version) continue;
    const metrics = strategyProductMetrics(db, versionId(product));
    const poor = metrics.closedTrades >= 10 && (
      (metrics.profitFactor !== null && metrics.profitFactor < 0.8)
      || (metrics.expectancyR !== null && metrics.expectancyR <= -0.1)
      || metrics.consecutiveLosses >= 5
    );
    if (!poor) continue;
    const from = deployment.state;
    deployment.state = "degraded";
    deployment.evidenceStatus = "failed_live_health";
    deployment.reason = `真实表现降级：${metrics.closedTrades}笔，PF ${metrics.profitFactor ?? "—"}，期望 ${metrics.expectancyR ?? "—"}R，连亏 ${metrics.consecutiveLosses}`;
    deployment.updatedAt = new Date().toISOString();
    db.strategyVersionEvents.unshift({
      id: eventId(), event: "AUTO_DEGRADED", productId: product.id, version: product.version,
      versionId: versionId(product), from, to: "degraded", reason: deployment.reason,
      actor, at: deployment.updatedAt, evidenceSnapshot: { metrics }
    });
    degraded.push({ productId: product.id, version: product.version, metrics, reason: deployment.reason });
  }
  return { degraded };
}

export function buildStrategyProductCatalog(db) {
  syncNativeStrategyProducts(db);
  const products = PRODUCTS.map((definition) => {
    const id = versionId(definition);
    const stored = db.strategyVersions.find((row) => row.id === id);
    const deployment = db.strategyDeployments.find((row) => row.productId === definition.id && row.version === definition.version);
    const metrics = strategyProductMetrics(db, id);
    const evidence = assessStrategyProductEvidence(definition, metrics);
    return {
      id: definition.id,
      version: definition.version,
      versionId: id,
      contentHash: stored?.contentHash || strategyVersionHash(definition),
      definition,
      deployment: { ...deployment, evidenceStatus: evidence.qualified ? "qualified" : "insufficient" },
      metrics,
      evidence,
      immutable: stored?.immutable === true
    };
  });
  return {
    schema: "trading.strategy.product.catalog",
    generatedAt: new Date().toISOString(),
    products,
    summary: {
      total: products.length,
      liveObservation: products.filter((row) => row.deployment?.state === "owner_live_observation").length,
      validatedActive: products.filter((row) => row.deployment?.state === "validated_active" && row.evidence.qualified).length,
      paused: products.filter((row) => ["paused", "degraded", "retired"].includes(row.deployment?.state)).length,
      evidenceQualified: products.filter((row) => row.evidence.qualified).length
    }
  };
}

const TRANSITIONS = Object.freeze({
  research: new Set(["historical_validation", "owner_live_observation", "paused", "retired"]),
  historical_validation: new Set(["research", "owner_live_observation", "validated_active", "paused", "degraded"]),
  owner_live_observation: new Set(["validated_active", "paused", "degraded", "retired"]),
  validated_active: new Set(["paused", "degraded", "retired"]),
  paused: new Set(["research", "historical_validation", "owner_live_observation", "retired"]),
  degraded: new Set(["research", "paused", "retired"]),
  retired: new Set()
});

export function transitionStrategyProduct(db, productId, version, targetState, options = {}) {
  syncNativeStrategyProducts(db);
  if (!STATE_SET.has(targetState)) throw Object.assign(new Error("strategy_state_invalid"), { status: 400 });
  const product = STRATEGY_PRODUCTS[productId];
  if (!product || product.version !== version) throw Object.assign(new Error("strategy_version_not_found"), { status: 404 });
  const deployment = db.strategyDeployments.find((row) => row.productId === productId && row.version === version);
  if (!deployment) throw Object.assign(new Error("strategy_deployment_not_found"), { status: 404 });
  if (deployment.state === targetState) return { deployment, unchanged: true };
  if (!TRANSITIONS[deployment.state]?.has(targetState)) throw Object.assign(new Error(`strategy_transition_forbidden:${deployment.state}->${targetState}`), { status: 409 });
  const reason = String(options.reason || "").trim();
  if (!reason) throw Object.assign(new Error("strategy_transition_reason_required"), { status: 400 });
  const metrics = strategyProductMetrics(db, versionId(product));
  const evidence = assessStrategyProductEvidence(product, metrics);
  if (targetState === "validated_active" && !evidence.qualified) {
    throw Object.assign(new Error("strategy_evidence_not_qualified"), { status: 409, evidence });
  }
  const previousState = deployment.state;
  deployment.state = targetState;
  deployment.evidenceStatus = evidence.qualified ? "qualified" : "insufficient";
  deployment.reason = reason;
  deployment.updatedAt = new Date().toISOString();
  db.strategyVersionEvents.unshift({
    id: eventId(), event: "STATE_TRANSITION", productId, version, versionId: versionId(product),
    from: previousState, to: targetState, reason, actor: options.actor || "System", at: deployment.updatedAt,
    evidenceSnapshot: { qualified: evidence.qualified, metrics }
  });
  return { deployment, evidence, metrics, unchanged: false };
}
