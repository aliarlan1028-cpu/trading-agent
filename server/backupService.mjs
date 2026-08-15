import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";
import { backupSqlite } from "./store.mjs";
import { encryptBackupBytes } from "./backupEncryption.mjs";

const REQUIRED_TABLES = Object.freeze(["collections", "trading_entities", "audit_log_entries"]);

async function secureDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
}

async function secureFile(filePath) {
  await fs.chmod(filePath, 0o600);
}

export function verifySqliteBackup(filePath, DatabaseImpl = Database) {
  const reader = new DatabaseImpl(filePath, { readonly: true, fileMustExist: true });
  try {
    const integrity = reader.pragma("integrity_check", { simple: true });
    const present = new Set(reader.prepare("select name from sqlite_master where type='table'").all().map((row) => row.name));
    const missingTables = REQUIRED_TABLES.filter((name) => !present.has(name));
    if (integrity !== "ok" || missingTables.length) {
      const error = new Error(`backup verification failed: integrity=${integrity}; missing=${missingTables.join(",") || "none"}`);
      error.code = "BACKUP_VERIFICATION_FAILED";
      throw error;
    }
    return { integrity, requiredTables: [...REQUIRED_TABLES] };
  } finally {
    reader.close();
  }
}

async function writeAtomic(filePath, data) {
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  await fs.writeFile(temporary, data, { mode: 0o600 });
  await secureFile(temporary);
  await fs.rename(temporary, filePath);
  await secureFile(filePath);
}

async function applyRetention(directory, keep) {
  const files = (await fs.readdir(directory)).filter((name) => /^trading-agent-.*\.sqlite(?:\.enc)?$/.test(name)).sort().reverse();
  const generations = [...new Set(files.map((name) => name.replace(/\.sqlite(?:\.enc)?$/, "")))];
  for (const generation of generations.slice(keep)) {
    for (const suffix of [".sqlite", ".sqlite.sha256", ".sqlite.enc", ".sqlite.enc.sha256", ".json"]) {
      await fs.rm(path.join(directory, `${generation}${suffix}`), { force: true });
    }
  }
  return { kept: Math.min(keep, generations.length), removed: Math.max(0, generations.length - keep) };
}

export async function createVerifiedBackup(options = {}) {
  const env = options.env || process.env;
  const directory = path.resolve(options.backupDir || env.BACKUP_DIR || "backups");
  const backupFn = options.backupSqliteFn || backupSqlite;
  await secureDirectory(directory);
  const stamp = (options.now || new Date()).toISOString().replace(/[:.]/g, "-");
  const baseName = `trading-agent-${stamp}`;
  const filePath = path.join(directory, `${baseName}.sqlite`);
  const partialPath = `${filePath}.partial`;
  try {
    await backupFn(partialPath);
    await secureFile(partialPath);
    const verification = verifySqliteBackup(partialPath, options.DatabaseImpl || Database);
    await fs.rename(partialPath, filePath);
    await secureFile(filePath);
    const bytes = await fs.readFile(filePath);
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    await writeAtomic(`${filePath}.sha256`, `${sha256}  ${path.basename(filePath)}\n`);

    let encryptedFilePath = null;
    let offsiteFilePath = null;
    const encryptionKeyFile = String(env.BACKUP_ENCRYPTION_KEY_FILE || "").trim();
    const offsiteValue = String(env.BACKUP_OFFSITE_DIR || "").trim();
    if (offsiteValue && !encryptionKeyFile) throw new Error("BACKUP_OFFSITE_DIR requires BACKUP_ENCRYPTION_KEY_FILE");
    if (encryptionKeyFile) {
      const keyMaterial = await fs.readFile(path.resolve(encryptionKeyFile));
      if (keyMaterial.length < 32) throw new Error("BACKUP_ENCRYPTION_KEY_FILE must contain at least 32 bytes");
      const encrypted = encryptBackupBytes(bytes, keyMaterial);
      encryptedFilePath = `${filePath}.enc`;
      await writeAtomic(encryptedFilePath, encrypted);
      const encryptedSha256 = crypto.createHash("sha256").update(encrypted).digest("hex");
      await writeAtomic(`${encryptedFilePath}.sha256`, `${encryptedSha256}  ${path.basename(encryptedFilePath)}\n`);
      if (offsiteValue) {
        const offsiteDir = path.resolve(offsiteValue);
        if (offsiteDir === directory) throw new Error("BACKUP_OFFSITE_DIR must differ from BACKUP_DIR");
        await secureDirectory(offsiteDir);
        if (env.BACKUP_OFFSITE_REQUIRE_DISTINCT_DEVICE !== "false") {
          const [localStat, offsiteStat] = await Promise.all([fs.stat(directory), fs.stat(offsiteDir)]);
          if (localStat.dev === offsiteStat.dev) throw new Error("BACKUP_OFFSITE_DIR must be on a distinct filesystem");
        }
        offsiteFilePath = path.join(offsiteDir, path.basename(encryptedFilePath));
        await fs.copyFile(encryptedFilePath, offsiteFilePath);
        await secureFile(offsiteFilePath);
        await fs.copyFile(`${encryptedFilePath}.sha256`, `${offsiteFilePath}.sha256`);
        await secureFile(`${offsiteFilePath}.sha256`);
      }
    }

    const keep = Math.max(2, Number(env.BACKUP_KEEP_COUNT || 14));
    const retention = await applyRetention(directory, keep);
    const manifest = {
      status: "ok", verified: true, integrity: verification.integrity,
      sqliteFile: path.basename(filePath), encryptedFile: encryptedFilePath ? path.basename(encryptedFilePath) : null,
      offsiteFile: offsiteFilePath ? path.basename(offsiteFilePath) : null,
      bytes: bytes.length, sha256, retention, completedAt: new Date().toISOString()
    };
    const manifestPath = path.join(directory, `${baseName}.json`);
    await writeAtomic(manifestPath, JSON.stringify(manifest, null, 2));
    await writeAtomic(path.join(directory, "backup-status.json"), JSON.stringify(manifest, null, 2));
    return { ...manifest, filePath, encryptedFilePath, offsiteFilePath, manifestPath };
  } catch (error) {
    await fs.rm(partialPath, { force: true }).catch(() => {});
    throw error;
  }
}
