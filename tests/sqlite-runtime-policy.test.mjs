import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import {
  SQLITE_WAL_AUTOCHECKPOINT_PAGES,
  SQLITE_WAL_SIZE_LIMIT_BYTES,
  applySqliteRuntimePolicy
} from "../server/sqliteRuntimePolicy.mjs";

test("SQLite runtime policy bounds WAL retention without weakening integrity settings", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-runtime-policy-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const database = new Database(path.join(root, "runtime.sqlite"));
  t.after(() => database.close());

  applySqliteRuntimePolicy(database);

  assert.equal(database.pragma("journal_mode", { simple: true }), "wal");
  assert.equal(database.pragma("busy_timeout", { simple: true }), 5_000);
  assert.equal(database.pragma("foreign_keys", { simple: true }), 1);
  assert.equal(
    database.pragma("wal_autocheckpoint", { simple: true }),
    SQLITE_WAL_AUTOCHECKPOINT_PAGES
  );
  assert.equal(
    database.pragma("journal_size_limit", { simple: true }),
    SQLITE_WAL_SIZE_LIMIT_BYTES
  );
});

test("SQLite runtime policy is idempotent for an existing connection", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-runtime-policy-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const database = new Database(path.join(root, "runtime.sqlite"));
  t.after(() => database.close());

  applySqliteRuntimePolicy(database);
  applySqliteRuntimePolicy(database);

  assert.equal(database.pragma("wal_autocheckpoint", { simple: true }), 1_000);
  assert.equal(database.pragma("journal_size_limit", { simple: true }), 64 * 1024 * 1024);
});
