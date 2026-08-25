import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import Database from "better-sqlite3";

const testRoot = await fs.mkdtemp(path.join("/private/tmp", "audit-operational-cache-"));
const dataDir = path.join(testRoot, "db");
process.env.TEST_DATA_ROOT = testRoot;
process.env.DATA_DIR = dataDir;
delete process.env.AUDIT_CONTINUITY_BASELINE_FILE;
after(() => fs.rm(testRoot, { recursive: true, force: true }));

const {
  appendAudit,
  auditOperationalVerificationStats,
  loadDb,
  verifyAuditOperationalContinuity
} = await import(`../server/store.mjs?audit-operational-cache=${Date.now()}`);

test("operational audit verification caches an unchanged chain and incrementally verifies trusted appends", () => {
  const db = loadDb();
  appendAudit(db, "cache first", "audit-cache", "Test");
  const before = auditOperationalVerificationStats();

  const initial = verifyAuditOperationalContinuity(db);
  const afterInitial = auditOperationalVerificationStats();
  assert.equal(initial.operationalReady, true);
  assert.ok(before.fullScans >= 1, "loadDb must establish one full-chain baseline");
  assert.equal(afterInitial.fullScans, before.fullScans);
  assert.equal(afterInitial.incrementalRows, before.incrementalRows + 1);

  const cached = verifyAuditOperationalContinuity(db);
  const afterCached = auditOperationalVerificationStats();
  assert.equal(cached.operationalReady, true);
  assert.equal(afterCached.fullScans, afterInitial.fullScans);
  assert.equal(afterCached.cacheHits, afterInitial.cacheHits + 1);

  appendAudit(db, "cache second", "audit-cache", "Test");
  const extended = verifyAuditOperationalContinuity(db);
  const afterExtended = auditOperationalVerificationStats();
  assert.equal(extended.operationalReady, true);
  assert.equal(afterExtended.fullScans, afterCached.fullScans);
  assert.equal(afterExtended.incrementalRows, afterCached.incrementalRows + 1);
});

test("an external SQLite mutation invalidates the cache and forces a fail-closed full scan", () => {
  const db = loadDb();
  const target = appendAudit(db, "external mutation target", "audit-cache", "Test");
  assert.equal(verifyAuditOperationalContinuity(db).operationalReady, true);
  const beforeMutation = auditOperationalVerificationStats();
  const sqlitePath = path.join(dataDir, "trading-agent.sqlite");
  const writer = new Database(sqlitePath);
  const row = writer.prepare("SELECT doc FROM audit_log_entries WHERE id = ?").get(target.id);
  const changed = JSON.parse(row.doc);
  changed.action = "externally tampered";
  writer.prepare("UPDATE audit_log_entries SET action = ?, doc = ? WHERE id = ?")
    .run(changed.action, JSON.stringify(changed), target.id);
  writer.close();

  const invalid = verifyAuditOperationalContinuity(db);
  const afterMutation = auditOperationalVerificationStats();
  assert.equal(invalid.operationalReady, false);
  assert.equal(afterMutation.fullScans, beforeMutation.fullScans + 1);
  assert.ok(invalid.failures.some((failure) => failure.code === "baseline_missing"));
});
