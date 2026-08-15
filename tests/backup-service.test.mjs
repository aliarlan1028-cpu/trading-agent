import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createVerifiedBackup } from "../server/backupService.mjs";

async function withTemp(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "backup-service-"));
  try { return await fn(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

function validBackup(destination) {
  const db = new Database(destination);
  db.exec("create table collections(name text primary key, value text); create table trading_entities(id text); create table audit_log_entries(id text)");
  db.close();
}

test("verified backup uses 0700/0600 modes and unified retention", async () => withTemp(async (dir) => {
  const previous = process.umask(0o022);
  try {
    for (const day of [1, 2, 3]) {
      await createVerifiedBackup({
        backupDir: dir,
        now: new Date(`2026-08-0${day}T00:00:00.000Z`),
        backupSqliteFn: async (target) => validBackup(target),
        env: { BACKUP_KEEP_COUNT: "2" }
      });
    }
  } finally {
    process.umask(previous);
  }
  assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
  const files = await fs.readdir(dir);
  const sqlite = files.filter((name) => name.endsWith(".sqlite"));
  assert.equal(sqlite.length, 2);
  for (const name of files.filter((entry) => /\.(sqlite|sha256|json)$/.test(entry))) {
    assert.equal((await fs.stat(path.join(dir, name))).mode & 0o777, 0o600, name);
  }
}));

test("corrupt or schema-incomplete backup never returns success", async () => withTemp(async (dir) => {
  await assert.rejects(() => createVerifiedBackup({
    backupDir: dir,
    backupSqliteFn: async (target) => fs.writeFile(target, "not sqlite"),
    env: {}
  }), /not a database|verification failed/i);
  assert.equal((await fs.readdir(dir)).some((name) => name === "backup-status.json"), false);
}));

test("configured encryption is executed by the same backup service", async () => withTemp(async (dir) => {
  const keyFile = path.join(dir, "backup.key");
  await fs.writeFile(keyFile, Buffer.alloc(32, 7), { mode: 0o600 });
  const result = await createVerifiedBackup({
    backupDir: path.join(dir, "out"),
    backupSqliteFn: async (target) => validBackup(target),
    env: { BACKUP_ENCRYPTION_KEY_FILE: keyFile }
  });
  assert.ok(result.encryptedFile);
  assert.equal((await fs.stat(result.encryptedFilePath)).mode & 0o777, 0o600);
}));
