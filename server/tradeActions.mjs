import { activeMandate, appendAudit, appendTrace, id, latestSuccessfulAccountSnapshot, nowIso, reserveOmsOrder, transitionOmsOrder, verifyAuditChain } from "./store.mjs";
import { currentOkxCredentialFingerprint, enabledOkxAccounts, okxContractSpec, okxPositionMode, okxSignedRequest, toOkxSymbol, validateOkxCredentialBinding } from "./exchangeConnector.mjs";
import { validateExchangeOrderContract } from "./exchangeContract.mjs";
import { assessOperationalDegradation, fullAutoSafetyEnforced } from "./professionalRiskGate.mjs";
import { accountMarginCapacity, accountSnapshotFreshness, projectedMarginUsage } from "./tradingCapacity.mjs";
import { evaluateSameSymbolEntryConflict } from "./tradingRoles.mjs";
import { leverageBoundsForMandate } from "./mandatePolicy.mjs";
import { canonicalPositionDirection, canonicalSymbol } from "./positionIdentity.mjs";
import { currentEvidenceReadiness, marketFactFreshness } from "./marketFreshness.mjs";
import { scrubSecrets } from "./secretRedaction.mjs";

// OKX clOrdId 只允许字母+数字(≤32)。下单/撤单/改单必须用同一个清洗函数,否则发出去清洗过、
// 撤单用原值(带下划线)→ OKX 找不到单 → 撤不掉的孤儿单(审计 exch-F2)。全链路统一走它。
export const okxCleanClOrdId = (s) => String(s || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 32);

// ── 交易所精度对齐(OKX/币安通用)──────────────────────────────────────────
// 交易所要求:价格必须是 tickSz 的整数倍、数量必须是 lotSz/stepSize 的整数倍且 ≥ 最小值。
// 引擎/LLM 按 ATR/百分比算出的价格几乎永不是整 tick,不对齐会被交易所直接拒单。
// step 可能是科学计数(PEPE tickSz=1e-9)或非 10 次幂(如 0.5),都要正确处理。
function stepDecimals(step) {
  const s = Number(step);
  if (!Number.isFinite(s) || s <= 0) return 0;
  const str = s.toExponential();                 // 统一成 "m e±n",规避 0.000000001 → "1e-9" 的解析坑
  const [mant, expPart] = str.split("e");
  const exp = Number(expPart) || 0;
  const mantDec = mant.includes(".") ? mant.split(".")[1].length : 0;
  return Math.max(0, mantDec - exp);
}
// 把 value 对齐到 step 的整数倍(round/floor/ceil),返回已消除浮点尾巴的数字。
function roundToStep(value, step, mode = "round") {
  const v = Number(value), s = Number(step);
  if (!Number.isFinite(v) || !Number.isFinite(s) || s <= 0) return Number.isFinite(v) ? v : null;
  const n = mode === "floor" ? Math.floor(v / s + 1e-9) : mode === "ceil" ? Math.ceil(v / s - 1e-9) : Math.round(v / s);
  return Number((n * s).toFixed(stepDecimals(s)));
}
// 生成发给交易所的定点小数字符串(避免 1.23e-7 这种科学计数被拒)。step 缺失则原样返回。
function fmtStep(value, step, mode = "round") {
  if (step == null || !Number.isFinite(Number(step)) || Number(step) <= 0) return value == null ? undefined : String(value);
  const rounded = roundToStep(value, step, mode);
  return rounded == null ? undefined : rounded.toFixed(stepDecimals(step));
}


const WRITE_ACTIONS = new Set(["place_order", "cancel_order", "amend_order", "close_position", "move_stop", "take_profit"]);
const ACTION_TO_MANDATE = {
  place_order: "open",
  cancel_order: "cancel",
  amend_order: "amend",
  close_position: "close",
  move_stop: "move_stop",
  take_profit: "take_profit"
};
const TERMINAL_ORDER_STATES = new Set(["filled", "canceled", "cancelled", "mmp_canceled", "rejected", "expired", "closed"]);

// 把内部拦截原因码翻成人话 + 指向对应开关位置，供前端/批准接口/Agent 使用。
const GUARD_REASON_DETAIL = {
  live_trading_disabled: { label: "实盘写入总开关未开启", fix: "系统设置 → 实盘灰度 → 勾选「LIVE_TRADING_ENABLED」并同时勾选「风险确认」" },
  real_trading_ack_missing: { label: "尚未确认理解真实交易风险", fix: "系统设置 → 实盘灰度 → 勾选「风险确认」" },
  real_order_write_disabled: { label: "真实下单写入未开启", fix: "系统设置 → 实盘灰度 → 勾选「真实下单写入」" },
  gray_policy_not_enabled: { label: "未启用小额灰度策略", fix: "系统设置 → 实盘灰度 → 勾选「启用小额灰度」并设置额度/币种" },
  symbol_not_allowed_by_gray_policy: { label: "该交易对不在灰度白名单内", fix: "系统设置 → 实盘灰度 → 把该交易对加入灰度允许列表" },
  notional_exceeds_gray_limit: { label: "下单名义额超过灰度上限", fix: "系统设置 → 实盘灰度 → 调高「单笔灰度额度」或减小下单量" },
  manual_approval_required: { label: "灰度策略要求人工确认", fix: "在批准时确认，或在实盘灰度里关闭「保留人工确认」" },
  kill_switch_enabled: { label: "一键熔断已开启，禁止新交易", fix: "顶部「熔断」按钮解除，或在风控里关闭熔断" },
  audit_chain_invalid: { label: "审计链校验未通过", fix: "联系管理员核对审计链；异常清除后才允许实盘写入" },
  api_key_metadata_missing: { label: "缺少该交易所的 API Key 元数据", fix: "系统设置 → 交易所 → 添加只读/交易 API Key" },
  api_key_withdraw_permission_enabled: { label: "该 API Key 带提现权限（禁止）", fix: "去交易所把该 Key 的提现权限关闭后重新配置" },
  api_key_permission_unverified: { label: "API Key 权限尚未审计确认", fix: "系统设置 → 交易所 → 确认该 Key 无提现权限" },
  account_snapshot_stale: { label: "账户快照过期，无法据实计算风险", fix: "先在仪表盘/账户里运行一次私有账户同步" },
  account_snapshot_time_invalid: { label: "账户快照时间异常，无法据实计算风险", fix: "校准服务器时间后重新运行 OKX 私有账户同步" },
  account_snapshot_required: { label: "缺少账户快照，无法据实计算风险", fix: "先运行一次 OKX 私有账户同步" },
  available_margin_unavailable: { label: "可用保证金不可用", fix: "检查 OKX 账户同步与 API 读取权限" },
  account_equity_unavailable: { label: "账户权益不可用", fix: "检查 OKX 账户同步与 API 读取权限" },
  projected_margin_limit_exceeded: { label: "成交后预计保证金使用率超限", fix: "减小下单额或先释放已有仓位/挂单占用" },
  same_symbol_position_add_not_authorized: { label: "该交易对已有仓位，未授权追加仓位", fix: "先平仓，或在资金与交易边界中明确允许追加仓位" },
  same_symbol_order_in_flight: { label: "该交易对已有入场订单正在处理", fix: "等待、撤销或结束旧订单后再提交" },
  mandate_not_found: { label: "未找到可用授权委托 Mandate", fix: "先创建并激活一个 Mandate（可让 AI 交易员协助）" },
  mandate_action_not_allowed: { label: "该动作不在 Mandate 允许范围内", fix: "调整 Mandate 的允许动作或改用允许的动作" },
  duplicate_client_order_id: { label: "重复的客户端订单号", fix: "稍后重试或换一个订单" },
  invalid_order_leverage: { label: "下单杠杆缺失或非法", fix: "重新生成交易计划，让系统按当前授权区间选择杠杆" },
  leverage_below_mandate: { label: "下单杠杆低于授权下限", fix: "重新生成计划；系统会在计划阶段校正并重新计算仓位" },
  leverage_exceeds_mandate: { label: "下单杠杆超过授权上限", fix: "重新生成计划；系统会在计划阶段校正并重新计算仓位" }
};

export function describeGuardReason(reason) {
  if (!reason) return null;
  const detail = GUARD_REASON_DETAIL[reason];
  if (detail) return { code: reason, ...detail };
  return { code: reason, label: reason, fix: "" };
}

export async function executeTradeAction(db, action, payload = {}) {
  if (action === "place_order" && !payload.clientOrderId) payload = { ...payload, clientOrderId: id("coid") };
  if (action === "close_position" && !payload.clientOrderId) {
    const seed = payload.emergencyActionId || payload.tradePlanId || payload.planId
      || `${payload.symbol || "position"}${payload.positionSide || payload.posSide || "net"}`;
    payload = { ...payload, clientOrderId: okxCleanClOrdId(`close${seed}`) };
  }
  const enabledAccounts = enabledOkxAccounts(db);
  const emergencyReduction = ["cancel_order", "close_position"].includes(action)
    && /^emergency_[a-z0-9_-]+$/i.test(String(payload.emergencyActionId || ""));
  const requiredCapability = emergencyReduction ? "emergency_reduce" : "trade";
  if (enabledAccounts.length > 1) return { status: "blocked", reason: "multiple_okx_accounts_share_single_credential" };
  if (enabledAccounts.length === 1) {
    if (payload.accountId && payload.accountId !== enabledAccounts[0].id) return { status: "blocked", reason: "okx_account_binding_mismatch" };
    payload = {
      ...payload,
      accountId: payload.accountId || enabledAccounts[0].id,
      apiKeyFingerprint: payload.apiKeyFingerprint || enabledAccounts[0].apiKeyFingerprint || currentOkxCredentialFingerprint()
    };
  }
  if (enabledAccounts.length && !validateOkxCredentialBinding(db, {
    accountId: payload.accountId,
    executionFingerprint: payload.apiKeyFingerprint,
    requiredCapability
  }).ok) {
    const binding = validateOkxCredentialBinding(db, { accountId: payload.accountId, executionFingerprint: payload.apiKeyFingerprint, requiredCapability });
    return { status: "blocked", reason: binding.reason, binding };
  }
  const prepared = await prepareTradeActionPayload(db, action, payload);
  if (!prepared.allowed) return { status: "blocked", reason: prepared.reason, preparation: prepared };
  payload = prepared.payload;
  const guard = validateWriteGuard(db, action, payload);
  if (!guard.allowed) {
    appendAudit(db, `交易写操作被拦截：${guard.reason}`, action, "TradeActionGateway", "warning");
    appendTrace(db, "trade_write_guard", `${action} blocked`, "blocked");
    return { status: "blocked", reason: guard.reason, guard };
  }

  const exchange = String(payload.exchange || "OKX").toUpperCase();
  // 幂等预留键与交易所载荷解耦：撤单/平仓/改单在交易所侧必须复用原单的 clientOrderId（origClientOrderId 语义），
  // 但 OMS 预留若直接用它会撞上入场单的预留行、被误判 payload 冲突——导致保护失败撤入场/手动撤单永远被拦。
  // 非 place 动作改用「动作:原键」派生键：同一撤单重试仍映射同一键（幂等保留），且绝不与入场行冲突。
  const reservationKey = action === "place_order"
    ? payload.clientOrderId
    : (() => {
        const base = payload.actionAttemptId || payload.clientOrderId || payload.exchangeOrderId || payload.orderId || payload.stopClientOrderId || payload.targets?.[0]?.clientOrderId;
        return base ? `${action}:${base}` : null; // 无任何标识则跳过预留（reserveOmsOrder 返回 not_applicable）
      })();
  const reservation = reserveOmsOrder({
    tenantId: payload.tenantId || "tenant_owner",
    exchange,
    clientOrderId: reservationKey,
    action,
    planId: payload.tradePlanId || payload.planId,
    strategyProductId: payload.strategyProductId || null,
    strategyVersion: payload.strategyVersion || null,
    strategyVersionId: payload.strategyVersionId || null,
    payload
  });
  if (reservation.status === "conflict") {
    appendAudit(db, "客户端订单号与不同请求载荷冲突", payload.clientOrderId, "TradeActionGateway", "critical");
    return { status: "blocked", reason: "idempotency_payload_conflict", order: reservation.order };
  }
  if (reservation.status === "unknown") {
    return {
      status: "unknown_pending",
      reason: "oms_request_state_unknown",
      actionId: reservation.order.id,
      omsOrderId: reservation.order.id,
      exchangeOrderId: reservation.order.exchangeOrderId || null,
      originalStatus: reservation.order.state
    };
  }
  if (reservation.status === "replay") {
    // 展开存储的交易所响应必须在前：其内部的 status 等字段不得覆盖幂等标记（键序敏感，勿调换）。
    return {
      ...(reservation.order.response || {}),
      status: "idempotent_replay",
      actionId: reservation.order.id,
      exchangeOrderId: reservation.order.exchangeOrderId,
      clientOrderId: reservation.order.clientOrderId,
      originalStatus: reservation.order.state
    };
  }

  let result;
  try {
    result = await executeOkxAction(action, payload);
  } catch (error) {
    if (reservation.order?.id) {
      transitionOmsOrder(reservation.order.id, "UNKNOWN", { eventType: "exchange_call_failed", response: { error: error.message } });
    }
    throw error;
  }
  if (reservation.order?.id) {
    const accepted = ["ok", "submitted", "amend_pending"].includes(result.status);
    transitionOmsOrder(reservation.order.id, accepted ? "ACKNOWLEDGED" : "REJECTED", {
      eventType: accepted ? "exchange_acknowledged" : "exchange_rejected",
      exchangeOrderId: result.exchangeOrderId,
      response: sanitizeExchangeResult(result)
    });
  }

  const record = {
    id: id("order_action"),
    action,
    exchange,
    payloadSummary: summarizePayload(payload),
    result,
    createdAt: nowIso()
  };
  db.orders.unshift({
    id: record.id,
    planId: payload.tradePlanId || payload.planId,
    strategyProductId: payload.strategyProductId || null,
    strategyVersion: payload.strategyVersion || null,
    strategyVersionId: payload.strategyVersionId || null,
    source: "trade_action_history",
    exchange,
    symbol: payload.symbol,
    type: payload.type || action,
    side: payload.side,
    price: payload.price,
    status: result.status || "submitted",
    exchangeOrderId: result.exchangeOrderId,
    omsOrderId: reservation.order?.id || null,
    amendRequestId: result.reqId || payload.amendRequestId || null,
    desiredContracts: result.desiredContracts ?? null,
    desiredPrice: result.desiredPrice ?? null,
    protection: result.protection || null,
    clientOrderId: payload.clientOrderId || result.clientOrderId,
    reduceOnly: payload.reduceOnly === true || payload.closePosition === true,
    raw: result.raw ? "[stored_in_audit]" : undefined,
    createdAt: record.createdAt
  });
  appendAudit(db, `执行交易写操作：${action}`, record.id, "TradeExecutor", result.status === "ok" ? "info" : "warning");
  appendTrace(db, "trade_write", `${exchange} ${action}`, result.status || "submitted");
  return { status: result.status || "submitted", actionId: record.id, omsOrderId: reservation.order?.id || null, ...result };
}

export function validateWriteGuard(db, action, payload) {
  if (!WRITE_ACTIONS.has(action)) return { allowed: false, reason: "unknown_action" };
  const shape = validatePayloadShape(action, payload);
  if (!shape.allowed) return shape;
  const contract = validateExchangeOrderContract(action, payload);
  if (!contract.ok) return { allowed: false, reason: contract.reason, contract };
  const reduction = classifyAuthoritativeRiskReduction(db, action, payload);
  if (reduction.blocked) return { allowed: false, reason: reduction.reason, riskReduction: reduction };
  const riskReducing = reduction.riskReducing === true;
  const boundAccount = (db.exchangeAccounts || []).find((row) => row.exchange === "OKX"
    && (!payload.accountId || row.id === payload.accountId) && (row.readEnabled || row.tradeEnabled));
  const emergencyReduction = riskReducing && ["cancel_order", "close_position"].includes(action)
    && /^emergency_[a-z0-9_-]+$/i.test(String(payload.emergencyActionId || ""));
  if (boundAccount && boundAccount.tradeEnabled !== true && !emergencyReduction) {
    return { allowed: false, reason: "okx_account_trade_disabled", accountId: boundAccount.id };
  }
  if (String(payload.exchange || "OKX").toUpperCase() !== "OKX") {
    return { allowed: false, reason: "autonomous_exchange_must_be_okx" };
  }
  // 只减仓模式:此前 reduceOnlyMode 只是展示标签,无任何执行点(审计 P1-8)。
  if (!riskReducing && db.system?.reduceOnlyMode) return { allowed: false, reason: "reduce_only_mode" };
  if (!riskReducing && !db.system.liveTradingEnabled) return { allowed: false, reason: "live_trading_disabled" };
  if (!riskReducing && !(db.system.realTradingAck === true || process.env.I_UNDERSTAND_REAL_TRADING === "true")) return { allowed: false, reason: "real_trading_ack_missing" };
  if (!riskReducing && !(db.system.orderWriteEnabled === true || process.env.REAL_ORDER_WRITE_ENABLED === "true")) return { allowed: false, reason: "real_order_write_disabled" };
  if (!riskReducing) {
    const apiKeySafety = validateApiKeySafety(db, payload);
    if (!apiKeySafety.allowed) return apiKeySafety;
  }
  if (!riskReducing && process.env.REQUIRE_AUDIT_CHAIN_OK !== "false") {
    const auditChain = verifyAuditChain(db);
    if (!auditChain.ok) return { allowed: false, reason: "audit_chain_invalid", breaks: auditChain.breaks.length };
  }
  // 紧急撤单/平仓使用独立 EmergencyAction 来源链，不依赖普通开仓计划五元组。
  // 只对真正降风险的 cancel/close 开放，reduceOnly place_order 等仍必须带完整交易来源。
  const emergencyRiskAction = riskReducing
    && ["cancel_order", "close_position"].includes(action)
    && /^emergency_[a-z0-9_-]+$/i.test(String(payload.emergencyActionId || ""));
  const provenance = emergencyRiskAction
    ? { allowed: true, emergencyActionId: payload.emergencyActionId }
    : validateExecutionProvenance(payload);
  if (!provenance.allowed) return provenance;
  if (!riskReducing && db.system.killSwitch) return { allowed: false, reason: "kill_switch_enabled" };

  const mandateGuard = riskReducing ? { allowed: true, mandateId: payload.mandateId } : validateMandateGuard(db, action, payload);
  if (!mandateGuard.allowed) return mandateGuard;

  const isNewEntry = action === "place_order" && !payload.reduceOnly && !payload.closePosition;
  if (isNewEntry) {
    if (!payload.evidenceBundleId) return { allowed: false, reason: "missing_evidence_bundle_provenance" };
    const evidenceBundle = (db.evidenceBundles || []).find((bundle) => bundle.id === payload.evidenceBundleId);
    if (!evidenceBundle) {
      return { allowed: false, reason: "evidence_bundle_not_found", evidenceBundleId: payload.evidenceBundleId };
    }
    const market = (db.markets || []).find((row) => row.symbol === payload.symbol) || {};
    const freshness = marketFactFreshness(market);
    if (!freshness.ticker.ok) return { allowed: false, reason: freshness.ticker.reason === "future_timestamp" ? "ticker_time_invalid" : "ticker_stale", freshness };
    if (!freshness.micro.ok) return { allowed: false, reason: freshness.micro.reason === "future_timestamp" ? "micro_time_invalid" : "micro_stale", freshness };
    const evidence = currentEvidenceReadiness(evidenceBundle, payload.symbol);
    if (!evidence.ok) return { allowed: false, reason: "evidence_readiness_expired", evidence };
    // 只有开了 professionalRiskMode 才把运行降级当硬闸;否则不拦(reduceOnlyMode 另有独立检查)。
    const operational = assessOperationalDegradation(db);
    if (operational.degraded && fullAutoSafetyEnforced(db)) return { allowed: false, reason: "operational_degraded_reduce_only", degradation: operational };
    const accountSnapshot = validateFreshAccountSnapshot(db, payload);
    if (!accountSnapshot.allowed) return accountSnapshot;
  }
  if (riskReducing) return {
    allowed: true,
    riskReducing: true,
    mandateId: payload.mandateId,
    emergencyActionId: emergencyRiskAction ? payload.emergencyActionId : null
  };

  const policy = (db.grayReleasePolicies || []).find((item) => item.enabled);
  if (!policy) return { allowed: false, reason: "gray_policy_not_enabled" };
  if (payload.symbol && payload.oneShotAuth !== true && policy.allowedSymbols?.length && !policy.allowedSymbols.includes(payload.symbol)) return { allowed: false, reason: "symbol_not_allowed_by_gray_policy" };

  const notional = estimateNotional(payload);
  const maxNotional = Number(policy.maxNotionalUsdt || process.env.MAX_LIVE_NOTIONAL_USDT || 50);
  if (!Number.isFinite(notional) || notional <= 0) {
    return { allowed: false, reason: "authoritative_notional_unavailable", notional: null, maxNotional };
  }
  if (notional > maxNotional) return { allowed: false, reason: "notional_exceeds_gray_limit", notional, maxNotional };
  if (policy.requiresManualApproval && payload.manualApproval !== true) return { allowed: false, reason: "manual_approval_required" };
  return { allowed: true, notional, maxNotional, policyId: policy.id, mandateId: mandateGuard.mandateId };
}

const trueLike = (value) => value === true || String(value).toLowerCase() === "true";
const finitePositive = (value) => value !== null && value !== undefined && value !== ""
  && Number.isFinite(Number(value)) && Number(value) > 0;
const finiteNonZero = (value) => value !== null && value !== undefined && value !== ""
  && Number.isFinite(Number(value)) && Math.abs(Number(value)) > 0;

function sameOrderIdentity(order = {}, payload = {}) {
  const orderId = String(order.ordId || order.exchangeOrderId || "");
  const clientOrderId = String(order.clOrdId || order.clientOrderId || order.algoClOrdId || "");
  return Boolean((payload.orderId && orderId === String(payload.orderId))
    || (payload.clientOrderId && clientOrderId === okxCleanClOrdId(payload.clientOrderId))
    || (payload.stopClientOrderId && clientOrderId === okxCleanClOrdId(payload.stopClientOrderId)));
}

function reductionSnapshot(db, payload) {
  const snapshot = latestSuccessfulAccountSnapshot(db, {
    exchange: "OKX",
    accountId: payload.accountId || undefined
  });
  const freshness = accountSnapshotFreshness(snapshot, {
    maxAgeMs: Number(process.env.MAX_RISK_REDUCTION_SNAPSHOT_AGE_MS || process.env.MAX_ACCOUNT_SNAPSHOT_AGE_MS || 600000)
  });
  if (!freshness.ok) return { snapshot: null, reason: freshness.error };
  const binding = validateOkxCredentialBinding(db, {
    accountId: payload.accountId || snapshot?.accountId,
    snapshot,
    executionFingerprint: payload.apiKeyFingerprint
  });
  if (!binding.ok) return { snapshot: null, reason: binding.reason };
  return { snapshot, freshness };
}

function snapshotPositionQuantity(position = {}) {
  const direct = position.coinSize ?? position.quantity;
  if (finitePositive(direct)) return Math.abs(Number(direct));
  const contracts = position.contractSize ?? position.pos ?? position.size;
  const ctVal = position.ctVal ?? position.contractMultiplier;
  if (finiteNonZero(contracts) && finitePositive(ctVal)) return Math.abs(Number(contracts) * Number(ctVal));
  return null;
}

function closeDirectionForPayload(payload = {}) {
  const posSide = canonicalPositionDirection(payload.posSide || payload.positionSide);
  if (posSide) return posSide;
  const side = String(payload.side || "").toLowerCase();
  if (side === "sell") return "long";
  if (side === "buy") return "short";
  return null;
}

function authoritativePositionFor(db, payload, snapshot) {
  const symbol = canonicalSymbol(payload.symbol);
  const direction = closeDirectionForPayload(payload);
  if (!symbol || !direction) return null;
  const rows = snapshot?.positions || [];
  const raw = rows.find((row) => canonicalSymbol(row.instId || row.symbol) === symbol
    && canonicalPositionDirection(row, row.pos) === direction
    && finiteNonZero(row.rawSignedPosition ?? row.pos ?? row.coinSize ?? row.quantity ?? row.contractSize ?? row.size));
  if (raw) return { row: raw, quantity: snapshotPositionQuantity(raw), source: "account_snapshot" };
  return null;
}

function linkedEntryExecution(db, payload) {
  return (db.executionOrders || []).find((row) => {
    if (payload.executionOrderId && row.id !== payload.executionOrderId) return false;
    const identity = (payload.orderId && row.exchangeOrderId === payload.orderId)
      || (payload.clientOrderId && row.clientOrderId === okxCleanClOrdId(payload.clientOrderId));
    return identity && ["created", "entry_unknown_pending", "submitted", "entry_pending", "entry_partial", "cancel_pending", "cancel_unknown_pending", "protection_failure_cancel_pending"].includes(row.status);
  }) || null;
}

// “降风险”是一项需要被事实证明的属性，不能由调用方的 reduceOnly/emergencyActionId 声明。
// OKX 双向模式会忽略 reduceOnly，因此必须同时验证当前真实持仓和 side+posSide 的平仓组合。
export function classifyAuthoritativeRiskReduction(db, action, payload = {}) {
  const claimed = action === "cancel_order" || action === "close_position" || action === "take_profit"
    || action === "move_stop" || trueLike(payload.reduceOnly) || trueLike(payload.closePosition);
  if (!claimed) return { riskReducing: false };

  const { snapshot, reason: snapshotReason } = reductionSnapshot(db, payload);
  if (action === "cancel_order") {
    if (!snapshot) return { blocked: true, reason: snapshotReason || "authoritative_order_snapshot_required" };
    if (snapshot.openOrdersComplete !== true || snapshot.algoOrdersComplete !== true) {
      return { blocked: true, reason: "authoritative_order_snapshot_incomplete" };
    }
    const open = snapshot?.openOrders?.find((row) => sameOrderIdentity(row, payload));
    const algo = snapshot?.algoOrders?.find((row) => sameOrderIdentity(row, payload));
    const localEntry = linkedEntryExecution(db, payload);
    if (algo || (open && trueLike(open.reduceOnly))) {
      return { blocked: true, reason: "cancel_would_remove_protection" };
    }
    if (open && canonicalSymbol(open.instId || open.symbol) === canonicalSymbol(payload.symbol || localEntry?.symbol)) {
      if (localEntry && payload.orderId && String(open.ordId || open.exchangeOrderId) !== String(localEntry.exchangeOrderId)) {
        return { blocked: true, reason: "entry_order_lifecycle_identity_mismatch" };
      }
      return { riskReducing: true, basis: localEntry ? "authoritative_entry_order_and_lifecycle" : "authoritative_orphan_entry_order" };
    }
    return { blocked: true, reason: localEntry ? "remote_entry_order_not_active" : "cancel_entry_identity_unverified" };
  }

  if (action === "close_position" || action === "take_profit" || (action === "place_order" && trueLike(payload.reduceOnly))) {
    if (!snapshot) return { blocked: true, reason: snapshotReason || "authoritative_position_required" };
    const position = authoritativePositionFor(db, payload, snapshot);
    if (!position) return { blocked: true, reason: "authoritative_position_not_found" };
    const expectedDirection = closeDirectionForPayload(payload);
    const side = String(payload.side || (expectedDirection === "long" ? "sell" : "buy")).toLowerCase();
    if ((expectedDirection === "long" && side !== "sell") || (expectedDirection === "short" && side !== "buy")) {
      return { blocked: true, reason: "order_side_would_increase_position" };
    }
    if (action === "take_profit") {
      const targets = Array.isArray(payload.targets) && payload.targets.length ? payload.targets : [payload];
      let total = 0;
      for (const target of targets) {
        const targetSide = String(target.side || side).toLowerCase();
        const targetPosSide = canonicalPositionDirection(target.posSide || target.positionSide || expectedDirection);
        if (targetSide !== side || targetPosSide !== expectedDirection) {
          return { blocked: true, reason: "take_profit_direction_override" };
        }
        if (!finitePositive(target.quantity ?? target.sz ?? payload.quantity)) return { blocked: true, reason: "take_profit_quantity_unavailable" };
        total += Number(target.quantity ?? target.sz ?? payload.quantity);
      }
      if (!finitePositive(position.quantity)) return { blocked: true, reason: "authoritative_position_quantity_unavailable" };
      if (total > position.quantity * 1.000001) return { blocked: true, reason: "reduce_quantity_exceeds_position", requestedQuantity: total, positionQuantity: position.quantity };
    }
    return { riskReducing: true, basis: "fresh_account_position", direction: expectedDirection, positionQuantity: position.quantity };
  }

  if (action === "move_stop") {
    if (!snapshot) return { blocked: true, reason: snapshotReason || "authoritative_position_required" };
    if (snapshot.algoOrdersComplete !== true) return { blocked: true, reason: "authoritative_algo_snapshot_incomplete" };
    const execution = (db.executionOrders || []).find((row) => row.stopClientOrderId
      && okxCleanClOrdId(row.stopClientOrderId) === okxCleanClOrdId(payload.stopClientOrderId || payload.algoClOrdId));
    if (!execution) return { blocked: true, reason: "managed_stop_identity_required" };
    const position = authoritativePositionFor(db, { ...payload, positionSide: execution.direction }, snapshot);
    if (!position) return { blocked: true, reason: "authoritative_position_not_found" };
    const remote = (snapshot.algoOrders || []).find((row) => sameOrderIdentity(row, { stopClientOrderId: execution.stopClientOrderId })
      && canonicalSymbol(row.instId || row.symbol) === canonicalSymbol(execution.symbol));
    if (!remote) return { blocked: true, reason: "managed_stop_not_active_on_exchange" };
    const previous = Number(remote.slTriggerPx ?? remote.triggerPx ?? remote.stopPrice);
    const next = Number(payload.stopPrice ?? payload.stopLoss);
    if (!Number.isFinite(previous) || !Number.isFinite(next) || next <= 0) return { blocked: true, reason: "stop_risk_change_unverifiable" };
    const loosens = execution.direction === "short" ? next > previous : next < previous;
    if (loosens) return { blocked: true, reason: "stop_change_would_increase_risk" };
    return { riskReducing: true, basis: "managed_stop_tightening" };
  }

  return { blocked: true, reason: "risk_reduction_not_proven" };
}

function validateApiKeySafety(db, payload) {
  const exchange = String(payload.exchange || "OKX").toUpperCase();
  const metadata = (db.apiKeyMetadata || []).find((item) => item.exchange === exchange);
  if (!metadata) return { allowed: false, reason: "api_key_metadata_missing", exchange };
  if (metadata.withdrawPermission === true) return { allowed: false, reason: "api_key_withdraw_permission_enabled", exchange };
  // 实盘写入时绝不放行未经审计确认无提现权限的 Key；REQUIRE_API_PERMISSION_VERIFICATION=false 的开发旁路仅在非实盘生效。
  const allowUnverifiedBypass = process.env.REQUIRE_API_PERMISSION_VERIFICATION === "false" && !db.system.liveTradingEnabled;
  if (!allowUnverifiedBypass && !metadata.permissionVerifiedAt) return { allowed: false, reason: "api_key_permission_unverified", exchange };
  return { allowed: true };
}

function validateFreshAccountSnapshot(db, payload) {
  const exchange = String(payload.exchange || "OKX").toUpperCase();
  const snapshot = latestSuccessfulAccountSnapshot(db, { exchange, accountId: payload.accountId });
  const freshness = accountSnapshotFreshness(snapshot);
  if (!freshness.ok) return { allowed: false, reason: freshness.error, exchange, snapshotId: snapshot?.id || null, ...freshness };
  if (exchange === "OKX") {
    const binding = validateOkxCredentialBinding(db, { accountId: payload.accountId, snapshot, executionFingerprint: payload.apiKeyFingerprint });
    if (!binding.ok) return { allowed: false, reason: binding.reason, exchange, snapshotId: snapshot?.id || null, binding };
  }
  return { allowed: true, snapshotId: snapshot.id, ageMs: freshness.ageMs };
}

function validateExecutionProvenance(payload) {
  const required = ["agentRunId", "analysisBundleId", "tradePlanId", "riskCheckId", "mandateId"];
  const missing = required.filter((key) => !payload[key] && !payload[toSnake(key)]);
  if (missing.length) return { allowed: false, reason: "missing_execution_provenance", missing };
  return { allowed: true };
}

function toSnake(key) {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export async function executeOkxAction(action, payload, dependencies = {}) {
  if (!process.env.OKX_API_KEY || !process.env.OKX_API_SECRET || !process.env.OKX_API_PASSPHRASE) return { status: "missing_credentials" };
  const signedRequest = dependencies.signedRequest || okxSignedRequest;
  const resolvePositionMode = dependencies.positionMode || okxPositionMode;
  const resolveContractSpec = dependencies.contractSpec || okxContractSpec;
  const instId = toOkxSymbol(payload.symbol, payload.marketType);
  if (action === "place_order") {
    // OKX SWAP 的 sz 是"张数"(P0):引擎全程用币数量,此处必须除以 ctVal 并对齐 lotSz/minSz。
    // 自家读仓位时早已乘 ctVal 换算(exchangeConnector),下单侧此前却原样透传币数量。
    let okxSz = Number(payload.quantity || payload.size);
    let okxCtVal = null;
    let okxTickSz = null;   // 价格步长(px/止损/止盈价必须对齐),非永续时为 null → 不改价、维持原行为
    let okxLotSz = null;    // 张数步长(sz 必须对齐)
    if (String(payload.marketType || "perpetual_usdt").includes("perp")) {
      const spec = await resolveContractSpec(instId);
      if (!spec) return { status: "instrument_spec_unavailable", instId };
      okxCtVal = spec.ctVal;
      okxTickSz = spec.tickSz;
      const lot = spec.lotSz > 0 ? spec.lotSz : 1;
      okxLotSz = lot;
      const contracts = roundToStep(Math.floor((okxSz / spec.ctVal) / lot + 1e-9) * lot, lot, "floor"); // 向下对齐张数步长,消除浮点尾巴
      if (!(contracts >= (spec.minSz || lot))) {
        return { status: "below_min_size", instId, coinQuantity: okxSz, minContracts: spec.minSz, ctVal: spec.ctVal };
      }
      okxSz = contracts;
    }
    // posMode 是 set-leverage 请求本身的必需事实：isolated + long_short_mode 必须带
    // long/short，不能先按未知模式调用再查询配置。
    const posMode = await resolvePositionMode(payload.accountId);
    if (!posMode) {
      return { status: "position_mode_unknown", instId, reason: "无法确定 OKX 持仓模式，已拒绝发送带猜测 posSide 的订单" };
    }
    const okxSide = String(payload.side || "buy").toLowerCase();
    const okxPosSide = posMode === "long_short_mode"
      ? (payload.posSide || payload.positionSide || (payload.reduceOnly
          ? (okxSide === "sell" ? "long" : "short")
          : (okxSide === "sell" ? "short" : "long")))
      : undefined;
    const marginMode = payload.tdMode || process.env.OKX_MARGIN_MODE || "cross";

    // OKX 必须先 set-leverage,否则新仓用的是账户默认杠杆、plan.leverage 被完全忽略(审计发现:
    // 之前从不设杠杆)。只对新开仓设;失败即 fail-closed,绝不用错误杠杆开仓(保证金/爆仓价会错)。
    if (payload.leverage && !payload.reduceOnly && !payload.closePosition) {
      try {
        const levRes = await signedRequest("/api/v5/account/set-leverage", "POST",
          JSON.stringify({
            instId,
            lever: String(payload.leverage),
            mgnMode: marginMode,
            posSide: marginMode === "isolated" && posMode === "long_short_mode" ? okxPosSide : undefined
          }));
        if (String(levRes.code) !== "0") return { status: "set_leverage_failed", instId, leverage: payload.leverage, reason: levRes.data?.[0]?.sMsg || levRes.msg || `code ${levRes.code}` };
      } catch (error) {
        return { status: "set_leverage_failed", instId, leverage: payload.leverage, reason: String(error.message || error).slice(0, 120) };
      }
    }
    // OKX clOrdId 只允许字母数字(≤32),带下划线整单被 51000 拒——最后一道兜底清洗。
    const okxClOrdId = (s) => String(s).replace(/[^a-zA-Z0-9]/g, "").slice(0, 32);
    // 双向持仓(long_short_mode)必须带 posSide,单向(net_mode)不能带——否则 51000 posSide error。
    // 开仓:卖=空/买=多;平仓(reduceOnly):卖平多/买平空。net 模式下 posSide 留空。
    // net_mode 下 OKX 不接受 reduceOnly 与 posSide 同存;hedge 下用 posSide 平仓、不传 reduceOnly。
    const body = JSON.stringify({
      instId,
      tdMode: marginMode,
      side: okxSide,
      ordType: String(payload.ordType || payload.type || "limit").toLowerCase(),
      sz: fmtStep(okxSz, okxLotSz),                                  // 张数对齐 lotSz、无浮点尾巴
      px: payload.price ? fmtStep(payload.price, okxTickSz) : undefined, // 限价对齐 tickSz,否则 OKX 拒单
      posSide: okxPosSide,
      clOrdId: okxClOrdId(payload.clientOrderId || id("coid")),
      reduceOnly: okxPosSide ? undefined : Boolean(payload.reduceOnly),
      attachAlgoOrds: payload.stopLoss && !payload.reduceOnly ? [{
        attachAlgoClOrdId: okxClOrdId(payload.stopClientOrderId || id("stop")),
        slTriggerPx: fmtStep(payload.stopLoss, okxTickSz),          // 止损触发价也必须对齐 tickSz
        slOrdPx: "-1",
        slTriggerPxType: payload.workingType === "MARK_PRICE" ? "mark" : "last"
      }] : undefined
    });
    const raw = await signedRequest("/api/v5/trade/order", "POST", body);
    const accepted = raw.code === "0" && String(raw.data?.[0]?.sCode || "0") === "0";
    return {
      status: accepted ? "ok" : "exchange_rejected",
      raw,
      exchangeOrderId: raw.data?.[0]?.ordId,
      clientOrderId: raw.data?.[0]?.clOrdId,
      okxCtVal,
      okxContracts: okxSz,
      protection: accepted && payload.stopLoss && !payload.reduceOnly ? { attachedAlgoStop: true, stopLoss: Number(payload.stopLoss) } : null
    };
  }
  if (action === "cancel_order") {
    // clOrdId 必须与下单时同一清洗口径,否则 OKX 找不到单、撤不掉(审计 exch-F2)。有 ordId 则优先用 ordId。
    const raw = await signedRequest("/api/v5/trade/cancel-order", "POST", JSON.stringify({ instId, ordId: payload.orderId, clOrdId: payload.orderId ? undefined : okxCleanClOrdId(payload.clientOrderId) }));
    return { status: okxItemActionAccepted(raw) ? "ok" : "exchange_rejected", raw, reason: raw.data?.[0]?.sMsg || raw.msg || null };
  }
  if (action === "amend_order") {
    if (!finitePositive(payload.preparedAmendContracts) || !finitePositive(payload.preparedAmendPrice)) {
      return { status: "amend_preparation_missing" };
    }
    const reqId = okxCleanClOrdId(payload.amendRequestId || payload.actionAttemptId || id("amend"));
    const raw = await signedRequest("/api/v5/trade/amend-order", "POST", JSON.stringify({
      instId,
      ordId: payload.authoritativeOrderId || payload.orderId,
      clOrdId: (payload.authoritativeOrderId || payload.orderId) ? undefined : okxCleanClOrdId(payload.clientOrderId),
      reqId,
      newSz: String(payload.preparedAmendContracts),
      newPx: String(payload.preparedAmendPrice)
    }));
    const accepted = okxItemActionAccepted(raw);
    // OKX 的 sCode=0 只代表改单请求被接收。最终是否生效必须由 orders channel 的
    // amendResult 或权威订单查询确认，不能在此宣称 amended。
    return {
      status: accepted ? "amend_pending" : "exchange_rejected",
      raw,
      reqId,
      desiredContracts: Number(payload.preparedAmendContracts),
      desiredPrice: Number(payload.preparedAmendPrice),
      reason: raw.data?.[0]?.sMsg || raw.msg || null
    };
  }
  if (action === "close_position") {
    // 平仓也要按持仓模式带对 posSide:双向=long/short(调用方传的是 positionSide),单向=net。
    // 旧代码读 payload.posSide,但调用方(executionEngine)传的是 positionSide → 永远 undefined → 平仓被 posSide error 拒、仓位关不掉。
    const posMode = await resolvePositionMode(payload.accountId);
    if (!posMode) return { status: "position_mode_unknown", instId, reason: "无法确定 OKX 持仓模式，未发送平仓请求" };
    const closePosSide = posMode === "long_short_mode"
      ? (payload.posSide || payload.positionSide)
      : "net";
    const closeClientOrderId = okxCleanClOrdId(payload.clientOrderId);
    const raw = await signedRequest("/api/v5/trade/close-position", "POST", JSON.stringify({
      instId,
      mgnMode: payload.tdMode || process.env.OKX_MARGIN_MODE || "cross",
      posSide: closePosSide,
      // OKX 在存在普通平仓委托时默认会拒绝 close-position。退出动作必须明确请求自动撤销
      // closing orders；算法止损/止盈仍由后续完整 algo snapshot 按持久化 ID 逐项核验清理。
      autoCxl: true,
      clOrdId: closeClientOrderId || undefined
    }));
    const item = raw.data?.[0];
    const accepted = String(raw.code) === "0" && (!item || String(item.sCode || "0") === "0");
    return { status: accepted ? "ok" : "exchange_rejected", raw, exchangeOrderId: item?.ordId || null, clientOrderId: item?.clOrdId || closeClientOrderId || null, reason: item?.sMsg || raw.msg || null };
  }
  if (action === "move_stop") {
    // 入场附加止损在主单成交后会成为算法单，并继承 attachAlgoClOrdId → algoClOrdId。
    // 使用 amend-algos 原地修改，cxlOnFail=false 确保改单失败时旧止损继续有效；绝不取消后重挂，
    // 避免保护空窗和双止损。OKX 官方允许 algoId 或 algoClOrdId 二选一。
    const algoClOrdId = okxCleanClOrdId(payload.stopClientOrderId || payload.algoClOrdId);
    if (!algoClOrdId) return { status: "missing_stop_algo_client_id" };
    const spec = await resolveContractSpec(instId);
    if (!spec?.tickSz) return { status: "instrument_spec_unavailable", instId };
    const newStop = fmtStep(payload.stopPrice || payload.stopLoss, spec.tickSz);
    const raw = await signedRequest("/api/v5/trade/amend-algos", "POST", JSON.stringify({
      instId,
      algoClOrdId,
      cxlOnFail: false,
      reqId: okxCleanClOrdId(payload.requestId || id("amendstop")),
      newSlTriggerPx: newStop,
      newSlOrdPx: "-1",
      newSlTriggerPxType: payload.workingType === "MARK_PRICE" ? "mark" : "last"
    }));
    const accepted = raw.code === "0" && String(raw.data?.[0]?.sCode || "0") === "0";
    return { status: accepted ? "ok" : "exchange_rejected", raw, algoId: raw.data?.[0]?.algoId, algoClOrdId, stopPrice: Number(newStop) };
  }
  if (action === "take_profit") {
    // OKX 止盈是"条件算法单",必须发到 /api/v5/trade/order-algo(带 tpTriggerPx),不是普通下单口
    // (旧代码把 ordType:conditional 发到 /trade/order → 该口不收 → 止盈从来没成功过,审计 exch-F4)。
    // sz 也必须是"张数"(除以 ctVal 对齐 lotSz),tpOrdPx "-1"=触发后市价平。
    const posMode = await resolvePositionMode(payload.accountId);
    if (!posMode) return { status: "position_mode_unknown", instId, reason: "无法确定 OKX 持仓模式，未发送止盈请求" };
    const spec = String(payload.marketType || "perpetual_usdt").includes("perp") ? await resolveContractSpec(instId) : null;
    const toContracts = (coinQty) => {
      if (!spec) return coinQty;
      const lot = spec.lotSz > 0 ? spec.lotSz : 1;
      return Math.floor((Number(coinQty) / spec.ctVal) / lot + 1e-9) * lot;
    };
    const tdMode = payload.tdMode || process.env.OKX_MARGIN_MODE || "cross";
    const targets = Array.isArray(payload.targets) && payload.targets.length ? payload.targets : [payload];
    const orders = [];
    for (const target of targets) {
      const tpSide = String(target.side || payload.side || "sell").toLowerCase();
      // 双向:平多用 posSide long / 平空用 posSide short(sell 平多、buy 平空);单向:reduceOnly 平仓。
      const tpPosSide = posMode === "long_short_mode"
        ? (payload.posSide || payload.positionSide || (tpSide === "sell" ? "long" : "short"))
        : undefined;
      const contracts = toContracts(target.quantity ?? target.sz ?? payload.quantity);
      const rawTrigger = target.stopPrice ?? target.price ?? target.triggerPrice ?? payload.price;
      const algo = {
        instId, tdMode, side: tpSide, ordType: "conditional",
        sz: fmtStep(contracts, spec?.lotSz),                        // 张数对齐 lotSz
        tpTriggerPx: fmtStep(rawTrigger, spec?.tickSz) ?? String(rawTrigger), // 触发价对齐 tickSz
        tpOrdPx: "-1", tpTriggerPxType: "last",
        posSide: tpPosSide,
        reduceOnly: tpPosSide ? undefined : true,
        algoClOrdId: okxCleanClOrdId(target.clientOrderId || id("tp"))
      };
      const raw = await signedRequest("/api/v5/trade/order-algo", "POST", JSON.stringify(algo));
      const accepted = raw.code === "0" && String(raw.data?.[0]?.sCode || "0") === "0";
      orders.push({ status: accepted ? "ok" : "exchange_rejected", raw, algoId: raw.data?.[0]?.algoId, clientOrderId: algo.algoClOrdId });
    }
    const failed = orders.filter((o) => o.status !== "ok");
    return { status: failed.length ? (failed.length === orders.length ? "exchange_rejected" : "partial_failure") : "ok", batch: true, orders, failedCount: failed.length };
  }
  return { status: "unsupported_action" };
}

export function okxItemActionAccepted(raw = {}) {
  const item = Array.isArray(raw.data) ? raw.data[0] : null;
  return String(raw.code) === "0" && Boolean(item) && String(item.sCode) === "0";
}

function estimateNotional(payload) {
  if (Number.isFinite(Number(payload.serverCalculatedNotionalUsdt)) && Number(payload.serverCalculatedNotionalUsdt) > 0) {
    return Number(payload.serverCalculatedNotionalUsdt);
  }
  if (Array.isArray(payload.targets) && payload.targets.length) {
    return payload.targets.reduce((sum, target) => sum + estimateNotional({ ...payload, ...target }), 0);
  }
  const price = Number(payload.price || payload.stopPrice || payload.markPrice || 0);
  const quantity = Number(payload.quantity || payload.size || 0);
  if (!Number.isFinite(price) || !Number.isFinite(quantity)) return 0;
  return Math.abs(price * quantity);
}

export function trustedEntryNotional(payload, market) {
  const quantity = Number(payload.quantity ?? payload.size);
  const trustedPrice = Number(market?.price);
  if (!Number.isFinite(quantity) || quantity <= 0) return { allowed: false, reason: "invalid_order_quantity" };
  if (!Number.isFinite(trustedPrice) || trustedPrice <= 0) return { allowed: false, reason: "trusted_ticker_price_unavailable" };
  const type = String(payload.type || payload.orderType || "MARKET").toUpperCase();
  const bufferedMarketPrice = trustedPrice * 1.01;
  let riskPrice = bufferedMarketPrice;
  if (!type.includes("MARKET")) {
    const requestedPrice = Number(payload.price);
    if (!Number.isFinite(requestedPrice) || requestedPrice <= 0) return { allowed: false, reason: "invalid_limit_price" };
    const deviation = Math.abs(requestedPrice - trustedPrice) / trustedPrice;
    if (deviation > 0.1) return { allowed: false, reason: "order_price_deviation_exceeded", deviation };
    riskPrice = Math.max(requestedPrice, bufferedMarketPrice);
  }
  return { allowed: true, trustedPrice, riskPrice, quantity, notional: riskPrice * quantity };
}

export function prepareAmendOrderFacts({ payload, order, spec, market }) {
  if (!order) return { allowed: false, reason: "authoritative_open_order_not_found" };
  const ctVal = Number(spec?.ctVal);
  const lotSz = Number(spec?.lotSz || 1);
  const tickSz = Number(spec?.tickSz);
  if (!Number.isFinite(ctVal) || ctVal <= 0 || !Number.isFinite(lotSz) || lotSz <= 0 || !Number.isFinite(tickSz) || tickSz <= 0) {
    return { allowed: false, reason: "instrument_spec_unavailable" };
  }
  const currentContracts = Number(order.sz ?? order.size ?? order.quantity);
  const filledContracts = Number(order.accFillSz ?? order.filledSize ?? 0);
  if (!Number.isFinite(currentContracts) || currentContracts <= 0 || !Number.isFinite(filledContracts) || filledContracts < 0) {
    return { allowed: false, reason: "authoritative_order_quantity_unavailable" };
  }
  let targetContracts = currentContracts;
  if (payload.newSize !== undefined && payload.newSize !== null && payload.newSize !== "") {
    const coinQuantity = Number(payload.newSize);
    if (!Number.isFinite(coinQuantity) || coinQuantity <= 0) return { allowed: false, reason: "invalid_amend_size" };
    targetContracts = roundToStep(coinQuantity / ctVal, lotSz, "floor");
    if (!Number.isFinite(targetContracts) || targetContracts <= 0) return { allowed: false, reason: "amend_size_below_contract_minimum" };
  }
  if (targetContracts > currentContracts + lotSz * 1e-6) return { allowed: false, reason: "amend_risk_increase_requires_new_approval" };
  if (targetContracts + lotSz * 1e-6 < filledContracts) return { allowed: false, reason: "amend_size_below_already_filled" };
  const currentPrice = Number(order.px ?? order.price);
  const requestedPrice = payload.newPrice === undefined || payload.newPrice === null || payload.newPrice === "" ? currentPrice : Number(payload.newPrice);
  if (!Number.isFinite(requestedPrice) || requestedPrice <= 0) return { allowed: false, reason: "authoritative_order_price_unavailable" };
  const trustedPrice = Number(market?.price);
  if (!Number.isFinite(trustedPrice) || trustedPrice <= 0) return { allowed: false, reason: "trusted_ticker_price_unavailable" };
  const deviation = Math.abs(requestedPrice - trustedPrice) / trustedPrice;
  if (deviation > 0.1) return { allowed: false, reason: "amend_price_deviation_exceeded", deviation };
  const targetPrice = roundToStep(requestedPrice, tickSz, "round");
  const targetCoinQuantity = targetContracts * ctVal;
  return {
    allowed: true,
    targetContracts,
    targetCoinQuantity,
    targetPrice,
    notional: Math.max(targetPrice, trustedPrice * 1.01) * targetCoinQuantity,
    currentContracts,
    filledContracts
  };
}

export async function prepareTradeActionPayload(db, action, payload = {}) {
  if (action === "place_order" && !payload.reduceOnly && !payload.closePosition) {
    const market = (db.markets || []).find((row) => row.symbol === payload.symbol);
    const result = trustedEntryNotional(payload, market);
    if (!result.allowed) return result;
    return { allowed: true, payload: { ...payload, trustedTickerPrice: result.trustedPrice, serverRiskPrice: result.riskPrice, serverCalculatedNotionalUsdt: result.notional } };
  }
  if (action === "amend_order") {
    const snapshot = latestSuccessfulAccountSnapshot(db, { exchange: "OKX", accountId: payload.accountId });
    const freshness = accountSnapshotFreshness(snapshot);
    if (!freshness.ok || snapshot?.openOrdersComplete !== true) return { allowed: false, reason: freshness.error || "authoritative_open_orders_incomplete" };
    const order = (snapshot.openOrders || []).find((row) => sameOrderIdentity(row, payload));
    if (!order) return { allowed: false, reason: "authoritative_open_order_not_found" };
    const instId = String(order.instId || toOkxSymbol(payload.symbol, payload.marketType));
    if (!payload.symbol) return { allowed: false, reason: "missing_symbol" };
    if (canonicalSymbol(instId) !== canonicalSymbol(payload.symbol)) return { allowed: false, reason: "amend_order_symbol_mismatch" };
    const spec = await okxContractSpec(instId);
    const market = (db.markets || []).find((row) => canonicalSymbol(row.symbol) === canonicalSymbol(payload.symbol || instId));
    const result = prepareAmendOrderFacts({ payload, order, spec, market });
    if (!result.allowed) return result;
    return {
      allowed: true,
      payload: {
        ...payload,
        symbol: payload.symbol || canonicalSymbol(instId),
        preparedAmendContracts: result.targetContracts,
        preparedAmendPrice: result.targetPrice,
        serverCalculatedNotionalUsdt: result.notional,
        authoritativeOrderId: order.ordId || order.exchangeOrderId || null,
        authoritativeCurrentContracts: result.currentContracts,
        authoritativeFilledContracts: result.filledContracts
      }
    };
  }
  return { allowed: true, payload };
}

function summarizePayload(payload) {
  return scrubSecrets(payload);
}

function sanitizeExchangeResult(result = {}) {
  const safe = scrubSecrets(result);
  if (safe.raw) safe.raw = "[stored_in_exchange_audit]";
  return safe;
}

function validatePayloadShape(action, payload) {
  if (!payload.symbol && action !== "cancel_order") return { allowed: false, reason: "missing_symbol" };
  if (action === "place_order") {
    if (!payload.quantity && !payload.size && !payload.closePosition) return { allowed: false, reason: "missing_quantity" };
    if (!payload.reduceOnly && !payload.stopLoss && !payload.stopLossOrderId && !payload.stopPrice) return { allowed: false, reason: "missing_stop_loss_for_new_entry" };
  }
  if (action === "cancel_order" && !payload.orderId && !payload.clientOrderId) return { allowed: false, reason: "missing_order_identifier" };
  if (action === "amend_order" && !payload.orderId && !payload.clientOrderId) return { allowed: false, reason: "missing_order_identifier" };
  if (action === "amend_order" && payload.newSize === undefined && payload.newPrice === undefined) return { allowed: false, reason: "missing_amend_target" };
  if (action === "move_stop" && !payload.stopPrice && !payload.stopLoss) return { allowed: false, reason: "missing_new_stop" };
  if (action === "close_position" && !payload.quantity && !payload.size && !payload.closePosition) return { allowed: false, reason: "missing_close_size" };
  if (action === "take_profit" && !payload.price && !payload.stopPrice && !Array.isArray(payload.targets)) return { allowed: false, reason: "missing_take_profit_target" };
  return { allowed: true };
}

export function findDuplicateClientOrder(db, payload) {
  if (!payload.clientOrderId) return null;
  return (db.orders || []).find((order) => order.clientOrderId === payload.clientOrderId);
}

function validateMandateGuard(db, action, payload) {
  const mandate = db.mandates.find((item) => item.id === payload.mandateId)
    || db.mandates.find((item) => ["running", "active"].includes(item.status));
  if (!mandate) return { allowed: false, reason: "missing_active_mandate" };
  if (!["running", "active"].includes(mandate.status)) return { allowed: false, reason: "mandate_not_active", mandateId: mandate.id };
  const validFrom = mandate.validFrom || mandate.valid_from;
  if (validFrom && new Date(validFrom).getTime() > Date.now()) return { allowed: false, reason: "mandate_not_started", mandateId: mandate.id };
  const validUntil = mandate.validUntil || mandate.valid_until;
  if (validUntil && new Date(validUntil).getTime() <= Date.now()) return { allowed: false, reason: "mandate_expired", mandateId: mandate.id };
  if (String(payload.exchange || "OKX").toUpperCase() !== "OKX") return { allowed: false, reason: "exchange_not_allowed_by_mandate", mandateId: mandate.id };
  const symbol = payload.symbol;
  // oneShotAuth：用户对白名单外扫描候选的一次性授权(仅本笔),放行正向白名单;但下面的显式黑名单仍然拦。
  if (symbol && payload.oneShotAuth !== true && mandate.allowedSymbols?.length && !mandate.allowedSymbols.includes(symbol)) return { allowed: false, reason: "symbol_not_allowed_by_mandate", mandateId: mandate.id };
  if (symbol && mandate.deniedSymbols?.includes(symbol)) return { allowed: false, reason: "symbol_denied_by_mandate", mandateId: mandate.id };
  if (payload.marketType && mandate.marketTypes?.length && !mandate.marketTypes.includes(payload.marketType)) return { allowed: false, reason: "market_type_not_allowed_by_mandate", mandateId: mandate.id };
  const mandateAction = payload.reduceOnly && action === "place_order" ? "close" : ACTION_TO_MANDATE[action];
  if (mandateAction && mandate.allowedActions?.length && !mandate.allowedActions.includes(mandateAction)) return { allowed: false, reason: "action_not_allowed_by_mandate", mandateId: mandate.id, mandateAction };
  if (mandateAction === "open") {
    const leverage = Number(payload.leverage);
    const bounds = leverageBoundsForMandate(mandate, symbol);
    if (!Number.isFinite(leverage) || leverage <= 0 || !bounds.valid) {
      return { allowed: false, reason: "invalid_order_leverage", mandateId: mandate.id, leverage, minLeverage: bounds.minimum, maxLeverage: bounds.maximum };
    }
    if (leverage < bounds.minimum) return { allowed: false, reason: "leverage_below_mandate", mandateId: mandate.id, leverage, minLeverage: bounds.minimum };
    if (leverage > bounds.maximum) return { allowed: false, reason: "leverage_exceeds_mandate", mandateId: mandate.id, leverage, maxLeverage: bounds.maximum };
  }
  const requestedNotional = estimateNotional(payload);
  if (!Number.isFinite(requestedNotional) || requestedNotional <= 0) return { allowed: false, reason: "invalid_order_notional", mandateId: mandate.id };
  const capacity = mandateNotionalCapacity(db, mandate, symbol);
  if (capacity.unknownPositions.length) {
    return { allowed: false, reason: "position_notional_unknown", mandateId: mandate.id, positions: capacity.unknownPositions };
  }
  const maxOrderNotional = capacity.maxOrderNotional;
  if (Number.isFinite(maxOrderNotional) && requestedNotional > maxOrderNotional) {
    return { allowed: false, reason: "order_notional_exceeds_mandate", mandateId: mandate.id, requestedNotional, maxOrderNotional };
  }
  const { positions, symbolExposure, portfolioExposure, maxSymbolNotional, maxPortfolioNotional } = capacity;
  const sameSymbol = evaluateSameSymbolEntryConflict(db, {
    id: payload.tradePlanId || payload.planId,
    symbol,
    direction: payload.posSide || payload.positionSide || (String(payload.side).toLowerCase() === "sell" ? "short" : "long")
  }, mandate);
  if (!sameSymbol.ok) return { allowed: false, ...sameSymbol, mandateId: mandate.id };
  const marginCapacity = accountMarginCapacity(db, {
    mandate,
    leverage: payload.leverage,
    excludePlanId: payload.tradePlanId || payload.planId,
    live: db.system?.liveTradingEnabled === true,
    exchange: payload.exchange
  });
  if (!marginCapacity.ok) return { allowed: false, reason: marginCapacity.error, mandateId: mandate.id, marginCapacity };
  const projectedMargin = projectedMarginUsage(marginCapacity, requestedNotional, payload.leverage);
  if (!projectedMargin.ok) {
    return { allowed: false, reason: "projected_margin_limit_exceeded", mandateId: mandate.id, requestedNotional, marginCapacity, projectedMargin };
  }
  if (Number.isFinite(maxSymbolNotional) && symbolExposure + requestedNotional > maxSymbolNotional) {
    return { allowed: false, reason: "symbol_notional_exceeds_mandate", mandateId: mandate.id, requestedNotional, symbolExposure, maxSymbolNotional };
  }
  if (Number.isFinite(maxPortfolioNotional) && portfolioExposure + requestedNotional > maxPortfolioNotional) {
    return { allowed: false, reason: "portfolio_notional_exceeds_mandate", mandateId: mandate.id, requestedNotional, portfolioExposure, maxPortfolioNotional };
  }
  const direction = String(payload.posSide || payload.positionSide || (String(payload.side).toLowerCase() === "sell" ? "short" : "long"))
    .toLowerCase().replace("空", "short").replace("多", "long");
  const alreadyOpen = positions.some((position) => position.symbol === symbol && position.direction === direction);
  const maxConcurrentPositions = Number(mandate.maxConcurrentPositions || 3);
  if (!alreadyOpen && positions.length >= maxConcurrentPositions) {
    return { allowed: false, reason: "concurrent_positions_exceed_mandate", mandateId: mandate.id, openPositions: positions.length, maxConcurrentPositions };
  }
  return { allowed: true, mandateId: mandate.id, requestedNotional, symbolExposure, portfolioExposure, marginCapacity, projectedMargin };
}

// 执行定仓与最终写单必须共用同一套授权容量口径。此前定仓只看灰度/组合预算，
// 算出 53.20U 后才在最终写单发现 Mandate 单笔上限 50U，导致本可安全缩仓的计划
// 被整笔拒绝。这里返回“当前还能新增多少名义额”，供定仓先行裁剪，写单再复核。
export function mandateNotionalCapacity(db, mandate, symbol) {
  const exposure = currentPositionExposure(db);
  const maxOrderNotional = Number(mandate?.maxOrderNotionalUsdt ?? mandate?.max_notional_usdt);
  const symbolExposure = exposure.positions
    .filter((position) => position.symbol === symbol)
    .reduce((sum, position) => sum + position.notional, 0);
  const portfolioExposure = exposure.positions.reduce((sum, position) => sum + position.notional, 0);
  const maxSymbolNotional = Number(mandate?.maxSymbolNotionalUsdt ?? maxOrderNotional);
  const maxPortfolioNotional = Number(mandate?.maxPortfolioNotionalUsdt ?? maxSymbolNotional);
  const caps = [
    Number.isFinite(maxOrderNotional) ? maxOrderNotional : Infinity,
    Number.isFinite(maxSymbolNotional) ? Math.max(0, maxSymbolNotional - symbolExposure) : Infinity,
    Number.isFinite(maxPortfolioNotional) ? Math.max(0, maxPortfolioNotional - portfolioExposure) : Infinity
  ];
  return {
    maxOrderNotional,
    maxSymbolNotional,
    maxPortfolioNotional,
    symbolExposure,
    portfolioExposure,
    remainingNotional: Math.min(...caps),
    positions: exposure.positions,
    unknownPositions: exposure.unknown
  };
}

// 对外展示额度时也必须与执行层使用同一口径。灰度额度和交易权限额度是两道独立上限，
// 最终单笔可用上限取较小值；不能只展示灰度 200U，却把 Mandate 50U 隐藏到下单失败时才出现。
export function effectiveOpeningNotionalLimits(db) {
  const mandate = activeMandate(db);
  const enabledGray = (db.grayReleasePolicies || []).find((item) => item.enabled) || null;
  const gray = enabledGray
    || (db.grayReleasePolicies || []).find((item) => item.id === "gray_live_small_notional")
    || (db.grayReleasePolicies || [])[0]
    || null;
  const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
  const grayEnabled = Boolean(enabledGray);
  const grayConfiguredMax = positive(gray?.maxNotionalUsdt ?? process.env.MAX_LIVE_NOTIONAL_USDT);
  const grayOrderMax = grayEnabled ? grayConfiguredMax : null;
  const mandateOrderMax = positive(mandate?.maxOrderNotionalUsdt ?? mandate?.max_notional_usdt);
  // “最终有效”必须表示当前真的可进入灰度执行；灰度关闭时不能拿环境变量伪装成有效额度。
  const effectiveOrderMax = grayOrderMax !== null && mandateOrderMax !== null
    ? Math.min(grayOrderMax, mandateOrderMax)
    : null;
  const limitingLayers = [
    grayOrderMax !== null && grayOrderMax === effectiveOrderMax ? "gray_release" : null,
    mandateOrderMax !== null && mandateOrderMax === effectiveOrderMax ? "trading_permissions" : null
  ].filter(Boolean);
  return {
    grayEnabled,
    grayConfiguredMax,
    grayOrderMax,
    mandateOrderMax,
    mandateSymbolMax: positive(mandate?.maxSymbolNotionalUsdt),
    mandatePortfolioMax: positive(mandate?.maxPortfolioNotionalUsdt),
    effectiveOrderMax,
    limitingLayers,
    rule: "min(grayOrderMax, mandateOrderMax)",
    mandateId: mandate?.id || null,
    mandateVersion: mandate?.version || null
  };
}

// REST/WS/执行引擎可能同时保存同一真实仓位。按 symbol+方向去重并优先交易所 REST 权威快照；
// OKX 张数必须乘 ctVal，任何无法可靠换算的在场仓位都 fail-closed，防止低估总敞口。
function currentPositionExposure(db) {
  const byKey = new Map();
  const priority = { exchange_rest: 3, exchange_ws: 2, execution_engine: 1 };
  for (const position of db.positions || []) {
    const size = Math.abs(Number(position.size ?? position.quantity ?? 0));
    if (!Number.isFinite(size) || size <= 0) continue;
    const direction = canonicalPositionDirection(position);
    if (!direction) continue;
    const key = `${position.symbol}|${direction}`;
    const previous = byKey.get(key);
    if (!previous || (priority[position.source] || 0) > (priority[previous.source] || 0)) byKey.set(key, position);
  }
  const positions = [];
  const unknown = [];
  for (const position of byKey.values()) {
    const size = Math.abs(Number(position.size ?? position.quantity));
    const mark = Number(position.mark || position.price || position.entry || db.markets?.find((item) => item.symbol === position.symbol)?.price);
    let notional = Number(position.notionalUsdt ?? position.notional);
    if (!Number.isFinite(notional) || notional <= 0) {
      if (Number.isFinite(Number(position.coinSize)) && Number(position.coinSize) > 0 && Number.isFinite(mark) && mark > 0) {
        notional = Math.abs(Number(position.coinSize) * mark);
      } else if (Number.isFinite(Number(position.contractMultiplier)) && Number(position.contractMultiplier) > 0 && Number.isFinite(mark) && mark > 0) {
        notional = Math.abs(size * Number(position.contractMultiplier) * mark);
      } else if (position.source === "execution_engine" && Number.isFinite(mark) && mark > 0) {
        notional = Math.abs(size * mark);
      }
    }
    const direction = canonicalPositionDirection(position);
    if (!Number.isFinite(notional) || notional <= 0) unknown.push(position.id || `${position.symbol}:${direction}`);
    else positions.push({ id: position.id, symbol: position.symbol, direction, notional });
  }
  return { positions, unknown };
}
