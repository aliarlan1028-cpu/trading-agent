import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { decryptBackupBytes } from "../server/backupEncryption.mjs";

const backupDir = path.resolve(process.env.BACKUP_DIR || "backups");
const names = await fs.readdir(backupDir);
const encrypted = names.filter((name) => /^trading-agent-.*\.sqlite\.enc$/.test(name)).sort().reverse();
const plain = names.filter((name) => /^trading-agent-.*\.sqlite$/.test(name)).sort().reverse();
const requireEncrypted = process.env.RESTORE_DRILL_REQUIRE_ENCRYPTED === "true";
const selected = (encrypted[0] && (requireEncrypted || process.env.BACKUP_ENCRYPTION_KEY_FILE)) ? encrypted[0] : plain[0];
if (!selected) throw new Error("No backup snapshot found for restore drill");
if (requireEncrypted && !selected.endsWith(".enc")) throw new Error("Encrypted restore drill required but no encrypted backup exists");

const sourcePath = path.join(backupDir, selected);
const sourceBytes = await fs.readFile(sourcePath);
let sqliteBytes = sourceBytes;
let encryptedVerified = false;
if (selected.endsWith(".enc")) {
  const keyFile = String(process.env.BACKUP_ENCRYPTION_KEY_FILE || "").trim();
  if (!keyFile) throw new Error("Encrypted backup requires BACKUP_ENCRYPTION_KEY_FILE");
  const keyMaterial = await fs.readFile(path.resolve(keyFile));
  sqliteBytes = decryptBackupBytes(sourceBytes, keyMaterial);
  encryptedVerified = true;
}

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "trading-agent-restore-drill-"));
const restoredPath = path.join(tempDir, "restored.sqlite");
try {
  await fs.writeFile(restoredPath, sqliteBytes, { mode: 0o600 });
  const db = new Database(restoredPath, { readonly: true, fileMustExist: true });
  const integrity = db.pragma("integrity_check", { simple: true });
  const requiredTables = ["collections", "trading_entities", "audit_log_entries"];
  const available = new Set(db.prepare("select name from sqlite_master where type='table'").all().map((row) => row.name));
  const missingTables = requiredTables.filter((name) => !available.has(name));
  const collectionCount = available.has("collections") ? Number(db.prepare("select count(*) as count from collections").get().count) : 0;
  db.close();
  if (integrity !== "ok" || missingTables.length || collectionCount === 0) {
    throw new Error(`restore verification failed: integrity=${integrity}; missing=${missingTables.join(",")}; collections=${collectionCount}`);
  }
  const result = {
    status: "ok",
    source: selected,
    encryptedVerified,
    integrity,
    requiredTables,
    collectionCount,
    productionDatabaseTouched: false,
    completedAt: new Date().toISOString()
  };
  await fs.writeFile(path.join(backupDir, "restore-drill-status.json"), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
