# BitLaunch Local Audit Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the existing BitLaunch single-server deployment to distinguish the preserved Epoch 1 incident from newly broken audit history, without rewriting any audit record or claiming external attestation.

**Architecture:** Add one leaf audit-continuity module that owns the canonical entry-hash algorithm, the frozen W0 prefix digest, strict approval-artifact parsing, and read-only SQLite verification. Keep the existing raw chain APIs truthful, add a separate operational result, and wire only that result into preflight and non-risk-reducing production gates for `bitlaunch_single_server`.

**Tech Stack:** Node.js ESM, `node:crypto`, `node:fs`, `better-sqlite3`, built-in `node:test`, existing W0 isolated test runner.

**Spec:** `docs/superpowers/specs/2026-08-21-bitlaunch-local-audit-continuity-design.md`

## Global Constraints

- Epoch 1 classification remains exactly `legacy_forensic_integrity_limited`.
- Epoch 1 rewrite, reseal, rehash, `prevHash` rewrite, deletion, restore, reset, VACUUM, and migration are forbidden.
- The accepted deployment profile is exactly `bitlaunch_single_server`.
- The strongest allowed confidence is exactly `local_integrity_only`.
- `externalAttestation` and `epoch2` remain exactly `deferred`.
- The fixed cutoff is rowid `127399` with hash `3415f657226bd46be4ae38f4b9a1ff49cb67c0f9953800c5e57429937350b3b0`.
- The fixed prefix digest is `d596ecebe7400d5b221ce959a5b7cf173fd093c53ca88fe0fe736798c9640672` under `ta-legacy-audit-table-v1-lp1-sha256`.
- The fixed known historical facts are `70548` rows, `674` stored-link breaks, and `282` break islands.
- The raw `verifyAuditChain()` and `verifyAuditChainReadOnly()` contracts remain truthful and continue returning failure for Epoch 1.
- No frontend, schema, dependency, trading strategy, risk rule, sizing, OMS, reconciliation, exchange, or readiness-dependency changes are allowed.
- No production approval artifact is generated or installed by implementation or tests.
- Every test database must be W0-isolated under `/private/tmp`; production SQLite and forensic originals are read-only evidence.

---

## File Structure

- Create `server/auditContinuity.mjs`: canonical audit hash, legacy digest, strict approval-file reader, fixed W0 incident constants, raw/tail verification, and local operational result.
- Modify `server/store.mjs`: import the canonical hash/verifier, retain raw status, expose operational wrappers, and adjudicate only the `audit_chain_integrity` runtime block.
- Modify `server/tradeActions.mjs`: use current operational continuity for non-risk-reducing writes.
- Modify `server/liveModeService.mjs`: use operational continuity in autonomous production blockers.
- Modify `server/professionalRiskGate.mjs`: distinguish adjudicated legacy history from a current continuity failure.
- Modify `server/professionalAnalytics.mjs`: present the effective audit gate while retaining local-only evidence text.
- Modify `server/ops.mjs`: expose raw versus operational audit status in readiness/ops reports.
- Modify `server/routes/securityConfig.mjs` and `server/index.mjs`: return the additive audit status shape from `/api/security/audit-chain`.
- Modify `scripts/production-preflight.mjs`: accept only valid BitLaunch local continuity and emit an explicit assurance warning.
- Delete `scripts/repair-audit-chain.mjs` and remove `repair:audit-chain` from `package.json`.
- Create `tests/audit-continuity.test.mjs`: core prefix/tail/artifact behavior.
- Modify `tests/audit-chain-no-auto-reseal.test.mjs`: startup adjudication and raw-history invariants.
- Create `tests/audit-continuity-gates.test.mjs`: trade, live-mode, risk, analytics, and operations consumers.
- Create `tests/audit-continuity-preflight.test.mjs`: executable preflight behavior with isolated SQLite fixtures.
- Create `tests/audit-repair-disabled.test.mjs`: observable removal of the rewrite capability.

---

### Task 1: Canonical Read-Only Audit Continuity Verifier

**Files:**
- Create: `server/auditContinuity.mjs`
- Create: `tests/audit-continuity.test.mjs`

**Interfaces:**
- Produces: `auditHash(entry) -> lowercase SHA-256 hex`.
- Produces: `verifyAuditEntries(entries) -> { ok, checked, breaks }`.
- Produces: `legacyAuditTableDigest(rows) -> lowercase SHA-256 hex`.
- Produces: `verifyAuditContinuityRows({ rows, baseline, approvedIncident }) -> status` for pure behavioral testing.
- Produces: `verifyApprovedAuditContinuityAtPath({ sqlitePath, baselinePath, securityProfile }) -> status` for production callers; this wrapper always uses frozen `APPROVED_W0_INCIDENT` and accepts no caller override.
- Produces: `APPROVED_W0_INCIDENT`, an immutable object containing the fixed W0 values from the spec.

- [ ] **Step 1: Write the independent fixture builder and the first failing raw-versus-operational tests**

In `tests/audit-continuity.test.mjs`, build literal test entries with a test-only reference hash implementation. The reference must not import `auditHash` from production:

```js
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
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function linkedEntry(id, prevHash, createdAt) {
  const entry = { id, actor: "Test", action: `action:${id}`, target: `target:${id}`, severity: "info", prevHash, createdAt };
  entry.hash = referenceAuditHash(entry);
  return entry;
}
```

Create a small SQLite fixture where one pre-cutoff pair is deliberately out of predecessor order, calculate its independent test prefix digest, and write a `0400` approval JSON. Assert:

```js
assert.equal(raw.ok, false);
assert.equal(status.operationalReady, true);
assert.equal(status.mode, "incident_adjudicated_local_continuity");
assert.equal(status.confidence, "local_integrity_only");
assert.equal(status.legacyChainOk, false);
assert.equal(status.externalAttestation, "deferred");
```

Also assert that a broken fixture with no approval returns `operationalReady: false` and reason `baseline_missing`.

- [ ] **Step 2: Run the core test and record RED**

Run:

```bash
node --test tests/audit-continuity.test.mjs
```

Expected: FAIL because `server/auditContinuity.mjs` and the exported verifier do not exist.

- [ ] **Step 3: Implement the canonical audit hash, raw verifier, row loader, and full-chain path**

Create `server/auditContinuity.mjs` with the source-of-truth hash algorithm extracted verbatim from `server/store.mjs`:

```js
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
```

Load rows in `rowid ASC` order with both parsed `doc` and exact `CAST(... AS BLOB)` fields. A fully healthy raw chain returns:

```js
{
  operationalReady: true,
  mode: "full_chain",
  confidence: "full_chain_local",
  legacyChainOk: true,
  failures: [],
}
```

- [ ] **Step 4: Implement and test the frozen legacy digest framing**

Add a hand-derived two-row digest fixture. Assert a literal expected SHA-256 produced independently by a test-local encoder. Then implement:

```js
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
```

The test must mutate a byte in `doc` while leaving the parsed audit hash untouched and prove the table digest changes.

- [ ] **Step 5: Add failing artifact-boundary tests**

Add separate tests for:

- writable approval file;
- symlink approval file;
- missing required key;
- unexpected key;
- duplicate top-level JSON key;
- upper-case or wrong-length hash;
- unsupported `schemaVersion`;
- `external_hardened` profile.

Each assertion checks `operationalReady === false` and a stable category such as `baseline_unsafe`, `baseline_schema_invalid`, `approved_evidence_mismatch`, or `profile_not_allowed`; it does not assert parser implementation details.

- [ ] **Step 6: Run artifact tests and record RED**

Run:

```bash
node --test tests/audit-continuity.test.mjs
```

Expected: the new artifact-boundary cases fail because strict parsing and profile enforcement are absent.

- [ ] **Step 7: Implement strict approval loading and fixed W0 evidence**

Define and freeze:

```js
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
```

Open the baseline with `O_RDONLY | O_NOFOLLOW`, validate `fstat().isFile()`, reject any write bit in `mode & 0o222`, read from the already-open descriptor, and close in `finally`. Implement a flat top-level JSON token scan before `JSON.parse` so duplicate keys are rejected. Validate exact key set, scalar types, canonical lowercase hashes, non-empty approval identity, and RFC 3339 approval time.

- [ ] **Step 8: Add failing prefix and tail mutation tests**

Add one observable test for each mutation:

```text
legacy field byte changes
cutoff row missing
cutoff stored hash changes
cutoff prevHash changes
expected link-break count changes
expected island count changes
first tail prevHash changes
later tail prevHash changes
tail content changes without matching hash
valid append after cutoff
```

The valid append remains ready. Every mutation returns false and identifies `legacy_prefix_mismatch`, `cutoff_mismatch`, `legacy_break_facts_mismatch`, or `tail_invalid`.

- [ ] **Step 9: Run mutation tests and record RED**

Run:

```bash
node --test tests/audit-continuity.test.mjs
```

Expected: mutation cases fail until prefix statistics and current-rule tail verification exist.

- [ ] **Step 10: Implement prefix facts and tail validation**

Count stored-link breaks only when `entry.prevHash !== precedingStoredHash`. Count one island when a broken rowid is not exactly the previous broken rowid plus one. Independently reject every content-hash mismatch. Locate the exact cutoff row, compare all frozen cutoff fields, digest every row through the cutoff, and validate every later row from the fixed cutoff hash.

The production wrapper signature is fixed:

```js
export function verifyApprovedAuditContinuityAtPath({
  sqlitePath,
  baselinePath = process.env.AUDIT_CONTINUITY_BASELINE_FILE,
  securityProfile = productionSecurityProfile(),
} = {})
```

It must not accept `approvedIncident` from callers.

- [ ] **Step 11: Run core tests and record GREEN**

Run:

```bash
node --test tests/audit-continuity.test.mjs
```

Expected: all core, artifact, prefix, profile, and tail cases pass.

- [ ] **Step 12: Commit Task 1**

```bash
git add server/auditContinuity.mjs tests/audit-continuity.test.mjs
git commit -m "feat: verify incident-adjudicated audit continuity"
```

---

### Task 2: Store Startup State Without Historical Rewrite

**Files:**
- Modify: `server/store.mjs:1-10, 740-890, 2188-2245`
- Modify: `tests/audit-chain-no-auto-reseal.test.mjs`

**Interfaces:**
- Consumes: `auditHash`, `verifyAuditEntries`, and `verifyApprovedAuditContinuityAtPath` from Task 1.
- Produces: `verifyAuditOperationalContinuity(db) -> status`.
- Produces: `verifyAuditOperationalContinuityReadOnly() -> status`.
- Produces: `auditChainStatus(db) -> { ...raw, operationalReady, mode, confidence, externalAttestation, legacy, tail }`.
- Produces: `applyAuditIntegrityState(db, { raw, continuity, tip, checkedAt }) -> db`, a deterministic state transition used by startup and tested without weakening the frozen production verifier.

- [ ] **Step 1: Write failing startup characterization tests**

Extend the existing no-auto-reseal test with isolated fixtures for:

1. broken chain and no baseline keeps `auditChainBroken=true`, an active `audit_chain_integrity` reduce-only reason, and the original stored hashes;
2. broken legacy chain with a valid test approval keeps `auditChainBroken=true` but sets `auditContinuityReady=true`, clears only the `audit_chain_integrity` runtime reason, and retains the incident row with resolution `incident_adjudicated_local_continuity`;
3. removing or changing the approval file before reload restores the block;
4. raw `verifyAuditChain()` and `verifyAuditChainReadOnly()` remain false in the adjudicated case.

Call `applyAuditIntegrityState` with literal raw and continuity results for the valid-adjudication transition. This tests the real production state transition without adding a test override to `verifyApprovedAuditContinuityAtPath`. Keep a separate integration case proving the real production wrapper rejects a small non-W0 fixture even when its self-supplied JSON values match that fixture.

- [ ] **Step 2: Run startup tests and record RED**

Run:

```bash
node --test tests/audit-chain-no-auto-reseal.test.mjs
```

Expected: adjudicated startup assertions fail because the store exposes only raw broken state.

- [ ] **Step 3: Extract canonical helpers and add operational wrappers**

Remove the private duplicate `auditHash` and `verifyAuditEntries` implementations from `server/store.mjs`; import them from `server/auditContinuity.mjs`. Keep these raw wrappers unchanged in meaning:

```js
export function verifyAuditChain(db) {
  return verifyAuditEntries(auditLogsForVerification(db));
}

export function verifyAuditChainReadOnly() {
  if (!fs.existsSync(sqliteDbPath)) return { ok: false, checked: 0, breaks: [{ error: "sqlite_missing" }] };
  const reader = new Database(sqliteDbPath, { readonly: true, fileMustExist: true });
  try {
    const logs = reader.prepare("select doc from audit_log_entries order by rowid asc").all().map((row) => JSON.parse(row.doc));
    return verifyAuditEntries(logs);
  } finally {
    reader.close();
  }
}
```

Add operational wrappers that always pass `db.__sqlitePath || sqliteDbPath` and the current environment to the production verifier. Do not cache success.

- [ ] **Step 4: Implement startup adjudication state**

In `applyAuditIntegrityState` and its `inspectAuditChainIntegrity` caller:

- run raw verification first;
- run operational verification only after raw failure;
- preserve `db.meta.auditChainBroken = true` for the legacy incident;
- store additive operational fields and a compact failure list;
- clear only `audit_chain_integrity` when `operationalReady === true`;
- mark the existing incident `resolved` with `resolution = incident_adjudicated_local_continuity`, while retaining the complete row;
- never call an audit repair function or change a stored audit row;
- restore the current fail-closed behavior when continuity is absent or invalid.

- [ ] **Step 5: Run startup and store tests and record GREEN**

Run:

```bash
node --test tests/audit-chain-no-auto-reseal.test.mjs tests/oms-store.test.mjs tests/test-storage-isolation.test.mjs
```

Expected: startup adjudication passes, raw-history tests remain false, and storage isolation remains green.

- [ ] **Step 6: Commit Task 2**

```bash
git add server/store.mjs tests/audit-chain-no-auto-reseal.test.mjs
git commit -m "refactor: separate audit history from operational continuity"
```

---

### Task 3: Production Gates and Operator-Facing Status

**Files:**
- Modify: `server/tradeActions.mjs:1, 259-263`
- Modify: `server/liveModeService.mjs:1-3, 49-76`
- Modify: `server/professionalRiskGate.mjs:1-15, 35-55`
- Modify: `server/professionalAnalytics.mjs:1-65`
- Modify: `server/ops.mjs:1-20, 510-540`
- Modify: `server/routes/securityConfig.mjs:9-15, 193`
- Modify: `server/index.mjs:107, 1814`
- Create: `tests/audit-continuity-gates.test.mjs`

**Interfaces:**
- Consumes: `verifyAuditOperationalContinuity(db)` and `auditChainStatus(db)` from Task 2.
- Produces: additive operator status; no route path or existing field is removed.
- Produces: optional internal `auditStatus` parameters on gate/report builders so tests can supply a literal already-verified result; every production caller omits that parameter and therefore always runs the frozen verifier.

- [ ] **Step 1: Write failing trade and live-mode gate tests**

Create isolated DB cases and pass a literal continuity result through the explicit internal options object:

```js
assert.notEqual(validContinuityEntryGuard.reason, "audit_chain_invalid");
assert.equal(changedPrefixEntryGuard.reason, "audit_chain_invalid");
assert.equal(newTailBreakEntryGuard.reason, "audit_chain_invalid");
assert.equal(riskReducingEmergencyGuard.allowed, true);
```

For `autonomousProductionBlockers`, assert that the audit blocker is absent only for a supplied valid local-continuity result and present for literal prefix/tail/baseline failures. Other blocker strings must remain identical. A separate assertion calls the function without options and proves it invokes the production verifier rather than trusting `db.meta.auditContinuityReady`.

- [ ] **Step 2: Run gate tests and record RED**

Run:

```bash
node --test tests/audit-continuity-gates.test.mjs
```

Expected: valid local continuity is still rejected because consumers call the raw verifier.

- [ ] **Step 3: Wire trade and live-mode gates to current continuity**

Replace only the raw audit check:

```js
const audit = verifyAuditOperationalContinuity(db);
if (!audit.operationalReady) {
  return { allowed: false, reason: "audit_chain_invalid", breaks: audit.legacyStoredLinkBreaks, failures: audit.failures };
}
```

Keep all preceding and subsequent trade guards in their current order. In live-mode blockers, replace only the audit boolean and preserve the Chinese blocker text.

- [ ] **Step 4: Write failing risk and analytics tests**

Assert that:

- valid local continuity does not add `audit_chain_invalid`;
- a prefix/tail/baseline failure adds it immediately;
- `buildTradingPermissionEvidence` uses an effective label such as `审计连续性可用（仅本地完整性）` and does not say the legacy chain is normal;
- all non-audit risk/permission checks remain byte-for-byte equivalent in the fixture result.

- [ ] **Step 5: Run risk and analytics cases and record RED**

Run:

```bash
node --test tests/audit-continuity-gates.test.mjs tests/professional-risk-gate.test.mjs tests/professional-analytics.test.mjs
```

Expected: current code still derives both results solely from `auditChainBroken`.

- [ ] **Step 6: Wire risk and analytics to operational continuity**

Call the current operational verifier when raw history is broken. The optional status is accepted only as an already-verified internal argument; route/execution call sites never forward request data into it. Do not clear market, reconciliation, WORM, alert, account, UNKNOWN-order, or any other degradation reason.

- [ ] **Step 7: Write failing ops route/status tests**

Register `registerSecurityConfigRoutes` with the real additive status builder and assert the route payload contains:

```js
assert.equal(payload.ok, false);
assert.equal(payload.operationalReady, true);
assert.equal(payload.mode, "incident_adjudicated_local_continuity");
assert.equal(payload.confidence, "local_integrity_only");
assert.equal(payload.externalAttestation, "deferred");
assert.equal(payload.legacy.storedLinkBreaks, expectedBreaks);
assert.equal(payload.tail.valid, true);
```

Also assert `buildReadinessReport().checks` marks `audit_chain` configured from operational continuity while its note states that historical chain integrity is limited and external attestation is absent.

- [ ] **Step 8: Run ops tests and record RED**

Run:

```bash
node --test tests/audit-continuity-gates.test.mjs tests/dependency-readiness.test.mjs tests/rbac-route-matrix.test.mjs
```

Expected: route/readiness still expose only the raw verifier.

- [ ] **Step 9: Implement additive status wiring**

Inject `auditChainStatus` into the existing route context and return it from `/api/security/audit-chain`. Do not change the route path, permission, status code, or remove `ok`, `checked`, or `breaks`.

- [ ] **Step 10: Run all Task 3 tests and record GREEN**

Run:

```bash
node --test tests/audit-continuity-gates.test.mjs tests/professional-risk-gate.test.mjs tests/professional-analytics.test.mjs tests/dependency-readiness.test.mjs tests/rbac-route-matrix.test.mjs tests/live-mode-save.test.mjs
```

Expected: all pass with only the approved audit-gate behavior changed.

- [ ] **Step 11: Commit Task 3**

```bash
git add server/tradeActions.mjs server/liveModeService.mjs server/professionalRiskGate.mjs server/professionalAnalytics.mjs server/ops.mjs server/routes/securityConfig.mjs server/index.mjs tests/audit-continuity-gates.test.mjs
git commit -m "fix: apply local audit continuity to production gates"
```

---

### Task 4: Production Preflight Contract

**Files:**
- Modify: `scripts/production-preflight.mjs:1-105`
- Modify: `server/auditContinuity.mjs`
- Create: `tests/audit-continuity-preflight.test.mjs`

**Interfaces:**
- Consumes: `verifyAuditOperationalContinuityReadOnly()` from Task 2.
- Produces: `auditPreflightDecision(status, securityProfile) -> { allowed, warning, status }`, a pure policy used by the executable script.
- Produces: existing JSON preflight report plus additive `audit` details.

- [ ] **Step 1: Write executable failing preflight tests**

Test `auditPreflightDecision` with literal verified statuses and spawn `scripts/production-preflight.mjs` in a child process with an isolated invalid fixture. Cover:

1. raw broken and no approval exits non-zero with `Local audit continuity verification failed`;
2. a valid local-continuity result under `bitlaunch_single_server` is allowed, requires the local-only warning, and retains `legacyChainOk=false`;
3. the same approval under `external_hardened` exits non-zero;
4. literal approval removal or tail mutation is rejected after a prior successful policy evaluation, proving no sticky green;
5. the executable invalid-fixture path exits non-zero and exposes the real failure category.

Tests assert returned policy/process behavior, not script source text. Task 6 performs the real frozen-W0 positive-path probe against a temporary forensic copy, because a small fixture cannot and must not impersonate the hard-coded W0 digest/head.

- [ ] **Step 2: Run preflight tests and record RED**

Run:

```bash
node --test tests/audit-continuity-preflight.test.mjs
```

Expected: the policy export and operational preflight wiring do not yet exist.

- [ ] **Step 3: Implement the preflight distinction**

Add the pure policy to `server/auditContinuity.mjs` and replace only the raw gate with:

```js
const audit = verifyAuditOperationalContinuityReadOnly();
const auditDecision = auditPreflightDecision(audit, productionSecurityProfile());
requireTrue(auditDecision.allowed, "Local audit continuity verification failed");
if (auditDecision.warning) warnings.push(auditDecision.warning);
```

Add `audit` to the report. Keep every other failure/warning and all production preflight thresholds unchanged.

- [ ] **Step 4: Run preflight and related tests and record GREEN**

Run:

```bash
node --test tests/audit-continuity-preflight.test.mjs tests/security-profile.test.mjs tests/dependency-readiness.test.mjs
```

Expected: the BitLaunch exception is explicit and profile-scoped; hardened remains blocked.

- [ ] **Step 5: Commit Task 4**

```bash
git add scripts/production-preflight.mjs tests/audit-continuity-preflight.test.mjs
git commit -m "fix: distinguish local audit continuity in preflight"
```

---

### Task 5: Remove the Production Hash-Rewrite Capability

**Files:**
- Modify: `package.json:24`
- Delete: `scripts/repair-audit-chain.mjs`
- Modify: `server/store.mjs:793-890`
- Create: `tests/audit-repair-disabled.test.mjs`

**Interfaces:**
- Removes: the `repair:audit-chain` npm command.
- Removes: the exported `repairAuditChainExplicit` production capability.
- Preserves: test-owned entry creation, normal append, raw verification, and all read-only continuity functions.

- [ ] **Step 1: Write failing behavior tests**

Assert:

```js
const store = await import(`../server/store.mjs?repair-disabled=${Date.now()}`);
assert.equal("repairAuditChainExplicit" in store, false);
```

Spawn `npm run repair:audit-chain` and assert it fails with npm's missing-script status. Then execute the existing tampered-chain startup test and assert stored hashes are unchanged.

- [ ] **Step 2: Run repair-surface tests and record RED**

Run:

```bash
node --test tests/audit-repair-disabled.test.mjs tests/audit-chain-no-auto-reseal.test.mjs
```

Expected: the export and npm command still exist.

- [ ] **Step 3: Remove only the rewrite surface**

Delete:

- the `repair:audit-chain` package script;
- `scripts/repair-audit-chain.mjs`;
- `resealAuditChainForExplicitRepair`;
- `repairAuditChainExplicit`.

Do not change `appendAudit`, normal chain hashing, backup code, or any SQLite row.

- [ ] **Step 4: Run repair-surface and store tests and record GREEN**

Run:

```bash
node --test tests/audit-repair-disabled.test.mjs tests/audit-chain-no-auto-reseal.test.mjs tests/oms-store.test.mjs
```

Expected: rewrite command/export are unavailable and normal audit append/verification remains green.

- [ ] **Step 5: Commit Task 5**

```bash
git add package.json server/store.mjs tests/audit-repair-disabled.test.mjs
git add -u scripts/repair-audit-chain.mjs
git commit -m "security: remove production audit chain rewrite"
```

---

### Task 6: Full Verification and Evidence Immutability

**Files:**
- Modify only if a failing test identifies an in-scope defect; every defect requires a new RED test before production code.

**Interfaces:**
- Consumes all prior tasks.
- Produces verification evidence; does not activate production.

- [ ] **Step 1: Confirm diff scope**

Run:

```bash
git diff main@86e099731c8aee9bed48c714f57e6d8806997f38 --name-status
git diff main@86e099731c8aee9bed48c714f57e6d8806997f38 --stat
git diff --check main@86e099731c8aee9bed48c714f57e6d8806997f38
```

Expected: only the files named in this plan plus the approved spec/plan documents appear; no frontend, schema, exchange, trading strategy, sizing, OMS, reconciliation, or forensic file appears.

- [ ] **Step 2: Record protected evidence fingerprints read-only**

Record SHA-256, size, mtime, inode, W0 report hashes, and presence of WAL/SHM for:

```text
/Users/ely/Desktop/Trading Agent/data/trading-agent.sqlite
/Users/ely/Desktop/Trading Agent Forensics/W0-20260820T180715Z
```

SQLite facts are queried only with Python `mode=ro&immutable=1` or against a temporary copy. Do not use `loadDb()` or a writable `better-sqlite3` connection.

- [ ] **Step 3: Run the frozen-W0 positive-path probe on temporary files**

Copy the sealed forensic SQLite into a new `/private/tmp/audit-continuity-probe-*` directory, create a `0400` baseline file containing the exact fixed W0 fields plus these non-production probe approval fields, and call `verifyApprovedAuditContinuityAtPath`:

```json
{
  "approvalId": "SECURITY-OWNER-LOCAL-CONTINUITY-PROBE-2026-08-21",
  "approvedBy": "SecurityOwner",
  "approvedAt": "2026-08-21T00:00:00.000Z"
}
```

Require this exact result:

```js
assert.equal(status.operationalReady, true);
assert.equal(status.legacyChainOk, false);
assert.equal(status.legacyStoredLinkBreaks, 674);
assert.equal(status.legacyBreakIslands, 282);
assert.equal(status.legacyPrefixDigest, "d596ecebe7400d5b221ce959a5b7cf173fd093c53ca88fe0fe736798c9640672");
assert.equal(status.tailRowsChecked, 0);
assert.equal(status.confidence, "local_integrity_only");
```

Remove only the process-created probe directory after validating its directory identity and contents. Do not open or modify the forensic original or production database with better-sqlite3.

- [ ] **Step 4: Run targeted audit tests**

```bash
node --test tests/audit-continuity.test.mjs tests/audit-chain-no-auto-reseal.test.mjs tests/audit-continuity-gates.test.mjs tests/audit-continuity-preflight.test.mjs tests/audit-repair-disabled.test.mjs
```

- [ ] **Step 5: Run related safety suites**

```bash
node --test tests/professional-risk-gate.test.mjs tests/professional-analytics.test.mjs tests/dependency-readiness.test.mjs tests/live-mode-save.test.mjs tests/mandate-policy.test.mjs tests/risk-reducing-guard.test.mjs tests/emergency-action.test.mjs tests/oms-store.test.mjs tests/test-storage-isolation.test.mjs tests/security-profile.test.mjs tests/rbac-route-matrix.test.mjs
```

- [ ] **Step 6: Run the complete isolated suite**

```bash
npm test
```

The output must show `TRUSTED_TEST_TEMP_BASE=/private/tmp` and an isolated `ISOLATED_TEST_DATA_ROOT`. No test may access `/Users/ely/Desktop/Trading Agent/data`.

- [ ] **Step 7: Run remaining project verification**

```bash
npm run eval:agent
npm run lint
npm run build
git diff --check main@86e099731c8aee9bed48c714f57e6d8806997f38
git status --short --branch
```

- [ ] **Step 8: Recheck protected evidence**

Repeat Step 2 and require byte-for-byte identical SHA-256, size, mtime, inode, audit head/count, W0 artifact hashes, and WAL/SHM presence. Any change stops the work; do not attempt restore, reset, reseal, or repair.

- [ ] **Step 9: Inspect the complete diff**

Confirm:

- raw history still reports 674 legacy breaks;
- operational readiness is never named `trusted`;
- no external service is claimed;
- no production baseline artifact is present;
- no automatic activation exists;
- no repair/reseal/rehash code remains callable;
- no other production gate was weakened;
- no secret or approval identity is hard-coded;
- no frontend or database schema changed.

- [ ] **Step 10: Stop for Final Code Review**

Report implementation, RED-to-GREEN evidence, verification counts, preserved behavior, the unique intended behavior change, remaining local-host trust risk, protected evidence fingerprints, and the complete diff summary. Do not merge, push, install a production approval artifact, run production preflight against mutable production state, or begin Epoch 2.
