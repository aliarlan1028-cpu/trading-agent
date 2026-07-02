import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import simpleGit from "simple-git";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const skillsDir = path.join(rootDir, "data", "skills");

export async function fetchSkillPackage(db, payload = {}) {
  await fs.mkdir(skillsDir, { recursive: true });
  const skillId = id("skill");
  const target = path.join(skillsDir, skillId);
  if (payload.sourceUrl?.includes("github.com")) {
    await simpleGit().clone(payload.sourceUrl, target, ["--depth", "1"]);
  } else {
    await fs.mkdir(target, { recursive: true });
    let skillMd = payload.skillMd;
    if (!skillMd && payload.sourceUrl) {
      const response = await fetch(payload.sourceUrl);
      if (!response.ok) throw new Error(`Skill URL fetch failed ${response.status}`);
      skillMd = await response.text();
    }
    await fs.writeFile(path.join(target, "SKILL.md"), skillMd || "# Imported Skill\n\nNo instructions.", "utf8");
  }
  const manifest = await readSkillManifest(target);
  const skill = {
    id: skillId,
    name: payload.name || manifest.name || path.basename(payload.sourceUrl || skillId),
    source: payload.sourceUrl || "uploaded",
    version: manifest.version || "0.1.0",
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
    const text = await fs.readFile(path.join(dir, "SKILL.md"), "utf8");
    const name = text.match(/^#\s+(.+)$/m)?.[1];
    const permissions = [...text.matchAll(/permission[s]?:\s*([a-z0-9_., -]+)/gi)]
      .flatMap((match) => match[1].split(/[,\s]+/).filter(Boolean));
    return { name, permissions };
  } catch {
    return {};
  }
}

function runInContainer(workdir, command, commandArgs) {
  return new Promise((resolve) => {
    const image = process.env.SKILL_SANDBOX_IMAGE || "node:20-alpine";
    const dockerArgs = ["run", "--rm", "--network=none", "-v", `${workdir}:/skill:ro`, "-w", "/skill", image, command, ...commandArgs];
    const child = spawn("docker", dockerArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (data) => { output += data.toString(); });
    child.stderr.on("data", (data) => { output += data.toString(); });
    child.on("error", (error) => resolve({ code: 127, output: `Docker sandbox unavailable: ${error.message}` }));
    child.on("close", (code) => resolve({ code, output }));
  });
}
