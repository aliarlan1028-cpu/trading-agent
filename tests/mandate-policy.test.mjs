import assert from "node:assert/strict";
import test from "node:test";
import { mergeMandatePatch, migrateLegacyWeeklyLossMandates, normalizeAndValidateMandate, normalizePlanLeverage } from "../server/mandatePolicy.mjs";
import { effectiveOpeningNotionalLimits, validateWriteGuard } from "../server/tradeActions.mjs";

process.env.REQUIRE_AUDIT_CHAIN_OK = "false";

const future = () => new Date(Date.now() + 86_400_000).toISOString();
function mandate(overrides = {}) {
  return {
    id: "m1", status: "active", version: 1, allowedSymbols: ["BTC/USDT", "ETH/USDT"],
    allowedActions: ["open", "close", "cancel", "amend", "move_stop", "take_profit"],
    marketTypes: ["perpetual_usdt"], maxLeverage: 5, maxLeverageBySymbol: { "BTC/USDT": 5, "ETH/USDT": 5 },
    maxOrderNotionalUsdt: 100, maxSymbolNotionalUsdt: 150, maxPortfolioNotionalUsdt: 180,
    maxConcurrentPositions: 2, validFrom: new Date(Date.now() - 1000).toISOString(), validUntil: future(),
    ...overrides
  };
}

function dbFixture() {
  return {
    system: { liveTradingEnabled: true, realTradingAck: true, orderWriteEnabled: true, killSwitch: false },
    mandates: [mandate()], positions: [], markets: [{ symbol: "BTC/USDT", price: 100 }, { symbol: "ETH/USDT", price: 100 }],
    apiKeyMetadata: [{ exchange: "OKX", withdrawPermission: false, permissionVerifiedAt: new Date().toISOString() }],
    accountSnapshots: [{ exchange: "OKX", status: "ok", createdAt: new Date().toISOString(), balances: [{ totalEq: "1000", details: [{ ccy: "USDT", availEq: "1000" }] }] }],
    grayReleasePolicies: [{ id: "g1", enabled: true, requiresManualApproval: true, maxNotionalUsdt: 500 }],
    auditLogs: [], executionOrders: [], reconciliationReports: [], exchangeAccounts: [], realtimeConnections: []
  };
}

const entry = (overrides = {}) => ({
  exchange: "OKX", marketType: "perpetual_usdt", symbol: "BTC/USDT", side: "BUY", price: 100, quantity: 0.5,
  stopLoss: 95, leverage: 2, clientOrderId: "coid1", agentRunId: "a1", analysisBundleId: "b1",
  tradePlanId: "p1", riskCheckId: "r1", mandateId: "m1", manualApproval: true, ...overrides
});

test("Mandate 统一为 OKX 且拒绝无期限、非法杠杆和不一致敞口上限", () => {
  const ok = normalizeAndValidateMandate({
    allowedSymbols: ["btc/usdt"], maxLeverage: 5, maxSingleTradeRiskPct: 1, maxDailyLossPct: 2,
    maxOrderNotionalUsdt: 50, maxSymbolNotionalUsdt: 100, maxPortfolioNotionalUsdt: 150,
    validUntil: future()
  });
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.normalized.exchanges, ["OKX"]);
  assert.equal(ok.normalized.maxWeeklyLossPct, 5, "旧授权缺少周字段时应保持历史默认 5%");
  assert.equal(ok.normalized.max_weekly_loss_pct, 5);
  assert.equal(ok.normalized.allow_add_position, false, "旧授权不得隐式获得加仓权限");
  assert.equal(ok.normalized.maxMarginUtilizationPct, 70);
  const bad = normalizeAndValidateMandate({
    allowedSymbols: ["BTC/USDT"], maxLeverage: 25, maxSingleTradeRiskPct: 1, maxDailyLossPct: 2,
    maxOrderNotionalUsdt: 100, maxSymbolNotionalUsdt: 50
  });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.length >= 2);
});

test("计划层把越界杠杆贴合到授权边界，并保留原始选择用于审计", () => {
  const policy = mandate({ minLeverage: 5, min_leverage: 5, maxLeverage: 10, maxLeverageBySymbol: { "BTC/USDT": 10 } });
  assert.deepEqual(normalizePlanLeverage(policy, "BTC/USDT", 1), {
    valid: true, minimum: 5, maximum: 10, symbol: "BTC/USDT",
    requested: 1, applied: 5, adjusted: true, reason: "raised_to_minimum"
  });
  assert.equal(normalizePlanLeverage(policy, "BTC/USDT", 15).applied, 10);
  assert.equal(normalizePlanLeverage(policy, "BTC/USDT", 7).adjusted, false);
  assert.equal(normalizePlanLeverage(policy, "BTC/USDT", undefined).applied, 5);
});

test("授权拒绝最低杠杆高于全局或币种最高杠杆", () => {
  const base = {
    allowedSymbols: ["BTC/USDT"], minLeverage: 6, maxLeverage: 5,
    maxSingleTradeRiskPct: 1, maxDailyLossPct: 2,
    maxOrderNotionalUsdt: 50, maxSymbolNotionalUsdt: 100, maxPortfolioNotionalUsdt: 150,
    validUntil: future()
  };
  assert.equal(normalizeAndValidateMandate(base).valid, false);
  const bySymbol = normalizeAndValidateMandate({ ...base, minLeverage: 5, maxLeverage: 10, maxLeverageBySymbol: { "BTC/USDT": 3 } });
  assert.equal(bySymbol.valid, false);
});

test("PATCH 单独更新驼峰或蛇形字段时不会被数据库里的旧别名覆盖", () => {
  const current = { maxMarginUtilizationPct: 70, max_margin_utilization_pct: 70, allowAddPosition: true, allow_add_position: true };
  const disabled = mergeMandatePatch(current, { allowAddPosition: false });
  assert.equal(disabled.allowAddPosition, false);
  assert.equal(disabled.allow_add_position, false);
  const raised = mergeMandatePatch(current, { max_margin_utilization_pct: 80 });
  assert.equal(raised.maxMarginUtilizationPct, 80);
  assert.equal(raised.max_margin_utilization_pct, 80);
});

test("旧授权缺少新额度字段时采用调用方明确提供的灰度默认值，不再静默写入50", () => {
  const checked = normalizeAndValidateMandate({
    allowedSymbols: ["BTC/USDT"], maxLeverage: 5, maxSingleTradeRiskPct: 1, maxDailyLossPct: 2,
    validUntil: future()
  }, { defaultNotionalUsdt: 200 });
  assert.equal(checked.valid, true);
  assert.equal(checked.normalized.maxOrderNotionalUsdt, 200);
  assert.equal(checked.normalized.maxSymbolNotionalUsdt, 200);
  assert.equal(checked.normalized.maxPortfolioNotionalUsdt, 200);
});

test("额度展示与执行一致：灰度200、交易权限50时最终单笔上限是50", () => {
  const state = dbFixture();
  state.grayReleasePolicies[0].maxNotionalUsdt = 200;
  state.mandates[0].maxOrderNotionalUsdt = 50;
  const limits = effectiveOpeningNotionalLimits(state);
  assert.equal(limits.grayOrderMax, 200);
  assert.equal(limits.grayEnabled, true);
  assert.equal(limits.grayConfiguredMax, 200);
  assert.equal(limits.mandateOrderMax, 50);
  assert.equal(limits.effectiveOrderMax, 50);
  assert.deepEqual(limits.limitingLayers, ["trading_permissions"]);
});

test("灰度关闭时不把环境默认值展示为当前有效下单额度", () => {
  const state = dbFixture();
  state.grayReleasePolicies[0].maxNotionalUsdt = 200;
  state.grayReleasePolicies[0].enabled = false;
  const limits = effectiveOpeningNotionalLimits(state);
  assert.equal(limits.grayConfiguredMax, 200);
  assert.equal(limits.grayOrderMax, null);
  assert.equal(limits.effectiveOrderMax, null);
});

test("Mandate 可配置近7日亏损上限并受政策上限约束", () => {
  const base = {
    allowedSymbols: ["BTC/USDT"], maxLeverage: 5,
    maxSingleTradeRiskPct: 1, maxDailyLossPct: 2,
    maxOrderNotionalUsdt: 50, maxSymbolNotionalUsdt: 100, maxPortfolioNotionalUsdt: 150,
    validUntil: future()
  };
  const configured = normalizeAndValidateMandate({ ...base, maxWeeklyLossPct: 7.5 });
  assert.equal(configured.valid, true);
  assert.equal(configured.normalized.maxWeeklyLossPct, 7.5);
  assert.equal(configured.normalized.max_weekly_loss_pct, 7.5);

  const rejected = normalizeAndValidateMandate({ ...base, maxWeeklyLossPct: 20.1 });
  assert.equal(rejected.valid, false);
  assert.ok(rejected.errors.some((error) => error.includes("maxWeeklyLossPct")));
});

test("历史最大回撤字段不得冒充近7日累计亏损字段", () => {
  const checked = normalizeAndValidateMandate({
    allowedSymbols: ["BTC/USDT"], maxLeverage: 5,
    maxSingleTradeRiskPct: 1, maxDailyLossPct: 2,
    maxWeeklyDrawdownPct: 20, max_weekly_drawdown_pct: 20,
    maxOrderNotionalUsdt: 50, maxSymbolNotionalUsdt: 100, maxPortfolioNotionalUsdt: 150,
    validUntil: future()
  });
  assert.equal(checked.valid, true);
  assert.equal(checked.normalized.maxWeeklyLossPct, 5);
  assert.equal(checked.normalized.max_weekly_loss_pct, 5);
  assert.equal("maxWeeklyDrawdownPct" in checked.normalized, false);
  assert.equal("max_weekly_drawdown_pct" in checked.normalized, false);
});

test("一次性迁移把曾被旧字段污染的新周亏损值恢复为5%并使旧计划版本失效", () => {
  const db = {
    meta: {},
    mandates: [{ id: "legacy", version: 9, maxWeeklyLossPct: 20, max_weekly_loss_pct: 20, maxWeeklyDrawdownPct: 20 }]
  };
  const first = migrateLegacyWeeklyLossMandates(db);
  assert.equal(first.migrated, 1);
  assert.equal(db.mandates[0].maxWeeklyLossPct, 5);
  assert.equal(db.mandates[0].max_weekly_loss_pct, 5);
  assert.equal(db.mandates[0].version, 10);
  assert.equal("maxWeeklyDrawdownPct" in db.mandates[0], false);
  assert.equal(db.mandates[0].weeklyLossSemanticMigration.from, 20);

  const second = migrateLegacyWeeklyLossMandates(db);
  assert.equal(second.migrated, 0);
  assert.equal(db.mandates[0].version, 10, "重复启动不得反复提升授权版本");
});

test("高于默认的既有风险值只在生产显式声明同等政策上限时通过", () => {
  const input = {
    allowedSymbols: ["BTC/USDT"], maxLeverage: 5,
    maxSingleTradeRiskPct: 10, maxDailyLossPct: 20,
    maxOrderNotionalUsdt: 50, maxSymbolNotionalUsdt: 100, maxPortfolioNotionalUsdt: 150,
    validUntil: future()
  };
  assert.equal(normalizeAndValidateMandate(input).valid, false);
  const explicit = normalizeAndValidateMandate(input, {
    riskLimits: { maxSingleTradeRiskPct: 10, maxDailyLossPct: 20 }
  });
  assert.equal(explicit.valid, true);
  assert.equal(explicit.normalized.maxSingleTradeRiskPct, 10);
  assert.equal(explicit.normalized.maxDailyLossPct, 20);
});

test("执行闸同时约束单笔、单币种与组合总敞口", () => {
  const db = dbFixture();
  db.mandates[0].allowAddPosition = true;
  let guard = validateWriteGuard(db, "place_order", entry({ quantity: 1.01 }));
  assert.equal(guard.reason, "order_notional_exceeds_mandate");

  db.positions.push({ id: "pos1", source: "exchange_rest", exchange: "OKX", symbol: "BTC/USDT", direction: "long", size: 10, contractMultiplier: 0.1, mark: 100 });
  guard = validateWriteGuard(db, "place_order", entry({ quantity: 0.6 }));
  assert.equal(guard.reason, "symbol_notional_exceeds_mandate");

  db.positions[0] = { id: "pos2", source: "execution_engine", symbol: "ETH/USDT", direction: "long", size: 1.4, mark: 100 };
  guard = validateWriteGuard(db, "place_order", entry({ quantity: 0.5 }));
  assert.equal(guard.reason, "portfolio_notional_exceeds_mandate");
});

test("最终写单闸硬拒绝计划层未能消除的杠杆越界", () => {
  const state = dbFixture();
  state.mandates[0].minLeverage = 5;
  state.mandates[0].min_leverage = 5;
  state.mandates[0].maxLeverage = 10;
  state.mandates[0].maxLeverageBySymbol["BTC/USDT"] = 10;
  assert.equal(validateWriteGuard(state, "place_order", entry({ leverage: 1 })).reason, "leverage_below_mandate");
  assert.equal(validateWriteGuard(state, "place_order", entry({ leverage: 11 })).reason, "leverage_exceeds_mandate");
  assert.notEqual(validateWriteGuard(state, "place_order", entry({ leverage: 5 })).reason, "leverage_below_mandate");
  assert.notEqual(validateWriteGuard(state, "place_order", entry({ leverage: 5 })).reason, "leverage_exceeds_mandate");
});

test("无法换算的 OKX 在场张数使新增风险 fail-closed", () => {
  const db = dbFixture();
  db.positions.push({ id: "unknown-pos", source: "exchange_ws", exchange: "OKX", symbol: "ETH/USDT", direction: "long", size: 3 });
  const guard = validateWriteGuard(db, "place_order", entry());
  assert.equal(guard.reason, "position_notional_unknown");
});

test("非零持仓的空字符串或零名义额不能被当成零敞口", () => {
  const state = dbFixture();
  state.positions = [{ id: "bad-zero", symbol: "BTC/USDT", direction: "long", size: 1, notionalUsdt: "", source: "exchange_rest" }];
  const result = validateWriteGuard(state, "place_order", entry({ symbol: "ETH/USDT" }));
  assert.equal(result.reason, "position_notional_unknown");
});

test("最终写单闸与定仓闸一致拒绝未来时间戳的账户快照", () => {
  const state = dbFixture();
  state.accountSnapshots[0].createdAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const result = validateWriteGuard(state, "place_order", entry());
  assert.equal(result.reason, "account_snapshot_time_invalid");
});
