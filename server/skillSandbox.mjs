import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import simpleGit from "simple-git";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";
import { assertSafeGitHubRepositoryUrl, fetchExternalText } from "./externalInputSafety.mjs";
import { containsLikelySecret } from "./secretRedaction.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const skillsDir = path.join(rootDir, "data", "skills");
const SANDBOX_ALLOWED_COMMANDS = new Set(["sh", "node", "python3"]);
const SANDBOX_TIMEOUT_MS = 30_000;
const SANDBOX_OUTPUT_BYTES = 1024 * 1024;
const SANDBOX_MAX_CONCURRENCY = 2;
let activeSandboxRuns = 0;

export async function fetchSkillPackage(db, payload = {}) {
  await fs.mkdir(skillsDir, { recursive: true });
  const skillId = id("skill");
  const target = path.join(skillsDir, skillId);
  try {
    if (payload.sourceUrl?.includes("github.com")) {
      await assertSafeGitHubRepositoryUrl(payload.sourceUrl);
      await simpleGit().clone(payload.sourceUrl, target, ["--depth", "1"]);
    } else {
      await fs.mkdir(target, { recursive: true });
      let skillMd = payload.skillMd;
      if (!skillMd && payload.sourceUrl) {
        const { response, text } = await fetchExternalText(payload.sourceUrl, { maxBytes: 1024 * 1024, timeoutMs: 15_000 });
        if (!response.ok) throw new Error(`Skill URL fetch failed ${response.status}`);
        skillMd = text;
      }
      await fs.writeFile(path.join(target, "SKILL.md"), skillMd || "# Imported Skill\n\nNo instructions.", { encoding: "utf8", mode: 0o600 });
    }
    await validateSkillPackageTree(target);
  } catch (error) {
    await fs.rm(target, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  const manifest = await readSkillManifest(target);
  const skill = {
    id: skillId,
    name: payload.name || manifest.name || path.basename(payload.sourceUrl || skillId),
    // kind:决定落到策略库还是能力库——用户显式选择 payload.kind 最高优先,否则 manifest 判定,默认工具。
    kind: payload.kind === "strategy" ? "strategy"
      : payload.kind === "tool" ? "tool"
      : manifest.kind === "strategy" ? "strategy" : "tool",
    source: payload.sourceUrl || "uploaded",
    version: manifest.version || "0.1.0",
    format: manifest.format || "codex",
    entryFile: manifest.entryFile || "SKILL.md",
    clawhub: manifest.clawhub || null,
    status: "已拉取",
    scan: "未扫描",
    permissions: manifest.permissions || ["web.read"],
    localPath: target,
    fetchedAt: nowIso()
  };
  db.skills.unshift(skill);
  appendAudit(db, "拉取 Skill 包", skill.id, "SkillSandbox");
  return skill;
}

export async function runSkillSandbox(db, skillId, args = {}) {
  const skill = db.skills.find((item) => item.id === skillId);
  if (!skill) return { status: "missing_skill" };
  if (!skill.localPath) {
    const run = { id: id("skillrun"), skillId, status: "missing_local_package", output: "Skill has no fetched localPath. Fetch or upload the package before sandbox execution.", createdAt: nowIso() };
    db.skillRuns.unshift(run);
    appendAudit(db, "沙箱运行 Skill 缺少本地包", run.id, "SkillSandbox", "warning");
    return run;
  }
  const command = args.command || "sh";
  const commandArgs = args.commandArgs || ["-lc", "ls -la && test -f SKILL.md && sed -n '1,80p' SKILL.md"];
  const result = await runInContainer(skill.localPath, command, commandArgs);
  const runStatus = result.busy ? "busy"
    : result.timedOut ? "timeout"
    : result.outputLimited ? "output_limit"
    : result.code === 0 ? "ok" : "failed";
  const run = { id: id("skillrun"), skillId, status: runStatus, output: result.output.slice(0, 4000), createdAt: nowIso() };
  db.skillRuns.unshift(run);
  appendAudit(db, "沙箱运行 Skill", run.id, "SkillSandbox", run.status === "ok" ? "info" : "warning");
  appendTrace(db, "skill_sandbox", skill.name, run.status);
  return run;
}

async function assertContainedRegularFile(root, candidate) {
  const rootReal = await fs.realpath(root);
  const stat = await fs.lstat(candidate);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw new Error("Skill package contains a linked or non-regular entry file");
  const real = await fs.realpath(candidate);
  if (real !== rootReal && !real.startsWith(`${rootReal}${path.sep}`)) throw new Error("Skill entry escapes package root");
  return real;
}

export async function validateSkillPackageTree(root) {
  const rootReal = await fs.realpath(root);
  let fileCount = 0;
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      const stat = await fs.lstat(full);
      if (stat.isSymbolicLink()) throw new Error(`Skill package rejects links: ${path.relative(rootReal, full)}`);
      if (stat.isDirectory()) {
        const real = await fs.realpath(full);
        if (!real.startsWith(`${rootReal}${path.sep}`)) throw new Error("Skill directory escapes package root");
        await walk(full);
      } else if (stat.isFile()) {
        if (stat.nlink > 1) throw new Error(`Skill package rejects hard links: ${path.relative(rootReal, full)}`);
        fileCount += 1;
      } else {
        throw new Error(`Skill package rejects special files: ${path.relative(rootReal, full)}`);
      }
    }
  }
  await walk(rootReal);
  if (!fileCount) throw new Error("Skill package contains no regular files");
  return { rootReal, fileCount };
}

async function readSkillManifest(dir) {
  try {
    const entryPath = await findSkillEntry(dir);
    const safeEntry = await assertContainedRegularFile(dir, entryPath);
    const text = await fs.readFile(safeEntry, "utf8");
    const origin = await readJsonIfExists(path.join(path.dirname(entryPath), ".clawhub", "origin.json"));
    const lock = await readJsonIfExists(path.join(path.dirname(entryPath), ".clawhub", "lock.json"));
    const name = text.match(/^#\s+(.+)$/m)?.[1];
    const version = text.match(/version:\s*([^\s]+)/i)?.[1] || lock?.version || origin?.version;
    const permissions = [...text.matchAll(/permission[s]?:\s*([a-z0-9_., -]+)/gi)]
      .flatMap((match) => match[1].split(/[,\s]+/).filter(Boolean));
    // kind:显式声明优先(front-matter `kind: strategy|tool`),否则按正文判定——
    // 会输出交易主张(方向/入场/止损)的归策略库,否则归能力库(工具)。
    const declaredKind = (text.match(/^\s*kind:\s*(strategy|tool|策略|工具)/im)?.[1] || origin?.kind || "").toLowerCase();
    const looksStrategy = /入场|进场|止损|止盈|做多|做空|\bentry\b|\bstop\s?loss\b|\btake\s?profit\b|\blong\b|\bshort\b|策略信号/i.test(text);
    const kind = declaredKind === "strategy" || declaredKind === "策略" ? "strategy"
      : declaredKind === "tool" || declaredKind === "工具" ? "tool"
      : looksStrategy ? "strategy" : "tool";
    return {
      name: origin?.name || name,
      version,
      kind,
      permissions: permissions.length ? permissions : origin?.permissions,
      format: origin || lock || /clawhub/i.test(text) ? "clawhub" : "codex",
      entryFile: path.relative(dir, entryPath),
      clawhub: origin || lock ? { origin, lock } : null
    };
  } catch {
    return {};
  }
}

async function readJsonIfExists(filePath) {
  try {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) return null;
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function findSkillEntry(dir, depth = 0) {
  const names = ["SKILL.md", "skill.md", "skills.md"];
  for (const name of names) {
    const filePath = path.join(dir, name);
    try {
      const stat = await fs.lstat(filePath);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink > 1) throw new Error("Skill entry must be an unlinked regular file");
      return filePath;
    } catch {}
  }
  if (depth >= 3) throw new Error("Skill entry file not found");
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
    try {
      return await findSkillEntry(path.join(dir, entry.name), depth + 1);
    } catch {}
  }
  throw new Error("Skill entry file not found");
}

export function runInContainer(workdir, command, commandArgs, options = {}) {
  if (!SANDBOX_ALLOWED_COMMANDS.has(String(command || ""))) {
    return Promise.resolve({ code: 126, output: "Sandbox command is not allowed", rejected: true });
  }
  if (!Array.isArray(commandArgs) || commandArgs.length > 32 || commandArgs.some((arg) => typeof arg !== "string" || arg.length > 4096)) {
    return Promise.resolve({ code: 126, output: "Sandbox command arguments are invalid", rejected: true });
  }
  const maxConcurrency = Number(options.maxConcurrency || SANDBOX_MAX_CONCURRENCY);
  if (activeSandboxRuns >= maxConcurrency) {
    return Promise.resolve({ code: 75, output: "Sandbox concurrency limit reached", busy: true });
  }
  activeSandboxRuns += 1;
  return new Promise((resolve) => {
    const image = process.env.SKILL_SANDBOX_IMAGE || "node:20-alpine";
    const dockerArgs = [
      "run", "--rm", "--network=none", "--read-only", "--cap-drop=ALL",
      "--security-opt=no-new-privileges", "--pids-limit=64", "--memory=256m", "--cpus=0.5",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=32m",
      "-v", `${workdir}:/skill:ro`, "-w", "/skill", image, command, ...commandArgs
    ];
    const spawnImpl = options.spawnImpl || spawn;
    const child = spawnImpl("docker", dockerArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;
    let outputLimited = false;
    const timeoutMs = Number(options.timeoutMs || SANDBOX_TIMEOUT_MS);
    const maxOutputBytes = Number(options.maxOutputBytes || SANDBOX_OUTPUT_BYTES);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeSandboxRuns = Math.max(0, activeSandboxRuns - 1);
      resolve({ ...result, output, timedOut, outputLimited });
    };
    const stop = () => {
      try { child.kill("SIGKILL"); } catch {}
    };
    const append = (data) => {
      if (settled || outputLimited) return;
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
      const remaining = Math.max(0, maxOutputBytes - outputBytes);
      if (remaining) output += chunk.subarray(0, remaining).toString("utf8");
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        outputLimited = true;
        output += "\n[output truncated: sandbox output limit exceeded]";
        stop();
      }
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.once("error", (error) => finish({ code: 127, output: `${output}\nDocker sandbox unavailable: ${error.message}`.trim() }));
    child.once("close", (code) => finish({ code: timedOut ? 124 : outputLimited ? 137 : code }));
    const timer = setTimeout(() => {
      timedOut = true;
      output += "\n[sandbox terminated: wall-clock timeout exceeded]";
      stop();
      // Broken/mocked child processes are not allowed to hold the HTTP request forever.
      setTimeout(() => finish({ code: 124 }), 250).unref?.();
    }, timeoutMs);
    timer.unref?.();
  });
}

// 读取 skill 的 SKILL.md 方法论正文(供"信任后注入 AI 提示词"用,不依赖 Docker 沙箱)。
export async function readSkillInstructions(skill, maxChars = 4000) {
  if (!skill?.localPath) return "";
  try {
    await validateSkillPackageTree(skill.localPath);
  } catch {
    return "";
  }
  const candidate = skill.entryFile && skill.entryFile !== "native"
    ? path.join(skill.localPath, skill.entryFile)
    : path.join(skill.localPath, "SKILL.md");
  try {
    const safeCandidate = await assertContainedRegularFile(skill.localPath, candidate);
    const text = String(await fs.readFile(safeCandidate, "utf8")).slice(0, maxChars);
    if (containsLikelySecret(text)) throw new Error("Skill instructions contain secret material and cannot be trusted");
    return text;
  } catch {
    try {
      // The tree was already validated above. The fallback only locates a
      // differently named manifest; it must not turn a safety failure into a
      // successful read.
      const entry = await findSkillEntry(skill.localPath);
      const safeEntry = await assertContainedRegularFile(skill.localPath, entry);
      const text = String(await fs.readFile(safeEntry, "utf8")).slice(0, maxChars);
      if (containsLikelySecret(text)) throw new Error("Skill instructions contain secret material and cannot be trusted");
      return text;
    } catch {
      return "";
    }
  }
}
