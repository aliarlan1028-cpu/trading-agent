import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import simpleGit from "simple-git";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";
import { assertSafeExternalUrl, fetchExternalText } from "./externalInputSafety.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const skillsDir = path.join(rootDir, "data", "skills");

export async function fetchSkillPackage(db, payload = {}) {
  await fs.mkdir(skillsDir, { recursive: true });
  const skillId = id("skill");
  const target = path.join(skillsDir, skillId);
  if (payload.sourceUrl?.includes("github.com")) {
    await assertSafeExternalUrl(payload.sourceUrl);
    await simpleGit().clone(payload.sourceUrl, target, ["--depth", "1"]);
  } else {
    await fs.mkdir(target, { recursive: true });
    let skillMd = payload.skillMd;
    if (!skillMd && payload.sourceUrl) {
      const { response, text } = await fetchExternalText(payload.sourceUrl, { maxBytes: 1024 * 1024, timeoutMs: 15_000 });
      if (!response.ok) throw new Error(`Skill URL fetch failed ${response.status}`);
      skillMd = text;
    }
    await fs.writeFile(path.join(target, "SKILL.md"), skillMd || "# Imported Skill\n\nNo instructions.", "utf8");
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
  const run = { id: id("skillrun"), skillId, status: result.code === 0 ? "ok" : "failed", output: result.output.slice(0, 4000), createdAt: nowIso() };
  db.skillRuns.unshift(run);
  appendAudit(db, "沙箱运行 Skill", run.id, "SkillSandbox", run.status === "ok" ? "info" : "warning");
  appendTrace(db, "skill_sandbox", skill.name, run.status);
  return run;
}

async function readSkillManifest(dir) {
  try {
    const entryPath = await findSkillEntry(dir);
    const text = await fs.readFile(entryPath, "utf8");
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
      await fs.access(filePath);
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

function runInContainer(workdir, command, commandArgs) {
  return new Promise((resolve) => {
    const image = process.env.SKILL_SANDBOX_IMAGE || "node:20-alpine";
    const dockerArgs = [
      "run", "--rm", "--network=none", "--read-only", "--cap-drop=ALL",
      "--security-opt=no-new-privileges", "--pids-limit=64", "--memory=256m", "--cpus=0.5",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=32m",
      "-v", `${workdir}:/skill:ro`, "-w", "/skill", image, command, ...commandArgs
    ];
    const child = spawn("docker", dockerArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (data) => { output += data.toString(); });
    child.stderr.on("data", (data) => { output += data.toString(); });
    child.on("error", (error) => resolve({ code: 127, output: `Docker sandbox unavailable: ${error.message}` }));
    child.on("close", (code) => resolve({ code, output }));
  });
}

// 读取 skill 的 SKILL.md 方法论正文(供"信任后注入 AI 提示词"用,不依赖 Docker 沙箱)。
export async function readSkillInstructions(skill, maxChars = 4000) {
  if (!skill?.localPath) return "";
  const candidate = skill.entryFile && skill.entryFile !== "native"
    ? path.join(skill.localPath, skill.entryFile)
    : path.join(skill.localPath, "SKILL.md");
  try {
    return String(await fs.readFile(candidate, "utf8")).slice(0, maxChars);
  } catch {
    try {
      const entry = await findSkillEntry(skill.localPath);
      return String(await fs.readFile(entry, "utf8")).slice(0, maxChars);
    } catch {
      return "";
    }
  }
}
