import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import Database from "better-sqlite3";
import { setReduceOnlyReason } from "../server/reduceOnlyState.mjs";

const testRoot = await fs.mkdtemp(path.join("/private/tmp", "audit-chain-no-reseal-"));
const dataDir = path.join(testRoot, "db");
process.env.TEST_DATA_ROOT = testRoot;
process.env.DATA_DIR = dataDir;
after(() => fs.rm(testRoot, { recursive: true, force: true }));
const {
  appendAudit,
  applyAuditIntegrityState,
  loadDb,
  saveDb,
  verifyAuditChain,
  verifyAuditChainReadOnly,
  verifyAuditOperationalContinuity,
} = await import(`../server/store.mjs?audit-no-reseal=${Date.now()}`);

test("启动发现审计链断裂时保留原 hash 并切只减仓", () => {
  const db = loadDb();
  const first = appendAudit(db, "first", "one", "test");
  const second = appendAudit(db, "second", "two", "test");
  saveDb(db);
  const originalHash = first.hash;
  const sqlitePath = path.join(dataDir, "trading-agent.sqlite");
  const writer = new Database(sqlitePath);
  const stored = JSON.parse(writer.prepare("select doc from audit_log_entries where id = ?").get(first.id).doc);
  stored.action = "tampered";
  writer.prepare("update audit_log_entries set action = ?, doc = ? where id = ?").run(stored.action, JSON.stringify(stored), first.id);
  writer.close();
  assert.equal(verifyAuditChain(db).ok, false);

  const reloaded = loadDb();
  const persistedFirst = reloaded.auditLogs.find((entry) => entry.id === first.id);
  assert.equal(persistedFirst.hash, originalHash);
  assert.equal(reloaded.meta.auditChainBroken, true);
  assert.equal(reloaded.system.reduceOnlyMode, true);
  assert.equal(reloaded.system.reduceOnlyBy, "audit_chain_integrity");
  assert.equal(verifyAuditChainReadOnly().ok, false);
  assert.ok(reloaded.riskIncidents.some((item) => item.source === "audit_chain_integrity" && item.status === "open"));
  assert.ok(second.hash);
});

test("approved local continuity resolves only the runtime block while legacy history remains broken", () => {
  const db = loadDb();
  const raw = verifyAuditChain(db);
  assert.equal(raw.ok, false);
  const beforeHashes = db.auditLogs.map((entry) => entry.hash);
  const continuity = {
    operationalReady: true,
    mode: "incident_adjudicated_local_continuity",
    confidence: "local_integrity_only",
    deploymentMode: "owner_risk_accepted_standalone",
    legacyChainOk: false,
    legacyClassification: "legacy_forensic_integrity_limited",
    legacyStoredLinkBreaks: raw.breaks.length,
    legacyBreakIslands: 1,
    legacyPrefixDigest: "1".repeat(64),
    cutoffRowid: 3,
    cutoffHeadHash: db.auditLogs[0].hash,
    tailRowsChecked: 0,
    externalAttestation: "deferred",
    failures: [],
  };

  applyAuditIntegrityState(db, { raw, continuity, tip: db.auditLogs[0].hash, checkedAt: "2026-08-21T00:00:00.000Z" });

  assert.equal(db.meta.auditChainBroken, true);
  assert.equal(db.meta.auditContinuityReady, true);
  assert.equal(db.meta.auditContinuityMode, "incident_adjudicated_local_continuity");
  assert.equal(db.meta.auditContinuityConfidence, "local_integrity_only");
  assert.equal(db.system.reduceOnlyMode, false);
  assert.deepEqual(db.auditLogs.map((entry) => entry.hash), beforeHashes);
  const incident = db.riskIncidents.find((item) => item.source === "audit_chain_integrity");
  assert.equal(incident.status, "resolved");
  assert.equal(incident.resolvedBy, "AuditContinuityVerifier");
  assert.equal(incident.resolution, "incident_adjudicated_local_continuity");
  assert.equal(verifyAuditChain(db).ok, false);
  assert.equal(verifyAuditChainReadOnly().ok, false);
});

test("audit adjudication preserves an unrelated emergency reduce-only reason", () => {
  const db = {
    meta: {},
    system: { reduceOnlyMode: true, reduceOnlyBy: "audit_chain_integrity" },
    riskIncidents: [],
    executionOrders: [],
    armedSetups: [],
    orders: [],
    portfolio: {},
  };
  setReduceOnlyReason(db, "audit_chain_integrity", { sticky: true, sourceId: "AuditIntegrityCheck" });
  setReduceOnlyReason(db, "emergency_flatten", { sticky: true, sourceId: "emergency_1" });

  applyAuditIntegrityState(db, {
    raw: { ok: false, checked: 1, breaks: [{ id: "legacy_break" }] },
    continuity: {
      operationalReady: true,
      mode: "incident_adjudicated_local_continuity",
      confidence: "local_integrity_only",
      failures: [],
    },
    checkedAt: "2026-08-21T00:00:00.000Z",
  });

  assert.equal(db.system.reduceOnlyMode, true);
  assert.equal(db.system.reduceOnlyBy, "emergency_flatten");
  assert.deepEqual(db.system.reduceOnlyReasons, ["emergency_flatten"]);
});

test("a later continuity failure restores the existing audit block without sticky green", () => {
  const db = loadDb();
  const raw = verifyAuditChain(db);
  applyAuditIntegrityState(db, {
    raw,
    continuity: { operationalReady: true, mode: "incident_adjudicated_local_continuity", confidence: "local_integrity_only", failures: [] },
    tip: db.auditLogs[0].hash,
    checkedAt: "2026-08-21T00:00:00.000Z",
  });
  applyAuditIntegrityState(db, {
    raw,
    continuity: { operationalReady: false, mode: "invalid", confidence: "none", failures: [{ code: "tail_invalid" }] },
    tip: db.auditLogs[0].hash,
    checkedAt: "2026-08-21T00:01:00.000Z",
  });
  assert.equal(db.meta.auditChainBroken, true);
  assert.equal(db.meta.auditContinuityReady, false);
  assert.equal(db.system.reduceOnlyMode, true);
  assert.equal(db.system.reduceOnlyBy, "audit_chain_integrity");
  assert.ok(db.riskIncidents.some((item) => item.source === "audit_chain_integrity" && item.status === "open"));
});

test("a small broken database cannot self-authorize as the frozen W0 incident", () => {
  const status = verifyAuditOperationalContinuity(loadDb());
  assert.equal(status.operationalReady, false);
  assert.ok(status.failures.some((failure) => failure.code === "baseline_missing" || failure.code === "approved_evidence_mismatch"));
});
