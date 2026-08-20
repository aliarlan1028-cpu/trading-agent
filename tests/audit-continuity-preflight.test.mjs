import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { auditPreflightDecision } from "../server/auditContinuity.mjs";

const validLocal = Object.freeze({
  operationalReady: true,
  mode: "incident_adjudicated_local_continuity",
  confidence: "local_integrity_only",
  legacyChainOk: false,
  externalAttestation: "deferred",
  failures: [],
});
const invalidLocal = Object.freeze({
  ...validLocal,
  operationalReady: false,
  mode: "invalid",
  confidence: "none",
  failures: [{ code: "tail_invalid" }],
});

test("BitLaunch preflight accepts only the approved local-continuity assurance with an explicit warning", () => {
  const decision = auditPreflightDecision(validLocal, "bitlaunch_single_server");
  assert.equal(decision.allowed, true);
  assert.equal(decision.status.legacyChainOk, false);
  assert.match(decision.warning, /local_integrity_only/);
  assert.match(decision.warning, /external attestation/i);
  assert.match(decision.warning, /WORM/);
});

test("external_hardened cannot use the standalone local-continuity exception", () => {
  const decision = auditPreflightDecision(validLocal, "external_hardened");
  assert.equal(decision.allowed, false);
  assert.equal(decision.warning, null);
});

test("preflight rejects a local exception that overstates its assurance", () => {
  for (const status of [
    { ...validLocal, confidence: "trusted" },
    { ...validLocal, legacyChainOk: true },
    { ...validLocal, externalAttestation: "verified" },
  ]) {
    assert.equal(auditPreflightDecision(status, "bitlaunch_single_server").allowed, false);
  }
});

test("preflight policy has no sticky green after a later continuity failure", () => {
  assert.equal(auditPreflightDecision(validLocal, "bitlaunch_single_server").allowed, true);
  const later = auditPreflightDecision(invalidLocal, "bitlaunch_single_server");
  assert.equal(later.allowed, false);
  assert.equal(later.status.failures[0].code, "tail_invalid");
});

test("a fully valid raw local chain satisfies the audit part of either profile", () => {
  const full = { operationalReady: true, mode: "full_chain", confidence: "full_chain_local", legacyChainOk: true, failures: [] };
  assert.equal(auditPreflightDecision(full, "bitlaunch_single_server").allowed, true);
  assert.equal(auditPreflightDecision(full, "external_hardened").allowed, true);
});

test("production preflight exposes a real audit continuity failure from isolated SQLite", async () => {
  const testRoot = process.env.TEST_DATA_ROOT;
  assert.ok(testRoot && fs.realpathSync.native(testRoot).startsWith(fs.realpathSync.native("/tmp")));
  const dataDir = path.join(testRoot, "audit-preflight-runtime");
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.DATA_DIR = dataDir;
  const { appendAudit, loadDb, saveDb } = await import(`../server/store.mjs?preflight-fixture=${Date.now()}`);
  const db = loadDb();
  const first = appendAudit(db, "first", "one", "Test");
  appendAudit(db, "second", "two", "Test");
  saveDb(db);

  const sqlitePath = path.join(dataDir, "trading-agent.sqlite");
  const writer = new Database(sqlitePath);
  const row = writer.prepare("select doc from audit_log_entries where id = ?").get(first.id);
  const changed = JSON.parse(row.doc);
  changed.action = "tampered";
  writer.prepare("update audit_log_entries set action = ?, doc = ? where id = ?").run(changed.action, JSON.stringify(changed), first.id);
  writer.close();

  const env = {
    ...process.env,
    DATA_DIR: dataDir,
    PRODUCTION_SECURITY_PROFILE: "bitlaunch_single_server",
    AUTH_REQUIRED: "true",
    ADMIN_PASSWORD: "preflight-test-password",
    SECRETS_MASTER_KEY: "preflight-test-master-key-material-32-bytes",
    PUBLIC_REGISTRATION_MODE: "closed",
    PUBLIC_REGISTRATION_ENABLED: "false",
    TENANT_ISOLATION_V2: "false",
    OKX_DEMO_TRADING: "false",
  };
  delete env.AUDIT_CONTINUITY_BASELINE_FILE;
  const result = spawnSync(process.execPath, ["scripts/production-preflight.mjs"], {
    cwd: path.resolve("."), env, encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.equal(result.stderr, "");
  const report = JSON.parse(result.stdout);
  assert.ok(report.failures.includes("Local audit continuity verification failed"));
  assert.equal(report.audit.operationalReady, false);
  assert.ok(report.audit.failures.some((failure) => failure.code === "baseline_missing"));
});
