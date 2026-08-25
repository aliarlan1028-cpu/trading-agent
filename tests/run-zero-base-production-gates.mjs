import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const deadline = Date.now() + 20_000;
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

async function runNode(script, extraEnv) {
  const child = spawn(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit"
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (exitCode !== 0) throw new Error(`${script} exited with code ${exitCode}`);
}

const trustedTempRoot = await realpath("/tmp");
const tempRoot = await mkdtemp(path.join(trustedTempRoot, "kordyn-zero-production-gates-"));
const apiPort = await freePort();
const vitePort = await freePort();
const apiUrl = `http://127.0.0.1:${apiPort}`;
const appUrl = `http://127.0.0.1:${vitePort}/`;
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
      SECRETS_MASTER_KEY: ""
    },
    stdio: "inherit"
  });
  vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(vitePort)], {
    cwd: root,
    env: { ...process.env, VITE_API_PROXY_TARGET: apiUrl },
    stdio: "inherit"
  });

  await waitFor(appUrl);
  await runNode("tests/run-production-shell-selection-browser.mjs", { KORDYN_APP_URL: appUrl });
  await runNode("tests/run-event-risk-production-visual.mjs", {
    KORDYN_VISUAL_BASE_URL: appUrl,
    KORDYN_VISUAL_OUTPUT_DIR: path.join(tempRoot, "event-risk")
  });
  console.log(`zero-base production gates PASS ${appUrl}`);
} finally {
  await stopProcess(vite);
  await stopProcess(backend);
  await rm(tempRoot, { recursive: true, force: true });
}
