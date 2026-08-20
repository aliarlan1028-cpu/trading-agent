import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SECURITY_PROFILES, productionSecurityProfile } from "./securityProfile.mjs";

export const APPROVED_W0_INCIDENT = Object.freeze({
  w0CaptureId: "W0-20260820T180715Z",
  legacyDatabaseSha256: "f3a5c3471aa8439d94fbe7291694a9cda02322995de334f964aafbab53304af7",
  captureMetadataSha256: "699ae8bb41cce383a75ab3a6b97bf5b390daf3f48e5c942d87400b7827378f3c",
  breakReportSha256: "c9184b6aa4255ce8edf08698653a3c8552ec3fb81fbc665a868f6c89fc053de6",
  breakCsvSha256: "d4c45a38e1f6263106cd7799a92b894a483922f2c171ee3a5ed53873784c56fa",
  legacyPrefixDigestRule: "ta-legacy-audit-table-v1-lp1-sha256",
  legacyPrefixDigest: "d596ecebe7400d5b221ce959a5b7cf173fd093c53ca88fe0fe736798c9640672",
  legacyCutoffRowid: 127399,
  legacyCutoffCreatedAt: "2026-08-20T17:34:11.024Z",
  legacyCutoffHeadHash: "3415f657226bd46be4ae38f4b9a1ff49cb67c0f9953800c5e57429937350b3b0",
  legacyCutoffPrevHash: "201e80c9cc09bf323a7470ec919a3d27445a6ec28f9930a19c5d348a7f545d93",
  legacyAuditRowCount: 70548,
  legacyStoredLinkBreaks: 674,
  legacyBreakIslands: 282,
});

const POLICY_FIELDS = Object.freeze({
  schemaVersion: 1,
  mode: "incident_adjudicated_local_continuity",
  confidence: "local_integrity_only",
  deploymentMode: "owner_risk_accepted_standalone",
  legacyClassification: "legacy_forensic_integrity_limited",
  externalAttestation: "deferred",
  epoch2: "deferred",
  legacyRewrite: "forbidden",
});
const APPROVAL_FIELDS = Object.freeze(["approvalId", "approvedBy", "approvedAt"]);
const INCIDENT_FIELDS = Object.freeze(Object.keys(APPROVED_W0_INCIDENT));
const BASELINE_FIELDS = Object.freeze([...Object.keys(POLICY_FIELDS), ...INCIDENT_FIELDS, ...APPROVAL_FIELDS]);
const HEX_256 = /^[0-9a-f]{64}$/;

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function auditHash(entry) {
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

export function verifyAuditEntries(entries) {
  let previous = null;
  const breaks = [];
  for (const entry of entries) {
    if (entry.prevHash !== previous) {
      breaks.push({ id: entry.id, expectedPrevHash: previous, actualPrevHash: entry.prevHash });
    }
    if (entry.hash) {
      const expectedHash = auditHash(entry);
      if (entry.hash !== expectedHash) breaks.push({ id: entry.id, expectedHash, actualHash: entry.hash });
    }
    previous = entry.hash || auditHash(entry);
  }
  return { ok: breaks.length === 0, checked: entries.length, breaks };
}

function u16be(value) {
  const result = Buffer.alloc(2);
  result.writeUInt16BE(value);
  return result;
}

function u64be(value) {
  const numeric = typeof value === "bigint" ? value : BigInt(value);
  if (numeric < 0n || numeric > 0xffffffffffffffffn) throw codedError("audit_rows_invalid", "Audit integer is outside unsigned 64-bit range");
  const result = Buffer.alloc(8);
  result.writeBigUInt64BE(numeric);
  return result;
}

function writeTypedU64(digest, value) {
  digest.update(Buffer.from([0x02]));
  digest.update(u64be(8));
  digest.update(u64be(value));
}

function writeTypedBlob(digest, value) {
  if (value === null || value === undefined) {
    digest.update(Buffer.from([0x00]));
    digest.update(u64be(0));
    return;
  }
  if (!Buffer.isBuffer(value)) throw codedError("audit_rows_invalid", "Legacy digest fields must be exact SQLite bytes");
  digest.update(Buffer.from([0x05]));
  digest.update(u64be(value.length));
  digest.update(value);
}

export function legacyAuditTableDigest(rows) {
  const digest = crypto.createHash("sha256");
  digest.update(Buffer.from("TRADING_AGENT_LEGACY_AUDIT_TABLE\0", "utf8"));
  digest.update(u16be(1));
  digest.update(u64be(rows.length));
  for (const row of rows) {
    digest.update(Buffer.from("ROW\0", "utf8"));
    writeTypedU64(digest, row.rowid);
    for (const field of ["id", "actor", "action", "target", "severity", "created_at", "doc"]) {
      writeTypedBlob(digest, row[field]);
    }
  }
  return digest.digest("hex");
}

function skipWhitespace(text, start) {
  let index = start;
  while (/\s/.test(text[index] || "")) index += 1;
  return index;
}

function scanJsonString(text, start) {
  if (text[start] !== "\"") throw codedError("baseline_schema_invalid", "Baseline keys must be JSON strings");
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      const raw = text.slice(start, index + 1);
      return { value: JSON.parse(raw), next: index + 1 };
    }
  }
  throw codedError("baseline_schema_invalid", "Baseline contains an unterminated JSON string");
}

function assertNoDuplicateTopLevelKeys(text) {
  let index = skipWhitespace(text, 0);
  if (text[index] !== "{") throw codedError("baseline_schema_invalid", "Baseline must be one flat JSON object");
  index = skipWhitespace(text, index + 1);
  const seen = new Set();
  if (text[index] === "}") return;
  while (index < text.length) {
    const key = scanJsonString(text, index);
    if (seen.has(key.value)) throw codedError("baseline_schema_invalid", `Duplicate baseline key: ${key.value}`);
    seen.add(key.value);
    index = skipWhitespace(text, key.next);
    if (text[index] !== ":") throw codedError("baseline_schema_invalid", "Baseline key is missing a value separator");
    index = skipWhitespace(text, index + 1);
    if (text[index] === "\"") {
      index = scanJsonString(text, index).next;
    } else {
      const valueStart = index;
      while (index < text.length && text[index] !== "," && text[index] !== "}") index += 1;
      if (!text.slice(valueStart, index).trim() || text[valueStart] === "{" || text[valueStart] === "[") {
        throw codedError("baseline_schema_invalid", "Baseline values must be flat JSON scalars");
      }
    }
    index = skipWhitespace(text, index);
    if (text[index] === "}") {
      index = skipWhitespace(text, index + 1);
      if (index !== text.length) throw codedError("baseline_schema_invalid", "Baseline contains trailing content");
      return;
    }
    if (text[index] !== ",") throw codedError("baseline_schema_invalid", "Baseline fields must be comma separated");
    index = skipWhitespace(text, index + 1);
  }
  throw codedError("baseline_schema_invalid", "Baseline JSON object is incomplete");
}

function validateBaselineObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw codedError("baseline_schema_invalid", "Baseline must be a JSON object");
  }
  const keys = Object.keys(value).sort();
  const expected = [...BASELINE_FIELDS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw codedError("baseline_schema_invalid", "Baseline fields do not match the approved schema");
  }
  for (const [field, expectedValue] of Object.entries(POLICY_FIELDS)) {
    if (value[field] !== expectedValue) throw codedError("baseline_schema_invalid", `Unsupported baseline policy: ${field}`);
  }
  for (const field of ["legacyDatabaseSha256", "captureMetadataSha256", "breakReportSha256", "breakCsvSha256", "legacyPrefixDigest", "legacyCutoffHeadHash", "legacyCutoffPrevHash"]) {
    if (!HEX_256.test(value[field])) throw codedError("baseline_schema_invalid", `Baseline field is not canonical SHA-256: ${field}`);
  }
  for (const field of ["legacyCutoffRowid", "legacyAuditRowCount", "legacyStoredLinkBreaks", "legacyBreakIslands"]) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 0) throw codedError("baseline_schema_invalid", `Baseline field must be a safe non-negative integer: ${field}`);
  }
  for (const field of ["w0CaptureId", "legacyPrefixDigestRule", "legacyCutoffCreatedAt", "approvalId", "approvedBy", "approvedAt"]) {
    if (typeof value[field] !== "string" || !value[field].trim() || value[field].length > 256) {
      throw codedError("baseline_schema_invalid", `Baseline field must be a bounded non-empty string: ${field}`);
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.approvedAt) || !Number.isFinite(new Date(value.approvedAt).getTime())) {
    throw codedError("baseline_schema_invalid", "Baseline approvedAt must be a UTC RFC 3339 timestamp");
  }
  return value;
}

export function readAuditContinuityBaseline(filePath) {
  const resolved = String(filePath || "").trim();
  if (!resolved || !path.isAbsolute(resolved)) throw codedError("baseline_unsafe", "Baseline path must be explicit and absolute");
  let descriptor;
  try {
    const before = fs.lstatSync(resolved);
    if (!before.isFile() || before.isSymbolicLink()) throw codedError("baseline_unsafe", "Baseline must be a regular non-symlink file");
    descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || (opened.mode & 0o222) !== 0 || opened.size > 64 * 1024) {
      throw codedError("baseline_unsafe", "Baseline file identity, mode, or size is unsafe");
    }
    const text = fs.readFileSync(descriptor, "utf8");
    assertNoDuplicateTopLevelKeys(text);
    return validateBaselineObject(JSON.parse(text));
  } catch (error) {
    if (error?.code === "baseline_unsafe" || error?.code === "baseline_schema_invalid") throw error;
    if (["ELOOP", "ENOENT", "EACCES", "EPERM"].includes(error?.code)) throw codedError("baseline_unsafe", "Baseline file cannot be opened safely");
    if (error instanceof SyntaxError) throw codedError("baseline_schema_invalid", "Baseline is not valid JSON");
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function parsedEntry(row) {
  const text = Buffer.isBuffer(row.doc) ? row.doc.toString("utf8") : String(row.doc || "");
  const entry = JSON.parse(text);
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw codedError("audit_rows_invalid", "Audit row document must be an object");
  return entry;
}

function failureStatus(raw, code, detail, extra = {}) {
  return {
    operationalReady: false,
    mode: "invalid",
    confidence: "none",
    deploymentMode: null,
    legacyChainOk: raw?.ok === true,
    legacyClassification: raw?.ok ? null : "legacy_forensic_integrity_limited",
    legacyStoredLinkBreaks: extra.legacyStoredLinkBreaks ?? null,
    legacyBreakIslands: extra.legacyBreakIslands ?? null,
    legacyPrefixDigest: extra.legacyPrefixDigest ?? null,
    cutoffRowid: extra.cutoffRowid ?? null,
    cutoffHeadHash: extra.cutoffHeadHash ?? null,
    tailRowsChecked: extra.tailRowsChecked ?? 0,
    externalAttestation: "deferred",
    raw,
    failures: [{ code, detail }],
  };
}

function compareApprovedEvidence(baseline, approvedIncident) {
  for (const field of INCIDENT_FIELDS) {
    if (baseline[field] !== approvedIncident[field]) return field;
  }
  return null;
}

function prefixFacts(rows) {
  let previousHash = null;
  let previousBreakRowid = null;
  let storedLinkBreaks = 0;
  let breakIslands = 0;
  for (const row of rows) {
    const entry = parsedEntry(row);
    if (!entry.hash || entry.hash !== auditHash(entry)) throw codedError("legacy_prefix_mismatch", `Legacy content hash mismatch at rowid ${row.rowid}`);
    if (entry.prevHash !== previousHash) {
      storedLinkBreaks += 1;
      if (previousBreakRowid === null || row.rowid !== previousBreakRowid + 1) breakIslands += 1;
      previousBreakRowid = row.rowid;
    }
    previousHash = entry.hash;
  }
  return { storedLinkBreaks, breakIslands };
}

export function verifyAuditContinuityRows({ rows = [], baseline = null, approvedIncident = APPROVED_W0_INCIDENT, securityProfile = productionSecurityProfile() } = {}) {
  let entries;
  let raw;
  try {
    entries = rows.map(parsedEntry);
    raw = verifyAuditEntries(entries);
  } catch (error) {
    return failureStatus(null, "audit_rows_invalid", error.message);
  }
  if (raw.ok) {
    return {
      operationalReady: true,
      mode: "full_chain",
      confidence: "full_chain_local",
      deploymentMode: productionSecurityProfile({ PRODUCTION_SECURITY_PROFILE: securityProfile }),
      legacyChainOk: true,
      legacyClassification: null,
      legacyStoredLinkBreaks: 0,
      legacyBreakIslands: 0,
      legacyPrefixDigest: null,
      cutoffRowid: null,
      cutoffHeadHash: entries.at(-1)?.hash || null,
      tailRowsChecked: entries.length,
      externalAttestation: "deferred",
      raw,
      failures: [],
    };
  }
  const normalizedProfile = productionSecurityProfile({ PRODUCTION_SECURITY_PROFILE: securityProfile });
  if (normalizedProfile !== SECURITY_PROFILES.bitlaunchSingleServer) return failureStatus(raw, "profile_not_allowed", "Local continuity is allowed only for bitlaunch_single_server");
  if (!baseline) return failureStatus(raw, "baseline_missing", "No local audit continuity baseline is configured");
  try {
    validateBaselineObject(baseline);
  } catch (error) {
    return failureStatus(raw, error.code || "baseline_schema_invalid", error.message);
  }
  const evidenceMismatch = compareApprovedEvidence(baseline, approvedIncident);
  if (evidenceMismatch) return failureStatus(raw, "approved_evidence_mismatch", `Baseline does not match approved incident field: ${evidenceMismatch}`);

  const ordered = [...rows].sort((left, right) => left.rowid - right.rowid);
  const prefix = ordered.filter((row) => row.rowid <= approvedIncident.legacyCutoffRowid);
  const cutoffRow = prefix.find((row) => row.rowid === approvedIncident.legacyCutoffRowid);
  if (!cutoffRow || prefix.length !== approvedIncident.legacyAuditRowCount) {
    return failureStatus(raw, "cutoff_mismatch", "Approved cutoff row or legacy row count is missing", { cutoffRowid: approvedIncident.legacyCutoffRowid });
  }
  let cutoffEntry;
  try {
    cutoffEntry = parsedEntry(cutoffRow);
  } catch (error) {
    return failureStatus(raw, "cutoff_mismatch", error.message, { cutoffRowid: approvedIncident.legacyCutoffRowid });
  }
  if (cutoffEntry.hash !== approvedIncident.legacyCutoffHeadHash
    || cutoffEntry.prevHash !== approvedIncident.legacyCutoffPrevHash
    || cutoffEntry.createdAt !== approvedIncident.legacyCutoffCreatedAt) {
    return failureStatus(raw, "cutoff_mismatch", "Approved cutoff evidence changed", { cutoffRowid: approvedIncident.legacyCutoffRowid });
  }

  let prefixDigest;
  try {
    prefixDigest = legacyAuditTableDigest(prefix);
  } catch (error) {
    return failureStatus(raw, error.code || "legacy_prefix_mismatch", error.message, { cutoffRowid: approvedIncident.legacyCutoffRowid });
  }
  if (prefixDigest !== approvedIncident.legacyPrefixDigest) {
    return failureStatus(raw, "legacy_prefix_mismatch", "Legacy prefix digest changed", { legacyPrefixDigest: prefixDigest, cutoffRowid: approvedIncident.legacyCutoffRowid });
  }

  let facts;
  try {
    facts = prefixFacts(prefix);
  } catch (error) {
    return failureStatus(raw, error.code || "legacy_prefix_mismatch", error.message, { legacyPrefixDigest: prefixDigest, cutoffRowid: approvedIncident.legacyCutoffRowid });
  }
  if (facts.storedLinkBreaks !== approvedIncident.legacyStoredLinkBreaks || facts.breakIslands !== approvedIncident.legacyBreakIslands) {
    return failureStatus(raw, "legacy_break_facts_mismatch", "Observed legacy break facts differ from the approved incident", {
      legacyStoredLinkBreaks: facts.storedLinkBreaks,
      legacyBreakIslands: facts.breakIslands,
      legacyPrefixDigest: prefixDigest,
      cutoffRowid: approvedIncident.legacyCutoffRowid,
    });
  }

  const tailRows = ordered.filter((row) => row.rowid > approvedIncident.legacyCutoffRowid);
  let previousHash = approvedIncident.legacyCutoffHeadHash;
  let previousRowid = approvedIncident.legacyCutoffRowid;
  for (const row of tailRows) {
    let current;
    try {
      current = parsedEntry(row);
    } catch (error) {
      return failureStatus(raw, "tail_invalid", error.message, { ...facts, legacyPrefixDigest: prefixDigest, cutoffRowid: approvedIncident.legacyCutoffRowid });
    }
    if (row.rowid !== previousRowid + 1 || current.prevHash !== previousHash || !current.hash || current.hash !== auditHash(current)) {
      return failureStatus(raw, "tail_invalid", `Audit continuity tail failed at rowid ${row.rowid}`, {
        legacyStoredLinkBreaks: facts.storedLinkBreaks,
        legacyBreakIslands: facts.breakIslands,
        legacyPrefixDigest: prefixDigest,
        cutoffRowid: approvedIncident.legacyCutoffRowid,
        cutoffHeadHash: approvedIncident.legacyCutoffHeadHash,
        tailRowsChecked: Math.max(0, row.rowid - approvedIncident.legacyCutoffRowid - 1),
      });
    }
    previousRowid = row.rowid;
    previousHash = current.hash;
  }

  return {
    operationalReady: true,
    mode: POLICY_FIELDS.mode,
    confidence: POLICY_FIELDS.confidence,
    deploymentMode: POLICY_FIELDS.deploymentMode,
    legacyChainOk: false,
    legacyClassification: POLICY_FIELDS.legacyClassification,
    legacyStoredLinkBreaks: facts.storedLinkBreaks,
    legacyBreakIslands: facts.breakIslands,
    legacyPrefixDigest: prefixDigest,
    cutoffRowid: approvedIncident.legacyCutoffRowid,
    cutoffHeadHash: approvedIncident.legacyCutoffHeadHash,
    tailRowsChecked: tailRows.length,
    externalAttestation: POLICY_FIELDS.externalAttestation,
    raw,
    failures: [],
  };
}

function readAuditRows(sqlitePath) {
  const reader = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  try {
    return reader.prepare(`
      select rowid,
        cast(id as blob) as id,
        cast(actor as blob) as actor,
        cast(action as blob) as action,
        cast(target as blob) as target,
        cast(severity as blob) as severity,
        cast(created_at as blob) as created_at,
        cast(doc as blob) as doc
      from audit_log_entries
      order by rowid asc
    `).all();
  } finally {
    reader.close();
  }
}

export function verifyApprovedAuditContinuityAtPath({
  sqlitePath,
  baselinePath = process.env.AUDIT_CONTINUITY_BASELINE_FILE,
  securityProfile = productionSecurityProfile(),
} = {}) {
  let rows;
  try {
    if (!sqlitePath || !path.isAbsolute(sqlitePath) || !fs.existsSync(sqlitePath)) {
      return failureStatus(null, "sqlite_missing", "Audit SQLite path is missing");
    }
    rows = readAuditRows(sqlitePath);
  } catch (error) {
    return failureStatus(null, "sqlite_read_failed", error.message);
  }
  let raw;
  try {
    raw = verifyAuditEntries(rows.map(parsedEntry));
  } catch (error) {
    return failureStatus(null, "audit_rows_invalid", error.message);
  }
  if (raw.ok) return verifyAuditContinuityRows({ rows, baseline: null, approvedIncident: APPROVED_W0_INCIDENT, securityProfile });
  if (!String(baselinePath || "").trim()) return failureStatus(raw, "baseline_missing", "No local audit continuity baseline is configured");
  let baseline;
  try {
    baseline = readAuditContinuityBaseline(baselinePath);
  } catch (error) {
    return failureStatus(raw, error.code || "baseline_unsafe", error.message);
  }
  return verifyAuditContinuityRows({ rows, baseline, approvedIncident: APPROVED_W0_INCIDENT, securityProfile });
}

export function auditPreflightDecision(status, securityProfile = productionSecurityProfile()) {
  const normalizedProfile = productionSecurityProfile({ PRODUCTION_SECURITY_PROFILE: securityProfile });
  if (!status?.operationalReady) return { allowed: false, warning: null, status };
  if (status.mode !== "incident_adjudicated_local_continuity") {
    return { allowed: status.mode === "full_chain" && status.legacyChainOk === true, warning: null, status };
  }
  const approvedLocalAssurance = normalizedProfile === SECURITY_PROFILES.bitlaunchSingleServer
    && status.confidence === "local_integrity_only"
    && status.legacyChainOk === false
    && status.externalAttestation === "deferred";
  return {
    allowed: approvedLocalAssurance,
    warning: approvedLocalAssurance
      ? "Audit history is incident-adjudicated with local_integrity_only confidence; external attestation and WORM are not configured"
      : null,
    status,
  };
}
