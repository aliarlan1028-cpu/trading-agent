import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "audit-chain-no-reseal-"));
process.env.DATA_DIR = dataDir;
const { appendAudit, loadDb, saveDb, verifyAuditChain, verifyAuditChainReadOnly } = await import(`../server/store.mjs?audit-no-reseal=${Date.now()}`);

test("启动发现审计链断裂时保留原 hash 并切只减仓", () => {
  const db = loadDb();
  const first = appendAudit(db, "first", "one", "test");
  const second = appendAudit(db, "second", "two", "test");
  saveDb(db);
  const originalHash = first.hash;
  const sqlitePath = path.join(dataDir, "trading-agent.sqlite");
  const writer = new Database(sqlitePath);
  const stored = JSON.parse(writer.prepare("select doc from audit_log_entries where id = ?").get(first.id).doc);
  stored.action = "tampered";
  writer.prepare("update audit_log_entries set action = ?, doc = ? where id = ?").run(stored.action, JSON.stringify(stored), first.id);
  writer.close();
  assert.equal(verifyAuditChain(db).ok, false);

  const reloaded = loadDb();
  const persistedFirst = reloaded.auditLogs.find((entry) => entry.id === first.id);
  assert.equal(persistedFirst.hash, originalHash);
  assert.equal(reloaded.meta.auditChainBroken, true);
  assert.equal(reloaded.system.reduceOnlyMode, true);
  assert.equal(reloaded.system.reduceOnlyBy, "audit_chain_integrity");
  assert.equal(verifyAuditChainReadOnly().ok, false);
  assert.ok(reloaded.riskIncidents.some((item) => item.source === "audit_chain_integrity" && item.status === "open"));
  assert.ok(second.hash);
});
