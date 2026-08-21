import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deployScript = path.join(repositoryRoot, "deploy", "deploy.sh");

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
