import assert from "node:assert/strict";
import test from "node:test";

import { buildCurrentRiskSnapshot } from "../server/currentRiskSnapshot.mjs";
import { buildOverviewPrincipalScope, deriveOverviewApiHealth } from "../server/overviewPrincipalScope.mjs";
import { reconcileRiskIncidentLifecycle } from "../server/riskIncidentLifecycle.mjs";

function fixture() {
  const owner = { tenantId: "tenant-owner", ownerUserId: "owner-1" };
  const sameTenantOther = { tenantId: "tenant-owner", ownerUserId: "trader-2" };
  const foreign = { tenantId: "tenant-foreign", ownerUserId: "foreign-owner" };
  const rows = (prefix) => [
    { id: `${prefix}-owner`, ...owner },
    { id: `${prefix}-same-tenant-other`, ...sameTenantOther },
    { id: `${prefix}-foreign`, ...foreign },
    { id: `${prefix}-legacy` }
  ];
  return {
    user: { id: "owner-1", tenantId: "tenant-owner", isOwner: true },
    system: {
      requestedOperatingMode: "full_auto",
      reduceOnlyMode: true,
      reduceOnlyReasons: [{ code: "owner-accounting", message: "Owner private accounting reason" }],
      remainingDailyLossUsdt: 0
    },
    positions: rows("position"),
    tradePlans: rows("plan"),
    fills: rows("fill"),
    reviews: rows("review"),
    auditLogs: rows("audit"),
    accountSnapshots: rows("account"),
    riskIncidents: [
      { id: "incident-owner", ...owner, status: "open", protectionKey: "cooldown" },
      { id: "incident-foreign", ...foreign, status: "open", protectionKey: "cooldown" },
      { id: "incident-legacy", status: "open", protectionKey: "cooldown" }
    ],
    mandates: [{ id: "mandate-owner", ...owner, status: "active", maxWeeklyLossPct: 5 }],
    portfolio: { id: "portfolio-owner", ...owner, totalEquityUsdt: 900, weekPnl: -100, accountingUpdatedAt: "2026-08-18T00:00:00.000Z" },
    agentStateFiles: { USER: { content: "Owner private profile" } },
    agentStateFilesByPrincipal: {
      "tenant-owner:trader-2": { USER: { content: "Trader profile" } },
      "tenant-foreign:foreign-owner": { USER: { content: "Foreign profile" } }
    }
  };
}

test("Core, section-v2, and legacy overview share exact-principal private projections", () => {
  const db = fixture();
  const trader = buildOverviewPrincipalScope(db, { tenantId: "tenant-owner", userId: "trader-2", isOwner: false });
  assert.deepEqual(trader.scoped.positions.map((row) => row.id), ["position-same-tenant-other"]);
  assert.deepEqual(trader.scoped.tradePlans.map((row) => row.id), ["plan-same-tenant-other"]);
  assert.deepEqual(trader.scoped.fills.map((row) => row.id), ["fill-same-tenant-other"]);
  assert.deepEqual(trader.scoped.reviews.map((row) => row.id), ["review-same-tenant-other"]);
  assert.deepEqual(trader.scoped.auditLogs.map((row) => row.id), ["audit-same-tenant-other"]);
  assert.deepEqual(trader.scoped.portfolio, {});
  assert.deepEqual(trader.scoped.system, {});
  assert.equal(trader.scoped.agentStateFiles.USER.content, "Trader profile");

  const owner = buildOverviewPrincipalScope(db, { tenantId: "tenant-owner", userId: "owner-1", isOwner: true });
  assert.deepEqual(owner.scoped.positions.map((row) => row.id), ["position-owner", "position-legacy"]);
  assert.equal(owner.scoped.system.reduceOnlyMode, true);
  assert.equal(owner.scoped.agentStateFiles.USER.content, "Owner private profile");
  const persistedHealth = db.system.apiHealth;
  owner.scoped.system.apiHealth = deriveOverviewApiHealth(owner.scoped, { configuredOwner: true, hasStoredOkxCredentials: true });
  assert.equal(db.system.apiHealth, persistedHealth, "even the configured Owner GET derives health without persisting it");
});

test("an Owner in another tenant cannot inherit configured-Owner legacy records", () => {
  const db = fixture();
  const foreign = buildOverviewPrincipalScope(db, { tenantId: "tenant-foreign", userId: "foreign-owner", isOwner: true });
  assert.deepEqual(foreign.scoped.positions.map((row) => row.id), ["position-foreign"]);
  assert.deepEqual(foreign.scoped.accountSnapshots.map((row) => row.id), ["account-foreign"]);
  assert.deepEqual(foreign.scoped.system, {});
  assert.equal(foreign.scoped.agentStateFiles.USER.content, "Foreign profile");
});

test("reading a foreign risk overview exposes no Owner balance or pause reason and cannot resolve Owner incidents", () => {
  const db = fixture();
  const ownerSystemBefore = structuredClone(db.system);
  const foreign = buildOverviewPrincipalScope(db, { tenantId: "tenant-foreign", userId: "foreign-owner", isOwner: true });
  foreign.scoped.system.apiHealth = deriveOverviewApiHealth(foreign.scoped, {
    configuredOwner: foreign.configuredOwner,
    hasStoredOkxCredentials: true
  });
  const snapshot = buildCurrentRiskSnapshot(foreign.scoped, Date.parse("2026-08-18T12:00:00.000Z"));
  assert.equal(snapshot.rollingSevenDay.startEquityUsdt, null);
  assert.equal(snapshot.rollingSevenDay.pnlUsdt, null);
  assert.equal(snapshot.controls.reduceOnly, false);
  assert.deepEqual(snapshot.operationalDegradation.reasons, []);
  assert.equal(foreign.scoped.system.apiHealth, "待配置");
  assert.deepEqual(db.system, ownerSystemBefore, "a foreign overview derivation must not write the configured Owner system object");

  reconcileRiskIncidentLifecycle(foreign.scoped, { snapshot, degradation: snapshot.operationalDegradation });
  assert.equal(db.riskIncidents.find((row) => row.id === "incident-owner").status, "open");
  assert.equal(db.riskIncidents.find((row) => row.id === "incident-legacy").status, "open");
});
