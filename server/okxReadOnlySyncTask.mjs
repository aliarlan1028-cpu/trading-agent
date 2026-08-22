import { syncPrivateReadOnly } from "./exchangeConnector.mjs";
import { isLeaseLostError } from "./leaseSafety.mjs";
import { reconcilePendingOkxFillIdentities } from "./realtimeManager.mjs";

function errorText(error) {
  return String(error?.message || error || "unknown_error").slice(0, 160);
}

export async function runOkxReadOnlySyncTask(database, lease, dependencies = {}) {
  const accounts = (database.exchangeAccounts || []).filter((item) => item.readEnabled);
  if (!accounts.length) return { status: "skipped", reason: "no_read_account", skipPersist: true };

  const syncAccount = dependencies.syncAccount || syncPrivateReadOnly;
  const reconcileFills = dependencies.reconcileFills || reconcilePendingOkxFillIdentities;
  let synced = 0;
  const errors = [];

  for (const account of accounts) {
    try {
      lease.assertLease();
      const snapshot = await syncAccount(database, account.id);
      lease.assertLease();
      if (snapshot?.status === "ok") synced += 1;
      else errors.push({
        accountId: account.id,
        status: String(snapshot?.status || "unknown"),
        error: errorText(snapshot?.error || snapshot?.reason || snapshot?.status)
      });
    } catch (error) {
      if (isLeaseLostError(error) || lease.signal?.aborted) throw error;
      errors.push({ accountId: account.id, status: "error", error: errorText(error) });
    }
  }

  lease.assertLease();
  const externalFillReconciliation = await reconcileFills(database, {
    signal: lease.signal,
    assertLease: lease.assertLease
  });
  lease.assertLease();

  const status = synced === 0 ? "failed" : synced < accounts.length ? "partial" : "ok";
  return {
    status,
    ...(status === "failed" && errors.length
      ? { reason: `${errors[0].accountId}/${errors[0].status}: ${errors[0].error}` }
      : {}),
    attempted: accounts.length,
    synced,
    errors,
    externalFillReconciliation
  };
}
