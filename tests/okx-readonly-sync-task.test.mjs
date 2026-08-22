import assert from "node:assert/strict";
import test from "node:test";

import { runOkxReadOnlySyncTask } from "../server/okxReadOnlySyncTask.mjs";
import { LeaseLostError } from "../server/leaseSafety.mjs";

function fixture() {
  return {
    exchangeAccounts: [
      { id: "okx-a", exchange: "OKX", readEnabled: true },
      { id: "okx-b", exchange: "OKX", readEnabled: true }
    ]
  };
}

const lease = {
  signal: new AbortController().signal,
  assertLease() {}
};

test("resolved request_failed snapshots make the OKX sync task fail instead of false-green", async () => {
  const db = fixture();
  db.exchangeAccounts = [db.exchangeAccounts[0]];
  const result = await runOkxReadOnlySyncTask(db, lease, {
    syncAccount: async (_database, accountId) => ({ accountId, status: "request_failed", error: "This operation was aborted" }),
    reconcileFills: async () => ({ checked: 0, reconciled: 0, results: [] })
  });

  assert.equal(result.status, "failed");
  assert.equal(result.reason, "okx-a/request_failed: This operation was aborted");
  assert.equal(result.attempted, 1);
  assert.equal(result.synced, 0);
  assert.deepEqual(result.errors, [{ accountId: "okx-a", status: "request_failed", error: "This operation was aborted" }]);
});

test("mixed successful and failed accounts report partial without hiding the failed account", async () => {
  const result = await runOkxReadOnlySyncTask(fixture(), lease, {
    syncAccount: async (_database, accountId) => accountId === "okx-a"
      ? { accountId, status: "ok" }
      : { accountId, status: "credential_fingerprint_mismatch", error: "binding mismatch" },
    reconcileFills: async () => ({ checked: 0, reconciled: 0, results: [] })
  });

  assert.equal(result.status, "partial");
  assert.equal(result.synced, 1);
  assert.deepEqual(result.errors, [{ accountId: "okx-b", status: "credential_fingerprint_mismatch", error: "binding mismatch" }]);
});

test("all successful snapshots preserve the existing successful task result", async () => {
  const result = await runOkxReadOnlySyncTask(fixture(), lease, {
    syncAccount: async (_database, accountId) => ({ accountId, status: "ok" }),
    reconcileFills: async () => ({ checked: 2, reconciled: 1, results: ["fill"] })
  });

  assert.equal(result.status, "ok");
  assert.equal(result.attempted, 2);
  assert.equal(result.synced, 2);
  assert.deepEqual(result.errors, []);
  assert.equal(result.externalFillReconciliation.reconciled, 1);
});

test("a thrown account error remains isolated and still runs external fill reconciliation", async () => {
  let reconciled = 0;
  const db = fixture();
  db.exchangeAccounts = [db.exchangeAccounts[0]];
  const result = await runOkxReadOnlySyncTask(db, lease, {
    syncAccount: async () => { throw new Error("network down"); },
    reconcileFills: async () => { reconciled += 1; return { checked: 0, reconciled: 0, results: [] }; }
  });

  assert.equal(result.status, "failed");
  assert.equal(result.synced, 0);
  assert.deepEqual(result.errors, [{ accountId: "okx-a", status: "error", error: "network down" }]);
  assert.equal(reconciled, 1);
});

test("lease loss is never converted into an ordinary account failure", async () => {
  let reconciled = 0;
  const db = fixture();
  db.exchangeAccounts = [db.exchangeAccounts[0]];

  await assert.rejects(
    runOkxReadOnlySyncTask(db, lease, {
      syncAccount: async () => { throw new LeaseLostError(); },
      reconcileFills: async () => { reconciled += 1; return {}; }
    }),
    (error) => error?.code === "scheduler_lease_lost"
  );
  assert.equal(reconciled, 0);
});

test("no readable account keeps the existing skipped no-op behavior", async () => {
  const db = fixture();
  db.exchangeAccounts.forEach((account) => { account.readEnabled = false; });
  const result = await runOkxReadOnlySyncTask(db, lease, {
    syncAccount: async () => { throw new Error("must not sync"); },
    reconcileFills: async () => { throw new Error("must not reconcile"); }
  });

  assert.deepEqual(result, { status: "skipped", reason: "no_read_account", skipPersist: true });
});
