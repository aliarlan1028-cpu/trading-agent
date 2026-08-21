import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { auditHash } from "../server/auditContinuity.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const auditContinuityUrl = pathToFileURL(path.join(repositoryRoot, "server", "auditContinuity.mjs")).href;

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

test("production audit verification completes within a bounded heap for a large append-only chain", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "audit-continuity-memory-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const sqlitePath = path.join(directory, "audit.sqlite");
  const sqlite = new Database(sqlitePath);
  sqlite.exec(`
    create table audit_log_entries (
      id text primary key,
      actor text not null,
      action text not null,
      target text not null,
      severity text not null,
      created_at text not null,
      doc text not null
    )
  `);
  const insert = sqlite.prepare(`
    insert into audit_log_entries (id, actor, action, target, severity, created_at, doc)
    values (@id, @actor, @action, @target, @severity, @createdAt, @doc)
  `);
  const action = "bounded-memory-audit-entry-".padEnd(1_024, "x");
  const insertRows = sqlite.transaction(() => {
    let previousHash = null;
    for (let index = 0; index < 25_000; index += 1) {
      const entry = {
        id: `audit_memory_${index}`,
        actor: "MemoryRegression",
        action,
        target: "audit_verifier",
        severity: "info",
        prevHash: previousHash,
        createdAt: new Date(1_700_000_000_000 + index).toISOString()
      };
      entry.hash = auditHash(entry);
      insert.run({ ...entry, doc: JSON.stringify(entry) });
      previousHash = entry.hash;
    }
  });
  insertRows();
  sqlite.close();

  const probe = `
    const { verifyApprovedAuditContinuityAtPath } = await import(${JSON.stringify(auditContinuityUrl)});
    const status = verifyApprovedAuditContinuityAtPath({ sqlitePath: ${JSON.stringify(sqlitePath)} });
    console.log("AUDIT_MEMORY_STATUS=" + JSON.stringify({
      operationalReady: status.operationalReady,
      mode: status.mode,
      checked: status.raw?.checked,
      tailRowsChecked: status.tailRowsChecked
    }));
  `;
  const result = await runNode(["--max-old-space-size=64", "--input-type=module", "--eval", probe]);

  assert.equal(result.status, 0, `signal=${result.signal}\n${result.stderr}`);
  const line = result.stdout.split(/\r?\n/).find((item) => item.startsWith("AUDIT_MEMORY_STATUS="));
  assert.ok(line, result.stdout);
  assert.deepEqual(JSON.parse(line.slice("AUDIT_MEMORY_STATUS=".length)), {
    operationalReady: true,
    mode: "full_chain",
    checked: 25_000,
    tailRowsChecked: 25_000
  });
});
