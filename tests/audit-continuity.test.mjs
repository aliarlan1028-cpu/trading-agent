import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

import {
  legacyAuditTableDigest,
  readAuditContinuityBaseline,
  verifyAuditContinuityRows,
  verifyAuditEntries,
} from "../server/auditContinuity.mjs";

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "audit-continuity-test-"));
after(() => fs.rm(tempRoot, { recursive: true, force: true }));

function referenceAuditHash(entry) {
  const payload = {
    id: entry.id,
    actor: entry.actor,
    action: entry.action,
    target: entry.target,
    severity: entry.severity,
    prevHash: entry.prevHash || null,
    createdAt: entry.createdAt,
  };
  if (entry.requestedBy) {
    payload.requestedBy = entry.requestedBy;
    payload.requestedByUserId = entry.requestedByUserId || null;
    payload.tenantId = entry.tenantId || null;
  }
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function entry({ id, action, target, prevHash, createdAt }) {
  const value = { id, actor: "Test", action, target, severity: "info", prevHash, createdAt };
  value.hash = referenceAuditHash(value);
  return value;
}

const first = entry({
  id: "audit_1",
  action: "first",
  target: "one",
  prevHash: null,
  createdAt: "2026-08-20T00:00:00.000Z",
});
const broken = entry({
  id: "audit_2",
  action: "second",
  target: "two",
  prevHash: "f".repeat(64),
  createdAt: "2026-08-20T00:00:01.000Z",
});
const cutoff = entry({
  id: "audit_3",
  action: "third",
  target: "three",
  prevHash: broken.hash,
  createdAt: "2026-08-20T00:00:02.000Z",
});
const tail = entry({
  id: "audit_4",
  action: "fourth",
  target: "four",
  prevHash: cutoff.hash,
  createdAt: "2026-08-20T00:00:03.000Z",
});

function row(rowid, value) {
  return {
    rowid,
    id: Buffer.from(value.id),
    actor: Buffer.from(value.actor),
    action: Buffer.from(value.action),
    target: Buffer.from(value.target),
    severity: Buffer.from(value.severity),
    created_at: Buffer.from(value.createdAt),
    doc: Buffer.from(JSON.stringify(value)),
  };
}

function cloneRows(rows) {
  return rows.map((item) => Object.fromEntries(Object.entries(item).map(([key, value]) => [key, Buffer.isBuffer(value) ? Buffer.from(value) : value])));
}

const prefixRows = [row(1, first), row(2, broken), row(3, cutoff)];
const allRows = [...prefixRows, row(4, tail)];

function approvedIncident(overrides = {}) {
  return Object.freeze({
    w0CaptureId: "W0-TEST-CAPTURE",
    legacyDatabaseSha256: "1".repeat(64),
    captureMetadataSha256: "2".repeat(64),
    breakReportSha256: "3".repeat(64),
    breakCsvSha256: "4".repeat(64),
    legacyPrefixDigestRule: "ta-legacy-audit-table-v1-lp1-sha256",
    legacyPrefixDigest: "1c91ac0ac86447d911db6f0e4f4a1af66a9c76f4d5a9801e7dca5f83ff0d6252",
    legacyCutoffRowid: 3,
    legacyCutoffCreatedAt: cutoff.createdAt,
    legacyCutoffHeadHash: cutoff.hash,
    legacyCutoffPrevHash: cutoff.prevHash,
    legacyAuditRowCount: 3,
    legacyStoredLinkBreaks: 1,
    legacyBreakIslands: 1,
    ...overrides,
  });
}

function baselineFor(approved = approvedIncident(), overrides = {}) {
  return {
    schemaVersion: 1,
    mode: "incident_adjudicated_local_continuity",
    confidence: "local_integrity_only",
    deploymentMode: "owner_risk_accepted_standalone",
    legacyClassification: "legacy_forensic_integrity_limited",
    externalAttestation: "deferred",
    epoch2: "deferred",
    legacyRewrite: "forbidden",
    ...approved,
    approvalId: "SECURITY-OWNER-TEST-APPROVAL",
    approvedBy: "SecurityOwner",
    approvedAt: "2026-08-21T00:00:00.000Z",
    ...overrides,
  };
}

function verify(rows = allRows, approved = approvedIncident(), baseline = baselineFor(approved), securityProfile = "bitlaunch_single_server") {
  return verifyAuditContinuityRows({ rows, approvedIncident: approved, baseline, securityProfile });
}

test("legacy digest is stable over exact stored bytes and rowid order", () => {
  assert.equal(legacyAuditTableDigest(prefixRows), "1c91ac0ac86447d911db6f0e4f4a1af66a9c76f4d5a9801e7dca5f83ff0d6252");
  const changed = cloneRows(prefixRows);
  changed[0].actor = Buffer.from("Changed");
  assert.notEqual(legacyAuditTableDigest(changed), "1c91ac0ac86447d911db6f0e4f4a1af66a9c76f4d5a9801e7dca5f83ff0d6252");
});

test("adjudicated legacy break remains raw-invalid while exact prefix and tail are operationally ready", () => {
  const raw = verifyAuditEntries([first, broken, cutoff, tail]);
  const status = verify();
  assert.equal(raw.ok, false);
  assert.equal(raw.breaks.length, 1);
  assert.equal(status.operationalReady, true);
  assert.equal(status.mode, "incident_adjudicated_local_continuity");
  assert.equal(status.confidence, "local_integrity_only");
  assert.equal(status.legacyChainOk, false);
  assert.equal(status.legacyStoredLinkBreaks, 1);
  assert.equal(status.legacyBreakIslands, 1);
  assert.equal(status.tailRowsChecked, 1);
  assert.equal(status.externalAttestation, "deferred");
  assert.deepEqual(status.failures, []);
});

test("broken history without an approval baseline remains fail-closed", () => {
  const status = verifyAuditContinuityRows({ rows: allRows, approvedIncident: approvedIncident(), baseline: null, securityProfile: "bitlaunch_single_server" });
  assert.equal(status.operationalReady, false);
  assert.ok(status.failures.some((failure) => failure.code === "baseline_missing"));
});

test("local incident adjudication is not accepted by external_hardened", () => {
  const status = verify(allRows, approvedIncident(), baselineFor(), "external_hardened");
  assert.equal(status.operationalReady, false);
  assert.ok(status.failures.some((failure) => failure.code === "profile_not_allowed"));
});

test("a changed stored legacy field invalidates the frozen prefix", () => {
  const changed = cloneRows(allRows);
  changed[0].actor = Buffer.from("Changed");
  const status = verify(changed);
  assert.equal(status.operationalReady, false);
  assert.ok(status.failures.some((failure) => failure.code === "legacy_prefix_mismatch"));
});

test("missing or changed cutoff evidence fails closed", () => {
  const missing = verify(allRows.filter((item) => item.rowid !== 3));
  assert.equal(missing.operationalReady, false);
  assert.ok(missing.failures.some((failure) => failure.code === "cutoff_mismatch"));

  const changed = cloneRows(allRows);
  const changedCutoff = JSON.parse(changed[2].doc.toString("utf8"));
  changedCutoff.hash = "a".repeat(64);
  changed[2].doc = Buffer.from(JSON.stringify(changedCutoff));
  const mismatch = verify(changed);
  assert.equal(mismatch.operationalReady, false);
  assert.ok(mismatch.failures.some((failure) => failure.code === "cutoff_mismatch"));
});

test("approved stored-link break count and island count must match observed prefix", () => {
  const wrongBreaks = approvedIncident({ legacyStoredLinkBreaks: 2 });
  const breakStatus = verify(allRows, wrongBreaks, baselineFor(wrongBreaks));
  assert.equal(breakStatus.operationalReady, false);
  assert.ok(breakStatus.failures.some((failure) => failure.code === "legacy_break_facts_mismatch"));

  const wrongIslands = approvedIncident({ legacyBreakIslands: 2 });
  const islandStatus = verify(allRows, wrongIslands, baselineFor(wrongIslands));
  assert.equal(islandStatus.operationalReady, false);
  assert.ok(islandStatus.failures.some((failure) => failure.code === "legacy_break_facts_mismatch"));
});

test("first and later tail link failures are rejected", () => {
  const firstBroken = cloneRows(allRows);
  const firstTail = JSON.parse(firstBroken[3].doc.toString("utf8"));
  firstTail.prevHash = "9".repeat(64);
  firstTail.hash = referenceAuditHash(firstTail);
  firstBroken[3].doc = Buffer.from(JSON.stringify(firstTail));
  const firstStatus = verify(firstBroken);
  assert.equal(firstStatus.operationalReady, false);
  assert.ok(firstStatus.failures.some((failure) => failure.code === "tail_invalid"));

  const fifth = entry({ id: "audit_5", action: "fifth", target: "five", prevHash: tail.hash, createdAt: "2026-08-20T00:00:04.000Z" });
  const laterBroken = [...cloneRows(allRows), row(5, { ...fifth, prevHash: "8".repeat(64), hash: referenceAuditHash({ ...fifth, prevHash: "8".repeat(64) }) })];
  const laterStatus = verify(laterBroken);
  assert.equal(laterStatus.operationalReady, false);
  assert.ok(laterStatus.failures.some((failure) => failure.code === "tail_invalid"));
});

test("tail content mutation is rejected while a valid append remains ready", () => {
  const changed = cloneRows(allRows);
  const changedTail = JSON.parse(changed[3].doc.toString("utf8"));
  changedTail.action = "tampered";
  changed[3].doc = Buffer.from(JSON.stringify(changedTail));
  const mismatch = verify(changed);
  assert.equal(mismatch.operationalReady, false);
  assert.ok(mismatch.failures.some((failure) => failure.code === "tail_invalid"));

  const fifth = entry({ id: "audit_5", action: "fifth", target: "five", prevHash: tail.hash, createdAt: "2026-08-20T00:00:04.000Z" });
  const appended = verify([...allRows, row(5, fifth)]);
  assert.equal(appended.operationalReady, true);
  assert.equal(appended.tailRowsChecked, 2);
});

async function writeBaseline(name, contents, mode = 0o400) {
  const file = path.join(tempRoot, name);
  await fs.writeFile(file, contents, { mode: 0o600 });
  await fs.chmod(file, mode);
  return file;
}

test("strict baseline reader accepts one read-only regular JSON object", async () => {
  const expected = baselineFor();
  const file = await writeBaseline("valid.json", JSON.stringify(expected));
  assert.deepEqual(readAuditContinuityBaseline(file), expected);
});

test("strict baseline reader rejects writable files and symlinks", async () => {
  const writable = await writeBaseline("writable.json", JSON.stringify(baselineFor()), 0o600);
  assert.throws(() => readAuditContinuityBaseline(writable), (error) => error.code === "baseline_unsafe");

  const target = await writeBaseline("target.json", JSON.stringify(baselineFor()));
  const link = path.join(tempRoot, "baseline-link.json");
  await fs.symlink(target, link);
  assert.throws(() => readAuditContinuityBaseline(link), (error) => error.code === "baseline_unsafe");
});

test("strict baseline reader rejects duplicate, missing, unexpected, and malformed fields", async () => {
  const valid = baselineFor();
  const duplicate = await writeBaseline("duplicate.json", JSON.stringify(valid).replace("{", "{\"schemaVersion\":1,"));
  assert.throws(() => readAuditContinuityBaseline(duplicate), (error) => error.code === "baseline_schema_invalid");

  const { approvalId: _removed, ...missingValue } = valid;
  const missing = await writeBaseline("missing.json", JSON.stringify(missingValue));
  assert.throws(() => readAuditContinuityBaseline(missing), (error) => error.code === "baseline_schema_invalid");

  const unexpected = await writeBaseline("unexpected.json", JSON.stringify({ ...valid, extra: true }));
  assert.throws(() => readAuditContinuityBaseline(unexpected), (error) => error.code === "baseline_schema_invalid");

  const uppercase = await writeBaseline("uppercase.json", JSON.stringify({ ...valid, legacyPrefixDigest: "A".repeat(64) }));
  assert.throws(() => readAuditContinuityBaseline(uppercase), (error) => error.code === "baseline_schema_invalid");

  const unsupported = await writeBaseline("unsupported.json", JSON.stringify({ ...valid, schemaVersion: 2 }));
  assert.throws(() => readAuditContinuityBaseline(unsupported), (error) => error.code === "baseline_schema_invalid");
});
