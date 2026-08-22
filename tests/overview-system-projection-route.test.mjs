import assert from "node:assert/strict";
import test from "node:test";

import { normalizePositionsForUi } from "../server/positionView.mjs";
import { buildOverviewPrincipalScope } from "../server/overviewPrincipalScope.mjs";
import { projectSystemOverviewTradeHistory } from "../server/overviewTradeHistory.mjs";
import { compactOverviewForNative, projectOverviewSection } from "../server/overviewView.mjs";
import { seedDatabase } from "../server/store.mjs";
import { addSystemExecution, stampFixtureSystemAttribution } from "./helpers/system-trade-fixtures.mjs";

function leg(fill = {}) {
  return {
    feeUsdt: 0, feeSchemaVersion: 2, feeSource: "fixture_exchange_fill", estimatedFee: false,
    ...(fill.kind === "close" ? { fundingFeeUsdt: 0, fundingReconciled: true } : {}),
    ...fill
  };
}

function overviewFixture() {
  const db = seedDatabase();
  const scope = { tenantId: "tenant_owner", ownerUserId: "user_local_admin" };
  db.executionOrders = [];
  db.tradePlans = [];
  const normal = addSystemExecution(db, { executionOrderId: "system-normal", planId: "plan-normal", quantity: 1 });
  const manualExit = addSystemExecution(db, { executionOrderId: "system-manual-exit", planId: "plan-manual-exit", quantity: 1 });
  const systemLeg = (id, kind, execution, realizedPnl) => stampFixtureSystemAttribution(leg({
    id, kind, ...scope, accountId: "account-a", environment: "production", exchange: "OKX", symbol: "BTC/USDT", direction: "long",
    quantity: 1, price: 100, realizedPnl, exchangeFilledAt: "2026-08-22T00:00:00.000Z", createdAt: "2026-08-22T00:00:00.000Z"
  }), execution);
  const manualExitClose = systemLeg("manual-exit-close", "close", manualExit, 4);
  manualExitClose.tradeAttribution = { ...manualExitClose.tradeAttribution, origin: "external_exchange", exitMode: "manual_exit", method: "deterministic_manual_exit" };
  db.fills = [
    systemLeg("normal-entry", "entry", normal), systemLeg("normal-close", "close", normal, 3),
    systemLeg("manual-exit-entry", "entry", manualExit), manualExitClose,
    leg({ id: "manual-entry", kind: "entry", ...scope, symbol: "SOL/USDT", direction: "long", quantity: 1, createdAt: "2026-08-22T00:00:00.000Z" }),
    leg({ id: "manual-close", kind: "close", ...scope, symbol: "SOL/USDT", direction: "long", quantity: 1, realizedPnl: 50, createdAt: "2026-08-22T00:01:00.000Z" }),
    leg({ id: "pending-entry", kind: "entry", ...scope, symbol: "ADA/USDT", direction: "long", quantity: 1, tradeAttribution: { schemaVersion: 1, scope: "attribution_pending", origin: "external_exchange", reason: "mixed_position_attribution" } }),
    leg({ id: "pending-close", kind: "close", ...scope, symbol: "ADA/USDT", direction: "long", quantity: 1, realizedPnl: 75, tradeAttribution: { schemaVersion: 1, scope: "attribution_pending", origin: "external_exchange", reason: "mixed_position_attribution" } })
  ];
  db.positions = [{ id: "manual-open", ...scope, source: "exchange_rest", exchange: "OKX", accountId: "account-a", symbol: "ETH/USDT", direction: "long", size: .5, markPrice: 3000, marginUsdt: 100 }];
  db.portfolio = { ...scope, totalEquityUsdt: 777, availableMarginUsdt: 333, liquidationBufferUsdt: 222 };
  db.accountSnapshots = [{ id: "manual-account-snapshot", ...scope, totalEquityUsdt: 777, availableMarginUsdt: 333 }];
  db.reconciliationReports = [{ id: "reconcile-account", ...scope, status: "passed" }];
  return db;
}

function assertOverviewHistory(payload) {
  assert.deepEqual(payload.fills.map((fill) => fill.id).sort(), ["manual-exit-close", "manual-exit-entry", "normal-close", "normal-entry"]);
  assert.deepEqual(payload.closedTradeLifecycles.map((row) => row.tradeLifecycleKey).sort(), ["system-manual-exit", "system-normal"]);
  assert.equal(payload.tradeDataStatus.fillTotal, 4);
  assert.equal(payload.tradeDataStatus.closedLifecycleTotal, 2);
  assert.equal(payload.positions.some((position) => position.id === "manual-open"), true);
  assert.equal(payload.portfolio.totalEquityUsdt, 777);
  assert.equal(payload.accountSnapshots.some((snapshot) => snapshot.id === "manual-account-snapshot"), true);
  assert.equal(payload.reconciliationReports.some((report) => report.id === "reconcile-account"), true);
}

test("authenticated scoped overview sources carry system history through section, native, and legacy projections", () => {
  const db = overviewFixture();
  const { scoped } = buildOverviewPrincipalScope(db, { tenantId: "tenant_owner", userId: "user_local_admin", isOwner: true });
  const history = projectSystemOverviewTradeHistory(scoped);
  const source = {
    fills: history.fills,
    closedTradeLifecycles: history.closedTradeLifecycles,
    tradeDataStatus: { fillTotal: history.fills.length, closedLifecycleTotal: history.closedTradeLifecycles.length },
    positions: normalizePositionsForUi(scoped.positions), portfolio: scoped.portfolio,
    accountSnapshots: scoped.accountSnapshots, reconciliationReports: scoped.reconciliationReports
  };

  assertOverviewHistory(projectOverviewSection(source, "cockpit"));
  assertOverviewHistory(compactOverviewForNative(source, true));
  assertOverviewHistory(projectOverviewSection({ ...source }, "cockpit"));
});
