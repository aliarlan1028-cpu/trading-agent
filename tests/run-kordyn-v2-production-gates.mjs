import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const releaseIdentity = "plan06-production-gate";

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(url) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, delay(2_000)]);
  if (child.exitCode === null && !child.signalCode) {
    child.kill("SIGKILL");
    await exited;
  }
}

async function runBrowser({ appUrl, version, phase, resultPath }) {
  const child = spawn(process.execPath, ["tests/run-kordyn-v2-production-browser.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      KORDYN_PRODUCTION_APP_URL: appUrl,
      KORDYN_UI_VERSION: version,
      KORDYN_ROLLBACK_PHASE: phase,
      KORDYN_PRODUCTION_RESULT_PATH: resultPath,
      KORDYN_EXPECTED_RELEASE: releaseIdentity
    },
    stdio: "inherit"
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (exitCode !== 0) throw new Error(`production browser ${version} exited with code ${exitCode}`);
  return JSON.parse(await readFile(resultPath, "utf8"));
}

async function startVite({ apiUrl, port, version }) {
  const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: root,
    env: {
      ...process.env,
      VITE_API_PROXY_TARGET: apiUrl,
      VITE_KORDYN_UI_VERSION: version,
      VITE_ALLOW_KORDYN_V2_PREVIEW: "false"
    },
    stdio: "inherit"
  });
  const appUrl = `http://127.0.0.1:${port}/`;
  try {
    await waitFor(appUrl);
    return { child, appUrl };
  } catch (error) {
    await stopProcess(child);
    throw error;
  }
}

const trustedTempRoot = await realpath("/tmp");
const tempRoot = await mkdtemp(path.join(trustedTempRoot, "kordyn-v2-production-gates-"));
const apiPort = await freePort();
const apiUrl = `http://127.0.0.1:${apiPort}`;
let backend;
let vite;

try {
  backend = spawn(process.execPath, ["server/index.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(apiPort),
      HOST: "127.0.0.1",
      NODE_ENV: "test",
      NODE_TEST_CONTEXT: "1",
      TEST_DATA_ROOT: path.join(tempRoot, "data"),
      AUTH_REQUIRED: "false",
      ADMIN_PASSWORD: "",
      SECRETS_MASTER_KEY: "",
      APP_RELEASE: releaseIdentity
    },
    stdio: "inherit"
  });
  await waitFor(`${apiUrl}/api/health`);

  const v2Port = await freePort();
  const v2Server = await startVite({ apiUrl, port: v2Port, version: "v2" });
  vite = v2Server.child;
  const v2 = await runBrowser({
    appUrl: v2Server.appUrl,
    version: "v2",
    phase: "write",
    resultPath: path.join(tempRoot, "v2.json")
  });
  await stopProcess(vite);
  vite = null;

  const legacyPort = await freePort();
  const legacyServer = await startVite({ apiUrl, port: legacyPort, version: "legacy" });
  vite = legacyServer.child;
  const legacy = await runBrowser({
    appUrl: legacyServer.appUrl,
    version: "legacy",
    phase: "verify",
    resultPath: path.join(tempRoot, "legacy.json")
  });

  assert.deepEqual(legacy.backendIdentity, v2.backendIdentity, "rollback uses the same backend identity and user");
  assert.equal(legacy.publicFingerprint, v2.publicFingerprint, "public surface data is presentation-independent");
  assert.equal(legacy.authFingerprint, v2.authFingerprint, "authentication failure semantics are presentation-independent");
  assert.deepEqual(v2.boundaries, { invalidStatus: 400, forbiddenStatus: 403 }, "V2 preserves failure and forbidden boundaries");
  assert.deepEqual(legacy.boundaries, v2.boundaries, "legacy rollback preserves the same boundaries");
  assert.equal(v2.marker.present, true, "V2 write marker is authoritative");
  assert.equal(legacy.marker.present, true, "legacy rollback reads the V2 marker from the same backend");
  assert.equal(v2.visited.length, 23, "all 23 V2 workspaces were reached through trusted production-shell navigation");
  assert.equal(legacy.visited.length, 6, "legacy rollback shell reaches representative product families");
  assert.equal(legacy.mobileVisited.length, 5, "legacy rollback APP reaches AI, Trade, Lab, Control, and Operations through real drawer clicks");
  assert.equal(legacy.objectSearch?.destination, "researchCenter", "legacy rollback preserves the real object and feature switcher");
  assert.ok(legacy.objectSearch?.availableResults > 0, "legacy rollback search exposes available production-shaped results");
  assert.ok(v2.styles.v2Count > 0, "V2 includes its authenticated product CSS");
  assert.equal(v2.styles.legacyCount, 0, "V2 excludes legacy product CSS");
  assert.ok(legacy.styles.legacyCount > 0, "legacy includes its authenticated product CSS");
  assert.equal(legacy.styles.v2Count, 0, "legacy excludes V2 CSS");

  console.log(`kordyn-v2 production gates PASS ${JSON.stringify({
    backendIdentity: v2.backendIdentity,
    v2Workspaces: v2.visited.length,
    legacyFamilies: legacy.visited.length,
    legacyMobileFamilies: legacy.mobileVisited.length,
    legacyObjectSearch: legacy.objectSearch,
    marker: legacy.marker.symbol,
    boundaries: v2.boundaries,
    css: { v2: v2.styles, legacy: legacy.styles },
    publicFingerprint: v2.publicFingerprint,
    authFingerprint: v2.authFingerprint,
    cleanupRoot: tempRoot
  })}`);
} finally {
  await stopProcess(vite);
  await stopProcess(backend);
  await rm(tempRoot, { recursive: true, force: true });
}
