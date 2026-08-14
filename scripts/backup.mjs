import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";
import { backupSqlite } from "../server/store.mjs";
import { encryptBackupBytes } from "../server/backupEncryption.mjs";

const backupDir = path.resolve(process.env.BACKUP_DIR || "backups");
await fs.mkdir(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const filePath = path.join(backupDir, `trading-agent-${stamp}.sqlite`);
await backupSqlite(filePath);
// 备份成功返回不等于文件可恢复：立即以只读方式打开并运行 SQLite 完整性检查。
// 失败则脚本非零退出，cron/监控不会把损坏快照当成有效备份。
const verificationDb = new Database(filePath, { readonly: true, fileMustExist: true });
const integrity = verificationDb.pragma("integrity_check", { simple: true });
const collectionTable = verificationDb.prepare("select name from sqlite_master where type='table' and name='collections'").get();
verificationDb.close();
if (integrity !== "ok" || !collectionTable) throw new Error(`backup verification failed: integrity=${integrity}`);
const bytes = await fs.readFile(filePath);
const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
await fs.writeFile(`${filePath}.sha256`, `${sha256}  ${path.basename(filePath)}\n`, "utf8");

let encryptedFilePath = null;
let offsiteFilePath = null;
const encryptionKeyFile = String(process.env.BACKUP_ENCRYPTION_KEY_FILE || "").trim();
const offsiteDirValue = String(process.env.BACKUP_OFFSITE_DIR || "").trim();
if (offsiteDirValue && !encryptionKeyFile) {
  throw new Error("BACKUP_OFFSITE_DIR requires BACKUP_ENCRYPTION_KEY_FILE; plaintext offsite copies are forbidden");
}
if (encryptionKeyFile) {
  const keyMaterial = await fs.readFile(path.resolve(encryptionKeyFile));
  if (keyMaterial.length < 32) throw new Error("BACKUP_ENCRYPTION_KEY_FILE must contain at least 32 bytes");
  const encrypted = encryptBackupBytes(bytes, keyMaterial);
  encryptedFilePath = `${filePath}.enc`;
  await fs.writeFile(encryptedFilePath, encrypted, { mode: 0o600 });
  const encryptedSha256 = crypto.createHash("sha256").update(encrypted).digest("hex");
  await fs.writeFile(`${encryptedFilePath}.sha256`, `${encryptedSha256}  ${path.basename(encryptedFilePath)}\n`, "utf8");
  if (offsiteDirValue) {
    const offsiteDir = path.resolve(offsiteDirValue);
    if (offsiteDir === backupDir) throw new Error("BACKUP_OFFSITE_DIR must not be the local backup directory");
    await fs.mkdir(offsiteDir, { recursive: true, mode: 0o700 });
    if (process.env.BACKUP_OFFSITE_REQUIRE_DISTINCT_DEVICE !== "false") {
      const [localStat, offsiteStat] = await Promise.all([fs.stat(backupDir), fs.stat(offsiteDir)]);
      if (localStat.dev === offsiteStat.dev) {
        throw new Error("BACKUP_OFFSITE_DIR is on the same filesystem as BACKUP_DIR; mount a separate disk, NFS, or rclone target (or explicitly set BACKUP_OFFSITE_REQUIRE_DISTINCT_DEVICE=false for development only)");
      }
    }
    offsiteFilePath = path.join(offsiteDir, path.basename(encryptedFilePath));
    await fs.copyFile(encryptedFilePath, offsiteFilePath);
    await fs.copyFile(`${encryptedFilePath}.sha256`, `${offsiteFilePath}.sha256`);
  }
}

const keep = Math.max(2, Number(process.env.BACKUP_KEEP_COUNT || 14));
const files = (await fs.readdir(backupDir)).filter((name) => /^trading-agent-.*\.sqlite$/.test(name)).sort().reverse();
for (const name of files.slice(keep)) {
  await fs.rm(path.join(backupDir, name));
  await fs.rm(path.join(backupDir, `${name}.sha256`), { force: true });
  await fs.rm(path.join(backupDir, `${name}.enc`), { force: true });
  await fs.rm(path.join(backupDir, `${name}.enc.sha256`), { force: true });
}
const result = { status: "ok", verified: true, integrity, filePath, bytes: bytes.length, sha256, encryptedFilePath, offsiteFilePath, completedAt: new Date().toISOString() };
await fs.writeFile(path.join(backupDir, "backup-status.json"), JSON.stringify(result, null, 2), { mode: 0o600 });
console.log(JSON.stringify(result, null, 2));
