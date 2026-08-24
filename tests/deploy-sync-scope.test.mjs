import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deployScript = path.join(repositoryRoot, "deploy", "deploy.sh");
const monitorScript = path.join(repositoryRoot, "deploy", "monitor-tenants.sh");

async function writeExecutable(file, contents) {
  await fsp.writeFile(file, contents, { mode: 0o700 });
}

async function runDryDeploy(t, { outputLines = 1 } = {}) {
  const sandbox = await fsp.mkdtemp(path.join(os.tmpdir(), "trading-agent-deploy-scope-"));
  t.after(() => fsp.rm(sandbox, { recursive: true, force: true }));
  const bin = path.join(sandbox, "bin");
  const argumentsFile = path.join(sandbox, "rsync-arguments.txt");
  await fsp.mkdir(bin);
  await writeExecutable(path.join(bin, "git"), `#!/bin/sh
case "$*" in
  *rev-parse*) printf '%s\\n' testrevision ;;
esac
exit 0
`);
  await writeExecutable(path.join(bin, "rsync"), `#!/bin/sh
printf '%s\\n' "$@" > "$RSYNC_ARGUMENTS_FILE"
i=0
while [ "$i" -lt "$RSYNC_OUTPUT_LINES" ]; do
  printf 'candidate-file-%s\\n' "$i"
  i=$((i + 1))
done
`);

  const result = await new Promise((resolve, reject) => {
    const child = spawn("bash", [deployScript, "--dry"], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        RSYNC_ARGUMENTS_FILE: argumentsFile,
        RSYNC_OUTPUT_LINES: String(outputLines)
      },
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
  const rsyncArguments = (await fsp.readFile(argumentsFile, "utf8")).trim().split("\n");
  return { ...result, rsyncArguments };
}

test("deployment dry-run excludes linked worktrees from the server sync boundary", async (t) => {
  const result = await runDryDeploy(t);

  assert.equal(result.status, 0, result.stderr);
  const excludedPaths = result.rsyncArguments.flatMap((argument, index, all) => (
    argument === "--exclude" ? [all[index + 1]] : []
  ));
  assert.ok(excludedPaths.includes(".worktrees"), `missing .worktrees exclusion: ${result.rsyncArguments.join(" ")}`);
});

test("deployment dry-run remains successful when rsync reports more than 50 files", async (t) => {
  const result = await runDryDeploy(t, { outputLines: 10_000 });

  assert.equal(result.status, 0, `signal=${result.signal}\n${result.stderr}`);
});

test("planned deployment owns the monitor silence lifecycle around container cutover", async () => {
  const source = await fsp.readFile(deployScript, "utf8");
  const mark = 'data/.monitor/.deploying';
  const markStart = source.indexOf(`touch "$REMOTE_DIR/${mark}"`);
  const cutover = source.indexOf('docker compose up -d </dev/null');
  const verifiedState = source.indexOf('main.state', cutover);
  const markEnd = source.indexOf(`rm -f "$REMOTE_DIR/${mark}"`, cutover);

  assert.ok(markStart >= 0, "deploy must create the monitor silence marker");
  assert.ok(markStart < cutover, "silence marker must exist before container cutover");
  assert.ok(verifiedState > cutover, "successful verification must normalize monitor state");
  assert.ok(markEnd > verifiedState, "silence marker must be removed only after monitor state is normalized");
});

test("a fresh deployment marker suppresses monitor network checks and notifications", async (t) => {
  const sandbox = await fsp.mkdtemp(path.join(os.tmpdir(), "trading-agent-monitor-silence-"));
  t.after(() => fsp.rm(sandbox, { recursive: true, force: true }));
  const state = path.join(sandbox, "state");
  const tenants = path.join(sandbox, "tenants");
  const bin = path.join(sandbox, "bin");
  const calls = path.join(sandbox, "calls.txt");
  await fsp.mkdir(state, { recursive: true });
  await fsp.mkdir(tenants, { recursive: true });
  await fsp.mkdir(bin, { recursive: true });
  await fsp.writeFile(path.join(state, ".deploying"), "planned\n");
  for (const command of ["curl", "docker"]) {
    await writeExecutable(path.join(bin, command), `#!/bin/sh\nprintf '%s\\n' '${command}' >> "$CALLS_FILE"\nexit 99\n`);
  }
  await writeExecutable(path.join(bin, "stat"), `#!/bin/sh
if [ "$1" = "-c" ] && [ "$2" = "%Y" ]; then
  /usr/bin/stat -f %m "$3"
else
  /usr/bin/stat "$@"
fi
`);

  const result = await new Promise((resolve, reject) => {
    const child = spawn("bash", [monitorScript], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        APP_DIR: sandbox,
        STATE_DIR: state,
        TENANTS_DIR: tenants,
        PATH: `${bin}:${process.env.PATH}`,
        CALLS_FILE: calls
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /部署静默中/);
  await assert.rejects(fsp.access(calls));
});
