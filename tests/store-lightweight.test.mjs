// lightweight saveDb 语义锁定：高频后台落盘跳过 knowledge 巨 blob、剥离 markets K 线数组，
// 且全量落盘仍完整持久化两者——保证"行情 tick 不重写知识库、业务变更不丢"。
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "store-light-test-"));
process.env.DATA_DIR = dataDir;

const { loadDb, loadDbReadOnlySnapshot, saveDb } = await import("../server/store.mjs");
const Database = (await import("better-sqlite3")).default;

function readCollection(name) {
  const sqlite = new Database(path.join(dataDir, "trading-agent.sqlite"), { readonly: true });
  const row = sqlite.prepare("SELECT value FROM collections WHERE name = ?").get(name);
  sqlite.close();
  return row ? JSON.parse(row.value) : undefined;
}

function readPersistenceMarker(collectionName, resourceType, resourceId) {
  const sqlite = new Database(path.join(dataDir, "trading-agent.sqlite"), { readonly: true });
  const collection = sqlite.prepare("SELECT updated_at FROM collections WHERE name = ?").get(collectionName);
  const entity = sqlite.prepare(`
    SELECT version FROM trading_entities
    WHERE resource_type = ? AND resource_id = ?
  `).get(resourceType, resourceId);
  sqlite.close();
  return { collectionUpdatedAt: collection?.updated_at, entityVersion: entity?.version };
}

function readEntityRow(resourceType, resourceId) {
  const sqlite = new Database(path.join(dataDir, "trading-agent.sqlite"), { readonly: true });
  const row = sqlite.prepare(`
    SELECT rowid, version, doc FROM trading_entities
    WHERE resource_type = ? AND resource_id = ?
  `).get(resourceType, resourceId);
  sqlite.close();
  return row;
}

test("lightweight save skips knowledge and strips candles; full save persists both", () => {
  const db = loadDb();
  db.knowledge.sources.push({ id: "s_full", title: "全量落盘的来源" });
  db.markets.push({ symbol: "TEST/USDT", price: 1, candles: [{ time: 1, close: 1 }], candlesByTf: { "1h": [{ time: 1 }] } });
  saveDb(db); // 全量:两者都持久化
  assert.ok(readCollection("knowledge").sources.some((s) => s.id === "s_full"));
  const persistedFull = readCollection("markets").find((m) => m.symbol === "TEST/USDT");
  assert.equal(persistedFull.candles.length, 1, "全量落盘应包含 K 线");

  // 轻量:knowledge 与 markets 都整体跳过(沿用上次全量值)——
  // 教训:曾写 slim markets 覆盖磁盘,重启后 K 线全丢(审计发现),故 markets 也必须 continue。
  db.knowledge.sources.push({ id: "s_light", title: "轻量期间的知识变更" });
  db.markets.find((m) => m.symbol === "TEST/USDT").price = 2;
  saveDb(db, { lightweight: true });
  assert.ok(!readCollection("knowledge").sources.some((s) => s.id === "s_light"), "轻量落盘不得重写 knowledge");
  const persistedLight = readCollection("markets").find((m) => m.symbol === "TEST/USDT");
  assert.equal(persistedLight.price, 1, "轻量落盘不得触碰 markets(沿用上次全量值)");
  assert.equal(persistedLight.candles.length, 1, "磁盘上的 K 线必须保留");
  assert.equal(db.markets.find((m) => m.symbol === "TEST/USDT").candles.length, 1, "内存中的 K 线不受影响");

  // 随后任意一次全量落盘补齐轻量期间的知识变更
  saveDb(db);
  assert.ok(readCollection("knowledge").sources.some((s) => s.id === "s_light"), "全量落盘应补齐知识变更");
});

test("中频事实使用独立行表持久化，历史回填不会塞进巨大collection", () => {
  const db = loadDb();
  const bucketAt = Math.floor(Date.now() / 300_000) * 300_000;
  db.mediumTermSamples = [{
    symbol: "BTC/USDT", bucketAt, at: new Date(bucketAt).toISOString(), price: 100, openInterest: 1000,
    observedAt: new Date().toISOString(), persistPending: true
  }];
  saveDb(db, { lightweight: true });
  assert.equal(readCollection("mediumTermSamples"), undefined, "高频事实不得写成整块JSON collection");
  const sqlite = new Database(path.join(dataDir, "trading-agent.sqlite"), { readonly: true });
  const row = sqlite.prepare("SELECT doc FROM medium_term_samples WHERE symbol = ? AND bucket_at = ?").get("BTC/USDT", bucketAt);
  sqlite.close();
  assert.ok(row);
  assert.equal(JSON.parse(row.doc).persistPending, undefined, "内部落盘标记不得污染事实");
  const snapshot = loadDbReadOnlySnapshot();
  assert.ok(snapshot.mediumTermSamples.some((item) => item.symbol === "BTC/USDT" && item.bucketAt === bucketAt));
});

test("read-only reload keeps the newest reconciliation report first", () => {
  const db = loadDb();
  db.reconciliationReports = [
    { id: "aaa-old-report", status: "needs_attention", createdAt: "2026-08-16T03:32:55.000Z", differences: [{ type: "stale" }] },
    { id: "zzz-new-report", status: "ok", createdAt: "2026-08-17T13:34:54.000Z", differences: [] }
  ];
  saveDb(db);

  const snapshot = loadDbReadOnlySnapshot();
  assert.equal(snapshot.reconciliationReports[0].id, "zzz-new-report");
  assert.equal(snapshot.reconciliationReports[0].status, "ok");
});

test("saving one changed collection does not rewrite unchanged collections or entity rows", async () => {
  const db = loadDb();
  const snapshotId = "snapshot_delta_persistence_guard";
  db.accountSnapshots = [{
    id: snapshotId,
    status: "ok",
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
    equity: 100
  }];
  saveDb(db);
  const before = readPersistenceMarker("knowledge", "accountSnapshots", snapshotId);

  await new Promise((resolve) => setTimeout(resolve, 5));
  db.tasks.push({
    id: "task_delta_persistence_guard",
    name: "增量持久化回归",
    handler: "reminder",
    type: "Every",
    schedule: "Every 1h",
    enabled: false,
    createdAt: "2026-08-25T00:00:00.000Z"
  });
  saveDb(db);

  const after = readPersistenceMarker("knowledge", "accountSnapshots", snapshotId);
  assert.equal(after.collectionUpdatedAt, before.collectionUpdatedAt, "未改变的 knowledge 不应重写");
  assert.equal(after.entityVersion, before.entityVersion, "未改变的实体不应删除重插并增加版本");
  assert.ok(readCollection("tasks").some((task) => task.id === "task_delta_persistence_guard"), "改变的 tasks 必须落盘");
});

test("collection-scoped save does not serialize unrelated state", () => {
  const db = loadDb();
  const originalKnowledge = db.knowledge;
  db.knowledge = {
    ...originalKnowledge,
    toJSON() {
      throw new Error("unrelated_knowledge_was_serialized");
    }
  };
  db.tasks.push({
    id: "task_scoped_persistence_guard",
    name: "范围持久化回归",
    handler: "reminder",
    type: "Every",
    schedule: "Every 1h",
    enabled: false,
    createdAt: "2026-08-25T00:00:00.000Z"
  });

  assert.doesNotThrow(() => saveDb(db, { collections: ["tasks"] }));
  assert.ok(readCollection("tasks").some((task) => task.id === "task_scoped_persistence_guard"));
});

test("appending one account snapshot preserves unchanged entity rows and removes only the retired row", () => {
  const db = loadDb();
  const first = {
    id: "snapshot_incremental_first",
    status: "ok",
    createdAt: "2026-08-25T00:00:00.000Z",
    balances: [{ totalEq: "100" }]
  };
  db.accountSnapshots = [first];
  saveDb(db, { collections: ["accountSnapshots"] });
  const firstBefore = readEntityRow("accountSnapshots", first.id);
  assert.ok(firstBefore);

  const second = {
    id: "snapshot_incremental_second",
    status: "ok",
    createdAt: "2026-08-25T00:01:00.000Z",
    balances: [{ totalEq: "101" }]
  };
  db.accountSnapshots.unshift(second);
  saveDb(db, { collections: ["accountSnapshots"] });
  const firstAfterAppend = readEntityRow("accountSnapshots", first.id);
  const secondAfterAppend = readEntityRow("accountSnapshots", second.id);
  assert.equal(firstAfterAppend.rowid, firstBefore.rowid, "an unchanged snapshot must not be deleted and reinserted");
  assert.ok(secondAfterAppend);

  db.accountSnapshots = [second];
  saveDb(db, { collections: ["accountSnapshots"] });
  assert.equal(readEntityRow("accountSnapshots", first.id), undefined, "the retention-evicted snapshot must be deleted");
  assert.equal(readEntityRow("accountSnapshots", second.id).rowid, secondAfterAppend.rowid, "the retained snapshot must stay untouched");
});
