import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storeUrl = pathToFileURL(path.join(repositoryRoot, "server", "store.mjs")).href;
const runtimeDataDir = path.join(repositoryRoot, "data");

async function temporaryDirectory(t, prefix) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => {
    await fsp.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

function childEnvironment(overrides = {}) {
  const env = { ...process.env, ...overrides };
  delete env.NODE_TEST_CONTEXT;
  if (overrides.DATA_DIR === undefined) delete env.DATA_DIR;
  return env;
}

function runNode(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd || repositoryRoot,
      env: options.env || childEnvironment(),
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

function marker(output, name) {
  const line = output.split(/\r?\n/).find((item) => item.startsWith(`${name}=`));
  assert.ok(line, `missing ${name} marker in output:\n${output}`);
  return JSON.parse(line.slice(name.length + 1));
}

function rawMarker(output, name) {
  const line = output.split(/\r?\n/).find((item) => item.startsWith(`${name}=`));
  assert.ok(line, `missing ${name} marker in output:\n${output}`);
  return line.slice(name.length + 1);
}

function isPathWithin(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function createProtectedFixture(dataDirectory) {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const databasePath = path.join(dataDirectory, "trading-agent.sqlite");
  const database = new Database(databasePath);
  database.pragma("journal_mode = DELETE");
  database.exec(`
    create table audit_log_entries (
      id text primary key,
      actor text not null,
      action text not null,
      target text not null,
      severity text not null,
      created_at text not null,
      doc text not null
    );
    create table medium_term_samples (
      symbol text not null,
      bucket_at integer not null,
      observed_at text,
      doc text not null,
      primary key (symbol, bucket_at)
    );
  `);
  const audit = {
    id: "audit_fixture_head",
    actor: "Fixture",
    action: "protected",
    target: "fixture",
    severity: "info",
    prevHash: null,
    createdAt: "2026-08-20T00:00:00.000Z",
    hash: "fixture-head-hash"
  };
  database.prepare(`
    insert into audit_log_entries (id, actor, action, target, severity, created_at, doc)
    values (@id, @actor, @action, @target, @severity, @createdAt, @doc)
  `).run({ ...audit, doc: JSON.stringify(audit) });
  database.prepare(`
    insert into medium_term_samples (symbol, bucket_at, observed_at, doc)
    values (?, ?, ?, ?)
  `).run("BTC/USDT", 1_776_297_600_000, "2026-04-17T00:00:00.000Z", JSON.stringify({ symbol: "BTC/USDT", bucketAt: 1_776_297_600_000, protected: true }));
  database.close();
  fs.writeFileSync(path.join(dataDirectory, "protected.canary"), "forensic-protected\n", { mode: 0o600 });
  return databasePath;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function protectedFingerprint(dataDirectory) {
  const databasePath = path.join(dataDirectory, "trading-agent.sqlite");
  const databaseStat = fs.statSync(databasePath);
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const auditCount = database.prepare("select count(*) as count from audit_log_entries").get().count;
    const auditHead = database.prepare("select doc from audit_log_entries order by rowid desc limit 1").get()?.doc || null;
    const mediumTermSamples = database.prepare("select count(*) as count from medium_term_samples").get().count;
    return {
      databaseSha256: sha256(databasePath),
      databaseBytes: databaseStat.size,
      databaseMtimeMs: databaseStat.mtimeMs,
      auditCount,
      auditHead,
      mediumTermSamples,
      canarySha256: sha256(path.join(dataDirectory, "protected.canary"))
    };
  } finally {
    database.close();
  }
}

async function createSandboxProject(t) {
  const sandbox = await temporaryDirectory(t, "trading-agent-storage-sandbox-");
  await fsp.cp(path.join(repositoryRoot, "server"), path.join(sandbox, "server"), { recursive: true });
  await fsp.symlink(path.join(repositoryRoot, "node_modules"), path.join(sandbox, "node_modules"), "dir");
  const protectedData = path.join(sandbox, "data");
  createProtectedFixture(protectedData);
  const probe = path.join(sandbox, "storage-probe.test.mjs");
  await fsp.writeFile(probe, `
    import test from "node:test";
    import { getStorageInfo } from "./server/store.mjs";
    test("reports its actual SQLite location", () => {
      console.log("TEST_STORAGE_INFO=" + JSON.stringify(getStorageInfo()));
    });
  `);
  return { sandbox, protectedData, probe };
}

async function createStoreProbe(t, { load = false } = {}) {
  const probeRoot = await temporaryDirectory(t, "trading-agent-store-probe-");
  const probe = path.join(probeRoot, "store-probe.test.mjs");
  await fsp.writeFile(probe, `
    import test from "node:test";
    import { getStorageInfo, loadDb } from ${JSON.stringify(storeUrl)};
    test("reports its isolated storage", () => {
      ${load ? "loadDb();" : ""}
      console.log("STORE_PROBE=" + JSON.stringify(getStorageInfo()));
    });
  `);
  return probe;
}

async function runDetachedReset(dataDirectory) {
  const source = `
    import { resetOperationalData, seedDatabase } from ${JSON.stringify(storeUrl)};
    const state = seedDatabase();
    state.mediumTermSamples.push({ symbol: "ETH/USDT", bucketAt: 1, protected: false });
    resetOperationalData(state, { actor: "Test" });
    console.log("RESET_STATE=" + JSON.stringify({
      mediumTermSamples: state.mediumTermSamples.length,
      auditCount: state.auditLogs.length,
      auditTarget: state.auditLogs[0]?.target || null
    }));
  `;
  return runNode(["--input-type=module", "--eval", source], {
    env: childEnvironment({ DATA_DIR: dataDirectory })
  });
}

test("test context without DATA_DIR never opens the runtime fallback database", async (t) => {
  const { sandbox, protectedData, probe } = await createSandboxProject(t);
  const testDataRoot = await temporaryDirectory(t, "trading-agent-worker-root-");
  const before = protectedFingerprint(protectedData);

  const result = await runNode(["--test", probe], {
    cwd: sandbox,
    env: childEnvironment({ TEST_DATA_ROOT: testDataRoot })
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const storage = marker(result.stdout, "TEST_STORAGE_INFO");
  assert.equal(path.isAbsolute(storage.sqlitePath), true);
  assert.equal(storage.sqlitePath.startsWith(`${testDataRoot}${path.sep}`), true);
  assert.notEqual(path.dirname(storage.sqlitePath), path.join(sandbox, "data"));
  assert.deepEqual(protectedFingerprint(protectedData), before);
});

test("direct node --test without TEST_DATA_ROOT creates and cleans an OS-temp worker", async (t) => {
  const { sandbox, protectedData, probe } = await createSandboxProject(t);
  const before = protectedFingerprint(protectedData);
  const env = childEnvironment();
  delete env.TEST_DATA_ROOT;
  delete env.TEST_STORAGE_TMP_ROOT;

  const result = await runNode(["--test", probe], { cwd: sandbox, env });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const storage = marker(result.stdout, "TEST_STORAGE_INFO");
  const trustedBase = fs.realpathSync.native("/tmp");
  assert.equal(isPathWithin(trustedBase, path.dirname(storage.sqlitePath)), true);
  assert.equal(isPathWithin(os.tmpdir(), path.dirname(storage.sqlitePath)), false);
  assert.notEqual(path.dirname(storage.sqlitePath), protectedData);
  assert.equal(fs.existsSync(path.dirname(storage.sqlitePath)), false);
  assert.deepEqual(protectedFingerprint(protectedData), before);
});

for (const inheritedVariable of ["TMPDIR", "TMP", "TEMP"]) {
  test(`isolated runner ignores inherited ${inheritedVariable} as a trusted temp boundary`, async (t) => {
    const fixtureRuntime = await temporaryDirectory(t, `trading-agent-untrusted-${inheritedVariable.toLowerCase()}-`);
    createProtectedFixture(fixtureRuntime);
    const before = protectedFingerprint(fixtureRuntime);
    const probe = await createStoreProbe(t);
    const env = childEnvironment();
    delete env.TEST_DATA_ROOT;
    delete env.TEST_STORAGE_TMP_ROOT;
    delete env.TMPDIR;
    delete env.TMP;
    delete env.TEMP;
    env[inheritedVariable] = fixtureRuntime;

    const result = await runNode([path.join(repositoryRoot, "scripts", "run-tests-isolated.mjs"), probe], { env });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const suiteRoot = rawMarker(result.stdout, "ISOLATED_TEST_DATA_ROOT");
    assert.equal(isPathWithin(fixtureRuntime, suiteRoot), false);
    const trustedBase = rawMarker(result.stdout, "TRUSTED_TEST_TEMP_BASE");
    const worker = marker(result.stdout, "STORE_PROBE");
    assert.equal(isPathWithin(fixtureRuntime, trustedBase), false);
    assert.equal(isPathWithin(trustedBase, suiteRoot), true);
    assert.equal(isPathWithin(suiteRoot, path.dirname(worker.sqlitePath)), true);
    assert.deepEqual(protectedFingerprint(fixtureRuntime), before);
  });
}

test("direct node --test rejects an explicit cross-suite DATA_DIR without TEST_DATA_ROOT", async (t) => {
  const otherSuiteData = await temporaryDirectory(t, "trading-agent-other-suite-");
  createProtectedFixture(otherSuiteData);
  const before = protectedFingerprint(otherSuiteData);
  const probe = await createStoreProbe(t, { load: true });
  const env = childEnvironment({ DATA_DIR: otherSuiteData });
  delete env.TEST_DATA_ROOT;
  delete env.TEST_STORAGE_TMP_ROOT;

  const result = await runNode(["--test", probe], { env });

  assert.notEqual(result.status, 0, "direct test must not trust another suite's DATA_DIR");
  assert.match(`${result.stdout}\n${result.stderr}`, /test_data_dir_requires_test_data_root/);
  assert.deepEqual(protectedFingerprint(otherSuiteData), before);
});

test("direct node --test rejects an arbitrary existing temp DATA_DIR without TEST_DATA_ROOT", async (t) => {
  const arbitraryData = await temporaryDirectory(t, "trading-agent-arbitrary-temp-");
  const canary = path.join(arbitraryData, "arbitrary.sentinel");
  await fsp.writeFile(canary, "caller-owned\n");
  const probe = await createStoreProbe(t, { load: true });
  const env = childEnvironment({ DATA_DIR: arbitraryData });
  delete env.TEST_DATA_ROOT;
  delete env.TEST_STORAGE_TMP_ROOT;

  const result = await runNode(["--test", probe], { env });

  assert.notEqual(result.status, 0, "direct test must not trust an arbitrary temp DATA_DIR");
  assert.match(`${result.stdout}\n${result.stderr}`, /test_data_dir_requires_test_data_root/);
  assert.equal(await fsp.readFile(canary, "utf8"), "caller-owned\n");
  assert.equal(fs.existsSync(path.join(arbitraryData, "trading-agent.sqlite")), false);
});

test("test context rejects a simulated primary-worktree DATA_DIR outside its approved root", async (t) => {
  const { sandbox, probe } = await createSandboxProject(t);
  const approvedRoot = await temporaryDirectory(t, "trading-agent-approved-root-");
  const simulatedPrimaryData = await temporaryDirectory(t, "trading-agent-primary-runtime-");
  createProtectedFixture(simulatedPrimaryData);
  const before = protectedFingerprint(simulatedPrimaryData);

  const result = await runNode(["--test", probe], {
    cwd: sandbox,
    env: childEnvironment({
      TEST_DATA_ROOT: approvedRoot,
      DATA_DIR: simulatedPrimaryData
    })
  });

  assert.notEqual(result.status, 0, "test process must fail closed outside TEST_DATA_ROOT");
  assert.match(`${result.stdout}\n${result.stderr}`, /test_data_dir_outside_approved_root/);
  assert.deepEqual(protectedFingerprint(simulatedPrimaryData), before);
});

test("a descendant process with TEST_DATA_ROOT cannot fall back to runtime storage", async (t) => {
  const { sandbox, protectedData } = await createSandboxProject(t);
  const testDataRoot = await temporaryDirectory(t, "trading-agent-descendant-root-");
  const before = protectedFingerprint(protectedData);
  const sandboxStoreUrl = pathToFileURL(path.join(sandbox, "server", "store.mjs")).href;

  const result = await runNode(["--input-type=module", "--eval", `
    import { getStorageInfo } from ${JSON.stringify(sandboxStoreUrl)};
    console.log("DESCENDANT_STORAGE=" + JSON.stringify(getStorageInfo()));
  `], {
    cwd: sandbox,
    env: childEnvironment({ TEST_DATA_ROOT: testDataRoot })
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const storage = marker(result.stdout, "DESCENDANT_STORAGE");
  assert.equal(storage.sqlitePath.startsWith(`${testDataRoot}${path.sep}`), true);
  assert.notEqual(path.dirname(storage.sqlitePath), protectedData);
  assert.deepEqual(protectedFingerprint(protectedData), before);
});

test("an auto-isolated descendant receives a different SQLite database from its parent", async (t) => {
  const testDataRoot = await temporaryDirectory(t, "trading-agent-descendant-separation-");
  const scripts = await temporaryDirectory(t, "trading-agent-descendant-scripts-");
  const childScript = path.join(scripts, "child.mjs");
  const parentScript = path.join(scripts, "parent.mjs");

  await fsp.writeFile(childScript, `
    import { getStorageInfo, loadDb, saveDb } from ${JSON.stringify(storeUrl)};
    const state = loadDb();
    const sawParentMarker = state.meta.storageIsolationMarker || null;
    state.meta.storageIsolationMarker = "child";
    saveDb(state);
    console.log("CHILD_RESULT=" + JSON.stringify({
      sqlitePath: getStorageInfo().sqlitePath,
      sawParentMarker
    }));
  `);
  await fsp.writeFile(parentScript, `
    import { spawnSync } from "node:child_process";
    import { getStorageInfo, loadDb, saveDb } from ${JSON.stringify(storeUrl)};
    const state = loadDb();
    state.meta.storageIsolationMarker = "parent";
    saveDb(state);
    const child = spawnSync(process.execPath, [${JSON.stringify(childScript)}], {
      cwd: ${JSON.stringify(repositoryRoot)},
      env: process.env,
      encoding: "utf8"
    });
    if (child.status !== 0) {
      process.stderr.write(child.stderr || child.stdout);
      process.exit(child.status || 1);
    }
    const childLine = child.stdout.split(/\\r?\\n/).find((line) => line.startsWith("CHILD_RESULT="));
    console.log("PARENT_CHILD=" + JSON.stringify({
      parentPath: getStorageInfo().sqlitePath,
      child: JSON.parse(childLine.slice("CHILD_RESULT=".length))
    }));
  `);

  const result = await runNode([parentScript], {
    env: childEnvironment({ TEST_DATA_ROOT: testDataRoot })
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const storage = marker(result.stdout, "PARENT_CHILD");
  assert.notEqual(storage.parentPath, storage.child.sqlitePath);
  assert.equal(storage.parentPath.startsWith(`${testDataRoot}${path.sep}`), true);
  assert.equal(storage.child.sqlitePath.startsWith(`${testDataRoot}${path.sep}`), true);
  assert.equal(storage.child.sawParentMarker, null);
});

test("a descendant can share a test SQLite only through an explicit DATA_DIR", async (t) => {
  const sharedDataDir = await temporaryDirectory(t, "trading-agent-explicit-shared-");
  const scripts = await temporaryDirectory(t, "trading-agent-shared-scripts-");
  const childScript = path.join(scripts, "child.mjs");
  const parentScript = path.join(scripts, "parent.mjs");

  await fsp.writeFile(childScript, `
    import { getStorageInfo, loadDb } from ${JSON.stringify(storeUrl)};
    const state = loadDb();
    console.log("CHILD_RESULT=" + JSON.stringify({
      sqlitePath: getStorageInfo().sqlitePath,
      marker: state.meta.storageIsolationMarker || null
    }));
  `);
  await fsp.writeFile(parentScript, `
    import { spawnSync } from "node:child_process";
    import { loadDb, saveDb } from ${JSON.stringify(storeUrl)};
    const state = loadDb();
    state.meta.storageIsolationMarker = "explicit-parent";
    saveDb(state);
    const child = spawnSync(process.execPath, [${JSON.stringify(childScript)}], {
      cwd: ${JSON.stringify(repositoryRoot)},
      env: { ...process.env, DATA_DIR: ${JSON.stringify(sharedDataDir)} },
      encoding: "utf8"
    });
    process.stdout.write(child.stdout);
    process.stderr.write(child.stderr);
    process.exitCode = child.status || 0;
  `);

  const result = await runNode([parentScript], {
    env: childEnvironment({ DATA_DIR: sharedDataDir })
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(marker(result.stdout, "CHILD_RESULT"), {
    sqlitePath: path.join(sharedDataDir, "trading-agent.sqlite"),
    marker: "explicit-parent"
  });
});

test("auto worker cleanup refuses a replaced directory identity", async (t) => {
  const testDataRoot = await temporaryDirectory(t, "trading-agent-worker-cleanup-");
  const result = await runNode(["--input-type=module", "--eval", `
    import fs from "node:fs";
    import path from "node:path";
    import { getStorageInfo } from ${JSON.stringify(storeUrl)};
    const owned = path.dirname(getStorageInfo().sqlitePath);
    const replacement = fs.mkdtempSync(path.join(${JSON.stringify(testDataRoot)}, "replacement-"));
    fs.writeFileSync(path.join(replacement, "replacement.sentinel"), "replacement-owned\\n");
    fs.rmSync(owned, { recursive: true, force: true });
    fs.renameSync(replacement, owned);
    console.log("REPLACED_WORKER_ROOT=" + JSON.stringify(owned));
  `], {
    env: childEnvironment({ TEST_DATA_ROOT: testDataRoot })
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const replacedRoot = marker(result.stdout, "REPLACED_WORKER_ROOT");
  t.after(async () => fsp.rm(replacedRoot, { recursive: true, force: true }));
  assert.equal(fs.existsSync(path.join(replacedRoot, "replacement.sentinel")), true);
  assert.equal(fs.readFileSync(path.join(replacedRoot, "replacement.sentinel"), "utf8"), "replacement-owned\n");
});

test("resetOperationalData on a detached seed changes only the passed state", async (t) => {
  const protectedRoot = await temporaryDirectory(t, "trading-agent-reset-protected-");
  createProtectedFixture(protectedRoot);
  const before = protectedFingerprint(protectedRoot);

  const result = await runDetachedReset(protectedRoot);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(marker(result.stdout, "RESET_STATE"), {
    mediumTermSamples: 0,
    auditCount: 1,
    auditTarget: "system.reset"
  });
  const after = protectedFingerprint(protectedRoot);
  assert.equal(after.mediumTermSamples, before.mediumTermSamples);
  assert.equal(after.auditCount, before.auditCount);
  assert.equal(after.auditHead, before.auditHead);
});

test("protected database fingerprint, audit head and medium-term rows survive detached reset", async (t) => {
  const protectedRoot = await temporaryDirectory(t, "trading-agent-reset-fingerprint-");
  createProtectedFixture(protectedRoot);
  const before = protectedFingerprint(protectedRoot);

  const result = await runDetachedReset(protectedRoot);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(protectedFingerprint(protectedRoot), before);
});

test("a bound temporary database can still seed and reset normally", async (t) => {
  const dataDirectory = await temporaryDirectory(t, "trading-agent-bound-reset-");
  const initialize = await runNode(["--input-type=module", "--eval", `
    import { loadDb } from ${JSON.stringify(storeUrl)};
    const state = loadDb();
    console.log("INITIALIZED=" + JSON.stringify({ user: state.user?.id || null }));
  `], { env: childEnvironment({ DATA_DIR: dataDirectory }) });
  assert.equal(initialize.status, 0, initialize.stderr || initialize.stdout);

  const databasePath = path.join(dataDirectory, "trading-agent.sqlite");
  const database = new Database(databasePath);
  database.prepare(`
    insert into medium_term_samples (symbol, bucket_at, observed_at, doc)
    values (?, ?, ?, ?)
  `).run("BTC/USDT", Date.now(), new Date().toISOString(), JSON.stringify({ symbol: "BTC/USDT", bucketAt: Date.now() }));
  database.close();

  const reset = await runNode(["--input-type=module", "--eval", `
    import { getStorageInfo, loadDb, resetOperationalData, saveDb } from ${JSON.stringify(storeUrl)};
    const state = loadDb();
    resetOperationalData(state, { actor: "Test" });
    saveDb(state);
    console.log("BOUND_RESET=" + JSON.stringify({
      mediumTermSamples: state.mediumTermSamples.length,
      auditTarget: state.auditLogs[0]?.target || null,
      sqlitePath: getStorageInfo().sqlitePath
    }));
  `], { env: childEnvironment({ DATA_DIR: dataDirectory }) });

  assert.equal(reset.status, 0, reset.stderr || reset.stdout);
  assert.deepEqual(marker(reset.stdout, "BOUND_RESET"), {
    mediumTermSamples: 0,
    auditTarget: "system.reset",
    sqlitePath: databasePath
  });
  const verification = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    assert.equal(verification.prepare("select count(*) as count from medium_term_samples").get().count, 0);
    assert.equal(verification.prepare("select count(*) as count from audit_log_entries where target = 'system.reset'").get().count, 1);
  } finally {
    verification.close();
  }
});

test("two independent test workers receive different SQLite directories", async (t) => {
  const { sandbox, protectedData, probe } = await createSandboxProject(t);
  const testDataRoot = await temporaryDirectory(t, "trading-agent-parallel-root-");
  const env = childEnvironment({ TEST_DATA_ROOT: testDataRoot });

  const [first, second] = await Promise.all([
    runNode(["--test", probe], { cwd: sandbox, env }),
    runNode(["--test", probe], { cwd: sandbox, env })
  ]);

  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  const firstStorage = marker(first.stdout, "TEST_STORAGE_INFO");
  const secondStorage = marker(second.stdout, "TEST_STORAGE_INFO");
  assert.notEqual(firstStorage.sqlitePath, secondStorage.sqlitePath);
  assert.equal(firstStorage.sqlitePath.startsWith(`${testDataRoot}${path.sep}`), true);
  assert.equal(secondStorage.sqlitePath.startsWith(`${testDataRoot}${path.sep}`), true);
  assert.notEqual(path.dirname(firstStorage.sqlitePath), protectedData);
  assert.notEqual(path.dirname(secondStorage.sqlitePath), protectedData);
});

test("isolated test runner prints its protected and temporary data roots", async (t) => {
  const probeRoot = await temporaryDirectory(t, "trading-agent-runner-probe-");
  const probe = path.join(probeRoot, "runner-probe.test.mjs");
  await fsp.writeFile(probe, `
    import assert from "node:assert/strict";
    import test from "node:test";
    import { getStorageInfo } from ${JSON.stringify(storeUrl)};
    test("uses an isolated worker database", () => {
      const storage = getStorageInfo();
      assert.notEqual(storage.sqlitePath, ${JSON.stringify(path.join(runtimeDataDir, "trading-agent.sqlite"))});
      console.log("RUNNER_WORKER_STORAGE=" + JSON.stringify(storage));
    });
  `);

  const result = await runNode([path.join(repositoryRoot, "scripts", "run-tests-isolated.mjs"), probe], {
    env: childEnvironment()
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /TRUSTED_TEST_TEMP_BASE=/);
  assert.match(result.stdout, /PROTECTED_RUNTIME_DATA_DIR=/);
  assert.match(result.stdout, /ISOLATED_TEST_DATA_ROOT=/);
  const trustedBase = rawMarker(result.stdout, "TRUSTED_TEST_TEMP_BASE");
  const isolatedRoot = rawMarker(result.stdout, "ISOLATED_TEST_DATA_ROOT");
  assert.equal(isPathWithin(trustedBase, isolatedRoot), true);
  assert.equal(rawMarker(result.stdout, "ISOLATED_TEST_DATA_ROOT_CLEANED"), isolatedRoot);
  assert.equal(fs.existsSync(isolatedRoot), false);
  const storage = marker(result.stdout, "RUNNER_WORKER_STORAGE");
  assert.notEqual(path.dirname(storage.sqlitePath), runtimeDataDir);
});

test("runner cleanup refuses a suite-root symlink without deleting the sibling suite", async (t) => {
  const probeRoot = await temporaryDirectory(t, "trading-agent-cleanup-probe-");
  const probe = path.join(probeRoot, "cleanup-probe.test.mjs");
  await fsp.writeFile(probe, `
    import fs from "node:fs";
    import os from "node:os";
    import path from "node:path";
    import test from "node:test";
    test("replaces its suite root with a sibling symlink", () => {
      const suiteRoot = process.env.TEST_DATA_ROOT;
      const sibling = fs.mkdtempSync(path.join(path.dirname(suiteRoot), "trading-agent-test-suite-"));
      const sentinel = path.join(sibling, "sibling.sentinel");
      fs.writeFileSync(sentinel, "sibling-owned\\n");
      fs.rmSync(suiteRoot, { recursive: true, force: true });
      fs.symlinkSync(sibling, suiteRoot, "dir");
      console.log("REPLACED_SUITE_ROOT=" + JSON.stringify(suiteRoot));
      console.log("SIBLING_SUITE_ROOT=" + JSON.stringify(sibling));
    });
  `);

  const result = await runNode([path.join(repositoryRoot, "scripts", "run-tests-isolated.mjs"), probe], {
    env: childEnvironment()
  });
  const suiteRoot = marker(result.stdout, "REPLACED_SUITE_ROOT");
  const siblingRoot = marker(result.stdout, "SIBLING_SUITE_ROOT");
  t.after(async () => {
    try {
      if ((await fsp.lstat(suiteRoot)).isSymbolicLink()) await fsp.unlink(suiteRoot);
    } catch { /* runner may already have removed the path */ }
    await fsp.rm(siblingRoot, { recursive: true, force: true });
  });

  assert.notEqual(result.status, 0, "runner must report an ownership mismatch");
  assert.match(`${result.stdout}\n${result.stderr}`, /refusing to clean non-owned test root/);
  assert.equal(fs.existsSync(path.join(siblingRoot, "sibling.sentinel")), true);
  assert.equal(fs.readFileSync(path.join(siblingRoot, "sibling.sentinel"), "utf8"), "sibling-owned\n");
});
