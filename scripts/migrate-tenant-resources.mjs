import { loadDb, migrateOwnerResourcesToTenantStore } from "../server/store.mjs";

if (process.env.CONFIRM_TENANT_RESOURCE_MIGRATION !== "true") {
  throw new Error("Set CONFIRM_TENANT_RESOURCE_MIGRATION=true after taking a backup");
}
const db = loadDb();
console.log(JSON.stringify({ ok: true, ...migrateOwnerResourcesToTenantStore(db) }, null, 2));
