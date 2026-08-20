import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const protectedRuntimeDataDir = path.join(repositoryRoot, "data");

function trustedTestTempBase() {
  if (!new Set(["darwin", "linux"]).has(process.platform)) {
    throw new Error("unsupported_test_storage_platform");
  }
  const root = fs.realpathSync.native("/tmp");
  const identity = fs.lstatSync(root);
  if (!identity.isDirectory() || identity.isSymbolicLink()) {
    throw new Error("trusted_test_temp_base_invalid");
  }
  fs.accessSync(root, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
  return root;
}

const temporaryRoot = trustedTestTempBase();
const testDataRoot = fs.mkdtempSync(path.join(temporaryRoot, "trading-agent-test-suite-"));
const ownerToken = crypto.randomUUID();
const ownerMarker = path.join(testDataRoot, ".test-storage-owner");
fs.writeFileSync(ownerMarker, ownerToken, { encoding: "utf8", flag: "wx", mode: 0o600 });
const ownerIdentity = fs.lstatSync(testDataRoot);

function cleanupOwnedRoot() {
  const relative = path.relative(temporaryRoot, testDataRoot);
  const owned = relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
    && path.basename(testDataRoot).startsWith("trading-agent-test-suite-");
  if (!owned) throw new Error(`refusing to clean non-owned test root: ${testDataRoot}`);
  if (!fs.existsSync(testDataRoot)) return;
  const currentIdentity = fs.lstatSync(testDataRoot);
  const identityMatches = currentIdentity.isDirectory() && !currentIdentity.isSymbolicLink()
    && currentIdentity.dev === ownerIdentity.dev && currentIdentity.ino === ownerIdentity.ino;
  const markerMatches = identityMatches
    && fs.existsSync(ownerMarker)
    && !fs.lstatSync(ownerMarker).isSymbolicLink()
    && fs.readFileSync(ownerMarker, "utf8") === ownerToken;
  if (!markerMatches) throw new Error(`refusing to clean non-owned test root: ${testDataRoot}`);
  fs.rmSync(testDataRoot, { recursive: true, force: true });
}

const requested = process.argv.slice(2);
const testArguments = requested.length
  ? requested
  : fs.readdirSync(path.join(repositoryRoot, "tests"))
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => path.join("tests", name));

const env = {
  ...process.env,
  TEST_DATA_ROOT: testDataRoot,
  TMPDIR: testDataRoot,
  TMP: testDataRoot,
  TEMP: testDataRoot
};
delete env.DATA_DIR;
delete env.NODE_TEST_CONTEXT;
delete env.TEST_STORAGE_TMP_ROOT;

console.log(`TRUSTED_TEST_TEMP_BASE=${temporaryRoot}`);
console.log(`PROTECTED_RUNTIME_DATA_DIR=${protectedRuntimeDataDir}`);
console.log(`ISOLATED_TEST_DATA_ROOT=${testDataRoot}`);

const child = spawn(process.execPath, ["--test", ...testArguments], {
  cwd: repositoryRoot,
  env,
  stdio: "inherit"
});

const signalHandlers = new Map();
for (const signal of ["SIGINT", "SIGTERM"]) {
  const handler = () => child.kill(signal);
  signalHandlers.set(signal, handler);
  process.once(signal, handler);
}

child.once("error", (error) => {
  console.error(error);
  try { cleanupOwnedRoot(); } catch (cleanupError) { console.error(cleanupError); }
  process.exitCode = 1;
});

child.once("close", (status, signal) => {
  for (const [name, handler] of signalHandlers) process.removeListener(name, handler);
  try {
    cleanupOwnedRoot();
    console.log(`ISOLATED_TEST_DATA_ROOT_CLEANED=${testDataRoot}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
    return;
  }
  process.exitCode = signal ? 1 : (status ?? 1);
});
