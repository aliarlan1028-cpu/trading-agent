import fs from "node:fs/promises";
import path from "node:path";
import { loadDb, repairAuditChainExplicit } from "../server/store.mjs";

const acknowledgement = process.env.AUDIT_REPAIR_ACK;
if (acknowledgement !== "I_HAVE_PRESERVED_THE_ORIGINAL_AUDIT_DATABASE") {
  throw new Error("Refusing repair: set AUDIT_REPAIR_ACK=I_HAVE_PRESERVED_THE_ORIGINAL_AUDIT_DATABASE after authorization");
}

const backupRoot = path.resolve(process.env.AUDIT_REPAIR_BACKUP_DIR || "backups/audit-repair");
await fs.mkdir(backupRoot, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.join(backupRoot, `pre-audit-repair-${stamp}.sqlite`);
const db = loadDb();
if (db.meta?.auditChainBroken !== true) {
  process.stdout.write(`${JSON.stringify({ status: "not_required", checkedAt: db.meta?.auditChainCheckedAt }, null, 2)}\n`);
  process.exit(0);
}
const result = await repairAuditChainExplicit(db, { acknowledgement, backupPath, actor: process.env.AUDIT_REPAIR_ACTOR || "SecurityAdminCLI" });
process.stdout.write(`${JSON.stringify({ status: result.after.ok ? "repaired" : "failed", ...result }, null, 2)}\n`);
if (!result.after.ok) process.exitCode = 1;
