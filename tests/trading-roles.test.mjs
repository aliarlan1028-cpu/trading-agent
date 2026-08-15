import assert from "node:assert/strict";
import test from "node:test";

import { evaluatePortfolioIntentConflict, evaluateSameSymbolEntryConflict, resolveTradingRole, validateTradingRolePlan } from "../server/tradingRoles.mjs";

test("未指定角色时按计划周期确定日内或波段，不靠提示词猜", () => {
  assert.equal(resolveTradingRole(undefined, "15m").id, "day_trader");
  assert.equal(resolveTradingRole(undefined, "4h").id, "swing_trader");
});

test("角色约束计划周期、确认周期和等待期限", () => {
  assert.equal(validateTradingRolePlan({ traderRole: "scalper", timeframe: "5m" }).reason, "trading_role_invalid");
  assert.equal(validateTradingRolePlan({ traderRole: "day_trader", timeframe: "4h" }).reason, "role_timeframe_mismatch");
  assert.equal(validateTradingRolePlan({ traderRole: "day_trader", timeframe: "15m", confirmations: [{ timeframe: "4h" }] }).reason, "role_confirmation_timeframe_mismatch");
  assert.equal(validateTradingRolePlan({ traderRole: "day_trader", timeframe: "15m", ttlHours: 24 }).reason, "role_ttl_exceeded");
  const valid = validateTradingRolePlan({ traderRole: "swing_trader", timeframe: "4h", confirmations: [{ timeframe: "1h" }], ttlHours: 24 });
  assert.equal(valid.ok, true);
  assert.equal(valid.ttlHours, 24);
});

test("组合裁决阻止不同角色在同一币种建立相反方向敞口", () => {
  const withPlan = {
    positions: [],
    tradePlans: [{ id: "swing-long", symbol: "SUI/USDT", direction: "long", status: "armed", traderRole: "swing_trader", armedSetupId: "setup-1" }],
    armedSetups: [{ id: "setup-1", planId: "swing-long", status: "ARMED", expiresAt: "2026-08-11T00:00:00.000Z" }]
  };
  const planConflict = evaluatePortfolioIntentConflict(withPlan, { symbol: "SUI-USDT", direction: "short" }, { now: new Date("2026-08-10T00:00:00.000Z").getTime() });
  assert.equal(planConflict.reason, "opposite_active_plan");
  assert.equal(planConflict.conflictId, "swing-long");

  const withPosition = {
    positions: [{ id: "pos-1", symbol: "SUI/USDT", posSide: "short", pos: "12" }],
    tradePlans: []
  };
  const positionConflict = evaluatePortfolioIntentConflict(withPosition, { symbol: "SUI/USDT", direction: "long" }, { positionsOnly: true });
  assert.equal(positionConflict.reason, "opposite_live_position");
});

test("过期或缺少等待执行记录的 armed 计划不会永久占用相反方向", () => {
  const expired = {
    positions: [],
    tradePlans: [{ id: "old-long", symbol: "SUI/USDT", direction: "long", status: "armed", armedSetupId: "old-setup" }],
    armedSetups: [{ id: "old-setup", planId: "old-long", status: "ARMED", expiresAt: "2026-08-09T00:00:00.000Z" }]
  };
  assert.equal(evaluatePortfolioIntentConflict(expired, { symbol: "SUI/USDT", direction: "short" }, { now: new Date("2026-08-10T00:00:00.000Z").getTime() }).ok, true);
  expired.armedSetups = [];
  assert.equal(evaluatePortfolioIntentConflict(expired, { symbol: "SUI/USDT", direction: "short" }).ok, true);
});

test("旧授权默认禁止同币种隐性加仓，也禁止另一条在途入场单", () => {
  const base = { symbol: "BTC/USDT", direction: "long", id: "candidate" };
  let result = evaluateSameSymbolEntryConflict({
    positions: [{ id: "pos", symbol: "BTC/USDT", direction: "long", size: 1 }], executionOrders: []
  }, base, {});
  assert.equal(result.reason, "same_symbol_position_add_not_authorized");
  result = evaluateSameSymbolEntryConflict({
    positions: [], executionOrders: [{ id: "exec-old", planId: "old", symbol: "BTC/USDT", status: "entry_pending" }]
  }, base, {});
  assert.equal(result.reason, "same_symbol_order_in_flight");
  result = evaluateSameSymbolEntryConflict({
    positions: [], executionOrders: [], orders: [{ id: "okx-open", source: "exchange_rest", symbol: "BTC/USDT", status: "live", reduceOnly: false }]
  }, base, {});
  assert.equal(result.reason, "same_symbol_order_in_flight", "交易所快照中的外部挂单也不能被忽略");
  result = evaluateSameSymbolEntryConflict({
    positions: [], executionOrders: [], orders: [{ id: "history", source: "trade_action_history", symbol: "BTC/USDT", status: "ok", reduceOnly: false }]
  }, base, {});
  assert.equal(result.ok, true, "历史写操作记录不能永久冒充交易所当前挂单");
  result = evaluateSameSymbolEntryConflict({ positions: [{ symbol: "BTC/USDT", direction: "long", size: 1 }] }, base, { allowAddPosition: true });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "same_symbol_position_add_unsupported", "授权允许加仓也不能绕过当前无法按执行批次安全归属的硬限制");
  assert.equal(evaluateSameSymbolEntryConflict({ positions: [], executionOrders: [{ symbol: "BTC/USDT", planId: "other", status: "entry_pending" }] }, base, { allowAddPosition: true }).reason, "same_symbol_order_in_flight", "允许加仓也不能重复提交在途入场单");
  assert.equal(evaluateSameSymbolEntryConflict({ positions: [{ symbol: "BTC/USDT", direction: "long", size: 1 }], executionOrders: [{ symbol: "BTC/USDT", planId: "other", status: "protecting" }] }, base, { allowAddPosition: true }).reason, "same_symbol_position_add_unsupported", "存在物理持仓时必须拒绝无法安全归属的追加敞口");
});

test("未授权加仓时允许新的相反方向分析替换旧 armed 计划，但不能绕过真实仓位", () => {
  const state = {
    positions: [],
    tradePlans: [{ id: "old-long", symbol: "SUI/USDT", direction: "long", status: "armed", armedSetupId: "setup-old" }],
    armedSetups: [{ id: "setup-old", planId: "old-long", status: "ARMED", expiresAt: "2099-01-01T00:00:00.000Z" }]
  };
  assert.equal(evaluatePortfolioIntentConflict(state, { symbol: "SUI/USDT", direction: "short" }, { replaceArmedSameSymbol: true }).ok, true);
  state.positions.push({ symbol: "SUI/USDT", direction: "long", size: 1 });
  assert.equal(evaluatePortfolioIntentConflict(state, { symbol: "SUI/USDT", direction: "short" }, { replaceArmedSameSymbol: true }).reason, "opposite_live_position");
});
