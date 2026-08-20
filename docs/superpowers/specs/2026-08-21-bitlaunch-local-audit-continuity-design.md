# BitLaunch Standalone Local Audit Continuity Design

Date: 2026-08-21
Status: Proposed for Security Owner review
Target deployment: `bitlaunch_single_server` only
Assurance level: `local_integrity_only`

## 1. Decision and Scope

The Security Owner has approved the following direction for the existing BitLaunch deployment:

- external attestation is deferred;
- no new AWS security account, KMS, Vault, or WORM provider is required for this close-out;
- Epoch 1 remains `legacy_forensic_integrity_limited` and is never described as repaired;
- Epoch 1 rows, hashes, `prevHash` values, Test reset evidence, and incident evidence remain immutable;
- the known W0 incident may be adjudicated as an exact historical prefix for standalone operation;
- every append after the approved cutoff must satisfy the current audit-chain rules;
- any mismatch in the approved prefix or any new tail break fails closed;
- the accepted production posture is `owner_risk_accepted_standalone`;
- no frontend configuration is introduced;
- Epoch 2 and external WORM remain deferred.

This design is a production-readiness exception mechanism, not a historical chain repair. It permits local operational continuity only when the exact preserved historical state and the subsequent append-only tail both match the approved evidence.

## 2. Security Claim

The mechanism may claim only:

> The local audit database contains the exact Security Owner-approved legacy prefix, and every audit record appended after that prefix is internally hash-linked and content-valid under the current rule.

It must not claim:

- that Epoch 1 has an unbroken historical predecessor chain;
- that the historical database was never rewritten before W0 preservation;
- that the local host administrator cannot replace both the database and baseline artifact;
- that a WORM system, external witness, or independent attestation exists;
- that Epoch 2 has been created;
- that the audit domain is externally trusted.

All operator-facing results must retain:

```text
legacyClassification = legacy_forensic_integrity_limited
confidence = local_integrity_only
externalAttestation = deferred
deploymentMode = owner_risk_accepted_standalone
```

## 3. Preserved W0 Evidence

The approved baseline refers to the already sealed W0 capture. The implementation must not modify or regenerate these artifacts under a different measurement rule.

| Evidence | Approved value |
| --- | --- |
| W0 capture ID | `W0-20260820T180715Z` |
| Legacy database SHA-256 | `f3a5c3471aa8439d94fbe7291694a9cda02322995de334f964aafbab53304af7` |
| Audit row count at capture | `70,548` |
| Stored-link breaks | `674` |
| Break islands | `282` |
| Earliest stored-link break rowid | `57,282` |
| Latest stored-link break rowid | `107,090` |
| Legacy cutoff/head rowid | `127,399` |
| Legacy cutoff/head timestamp | `2026-08-20T17:34:11.024Z` |
| Legacy cutoff/head hash | `3415f657226bd46be4ae38f4b9a1ff49cb67c0f9953800c5e57429937350b3b0` |
| Legacy cutoff/head `prevHash` | `201e80c9cc09bf323a7470ec919a3d27445a6ec28f9930a19c5d348a7f545d93` |
| Legacy prefix digest (`ta-legacy-audit-table-v1-lp1-sha256`) | `d596ecebe7400d5b221ce959a5b7cf173fd093c53ca88fe0fe736798c9640672` |
| Break report SHA-256 | `c9184b6aa4255ce8edf08698653a3c8552ec3fb81fbc665a868f6c89fc053de6` |
| Break CSV SHA-256 | `d4c45a38e1f6263106cd7799a92b894a483922f2c171ee3a5ed53873784c56fa` |
| Capture metadata SHA-256 | `699ae8bb41cce383a75ab3a6b97bf5b390daf3f48e5c942d87400b7827378f3c` |

The legacy prefix digest was calculated independently with Node.js/better-sqlite3 against a temporary copy and Python/sqlite3 with `mode=ro&immutable=1` against the sealed W0 forensic copy. Both implementations read 70,548 rows and produced the same digest shown above. The implementation must freeze this value as approved evidence rather than treating a value supplied only by the approval JSON as self-authorizing.

## 4. Architecture

The implementation adds one leaf verifier, conceptually `server/auditContinuity.mjs`. It has no authority to write audit rows or mutate SQLite.

```text
immutable baseline JSON ─┐
                        ├─ local continuity verifier ── operational decision
SQLite opened read-only ─┘                 │
                                           ├─ raw legacy status remains broken
                                           ├─ exact prefix digest/break facts
                                           └─ current-rule validation of the tail
```

Existing raw verification remains authoritative for historical truth:

- `verifyAuditChain()` continues to report the 674 legacy breaks;
- `verifyAuditChainReadOnly()` continues to return `ok: false` for Epoch 1;
- the existing audit incident remains preserved;
- no raw verifier result is overwritten with a synthetic success.

The new verifier supplies a separate operational result. A representative result is:

```js
{
  operationalReady: true,
  mode: "incident_adjudicated_local_continuity",
  confidence: "local_integrity_only",
  deploymentMode: "owner_risk_accepted_standalone",
  legacyChainOk: false,
  legacyClassification: "legacy_forensic_integrity_limited",
  legacyStoredLinkBreaks: 674,
  legacyBreakIslands: 282,
  legacyPrefixDigest: "<verified digest>",
  cutoffRowid: 127399,
  cutoffHeadHash: "3415f657226bd46be4ae38f4b9a1ff49cb67c0f9953800c5e57429937350b3b0",
  tailRowsChecked: 0,
  externalAttestation: "deferred",
  failures: [],
}
```

`operationalReady` is true only when every local continuity condition passes. It does not redefine `legacyChainOk`.

## 5. Approval Artifact Contract

Production activation requires an explicit environment variable:

```text
AUDIT_CONTINUITY_BASELINE_FILE=/absolute/read-only/path/audit-continuity-baseline.json
```

There is no implicit default path and no auto-discovery. Absence means the existing fail-closed behavior remains.

The JSON artifact is deployment configuration, not database state. It must be owned and mounted read-only by the operator, must be a regular file, and must not be exposed through the frontend. The parser rejects duplicate keys where technically detectable, unexpected fields, missing fields, wrong types, non-canonical hex, unsafe numbers, and unsupported versions.

Required schema:

```json
{
  "schemaVersion": 1,
  "mode": "incident_adjudicated_local_continuity",
  "confidence": "local_integrity_only",
  "deploymentMode": "owner_risk_accepted_standalone",
  "legacyClassification": "legacy_forensic_integrity_limited",
  "externalAttestation": "deferred",
  "epoch2": "deferred",
  "legacyRewrite": "forbidden",
  "w0CaptureId": "W0-20260820T180715Z",
  "legacyDatabaseSha256": "f3a5c3471aa8439d94fbe7291694a9cda02322995de334f964aafbab53304af7",
  "captureMetadataSha256": "699ae8bb41cce383a75ab3a6b97bf5b390daf3f48e5c942d87400b7827378f3c",
  "breakReportSha256": "c9184b6aa4255ce8edf08698653a3c8552ec3fb81fbc665a868f6c89fc053de6",
  "breakCsvSha256": "d4c45a38e1f6263106cd7799a92b894a483922f2c171ee3a5ed53873784c56fa",
  "legacyPrefixDigestRule": "ta-legacy-audit-table-v1-lp1-sha256",
  "legacyPrefixDigest": "<64 lowercase hexadecimal characters>",
  "legacyCutoffRowid": 127399,
  "legacyCutoffCreatedAt": "2026-08-20T17:34:11.024Z",
  "legacyCutoffHeadHash": "3415f657226bd46be4ae38f4b9a1ff49cb67c0f9953800c5e57429937350b3b0",
  "legacyCutoffPrevHash": "201e80c9cc09bf323a7470ec919a3d27445a6ec28f9930a19c5d348a7f545d93",
  "legacyAuditRowCount": 70548,
  "legacyStoredLinkBreaks": 674,
  "legacyBreakIslands": 282,
  "approvalId": "<operator-issued immutable approval identifier>",
  "approvedBy": "<Security Owner identity>",
  "approvedAt": "<RFC 3339 timestamp>"
}
```

The repository must not manufacture `approvalId`, `approvedBy`, or `approvedAt`. They are supplied during a separately reviewed manual cutover. The artifact is not a cryptographic external attestation; its approval fields provide local accountability only.

## 6. Frozen Legacy Prefix Digest

The digest rule is `ta-legacy-audit-table-v1-lp1-sha256`.

Source rows:

```sql
SELECT rowid, id, actor, action, target, severity, created_at, doc
FROM audit_log_entries
WHERE rowid <= :legacyCutoffRowid
ORDER BY rowid ASC
```

Included fields, in exact order:

1. `rowid`
2. `id`
3. `actor`
4. `action`
5. `target`
6. `severity`
7. `created_at`
8. `doc`

TEXT values are hashed as exact stored bytes, equivalent to `CAST(column AS BLOB)`. The verifier must never parse and re-serialize `doc`, recompute an entry hash as a substitute for the table digest, or order rows by `created_at`.

Byte stream:

1. UTF-8 `TRADING_AGENT_LEGACY_AUDIT_TABLE\0`
2. format version `U16BE(1)`
3. row count `U64BE`
4. for each row, UTF-8 `ROW\0`
5. for each field, `TYPE_TAG + U64BE(length) + bytes`

Types:

- `rowid`: tag `0x02`, length 8, unsigned `U64BE` bytes;
- non-null TEXT/BLOB: tag `0x05`, exact stored bytes;
- SQL `NULL`: tag `0x00`, length zero.

The output is lowercase hexadecimal SHA-256. The empty-table digest covers the header and a row count of zero.

## 7. Verification Algorithm

The verifier opens the target SQLite database read-only. Production preflight uses immutable/read-only access where compatible with the current runtime guarantees.

Validation order:

1. Determine the production security profile.
2. Run the raw audit verification and retain its unmodified result.
3. If the raw chain is healthy, use the existing healthy path; a baseline is unnecessary.
4. If the raw chain is broken, allow baseline evaluation only for `bitlaunch_single_server`.
5. Resolve and validate the explicitly configured baseline file without following an unsafe replacement or accepting a non-regular file.
6. Validate the exact schema and fixed policy values.
7. Confirm the approved W0 identifiers, hashes, cutoff facts, break count, and island count.
8. Confirm the cutoff row exists and its stored hash, `prevHash`, and timestamp match the approval.
9. Compute the frozen digest across every legacy row through the cutoff and compare it in constant time where practical.
10. Reproduce the approved raw stored-link break count and island count through the cutoff.
11. Starting with the approved cutoff head hash, validate every later row in `rowid ASC` order:
    - the row content hash is correct under the current audit rule;
    - `prevHash` equals the previous accepted row hash;
    - row ordering is strictly increasing;
    - no missing or duplicate row identity is silently accepted.
12. Return `operationalReady: true` only if all checks pass.

Any read error, malformed field, schema mismatch, missing cutoff, digest mismatch, changed known-break facts, first-tail link mismatch, later-tail link mismatch, content hash mismatch, or unsupported profile returns `operationalReady: false`.

The verifier does not create, update, delete, reseal, or append an audit row.

## 8. Integration Boundaries

### 8.1 Startup and Store State

Startup preserves the raw legacy finding. It may record separate in-memory operational facts:

```text
auditChainBroken = true
auditContinuityReady = true | false
auditContinuityMode = incident_adjudicated_local_continuity | invalid
auditContinuityConfidence = local_integrity_only | none
```

If local continuity is valid, the existing `audit_chain_integrity` operational block may be adjudicated for this deployment with a resolution that says `incident_adjudicated_local_continuity`. The historical incident is not deleted or relabeled as a repaired chain.

If local continuity becomes invalid, startup and later gate checks restore the existing fail-closed behavior.

### 8.2 Production Preflight

For `external_hardened`, the baseline can never satisfy the audit gate.

For `bitlaunch_single_server`, preflight may accept `operationalReady: true`, while reporting a mandatory warning:

```text
Audit history is incident-adjudicated with local_integrity_only confidence;
external attestation and WORM are not configured.
```

Preflight output must show raw history and operational continuity separately. It must not print or serialize a fabricated `auditChain.ok = true`.

### 8.3 Trade Actions

The non-risk-reducing trade gate uses operational continuity rather than treating the already-adjudicated legacy breaks as newly occurring failures on every call.

It remains fail-closed when:

- the baseline is missing or invalid;
- any approved legacy row changes;
- any baseline fact changes;
- any new tail break or content-hash failure appears;
- the profile is not `bitlaunch_single_server`.

Risk-reducing emergency behavior and every other trading, risk, sizing, mandate, OMS, credential, readiness, and preflight gate remain unchanged.

### 8.4 Professional Risk Gate

The risk gate must distinguish:

- legacy historical break, locally adjudicated and continuously verified; and
- current audit continuity failure.

Only the second adds an active `audit_chain_invalid` degradation reason. Raw historical status remains observable.

### 8.5 Operations API

The existing audit status response keeps the legacy result. It may add fields such as:

```json
{
  "ok": false,
  "operationalReady": true,
  "mode": "incident_adjudicated_local_continuity",
  "confidence": "local_integrity_only",
  "externalAttestation": "deferred",
  "legacy": {
    "classification": "legacy_forensic_integrity_limited",
    "storedLinkBreaks": 674,
    "breakIslands": 282
  },
  "tail": {
    "fromRowidExclusive": 127399,
    "valid": true,
    "rowsChecked": 0
  }
}
```

No frontend change is required. Secret values, filesystem details unsuitable for operators, or the baseline file contents are not returned.

## 9. Baseline Proposal and Activation

The implementation may provide a read-only proposal command, but it must not activate a baseline or write production state.

Allowed behavior:

- open the sealed forensic copy and the current database read-only;
- calculate the frozen prefix digest;
- verify the exact W0 facts and current tail;
- print a candidate JSON document to standard output;
- exit non-zero on any mismatch.

Forbidden behavior:

- write the baseline automatically into a production path;
- accept the currently observed database without the fixed W0 evidence;
- modify SQLite;
- call `repair:audit-chain`;
- reseal, rehash, or rewrite any historical row;
- silently enable the exception.

Activation is a separate manual maintenance operation after code review and merge. The Security Owner supplies the approval identity and places the reviewed artifact on BitLaunch with read-only permissions.

## 10. Hash-Rewrite Removal

The approved policy forbids production hash rewrite. The implementation plan must include a separately reviewable task to:

- remove the `repair:audit-chain` package command;
- remove the executable production repair script;
- remove or make unreachable any exported explicit-repair path that rewrites `prevHash` or stored hashes;
- prove by static and behavioral tests that startup, migration, preflight, and normal runtime cannot auto-reseal.

This task does not execute a repair and does not alter audit data. If an internal test fixture still needs a chain-construction helper, it must operate only on test-owned state and must not be exposed as a production repair capability.

## 11. Failure Semantics

| Failure | Raw legacy status | Operational readiness | Action |
| --- | --- | --- | --- |
| No baseline configured | broken | false | preserve existing audit block |
| Baseline malformed or has unknown fields | broken | false | fail closed; report configuration invalid |
| W0 evidence mismatch | broken | false | incident escalation; do not regenerate baseline |
| Legacy prefix digest mismatch | broken | false | forensic incident; block non-risk-reducing activity |
| Cutoff row/hash mismatch | broken | false | forensic incident; block |
| Known break count/islands mismatch | broken | false | forensic incident; block |
| First post-cutoff link mismatch | broken | false | new continuity incident; block |
| Later tail link or content mismatch | broken | false | new continuity incident; block |
| Valid legacy prefix and valid tail | broken | true, local only | allow standalone audit gate; warn explicitly |
| Full raw chain healthy | healthy | true | retain existing normal path |
| `external_hardened` with local baseline | broken | false | local exception is not accepted |
| Baseline file disappears after startup | broken | false on next verification | block; do not cache permanent success |

The implementation must avoid sticky-green state: every security-sensitive decision must use current verifier evidence or a narrowly bounded cache invalidated by relevant database/file identity changes.

## 12. Concurrency and Cutover

Implementation does not perform the production cutover. The eventual operator procedure is:

1. keep production in NO-GO/maintenance mode;
2. stop or quiesce all audit writers;
3. capture current database identity and verify it against W0 plus a valid tail;
4. independently calculate and review the W0 prefix digest;
5. create the approval artifact with Security Owner identity and timestamp;
6. mount the artifact read-only outside any web-served directory;
7. configure `AUDIT_CONTINUITY_BASELINE_FILE`;
8. restart the service and run production preflight;
9. confirm raw legacy status remains broken, continuity is ready, and confidence is local only;
10. append a normal, non-repair operational audit event describing activation, then verify the tail again;
11. retain all before/after evidence.

No writer may cross the verification/activation boundary without being included in the verified tail. If quiescence cannot be demonstrated, activation is aborted.

## 13. Rollback

Rollback never deletes or rewrites audit history.

To disable the exception:

1. return the service to maintenance/NO-GO mode;
2. remove the environment reference to the approval artifact;
3. restart;
4. verify that the existing fail-closed audit block returns;
5. retain the artifact, activation evidence, and any audit rows appended while it was active.

If the tail fails after activation, the service remains blocked until the new incident is adjudicated. The system must not expand the legacy cutoff or regenerate the prefix digest automatically.

## 14. Test-Driven Safety Requirements

Production code changes begin only after characterization/regression tests fail for the missing capability. Tests use W0-isolated temporary SQLite databases and never open the production database for writing.

Required RED-to-GREEN coverage:

1. raw broken chain with no baseline remains blocked;
2. exact approved fixture prefix plus valid tail becomes operationally ready while raw legacy verification remains false;
3. mutation of any pre-cutoff stored field fails the prefix digest;
4. missing cutoff or cutoff hash/`prevHash`/timestamp mismatch fails;
5. known break count or island count mismatch fails;
6. first post-cutoff `prevHash` mismatch fails;
7. a later tail link break fails;
8. a tail content mutation fails;
9. a valid new append remains ready;
10. the baseline is accepted only by `bitlaunch_single_server`;
11. malformed, unknown-field, non-regular, or unsafe baseline input fails closed;
12. preflight reports local-only warning and never fabricates raw success;
13. the trade audit gate permits a valid local-continuity state and blocks every invalid/new-break state;
14. professional risk degradation clears only for valid local continuity;
15. the raw verifier still reports the legacy break;
16. the operations response separates raw history from operational continuity;
17. missing/remounted/changed approval file cannot leave sticky green;
18. no startup or runtime path rewrites audit hashes;
19. the repair CLI is unavailable after the dedicated removal task;
20. protected runtime database fingerprint, audit head, and forensic artifacts remain unchanged through the full verification suite.

## 15. Verification Plan

After implementation, run in this order:

- local audit continuity targeted tests;
- audit-chain/no-auto-reseal tests;
- store and persistence tests;
- preflight/security-profile tests;
- professional risk and trade-action gate tests;
- dependency-readiness tests;
- related integration tests;
- full isolated suite;
- agent eval;
- lint;
- production build;
- `git diff --check`;
- static search proving no callable production repair path;
- before/after read-only fingerprint verification of the protected runtime database and W0 artifacts.

## 16. Non-Goals

This work does not:

- implement Epoch 2;
- register or configure an external provider;
- claim WORM or external attestation;
- change the frontend;
- change trading strategy, risk rules, sizing, execution, OMS, reconciliation, or market-data behavior;
- modify production readiness dependencies unrelated to audit continuity;
- modify SQLite schema unless a later implementation review proves a schema change is strictly necessary;
- rewrite historical audit records;
- repair the 674 breaks;
- silently accept future audit corruption.

## 17. Implementation Entry Gate

Implementation may begin only after the Security Owner approves this document, including these explicit consequences:

1. production assurance remains lower than an externally attested design;
2. a privileged BitLaunch host compromise can potentially replace both local evidence and the database;
3. Epoch 1 remains integrity-limited forever;
4. every new break after rowid `127399` is production-blocking;
5. the approval artifact is manual deployment configuration and is never generated or enabled automatically;
6. production remains NO-GO until code review, merge, a manual cutover review, and a fresh production preflight are complete.
