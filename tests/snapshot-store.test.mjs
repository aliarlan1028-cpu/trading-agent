import assert from "node:assert/strict";
import test from "node:test";
import { parseJsonResponseText } from "../src/jsonResponseProvenance.js";
import {
  acceptCoreSnapshot as acceptParsedCoreSnapshot,
  acceptSectionSnapshot as acceptParsedSectionSnapshot,
  clearSnapshotStore,
  createSnapshotStore,
  markSnapshotResource,
  observeSnapshotInvalidation,
  projectSnapshotStore,
  shouldRetryStaleSnapshot
} from "../src/snapshotStore.js";

const loaderJson = (value) => parseJsonResponseText(JSON.stringify(value));
const acceptCoreSnapshot = (store, snapshot, ...rest) => (
  acceptParsedCoreSnapshot(store, loaderJson(snapshot), ...rest)
);
const acceptSectionSnapshot = (store, section, snapshot, ...rest) => (
  acceptParsedSectionSnapshot(store, section, loaderJson(snapshot), ...rest)
);

test("workspace snapshots remain partitioned and core owns shared live facts", () => {
  const store = createSnapshotStore();
  acceptCoreSnapshot(store, {
    revision: 10,
    portfolio: { totalEquityUsdt: 101 },
    executionOrders: [{ id: "live", status: "entry_pending", updatedAt: "new" }],
    resourceState: { chat: "not_loaded", cockpit: "not_loaded" }
  });
  acceptSectionSnapshot(store, "chat", {
    revision: 10,
    portfolio: { totalEquityUsdt: 99 },
    executionOrders: [{ id: "chat-history", status: "closed" }],
    resourceState: { chat: "loaded" }
  }, 10);
  acceptSectionSnapshot(store, "cockpit", {
    revision: 11,
    executionOrders: [{ id: "cockpit-history", status: "closed" }],
    resourceState: { cockpit: "loaded" }
  }, 10);

  const chat = projectSnapshotStore(store, "chat");
  const cockpit = projectSnapshotStore(store, "cockpit");
  assert.equal(chat.portfolio.totalEquityUsdt, 101);
  assert.deepEqual(chat.executionOrders.map((row) => row.id), ["live", "chat-history"]);
  assert.deepEqual(cockpit.executionOrders.map((row) => row.id), ["live", "cockpit-history"]);
  assert.equal(chat.resourceState.chat, "loaded");
  assert.equal(cockpit.resourceState.cockpit, "loaded");
});

test("a product workspace can project explicitly loaded cross-section context without changing its primary snapshot", () => {
  const store = createSnapshotStore();
  acceptCoreSnapshot(store, { revision: 10, config: { runtime: { authRequired: true } } });
  acceptSectionSnapshot(store, "systemSettings", { revision: 10, users: [{ id: "owner" }] });
  acceptSectionSnapshot(store, "riskCenter", { revision: 11, riskRules: [{ id: "rule-1" }], riskThresholds: { minRewardRisk: 2 } });
  acceptSectionSnapshot(store, "operationsCenter", { revision: 12, eventSources: [{ id: "source-1" }] });

  const settings = projectSnapshotStore(store, "systemSettings", ["riskCenter", "operationsCenter"]);
  assert.equal(settings.users[0].id, "owner");
  assert.equal(settings.riskRules[0].id, "rule-1");
  assert.equal(settings.eventSources[0].id, "source-1");
  assert.equal(settings.config.runtime.authRequired, true, "core-owned configuration remains authoritative");
  assert.equal(settings.revision, 12);
  assert.equal(projectSnapshotStore(store, "systemSettings").riskRules, undefined, "supplemental context is opt-in");
});

test("stale core and section revisions cannot overwrite newer snapshots", () => {
  const store = createSnapshotStore();
  assert.equal(acceptCoreSnapshot(store, { revision: 20, portfolio: { totalEquityUsdt: 20 } }), true);
  assert.equal(acceptCoreSnapshot(store, { revision: 19, portfolio: { totalEquityUsdt: 19 } }), false);
  assert.equal(acceptSectionSnapshot(store, "chat", { revision: 20, tasks: [{ id: "new" }] }, 20), true);
  assert.equal(acceptSectionSnapshot(store, "chat", { revision: 19, tasks: [{ id: "old" }] }, 20), false);
  assert.equal(projectSnapshotStore(store, "chat").tasks[0].id, "new");
  assert.equal(projectSnapshotStore(store, "chat").portfolio.totalEquityUsdt, 20);
});

test("matching rows preserve section detail while fresh core facts win", () => {
  const store = createSnapshotStore();
  acceptCoreSnapshot(store, { revision: 20, executionOrders: [{ id: "exec-1", status: "entry_filled", updatedAt: "fresh" }] });
  acceptSectionSnapshot(store, "cockpit", {
    revision: 20,
    executionOrders: [{ id: "exec-1", status: "entry_pending", updatedAt: "old", confidence: 0.88, lastRiskCheck: { decision: "allow" } }]
  });
  assert.deepEqual(projectSnapshotStore(store, "cockpit").executionOrders[0], {
    id: "exec-1", status: "entry_filled", updatedAt: "fresh", confidence: 0.88, lastRiskCheck: { decision: "allow" }
  });
});

test("section response older than current core or a true core invalidation is rejected", () => {
  const store = createSnapshotStore();
  assert.equal(acceptCoreSnapshot(store, { revision: 20, tasks: [] }), true);
  assert.equal(acceptSectionSnapshot(store, "chat", { revision: 15, tasks: [{ id: "stale-core" }] }), false);
  assert.equal(observeSnapshotInvalidation(store, { type: "core_invalidated", revision: 25 }), true);
  assert.equal(observeSnapshotInvalidation(store, { type: "core_invalidated", revision: 24 }), false);
  assert.equal(acceptSectionSnapshot(store, "chat", { revision: 24, tasks: [{ id: "stale-invalidation" }] }), false);
  assert.equal(acceptSectionSnapshot(store, "chat", { revision: 25, tasks: [{ id: "fresh" }] }), true);
  assert.equal(projectSnapshotStore(store, "chat").tasks[0].id, "fresh");
});

test("high-frequency portfolio patches cannot starve core or section HTTP snapshots", () => {
  const store = createSnapshotStore();
  assert.equal(acceptCoreSnapshot(store, { revision: 100, portfolio: { totalEquityUsdt: 100 } }), true);
  for (let revision = 101; revision <= 104; revision += 1) {
    assert.equal(observeSnapshotInvalidation(store, { type: "portfolio", revision }), false);
    assert.equal(acceptCoreSnapshot(store, { revision: 100, portfolio: { totalEquityUsdt: revision } }), true);
    assert.equal(acceptSectionSnapshot(store, "cockpit", { revision: 100, executionOrders: [] }), true);
  }
  assert.equal(store.coreInvalidationRevision, 0);
});

test("knowledge invalidation rejects stale research only and stale retries are bounded", () => {
  const store = createSnapshotStore();
  assert.equal(acceptCoreSnapshot(store, { revision: 200 }), true);
  assert.equal(observeSnapshotInvalidation(store, { type: "knowledge_updated", revision: 205 }), true);
  assert.equal(acceptCoreSnapshot(store, { revision: 200 }), true, "research-only invalidation must not starve core");
  assert.equal(acceptSectionSnapshot(store, "cockpit", { revision: 200 }), true, "research-only invalidation must not reject cockpit");
  assert.equal(acceptSectionSnapshot(store, "researchCenter", { revision: 204 }), false);
  assert.equal(acceptSectionSnapshot(store, "researchCenter", { revision: 205 }), true);
  assert.equal(shouldRetryStaleSnapshot({}), true);
  assert.equal(shouldRetryStaleSnapshot({ staleRetry: true }), false, "a stale retry must not recursively schedule another retry");
});

test("resource states distinguish not-loaded, loading, error and loaded-empty", () => {
  const store = createSnapshotStore();
  acceptCoreSnapshot(store, { revision: 1, resourceState: { chat: "not_loaded" } });
  markSnapshotResource(store, "chat", "loading");
  assert.equal(projectSnapshotStore(store, "chat").resourceState.chat, "loading");
  markSnapshotResource(store, "chat", "error");
  assert.equal(projectSnapshotStore(store, "chat").resourceState.chat, "error");
  acceptSectionSnapshot(store, "chat", { revision: 1, tasks: [], resourceState: { chat: "loaded" } }, 1);
  const loaded = projectSnapshotStore(store, "chat");
  assert.equal(loaded.resourceState.chat, "loaded");
  assert.deepEqual(loaded.tasks, []);
  clearSnapshotStore(store);
  assert.equal(projectSnapshotStore(store, "chat"), null);
});
