const ROLE_IDS = new Set(["day_trader", "swing_trader"]);

export const TRADING_ROLE_PROFILES = Object.freeze({
  day_trader: Object.freeze({
    id: "day_trader",
    label: "日内交易员",
    purpose: "捕捉当日完成的结构机会，重视入场时机、流动性与事件窗口。",
    planTimeframes: Object.freeze(["5m", "15m", "1h"]),
    confirmationTimeframes: Object.freeze(["5m", "15m", "1h"]),
    defaultTtlHours: 4,
    maxTtlHours: 12
  }),
  swing_trader: Object.freeze({
    id: "swing_trader",
    label: "波段交易员",
    purpose: "围绕 4H/1D 结构持有跨日机会，用低周期改善入场但不改变高周期方向。",
    planTimeframes: Object.freeze(["1h", "4h", "1d"]),
    confirmationTimeframes: Object.freeze(["15m", "1h", "4h", "1d"]),
    defaultTtlHours: 12,
    maxTtlHours: 48
  })
});

function normalizeDirection(value) {
  const direction = String(value || "").trim().toLowerCase().replace("多", "long").replace("空", "short");
  return direction === "buy" ? "long" : direction === "sell" ? "short" : direction;
}

function normalizeSymbol(value) {
  const raw = String(value || "").trim().toUpperCase().replace(/-SWAP$/, "");
  if (raw.includes("/")) return raw;
  if (raw.includes("-")) return raw.replace("-", "/");
  return raw.endsWith("USDT") ? `${raw.slice(0, -4)}/USDT` : raw;
}

export function resolveTradingRole(requestedRole, timeframe = "1h") {
  const requested = String(requestedRole || "").trim().toLowerCase();
  if (ROLE_IDS.has(requested)) return TRADING_ROLE_PROFILES[requested];
  return ["5m", "15m"].includes(String(timeframe).toLowerCase())
    ? TRADING_ROLE_PROFILES.day_trader
    : TRADING_ROLE_PROFILES.swing_trader;
}

export function validateTradingRolePlan(input = {}) {
  const requestedRole = String(input.traderRole || "").trim().toLowerCase();
  if (requestedRole && !ROLE_IDS.has(requestedRole)) {
    return { ok: false, reason: "trading_role_invalid", detail: `未知交易角色：${requestedRole}` };
  }
  const profile = resolveTradingRole(input.traderRole, input.timeframe);
  const timeframe = String(input.timeframe || "1h").toLowerCase();
  if (!profile.planTimeframes.includes(timeframe)) {
    return { ok: false, reason: "role_timeframe_mismatch", detail: `${profile.label}不能创建 ${timeframe} 周期的计划` };
  }
  const confirmationTimeframes = (input.confirmations || []).map((rule) => String(rule?.timeframe || "").toLowerCase()).filter(Boolean);
  const invalidConfirmation = confirmationTimeframes.find((item) => !profile.confirmationTimeframes.includes(item));
  if (invalidConfirmation) {
    return { ok: false, reason: "role_confirmation_timeframe_mismatch", detail: `${profile.label}不能使用 ${invalidConfirmation} 作为入场确认周期` };
  }
  const requestedTtl = Number(input.ttlHours);
  const ttlHours = Number.isFinite(requestedTtl) && requestedTtl > 0 ? requestedTtl : profile.defaultTtlHours;
  if (ttlHours > profile.maxTtlHours) {
    return { ok: false, reason: "role_ttl_exceeded", detail: `${profile.label}的等待计划最长 ${profile.maxTtlHours} 小时` };
  }
  return { ok: true, profile, traderRole: profile.id, timeframe, ttlHours };
}

function positionDirection(position = {}) {
  const posSide = normalizeDirection(position.posSide || position.direction || position.positionSide);
  if (["long", "short"].includes(posSide)) return posSide;
  const signed = Number(position.pos ?? position.size ?? position.quantity);
  if (!Number.isFinite(signed) || signed === 0) return null;
  return signed < 0 ? "short" : "long";
}

function positionOpen(position = {}) {
  const size = Number(position.pos ?? position.size ?? position.quantity);
  return Number.isFinite(size) ? Math.abs(size) > 0 : Boolean(position.notionalUsdt || position.notional);
}

const ACTIVE_PLAN_STATUSES = new Set(["armed", "awaiting_approval", "approved", "executing", "entry_pending", "entry_filled", "protecting"]);
const IN_FLIGHT_ENTRY_ORDER_STATUSES = new Set(["created", "submitted", "entry_pending", "entry_partial", "executing"]);
const SAME_SYMBOL_EXPOSURE_STATUSES = new Set([...IN_FLIGHT_ENTRY_ORDER_STATUSES, "entry_filled", "protecting"]);

function planStillActive(db, plan, now = Date.now()) {
  if (!ACTIVE_PLAN_STATUSES.has(String(plan?.status || "").toLowerCase())) return false;
  if (String(plan.status).toLowerCase() !== "armed") return true;
  const setup = (db.armedSetups || []).find((row) => row.planId === plan.id || row.id === plan.armedSetupId);
  if (!setup || !["ARMED", "TRIGGERED", "FAST_VALIDATING"].includes(String(setup.status || "").toUpperCase())) return false;
  const expiresAt = new Date(setup.expiresAt || plan.armedExpiresAt || 0).getTime();
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function evaluatePortfolioIntentConflict(db, candidate = {}, options = {}) {
  const symbol = normalizeSymbol(candidate.symbol);
  const direction = normalizeDirection(candidate.direction);
  if (!symbol || !["long", "short"].includes(direction)) return { ok: false, reason: "invalid_plan_intent" };
  const opposite = direction === "long" ? "short" : "long";
  const livePosition = (db.positions || []).find((position) =>
    normalizeSymbol(position.symbol || position.instId) === symbol
      && positionOpen(position)
      && positionDirection(position) === opposite
  );
  if (livePosition) {
    return {
      ok: false,
      reason: "opposite_live_position",
      detail: `${symbol} 已有${opposite === "long" ? "多" : "空"}头持仓，禁止另一角色建立相反方向的新敞口`,
      conflictId: livePosition.id || livePosition.instId || symbol
    };
  }
  if (options.positionsOnly) return { ok: true };
  const activePlan = (db.tradePlans || []).find((plan) =>
    plan.id !== candidate.id
      && normalizeSymbol(plan.symbol) === symbol
      && normalizeDirection(plan.direction) === opposite
      && planStillActive(db, plan, Number(options.now || Date.now()))
      && !(options.replaceArmedSameSymbol === true && String(plan.status || "").toLowerCase() === "armed")
  );
  if (activePlan) {
    return {
      ok: false,
      reason: "opposite_active_plan",
      detail: `${symbol} 已有相反方向的有效计划 ${activePlan.id}；请先取消或结束旧计划，再建立新方向`,
      conflictId: activePlan.id,
      conflictRole: activePlan.traderRole || null
    };
  }
  return { ok: true };
}

// Adding to an existing symbol is an explicit mandate capability. Missing legacy
// fields therefore mean false: an old mandate can never silently gain permission.
export function evaluateSameSymbolEntryConflict(db, candidate = {}, mandate = {}) {
  const addPositionAuthorized = mandate?.allow_add_position === true || mandate?.allowAddPosition === true;
  const symbol = normalizeSymbol(candidate.symbol);
  if (!symbol) return { ok: false, reason: "invalid_plan_intent", detail: "缺少有效交易对" };
  const livePosition = (db.positions || []).find((position) =>
    normalizeSymbol(position.symbol || position.instId) === symbol && positionOpen(position)
  );
  if (livePosition && !addPositionAuthorized) {
    return {
      ok: false,
      reason: "same_symbol_position_add_not_authorized",
      detail: `${symbol} 已有未平仓仓位；当前交易权限未允许追加同币种仓位`,
      conflictId: livePosition.id || livePosition.instId || symbol
    };
  }
  const planId = candidate.id || candidate.planId || candidate.tradePlanId;
  const blockingExecutionStates = addPositionAuthorized ? IN_FLIGHT_ENTRY_ORDER_STATUSES : SAME_SYMBOL_EXPOSURE_STATUSES;
  const openOrder = (db.executionOrders || []).find((order) =>
    order.planId !== planId
      && normalizeSymbol(order.symbol) === symbol
      && blockingExecutionStates.has(String(order.status || "").toLowerCase())
  );
  if (openOrder) {
    return {
      ok: false,
      reason: "same_symbol_order_in_flight",
      detail: `${symbol} 已有入场订单正在处理（${openOrder.id}），禁止重复提交`,
      conflictId: openOrder.id
    };
  }
  const exchangeOrder = (db.orders || []).find((order) => {
    const status = String(order.status || "open").toLowerCase();
    // db.orders also contains immutable local action-history rows whose result can
    // remain "ok" forever. Only an exchange-snapshot row is evidence that an
    // order is currently open; local history is already covered by executionOrders/OMS.
    const authoritativeOpenOrder = ["exchange_rest", "exchange_ws"].includes(String(order.source || "").toLowerCase());
    return authoritativeOpenOrder
      && normalizeSymbol(order.symbol) === symbol
      && order.reduceOnly !== true
      && !["filled", "canceled", "cancelled", "rejected", "expired", "closed"].includes(status);
  });
  if (exchangeOrder) {
    return {
      ok: false,
      reason: "same_symbol_order_in_flight",
      detail: `${symbol} 在交易所已有未完成的入场委托（${exchangeOrder.exchangeOrderId || exchangeOrder.id}），禁止重复提交`,
      conflictId: exchangeOrder.exchangeOrderId || exchangeOrder.id
    };
  }
  return { ok: true, addPositionAuthorized };
}

export function tradingRolesForPrompt() {
  return Object.values(TRADING_ROLE_PROFILES).map((profile) =>
    `- ${profile.id}（${profile.label}）：计划周期 ${profile.planTimeframes.join("/")}；确认周期 ${profile.confirmationTimeframes.join("/")}；等待计划最长 ${profile.maxTtlHours} 小时。${profile.purpose}`
  ).join("\n");
}
